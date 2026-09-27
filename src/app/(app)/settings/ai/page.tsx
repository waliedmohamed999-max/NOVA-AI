import type { Metadata } from "next";
import { requireTenant } from "@/server/context";
import { db } from "@/server/db/client";
import { aiAvailability } from "@/server/ai";
import { AiTeamSettings } from "@/features/settings/sections";

export const metadata: Metadata = { title: "AI Team settings" };

export default async function AiSettingsPage() {
  const ctx = await requireTenant();
  const [s, weekly] = await Promise.all([ctx.db.workspaceSettings.findFirst(), db.scheduledJob.findUnique({ where: { key: `agent:weekly_plan:${ctx.workspace.id}` } })]);
  const ai = aiAvailability();
  return (
    <AiTeamSettings
      canEdit={ctx.can("agents:configure")}
      provider={{ configured: ai.configured, offline: ai.offline, names: ai.providers }}
      initial={{
        salesAutonomy: s?.salesAutonomy ?? "COPILOT",
        autopilotAllowedTasks: s?.autopilotAllowedTasks ?? [],
        requireContentApproval: s?.requireContentApproval ?? true,
        weeklyAutoPlan: weekly?.enabled ?? false,
        dailyBriefHour: s?.dailyBriefHour ?? 8,
      }}
    />
  );
}
