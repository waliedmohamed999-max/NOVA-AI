import { NextResponse, type NextRequest } from "next/server";
import { completeConnect } from "@/server/integrations/service";
import { SOCIAL_PROVIDERS } from "@/server/integrations/registry";
import { UserFacingError } from "@/server/errors";
import { enqueue } from "@/server/jobs/queue";
import { db } from "@/server/db/client";
import { logger } from "@/server/logger";

/** OAuth redirect target. Tokens are exchanged and encrypted here, server-side only. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/integrations/[provider]/callback">) {
  const { provider } = await ctx.params;
  const base = process.env.APP_URL ?? req.nextUrl.origin;
  if (!(provider in SOCIAL_PROVIDERS)) return NextResponse.redirect(new URL("/integrations?error=not_found", base));
  const sp = req.nextUrl.searchParams;
  try {
    const res = await completeConnect(provider as keyof typeof SOCIAL_PROVIDERS, { code: sp.get("code"), state: sp.get("state"), error: sp.get("error") });
    if ("error" in res && res.error) return NextResponse.redirect(new URL(`${res.redirectTo}?error=${res.error}`, base));
    // Pull history right away so analytics has real data to work with.
    const integrations = await db.integration.findMany({ where: { ...res.scope, provider: { in: (res.connected ?? []) as never[] }, status: "CONNECTED" }, orderBy: { updatedAt: "desc" }, take: 2 });
    for (const i of integrations) await enqueue("social.sync_integration", { integrationId: i.id, organizationId: i.organizationId, workspaceId: i.workspaceId }, { organizationId: i.organizationId, workspaceId: i.workspaceId });
    return NextResponse.redirect(new URL(`${res.redirectTo}?connected=${(res.connected ?? []).join(",")}`, base));
  } catch (err) {
    logger.warn({ provider, err: err instanceof Error ? err.message : String(err) }, "integration callback failed");
    const code = err instanceof UserFacingError ? err.code : "integration_error";
    return NextResponse.redirect(new URL(`/integrations?error=${code}`, base));
  }
}
