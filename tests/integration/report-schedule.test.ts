import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { dueWorkspaces } from "@/server/reports/service";
import { makeTenant } from "../support/factory";

/** Weekly reports go out on the workspace's chosen day, at its brief hour, in its time zone — once. */
describe("report schedule", () => {
  it("is due only on the chosen weekday after the brief hour, and only once that week", async () => {
    const t = await makeTenant("Schedule Co");
    await db.organization.update({ where: { id: t.organization.id }, data: { onboardingStatus: "COMPLETED" } });
    await db.workspaceSettings.updateMany({ where: { workspaceId: t.workspace.id }, data: { timezone: "Asia/Riyadh", dailyBriefHour: 8, weeklyReportDay: 3 } });
    const due = async (iso: string) => (await dueWorkspaces("WEEKLY_REPORT", new Date(iso))).some((s) => s.workspaceId === t.workspace.id);

    expect(await due("2026-10-14T06:00:00Z")).toBe(true); // Wednesday 09:00 in Riyadh
    expect(await due("2026-10-14T04:00:00Z")).toBe(false); // Wednesday 07:00 — before the brief hour
    expect(await due("2026-10-15T06:00:00Z")).toBe(false); // Thursday

    await db.report.create({ data: { ...t.scope, kind: "WEEKLY_REPORT", periodStart: new Date("2026-10-07T00:00:00Z"), periodEnd: new Date("2026-10-14T06:00:00Z"), data: {}, generatedBy: "test", createdAt: new Date("2026-10-14T06:00:00Z") } });
    expect(await due("2026-10-14T09:00:00Z")).toBe(false); // already sent this week
  });
});
