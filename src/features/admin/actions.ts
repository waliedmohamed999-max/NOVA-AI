"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { audit } from "@/server/audit";
import { mapError, type ActionResult } from "@/server/action";
import { resolveTenant } from "@/server/context";
import { enforceRateLimit } from "@/server/rate-limit";
import { instagramFeatureTest, publishTestPost, testConnection, type ConnectionTestResult } from "@/server/integrations/diagnostics";

/** Re-queues a dead/failed job. Platform admins only. */
export async function retryJobAction(input: { id: string }): Promise<ActionResult<undefined>> {
  const session = await getSession();
  if (!session?.user.isPlatformAdmin) return { ok: false, error: "forbidden" };
  const { id } = z.object({ id: z.string() }).parse(input);
  const res = await db.job.updateMany({ where: { id, status: { in: ["DEAD", "FAILED"] } }, data: { status: "RETRYING", runAt: new Date(), attempts: 0, lastError: null, finishedAt: null } });
  if (res.count === 1) await audit({ category: "SECURITY", actorType: "USER", actorId: session.userId, action: "admin.job_retried", entityType: "Job", entityId: id, summary: "Platform admin re-queued a job" });
  revalidatePath("/admin");
  return res.count === 1 ? { ok: true, data: undefined } : { ok: false, error: "invalid_transition" };
}

/** Platform admin + the admin's own workspace: connection diagnostics never touch other tenants. */
async function adminScope() {
  const session = await getSession();
  if (!session?.user.isPlatformAdmin) return null;
  const tenant = await resolveTenant();
  if (!tenant) return null;
  return { userId: session.userId, scope: { organizationId: tenant.organization.id, workspaceId: tenant.workspace.id } };
}

export async function testConnectionAction(input: { integrationId: string }): Promise<ActionResult<ConnectionTestResult>> {
  const a = await adminScope();
  if (!a) return { ok: false, error: "forbidden" };
  try {
    const { integrationId } = z.object({ integrationId: z.string() }).parse(input);
    return { ok: true, data: await testConnection(a.scope, integrationId, a.userId) };
  } catch (err) {
    return mapError(err, "admin.test_connection");
  }
}

export async function publishTestPostAction(input: { accountId: string; confirmation: string }): Promise<ActionResult<{ externalId: string; permalink: string | null }>> {
  const a = await adminScope();
  if (!a) return { ok: false, error: "forbidden" };
  try {
    const { accountId, confirmation } = z.object({ accountId: z.string(), confirmation: z.string() }).parse(input);
    await enforceRateLimit(`admin-test-post:${a.userId}`, 5, 3600);
    const r = await publishTestPost(a.scope, a.userId, accountId, confirmation);
    return { ok: true, data: { externalId: r.externalId, permalink: r.permalink ?? null } };
  } catch (err) {
    return mapError(err, "admin.test_post");
  }
}


/** The provider's own error text for the admin (never shown to customers). Tokens are redacted when stored. */
function providerDetail(err: unknown): string {
  let e: unknown = err;
  const parts: string[] = [];
  for (let i = 0; e && i < 4; i++) {
    if (e instanceof Error) {
      parts.push(`${e.name}: ${e.message}`);
      const d = (e as { detail?: unknown }).detail;
      if (d) parts.push(String(d));
      e = e.cause;
    } else {
      parts.push(String(e));
      break;
    }
  }
  return parts.join(" ← ").slice(0, 500);
}

/** Provider error code / HTTP status from the error chain (AiError, ImageProviderError, OpenAI SDK errors). */
function errorCodeOf(err: unknown): string | null {
  for (let e: unknown = err, i = 0; e && i < 4; i++, e = (e as { cause?: unknown }).cause) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === "string" && c) return c;
  }
  return null;
}
function httpStatusOf(err: unknown): number | null {
  for (let e: unknown = err, i = 0; e && i < 4; i++, e = (e as { cause?: unknown }).cause) {
    const s = (e as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return null;
}

type ImageTestData = { model: string; bytes: number; url: string; stored: boolean; deleted: boolean; cost: { basis: string; costMicro: string; pricingVersion: string; usage: { textInputTokens: number; imageInputTokens: number; outputTokens: number } } };

/** Admin-only live checks of the OpenAI configuration. Nothing is published; test images are private assets. */
/** Structured-output text test: a tiny prompt, a schema-validated answer, usage + usage-based cost. Creates no content. */
export async function openAiTestTextAction(): Promise<ActionResult<{ model: string; reply: string; inputTokens: number; outputTokens: number; costUsd: number }>> {
  const a = await adminScope();
  if (!a) return { ok: false, error: "forbidden" };
  const { recordValidation } = await import("@/server/admin/readiness");
  try {
    const { aiStructured, contentAiConfigured } = await import("@/server/ai");
    if (!contentAiConfigured()) return { ok: false, error: "content_ai_not_configured" };
    const started = Date.now();
    const r = await aiStructured({ ...a.scope }, { task: "SUMMARIZATION", quality: "fast", realOnly: true, promptRef: { key: "admin_test", version: "admin_test@1" }, schemaName: "nova_admin_test", schema: z.object({ status: z.literal("ok"), product: z.string() }), prompt: 'Return status "ok" and product "NOVA".', maxTokens: 200 });
    const costMicro = BigInt(r.costMicro ?? 0);
    // Recorded against the provider that actually answered (the router may pick Anthropic or OpenAI).
    await recordValidation({ provider: r.model.startsWith("claude") ? "anthropic" : "openai", check: "generate_text", ok: true, detail: `${r.model}: structured ${JSON.stringify(r.data)} · ${r.usage.inputTokens} in / ${r.usage.outputTokens} out`, durationMs: Date.now() - started, costMicro, meta: { model: r.model, usage: r.usage, costBasis: "usage × configured price" }, actorId: a.userId, organizationId: a.scope.organizationId });
    return { ok: true, data: { model: r.model, reply: JSON.stringify(r.data), inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: Number(costMicro) / 1e6 } };
  } catch (err) {
    const { routeModels } = await import("@/server/ai/router");
    const attempted = routeModels({ task: "SUMMARIZATION", quality: "fast" })[0]?.provider;
    await recordValidation({ provider: attempted === "anthropic" ? "anthropic" : "openai", check: "generate_text", ok: false, detail: providerDetail(err), errorCode: errorCodeOf(err), httpStatus: httpStatusOf(err), actorId: a.userId, organizationId: a.scope.organizationId });
    return mapError(err, "admin.openai_text");
  }
}

async function imageTest(kind: "generate_image" | "edit_image"): Promise<ActionResult<ImageTestData>> {
  const a = await adminScope();
  if (!a) return { ok: false, error: "forbidden" };
  const { recordValidation } = await import("@/server/admin/readiness");
  try {
    await enforceRateLimit(`admin-test-image:${a.userId}`, 3, 3600);
    const { adminTestImage, adminTestImageEdit } = await import("@/server/studio/images");
    const r = kind === "generate_image" ? await adminTestImage(a.scope, a.userId) : await adminTestImageEdit(a.scope, a.userId);
    await recordValidation({ provider: "openai", check: kind, ok: r.stored, detail: `${r.model}: ${r.bytes} bytes · storage ${r.stored ? "write/read ok" : "read-back mismatch"} · test file deleted`, costMicro: BigInt(r.cost.costMicro), meta: { model: r.model, cost: r.cost }, actorId: a.userId, organizationId: a.scope.organizationId });
    return { ok: true, data: { model: r.model, bytes: r.bytes, url: r.previewDataUrl, stored: r.stored, deleted: r.deleted, cost: r.cost } };
  } catch (err) {
    await recordValidation({ provider: "openai", check: kind, ok: false, detail: providerDetail(err), errorCode: errorCodeOf(err), httpStatus: httpStatusOf(err), actorId: a.userId, organizationId: a.scope.organizationId });
    return mapError(err, `admin.openai_${kind}`);
  }
}

export async function openAiTestImageAction() {
  return imageTest("generate_image");
}

export async function openAiTestImageEditAction() {
  return imageTest("edit_image");
}

/** Platform admin: validate a provider's credentials against its real API (no customer data, nothing published). */
export async function validateProviderAction(input: { provider: string }): Promise<ActionResult<{ ok: boolean; detail: string | null }>> {
  const session = await getSession();
  if (!session?.user.isPlatformAdmin) return { ok: false, error: "forbidden" };
  try {
    const { READINESS_PROVIDERS, validateCredentials } = await import("@/server/admin/readiness");
    const { provider } = z.object({ provider: z.enum(READINESS_PROVIDERS) }).parse(input);
    await enforceRateLimit(`admin-validate:${session.userId}`, 30, 3600);
    const tenant = await resolveTenant();
    const row = await validateCredentials(provider, { userId: session.userId, organizationId: tenant?.organization.id ?? null });
    revalidatePath("/admin/providers");
    return { ok: true, data: { ok: row.ok, detail: row.detail } };
  } catch (err) {
    return mapError(err, "admin.validate_provider");
  }
}

/** Platform admin: storage upload → signed URL → delete on a test prefix of the configured bucket. */
export async function storageTestAction(): Promise<ActionResult<{ ok: boolean; driver: string; steps: { step: string; ok: boolean; detail?: string }[] }>> {
  const session = await getSession();
  if (!session?.user.isPlatformAdmin) return { ok: false, error: "forbidden" };
  try {
    await enforceRateLimit(`admin-storage-test:${session.userId}`, 10, 3600);
    const { storageRoundtrip } = await import("@/server/admin/readiness");
    const r = await storageRoundtrip({ userId: session.userId });
    revalidatePath("/admin/providers");
    return { ok: true, data: r };
  } catch (err) {
    return mapError(err, "admin.storage_test");
  }
}

/** Platform admin: link a WhatsApp Cloud API phone number to the admin's current workspace. */
export async function linkWhatsAppNumberAction(input: { phoneNumberId: string; wabaId?: string }): Promise<ActionResult<{ displayPhone: string | null; verifiedName: string | null }>> {
  const a = await adminScope();
  if (!a) return { ok: false, error: "forbidden" };
  const { recordValidation } = await import("@/server/admin/readiness");
  try {
    const { phoneNumberId, wabaId } = z.object({ phoneNumberId: z.string().trim().regex(/^\d{5,25}$/), wabaId: z.string().trim().regex(/^\d{5,25}$/).optional().or(z.literal("")) }).parse(input);
    const { linkNumber } = await import("@/server/whatsapp/service");
    const n = await linkNumber(a.scope, phoneNumberId, wabaId || null);
    await recordValidation({ provider: "whatsapp", check: "phone_number", ok: true, detail: `${n.displayPhone ?? phoneNumberId} (${n.verifiedName ?? "unverified name"})`, actorId: a.userId, organizationId: a.scope.organizationId });
    await audit({ ...a.scope, category: "SECURITY", actorType: "USER", actorId: a.userId, action: "whatsapp.number_linked", summary: `Linked WhatsApp number ${n.displayPhone ?? phoneNumberId}` });
    revalidatePath("/admin/providers");
    return { ok: true, data: { displayPhone: n.displayPhone, verifiedName: n.verifiedName } };
  } catch (err) {
    await recordValidation({ provider: "whatsapp", check: "phone_number", ok: false, detail: providerDetail(err), actorId: a.userId, organizationId: a.scope.organizationId });
    return mapError(err, "admin.whatsapp_link");
  }
}

export async function instagramFeatureTestAction(input: { accountId: string; feature: "insights" | "comments" | "messages" }): Promise<ActionResult<{ detail: string }>> {
  const a = await adminScope();
  if (!a) return { ok: false, error: "forbidden" };
  try {
    const { accountId, feature } = z.object({ accountId: z.string(), feature: z.enum(["insights", "comments", "messages"]) }).parse(input);
    await enforceRateLimit(`admin-ig-test:${a.userId}`, 20, 3600);
    return { ok: true, data: await instagramFeatureTest(a.scope, a.userId, accountId, feature) };
  } catch (err) {
    return mapError(err, "admin.instagram_feature");
  }
}

// ── Manual live tests (LIVE INTEGRATIONS FINALIZATION) ──

export async function testEmailAction(input: { to: string; via?: "auto" | "platform" }): Promise<ActionResult<{ provider: string; messageId: string | null; status: "accepted"; developmentMailbox: boolean }>> {
  const a = await adminScope();
  if (!a) return { ok: false, error: "forbidden" };
  try {
    const { to, via } = z.object({ to: z.string().trim().email().max(254), via: z.enum(["auto", "platform"]).default("auto") }).parse(input);
    await enforceRateLimit(`admin-test-email:${a.userId}`, 5, 3600);
    const { sendTestEmail } = await import("@/server/admin/live-tests");
    const r = await sendTestEmail(a.scope, { userId: a.userId }, to, via);
    revalidatePath("/admin/providers");
    return { ok: true, data: r };
  } catch (err) {
    return mapError(err, "admin.test_email");
  }
}

export async function calendarTestAction(input: { integrationId: string; kind: "availability" | "meeting"; confirmation?: string }): Promise<ActionResult<{ detail: string }>> {
  const a = await adminScope();
  if (!a) return { ok: false, error: "forbidden" };
  try {
    const { integrationId, kind, confirmation } = z.object({ integrationId: z.string(), kind: z.enum(["availability", "meeting"]), confirmation: z.string().optional() }).parse(input);
    await enforceRateLimit(`admin-calendar-test:${a.userId}`, 10, 3600);
    const { calendarAvailabilityTest, calendarMeetingTest } = await import("@/server/admin/live-tests");
    let detail: string;
    if (kind === "availability") {
      const r = await calendarAvailabilityTest(a.scope, { userId: a.userId }, integrationId);
      detail = `${r.busy} busy · ${r.timezone} · token ${r.refreshed ? "refreshed" : "valid"}`;
    } else {
      const r = await calendarMeetingTest(a.scope, { userId: a.userId }, integrationId, confirmation ?? "");
      detail = `${r.externalEventId} · ${r.start} ${r.timezone} · ${r.cancelled ? "cancelled" : "NOT cancelled"}`;
    }
    revalidatePath("/admin/providers");
    return { ok: true, data: { detail } };
  } catch (err) {
    return mapError(err, "admin.calendar_test");
  }
}

export async function whatsappTestAction(input: { kind: "connection" | "send"; confirmation?: string }): Promise<ActionResult<{ detail: string }>> {
  const session = await getSession();
  if (!session?.user.isPlatformAdmin) return { ok: false, error: "forbidden" };
  try {
    const { kind, confirmation } = z.object({ kind: z.enum(["connection", "send"]), confirmation: z.string().optional() }).parse(input);
    await enforceRateLimit(`admin-whatsapp-test:${session.userId}`, kind === "send" ? 3 : 20, 3600);
    const { whatsappConnectionTest, whatsappSendTest } = await import("@/server/admin/live-tests");
    const detail = kind === "connection" ? (await whatsappConnectionTest({ userId: session.userId })).summary : `sent (${(await whatsappSendTest({ userId: session.userId }, confirmation ?? "")).mode})`;
    revalidatePath("/admin/providers");
    return { ok: true, data: { detail } };
  } catch (err) {
    return mapError(err, "admin.whatsapp_test");
  }
}
