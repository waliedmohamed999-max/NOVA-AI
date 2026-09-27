import type { Channel } from "@/generated/prisma/enums";
import { getMailer, renderEmail } from "../email/mailer";

/**
 * Outbound message channels for the unified inbox. Each adapter declares
 * whether it is configured; unconfigured channels never pretend to send —
 * messages stay as drafts for a human to send manually.
 */
export interface MessageChannel {
  readonly channel: Channel;
  isConfigured(): boolean;
  send(to: { email?: string | null; phone?: string | null; handle?: string | null }, message: { subject?: string | null; body: string; locale: string }): Promise<{ externalId?: string }>;
}

class EmailChannel implements MessageChannel {
  readonly channel = "EMAIL" as const;
  isConfigured() {
    return getMailer().configured;
  }
  async send(to: { email?: string | null }, message: { subject?: string | null; body: string; locale: string }) {
    if (!to.email) throw new Error("Lead has no email address");
    const { html, text } = renderEmail({ heading: message.subject ?? "", body: message.body, locale: message.locale });
    await getMailer().send({ to: to.email, subject: message.subject ?? "", html, text });
    return {};
  }
}

class NotConfiguredChannel implements MessageChannel {
  constructor(readonly channel: Channel) {}
  isConfigured() {
    return false;
  }
  async send(): Promise<{ externalId?: string }> {
    throw new Error(`${this.channel} messaging is not configured`);
  }
}

/** WhatsApp / social DMs plug in here once their provider credentials exist. */
const CHANNELS: Partial<Record<Channel, MessageChannel>> = {
  EMAIL: new EmailChannel(),
  WEBSITE: new EmailChannel(), // website leads are answered by email
  WHATSAPP: new NotConfiguredChannel("WHATSAPP"),
  INSTAGRAM_DM: new NotConfiguredChannel("INSTAGRAM_DM"),
  FACEBOOK_DM: new NotConfiguredChannel("FACEBOOK_DM"),
  LINKEDIN: new NotConfiguredChannel("LINKEDIN"),
};

export function channelFor(channel: Channel): MessageChannel | null {
  return CHANNELS[channel] ?? null;
}
