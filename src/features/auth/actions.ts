"use server";

import { redirect } from "next/navigation";
import { safeInternalPath } from "@/lib/safe-path";
import { cookies } from "next/headers";
import { z } from "zod";
import { brand } from "@/config/brand";
import { isLocale } from "@/i18n/config";
import { db } from "@/server/db/client";
import { endSession, getSession, requestMeta, startSession } from "@/server/auth/session";
import {
  AuthError,
  authenticate,
  requestMagicLink,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
  signUp,
} from "@/server/auth/service";
import { rateLimit } from "@/server/rate-limit";
import { audit } from "@/server/audit";
import { logger } from "@/server/logger";

export type AuthFormState = { error?: string; fieldErrors?: Record<string, string>; sent?: boolean; email?: string } | null;

async function limited(bucket: string, limit: number, windowSeconds = 900) {
  const { ip } = await requestMeta();
  const res = await rateLimit(`auth:${bucket}:${ip ?? "unknown"}`, limit, windowSeconds);
  return !res.ok;
}

async function currentLocale() {
  const v = (await cookies()).get(brand.localeCookie)?.value;
  return isLocale(v) ? v : "en";
}

async function destinationFor(userId: string) {
  const membership = await db.organizationMember.findFirst({ where: { userId }, include: { organization: true } });
  if (!membership || membership.organization.onboardingStatus !== "COMPLETED") return "/onboarding";
  return "/home";
}

const safeRedirect = (to: FormDataEntryValue | null) => safeInternalPath(to);

export async function signUpAction(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  if (await limited("signup", 10, 3600)) return { error: "rate_limited" };
  const input = { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), password: String(form.get("password") ?? ""), locale: await currentLocale() };
  let userId: string;
  try {
    const user = await signUp(input);
    userId = user.id;
  } catch (err) {
    if (err instanceof AuthError) return { error: err.code, email: input.email };
    if (err instanceof z.ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of err.issues) fieldErrors[String(issue.path[0])] = issue.message.startsWith("password_") ? issue.message : "validation";
      return { error: "validation", fieldErrors, email: input.email };
    }
    logger.error({ err }, "sign up failed");
    return { error: "unexpected" };
  }
  await startSession(userId);
  redirect(safeRedirect(form.get("next")) ?? "/onboarding");
}

export async function signInAction(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (await limited(`signin`, 20)) return { error: "rate_limited", email };
  const emailLimited = await rateLimit(`auth:signin-email:${email}`, 10, 900);
  if (!emailLimited.ok) return { error: "rate_limited", email };

  const user = await authenticate(email, String(form.get("password") ?? ""));
  const meta = await requestMeta();
  if (!user) {
    await audit({ category: "SECURITY", actorType: "USER", action: "auth.sign_in_failed", summary: `Failed sign-in for ${email}`, ip: meta.ip, userAgent: meta.userAgent });
    return { error: "invalid_credentials", email };
  }
  await startSession(user.id);
  await audit({ category: "SECURITY", actorType: "USER", actorId: user.id, action: "auth.sign_in", summary: `${user.email} signed in`, ip: meta.ip, userAgent: meta.userAgent });
  if (isLocale(user.locale)) (await cookies()).set(brand.localeCookie, user.locale, { path: "/", maxAge: 31536000, sameSite: "lax" });
  redirect(safeRedirect(form.get("next")) ?? (await destinationFor(user.id)));
}

export async function magicLinkAction(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (await limited("magic", 5)) return { error: "rate_limited", email };
  await requestMagicLink(email, await currentLocale());
  return { sent: true, email };
}

export async function forgotPasswordAction(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (await limited("forgot", 5)) return { error: "rate_limited", email };
  await requestPasswordReset(email);
  return { sent: true, email };
}

export async function resetPasswordAction(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  if (await limited("reset", 10)) return { error: "rate_limited" };
  try {
    const user = await resetPassword(String(form.get("token") ?? ""), String(form.get("password") ?? ""));
    await startSession(user.id);
    redirect(await destinationFor(user.id));
  } catch (err) {
    if (err instanceof AuthError) return { error: err.code };
    if (err instanceof z.ZodError) return { error: "validation", fieldErrors: { password: err.issues[0]?.message ?? "validation" } };
    throw err;
  }
}

export async function resendVerificationAction(): Promise<AuthFormState> {
  const session = await getSession();
  if (!session) return { error: "unauthenticated" };
  if (await limited("verify-resend", 3, 3600)) return { error: "rate_limited" };
  await sendVerificationEmail(session.user);
  return { sent: true };
}

export async function signOutAction() {
  const session = await getSession();
  if (session) await audit({ category: "SECURITY", actorType: "USER", actorId: session.userId, action: "auth.sign_out", summary: `${session.user.email} signed out` });
  await endSession();
  redirect("/sign-in");
}

export async function setLocaleAction(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(brand.localeCookie, locale, { path: "/", maxAge: 31536000, sameSite: "lax" });
  const session = await getSession();
  if (session) await db.user.update({ where: { id: session.userId }, data: { locale } });
}

export async function setThemeAction(theme: "light" | "dark") {
  (await cookies()).set(brand.themeCookie, theme === "dark" ? "dark" : "light", { path: "/", maxAge: 31536000, sameSite: "lax" });
}
