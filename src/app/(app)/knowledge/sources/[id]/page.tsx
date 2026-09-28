import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireTenant } from "@/server/context";
import { sourceDetail } from "@/server/brain/sources";
import { BRAIN_ENTITIES } from "@/lib/brain-fields";
import { Card } from "@/components/ui/card";
import { BrainShell } from "@/features/brain/shell";
import { FactsPanel } from "@/features/brain/tabs-knowledge";
import { EntityList, SectionCard, StatusBadge } from "@/features/brain/ui";

export const metadata: Metadata = { title: "Knowledge source" };

const values = (row: Record<string, unknown>, type: keyof typeof BRAIN_ENTITIES) => Object.fromEntries(BRAIN_ENTITIES[type].fields.map((f) => [f.name, row[f.name] ?? null]));

/** One source: raw excerpt, parsed documents, extracted entities (accept / reject / edit), chunks (paginated), summary, errors. */
export default async function SourcePage(props: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireTenant({ permission: "workspace:read" });
  const { id } = await props.params;
  const sp = await props.searchParams;
  const page = Math.max(1, Number(sp.chunks ?? 1) || 1);
  const d = await sourceDetail({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id }, id, page);
  if (!d) notFound();
  const t = await getTranslations("brain");
  const te = await getTranslations("errors");
  const format = await getFormatter();
  const canManage = ctx.can("knowledge:manage");
  const canApprove = ctx.can("content:approve");
  const s = d.source;
  return (
    <BrainShell tab="sources">
      <Link href="/knowledge?tab=sources" className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink">
        <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden /> {t("tabs.sources")}
      </Link>
      <Card className="space-y-3 p-5 sm:p-6" data-source-detail={s.id}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-ink" dir="auto">{s.title}</h1>
            {s.url && <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-sm text-accent hover:underline" dir="ltr">{s.url}</a>}
          </div>
          <StatusBadge status={s.health} />
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-ink-3">{t("sources.type")}</dt><dd>{t(`sourceTypes.${s.type}`)}</dd></div>
          <div><dt className="text-xs text-ink-3">{t("sources.lastSync")}</dt><dd>{s.lastSync ? format.relativeTime(new Date(s.lastSync)) : "—"}</dd></div>
          <div><dt className="text-xs text-ink-3">{t("sources.language")}</dt><dd>{s.language?.toUpperCase() ?? "—"}</dd></div>
          <div><dt className="text-xs text-ink-3">{t("sources.usedByLabel")}</dt><dd>{s.usedBy.map((u) => t(`agents.${u}`)).join("، ") || "—"}</dd></div>
        </dl>
        {s.summary && <p className="rounded-xl bg-sunken px-3 py-2 text-sm text-ink-2" dir="auto">{s.summary}</p>}
        {d.errors.length > 0 && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{d.errors.map((e) => (te.has(e) ? te(e) : e)).join(" · ")}</p>}
        {s.raw && (
          <details className="rounded-xl border border-line p-3 text-sm">
            <summary className="cursor-pointer text-ink-2">{t("sources.raw")}</summary>
            <p className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap text-xs text-ink-3" dir="auto">{s.raw}</p>
          </details>
        )}
      </Card>

      <FactsPanel title={t("sources.extractedFacts")} facts={d.extracted.facts.map((f) => ({ id: f.id, key: f.key, value: f.value, category: f.category, sourceKind: f.sourceKind, status: f.status, critical: f.critical, confidence: f.confidence }))} canManage={canManage} canApprove={canApprove} />
      {d.extracted.faqs.length > 0 && (
        <SectionCard title={t("tabs.faq")}>
          <EntityList type="faq" rows={d.extracted.faqs.map((r) => ({ id: r.id, values: values(r as unknown as Record<string, unknown>, "faq"), status: r.status, sourceKind: r.sourceKind }))} canManage={canManage} canApprove={canApprove} empty="" />
        </SectionCard>
      )}
      {d.extracted.objections.length > 0 && (
        <SectionCard title={t("sales.objectionsTitle")}>
          <EntityList type="objection" rows={d.extracted.objections.map((r) => ({ id: r.id, values: values(r as unknown as Record<string, unknown>, "objection"), status: r.status, sourceKind: r.sourceKind }))} canManage={canManage} canApprove={canApprove} empty="" />
        </SectionCard>
      )}
      {d.extracted.offerings.length > 0 && (
        <SectionCard title={t("tabs.products")}>
          <EntityList type="offering" rows={d.extracted.offerings.map((r) => ({ id: r.id, values: values(r as unknown as Record<string, unknown>, "offering"), status: r.status, sourceKind: r.sourceKind }))} canManage={canManage} canApprove={false} empty="" />
        </SectionCard>
      )}

      <SectionCard title={t("sources.documents", { count: d.documents.length })}>
        <ul className="space-y-1 text-sm">
          {d.documents.map((doc) => (
            <li key={doc.id} className="truncate text-ink-2" dir="auto">{doc.title}{doc.url ? <span className="text-ink-4"> — {doc.url}</span> : null}</li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title={t("sources.chunksTitle", { count: d.chunks.total })} description={t("sources.chunksNote")}>
        <ol className="space-y-2" data-chunks>
          {d.chunks.rows.map((c) => (
            <li key={c.id} className="rounded-xl bg-sunken px-3 py-2 text-xs text-ink-2" dir="auto">
              <span className="me-2 text-ink-4">#{c.index + 1} · {c.tokenCount}</span>
              {c.content.slice(0, 600)}
            </li>
          ))}
        </ol>
        {d.chunks.pages > 1 && (
          <div className="flex justify-between text-sm">
            {page > 1 ? <Link href={`/knowledge/sources/${s.id}?chunks=${page - 1}`} className="text-accent">{t("prev")}</Link> : <span />}
            <span className="text-ink-4">{page} / {d.chunks.pages}</span>
            {page < d.chunks.pages ? <Link href={`/knowledge/sources/${s.id}?chunks=${page + 1}`} className="text-accent">{t("next")}</Link> : <span />}
          </div>
        )}
      </SectionCard>
    </BrainShell>
  );
}
