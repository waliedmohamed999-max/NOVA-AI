import { describe, expect, it } from "vitest";
import { forecast, guessMapping, leadSignals, leadValue, parseCsv, salesInsights, temperatureReasons, type SignalLead } from "@/server/sales/intelligence";

const now = new Date("2026-10-10T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const base: SignalLead = { stage: "QUALIFIED", temperature: "WARM", createdAt: daysAgo(1), stageChangedAt: daysAgo(1), lastContactAt: daysAgo(1), nextActionAt: null, openFollowUps: [], lastMessage: null };

describe("follow-up signals", () => {
  it("explains why a lead needs follow-up", () => {
    expect(leadSignals({ ...base, openFollowUps: [{ dueAt: daysAgo(2) }] }, now).map((s) => s.kind)).toEqual(["followup_overdue"]);
    expect(leadSignals({ ...base, lastMessage: { direction: "INBOUND", at: daysAgo(2) } }, now)[0]).toMatchObject({ kind: "unanswered_question", days: 2 });
    expect(leadSignals({ ...base, stage: "PROPOSAL", stageChangedAt: daysAgo(4), openFollowUps: [{ dueAt: daysAgo(-1) }] }, now).map((s) => s.kind)).toEqual(["proposal_no_response"]);
    expect(leadSignals({ ...base, temperature: "HOT" }, now).map((s) => s.kind)).toEqual(["hot_no_next_step"]);
    expect(leadSignals({ ...base, lastContactAt: daysAgo(6), openFollowUps: [{ dueAt: daysAgo(-2) }] }, now).map((s) => s.kind)).toEqual(["no_contact"]);
    expect(leadSignals({ ...base, stageChangedAt: daysAgo(20), openFollowUps: [{ dueAt: daysAgo(-2) }] }, now).map((s) => s.kind)).toEqual(["stalled"]);
  });

  it("a reply after the proposal clears 'no response'; closed leads have no signals", () => {
    expect(leadSignals({ ...base, stage: "PROPOSAL", stageChangedAt: daysAgo(5), lastMessage: { direction: "INBOUND", at: daysAgo(0.1) }, openFollowUps: [{ dueAt: daysAgo(-1) }] }, now)).toEqual([]);
    expect(leadSignals({ ...base, stage: "WON", openFollowUps: [{ dueAt: daysAgo(5) }] }, now)).toEqual([]);
    expect(leadSignals({ ...base, openFollowUps: [{ dueAt: daysAgo(-1) }] }, now)).toEqual([]);
  });
});

describe("temperature reasons", () => {
  it("lists explicit signals only", () => {
    expect(temperatureReasons({ scoreReasons: ["buying_intent", "business_email"], lastInboundAt: daysAgo(1), stage: "PROPOSAL", hasQuote: false, hasMeeting: true, inboundCount: 3, lastContactAt: daysAgo(1), createdAt: daysAgo(3), urgent: true, now })).toEqual(["recent_reply", "buying_intent", "quote_requested", "meeting", "urgency", "repeat_contact", "business_email"]);
    expect(temperatureReasons({ scoreReasons: [], lastInboundAt: null, stage: "NEW", hasQuote: false, hasMeeting: false, inboundCount: 0, lastContactAt: null, createdAt: daysAgo(20), urgent: false, now })).toEqual(["no_recent_activity"]);
  });
});

describe("value & forecast", () => {
  it("lead value: open opportunities first, then the lead's estimate, else unknown", () => {
    expect(leadValue({ estimatedValueCents: 100, currency: "SAR" }, [{ valueCents: 5000, currency: "SAR", status: "OPEN" }, { valueCents: null, currency: "SAR", status: "OPEN" }])).toEqual({ cents: 5000, currency: "SAR" });
    expect(leadValue({ estimatedValueCents: 100, currency: "SAR" }, [{ valueCents: null, currency: "SAR", status: "OPEN" }])).toEqual({ cents: 100, currency: "SAR" });
    expect(leadValue({ estimatedValueCents: null, currency: "SAR" }, [])).toBeNull();
  });

  it("weighted pipeline = value × stage probability; unknown values stay unknown", () => {
    const f = forecast(
      [
        { stage: "PROPOSAL", value: { cents: 10_000_00, currency: "SAR" } },
        { stage: "QUALIFIED", value: { cents: 4_000_00, currency: "SAR" } },
        { stage: "QUALIFIED", value: null },
        { stage: "NEW", value: { cents: 999, currency: "USD" } },
        { stage: "WON", value: { cents: 2_000_00, currency: "SAR" } },
        { stage: "WON", value: null },
        { stage: "LOST", value: { cents: 5_000_00, currency: "SAR" } },
      ],
      { PROPOSAL: 55, QUALIFIED: 35 },
      "SAR",
    );
    expect(f.pipeline).toEqual({ cents: 14_000_00, currency: "SAR" });
    expect(f.weighted).toEqual({ cents: 5_500_00 + 1_400_00, currency: "SAR" });
    expect(f.won).toEqual({ cents: 2_000_00, currency: "SAR" });
    expect(f).toMatchObject({ openCount: 4, openWithValue: 3, wonCount: 2, wonWithValue: 1, otherCurrencies: ["USD"] });
    const empty = forecast([{ stage: "NEW", value: null }], {}, "SAR");
    expect(empty).toMatchObject({ pipeline: null, weighted: null, won: null });
  });
});

describe("insights", () => {
  const lead = (id: string, over: Partial<Parameters<typeof salesInsights>[0][number]> = {}) => ({ id, stage: "QUALIFIED", temperature: "WARM", source: "Website", createdAt: daysAgo(3), stageChangedAt: daysAgo(3), value: null, signals: [], ...over });
  it("fire only when the data supports them", () => {
    expect(salesInsights([lead("a")], now)).toEqual([]);
    const stale = salesInsights([lead("a", { signals: [{ kind: "no_contact", days: 6, severity: "medium" }] })], now);
    expect(stale[0]).toMatchObject({ key: "stale_open", params: { count: 1, days: 5 }, leadIds: ["a"] });
    // Source concentration needs ≥5 qualified leads and ≥50% from one source.
    expect(salesInsights([1, 2, 3, 4].map((i) => lead(`l${i}`, { source: "LinkedIn" })), now).find((i) => i.key === "top_source")).toBeUndefined();
    const five = salesInsights([...[1, 2, 3].map((i) => lead(`l${i}`, { source: "LinkedIn" })), lead("x", { source: "Website" }), lead("y", { source: "Referral" })], now);
    expect(five.find((i) => i.key === "top_source")).toMatchObject({ params: { source: "LinkedIn", count: 3, total: 5 } });
  });

  it("high-value deals slower in Proposal only with ≥3 per group and a real gap", () => {
    const props = [1, 2, 3].map((i) => lead(`s${i}`, { stage: "PROPOSAL", value: { cents: i * 1000_00, currency: "SAR" }, stageChangedAt: daysAgo(2) })).concat([4, 5, 6].map((i) => lead(`b${i}`, { stage: "PROPOSAL", value: { cents: i * 10_000_00, currency: "SAR" }, stageChangedAt: daysAgo(9) })));
    expect(salesInsights(props, now).find((i) => i.key === "high_value_slower")).toMatchObject({ params: { threshold: 40000, highDays: 9, lowDays: 2 } });
    expect(salesInsights(props.slice(1), now).find((i) => i.key === "high_value_slower")).toBeUndefined();
  });
});

describe("CSV import helpers", () => {
  it("parses quotes, escaped quotes, CRLF, BOM and semicolons", () => {
    expect(parseCsv('﻿name,company,notes\r\n"Omar, Jr.",ACME,"said ""hi"""\r\n\r\nSara,,x')).toEqual([["name", "company", "notes"], ["Omar, Jr.", "ACME", 'said "hi"'], ["Sara", "", "x"]]);
    expect(parseCsv("الاسم;البريد\nعمر;o@x.test")).toEqual([["الاسم", "البريد"], ["عمر", "o@x.test"]]);
  });
  it("guesses column mappings in English and Arabic", () => {
    expect(guessMapping(["Full name", "Company", "E-mail", "Mobile", "Deal value", "Random"])).toEqual({ 0: "name", 1: "company", 2: "email", 3: "phone", 4: "value", 5: null });
    expect(guessMapping(["الاسم", "الشركة", "البريد الإلكتروني", "رقم الجوال"])).toEqual({ 0: "name", 1: "company", 2: "email", 3: "phone" });
  });
});
