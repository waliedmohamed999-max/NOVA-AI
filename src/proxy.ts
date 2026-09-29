import { NextResponse, type NextRequest } from "next/server";
import { brand } from "@/config/brand";
import { buildCsp, makeNonce, storageImgOrigin } from "@/server/security/csp";

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

  // /ar/... and /en/... are shareable language links: set the locale, then drop the prefix.
  const lang = pathname.match(/^\/(ar|en)(?=\/|$)/)?.[1];
  if (lang) {
    const rest = pathname.slice(3) || "/";
    const res = NextResponse.redirect(new URL(`${rest === "/dashboard" ? "/home" : rest}${search}`, request.url));
    res.cookies.set(brand.localeCookie, lang, { path: "/", maxAge: 31536000, sameSite: "lax" });
    return res;
  }
  if (pathname === "/dashboard" || pathname === "/app") return NextResponse.redirect(new URL("/home", request.url));

  const isApp = APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isApp && !request.cookies.has(brand.sessionCookie)) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  return withCsp(request, pathname.startsWith("/embed/"), /^\/(whatsapp(\/numbers)?|onboarding)\/?$/.test(pathname));
}

/** Per-request nonce CSP (see src/server/security/csp.ts). Next.js applies the nonce to its scripts. */
function withCsp(request: NextRequest, embed: boolean, facebookSdk = false) {
  const nonce = makeNonce();
  const csp = buildCsp(nonce, {
    dev: process.env.NODE_ENV === "development",
    embed,
    https: (process.env.APP_URL ?? "").startsWith("https://"),
    extraImgSrc: storageImgOrigin(),
    facebookSdk,
  });
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  // Correlation id for logs / error reports of this request (reuses a well-formed id from a load balancer).
  const incoming = request.headers.get("x-request-id");
  const requestId = incoming && /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  headers.set("x-request-id", requestId);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
