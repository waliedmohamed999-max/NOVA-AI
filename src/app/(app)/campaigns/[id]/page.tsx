import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireTenant } from "@/server/context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/misc";
import { PlatformDot } from "@/components/content/post-preview";
import { CampaignActions } from "@/features/campaigns/campaign-actions";

export const metadata: Metadata = { title: "Campaign" };

type Plan = { concept?: string; keyMessage?: string; creativeDirection?: string; cta?: string; kpis?: string[] };

export default async function CampaignPage(props: PageProps<"/campaigns/[id]">) {
  const { id } = await props.params;
  const ctx = await requireTenant({ permission: "workspace:read" });
  const t = await getTranslations("app.campaigns");
  const tc = await getTranslations("common");
  const ts = await getTranslations("content.status");
  const format = await getFormatter();
  const c = await ctx.db.campaign.findUnique({
    where: { id },
    include: { content: { orderBy: { scheduledAt: "asc" } }, leads: { select: { id: true, name: true, stage: true, estimatedValueCents: true, currency: true } } },
  });
  if (!c) notFound();
  const plan = (c.plan ?? {}) as Plan;
  const posts = await ctx.db.socialPost.findMany({ where: { contentItemId: { in: c.content.map((x) => x.id) } }, include: { metric: true } });
  const reach = posts.reduce((a, p) => a + (p.metric?.reach ?? 0), 0);
  const won = c.leads.filter((l) => l.stage === "WON");
  const revenue = won.reduce((a, l) => a + (l.estimatedValueCents ?? 0), 0);
  const currency = c.leads[0]?.currency ?? "USD";

  return (
    <div className="space-y-6">
      <Link href="/campaigns" className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink"><ArrowLeft className="size-4 flip-rtl" /> {t("title")}</Link>
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <Badge tone={c.status === "ACTIVE" ? "success" : c.status === "PENDING_APPROVAL" ? "accent" : "neutral"}>{t(`status.${c.status}` as "status.ACTIVE")}</Badge>
          <h1 className="text-[30px] font-semibold tracking-[-0.02em]">{c.name}</h1>
          <p className="max-w-2xl text-ink-3">{c.objective}</p>
        </div>
        {ctx.can("campaign:manage") && <CampaignActions id={c.id} status={c.status} />}
      </header>

      <Card className="grid grid-cols-2 gap-6 p-6 lg:grid-cols-4">
        <Stat label={t("posts")} value={c.content.length} />
        <Stat label={t("reach")} value={posts.length ? format.number(reach) : "—"} hint={posts.length ? undefined : t("noMetrics")} />
        <Stat label={t("leads")} value={c.leads.length} />
        <Stat label={t("revenue")} value={format.number(revenue / 100, { style: "currency", currency, maximumFractionDigits: 0 })} hint={t("revenueHint", { count: won.length })} />
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold">{t("content")}</h2>
          <ul className="divide-y divide-line">
            {c.content.map((p) => (
              <li key={p.id}>
                <Link href={`/content/${p.id}`} className="flex items-center gap-3 py-3 hover:bg-surface-2">
                  <PlatformDot platform={p.platform} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.title}</span>
                  <Badge tone={p.status === "PENDING_APPROVAL" ? "accent" : p.status === "PUBLISHED" ? "success" : "neutral"}>{ts(p.status)}</Badge>
                  <span className="hidden w-32 text-end text-xs text-ink-3 sm:block">{p.scheduledAt ? format.dateTime(p.scheduledAt, { weekday: "short", month: "short", day: "numeric" }) : "—"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <aside className="space-y-4">
          <Card className="space-y-4 p-5 text-sm">
            {(["concept", "keyMessage", "creativeDirection", "cta"] as const).map((k) =>
              plan[k] ? (
                <div key={k}>
                  <div className="text-xs font-semibold uppercase tracking-wider text-ink-4">{t(`plan.${k}`)}</div>
                  <p className="mt-1 text-ink-2">{plan[k]}</p>
                </div>
              ) : null,
            )}
            {c.audience && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-4">{t("plan.audience")}</div>
                <p className="mt-1 text-ink-2">{c.audience}</p>
              </div>
            )}
            {!!plan.kpis?.length && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-4">{t("plan.kpis")}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">{plan.kpis.map((k) => <Badge key={k} tone="outline">{k}</Badge>)}</div>
              </div>
            )}
            <div className="text-xs text-ink-4">{c.channels.map((ch) => tc(`platforms.${ch}` as "platforms.INSTAGRAM")).join(" · ")}</div>
          </Card>
          {c.leads.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold">{t("leads")}</h2>
              <ul className="space-y-2 text-sm">
                {c.leads.map((l) => <li key={l.id}><Link href={`/leads/${l.id}`} className="hover:underline">{l.name}</Link></li>)}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
