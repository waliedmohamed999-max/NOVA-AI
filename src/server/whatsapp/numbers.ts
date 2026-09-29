import { db } from "../db/client";
import { tenantDb, type TenantScope } from "../db/tenant";
import { decryptSecret, encryptSecret } from "../crypto";
import { UserFacingError } from "../errors";
import { audit } from "../audit";
import { exchangeSignupCode, fakeTransportEnabled, getPhoneNumber, subscribeApp, whatsappStatus } from "./cloud-api";

/**
 * WhatsApp numbers of a workspace (several per workspace are supported by the model; the UI shows one per
 * plan today). A number connected through Embedded Signup uses that business's own token, stored encrypted
 * on the WHATSAPP integration; numbers linked by a platform admin use the platform system-user token.
 * Tokens never leave the server and are never logged or shown.
 */

type Actor = { userId: string | null; label?: string };
type NumberRow = { id: string; phoneNumberId: string; integrationId: string | null; organizationId: string; workspaceId: string };

const envToken = () => process.env.WHATSAPP_ACCESS_TOKEN?.trim().replace(/^["']|["']$/g, "") ?? "";

/** The token that may act for this number, or null (→ reconnect / not configured). */
export async function tokenFor(number: NumberRow): Promise<string | null> {
  if (number.integrationId) {
    const cred = await db.integrationCredential.findFirst({ where: { integrationId: number.integrationId, organizationId: number.organizationId }, orderBy: { updatedAt: "desc" }, select: { accessTokenEnc: true } });
    if (cred) return decryptSecret(cred.accessTokenEnc);
    return null;
  }
  return envToken() || (fakeTransportEnabled() ? "fake-platform-token" : null);
}

export async function numbersFor(scope: TenantScope) {
  return tenantDb(scope).whatsAppNumber.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
}

/** The workspace's primary active number (first connected). */
export async function numberFor(scope: TenantScope) {
  return db.whatsAppNumber.findFirst({ where: { ...scope, isActive: true }, orderBy: { createdAt: "asc" } });
}

/** A number that can actually send right now (has a token and isn't flagged for reconnect). */
export async function sendingNumber(scope: TenantScope) {
  const n = await numberFor(scope);
  if (!n || n.status === "reconnect_needed") return null;
  const token = await tokenFor(n);
  return token ? { number: n, token } : null;
}

export async function whatsappConnected(scope: TenantScope) {
  return Boolean(await sendingNumber(scope));
}

/** Platform admin: link a Cloud API phone_number_id to a workspace after verifying it with Meta (platform token). */
export async function linkNumber(scope: TenantScope, phoneNumberId: string, wabaId?: string | null, actor?: Actor) {
  const token = envToken() || (fakeTransportEnabled() ? "fake-platform-token" : "");
  if (!token || !whatsappStatus().configured) throw new UserFacingError("integration_not_configured");
  const info = await getPhoneNumber(phoneNumberId.trim(), token);
  const row = await upsertNumber(scope, { phoneNumberId: info.id, wabaId: wabaId ?? null, integrationId: null, info });
  if (actor) await audit({ ...scope, category: "SECURITY", actorType: "USER", actorId: actor.userId ?? undefined, action: "whatsapp.number_linked", summary: `WhatsApp number ${row.displayPhone ?? row.phoneNumberId} linked` });
  return row;
}

async function upsertNumber(scope: TenantScope, n: { phoneNumberId: string; wabaId: string | null; integrationId: string | null; info: Awaited<ReturnType<typeof getPhoneNumber>> }) {
  // A phone_number_id belongs to exactly one workspace: never silently move another tenant's number.
  const existing = await db.whatsAppNumber.findUnique({ where: { phoneNumberId: n.phoneNumberId } });
  if (existing && existing.workspaceId !== scope.workspaceId && existing.isActive) throw new UserFacingError("whatsapp_number_in_use");
  const data = {
    wabaId: n.wabaId,
    integrationId: n.integrationId,
    displayPhone: n.info.display_phone_number ?? null,
    verifiedName: n.info.verified_name ?? null,
    qualityRating: n.info.quality_rating ?? null,
    messagingLimit: n.info.messaging_limit_tier ?? null,
    status: "connected",
    isActive: true,
    lastCheckedAt: new Date(),
    lastError: null,
  };
  return db.whatsAppNumber.upsert({
    where: { phoneNumberId: n.phoneNumberId },
    create: { ...scope, phoneNumberId: n.phoneNumberId, connectedAt: new Date(), ...data },
    update: { ...scope, connectedAt: existing?.isActive ? existing.connectedAt : new Date(), ...data },
  });
}

/**
 * Embedded Signup completion (the customer's "Connect WhatsApp" button): exchange the code for this
 * business's token, store it encrypted, subscribe our app to their WABA webhooks, read the number's details.
 */
export async function completeEmbeddedSignup(scope: TenantScope, actor: Actor, input: { code: string; phoneNumberId: string; wabaId: string }) {
  const token = await exchangeSignupCode(input.code);
  const info = await getPhoneNumber(input.phoneNumberId, token);
  await subscribeApp(input.wabaId, token);
  const integration = await db.integration.upsert({
    where: { workspaceId_provider: { workspaceId: scope.workspaceId, provider: "WHATSAPP" } },
    create: { ...scope, provider: "WHATSAPP", status: "CONNECTED", connectedAt: new Date(), connectedById: actor.userId, scopes: ["whatsapp_business_messaging", "whatsapp_business_management"] },
    update: { status: "CONNECTED", connectedAt: new Date(), connectedById: actor.userId, statusMessage: null, lastErrorAt: null },
  });
  await db.integrationCredential.deleteMany({ where: { integrationId: integration.id } });
  await db.integrationCredential.create({ data: { ...scope, integrationId: integration.id, accessTokenEnc: encryptSecret(token), tokenType: "business" } });
  const row = await upsertNumber(scope, { phoneNumberId: info.id, wabaId: input.wabaId, integrationId: integration.id, info });
  await audit({ ...scope, category: "SECURITY", actorType: "USER", actorId: actor.userId ?? undefined, action: "whatsapp.connected", summary: `WhatsApp Business connected: ${row.displayPhone ?? row.phoneNumberId}` });
  return row;
}

/** Re-reads name / quality / messaging tier from Meta (health check). */
export async function refreshNumber(scope: TenantScope, id: string) {
  const n = await tenantDb(scope).whatsAppNumber.findUnique({ where: { id } });
  if (!n) throw new UserFacingError("item_not_found");
  const token = await tokenFor(n);
  if (!token) {
    await db.whatsAppNumber.update({ where: { id }, data: { status: "reconnect_needed", lastError: "token_missing", lastCheckedAt: new Date() } });
    return { ok: false };
  }
  try {
    const info = await getPhoneNumber(n.phoneNumberId, token);
    await db.whatsAppNumber.update({ where: { id }, data: { displayPhone: info.display_phone_number ?? n.displayPhone, verifiedName: info.verified_name ?? n.verifiedName, qualityRating: info.quality_rating ?? null, messagingLimit: info.messaging_limit_tier ?? null, status: "connected", lastError: null, lastCheckedAt: new Date() } });
    return { ok: true };
  } catch (err) {
    const expired = err instanceof Error && "kind" in err && (err as { kind: string }).kind === "expired";
    await db.whatsAppNumber.update({ where: { id }, data: { status: expired ? "reconnect_needed" : n.status, lastError: expired ? "token_expired" : "check_failed", lastCheckedAt: new Date() } });
    return { ok: false };
  }
}

export async function disconnectNumber(scope: TenantScope, id: string, actor: Actor) {
  const n = await tenantDb(scope).whatsAppNumber.findUnique({ where: { id } });
  if (!n) throw new UserFacingError("item_not_found");
  await db.whatsAppNumber.update({ where: { id }, data: { isActive: false, status: "disconnected" } });
  if (n.integrationId) await db.integration.update({ where: { id: n.integrationId }, data: { status: "DISCONNECTED" } }).catch(() => undefined);
  await audit({ ...scope, category: "SECURITY", actorType: "USER", actorId: actor.userId ?? undefined, action: "whatsapp.disconnected", summary: `WhatsApp number ${n.displayPhone ?? n.phoneNumberId} disconnected` });
}
