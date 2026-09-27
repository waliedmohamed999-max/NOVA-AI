import type { LeadStage, SocialPlatform } from "@/generated/prisma/enums";
import { db } from "../db/client";
import type { TenantScope } from "../db/tenant";
import type { LeadAttribution } from "../sales/service";

/**
 * Attribution: campaign → post → click (UTM / tracked link) → lead → opportunity → deal.
 * Nothing is inferred: a lead is attributed only by what arrived with it, and revenue is summed only from
 * deals that have a recorded value.
 */

/** Adds NOVA's tracking parameters to a link placed in a post. Existing UTM parameters are kept. */
export function trackedUrl(link: string, t: { platform: string; campaign?: string | null; contentItemId: string; socialPostId?: string | null }) {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return link;
  }
  if (!/^https?:$/.test(u.protocol)) return link;
  const set = (k: string, v: string | null | undefined) => {
    if (v && !u.searchParams.has(k)) u.searchParams.set(k, v);
  };
  set("utm_source", t.platform.toLowerCase());
  set("utm_medium", "social");
  set("utm_campaign", t.campaign ? slug(t.campaign) : null);
  set("utm_content", t.contentItemId);
  set("nova_post", t.socialPostId ?? null);
  return u.toString();
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60);
const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/**
 * Builds a lead's attribution from submitted parameters. Post / content ids are only kept when they belong
 * to this workspace (a visitor can put anything in a URL).
 */
export async function attributionFrom(scope: TenantScope, input: Record<string, unknown>): Promise<LeadAttribution> {
  const utmContent = str(input.utm_content);
  const novaPost = str(input.nova_post, 40);
  const [content, tagged] = await Promise.all([
    utmContent && /^c[a-z0-9]{20,32}$/.test(utmContent) ? db.contentItem.findFirst({ where: { ...scope, id: utmContent }, select: { id: true } }) : null,
    novaPost ? db.socialPost.findFirst({ where: { ...scope, id: novaPost }, select: { id: true, contentItemId: true } }) : null,
  ]);
  // Links tagged at publish time carry the content id + platform; resolve the exact social post from them.
  const platform = str(input.utm_source, 40)?.toUpperCase();
  const post =
    tagged ??
    (content && platform && /^[A-Z]{2,12}$/.test(platform)
      ? await db.socialPost.findFirst({ where: { ...scope, contentItemId: content.id, platform: platform as SocialPlatform }, orderBy: { publishedAt: "desc" }, select: { id: true, contentItemId: true } })
      : null);
  let landingUrl = str(input.page, 500);
  if (landingUrl && !/^https?:\/\//i.test(landingUrl)) landingUrl = null;
  return {
    utmSource: str(input.utm_source, 100),
    medium: str(input.utm_medium, 100),
    utmCampaign: str(input.utm_campaign, 150),
    utmContent,
    contentItemId: content?.id ?? post?.contentItemId ?? null,
    socialPostId: post?.id ?? null,
    landingUrl,
  };
}

const OPPORTUNITY: LeadStage[] = ["QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON"];

export type AttributionRow = { key: string; label: string; campaignId: string | null; leads: number; opportunities: number; won: number; revenueCents: number | null; wonWithoutValue: number };

/** Funnel by campaign (linked campaign, else utm_campaign, else "unattributed") for leads created in the window. */
export async function attributionReport(scope: TenantScope, days = 90) {
  const since = new Date(Date.now() - days * 86_400_000);
  const leads = await db.lead.findMany({
    where: { ...scope, createdAt: { gte: since } },
    select: { stage: true, estimatedValueCents: true, currency: true, campaignId: true, utmCampaign: true, utmSource: true, socialPostId: true, contentItemId: true, campaign: { select: { name: true } } },
  });
  const rows = new Map<string, AttributionRow>();
  const currencies = new Set<string>();
  for (const l of leads) {
    const key = l.campaignId ? `c:${l.campaignId}` : l.utmCampaign ? `u:${l.utmCampaign.toLowerCase()}` : "none";
    const label = l.campaign?.name ?? l.utmCampaign ?? "";
    const r = rows.get(key) ?? { key, label, campaignId: l.campaignId, leads: 0, opportunities: 0, won: 0, revenueCents: null, wonWithoutValue: 0 };
    r.leads++;
    if (OPPORTUNITY.includes(l.stage)) r.opportunities++;
    if (l.stage === "WON") {
      r.won++;
      if (l.estimatedValueCents != null) {
        r.revenueCents = (r.revenueCents ?? 0) + l.estimatedValueCents;
        currencies.add(l.currency);
      } else r.wonWithoutValue++;
    }
    rows.set(key, r);
  }
  const list = [...rows.values()].sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : b.leads - a.leads));
  const fromPosts = leads.filter((l) => l.socialPostId || l.contentItemId).length;
  return {
    rows: list,
    totals: {
      leads: leads.length,
      attributed: leads.filter((l) => l.campaignId || l.utmCampaign || l.utmSource || l.socialPostId).length,
      fromPosts,
      opportunities: list.reduce((a, r) => a + r.opportunities, 0),
      won: list.reduce((a, r) => a + r.won, 0),
      revenueCents: list.some((r) => r.revenueCents != null) ? list.reduce((a, r) => a + (r.revenueCents ?? 0), 0) : null,
    },
    // Several currencies can't be summed honestly; the UI shows "mixed currencies" instead of a total.
    currency: currencies.size === 1 ? [...currencies][0] : currencies.size === 0 ? null : "MIXED",
  };
}

/**
 * Adds tracking to links in a caption that point at the company's own website (other sites are left
 * untouched). The social post id doesn't exist yet at publish time; utm_content + utm_source identify it.
 */
export function tagOwnLinks(caption: string, website: string | null | undefined, t: { platform: string; campaign?: string | null; contentItemId: string }) {
  if (!website) return caption;
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, "");
  } catch {
    return caption;
  }
  return caption.replace(/https?:\/\/[^\s<>"')\]]+/gi, (m) => {
    const trail = /[.,!?;:]+$/.exec(m)?.[0] ?? "";
    const link = trail ? m.slice(0, -trail.length) : m;
    try {
      const h = new URL(link).hostname.replace(/^www\./, "");
      return h === host || h.endsWith(`.${host}`) ? trackedUrl(link, t) + trail : m;
    } catch {
      return m;
    }
  });
}
