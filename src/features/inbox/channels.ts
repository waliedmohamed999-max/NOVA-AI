/** Channels the unified inbox can filter by (client-safe copy of the server list). */
export const INBOX_CHANNEL_KEYS = ["WEBSITE", "EMAIL", "WHATSAPP", "INSTAGRAM_DM", "FACEBOOK_DM", "LINKEDIN", "PHONE", "MANUAL"] as const;
export type InboxChannelKey = (typeof INBOX_CHANNEL_KEYS)[number];
