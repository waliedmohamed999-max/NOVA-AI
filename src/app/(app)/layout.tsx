import { cookies } from "next/headers";
import { brand } from "@/config/brand";
import { AppShell } from "@/components/shell/app-shell";
import { requireTenant } from "@/server/context";
import { aiAvailability } from "@/server/ai";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireTenant();
  const [approvals, hotLeads, unread] = await Promise.all([
    ctx.db.approval.count({ where: { status: "PENDING" } }),
    ctx.db.lead.count({ where: { temperature: "HOT", stage: { notIn: ["WON", "LOST"] } } }),
    ctx.db.notification.count({ where: { userId: ctx.user.id, readAt: null } }),
  ]);
  const collapsed = (await cookies()).get(brand.sidebarCookie)?.value === "1";
  return (
    <AppShell
      data={{
        user: { name: ctx.user.name, email: ctx.user.email, isPlatformAdmin: ctx.user.isPlatformAdmin },
        organization: { name: ctx.organization.name, isDemo: ctx.organization.isDemo },
        role: ctx.role,
        counts: { approvals, hotLeads, unreadNotifications: unread },
        collapsed,
        ai: (() => { const a = aiAvailability(); return a.offline ? "offline" : a.configured ? "live" : "off"; })(),
      }}
    >
      {children}
    </AppShell>
  );
}
