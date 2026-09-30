import { Prisma } from "@/generated/prisma/client";
import type { AgentKey } from "@/generated/prisma/enums";
import { db } from "../db/client";
import type { TenantScope } from "../db/tenant";
import { enqueue } from "../jobs/queue";
import { logger } from "../logger";
import { AiError } from "../ai";
import type { AiCallContext } from "../ai";

/** `incomplete`: the step failed but the workflow chose to carry on without it (it can be completed later). */
export type StepState = "pending" | "running" | "done" | "skipped" | "failed" | "incomplete";
export type RunStep = { key: string; status: StepState };

/**
 * The actionable object an agent run produces. The UI renders it as a card
 * with buttons — agents operate the software, they don't just chat.
 */
export type RunResult = {
  type: "content_plan" | "campaign" | "answer" | "analysis" | "leads" | "pipeline" | "opportunities" | "onboarding";
  title: string;
  summary: string;
  stats?: { label: string; value: string | number }[];
  items?: { title: string; subtitle?: string; href?: string; badge?: string }[];
  actions?: { label: string; href?: string; action?: "approve_campaign" | "approve_all_content"; entityId?: string; primary?: boolean }[];
  entity?: { type: string; id: string };
  offline?: boolean;
};

export type RunContext = {
  runId: string;
  scope: TenantScope;
  requestedById: string | null;
  ai: AiCallContext;
  input: string;
  params: Record<string, unknown>;
  step<T>(key: string, fn: () => Promise<T>): Promise<T>;
  skip(key: string): Promise<void>;
  /** Marks a failed step as incomplete-but-not-blocking (the workflow continues with a fallback). */
  incomplete(key: string): Promise<void>;
  /** Replaces the remaining visible plan (used when a command is routed to a specific workflow). */
  plan(keys: string[]): Promise<void>;
  task(agentKey: AgentKey, title: string, entity?: { type: string; id: string }): Promise<void>;
};

export type Workflow = {
  steps: string[];
  agent: AgentKey;
  run(ctx: RunContext): Promise<RunResult>;
};

const workflows = new Map<string, Workflow>();

export function defineWorkflow(kind: string, wf: Workflow) {
  workflows.set(kind, wf);
  return wf;
}

export function getWorkflow(kind: string) {
  return workflows.get(kind);
}

/** Creates a run with its (high-level) step list and queues it. Never blocks the request. */
export async function startRun(
  scope: TenantScope,
  opts: { kind: string; input?: string; params?: Record<string, unknown>; requestedById?: string | null; steps: string[]; agent: AgentKey },
) {
  const agent = await db.agent.findFirst({ where: { ...scope, key: opts.agent } });
  const run = await db.agentRun.create({
    data: {
      ...scope,
      agentId: agent?.id ?? null,
      kind: opts.kind,
      input: opts.input?.slice(0, 4000) ?? null,
      status: "QUEUED",
      steps: opts.steps.map((key) => ({ key, status: "pending" })) as Prisma.InputJsonValue,
      result: { params: opts.params ?? {} } as Prisma.InputJsonValue,
      requestedById: opts.requestedById ?? null,
    },
  });
  await enqueue("agent.run", { ...scope, runId: run.id }, { ...scope, priority: 10, maxAttempts: 2, dedupeKey: `agent.run:${run.id}` });
  return run;
}

async function setSteps(runId: string, steps: RunStep[]) {
  await db.agentRun.update({ where: { id: runId }, data: { steps: steps as Prisma.InputJsonValue } });
}

async function setAgentStatus(scope: TenantScope, key: AgentKey, status: "WORKING" | "IDLE" | "MONITORING" | "WAITING_APPROVAL", currentTask: string | null) {
  await db.agent.updateMany({ where: { ...scope, key }, data: { status, currentTask, lastActiveAt: new Date() } });
}

/** Executes a queued run. Called from the "agent.run" job handler. */
export async function executeRun(scope: TenantScope, runId: string) {
  const run = await db.agentRun.findFirst({ where: { id: runId, ...scope } });
  if (!run || run.status === "COMPLETED" || run.status === "CANCELLED") return { skipped: true };
  const wf = workflows.get(run.kind);
  if (!wf) throw new Error(`Unknown workflow ${run.kind}`);

  const steps: RunStep[] = wf.steps.map((key) => ({ key, status: "pending" }));
  const params = ((run.result as { params?: Record<string, unknown> } | null)?.params ?? {}) as Record<string, unknown>;
  await db.agentRun.update({ where: { id: run.id }, data: { status: "RUNNING", startedAt: new Date(), steps: steps as Prisma.InputJsonValue, error: null } });
  await setAgentStatus(scope, wf.agent, "WORKING", run.input?.slice(0, 140) ?? run.kind);

  const ctx: RunContext = {
    runId: run.id,
    scope,
    requestedById: run.requestedById,
    input: run.input ?? "",
    params,
    ai: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, agentKey: wf.agent, agentRunId: run.id },
    async step(key, fn) {
      const s = steps.find((x) => x.key === key) ?? (steps.push({ key, status: "pending" }), steps[steps.length - 1]);
      s.status = "running";
      await setSteps(run.id, steps);
      try {
        const out = await fn();
        s.status = "done";
        await setSteps(run.id, steps);
        return out;
      } catch (err) {
        s.status = "failed";
        await setSteps(run.id, steps);
        throw err;
      }
    },
    async skip(key) {
      const s = steps.find((x) => x.key === key);
      if (s) s.status = "skipped";
      await setSteps(run.id, steps);
    },
    async incomplete(key) {
      const s = steps.find((x) => x.key === key);
      if (s) s.status = "incomplete";
      await setSteps(run.id, steps);
    },
    async plan(keys) {
      for (const key of keys) if (!steps.some((x) => x.key === key)) steps.push({ key, status: "pending" });
      await setSteps(run.id, steps);
    },
    async task(agentKey, title, entity) {
      const agent = await db.agent.findFirst({ where: { ...scope, key: agentKey } });
      if (!agent) return;
      await db.agentTask.create({
        data: { ...scope, agentId: agent.id, runId: run.id, title: title.slice(0, 300), status: "DONE", completedAt: new Date(), entityType: entity?.type, entityId: entity?.id },
      });
      await db.agent.update({ where: { id: agent.id }, data: { lastActiveAt: new Date() } });
    },
  };

  try {
    const result = await wf.run(ctx);
    for (const s of steps) if (s.status === "pending" || s.status === "running") s.status = "done";
    await db.agentRun.update({
      where: { id: run.id },
      data: { status: "COMPLETED", finishedAt: new Date(), steps: steps as Prisma.InputJsonValue, result: { params, ...result } as unknown as Prisma.InputJsonValue },
    });
    const pending = await db.approval.count({ where: { ...scope, status: "PENDING", requestedByAgent: wf.agent } });
    await setAgentStatus(scope, wf.agent, pending ? "WAITING_APPROVAL" : "MONITORING", null);
    return { ok: true };
  } catch (err) {
    const code = err instanceof AiError ? (err.code === "ai_invalid_output" || err.code === "ai_refused" ? "ai_failed" : err.code) : "unexpected";
    logger.error({ err, runId: run.id, kind: run.kind }, "agent run failed");
    await db.agentRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), error: code, steps: steps as Prisma.InputJsonValue } });
    await setAgentStatus(scope, wf.agent, "IDLE", null);
    // Budget / configuration problems won't fix themselves on retry.
    if (err instanceof AiError && (err.code === "ai_budget_exceeded" || err.code === "ai_not_configured")) return { ok: false, error: code };
    throw err;
  }
}
