import nodemailer, { type Transporter } from "nodemailer";
import { brand } from "@/config/brand";
import { logger } from "../logger";

export type EmailMessage = { to: string; subject: string; text: string; html?: string; replyTo?: string };
/** What the provider accepted. Providers report acceptance, not delivery or reading. */
export type SendResult = { messageId: string | null };

export class EmailConfigError extends Error {
  constructor(public code: "email_not_configured" | "email_invalid_recipient", message: string) {
    super(message);
    this.name = "EmailConfigError";
  }
}

const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
/**
 * Header-injection guard: addresses must be a single plain address (no CR/LF, commas, angle brackets);
 * the subject is flattened to one line.
 */
export function safeMessage(m: EmailMessage): EmailMessage {
  for (const [k, v] of [["to", m.to], ["replyTo", m.replyTo]] as const) {
    if (v === undefined) continue;
    if (/[\r\n]/.test(v) || !EMAIL_RE.test(v.trim())) throw new EmailConfigError("email_invalid_recipient", `Invalid ${k} address`);
  }
  return { ...m, to: m.to.trim(), replyTo: m.replyTo?.trim(), subject: m.subject.replace(/[\r\n]+/g, " ").slice(0, 250) };
}

const isDevMailbox = (host: string | undefined) => /^(localhost|127\.0\.0\.1|0\.0\.0\.0|mailpit|mailhog)$/i.test(host ?? "");
const isProduction = () => process.env.NODE_ENV === "production";

export type EmailTemplate = "verify_email" | "magic_link" | "password_reset" | "invitation" | "notification" | "sales_followup";

/**
 * Email provider boundary. Every outgoing email (verification, magic links, resets, invitations,
 * notifications, sales follow-ups) goes through getMailer(). EMAIL_PROVIDER picks the implementation:
 *   smtp (default when SMTP_HOST is set) · resend · postmark · ses (provider-ready, not implemented)
 * Mailpit is just an SMTP server for development — never a production provider.
 */
export interface Mailer {
  readonly name: string;
  readonly configured: boolean;
  send(message: EmailMessage): Promise<SendResult>;
  /** Checks credentials/connectivity without sending anything. */
  testConnection(): Promise<{ ok: boolean; detail: string }>;
}
export type EmailProvider = Mailer;

class SmtpMailer implements Mailer {
  readonly name = "smtp";
  readonly configured = true;
  private transport: Transporter;
  constructor(private from: string) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    this.transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    });
  }
  async send(message: EmailMessage) {
    const info = await this.transport.sendMail({ from: this.from, ...safeMessage(message) });
    return { messageId: info.messageId ?? null };
  }
  async testConnection() {
    try {
      await this.transport.verify();
      const host = process.env.SMTP_HOST ?? "";
      return { ok: true, detail: isDevMailbox(host) ? "SMTP reachable (development mailbox — not a real provider)" : "SMTP reachable" };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message.slice(0, 200) : "SMTP error" };
    }
  }
}

/** Resend (HTTPS API, no SDK). */
class ResendMailer implements Mailer {
  readonly name = "resend";
  readonly configured = Boolean(process.env.RESEND_API_KEY);
  constructor(private from: string) {}
  private headers() {
    return { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" };
  }
  async send(message: EmailMessage) {
    const m = safeMessage(message);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text, html: m.html, reply_to: m.replyTo }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Resend rejected the email (HTTP ${res.status})`);
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { messageId: body.id ?? null };
  }
  async testConnection() {
    const res = await fetch("https://api.resend.com/domains", { headers: this.headers(), signal: AbortSignal.timeout(15_000) }).catch(() => null);
    return res?.ok ? { ok: true, detail: "Resend API key valid" } : { ok: false, detail: `Resend check failed${res ? ` (HTTP ${res.status})` : ""}` };
  }
}

/** Postmark (HTTPS API, no SDK). */
class PostmarkMailer implements Mailer {
  readonly name = "postmark";
  readonly configured = Boolean(process.env.POSTMARK_SERVER_TOKEN);
  constructor(private from: string) {}
  private headers() {
    return { "x-postmark-server-token": process.env.POSTMARK_SERVER_TOKEN ?? "", accept: "application/json", "content-type": "application/json" };
  }
  async send(message: EmailMessage) {
    const m = safeMessage(message);
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ From: this.from, To: m.to, Subject: m.subject, TextBody: m.text, HtmlBody: m.html, ReplyTo: m.replyTo, MessageStream: process.env.POSTMARK_STREAM ?? "outbound" }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Postmark rejected the email (HTTP ${res.status})`);
    const body = (await res.json().catch(() => ({}))) as { MessageID?: string };
    return { messageId: body.MessageID ?? null };
  }
  async testConnection() {
    const res = await fetch("https://api.postmarkapp.com/server", { headers: this.headers(), signal: AbortSignal.timeout(15_000) }).catch(() => null);
    return res?.ok ? { ok: true, detail: "Postmark server token valid" } : { ok: false, detail: `Postmark check failed${res ? ` (HTTP ${res.status})` : ""}` };
  }
}

/**
 * No usable provider. Development: the email is logged. Production: sending FAILS (no silent drop, no
 * fallback to a development mailbox) so magic links / resets / invitations never pretend to go out.
 */
class UnconfiguredMailer implements Mailer {
  readonly name = "none";
  readonly configured = false;
  constructor(private reason = "No email provider configured") {}
  async testConnection() {
    return { ok: false, detail: this.reason };
  }
  async send(message: EmailMessage): Promise<SendResult> {
    if (isProduction()) {
      logger.error({ subject: message.subject, reason: this.reason }, "email not sent: no production email provider");
      throw new EmailConfigError("email_not_configured", this.reason);
    }
    logger.warn({ to: message.to, subject: message.subject, text: message.text }, "email provider not configured — email logged (dev only)");
    return { messageId: null };
  }
}

function createMailer(): Mailer {
  const from = process.env.EMAIL_FROM ?? `${brand.name} <no-reply@${brand.domain}>`;
  const kind = (process.env.EMAIL_PROVIDER ?? (process.env.SMTP_HOST ? "smtp" : process.env.RESEND_API_KEY ? "resend" : process.env.POSTMARK_SERVER_TOKEN ? "postmark" : "none")).toLowerCase();
  if (kind === "smtp") {
    if (!process.env.SMTP_HOST) return new UnconfiguredMailer("SMTP_HOST missing");
    // Mailpit/localhost is a development mailbox only — never used in production.
    if (isProduction() && isDevMailbox(process.env.SMTP_HOST)) return new UnconfiguredMailer(`SMTP_HOST "${process.env.SMTP_HOST}" is a development mailbox; configure a real provider for production`);
    return new SmtpMailer(from);
  }
  if (kind === "resend") return process.env.RESEND_API_KEY ? new ResendMailer(from) : new UnconfiguredMailer("RESEND_API_KEY missing");
  if (kind === "postmark") return process.env.POSTMARK_SERVER_TOKEN ? new PostmarkMailer(from) : new UnconfiguredMailer("POSTMARK_SERVER_TOKEN missing");
  if (kind === "ses") return new UnconfiguredMailer("SES adapter not implemented yet (provider-ready: use SMTP credentials from SES meanwhile)");
  return new UnconfiguredMailer();
}

let mailer: Mailer | undefined;
export function getMailer(): Mailer {
  mailer ??= createMailer();
  return mailer;
}

/** Sends one of NOVA's transactional templates through the configured provider. */
export async function sendTemplate(template: EmailTemplate, to: string, vars: { locale?: string; heading: string; body: string; ctaLabel?: string; ctaUrl?: string; subject?: string; replyTo?: string }) {
  const { html, text } = renderEmail(vars);
  const r = await getMailer().send({ to, subject: vars.subject ?? vars.heading, html, text, replyTo: vars.replyTo });
  logger.info({ template, provider: getMailer().name, messageId: r?.messageId ?? null }, "email sent");
  return r;
}

/** Test hook. */
export function setMailer(m: Mailer | null) {
  mailer = m ?? undefined;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Minimal, bilingual-friendly transactional layout. */
export function renderEmail(opts: { heading: string; body: string; ctaLabel?: string; ctaUrl?: string; locale?: string }) {
  const dir = opts.locale === "ar" ? "rtl" : "ltr";
  const cta = opts.ctaUrl
    ? `<p style="margin:28px 0"><a href="${escapeHtml(opts.ctaUrl)}" style="background:#17161c;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">${escapeHtml(opts.ctaLabel ?? "Continue")}</a></p>`
    : "";
  const html = `<!doctype html><html dir="${dir}"><body style="margin:0;background:#f8f9fa;font-family:-apple-system,Segoe UI,Tahoma,sans-serif;color:#17161c">
<div style="max-width:520px;margin:40px auto;background:#fff;border-radius:20px;padding:36px;border:1px solid #ece8e1">
<div style="font-weight:800;letter-spacing:.08em;font-size:14px">${escapeHtml(brand.name)}</div>
<h1 style="font-size:22px;margin:24px 0 12px">${escapeHtml(opts.heading)}</h1>
<p style="font-size:15px;line-height:1.6;color:#4a4852">${escapeHtml(opts.body)}</p>${cta}
<p style="font-size:12px;color:#8a8792;margin-top:32px">${escapeHtml(brand.legalName)}</p></div></body></html>`;
  const text = `${opts.heading}\n\n${opts.body}${opts.ctaUrl ? `\n\n${opts.ctaUrl}` : ""}`;
  return { html, text };
}
