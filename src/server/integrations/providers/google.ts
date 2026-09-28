import { form, providerFetch } from "../http";
import { ProviderError, type ConnectedAccount, type ConnectionCheck, type ProviderProfile, type SocialProvider, type TokenSet } from "../types";
import { accountCapabilities, accountUpgradeScopes, type AccountScopeSpec } from "./account-scopes";
import { safeMessage } from "../../email/mailer";
import type { BusyInterval, CalendarApi, CalendarEventInput, MailboxApi, OutgoingEmail } from "./workspace-apis";

/**
 * Google account connection: Gmail identity, sending email (gmail.send) and calendar (events + free/busy).
 * Same OAuth client as "Sign in with Google" (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET), separate callback.
 */
export const GOOGLE_SCOPES: AccountScopeSpec = {
  envPrefix: "GOOGLE",
  base: ["openid", "email", "profile"],
  // Progressive consent: identity first; each capability is requested only when a feature needs it.
  capabilities: {
    identity: ["openid", "email"],
    email_send: ["https://www.googleapis.com/auth/gmail.send"],
    calendar_read: ["https://www.googleapis.com/auth/calendar.freebusy"],
    calendar_write: ["https://www.googleapis.com/auth/calendar.events"],
  },
  defaultOptional: ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy"],
};

const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, "") ?? "";
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const unsupported = () => {
  throw new ProviderError("not_supported", "Google account connections don't publish social posts");
};

function b64url(s: string) {
  return Buffer.from(s, "utf8").toString("base64url");
}

/** RFC 5322 message for the Gmail API (UTF-8 subject encoded per RFC 2047). */
export function rfc822(m: OutgoingEmail & { from?: string }) {
  const boundary = `nova_${Math.random().toString(36).slice(2)}`;
  const subject = `=?UTF-8?B?${Buffer.from(m.subject, "utf8").toString("base64")}?=`;
  const lines = [
    ...(m.from ? [`From: ${m.from}`] : []),
    `To: ${m.to}`,
    `Subject: ${subject}`,
    ...(m.replyTo ? [`Reply-To: ${m.replyTo}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(m.text, "utf8").toString("base64"),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(m.html ?? m.text, "utf8").toString("base64"),
    `--${boundary}--`,
  ];
  return lines.join("\r\n");
}

export class GoogleProvider implements SocialProvider, MailboxApi, CalendarApi {
  readonly id = "google" as const;
  readonly countsAsChannel = false;
  readonly platforms: SocialProvider["platforms"] = ["GOOGLE"];
  get scopes() {
    return GOOGLE_SCOPES.base;
  }
  isConfigured() {
    return Boolean(clean(process.env.GOOGLE_CLIENT_ID) && clean(process.env.GOOGLE_CLIENT_SECRET));
  }
  upgradeScopes(_p: string, capability: string, granted: string[]) {
    return accountUpgradeScopes(GOOGLE_SCOPES, capability, granted);
  }
  capabilities(_a: unknown, scopes: string[]) {
    return accountCapabilities(GOOGLE_SCOPES, scopes);
  }
  connect({ state, redirectUri, codeChallenge, scopes }: { state: string; redirectUri: string; codeChallenge?: string; scopes?: string[] }) {
    const p = new URLSearchParams({
      client_id: clean(process.env.GOOGLE_CLIENT_ID),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: (scopes ?? this.scopes).join(" "),
      state,
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
    });
    if (codeChallenge) {
      p.set("code_challenge", codeChallenge);
      p.set("code_challenge_method", "S256");
    }
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }
  async exchangeCode({ code, redirectUri, codeVerifier }: { code: string; redirectUri: string; codeVerifier?: string }): Promise<TokenSet> {
    const r = await providerFetch<{ access_token: string; expires_in: number; refresh_token?: string; scope?: string }>(
      "https://oauth2.googleapis.com/token",
      form({ code, client_id: clean(process.env.GOOGLE_CLIENT_ID), client_secret: clean(process.env.GOOGLE_CLIENT_SECRET), redirect_uri: redirectUri, grant_type: "authorization_code", ...(codeVerifier ? { code_verifier: codeVerifier } : {}) }),
    );
    return { accessToken: r.access_token, refreshToken: r.refresh_token ?? null, expiresAt: new Date(Date.now() + r.expires_in * 1000), scopes: normalizeGoogleScopes(r.scope) };
  }
  async grantedScopes(t: TokenSet) {
    return t.scopes ?? [];
  }
  async getProfile(t: TokenSet): Promise<ProviderProfile> {
    const me = await providerFetch<{ sub: string; email?: string; name?: string; picture?: string }>("https://openidconnect.googleapis.com/v1/userinfo", { headers: bearer(t.accessToken) });
    return { id: me.sub, name: me.name ?? me.email ?? "Google account", email: me.email ?? null, avatarUrl: me.picture ?? null };
  }
  async listAccounts(t: TokenSet): Promise<ConnectedAccount[]> {
    const p = await this.getProfile(t);
    return [{ externalId: p.id, platform: "GOOGLE", name: p.name, handle: p.email ?? null, avatarUrl: p.avatarUrl ?? null, accountType: "google_account", metadata: { email: p.email } }];
  }
  async checkConnection(t: TokenSet): Promise<ConnectionCheck> {
    const r = await providerFetch<{ scope?: string; expires_in?: string; email?: string }>(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(t.accessToken)}`).catch((e) => {
      if (e instanceof ProviderError && (e.status === 400 || e.status === 401)) return null;
      throw e;
    });
    if (!r) return { valid: false, scopes: [], detail: "token_invalid" };
    return { valid: true, scopes: normalizeGoogleScopes(r.scope), expiresAt: r.expires_in ? new Date(Date.now() + Number(r.expires_in) * 1000) : null };
  }
  async refreshToken(t: TokenSet): Promise<TokenSet | null> {
    if (!t.refreshToken) return null;
    const r = await providerFetch<{ access_token: string; expires_in: number; scope?: string }>(
      "https://oauth2.googleapis.com/token",
      form({ refresh_token: t.refreshToken, client_id: clean(process.env.GOOGLE_CLIENT_ID), client_secret: clean(process.env.GOOGLE_CLIENT_SECRET), grant_type: "refresh_token" }),
    );
    return { accessToken: r.access_token, refreshToken: t.refreshToken, expiresAt: new Date(Date.now() + r.expires_in * 1000), scopes: r.scope ? normalizeGoogleScopes(r.scope) : t.scopes };
  }
  async disconnect(t: TokenSet) {
    await providerFetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.refreshToken ?? t.accessToken)}`, { method: "POST" }).catch(() => undefined);
  }

  // ── Mailbox ──
  async sendEmail(t: TokenSet, message: OutgoingEmail) {
    // Same header-injection guard as the platform mailer: the raw RFC 822 headers are built here.
    const m = { ...message, ...safeMessage({ to: message.to, subject: message.subject, text: message.text, replyTo: message.replyTo }) };
    const r = await providerFetch<{ id: string; threadId?: string }>("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { ...bearer(t.accessToken), "content-type": "application/json" },
      body: JSON.stringify({ raw: b64url(rfc822(m)) }),
    });
    return { externalId: r.id, threadId: r.threadId ?? null };
  }

  // ── Calendar ──
  async freeBusy(t: TokenSet, range: { from: Date; to: Date; timezone: string }): Promise<BusyInterval[]> {
    const r = await providerFetch<{ calendars: Record<string, { busy: { start: string; end: string }[] }> }>("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: { ...bearer(t.accessToken), "content-type": "application/json" },
      body: JSON.stringify({ timeMin: range.from.toISOString(), timeMax: range.to.toISOString(), timeZone: range.timezone, items: [{ id: "primary" }] }),
    });
    return (r.calendars.primary?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  }
  async createEvent(t: TokenSet, e: CalendarEventInput) {
    const r = await providerFetch<{ id: string; htmlLink?: string; hangoutLink?: string }>("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all", {
      method: "POST",
      headers: { ...bearer(t.accessToken), "content-type": "application/json" },
      body: JSON.stringify(googleEvent(e)),
    });
    return { externalId: r.id, joinUrl: r.hangoutLink ?? r.htmlLink ?? null };
  }
  async updateEvent(t: TokenSet, id: string, e: CalendarEventInput) {
    await providerFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=all`, {
      method: "PATCH",
      headers: { ...bearer(t.accessToken), "content-type": "application/json" },
      body: JSON.stringify(googleEvent(e)),
    });
  }
  async cancelEvent(t: TokenSet, id: string) {
    await providerFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=all`, { method: "DELETE", headers: bearer(t.accessToken) });
  }

  publishPost = unsupported;
  schedulePost = async () => null;
  getPost = async () => null;
  getPosts = async () => [];
  getMetrics = async () => null;
  getAccountMetrics = async () => null;
}

function googleEvent(e: CalendarEventInput) {
  return {
    summary: e.title,
    description: e.description ?? "",
    start: { dateTime: e.start.toISOString(), timeZone: e.timezone },
    end: { dateTime: e.end.toISOString(), timeZone: e.timezone },
    attendees: e.attendees.map((email) => ({ email })),
  };
}

/** Google returns granted scopes space-separated, sometimes with the full "userinfo" URL aliases. */
export function normalizeGoogleScopes(scope?: string | null) {
  const map: Record<string, string> = { "https://www.googleapis.com/auth/userinfo.email": "email", "https://www.googleapis.com/auth/userinfo.profile": "profile" };
  return [...new Set((scope ?? "").split(/\s+/).filter(Boolean).map((s) => map[s] ?? s))];
}
