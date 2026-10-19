import { Prisma } from "@/generated/prisma/client";
import { db } from "../db/client";
import { audit } from "../audit";
import { notify } from "../notifications/service";
import { UserFacingError } from "../errors";

/**
 * Extra AI tokens for an organization (purchased packs or a platform admin grant). Each grant is recorded in
 * ai_token_grants; a payment's externalId (Stripe Checkout session) can be credited only once.
 */
export async function grantTokens(
  organizationId: string,
  tokens: bigint,
  meta: { source: "stripe" | "admin"; externalId?: string | null; amountCents?: number | null; currency?: string | null; createdById?: string | null; note?: string | null },
): Promise<"granted" | "duplicate"> {
  if (tokens <= 0n) throw new UserFacingError("validation");
  try {
    await db.$transaction([
      db.aiTokenGrant.create({
        data: { organizationId, tokens, source: meta.source, externalId: meta.externalId ?? null, amountCents: meta.amountCents ?? null, currency: meta.currency ?? null, createdById: meta.createdById ?? null, note: meta.note?.slice(0, 300) ?? null },
      }),
      // A new top-up re-arms the "used up" notification for this month.
      db.aiBudget.update({ where: { organizationId }, data: { extraTokens: { increment: tokens }, exhaustedNotifiedFor: null } }),
    ]);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "duplicate";
    throw err;
  }
  await audit({
    organizationId,
    actorType: meta.source === "admin" ? "USER" : "SYSTEM",
    actorId: meta.createdById ?? null,
    action: meta.source === "admin" ? "billing.ai_tokens_granted" : "billing.ai_tokens_purchased",
    summary: `${tokens.toLocaleString("en-US")} AI tokens ${meta.source === "admin" ? "granted by the platform" : "purchased"}`,
    category: meta.source === "admin" ? "SECURITY" : "BUSINESS",
  });
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { locale: true } });
  const ar = org?.locale === "ar";
  await notify({
    organizationId,
    type: "USAGE_LIMIT",
    title: ar ? `أُضيف ${tokens.toLocaleString("ar-EG")} توكن إلى رصيد الذكاء الاصطناعي` : `${tokens.toLocaleString("en-US")} AI tokens added`,
    link: "/settings/billing",
    roles: ["OWNER", "ADMIN"],
  }).catch(() => undefined);
  return "granted";
}

export async function recentGrants(organizationId: string, take = 10) {
  return db.aiTokenGrant.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take });
}
