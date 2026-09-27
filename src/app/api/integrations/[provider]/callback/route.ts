import { NextResponse, type NextRequest } from "next/server";
import { completeConnect, CONNECTED_ACCOUNTS_PATH } from "@/server/integrations/service";
import { SOCIAL_PROVIDERS } from "@/server/integrations/registry";
import { UserFacingError } from "@/server/errors";
import { enqueue } from "@/server/jobs/queue";
import { db } from "@/server/db/client";
import { logger } from "@/server/logger";
import { getSession } from "@/server/auth/session";

/**
 * OAuth redirect target. The code is exchanged and tokens are encrypted here, server-side only;
 * the browser is sent back to a fixed in-app page with nothing but platform names in the URL.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/integrations/[provider]/callback">) {
  const { provider } = await ctx.params;
  const base = process.env.APP_URL ?? req.nextUrl.origin;
  if (!(provider in SOCIAL_PROVIDERS)) return NextResponse.redirect(new URL(`${CONNECTED_ACCOUNTS_PATH}?error=not_found`, base));
  const sp = req.nextUrl.searchParams;
  try {
    // Bound to the signed-in user who started the flow (a mismatched or missing session is rejected).
    const session = await getSession().catch(() => null);
    const res = await completeConnect(provider as keyof typeof SOCIAL_PROVIDERS, { code: sp.get("code"), state: sp.get("state"), error: sp.get("error") }, session?.userId ?? null);
    const out = new URL(res.redirectTo, base);
    if (res.error) {
      out.searchParams.set("error", res.error);
      return NextResponse.redirect(out);
    }
    // Pull history right away (only for accounts already chosen) so analytics has real data.
    const ready = (res.connected ?? []).filter((p) => !res.needsSelection?.includes(p));
    const integrations = await db.integration.findMany({ where: { ...res.scope, provider: { in: ready as never[] }, status: "CONNECTED" } });
    for (const i of integrations) await enqueue("social.sync_integration", { integrationId: i.id, organizationId: i.organizationId, workspaceId: i.workspaceId }, { organizationId: i.organizationId, workspaceId: i.workspaceId });
    if (res.connected?.length) out.searchParams.set("connected", res.connected.join(","));
    if (res.needsSelection?.length) out.searchParams.set("choose", res.needsSelection.join(","));
    if (res.limited?.length) out.searchParams.set("limited", res.limited.join(","));
    return NextResponse.redirect(out);
  } catch (err) {
    logger.warn({ provider, err: err instanceof Error ? err.message : String(err) }, "integration callback failed");
    const code = err instanceof UserFacingError ? err.code : "integration_error";
    return NextResponse.redirect(new URL(`${CONNECTED_ACCOUNTS_PATH}?error=${code}`, base));
  }
}
