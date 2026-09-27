"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Mail, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import {
  forgotPasswordAction,
  magicLinkAction,
  resetPasswordAction,
  signInAction,
  signUpAction,
  type AuthFormState,
} from "./actions";

function FormError({ code }: { code?: string }) {
  const t = useTranslations("errors");
  if (!code || code === "validation") return null;
  return (
    <div role="alert" className="rounded-xl border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">
      {t(code as "unexpected")}
    </div>
  );
}

function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-8 space-y-2">
      <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.025em]">{title}</h1>
      {subtitle && <p className="text-[15px] text-ink-3">{subtitle}</p>}
    </div>
  );
}

function GoogleButton({ enabled }: { enabled: boolean }) {
  const t = useTranslations("auth.signIn");
  if (!enabled) return null;
  return (
    <a
      href="/api/auth/google"
      className="flex h-11 w-full items-center justify-center gap-2.5 rounded-full border border-line bg-surface text-sm font-medium shadow-xs transition hover:border-line-strong"
    >
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
        <path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2-1.9 3.2-4.7 3.2-8Z" />
        <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23Z" />
        <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8l3.7-2.8Z" />
        <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4Z" />
      </svg>
      {t("google")}
    </a>
  );
}

function Divider() {
  const t = useTranslations("common");
  return (
    <div className="my-6 flex items-center gap-3 text-xs text-ink-4">
      <span className="h-px flex-1 bg-line" />
      {t("or")}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export function SignInForm({ googleEnabled, next }: { googleEnabled: boolean; next?: string }) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signInAction, null);
  const [magicState, magicAction, magicPending] = useActionState<AuthFormState, FormData>(magicLinkAction, null);
  const [email, setEmail] = useState(state?.email ?? "");

  if (magicState?.sent) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <MailCheck className="size-6" />
        </div>
        <p className="text-[15px] text-ink-2">{t("signIn.magicSent", { email: magicState.email ?? "" })}</p>
      </div>
    );
  }

  return (
    <>
      <Heading title={t("signIn.title")} subtitle={t("signIn.subtitle")} />
      <GoogleButton enabled={googleEnabled} />
      {googleEnabled && <Divider />}
      <form action={action} className="space-y-4" noValidate>
        {next && <input type="hidden" name="next" value={next} />}
        <FormError code={state?.error} />
        <Field label={t("fields.email")}>
          {(p) => <Input {...p} name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label={t("fields.password")}>{(p) => <Input {...p} name="password" type="password" autoComplete="current-password" required />}</Field>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-[13px] font-medium text-ink-3 hover:text-ink">
            {t("signIn.forgot")}
          </Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={pending} iconEnd={<ArrowRight className="size-4 flip-rtl" />}>
          {t("signIn.submit")}
        </Button>
      </form>
      <form action={magicAction} className="mt-3">
        <input type="hidden" name="email" value={email} />
        <FormError code={magicState?.error} />
        <Button type="submit" variant="ghost" className="w-full" loading={magicPending} disabled={!email.includes("@")} icon={<Mail className="size-4" />}>
          {t("signIn.magicLink")}
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-ink-3">
        {t("signIn.noAccount")}{" "}
        <Link href="/sign-up" className="font-semibold text-ink hover:underline">
          {t("signIn.createAccount")}
        </Link>
      </p>
    </>
  );
}

export function SignUpForm({ googleEnabled, next }: { googleEnabled: boolean; next?: string }) {
  const t = useTranslations("auth");
  const te = useTranslations("errors");
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signUpAction, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <>
      <Heading title={t("signUp.title")} subtitle={t("signUp.subtitle")} />
      <GoogleButton enabled={googleEnabled} />
      {googleEnabled && <Divider />}
      <form action={action} className="space-y-4" noValidate>
        {next && <input type="hidden" name="next" value={next} />}
        <FormError code={state?.error} />
        <Field label={t("fields.name")} error={fe.name ? te("validation") : undefined}>
          {(p) => <Input {...p} name="name" autoComplete="name" required maxLength={120} />}
        </Field>
        <Field label={t("fields.email")} error={fe.email ? te("validation") : undefined}>
          {(p) => <Input {...p} name="email" type="email" autoComplete="email" required defaultValue={state?.email} />}
        </Field>
        <Field label={t("fields.password")} hint={t("fields.passwordHint")} error={fe.password ? te(fe.password as "password_too_short") : undefined}>
          {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" required minLength={10} />}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={pending} iconEnd={<ArrowRight className="size-4 flip-rtl" />}>
          {t("signUp.submit")}
        </Button>
        <p className="text-center text-xs text-ink-4">{t("signUp.terms")}</p>
      </form>
      <p className="mt-8 text-center text-sm text-ink-3">
        {t("signUp.hasAccount")}{" "}
        <Link href={next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in"} className="font-semibold text-ink hover:underline">
          {t("signUp.signIn")}
        </Link>
      </p>
    </>
  );
}

export function ForgotPasswordForm() {
  const t = useTranslations("auth.forgot");
  const tf = useTranslations("auth.fields");
  const [state, action, pending] = useActionState<AuthFormState, FormData>(forgotPasswordAction, null);
  return (
    <>
      <Heading title={t("title")} subtitle={t("subtitle")} />
      {state?.sent ? (
        <div role="status" className="rounded-2xl border border-line bg-surface p-5 text-[15px] text-ink-2">
          {t("sent", { email: state.email ?? "" })}
        </div>
      ) : (
        <form action={action} className="space-y-4">
          <FormError code={state?.error} />
          <Field label={tf("email")}>{(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}</Field>
          <Button type="submit" size="lg" className="w-full" loading={pending}>
            {t("submit")}
          </Button>
        </form>
      )}
      <p className="mt-8 text-center text-sm">
        <Link href="/sign-in" className="font-medium text-ink-3 hover:text-ink">
          {t("back")}
        </Link>
      </p>
    </>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("auth");
  const te = useTranslations("errors");
  const [state, action, pending] = useActionState<AuthFormState, FormData>(resetPasswordAction, null);
  return (
    <>
      <Heading title={t("reset.title")} />
      <form action={action} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <FormError code={state?.error} />
        <Field
          label={t("fields.newPassword")}
          hint={t("fields.passwordHint")}
          error={state?.fieldErrors?.password ? te(state.fieldErrors.password as "password_too_short") : undefined}
        >
          {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" required minLength={10} />}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={pending}>
          {t("reset.submit")}
        </Button>
      </form>
    </>
  );
}
