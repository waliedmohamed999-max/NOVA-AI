import Link from "next/link";
import type { ReactNode } from "react";
import { getFormatter, getTranslations } from "next-intl/server";
import {
  AlertTriangle,
  Bell,
  Building2,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  CircleDollarSign,
  Clock3,
  FileText,
  Mail,
  MailOpen,
  Megaphone,
  MessageSquareWarning,
  MessagesSquare,
  MessageCircle,
  Plug,
  UserRound,
  UsersRound,
  BarChart3,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { CommandCenterData, RailRow } from "@/server/home";

const DOT = { danger: "bg-[#ef4444]", warning: "bg-[var(--orbit-orange)]", info: "bg-[var(--orbit-blue)]", success: "bg-[var(--orbit-green)]", neutral: "bg-ink-4" } as const;

function RailCard({ title, icon: Icon, href, children }: { title: string; icon: LucideIcon; href: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface px-4 pb-3 pt-3.5">
      <header className="mb-2.5 flex items-center gap-2">
        <Icon className="size-[18px] text-ink-3" aria-hidden />
        <h2 className="flex-1 text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        <Link href={href} className="rounded-[6px] p-1 text-ink-4 transition-colors hover:bg-black/[0.04] hover:text-ink" aria-label={title}>
          <ChevronLeft className="size-4 ltr:rotate-180" />
        </Link>
      </header>
      {children}
    </section>
  );
}

function StatTile({ value, label, tone, icon: Icon, href }: { value: number; label: string; tone: "orange" | "red" | "green" | "blue"; icon: LucideIcon; href: string }) {
  // Reference stat callout: big ink number, slate caption, a coloured status glyph — no tinted boxes.
  const color = { orange: "text-[#f59a3a]", red: "text-[#ef4444]", green: "text-[#00c07a]", blue: "text-[#0091ff]" }[tone];
  return (
    <Link href={href} className="flex min-h-[64px] flex-col justify-between gap-1 bg-surface px-3 py-2.5 transition-colors duration-150 hover:bg-surface-2">
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink-3">
        <Icon className={cn("size-3.5 shrink-0", color)} strokeWidth={2.2} aria-hidden />
        <span className="truncate">{label}</span>
      </span>
      <span className="text-[26px] font-bold leading-none tracking-[-0.03em] tabular text-ink">{value}</span>
    </Link>
  );
}

function RailList({ rows, iconFor, empty, trailing }: { rows: RailRow[]; iconFor: (r: RailRow) => LucideIcon; empty: string; trailing?: (r: RailRow) => ReactNode }) {
  if (!rows.length) return <p className="py-2 text-[13px] text-ink-4">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => {
        const Icon = iconFor(r);
        return (
          <li key={`${r.kind}-${r.id}`}>
            <Link href={r.href} className="-mx-2 flex items-center gap-3 rounded-[6px] px-2 py-2.5 text-[13.5px] transition-colors duration-150 hover:bg-surface-2">
              <span className={cn("size-[7px] shrink-0 rounded-full", DOT[r.tone])} aria-hidden />
              <Icon className="size-[16px] shrink-0 text-ink-4" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ink-2">{r.title}</span>
                {r.subtitle && <span className="block truncate text-[12px] text-ink-4">{r.subtitle}</span>}
              </span>
              {trailing?.(r)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export async function AttentionPanel({ data }: { data: CommandCenterData["attention"] }) {
  const t = await getTranslations("app.home.rail");
  const icon = (r: RailRow): LucideIcon =>
    r.kind.startsWith("approval:CAMPAIGNS") ? Megaphone : r.kind.startsWith("approval:SALES") || r.kind.startsWith("approval:PRICING") ? Mail : r.kind === "integration" ? Plug : r.kind === "overdue" ? Clock3 : r.kind === "publish_failed" ? AlertTriangle : FileText;
  return (
    <RailCard title={t("attention.title")} icon={Bell} href="/approvals">
      <div className="mb-2 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line">
        <StatTile value={data.approvals} label={t("attention.approvals")} tone="orange" icon={Clock3} href="/approvals" />
        <StatTile value={data.critical} label={t("attention.critical")} tone="red" icon={AlertTriangle} href="/notifications" />
      </div>
      <RailList rows={data.rows.map((r) => (r.kind === "integration" ? { ...r, title: t("attention.integration", { provider: r.title }) } : r.kind === "publish_failed" ? { ...r, title: t("attention.publishFailed", { title: r.title }) } : r))} iconFor={icon} empty={t("attention.empty")} />
    </RailCard>
  );
}

export async function TodayPanel({ data }: { data: CommandCenterData["today"] }) {
  const t = await getTranslations("app.home.rail");
  const format = await getFormatter();
  const icon = (r: RailRow): LucideIcon => (r.kind === "meeting" ? CalendarClock : r.kind === "followup" ? UsersRound : FileText);
  return (
    <RailCard title={t("today.title")} icon={CalendarDays} href="/calendar">
      <RailList
        rows={data.rows.map((r) => (r.kind === "content_approval" ? { ...r, title: t("today.approveContent", { title: r.title }) } : r.kind === "post" ? { ...r, title: t("today.publish", { title: r.title }) } : r))}
        iconFor={icon}
        empty={t("today.empty")}
        trailing={(r) => (r.at ? <span className="shrink-0 text-[12.5px] tabular text-ink-3">{format.dateTime(new Date(r.at), { hour: "numeric", minute: "2-digit" })}</span> : null)}
      />
    </RailCard>
  );
}

export async function DealsPanel({ data }: { data: CommandCenterData["deals"] }) {
  const t = await getTranslations("app.home.rail");
  return (
    <RailCard title={t("deals.title")} icon={BarChart3} href="/sales">
      <div className="mb-2 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line">
        <StatTile value={data.active} label={t("deals.active")} tone="green" icon={CircleDollarSign} href="/sales" />
        <StatTile value={data.awaitingFollowUp} label={t("deals.followUp")} tone="blue" icon={UserRound} href="/sales?view=followups" />
      </div>
      <RailList rows={data.rows} iconFor={() => Building2} empty={t("deals.empty")} />
    </RailCard>
  );
}

export async function MessagesPanel({ data }: { data: CommandCenterData["messages"] }) {
  const t = await getTranslations("app.home.rail");
  const tw = await getTranslations("whatsapp");
  return (
    <RailCard title={t("messages.title")} icon={Mail} href="/inbox">
      <div className="mb-2 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line">
        <StatTile value={data.unread} label={t("messages.unread")} tone="blue" icon={MailOpen} href="/inbox" />
        <StatTile value={data.needsHuman} label={t("messages.needsHuman")} tone="red" icon={MessageSquareWarning} href="/approvals?tab=SALES" />
      </div>
      {(data.whatsapp.unread > 0 || data.whatsapp.needsHuman > 0) && (
        <Link href="/whatsapp/inbox" className="mb-2 flex items-center gap-2 rounded-[8px] border border-line px-3 py-2 text-[12.5px] font-semibold text-ink-2 transition-colors hover:bg-surface-2" data-testid="home-whatsapp">
          <MessageCircle className="size-4" aria-hidden />
          <span>{tw("home.unread", { count: data.whatsapp.unread })}</span>
          {data.whatsapp.needsHuman > 0 && <span className="ms-auto text-[#b0390f]">{tw("home.needs", { count: data.whatsapp.needsHuman })}</span>}
        </Link>
      )}
      <RailList rows={data.rows} iconFor={() => MessagesSquare} empty={t("messages.empty")} />
    </RailCard>
  );
}
