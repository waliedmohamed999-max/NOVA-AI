import type { Channel } from "@/generated/prisma/enums";
import type { TenantScope } from "../db/tenant";
import { getMailer, renderEmail } from "../email/mailer";
import { mailboxFor } from "../integrations/workspace";
import { sendWhatsApp } from "../whatsapp/service";
import { numberFor, sendingNumber } from "../whatsapp/numbers";

/**
 * Outbound message channels for the unified inbox and the Sales Agent. Each adapter declares whether it is
 * configured *for this workspace*; unconfigured channels never pretend to send — messages stay as drafts
 * for a human to send manually.
 */
export type Recipient = { email?: string | null; phone?: string | null; handle?: string | null };
export type OutboundMessage = { subject?: string | null; body: string; locale: string };

export interface MessageChannel {
  readonly channel: Channel;
  isConfigured(scope: TenantScope): Promise<boolean>;
  /** How the message goes out — shown to the user ("Gmail: sales@acme.com", "NOVA email", "WhatsApp +20…"). */
  describe(scope: TenantScope): Promise<string | null>;
  send(scope: TenantScope, to: Recipient, message: OutboundMessage): Promise<{ externalId?: string | null; via: string }>;
}

/** Email: the workspace's connected Gmail / Outlook mailbox first (replies land in their inbox), else the platform mailer. */
class EmailChannel implements MessageChannel {
  constructor(readonly channel: Channel) {}
  async isConfigured(scope: TenantScope) {
    return Boolean(await mailboxFor(scope)) || getMailer().configured;
  }
  async describe(scope: TenantScope) {
    const box = await mailboxFor(scope);
    if (box) return `${box.provider === "GOOGLE" ? "Gmail" : "Outlook"}${box.email ? `: ${box.email}` : ""}`;
    return getMailer().configured ? `email (${getMailer().name})` : null;
  }
  async send(scope: TenantScope, to: Recipient, message: OutboundMessage) {
    if (!to.email) throw new Error("Lead has no email address");
    const { html, text } = renderEmail({ heading: message.subject ?? "", body: message.body, locale: message.locale });
    const box = await mailboxFor(scope);
    if (box) {
      const r = await box.api.sendEmail(box.token, { to: to.email, subject: message.subject ?? "", text, html });
      return { externalId: r.externalId, via: box.provider === "GOOGLE" ? "gmail" : "outlook" };
    }
    await getMailer().send({ to: to.email, subject: message.subject ?? "", html, text });
    return { via: getMailer().name };
  }
}

/** WhatsApp Business Platform (Cloud API) through the workspace's linked number. */
class WhatsAppChannel implements MessageChannel {
  readonly channel = "WHATSAPP" as const;
  async isConfigured(scope: TenantScope) {
    return Boolean(await sendingNumber(scope));
  }
  async describe(scope: TenantScope) {
    const n = (await sendingNumber(scope)) ? await numberFor(scope) : null;
    return n ? `WhatsApp ${n.displayPhone ?? ""}`.trim() : null;
  }
  async send(scope: TenantScope, to: Recipient, message: OutboundMessage) {
    if (!to.phone) throw new Error("Lead has no phone number");
    const r = await sendWhatsApp(scope, to.phone, { body: message.body });
    return { externalId: r.externalId, via: "whatsapp" };
  }
}

class NotConfiguredChannel implements MessageChannel {
  constructor(readonly channel: Channel) {}
  async isConfigured() {
    return false;
  }
  async describe() {
    return null;
  }
  async send(): Promise<{ via: string }> {
    throw new Error(`${this.channel} messaging is not configured`);
  }
}

/**
 * Social DMs stay drafts: LinkedIn has no messaging API for members; Instagram/Facebook DMs need
 * instagram_manage_messages / pages_messaging app review before replies can be sent from NOVA.
 */
const CHANNELS: Partial<Record<Channel, MessageChannel>> = {
  EMAIL: new EmailChannel("EMAIL"),
  WEBSITE: new EmailChannel("WEBSITE"), // website leads are answered by email
  WHATSAPP: new WhatsAppChannel(),
  INSTAGRAM_DM: new NotConfiguredChannel("INSTAGRAM_DM"),
  FACEBOOK_DM: new NotConfiguredChannel("FACEBOOK_DM"),
  LINKEDIN: new NotConfiguredChannel("LINKEDIN"),
};

export function channelFor(channel: Channel): MessageChannel | null {
  return CHANNELS[channel] ?? null;
}

/** Channels this workspace can actually send on right now. */
export async function sendableChannels(scope: TenantScope) {
  const out = new Set<Channel>();
  for (const [c, adapter] of Object.entries(CHANNELS) as [Channel, MessageChannel][]) if (await adapter.isConfigured(scope)) out.add(c);
  return out;
}
