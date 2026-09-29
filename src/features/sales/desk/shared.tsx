"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Briefcase, Flame, Mail, MessageCircle, Phone, Globe } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Money } from "@/server/sales/intelligence";

export type Member = { id: string; name: string };
export type StageDef = { stage: string; label: string };

export type DeskApi = {
  openLead: (id: string) => void;
  openAddCustomer: () => void;
  openB2B: (leadId?: string) => void;
  openImport: () => void;
  openQuote: (leadId: string, opportunityId?: string) => void;
  openFollowUp: (leadId: string) => void;
  openRun: (runId: string) => void;
  canManage: boolean;
  aiReady: boolean;
  currency: string;
  members: Member[];
  stages: StageDef[];
};

export const DeskContext = createContext<DeskApi | null>(null);
export function useDesk() {
  const d = useContext(DeskContext);
  if (!d) throw new Error("useDesk outside SalesDesk");
  return d;
}

/**
 * Money formatting; unknown values render as "—", never as 0. No compact notation on the client: Node and
 * browsers ship different ICU data for compact currency (bidi marks), which breaks hydration.
 */
export function useMoney() {
  const format = useFormatter();
  return (m: Money | null | undefined) => (m ? format.number(m.cents / 100, { style: "currency", currency: m.currency, maximumFractionDigits: 0 }) : "—");
}

export function Section({ n, eyebrow, title, description, actions, children, className, id }: { n?: string; eyebrow?: string; title: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("scroll-mt-28 space-y-4", className)} aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {(n || eyebrow) && (
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-4">
              {n && <span className="tabular text-accent">{n}</span>}
              {eyebrow}
            </p>
          )}
          <h2 id={id ? `${id}-title` : undefined} className="text-lg font-semibold tracking-tight">{title}</h2>
          {description && <p className="max-w-2xl text-sm text-ink-3">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Panel({ children, className, ...rest }: { children: ReactNode; className?: string } & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  return (
    <div className={cn("rounded-[20px] border border-line bg-surface shadow-xs", className)} {...rest}>
      {children}
    </div>
  );
}

export function QuietEmpty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[20px] border border-dashed border-line-strong bg-surface-2 px-6 py-8 text-center">
      <p className="font-semibold">{title}</p>
      {body && <p className="max-w-md text-sm text-ink-3">{body}</p>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

/** Temperature as a level (no 0–100 number). */
export function TempPill({ t, className }: { t: "HOT" | "WARM" | "COLD" | string; className?: string }) {
  const tt = useTranslations("sales.temp");
  const tone = t === "HOT" ? "bg-accent-soft text-accent-ink" : t === "WARM" ? "bg-warning-soft text-warning" : "bg-sunken text-ink-3";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", tone, className)}>
      {t === "HOT" && <Flame className="size-3" />}
      {tt(t as "HOT")}
    </span>
  );
}

export function ChannelIcons({ channels }: { channels: string[] }) {
  const icon = (c: string) =>
    c === "EMAIL" ? Mail : c === "WHATSAPP" ? MessageCircle : c === "PHONE" ? Phone : c === "LINKEDIN" ? Briefcase : c === "WEBSITE" ? Globe : MessageCircle;
  const unique = [...new Set(channels)].slice(0, 4);
  return (
    <span className="flex items-center gap-1 text-ink-4">
      {unique.map((c) => {
        const I = icon(c);
        return <I key={c} className="size-3.5" aria-label={c} />;
      })}
    </span>
  );
}

export function useRelative() {
  const format = useFormatter();
  return (iso: string | null | undefined) => (iso ? format.relativeTime(new Date(iso)) : "—");
}
