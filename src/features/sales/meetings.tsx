"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { CalendarClock, CalendarPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { bookMeetingSlot, cancelLeadMeeting, proposeMeetingSlots } from "./actions";

export type MeetingView = { id: string; status: "PROPOSED" | "BOOKED" | "CANCELLED"; title: string; startAt: string | null; slots: string[]; timezone: string; joinUrl: string | null };

/**
 * Propose 3 times from the connected calendar → the customer picks one → book it.
 * With no calendar connected it says so and links to Connected Accounts; it never fakes a booking.
 */
export function MeetingsCard({ leadId, calendar, meetings, canManage, hasEmail }: {
  leadId: string;
  calendar: { provider: "GOOGLE" | "MICROSOFT"; email: string | null } | null;
  meetings: MeetingView[];
  canManage: boolean;
  hasEmail: boolean;
}) {
  const t = useTranslations("leads.meetings");
  const te = useTranslations("errors");
  const format = useFormatter();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast(ok);
        router.refresh();
      } else toast.error(te((r.error ?? "unexpected") as "unexpected"));
    });
  const when = (iso: string, tz: string) => format.dateTime(new Date(iso), { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: tz });
  const active = meetings.filter((m) => m.status !== "CANCELLED");

  return (
    <Card className="space-y-3 p-5" data-testid="meetings-card">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="size-4 text-ink-3" /> {t("title")}</h2>
      {!calendar ? (
        <div className="space-y-2 text-sm text-ink-3">
          <p>{t("notConnected")}</p>
          <Link href="/settings/connected-accounts" className="font-medium text-accent-ink hover:underline">{t("connect")}</Link>
        </div>
      ) : (
        <p className="text-xs text-ink-3">{t("via", { provider: calendar.provider === "GOOGLE" ? "Google Calendar" : "Outlook", email: calendar.email ?? "" })}</p>
      )}

      {active.map((m) => (
        <div key={m.id} className="space-y-2 rounded-2xl border border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <Badge tone={m.status === "BOOKED" ? "success" : "outline"}>{t(`status.${m.status}`)}</Badge>
            {canManage && (
              <button className="text-ink-4 hover:text-ink" aria-label={t("cancel")} disabled={pending} onClick={() => run(() => cancelLeadMeeting({ meetingId: m.id }), t("cancelled"))}><X className="size-4" /></button>
            )}
          </div>
          {m.status === "BOOKED" && m.startAt ? (
            <p className="text-sm font-medium">{when(m.startAt, m.timezone)}{m.joinUrl && <> · <a href={m.joinUrl} target="_blank" rel="noreferrer" className="text-accent-ink hover:underline">{t("open")}</a></>}</p>
          ) : (
            <>
              <p className="text-xs text-ink-3">{t("pickHint")}</p>
              <ul className="space-y-1.5">
                {m.slots.map((s) => (
                  <li key={s} className="flex items-center justify-between gap-2 text-sm">
                    <span className="tabular">{when(s, m.timezone)}</span>
                    {canManage && <Button size="sm" variant="secondary" disabled={pending || !calendar || !hasEmail} onClick={() => run(() => bookMeetingSlot({ meetingId: m.id, start: s }), t("booked"))}>{t("book")}</Button>}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-ink-4">{t("timezone", { tz: m.timezone })}</p>
            </>
          )}
        </div>
      ))}

      {canManage && calendar && !active.some((m) => m.status === "PROPOSED") && (
        <Button size="sm" variant="secondary" loading={pending} icon={<CalendarPlus className="size-4" />} onClick={() => run(async () => { const r = await proposeMeetingSlots({ leadId }); return r.ok ? { ok: true } : r; }, t("proposed"))}>
          {t("propose")}
        </Button>
      )}
      {calendar && !hasEmail && <p className="text-xs text-ink-3">{t("needsEmail")}</p>}
    </Card>
  );
}
