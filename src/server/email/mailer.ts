import nodemailer, { type Transporter } from "nodemailer";
import { brand } from "@/config/brand";
import { logger } from "../logger";

export type EmailMessage = { to: string; subject: string; text: string; html?: string };

export interface Mailer {
  readonly configured: boolean;
  send(message: EmailMessage): Promise<void>;
}

class SmtpMailer implements Mailer {
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
    await this.transport.sendMail({ from: this.from, ...message });
  }
}

/** Used when SMTP is not configured: logs that an email would be sent, never its secret links in production. */
class UnconfiguredMailer implements Mailer {
  readonly configured = false;
  async send(message: EmailMessage) {
    if (process.env.NODE_ENV === "production") {
      logger.error({ to: message.to, subject: message.subject }, "email not sent: SMTP is not configured");
      return;
    }
    logger.warn({ to: message.to, subject: message.subject, text: message.text }, "SMTP not configured — email logged (dev only)");
  }
}

let mailer: Mailer | undefined;
export function getMailer(): Mailer {
  mailer ??= process.env.SMTP_HOST ? new SmtpMailer(process.env.EMAIL_FROM ?? `${brand.name} <no-reply@${brand.domain}>`) : new UnconfiguredMailer();
  return mailer;
}

/** Test hook. */
export function setMailer(m: Mailer) {
  mailer = m;
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
  const html = `<!doctype html><html dir="${dir}"><body style="margin:0;background:#f7f5f1;font-family:-apple-system,Segoe UI,Tahoma,sans-serif;color:#17161c">
<div style="max-width:520px;margin:40px auto;background:#fff;border-radius:20px;padding:36px;border:1px solid #ece8e1">
<div style="font-weight:800;letter-spacing:.08em;font-size:14px">${escapeHtml(brand.name)}</div>
<h1 style="font-size:22px;margin:24px 0 12px">${escapeHtml(opts.heading)}</h1>
<p style="font-size:15px;line-height:1.6;color:#4a4852">${escapeHtml(opts.body)}</p>${cta}
<p style="font-size:12px;color:#8a8792;margin-top:32px">${escapeHtml(brand.legalName)}</p></div></body></html>`;
  const text = `${opts.heading}\n\n${opts.body}${opts.ctaUrl ? `\n\n${opts.ctaUrl}` : ""}`;
  return { html, text };
}
