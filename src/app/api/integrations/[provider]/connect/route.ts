import { NextResponse, type NextRequest } from "next/server";
import { resolveTenant } from "@/server/context";
import { returnPathFor, startConnect, type ConnectReturn } from "@/server/integrations/service";
import { SOCIAL_PROVIDERS } from "@/server/integrations/registry";
import { UserFacingError } from "@/server/errors";

/** Starts OAuth. `?from=onboarding|settings` picks one of two fixed return pages — never a free-form URL. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/integrations/[provider]/connect">) {
  const { provider } = await ctx.params;
  const base = process.env.APP_URL ?? req.nextUrl.origin;
  const tenant = await resolveTenant();
  if (!tenant) return NextResponse.redirect(new URL("/sign-in", base));
  const from: ConnectReturn = req.nextUrl.searchParams.get("from") === "onboarding" ? "onboarding" : "settings";
  const back = returnPathFor(from);
  if (!tenant.can("integrations:manage")) return NextResponse.redirect(new URL(`${back}?error=forbidden`, base));
  if (!(provider in SOCIAL_PROVIDERS)) return NextResponse.redirect(new URL(`${back}?error=not_found`, base));
  try {
    const url = await startConnect({ organizationId: tenant.organization.id, workspaceId: tenant.workspace.id }, tenant.user.id, provider as keyof typeof SOCIAL_PROVIDERS, from);
    return NextResponse.redirect(url);
  } catch (err) {
    const code = err instanceof UserFacingError ? err.code : "unexpected";
    return NextResponse.redirect(new URL(`${back}?error=${code}`, base));
  }
}
