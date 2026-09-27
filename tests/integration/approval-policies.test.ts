import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { makeTenant } from "../support/factory";
import { contentNeedsApproval, DEFAULT_POLICIES, loadPolicies, parsePolicies, salesReplyPolicy } from "@/server/approvals/policies";
import { messageDisposition } from "@/server/sales/service";

describe("approval policies (business language)", () => {
  const auto = { ...DEFAULT_POLICIES, salesAutoReply: true, messages: { autoReplyFaq: true, safeIntents: ["opening_hours", "location"] as ("opening_hours" | "location")[] } };

  it("pricing, discounts, proposals and contract language always need a human", () => {
    for (const topic of ["discount", "custom_pricing", "proposal", "contract_promise"]) expect(salesReplyPolicy(auto, { sensitiveTopics: [topic] }).decision).toBe("approval");
    expect(salesReplyPolicy(auto, { sensitiveTopics: [], intent: "pricing", inbound: true }).decision).toBe("approval");
    expect(salesReplyPolicy(auto, { sensitiveTopics: [] }).decision).toBe("auto");
  });

  it("auto-replies to customer messages only for the safe FAQ intents chosen", () => {
    expect(salesReplyPolicy(auto, { sensitiveTopics: [], intent: "opening_hours", inbound: true })).toEqual({ decision: "auto", reason: "messages:safe_faq:opening_hours" });
    expect(salesReplyPolicy(auto, { sensitiveTopics: [], intent: "services_info", inbound: true }).decision).toBe("approval");
    expect(salesReplyPolicy(auto, { sensitiveTopics: [], intent: "complaint", inbound: true }).decision).toBe("approval");
    expect(salesReplyPolicy(auto, { sensitiveTopics: [], intent: null, inbound: true }).decision).toBe("approval");
    expect(salesReplyPolicy({ ...auto, messages: { ...auto.messages, autoReplyFaq: false } }, { sensitiveTopics: [], intent: "opening_hours", inbound: true }).decision).toBe("approval");
  });

  it("content: always ask, or auto-publish only the selected types; bad stored JSON falls back safely", () => {
    expect(contentNeedsApproval(DEFAULT_POLICIES, "POST")).toBe(true);
    const p = { ...DEFAULT_POLICIES, content: { mode: "auto_selected" as const, autoFormats: ["STORY" as const] } };
    expect(contentNeedsApproval(p, "STORY")).toBe(false);
    expect(contentNeedsApproval(p, "POST")).toBe(true);
    expect(parsePolicies({ content: { mode: "yolo" }, messages: "x" })).toEqual(DEFAULT_POLICIES);
  });

  it("older workspaces with approvals switched off keep auto-publishing", async () => {
    const t = await makeTenant();
    await db.workspaceSettings.updateMany({ where: t.scope, data: { requireContentApproval: false } });
    const p = await loadPolicies(t.scope);
    expect(contentNeedsApproval(p, "REEL")).toBe(false);
  });

  it("the Sales Agent's disposition follows the policies", async () => {
    const t = await makeTenant();
    // COPILOT + routine replies allowed (send_message rule off).
    await db.approvalPolicy.updateMany({ where: { ...t.scope, action: "send_message" }, data: { requiresApproval: false } });
    expect(await messageDisposition(t.scope, [])).toBe("send");
    // No row for "proposal" in older workspaces → approval (safe default) — and it's locked anyway.
    expect(await messageDisposition(t.scope, ["proposal"])).toBe("approval");
    // A customer asked something: FAQ auto-replies are off by default → a human approves.
    expect(await messageDisposition(t.scope, [], "send_first_reply", { intent: "opening_hours", inbound: true })).toBe("approval");
    await db.workspaceSettings.updateMany({ where: t.scope, data: { policies: { messages: { autoReplyFaq: true, safeIntents: ["opening_hours"] } } } });
    expect(await messageDisposition(t.scope, [], "send_first_reply", { intent: "opening_hours", inbound: true })).toBe("send");
    expect(await messageDisposition(t.scope, [], "send_first_reply", { intent: "pricing", inbound: true })).toBe("approval");
    // Sales auto-reply off → everything waits.
    await db.approvalPolicy.updateMany({ where: { ...t.scope, action: "send_message" }, data: { requiresApproval: true } });
    expect(await messageDisposition(t.scope, [])).toBe("approval");
  });
});
