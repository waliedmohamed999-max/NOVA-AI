import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowRight, Megaphone, Palette, Sparkles, Target, TrendingUp, Users } from "lucide-react";
import { requireUser } from "@/server/context";
import { db } from "@/server/db/client";
import { loadDiscoveries } from "@/server/onboarding/service";
import { buttonClass } from "@/components/ui/button";
import { AgentMark } from "@/components/agents/agent-mark";
import { AGENTS } from "@/config/agents";

export const metadata: Metadata = { title: "Your AI Growth Team is ready" };

type Discoveries = {
  brand?: { tone?: string; traits?: string[] };
  audience?: { name: string; description: string }[];
  contentOpportunities?: { title: string; description: string }[];
  salesOpportunities?: { title: string; description: string }[];
  recommendedChannels?: { platform: string; reason: string }[];
  strategy?: { positioning?: string; firstMonthFocus?: string; postingCadence?: string; kpis?: string[] };
};

function Section({ icon: Icon, title, children, delay }: { icon: typeof Sparkles; title: string; children: React.ReactNode; delay: number }) {
  return (
    <section className="animate-fade-up rounded-[24px] border border-line bg-surface p-6 shadow-xs" style={{ animationDelay: `${delay}ms` }}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-ink-3">
        <Icon className="size-4 text-accent" /> {title}
      </h2>
      <div className="space-y-2 text-[15px] text-ink-2">{children}</div>
    </section>
  );
}

export default async function ReadyPage() {
  const user = await requireUser();
  const member = await db.organizationMember.findFirst({ where: { userId: user.id }, include: { organization: true } });
  if (!member || member.organization.onboardingStatus !== "COMPLETED") redirect("/onboarding");
  const t = await getTranslations("onboarding.ready");
  const tc = await getTranslations("common");
  const { profile, kit } = await loadDiscoveries(member.organizationId);
  const d = (profile?.discoveries ?? {}) as Discoveries;


  return (
    <main className="mx-auto max-w-5xl px-5 py-14 sm:py-20">
      <div className="animate-fade-up space-y-4 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-[22px] bg-ink text-accent shadow-lg">
          <Sparkles className="size-7" />
        </div>
        <h1 className="text-display font-semibold text-balance">{t("title")}</h1>
        <p className="mx-auto max-w-xl text-lg text-ink-3">{profile?.summary}</p>
        <div className="flex justify-center gap-2 pt-2">
          {AGENTS.map((a, i) => (
            <span key={a.key} className="animate-fade-up" style={{ animationDelay: `${150 + i * 70}ms` }} title={tc(`agents.${a.key}.name`)}>
              <AgentMark agent={a.key} size={44} />
            </span>
          ))}
        </div>
      </div>

      <div className="mt-14 grid gap-4 md:grid-cols-2">
        <Section icon={Palette} title={t("brand")} delay={200}>
          <p className="text-lg font-medium text-ink">{d.brand?.tone ?? kit?.tone}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            {kit?.primaryColors.map((c) => <span key={c} className="size-7 rounded-lg ring-1 ring-line" style={{ background: c }} />)}
            {(d.brand?.traits ?? []).map((x) => <span key={x} className="rounded-full bg-sunken px-3 py-1 text-xs">{x}</span>)}
          </div>
        </Section>
        <Section icon={Users} title={t("audience")} delay={260}>
          {(d.audience ?? []).map((a) => (
            <p key={a.name}><strong className="font-semibold text-ink">{a.name}</strong> — {a.description}</p>
          ))}
        </Section>
        <Section icon={Megaphone} title={t("contentOpportunities")} delay={320}>
          {(d.contentOpportunities ?? []).map((o) => <p key={o.title}><strong className="font-semibold text-ink">{o.title}.</strong> {o.description}</p>)}
        </Section>
        <Section icon={Target} title={t("salesOpportunities")} delay={380}>
          {(d.salesOpportunities ?? []).map((o) => <p key={o.title}><strong className="font-semibold text-ink">{o.title}.</strong> {o.description}</p>)}
        </Section>
        <Section icon={TrendingUp} title={t("channels")} delay={440}>
          {(d.recommendedChannels ?? []).map((c) => (
            <p key={c.platform}><strong className="font-semibold text-ink">{tc(`platforms.${c.platform}` as "platforms.INSTAGRAM")}</strong> — {c.reason}</p>
          ))}
        </Section>
        <Section icon={Sparkles} title={t("strategy")} delay={500}>
          <p>{d.strategy?.firstMonthFocus}</p>
          {d.strategy?.postingCadence && <p className="text-ink-3">{d.strategy.postingCadence}</p>}
          {!!d.strategy?.kpis?.length && <p className="text-ink-3">{d.strategy.kpis.join(" · ")}</p>}
        </Section>
      </div>

      <div className="mt-12 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <Link href="/home" className={buttonClass("primary", "lg")}>
          {t("cta")} <ArrowRight className="size-4 flip-rtl" />
        </Link>
        <Link href="/content?start=week" className={buttonClass("secondary", "lg")}>
          {t("firstWeek")}
        </Link>
      </div>
    </main>
  );
}
