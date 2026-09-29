"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CheckCircle2, Link2, Mail } from "lucide-react";
import { cn } from "@/lib/cn";
import { toast } from "@/components/ui/toast";
import { ConnectWhatsAppButton } from "@/features/whatsapp/connect-button";
import { WhatsAppGlyph } from "@/features/whatsapp/ui";
import { saveGoalsAction } from "@/features/whatsapp/actions";
import { useSetup } from "./state";
import { StepFooter } from "./footer";
import { StepCard } from "./ui";

const WA_GOALS = ["receive", "answer", "followup", "campaigns", "all"] as const;

/** Optional step: connect channels. WhatsApp connects in place (official Embedded Signup); never required. */
export function ChannelsStep() {
  const t = useTranslations("onboarding.setup.channels");
  const s = useSetup();
  const c = s.channels;
  const [wa, setWa] = useState(c.whatsapp);
  const social = [
    { key: "instagram", on: c.instagram },
    { key: "facebook", on: c.facebook },
    { key: "linkedin", on: c.linkedin },
  ] as const;
  return (
    <StepCard icon={<Link2 />} title={t("title")} subtitle={t("subtitle")} footer={<StepFooter step="channels" />}>
      <WhatsAppCard state={wa} onConnected={(n) => setWa({ connected: true, display: n.display })} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {social.map((x) => (
          <ChannelCard key={x.key} name={t(x.key)} hint={t("socialHint")} on={x.on} href="/onboarding/connect" />
        ))}
        <ChannelCard name={t("email")} hint={t("emailHint")} on={c.email} href="/onboarding/connect" icon={<Mail className="size-5" />} />
      </div>
    </StepCard>
  );
}

function ChannelCard({ name, hint, on, href, icon }: { name: string; hint: string; on: boolean; href: string; icon?: React.ReactNode }) {
  const t = useTranslations("onboarding.setup.channels");
  const s = useSetup();
  return (
    <div className="flex flex-col rounded-2xl border border-nova-line bg-surface p-4">
      <div className="flex items-center gap-2">
        {icon ?? <Link2 className="size-5 text-ink-3" />}
        <span className="text-sm font-bold">{name}</span>
      </div>
      <p className="mt-1 flex-1 text-xs text-ink-3">{hint}</p>
      {on ? (
        <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-success"><CheckCircle2 className="size-4" /> {t("connected")}</span>
      ) : (
        <Link href={href} onClick={() => void s.flush()} className="mt-3 inline-flex h-9 items-center justify-center rounded-xl border border-nova-line text-sm font-semibold hover:bg-surface-2">
          {t("connect")}
        </Link>
      )}
    </div>
  );
}

function WhatsAppCard({ state, onConnected }: { state: { connected: boolean; display: string | null }; onConnected: (n: { display: string | null }) => void }) {
  const t = useTranslations("whatsapp");
  const s = useSetup();
  const [goals, setGoals] = useState<string[]>(s.channels.whatsappGoals);
  const [pending, start] = useTransition();
  const toggle = (g: string) => {
    const next = g === "all" ? (goals.includes("all") ? [] : [...WA_GOALS]) : goals.includes(g) ? goals.filter((x) => x !== g && x !== "all") : [...goals, g];
    setGoals(next);
    start(async () => {
      const r = await saveGoalsAction({ goals: next as (typeof WA_GOALS)[number][] });
      if (!r.ok) toast(r.error ?? "unexpected", "error");
    });
  };
  return (
    <section className="rounded-3xl border border-[#1fa855]/25 bg-[linear-gradient(135deg,var(--surface)_0%,#e7f8ee_160%)] p-5 sm:p-6" data-testid="onb-whatsapp">
      <div className="flex flex-wrap items-start gap-4">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-[#e7f8ee] text-[#1fa855] ring-1 ring-[#1fa855]/20">
          <WhatsAppGlyph className="size-6" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-base font-bold">{t("connect.title")}</h3>
          <p className="text-sm text-ink-3">{t("connect.body")}</p>
        </div>
      </div>
      <div className="mt-4">
        {state.connected ? (
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-success">
              <CheckCircle2 className="size-5" /> {t("connect.done")}
              {state.display && <span className="font-medium text-ink-2" dir="ltr">{state.display}</span>}
            </p>
            <div className="space-y-2">
              <p className="text-sm font-semibold">{t("prefs.title")}</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t("prefs.title")}>
                {WA_GOALS.map((g) => (
                  <button key={g} type="button" role="checkbox" aria-checked={goals.includes(g)} disabled={pending} onClick={() => toggle(g)} className={cn("rounded-full border px-3.5 py-2 text-sm font-semibold transition", goals.includes(g) ? "border-[#1fa855] bg-[#e7f8ee] text-[#0e5f2f]" : "border-nova-line bg-surface text-ink-2")}>
                    {t(`prefs.${g}`)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-ink-4">{t("prefs.note")}</p>
            </div>
          </div>
        ) : (
          <ConnectWhatsAppButton config={s.channels.signup} onConnected={(n) => onConnected(n)} size="lg" />
        )}
      </div>
    </section>
  );
}
