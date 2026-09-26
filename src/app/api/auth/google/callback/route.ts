import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { exchangeGoogleCode, googleAuthEnabled } from "@/server/auth/google";
import { decryptSecret, safeEqual } from "@/server/crypto";
import { db } from "@/server/db/client";
import { startSession } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { logger } from "@/server/logger";

export async function GET(req: NextRequest) {
  const base = process.env.APP_URL ?? req.nextUrl.origin;
  const fail = (code: string) => NextResponse.redirect(new URL(`/sign-in?error=${code}`, base));
  if (!googleAuthEnabled()) return fail("oauth_denied");

  const jar = await cookies();
  const raw = jar.get("nova_google_oauth")?.value;
  jar.delete({ name: "nova_google_oauth", path: "/api/auth/google" });
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!raw || !code || !state) return fail("oauth_state");

  let stored: { state: string; verifier: string };
  try {
    stored = JSON.parse(decryptSecret(raw));
  } catch {
    return fail("oauth_state");
  }
  if (!safeEqual(stored.state, state)) return fail("oauth_state");

  try {
    const profile = await exchangeGoogleCode(code, stored.verifier);
    if (!profile.email_verified) return fail("oauth_denied");
    const email = profile.email.toLowerCase();
    const linked = await db.oAuthAccount.findUnique({ where: { provider_providerAccountId: { provider: "google", providerAccountId: profile.sub } } });
    let userId = linked?.userId;
    if (!userId) {
      const user = await db.user.upsert({
        where: { email },
        update: { emailVerifiedAt: new Date() },
        create: { email, name: profile.name, avatarUrl: profile.picture, emailVerifiedAt: new Date() },
      });
      await db.oAuthAccount.create({ data: { userId: user.id, provider: "google", providerAccountId: profile.sub } });
      userId = user.id;
    }
    await startSession(userId);
    await audit({ category: "SECURITY", actorType: "USER", actorId: userId, action: "auth.google", summary: `${email} signed in with Google` });
    const member = await db.organizationMember.findFirst({ where: { userId }, include: { organization: true } });
    return NextResponse.redirect(new URL(member?.organization.onboardingStatus === "COMPLETED" ? "/home" : "/onboarding", base));
  } catch (err) {
    logger.error({ err }, "google sign-in failed");
    return fail("oauth_denied");
  }
}
