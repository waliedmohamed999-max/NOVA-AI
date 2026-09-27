import type { Metadata } from "next";
import { requireTenant } from "@/server/context";
import { db } from "@/server/db/client";
import { aiAvailability, contentAiConfigured } from "@/server/ai";
import { imagesConfigured, imageUsage } from "@/server/studio/images";
import { ContentAiSettings } from "@/features/settings/content-ai";
import { AiTeamSettings } from "@/features/settings/sections";

export const metadata: Metadata = { title: "AI Team settings" };

export default async function AiSettingsPage() {
  const ctx = await requireTenant();
  const [s, weekly] = await Promise.all([
    ctx.db.workspaceSettings.findFirst(),
    db.scheduledJob.findUnique({
      where: { key: `agent:weekly_plan:${ctx.workspace.id}` },
    }),
  ]);
  const ai = aiAvailability();
  const usage = await imageUsage(ctx.organization.id);
  return (
    <div className="space-y-6">
      <AiTeamSettings
        canEdit={ctx.can("agents:configure")}
        provider={{
          configured: ai.configured,
          offline: ai.offline,
          names: ai.providers,
        }}
        initial={{
          salesAutonomy: s?.salesAutonomy ?? "COPILOT",
          autopilotAllowedTasks: s?.autopilotAllowedTasks ?? [],
          requireContentApproval: s?.requireContentApproval ?? true,
          weeklyAutoPlan: weekly?.enabled ?? false,
          dailyBriefHour: s?.dailyBriefHour ?? 8,
        }}
      />
      <ContentAiSettings
        canEdit={ctx.can("agents:configure")}
        status={{ text: contentAiConfigured(), image: imagesConfigured() }}
        usage={{
          images: usage.used,
          limit: usage.limit,
          edits: usage.edits,
          textRuns: usage.textRuns,
          costUsd: Number(usage.estimatedCostMicro) / 1_000_000,
        }}
        initial={{
          imageQuality: s?.imageQuality === "quality" ? "quality" : "fast",
          imageMode:
            s?.imageMode === "ai_creative" ? "ai_creative" : "brand_template",
        }}
      />
    </div>
  );
}
