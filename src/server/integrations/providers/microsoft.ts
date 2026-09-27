import { form, providerFetch } from "../http";
import { ProviderError, type ConnectedAccount, type ConnectionCheck, type ProviderProfile, type SocialProvider, type TokenSet } from "../types";
import { accountCapabilities, accountUpgradeScopes, type AccountScopeSpec } from "./account-scopes";
import type { BusyInterval, CalendarApi, CalendarEventInput, MailboxApi, OutgoingEmail } from "./workspace-apis";

/**
 * Microsoft account connection (Microsoft identity platform + Microsoft Graph):
 * Outlook identity, sending mail (Mail.Send) and calendar (Calendars.ReadWrite).
 * MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET / MICROSOFT_TENANT_ID (default "common").
 */
export const MICROSOFT_SCOPES: AccountScopeSpec = {
  envPrefix: "MICROSOFT",
  base: ["openid", "email", "profile", "offline_access", "User.Read"],
  capabilities: { identity: ["openid", "User.Read"], email_send: ["Mail.Send"], calendar: ["Calendars.ReadWrite"] },
  defaultOptional: ["Mail.Send", "Calendars.ReadWrite"],
};

const GRAPH = "https://graph.microsoft.com/v1.0";
const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, "") ?? "";
const tenant = () => clean(process.env.MICROSOFT_TENANT_ID) || "common";
const authority = () => `https://login.microsoftonline.com/${encodeURIComponent(tenant())}/oauth2/v2.0`;
const headers = (t: string) => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });
const unsupported = () => {
  throw new ProviderError("not_supported", "Microsoft account connections don't publish social posts");
};

/** Graph returns scopes as full URLs ("https://graph.microsoft.com/Mail.Send"); normalize to short names. */
export function normalizeMicrosoftScopes(scope?: string | null) {
  return [...new Set((scope ?? "").split(/\s+/).filter(Boolean).map((s) => s.replace(/^https:\/\/graph\.microsoft\.com\//i, "")))];
}

export class MicrosoftProvider implements SocialProvider, MailboxApi, CalendarApi {
  readonly id = "microsoft" as const;
  readonly countsAsChannel = false;
  readonly platforms: SocialProvider["platforms"] = ["MICROSOFT"];
  get scopes() {
    return MICROSOFT_SCOPES.base;
  }
  isConfigured() {
    return Boolean(clean(process.env.MICROSOFT_CLIENT_ID) && clean(process.env.MICROSOFT_CLIENT_SECRET));
  }
  upgradeScopes(_p: string, capability: string, granted: string[]) {
    return accountUpgradeScopes(MICROSOFT_SCOPES, capability, granted);
  }
  capabilities(_a: unknown, scopes: string[]) {
    return accountCapabilities(MICROSOFT_SCOPES, scopes);
  }
  connect({ state, redirectUri, codeChallenge, scopes }: { state: string; redirectUri: string; codeChallenge?: string; scopes?: string[] }) {
    const p = new URLSearchParams({ client_id: clean(process.env.MICROSOFT_CLIENT_ID), response_type: "code", redirect_uri: redirectUri, response_mode: "query", scope: (scopes ?? this.scopes).join(" "), state });
    if (codeChallenge) {
      p.set("code_challenge", codeChallenge);
      p.set("code_challenge_method", "S256");
    }
    return `${authority()}/authorize?${p}`;
  }
  async exchangeCode({ code, redirectUri, codeVerifier }: { code: string; redirectUri: string; codeVerifier?: string }): Promise<TokenSet> {
    const r = await providerFetch<{ access_token: string; expires_in: number; refresh_token?: string; scope?: string }>(
      `${authority()}/token`,
      form({ client_id: clean(process.env.MICROSOFT_CLIENT_ID), client_secret: clean(process.env.MICROSOFT_CLIENT_SECRET), code, redirect_uri: redirectUri, grant_type: "authorization_code", ...(codeVerifier ? { code_verifier: codeVerifier } : {}) }),
    );
    return { accessToken: r.access_token, refreshToken: r.refresh_token ?? null, expiresAt: new Date(Date.now() + r.expires_in * 1000), scopes: normalizeMicrosoftScopes(r.scope) };
  }
  async grantedScopes(t: TokenSet) {
    return t.scopes ?? [];
  }
  async getProfile(t: TokenSet): Promise<ProviderProfile> {
    const me = await providerFetch<{ id: string; displayName?: string; mail?: string | null; userPrincipalName?: string }>(`${GRAPH}/me?$select=id,displayName,mail,userPrincipalName`, { headers: headers(t.accessToken) });
    const email = me.mail ?? me.userPrincipalName ?? null;
    return { id: me.id, name: me.displayName ?? email ?? "Microsoft account", email };
  }
  async listAccounts(t: TokenSet): Promise<ConnectedAccount[]> {
    const p = await this.getProfile(t);
    return [{ externalId: p.id, platform: "MICROSOFT", name: p.name, handle: p.email ?? null, accountType: "microsoft_account", metadata: { email: p.email } }];
  }
  async checkConnection(t: TokenSet): Promise<ConnectionCheck> {
    try {
      const profile = await this.getProfile(t);
      return { valid: true, scopes: t.scopes ?? [], profile, expiresAt: t.expiresAt ?? null };
    } catch (e) {
      if (e instanceof ProviderError && e.kind === "expired") return { valid: false, scopes: [], detail: "token_invalid" };
      throw e;
    }
  }
  async refreshToken(t: TokenSet): Promise<TokenSet | null> {
    if (!t.refreshToken) return null;
    const r = await providerFetch<{ access_token: string; expires_in: number; refresh_token?: string; scope?: string }>(
      `${authority()}/token`,
      form({ client_id: clean(process.env.MICROSOFT_CLIENT_ID), client_secret: clean(process.env.MICROSOFT_CLIENT_SECRET), refresh_token: t.refreshToken, grant_type: "refresh_token" }),
    );
    return { accessToken: r.access_token, refreshToken: r.refresh_token ?? t.refreshToken, expiresAt: new Date(Date.now() + r.expires_in * 1000), scopes: r.scope ? normalizeMicrosoftScopes(r.scope) : t.scopes };
  }
  /** Microsoft has no token-revocation endpoint for this flow; NOVA deletes the stored tokens. */
  async disconnect() {}

  // ── Mailbox ──
  async sendEmail(t: TokenSet, m: OutgoingEmail) {
    await providerFetch(`${GRAPH}/me/sendMail`, {
      method: "POST",
      headers: headers(t.accessToken),
      body: JSON.stringify({
        message: { subject: m.subject, body: { contentType: m.html ? "HTML" : "Text", content: m.html ?? m.text }, toRecipients: [{ emailAddress: { address: m.to } }], ...(m.replyTo ? { replyTo: [{ emailAddress: { address: m.replyTo } }] } : {}) },
        saveToSentItems: true,
      }),
    });
    return { externalId: null }; // Graph's sendMail returns 202 with no id
  }

  // ── Calendar ──
  async freeBusy(t: TokenSet, range: { from: Date; to: Date; timezone: string }): Promise<BusyInterval[]> {
    const me = await this.getProfile(t);
    const r = await providerFetch<{ value: { scheduleItems: { status: string; start: { dateTime: string }; end: { dateTime: string } }[] }[] }>(`${GRAPH}/me/calendar/getSchedule`, {
      method: "POST",
      headers: { ...headers(t.accessToken), prefer: 'outlook.timezone="UTC"' },
      body: JSON.stringify({ schedules: [me.email], startTime: { dateTime: range.from.toISOString().slice(0, 19), timeZone: "UTC" }, endTime: { dateTime: range.to.toISOString().slice(0, 19), timeZone: "UTC" }, availabilityViewInterval: 30 }),
    });
    return (r.value[0]?.scheduleItems ?? []).filter((i) => i.status !== "free").map((i) => ({ start: new Date(`${i.start.dateTime}Z`), end: new Date(`${i.end.dateTime}Z`) }));
  }
  async createEvent(t: TokenSet, e: CalendarEventInput) {
    const r = await providerFetch<{ id: string; webLink?: string; onlineMeeting?: { joinUrl?: string } | null }>(`${GRAPH}/me/events`, { method: "POST", headers: headers(t.accessToken), body: JSON.stringify(outlookEvent(e)) });
    return { externalId: r.id, joinUrl: r.onlineMeeting?.joinUrl ?? r.webLink ?? null };
  }
  async updateEvent(t: TokenSet, id: string, e: CalendarEventInput) {
    await providerFetch(`${GRAPH}/me/events/${encodeURIComponent(id)}`, { method: "PATCH", headers: headers(t.accessToken), body: JSON.stringify(outlookEvent(e)) });
  }
  async cancelEvent(t: TokenSet, id: string) {
    await providerFetch(`${GRAPH}/me/events/${encodeURIComponent(id)}/cancel`, { method: "POST", headers: headers(t.accessToken), body: JSON.stringify({ comment: "" }) });
  }

  publishPost = unsupported;
  schedulePost = async () => null;
  getPost = async () => null;
  getPosts = async () => [];
  getMetrics = async () => null;
  getAccountMetrics = async () => null;
}

function outlookEvent(e: CalendarEventInput) {
  return {
    subject: e.title,
    body: { contentType: "Text", content: e.description ?? "" },
    start: { dateTime: e.start.toISOString().slice(0, 19), timeZone: "UTC" },
    end: { dateTime: e.end.toISOString().slice(0, 19), timeZone: "UTC" },
    attendees: e.attendees.map((address) => ({ emailAddress: { address }, type: "required" })),
  };
}
