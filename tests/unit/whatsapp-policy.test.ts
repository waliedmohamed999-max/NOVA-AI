import { describe, expect, it } from "vitest";
import { classifyIntent, decideReply, isOptOut, renderTemplate, templateVariables, variablesSequential, windowState } from "@/server/whatsapp/policy";
import { dailyCap } from "@/server/whatsapp/campaigns";
import { normalizePhone, validPhone } from "@/server/whatsapp/cloud-api";

describe("WhatsApp policy (pure rules)", () => {
  it("classifies intents locally, sensitive before safe (AR + EN)", () => {
    expect(classifyIntent("What are your working hours?")).toBe("opening_hours");
    expect(classifyIntent("متى تفتحون؟")).toBe("opening_hours");
    expect(classifyIntent("وين موقعكم")).toBe("location");
    expect(classifyIntent("كم سعر الباقة؟")).toBe("pricing");
    expect(classifyIntent("ممكن خصم على السعر؟")).toBe("discount");
    expect(classifyIntent("I want a refund")).toBe("refund");
    expect(classifyIntent("عندي شكوى")).toBe("complaint");
    expect(classifyIntent("السلام عليكم")).toBe("greeting");
    expect(classifyIntent("STOP")).toBe("opt_out");
    expect(classifyIntent("إلغاء")).toBe("opt_out");
    expect(classifyIntent("please stop sending the invoice twice")).not.toBe("opt_out"); // only an exact command opts out
    expect(isOptOut("unsub", ["UNSUB"])).toBe(true);
  });

  it("24h window from the customer's last message", () => {
    const now = new Date("2026-09-29T12:00:00Z");
    expect(windowState(new Date("2026-09-29T00:00:00Z"), now).open).toBe(true);
    expect(windowState(new Date("2026-09-28T11:59:00Z"), now).open).toBe(false);
    expect(windowState(null, now).open).toBe(false);
  });

  it("auto-reply levels: only brain answers to safe intents inside the window are ever sent automatically", () => {
    const base = { windowOpen: true, optedOut: false } as const;
    expect(decideReply({ ...base, level: "SAFE_AUTO", intent: "opening_hours", answer: "brain" }).action).toBe("auto_send");
    expect(decideReply({ ...base, level: "SAFE_AUTO", intent: "opening_hours", answer: "ai" }).action).toBe("draft"); // AI text is reviewed
    expect(decideReply({ ...base, level: "SAFE_AUTO", intent: "pricing", answer: "brain" })).toMatchObject({ action: "draft", needsHuman: true });
    expect(decideReply({ ...base, level: "SAFE_AUTO", intent: "discount", answer: "brain" }).action).toBe("draft");
    expect(decideReply({ ...base, level: "SAFE_AUTO", intent: "opening_hours", answer: "brain", windowOpen: false }).action).toBe("draft");
    expect(decideReply({ ...base, level: "SAFE_AUTO", intent: "location", answer: "brain", safeIntents: ["opening_hours"] }).action).toBe("draft");
    expect(decideReply({ ...base, level: "DRAFT", intent: "opening_hours", answer: "brain" }).action).toBe("draft");
    expect(decideReply({ ...base, level: "OFF", intent: "opening_hours", answer: "brain" }).action).toBe("none");
    expect(decideReply({ ...base, level: "CUSTOM", intent: "opening_hours", answer: "brain", policyAllowsAuto: false }).action).toBe("draft");
    expect(decideReply({ ...base, level: "CUSTOM", intent: "opening_hours", answer: "brain", policyAllowsAuto: true }).action).toBe("auto_send");
    expect(decideReply({ ...base, level: "CUSTOM", intent: "refund", answer: "brain", policyAllowsAuto: true }).action).toBe("draft");
    expect(decideReply({ ...base, level: "SAFE_AUTO", intent: "opening_hours", answer: "brain", optedOut: true }).action).toBe("none");
  });

  it("template variables and preview", () => {
    expect(templateVariables("Hi {{1}}, your {{2}} at {{ 3 }}")).toEqual([1, 2, 3]);
    expect(variablesSequential("Hi {{1}} and {{3}}")).toBe(false);
    expect(renderTemplate("Hi {{1}}, total {{2}}", ["Sara", "SAR 500"])).toBe("Hi Sara, total SAR 500");
  });

  it("phones and messaging tiers", () => {
    expect(normalizePhone("+966 (50) 123-4567")).toBe("966501234567");
    expect(validPhone("966501234567")).toBe(true);
    expect(validPhone("0501234567")).toBe(false);
    expect(validPhone("123")).toBe(false);
    expect(dailyCap("TIER_1K")).toBe(1000);
    expect(dailyCap("TIER_250")).toBe(250);
    expect(dailyCap(null)).toBe(250);
    expect(dailyCap("TIER_UNLIMITED")).toBe(1_000_000);
  });
});
