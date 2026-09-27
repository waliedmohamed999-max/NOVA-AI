import type { Metadata } from "next";
import { requireTenant } from "@/server/context";
import { loadCommandCenter } from "@/server/home";
import { HomeCommandCenter } from "@/features/home/command-center";
import { AttentionPanel, DealsPanel, MessagesPanel, TodayPanel } from "@/features/home/rail";
import { DailyBriefCard, QuickActionsCard } from "@/features/home/bottom-cards";

export const metadata: Metadata = { title: "Home" };

/**
 * Daily command center. Layout (xl+): central hero + bottom cards next to
 * the sidebar, operations rail on the far side. In Arabic the grid flows
 * right-to-left, so the rail sits on the left exactly like the reference.
 * Mobile order: hero → rail cards → daily brief → quick actions.
 */
export default async function HomePage() {
  const ctx = await requireTenant();
  const data = await loadCommandCenter(ctx);
  const first = (ctx.user.name ?? ctx.user.email.split("@")[0]).split(" ")[0];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_352px] xl:grid-rows-[auto_minmax(0,1fr)]">
      <div className="min-w-0 xl:col-start-1 xl:row-start-1">
        <HomeCommandCenter name={first} period={data.period} agentsWorking={data.agentsWorking} />
      </div>

      <aside className="grid grid-cols-[minmax(0,1fr)] content-start gap-4 sm:grid-cols-2 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:grid-cols-1" aria-label="Operations">
        <AttentionPanel data={data.attention} />
        <TodayPanel data={data.today} />
        <DealsPanel data={data.deals} />
        <MessagesPanel data={data.messages} />
      </aside>

      <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-5 lg:grid-cols-2 xl:col-start-1 xl:row-start-2 xl:self-start">
        <DailyBriefCard brief={data.brief ? { id: data.brief.id, narrative: data.brief.narrative, offline: data.brief.offline } : null} />
        <QuickActionsCard />
      </div>
    </div>
  );
}
