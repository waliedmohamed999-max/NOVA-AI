import { afterEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { z as zod } from "zod";
import { db } from "@/server/db/client";
import { makeTenant } from "../support/factory";
import { aiStructured } from "@/server/ai";
import { getProvider, reportSuccess, routeModels, setProvider } from "@/server/ai/router";
import { AiError, type GenerateRequest, type LLMProvider, type ProviderName, type StructuredResult } from "@/server/ai/types";
import { saveUpload, setStorageDriver, type StorageDriver } from "@/server/storage";
import { readiness, resetHealthCaches } from "@/server/health";

/**
 * Chaos: dependencies failing. The platform must fail over where it can, fail honestly where it can't,
 * and never report a fake success. (Duplicate webhooks, expired tokens and rate limits are covered in
 * webhook-routes, connections/meta-linkedin and platform/tenancy tests.)
 */
const originals = { anthropic: getProvider("anthropic"), openai: getProvider("openai") };
let calls: string[] = [];

function fake(name: ProviderName, behaviour: "ok" | "down"): LLMProvider {
  return {
    name,
    isConfigured: () => true,
    generateStructured: async <S extends z.ZodType>(req: GenerateRequest & { schema: S; schemaName: string }): Promise<StructuredResult<z.output<S>>> => {
      calls.push(name);
      if (behaviour === "down") throw new AiError("ai_failed", `${name}: 529 overloaded`);
      return { data: req.schema.parse({ status: "ok" }) as z.output<S>, usage: { inputTokens: 10, outputTokens: 5 }, model: name === "anthropic" ? "claude-haiku-4-5" : "gpt-test" };
    },
  } as unknown as LLMProvider;
}

afterEach(() => {
  setProvider("anthropic", originals.anthropic);
  setProvider("openai", originals.openai);
  reportSuccess("anthropic");
  reportSuccess("openai");
  setStorageDriver(null);
  resetHealthCaches();
  calls = [];
});

const schema = zod.object({ status: zod.literal("ok") });
const ask = (scope: { organizationId: string; workspaceId: string }) =>
  aiStructured(scope, { task: "SUMMARIZATION", quality: "fast", realOnly: true, promptRef: { key: "chaos", version: "chaos@1" }, schemaName: "chaos", schema, prompt: "status?", maxTokens: 50 });

describe("chaos: AI provider outage", () => {
  it("fails over to the other provider and records the fallback", async () => {
    const t = await makeTenant("Chaos AI");
    process.env.AI_PRIMARY_PROVIDER = "anthropic";
    setProvider("anthropic", fake("anthropic", "down"));
    setProvider("openai", fake("openai", "ok"));
    const r = await ask(t.scope);
    expect(r.data).toEqual({ status: "ok" });
    expect(r.model).toBe("gpt-test");
    expect(calls[0]).toBe("anthropic");
    const runs = await db.aiRun.findMany({ where: { organizationId: t.organization.id }, orderBy: { createdAt: "asc" } });
    expect(runs.map((x) => x.status)).toEqual(["ERROR", "SUCCESS"]);
    delete process.env.AI_PRIMARY_PROVIDER;
  });

  it("after repeated failures the circuit breaker routes the healthy provider first", async () => {
    const t = await makeTenant("Chaos Breaker");
    process.env.AI_PRIMARY_PROVIDER = "anthropic";
    setProvider("anthropic", fake("anthropic", "down"));
    setProvider("openai", fake("openai", "ok"));
    for (let i = 0; i < 3; i++) await ask(t.scope);
    expect(routeModels({ task: "SUMMARIZATION", quality: "fast" })[0].provider).toBe("openai");
    calls = [];
    await ask(t.scope);
    expect(calls).toEqual(["openai"]);
    delete process.env.AI_PRIMARY_PROVIDER;
  });

  it("with every provider down the caller gets an honest error — no offline or fake answer", async () => {
    const t = await makeTenant("Chaos Down");
    setProvider("anthropic", fake("anthropic", "down"));
    setProvider("openai", fake("openai", "down"));
    await expect(ask(t.scope)).rejects.toMatchObject({ code: "ai_failed" });
    const runs = await db.aiRun.findMany({ where: { organizationId: t.organization.id } });
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((x) => x.status === "ERROR")).toBe(true);
  });
});

describe("chaos: storage outage", () => {
  const down: StorageDriver = {
    name: "s3",
    put: async () => Promise.reject(new Error("connect ECONNREFUSED")),
    get: async () => Promise.reject(new Error("connect ECONNREFUSED")),
    delete: async () => Promise.reject(new Error("connect ECONNREFUSED")),
    check: async () => ({ ok: false, detail: "unreachable" }),
  };

  it("an upload fails without leaving a dangling file record, and readiness reports fail (503)", async () => {
    const t = await makeTenant("Chaos Storage");
    setStorageDriver(down);
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a1f3a8a70000000049454e44ae426082", "hex");
    await expect(saveUpload({ organizationId: t.organization.id, workspaceId: t.workspace.id, fileName: "logo.png", data: png, purpose: "brand_logo" })).rejects.toThrow();
    expect(await db.fileObject.count({ where: { organizationId: t.organization.id } })).toBe(0);
    resetHealthCaches();
    const r = await readiness();
    expect(r.checks.storage).toMatchObject({ status: "fail", detail: "unreachable" });
    expect(r.status).toBe("fail");
  });
});
