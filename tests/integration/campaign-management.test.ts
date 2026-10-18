import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { campaignPerformance, setCampaignStatus, updateCampaign } from "@/server/campaigns/service";
import { publishDue } from "@/server/social/publishing";
import { makeTenant } from "../support/factory";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;
const actor = (t: Tenant) => ({ userId: t.user.id, label: "Owner" });

const campaign = (t: Tenant, status: "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "PAUSED" = "ACTIVE", channel = "social") =>
  db.campaign.create({ data: { ...t.scope, name: "Ramadan Glow", objective: "Sell the gift box", status, channel, channels: ["LINKEDIN"] } });

/** A scheduled, approved post of the campaign that is due now (no connected account, so publishing fails fast). */
async function duePost(t: Tenant, campaignId: string) {
  const item = await db.contentItem.create({ data: { ...t.scope, campaignId, platform: "LINKEDIN", title: "Gift box", caption: "Our Ramadan box", status: "SCHEDULED", scheduledAt: new Date(Date.now() - 60_000) } });
  const pub = await db.socialPublication.create({ data: { ...t.scope, contentItemId: item.id, platform: "LINKEDIN", scheduledFor: new Date(Date.now() - 60_000) } });
  return { item, pub };
}

describe("campaign management", () => {
  it("only allows sensible status changes (never draft → active without approval)", async () => {
    const t = await makeTenant("Status Co");
    const draft = await campaign(t, "DRAFT");
    await expect(setCampaignStatus(t.scope, draft.id, "ACTIVE", actor(t))).rejects.toMatchObject({ code: "invalid_transition" });
    await expect(setCampaignStatus(t.scope, draft.id, "COMPLETED", actor(t))).rejects.toMatchObject({ code: "invalid_transition" });

    const live = await campaign(t, "ACTIVE");
    await setCampaignStatus(t.scope, live.id, "PAUSED", actor(t));
    await setCampaignStatus(t.scope, live.id, "ACTIVE", actor(t));
    await setCampaignStatus(t.scope, live.id, "COMPLETED", actor(t));
    await expect(setCampaignStatus(t.scope, live.id, "ACTIVE", actor(t))).rejects.toMatchObject({ code: "invalid_transition" });
    await setCampaignStatus(t.scope, live.id, "ARCHIVED", actor(t));
    expect((await db.campaign.findUniqueOrThrow({ where: { id: live.id } })).status).toBe("ARCHIVED");

    const wa = await campaign(t, "ACTIVE", "whatsapp");
    await expect(setCampaignStatus(t.scope, wa.id, "PAUSED", actor(t))).rejects.toMatchObject({ code: "invalid_transition" });
  });

  it("a paused campaign holds its scheduled posts until it's resumed", async () => {
    const t = await makeTenant("Hold Co");
    const c = await campaign(t, "ACTIVE");
    const { pub } = await duePost(t, c.id);
    await setCampaignStatus(t.scope, c.id, "PAUSED", actor(t));

    await publishDue();
    const held = await db.socialPublication.findUniqueOrThrow({ where: { id: pub.id } });
    expect(held.status).toBe("PENDING");
    expect(held.attempts).toBe(0);

    await setCampaignStatus(t.scope, c.id, "ACTIVE", actor(t));
    await publishDue();
    // Resumed: the publisher picks it up again (it fails here only because no account is connected).
    expect((await db.socialPublication.findUniqueOrThrow({ where: { id: pub.id } })).status).toBe("FAILED");
  });

  it("edits the brief, validates dates and keeps archived campaigns read-only", async () => {
    const t = await makeTenant("Edit Co");
    const c = await campaign(t, "ACTIVE");
    await updateCampaign(t.scope, c.id, { name: "Eid Glow", objective: "Sell 200 boxes", offer: "15% off", startDate: "2026-10-01", endDate: "2026-10-31", budget: 1500, currency: "sar" }, actor(t));
    const after = await db.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(after).toMatchObject({ name: "Eid Glow", objective: "Sell 200 boxes", offer: "15% off", budgetCents: 150000, currency: "SAR" });

    await expect(updateCampaign(t.scope, c.id, { name: "x", objective: "y", startDate: "2026-10-31", endDate: "2026-10-01" }, actor(t))).rejects.toThrow();
    await setCampaignStatus(t.scope, c.id, "ARCHIVED", actor(t));
    await expect(updateCampaign(t.scope, c.id, { name: "z", objective: "z" }, actor(t))).rejects.toMatchObject({ code: "invalid_transition" });

    const other = await makeTenant("Other Co");
    await expect(updateCampaign(other.scope, c.id, { name: "hijack", objective: "x" }, actor(other))).rejects.toThrow();
  });

  it("reports reach and leads week by week", async () => {
    const t = await makeTenant("Perf Co");
    const c = await campaign(t, "ACTIVE");
    const now = new Date("2026-10-15T12:00:00Z");
    const item = await db.contentItem.create({ data: { ...t.scope, campaignId: c.id, platform: "LINKEDIN", title: "Post", caption: "c", status: "PUBLISHED" } });
    const post = await db.socialPost.create({ data: { ...t.scope, contentItemId: item.id, platform: "LINKEDIN", externalId: "p1", publishedAt: new Date("2026-10-06T10:00:00Z") } });
    await db.socialMetric.create({ data: { ...t.scope, socialPostId: post.id, reach: 1200, engagementRate: 0.05 } });
    await db.lead.create({ data: { ...t.scope, name: "From campaign", channel: "WEBSITE", campaignId: c.id, createdAt: new Date("2026-10-14T09:00:00Z") } });

    const perf = await campaignPerformance(t.scope, c.id, now);
    expect(perf.hasData).toBe(true);
    const byWeek = Object.fromEntries(perf.weeks.map((w) => [w.start.toISOString().slice(0, 10), w]));
    expect(byWeek["2026-10-05"]).toMatchObject({ reach: 1200, posts: 1, leads: 0, engagement: 0.05 });
    expect(byWeek["2026-10-12"]).toMatchObject({ reach: 0, posts: 0, leads: 1 });
  });
});
