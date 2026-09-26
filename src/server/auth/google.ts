import { createHash } from "node:crypto";
import { randomToken } from "../crypto";

/**
 * Google sign-in (OpenID Connect, authorization code + PKCE).
 * Enabled only when GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are set.
 */
export function googleAuthEnabled() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

const redirectUri = () => `${process.env.APP_URL ?? "http://localhost:3000"}/api/auth/google/callback`;

export function createGoogleAuthRequest() {
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, state, verifier };
}

export type GoogleProfile = { sub: string; email: string; email_verified: boolean; name?: string; picture?: string };

export async function exchangeGoogleCode(code: string, verifier: string): Promise<GoogleProfile> {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) throw new Error(`Google token exchange failed (${tokenRes.status})`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const profileRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (!profileRes.ok) throw new Error(`Google userinfo failed (${profileRes.status})`);
  return (await profileRes.json()) as GoogleProfile;
}
