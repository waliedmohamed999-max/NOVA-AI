import { type LucideIcon, AlertTriangle, CalendarCheck, CheckCircle2, Flame, Lightbulb, Plug, Send, ShieldCheck, TimerReset, UserCheck, FileText, Gauge } from "lucide-react";
import { cn } from "@/lib/cn";

const map: Record<string, { icon: LucideIcon; cls: string }> = {
  APPROVAL_NEEDED: { icon: ShieldCheck, cls: "bg-accent-soft text-accent-ink" },
  POST_PUBLISHED: { icon: Send, cls: "bg-success-soft text-success" },
  PUBLISHING_FAILED: { icon: AlertTriangle, cls: "bg-danger-soft text-danger" },
  LEAD_QUALIFIED: { icon: UserCheck, cls: "bg-info-soft text-info" },
  HOT_OPPORTUNITY: { icon: Flame, cls: "bg-accent-soft text-accent-ink" },
  FOLLOW_UP_DUE: { icon: TimerReset, cls: "bg-warning-soft text-warning" },
  MEETING_BOOKED: { icon: CalendarCheck, cls: "bg-success-soft text-success" },
  INTEGRATION_DISCONNECTED: { icon: Plug, cls: "bg-danger-soft text-danger" },
  AI_RECOMMENDATION: { icon: Lightbulb, cls: "bg-sunken text-ink-2" },
  REPORT_READY: { icon: FileText, cls: "bg-sunken text-ink-2" },
  USAGE_LIMIT: { icon: Gauge, cls: "bg-warning-soft text-warning" },
};


export function NotificationIcon({ type, className }: { type: string; className?: string }) {
  const entry = map[type] ?? { icon: CheckCircle2, cls: "bg-sunken text-ink-2" };
  const Icon = entry.icon;
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", entry.cls, className)} aria-hidden>
      <Icon className="size-4" />
    </span>
  );
}
