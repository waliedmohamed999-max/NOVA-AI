import { db } from "../db/client";
import type { TenantScope } from "../db/tenant";
import { SOCIAL_PROVIDERS } from "./registry";
import { freshToken, providerIdFor } from "./service";
import { isCalendar, isMailbox, type CalendarApi, type MailboxApi } from "./providers/workspace-apis";
import type { TokenSet } from "./types";

type Connected<T> = { api: T; token: TokenSet; integrationId: string; provider: "GOOGLE" | "MICROSOFT"; email: string | null };

/**
 * The workspace's connected Google/Microsoft account that has a capability granted
 * (email_send → mailbox, calendar → calendar). null = not connected / permission missing — callers must
 * say so instead of pretending.
 */
async function connected(scope: TenantScope, needs: ("email_send" | "calendar_read" | "calendar_write")[]) {
  const rows = await db.integration.findMany({
    where: { ...scope, provider: { in: ["GOOGLE", "MICROSOFT"] }, status: "CONNECTED" },
    include: { accounts: { where: { isActive: true }, take: 1 } },
    orderBy: { connectedAt: "desc" },
  });
  for (const row of rows) {
    const provider = SOCIAL_PROVIDERS[providerIdFor(row.provider)];
    const caps = provider.capabilities?.({ platform: row.provider }, row.scopes) ?? [];
    if (!needs.every((n) => caps.some((c) => c.key === n && c.available))) continue;
    const account = row.accounts[0];
    if (!account) continue;
    // Refreshed on use: Google/Microsoft access tokens live about an hour.
    const fresh = await freshToken(row.id, account.id);
    if (!fresh) continue;
    const token = fresh.token;
    return { provider, token, integrationId: row.id, platform: row.provider as "GOOGLE" | "MICROSOFT", email: account.handle ?? null };
  }
  return null;
}

export async function mailboxFor(scope: TenantScope): Promise<Connected<MailboxApi> | null> {
  const c = await connected(scope, ["email_send"]);
  return c && isMailbox(c.provider) ? { api: c.provider, token: c.token, integrationId: c.integrationId, provider: c.platform, email: c.email } : null;
}

/** "read" = free/busy only; "write" = create/update/cancel events (booking also re-checks free/busy). */
export async function calendarFor(scope: TenantScope, access: "read" | "write" = "write"): Promise<Connected<CalendarApi> | null> {
  const c = await connected(scope, access === "read" ? ["calendar_read"] : ["calendar_read", "calendar_write"]);
  return c && isCalendar(c.provider) ? { api: c.provider, token: c.token, integrationId: c.integrationId, provider: c.platform, email: c.email } : null;
}
