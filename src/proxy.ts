import { NextResponse, type NextRequest } from "next/server";
import { brand } from "@/config/brand";

/**
 * Optimistic auth gate: bounces visitors without a session cookie away from
 * app routes. This is NOT the authorization layer — every page, action and
 * route handler re-validates the session and tenant on the server.
 */
export const APP_PREFIXES = [
  "/home",
  "/team",
  "/content",
  "/calendar",
  "/social",
  "/leads",
  "/sales",
  "/analytics",
  "/approvals",
  "/campaigns",
  "/knowledge",
  "/brand",
  "/inbox",
  "/reports",
  "/activity",
  "/integrations",
  "/settings",
  "/help",
  "/notifications",
  "/onboarding",
  "/admin",
];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApp = APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isApp && !request.cookies.has(brand.sessionCookie)) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|embed|.*\\..*).*)"],
};
