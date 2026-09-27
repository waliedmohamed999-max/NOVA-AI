import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/context";
import { PageHeader } from "@/components/ui/card";
import { KnowledgeCenter } from "@/features/knowledge/center";

export const metadata: Metadata = { title: "Company Brain" };

export default async function KnowledgePage() {
  const ctx = await requireTenant({ permission: "workspace:read" });
  const t = await getTranslations("settings.knowledge");
  const format = await getFormatter();
  const [profile, offerings, sources] = await Promise.all([
    ctx.db.companyProfile.findFirst(),
    ctx.db.offering.findMany({ orderBy: { createdAt: "asc" } }),
    ctx.db.knowledgeSource.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { documents: true } } } }),
  ]);
  const chunkCounts = await ctx.db.knowledgeChunk.groupBy({ by: ["sourceId"], _count: true });
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <KnowledgeCenter
        canManage={ctx.can("knowledge:manage")}
        profile={{ summary: profile?.summary ?? "", industry: profile?.industry ?? "", valueProps: profile?.valueProps ?? [], contentPillars: profile?.contentPillars ?? [], completeness: profile?.completeness ?? 0 }}
        offerings={offerings.map((o) => ({ id: o.id, name: o.name, type: o.type, priceText: o.priceText ?? "", description: o.description ?? "" }))}
        sources={sources.map((s) => ({
          id: s.id,
          type: s.type,
          title: s.title,
          url: s.url,
          status: s.status,
          error: s.error,
          updated: format.relativeTime(s.lastSyncedAt ?? s.updatedAt),
          documents: s._count.documents,
          chunks: chunkCounts.find((c) => c.sourceId === s.id)?._count ?? 0,
        }))}
      />
    </>
  );
}
