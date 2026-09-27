import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/generated/prisma/enums";
import { db } from "@/server/db/client";
import { tenantDb } from "@/server/db/tenant";
import { can } from "@/server/rbac";
import { makeTenant } from "../support/factory";

/**
 * Security retest of this phase's new surfaces, through the real server actions (tenantAction wrapper):
 * RBAC, locked approval rules, IDOR on meetings/slides/policies, admin-only actions.
 * Session/tenant resolution is mocked to act as a given member.
 */
type Actor = { userId: string; orgId: string; wsId: string; role: Role; admin?: boolean };
let actor: Actor | null = null;

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/server/auth/session", () => ({
  getSession: async () => (actor ? { userId: actor.userId, id: "sess", user: { id: actor.userId, isPlatformAdmin: Boolean(actor.admin), email: "x@test", name: "X" } } : null),
}));
vi.mock("@/server/context", () => ({
  resolveTenant: async () => {
    if (!actor) return null;
    const a = actor;
    return {
      user: { id: a.userId, email: "x@test", name: "X", locale: "en", isPlatformAdmin: Boolean(a.admin), emailVerifiedAt: new Date() },
      sessionId: "sess",
      organization: { id: a.orgId, name: "Org", slug: "org", onboardingStatus: "COMPLETED", timezone: "UTC", locale: "en", isDemo: false },
      workspace: { id: a.wsId, name: "WS" },
      role: a.role,
      db: tenantDb({ organizationId: a.orgId, workspaceId: a.wsId }),
      can: (p: Parameters<typeof can>[1]) => can(a.role, p),
    };
  },
}));

/** The error code of an action result (undefined when it succeeded). */
const errOf = (r: { ok: boolean }) => (r as { error?: string }).error;

const as = (t: Awaited<ReturnType<typeof makeTenant>>, role: Role, admin = false): Actor => ({ userId: t.user.id, orgId: t.organization.id, wsId: t.workspace.id, role, admin });

beforeEach(() => {
  actor = null;
});

describe("security retest — server actions", () => {
  it("unauthenticated calls are refused", async () => {
    const { savePolicies } = await import("@/features/settings/actions");
    expect(await savePolicies({ content: { mode: "auto_selected", autoFormats: ["POST"] }, messages: { autoReplyFaq: true, safeIntents: ["greeting"] } })).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("RBAC: a VIEWER can't change approval policies, book meetings or generate carousels", async () => {
    const t = await makeTenant();
    actor = as(t, "VIEWER");
    const { savePolicies, saveApprovalPolicy } = await import("@/features/settings/actions");
    const { proposeMeetingSlots } = await import("@/features/sales/actions");
    const { generateCarouselAction } = await import("@/features/content/studio-actions");
    expect(errOf(await savePolicies({ content: { mode: "auto_selected", autoFormats: ["POST"] }, messages: { autoReplyFaq: true, safeIntents: ["greeting"] } }))).toBe("forbidden");
    expect(errOf(await saveApprovalPolicy({ action: "send_message", requiresApproval: false }))).toBe("forbidden");
    expect(errOf(await proposeMeetingSlots({ leadId: "x" }))).toBe("forbidden");
    expect(errOf(await generateCarouselAction({ id: "x", slides: 5 }))).toBe("forbidden");
  });

  it("approval bypass: pricing / discount / proposal / contract rules can't be switched off, even by the owner", async () => {
    const t = await makeTenant();
    actor = as(t, "OWNER");
    const { saveApprovalPolicy } = await import("@/features/settings/actions");
    for (const action of ["discount", "custom_pricing", "proposal", "contract_promise"] as const) {
      expect(await saveApprovalPolicy({ action, requiresApproval: false })).toEqual({ ok: false, error: "policy_locked" });
    }
    // Arbitrary action names are rejected by validation (no free-form policy keys).
    expect(errOf(await saveApprovalPolicy({ action: "anything" as never, requiresApproval: false }))).toBe("validation");
    expect((await saveApprovalPolicy({ action: "refund", requiresApproval: false })).ok).toBe(true);
  });

  it("policies JSON is schema-validated (no arbitrary keys or intents)", async () => {
    const t = await makeTenant();
    actor = as(t, "OWNER");
    const { savePolicies } = await import("@/features/settings/actions");
    expect(errOf(await savePolicies({ content: { mode: "always", autoFormats: [] }, messages: { autoReplyFaq: true, safeIntents: ["pricing" as never] } }))).toBe("validation");
    expect((await savePolicies({ content: { mode: "always", autoFormats: [] }, messages: { autoReplyFaq: false, safeIntents: [] } })).ok).toBe(true);
    const s = await db.workspaceSettings.findFirstOrThrow({ where: { workspaceId: t.workspace.id } });
    expect(s.requireContentApproval).toBe(true);
  });

  it("IDOR: another workspace's meeting and slide ids are not found through the actions", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const lead = await db.lead.create({ data: { ...a.scope, name: "L", email: "l@x.test" } });
    const meeting = await db.meeting.create({ data: { ...a.scope, leadId: lead.id, title: "Intro", proposedSlots: [{ start: "2030-01-01T10:00:00.000Z", end: "2030-01-01T10:30:00.000Z" }] } });
    const item = await db.contentItem.create({ data: { ...a.scope, title: "C", caption: "x", format: "CAROUSEL", platform: "INSTAGRAM", status: "DRAFT" } });
    const slide = await db.carouselSlide.create({ data: { ...a.scope, contentItemId: item.id, position: 1, headline: "H" } });
    actor = as(b, "OWNER");
    const { bookMeetingSlot, cancelLeadMeeting } = await import("@/features/sales/actions");
    const { editSlideAction, restoreSlideAction } = await import("@/features/content/studio-actions");
    expect((await bookMeetingSlot({ meetingId: meeting.id, start: "2030-01-01T10:00:00.000Z" })).ok).toBe(false);
    expect((await cancelLeadMeeting({ meetingId: meeting.id })).ok).toBe(false);
    expect(errOf(await editSlideAction({ slideId: slide.id, slide: { headline: "pwned", body: "", visualDirection: "" } }))).toBe("item_not_found");
    expect(errOf(await restoreSlideAction({ slideId: slide.id, version: 1 }))).toBe("item_not_found");
    expect((await db.carouselSlide.findUniqueOrThrow({ where: { id: slide.id } })).headline).toBe("H");
    expect((await db.meeting.findUniqueOrThrow({ where: { id: meeting.id } })).status).toBe("PROPOSED");
  });

  it("admin-only actions refuse non-admins (provider validation, storage test, WhatsApp link)", async () => {
    const t = await makeTenant();
    actor = as(t, "OWNER", false);
    const { validateProviderAction, storageTestAction, linkWhatsAppNumberAction, openAiTestImageEditAction, instagramFeatureTestAction } = await import("@/features/admin/actions");
    expect(await validateProviderAction({ provider: "openai" })).toEqual({ ok: false, error: "forbidden" });
    expect(await storageTestAction()).toEqual({ ok: false, error: "forbidden" });
    expect(await linkWhatsAppNumberAction({ phoneNumberId: "123456789" })).toEqual({ ok: false, error: "forbidden" });
    expect(await openAiTestImageEditAction()).toEqual({ ok: false, error: "forbidden" });
    expect(await instagramFeatureTestAction({ accountId: "x", feature: "insights" })).toEqual({ ok: false, error: "forbidden" });
    expect(await db.providerValidation.count({ where: { actorId: t.user.id } })).toBe(0);
  });

  it("admin provider validation input is allow-listed", async () => {
    const t = await makeTenant();
    actor = as(t, "OWNER", true);
    const { validateProviderAction } = await import("@/features/admin/actions");
    expect(errOf(await validateProviderAction({ provider: "http://169.254.169.254/" }))).toBe("validation");
  });

  it("billing: cancel/portal require billing:manage and a configured provider", async () => {
    const t = await makeTenant();
    actor = as(t, "MEMBER");
    const { cancelPlan, openBillingPortal } = await import("@/features/settings/actions");
    expect(errOf(await cancelPlan({ confirm: true }))).toBe("forbidden");
    actor = as(t, "OWNER");
    expect(errOf(await openBillingPortal({}))).toBe("billing_not_configured");
  });
});
