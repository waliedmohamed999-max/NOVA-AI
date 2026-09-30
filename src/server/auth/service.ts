import { z } from "zod";
import type { TokenPurpose } from "@/generated/prisma/enums";
import { db } from "../db/client";
import { hashToken, randomToken } from "../crypto";
import { audit } from "../audit";
import { logger } from "../logger";
import { getMailer, renderEmail } from "../email/mailer";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password";
import { brand } from "@/config/brand";

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z
  .string()
  .min(10, "password_too_short")
  .max(200)
  .refine((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), "password_too_weak");

export const signUpSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  password: passwordSchema,
  locale: z.enum(["en", "ar"]).default("en"),
});

const TOKEN_TTL_MINUTES: Record<TokenPurpose, number> = {
  EMAIL_VERIFY: 60 * 24,
  PASSWORD_RESET: 30,
  MAGIC_LINK: 15,
};

export class AuthError extends Error {
  constructor(public code: "email_taken" | "invalid_credentials" | "invalid_token" | "validation") {
    super(code);
    this.name = "AuthError";
  }
}

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

export async function issueToken(purpose: TokenPurpose, email: string, userId?: string): Promise<string> {
  const raw = randomToken();
  // Invalidate outstanding tokens of the same purpose for this email.
  await db.verificationToken.updateMany({
    where: { email, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  await db.verificationToken.create({
    data: {
      email,
      purpose,
      userId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES[purpose] * 60_000),
    },
  });
  return raw;
}

/** Atomically consumes a token; returns null when unknown, expired or already used. */
export async function consumeToken(purpose: TokenPurpose, raw: string) {
  const tokenHash = hashToken(raw);
  const res = await db.verificationToken.updateMany({
    where: { tokenHash, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (res.count !== 1) return null;
  return db.verificationToken.findUnique({ where: { tokenHash } });
}

export async function sendVerificationEmail(user: { id: string; email: string; locale: string }) {
  const token = await issueToken("EMAIL_VERIFY", user.email, user.id);
  const url = `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  const ar = user.locale === "ar";
  const { html, text } = renderEmail({
    locale: user.locale,
    heading: ar ? "أكّد بريدك الإلكتروني" : "Confirm your email",
    body: ar
      ? `مرحبًا بك في ${brand.name}. أكّد بريدك الإلكتروني لتفعيل فريق النمو الذكي.`
      : `Welcome to ${brand.name}. Confirm your email to activate your AI Growth Team.`,
    ctaLabel: ar ? "تأكيد البريد" : "Confirm email",
    ctaUrl: url,
  });
  await getMailer().send({ to: user.email, subject: ar ? "أكّد بريدك الإلكتروني" : "Confirm your email", html, text });
}

export async function signUp(input: z.input<typeof signUpSchema>) {
  const data = signUpSchema.parse(input);
  const existing = await db.user.findUnique({ where: { email: data.email } });
  if (existing) throw new AuthError("email_taken");
  const user = await db.user.create({
    data: { email: data.email, name: data.name, locale: data.locale, passwordHash: await hashPassword(data.password) },
  });
  // The account exists at this point: a verification email that can't go out (no provider yet, provider
  // outage) must not turn a successful sign-up into an error. Verification can be re-sent later.
  try {
    await sendVerificationEmail(user);
  } catch (err) {
    logger.warn({ err: { message: err instanceof Error ? err.message : String(err) }, userId: user.id }, "verification email not sent at sign-up");
  }
  await audit({ category: "SECURITY", actorType: "USER", actorId: user.id, action: "auth.sign_up", summary: `${user.email} created an account` });
  return user;
}

export async function authenticate(emailInput: string, password: string) {
  const email = emailSchema.safeParse(emailInput);
  if (!email.success) return verifyAgainstDummy(password).then(() => null);
  const user = await db.user.findUnique({ where: { email: email.data }, omit: { passwordHash: false } });
  if (!user?.passwordHash) {
    await verifyAgainstDummy(password);
    return null;
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) return null;
  const { passwordHash: _omit, ...safe } = user;
  void _omit;
  return safe;
}

export async function verifyEmail(raw: string) {
  const token = await consumeToken("EMAIL_VERIFY", raw);
  if (!token?.userId) throw new AuthError("invalid_token");
  const user = await db.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: new Date() } });
  await audit({ category: "SECURITY", actorType: "USER", actorId: user.id, action: "auth.email_verified", summary: `${user.email} verified their email` });
  return user;
}

/** Always resolves successfully to avoid account enumeration. */
export async function requestPasswordReset(emailInput: string) {
  const email = emailSchema.safeParse(emailInput);
  if (!email.success) return;
  const user = await db.user.findUnique({ where: { email: email.data } });
  if (!user) return;
  const token = await issueToken("PASSWORD_RESET", user.email, user.id);
  const ar = user.locale === "ar";
  const { html, text } = renderEmail({
    locale: user.locale,
    heading: ar ? "إعادة تعيين كلمة المرور" : "Reset your password",
    body: ar ? "استخدم الرابط أدناه لتعيين كلمة مرور جديدة. ينتهي الرابط خلال 30 دقيقة." : "Use the link below to choose a new password. It expires in 30 minutes.",
    ctaLabel: ar ? "تعيين كلمة المرور" : "Choose new password",
    ctaUrl: `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`,
  });
  await getMailer().send({ to: user.email, subject: ar ? "إعادة تعيين كلمة المرور" : "Reset your password", html, text });
  await audit({ category: "SECURITY", actorType: "USER", actorId: user.id, action: "auth.password_reset_requested", summary: `Password reset requested for ${user.email}` });
}

export async function resetPassword(raw: string, newPassword: string) {
  const password = passwordSchema.parse(newPassword);
  const token = await consumeToken("PASSWORD_RESET", raw);
  if (!token?.userId) throw new AuthError("invalid_token");
  const user = await db.user.update({
    where: { id: token.userId },
    data: { passwordHash: await hashPassword(password), emailVerifiedAt: new Date() },
  });
  // Revoke every existing session after a password change.
  await db.session.deleteMany({ where: { userId: user.id } });
  await audit({ category: "SECURITY", actorType: "USER", actorId: user.id, action: "auth.password_reset", summary: `${user.email} reset their password` });
  return user;
}

/** Sends a magic sign-in link. Unknown emails get a passwordless account on first use. */
export async function requestMagicLink(emailInput: string, locale: "en" | "ar" = "en") {
  const email = emailSchema.safeParse(emailInput);
  if (!email.success) return;
  const user = await db.user.findUnique({ where: { email: email.data } });
  const token = await issueToken("MAGIC_LINK", email.data, user?.id);
  const lang = user?.locale ?? locale;
  const ar = lang === "ar";
  const { html, text } = renderEmail({
    locale: lang,
    heading: ar ? `تسجيل الدخول إلى ${brand.name}` : `Sign in to ${brand.name}`,
    body: ar ? "اضغط الزر لتسجيل الدخول. ينتهي الرابط خلال 15 دقيقة." : "Click the button to sign in. This link expires in 15 minutes.",
    ctaLabel: ar ? "تسجيل الدخول" : "Sign in",
    // Opens a confirmation page; the token is only consumed by the POST from that page (email scanners only GET).
    ctaUrl: `${appUrl()}/magic?token=${encodeURIComponent(token)}`,
  });
  await getMailer().send({ to: email.data, subject: ar ? "رابط تسجيل الدخول" : "Your sign-in link", html, text });
}

/** Read-only check for the confirmation page: never consumes the token (safe against link scanners/prefetch). */
export async function peekMagicLink(raw: string) {
  const t = await db.verificationToken.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!t || t.purpose !== "MAGIC_LINK" || t.consumedAt || t.expiresAt <= new Date()) return null;
  const [name, domain] = t.email.split("@");
  return { email: `${name.slice(0, 2)}•••@${domain}` };
}

export async function consumeMagicLink(raw: string) {
  const token = await consumeToken("MAGIC_LINK", raw);
  if (!token) throw new AuthError("invalid_token");
  const user = await db.user.upsert({
    where: { email: token.email },
    update: { emailVerifiedAt: new Date() },
    create: { email: token.email, emailVerifiedAt: new Date() },
  });
  await audit({ category: "SECURITY", actorType: "USER", actorId: user.id, action: "auth.magic_link", summary: `${user.email} signed in with a magic link` });
  return user;
}
