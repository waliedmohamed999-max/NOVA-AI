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
    <section className="rounded-2xl border border-[var(--nova-line)] bg-surface px-5 pb-4 pt-4 shadow-[0_6px_24px_-16px_rgba(30,70,140,.25)]">
      <header className="mb-3 flex items-center gap-2.5">
        <Icon className="size-[20px] text-ink-2" strokeWidth={1.9} aria-hidden />
        <h2 className="flex-1 text-[16px] font-bold text-ink">{title}</h2>
        <Link href={href} className="rounded-full p-1 text-ink-3 transition hover:bg-sunken hover:text-ink" aria-label={title}>
          <ChevronLeft className="size-4 ltr:rotate-180" />
        </Link>
      </header>
      {children}
    </section>
  );
}

function StatTile({ value, label, tone, icon: Icon, href }: { value: number; label: string; tone: "orange" | "red" | "green" | "blue"; icon: LucideIcon; href: string }) {
  const styles = {
    orange: "bg-[#fff6ea] text-[#d97a0c]",
    red: "bg-[#fff1f1] text-[#dc3b3b]",
    green: "bg-[#ecfaf3] text-[#139464]",
    blue: "bg-[#eef4ff] text-[#2563eb]",
  }[tone];
  return (
    <Link href={href} className={cn("flex min-h-[56px] items-center gap-2 rounded-[14px] px-3 py-2 transition hover:brightness-[.98]", styles)}>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Icon className="size-[17px] shrink-0" strokeWidth={2} aria-hidden />
        <span className="text-[12px] font-semibold leading-tight">{label}</span>
      </span>
      <span className="text-[24px] font-bold tabular leading-none">{value}</span>
    </Link>
  );
}

function RailList({ rows, iconFor, empty, trailing }: { rows: RailRow[]; iconFor: (r: RailRow) => LucideIcon; empty: string; trailing?: (r: RailRow) => ReactNode }) {
  if (!rows.length) return <p className="py-2 text-[13px] text-ink-4">{empty}</p>;
  return (
    <ul className="divide-y divide-[var(--nova-line)]">
      {rows.map((r) => {
        const Icon = iconFor(r);
        return (
          <li key={`${r.kind}-${r.id}`}>
            <Link href={r.href} className="flex items-center gap-3 py-2.5 text-[13.5px] transition hover:bg-surface-2">
              <span className={cn("size-[7px] shrink-0 rounded-full", DOT[r.tone])} aria-hidden />
              <Icon className="size-[17px] shrink-0 text-ink-3" strokeWidth={1.9} aria-hidden />
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
      <div className="mb-2 grid grid-cols-2 gap-2.5">
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
      <div className="mb-2 grid grid-cols-2 gap-2.5">
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
      <div className="mb-2 grid grid-cols-2 gap-2.5">
        <StatTile value={data.unread} label={t("messages.unread")} tone="blue" icon={MailOpen} href="/inbox" />
        <StatTile value={data.needsHuman} label={t("messages.needsHuman")} tone="red" icon={MessageSquareWarning} href="/approvals?tab=SALES" />
      </div>
      {(data.whatsapp.unread > 0 || data.whatsapp.needsHuman > 0) && (
        <Link href="/whatsapp/inbox" className="mb-2 flex items-center gap-2 rounded-[12px] bg-[#e7f8ee] px-3 py-2 text-[12.5px] font-semibold text-[#0e5f2f] transition hover:bg-[#d4f3e1]" data-testid="home-whatsapp">
          <MessageCircle className="size-4" aria-hidden />
          <span>{tw("home.unread", { count: data.whatsapp.unread })}</span>
          {data.whatsapp.needsHuman > 0 && <span className="ms-auto text-[#b0390f]">{tw("home.needs", { count: data.whatsapp.needsHuman })}</span>}
        </Link>
      )}
      <RailList rows={data.rows} iconFor={() => MessagesSquare} empty={t("messages.empty")} />
    </RailCard>
  );
}
