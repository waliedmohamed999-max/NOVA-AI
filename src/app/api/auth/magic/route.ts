import { NextResponse, type NextRequest } from "next/server";
import { AuthError, consumeMagicLink } from "@/server/auth/service";
import { startSession } from "@/server/auth/session";
import { db } from "@/server/db/client";

const base = (req: NextRequest) => process.env.APP_URL ?? req.nextUrl.origin;

/**
 * GET never signs in: email security scanners and link previews only GET, so a GET just shows the
 * confirmation page. (Older emails pointed here.)
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const url = new URL("/magic", base(req));
  if (token) url.searchParams.set("token", token);
  return NextResponse.redirect(url);
}

/** The "Continue" button on /magic posts here — the only place a magic link is consumed (single use). */
export async function POST(req: NextRequest) {
  if (req.headers.get("sec-fetch-site") === "cross-site") return NextResponse.redirect(new URL("/sign-in?error=invalid_token", base(req)), 303);
  const form = await req.formData().catch(() => null);
  const token = form?.get("token");
  if (typeof token !== "string" || !token) return NextResponse.redirect(new URL("/sign-in?error=invalid_token", base(req)), 303);
  try {
    const user = await consumeMagicLink(token);
    await startSession(user.id);
    const member = await db.organizationMember.findFirst({ where: { userId: user.id }, include: { organization: true } });
    const dest = member?.organization.onboardingStatus === "COMPLETED" ? "/home" : "/onboarding";
    return NextResponse.redirect(new URL(dest, base(req)), 303);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.redirect(new URL("/sign-in?error=invalid_token", base(req)), 303);
    throw err;
  }
}
