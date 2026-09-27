import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Bot, Cog, ShieldCheck, User } from "lucide-react";
import { requireTenant } from "@/server/context";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Activity" };

const ICON = { USER: User, AGENT: Bot, SYSTEM: Cog } as const;

export default async function ActivityPage(props: PageProps<"/activity">) {
  const ctx = await requireTenant({ permission: "audit:read" });
  const t = await getTranslations("settings.activity");
  const format = await getFormatter();
  const sp = await props.searchParams;
  const security = sp.category === "SECURITY";
  const logs = await ctx.db.auditLog.findMany({ where: security ? { category: "SECURITY" } : {}, orderBy: { createdAt: "desc" }, take: 150 });
  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex gap-3 text-sm">
            <Link href="/activity" className={cn(!security ? "font-semibold" : "text-ink-3")}>{t("all")}</Link>
            <Link href="/activity?category=SECURITY" className={cn(security ? "font-semibold" : "text-ink-3")}>{t("security")}</Link>
          </div>
        }
      />
      <ol className="space-y-1 rounded-[24px] border border-line bg-surface p-3">
        {logs.map((l) => {
          const Icon = ICON[l.actorType];
          return (
            <li key={l.id} className="flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-2">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-2">
                <Icon className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm">{l.summary}</p>
                <p className="text-xs text-ink-4">
                  {l.actorLabel ?? t(`actors.${l.actorType}`)} · {format.dateTime(l.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                  {l.ip ? ` · ${l.ip}` : ""}
                </p>
              </div>
              {l.category === "SECURITY" && (
                <Badge tone="info">
                  <ShieldCheck className="size-3" />
                  {t("security")}
                </Badge>
              )}
            </li>
          );
        })}
        {logs.length === 0 && <li className="px-3 py-8 text-center text-sm text-ink-3">{t("empty")}</li>}
      </ol>
      <p className="mt-3 text-xs text-ink-4">{t("immutable")}</p>
    </>
  );
}
