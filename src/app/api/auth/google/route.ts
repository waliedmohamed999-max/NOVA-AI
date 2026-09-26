import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createGoogleAuthRequest, googleAuthEnabled } from "@/server/auth/google";
import { encryptSecret } from "@/server/crypto";

export async function GET() {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  if (!googleAuthEnabled()) return NextResponse.redirect(new URL("/sign-in", base));
  const { url, state, verifier } = createGoogleAuthRequest();
  // State + PKCE verifier live in a short-lived, encrypted, httpOnly cookie.
  (await cookies()).set("nova_google_oauth", encryptSecret(JSON.stringify({ state, verifier })), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 600,
  });
  return NextResponse.redirect(url);
}
