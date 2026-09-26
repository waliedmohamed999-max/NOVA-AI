import { NextResponse, type NextRequest } from "next/server";
import { AuthError, consumeMagicLink } from "@/server/auth/service";
import { startSession } from "@/server/auth/session";
import { db } from "@/server/db/client";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const base = process.env.APP_URL ?? req.nextUrl.origin;
  if (!token) return NextResponse.redirect(new URL("/sign-in", base));
  try {
    const user = await consumeMagicLink(token);
    await startSession(user.id);
    const member = await db.organizationMember.findFirst({ where: { userId: user.id }, include: { organization: true } });
    const dest = member?.organization.onboardingStatus === "COMPLETED" ? "/home" : "/onboarding";
    return NextResponse.redirect(new URL(dest, base));
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.redirect(new URL("/sign-in?error=invalid_token", base));
    throw err;
  }
}
