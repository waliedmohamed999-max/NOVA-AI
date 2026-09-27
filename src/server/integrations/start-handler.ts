import { NextResponse, type NextRequest } from "next/server";
import { resolveTenant } from "../context";
import { returnPathFor, startConnect, type ConnectReturn } from "./service";
import { SOCIAL_PROVIDERS } from "./registry";
import { UserFacingError } from "../errors";

/**
 * Starts OAuth: `GET /api/integrations/{provider}/start?from=onboarding|settings`.
 * `from` selects one of two fixed return pages — never a free-form URL. Cross-site requests are
 * refused (Sec-Fetch-Site), so another site cannot push a signed-in user into a connect flow.
 */
export async function startOAuth(req: NextRequest, providerParam: string) {
  const base = process.env.APP_URL ?? req.nextUrl.origin;
  const from: ConnectReturn = req.nextUrl.searchParams.get("from") === "onboarding" ? "onboarding" : "settings";
  const back = returnPathFor(from);
  const fail = (code: string) => NextResponse.redirect(new URL(`${back}?error=${code}`, base));
  if (req.headers.get("sec-fetch-site") === "cross-site") return fail("forbidden");
  const tenant = await resolveTenant();
  if (!tenant) return NextResponse.redirect(new URL("/sign-in", base));
  if (!tenant.can("integrations:manage")) return fail("forbidden");
  if (!(providerParam in SOCIAL_PROVIDERS)) return fail("not_found");
  try {
    const url = await startConnect({ organizationId: tenant.organization.id, workspaceId: tenant.workspace.id }, tenant.user.id, providerParam as keyof typeof SOCIAL_PROVIDERS, from);
    return NextResponse.redirect(url);
  } catch (err) {
    return fail(err instanceof UserFacingError ? err.code : "integration_error");
  }
}
