import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { makeTenant } from "../support/factory";
import { attributionFrom, attributionReport, tagOwnLinks, trackedUrl } from "@/server/analytics/attribution";
import { captureLead } from "@/server/sales/capture";
import { createLead } from "@/server/sales/service";

describe("attribution", () => {
  it("tags only links to the company's own site and keeps existing UTM values", () => {
    const caption = "Book now: https://www.acme.test/offer. Partner: https://other.test/x and https://shop.acme.test/?utm_source=keep";
    const out = tagOwnLinks(caption, "acme.test", { platform: "LINKEDIN", campaign: "Ramadan Launch", contentItemId: "cabc" });
    expect(out).toContain("https://www.acme.test/offer?utm_source=linkedin&utm_medium=social&utm_campaign=ramadan-launch&utm_content=cabc.");
    expect(out).toContain("https://other.test/x ");
    expect(out).toContain("utm_source=keep");
    expect(out).not.toContain("utm_source=linkedin&utm_source");
    expect(tagOwnLinks(caption, null, { platform: "X", contentItemId: "c" })).toBe(caption);
    expect(trackedUrl("javascript:alert(1)", { platform: "X", contentItemId: "c" })).toBe("javascript:alert(1)");
  });

  it("resolves the post from a tagged link and ignores ids from another workspace", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const item = await db.contentItem.create({ data: { ...a.scope, title: "Offer", caption: "x", format: "POST", platform: "LINKEDIN", status: "PUBLISHED" } });
    const acct = await db.integration.create({ data: { ...a.scope, provider: "LINKEDIN", status: "CONNECTED" } });
    const account = await db.integrationAccount.create({ data: { ...a.scope, integrationId: acct.id, platform: "LINKEDIN", externalId: "urn:li:person:1", name: "Me" } });
    const post = await db.socialPost.create({ data: { ...a.scope, integrationAccountId: account.id, contentItemId: item.id, platform: "LINKEDIN", externalId: "urn:li:share:1", format: "POST", publishedAt: new Date() } });

    const own = await attributionFrom(a.scope, { utm_source: "linkedin", utm_medium: "social", utm_campaign: "launch", utm_content: item.id, page: "https://acme.test/offer" });
    expect(own).toMatchObject({ contentItemId: item.id, socialPostId: post.id, utmCampaign: "launch", landingUrl: "https://acme.test/offer" });

    const foreign = await attributionFrom(b.scope, { utm_source: "linkedin", utm_content: item.id, nova_post: post.id, page: "javascript:alert(1)" });
    expect(foreign).toMatchObject({ contentItemId: null, socialPostId: null, landingUrl: null, utmSource: "linkedin" });
  });

  it("stores attribution from the public form and reports the funnel from real values only", async () => {
    const t = await makeTenant();
    const form = await db.leadCaptureForm.create({ data: { ...t.scope, publicKey: `pk_${t.workspace.id}`, name: "Website", fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }] } });
    const res = await captureLead(form.publicKey, { name: "Nour", email: "nour@customer.test", utm_source: "instagram", utm_medium: "social", utm_campaign: "Summer" }, { ip: "203.0.113.9", origin: null, appUrl: "http://localhost:3000" });
    expect(res.ok).toBe(true);
    const lead = await db.lead.findFirstOrThrow({ where: { ...t.scope, email: "nour@customer.test" } });
    expect(lead).toMatchObject({ utmSource: "instagram", medium: "social", utmCampaign: "Summer" });

    await db.lead.update({ where: { id: lead.id }, data: { stage: "WON", estimatedValueCents: 250_000 } });
    const noValue = await createLead(t.scope, { name: "Kareem", attribution: { utmCampaign: "summer" } }, { type: "SYSTEM" }, { qualify: false });
    await db.lead.update({ where: { id: noValue.id }, data: { stage: "WON" } });
    await createLead(t.scope, { name: "Direct" }, { type: "SYSTEM" }, { qualify: false });

    const r = await attributionReport(t.scope);
    const summer = r.rows.find((x) => x.key === "u:summer")!;
    expect(summer).toMatchObject({ leads: 2, opportunities: 2, won: 2, revenueCents: 250_000, wonWithoutValue: 1 });
    expect(r.rows.at(-1)!.key).toBe("none");
    expect(r.totals).toMatchObject({ leads: 3, attributed: 2, won: 2, revenueCents: 250_000 });
    expect(r.currency).toBe("USD");
  });

  it("reports no revenue at all when no won deal has a value", async () => {
    const t = await makeTenant();
    const l = await createLead(t.scope, { name: "A" }, { type: "SYSTEM" }, { qualify: false });
    await db.lead.update({ where: { id: l.id }, data: { stage: "WON" } });
    const r = await attributionReport(t.scope);
    expect(r.totals.revenueCents).toBeNull();
    expect(r.currency).toBeNull();
  });
});
