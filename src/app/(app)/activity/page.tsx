import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Bot, ChevronLeft, Cog, ShieldCheck, User } from "lucide-react";
import type { ActorType, AuditCategory } from "@/generated/prisma/enums";
import { requireTenant } from "@/server/context";
import { listActivity } from "@/server/activity";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { ActivityFilters } from "@/features/activity/filters";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Activity" };

const ICON = { USER: User, AGENT: Bot, SYSTEM: Cog } as const;
const ACTORS: ActorType[] = ["USER", "AGENT", "SYSTEM"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The workspace's audit trail: who (person, AI team, system) did what and when. Filter by who, category,
 * dates and text; entries link to the record they're about. State lives in the URL.
 */
export default async function ActivityPage(props: PageProps<"/activity">) {
  const ctx = await requireTenant({ permission: "audit:read" });
  const t = await getTranslations("settings.activity");
  const format = await getFormatter();
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const category = str("category") === "SECURITY" || str("category") === "BUSINESS" ? (str("category") as AuditCategory) : null;
  const actor = (ACTORS as string[]).includes(str("actor")) ? (str("actor") as ActorType) : null;
  const from = DAY.test(str("from")) ? str("from") : "";
  const to = DAY.test(str("to")) ? str("to") : "";
  const q = str("q").slice(0, 80);

  const { items, nextCursor } = await listActivity(
    { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id },
    { category, actor, q, from: from ? new Date(`${from}T00:00:00Z`) : null, to: to ? new Date(`${to}T00:00:00Z`) : null, cursor: str("cursor") || null },
  );

  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | null> = { category, actor, q: q || null, from: from || null, to: to || null };
    for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/activity?${s}` : "/activity";
  };

  // Group consecutive entries by calendar day.
  const groups: { day: string; label: string; items: typeof items }[] = [];
  for (const l of items) {
    const day = l.createdAt.toISOString().slice(0, 10);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(l);
    else groups.push({ day, label: format.dateTime(l.createdAt, { weekday: "long", day: "numeric", month: "long", year: "numeric" }), items: [l] });
  }

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="mb-4 space-y-3">
        <nav className="flex gap-1.5 overflow-x-auto scrollbar-none" aria-label={t("actorLabel")}>
          {[null, ...ACTORS].map((a) => (
            <Link
              key={a ?? "all"}
              href={href({ actor: a })}
              aria-current={actor === a ? "page" : undefined}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors",
                actor === a ? "border-ink bg-ink text-ink-inverse" : "border-line bg-surface text-ink-2 hover:border-line-strong",
              )}
            >
              {a ? t(`actorFilter.${a}`) : t("actorFilter.all")}
            </Link>
          ))}
        </nav>
        <ActivityFilters q={q} category={category ?? ""} from={from} to={to} />
      </div>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface px-3 py-12 text-center text-sm text-ink-3">{q || category || actor || from || to ? t("noMatches") : t("empty")}</p>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.day} aria-label={g.label}>
              <h2 className="label-mono mb-2 px-1">{g.label}</h2>
              <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
                {g.items.map((l) => {
                  const Icon = ICON[l.actorType];
                  const body = (
                    <>
                      <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full", l.actorType === "AGENT" ? "bg-accent-soft text-accent" : "bg-sunken text-ink-2")}>
                        <Icon className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-ink" dir="auto">
                          {l.summary}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-4">
                          {l.actorLabel ?? t(`actors.${l.actorType}`)} · {format.dateTime(l.createdAt, { timeStyle: "short" })}
                          {l.ip ? ` · ${l.ip}` : ""}
                        </p>
                      </div>
                      {l.category === "SECURITY" && (
                        <Badge tone="info">
                          <ShieldCheck className="size-3" />
                          <span className="hidden sm:inline">{t("security")}</span>
                        </Badge>
                      )}
                      {l.href && <ChevronLeft className="mt-1 size-4 shrink-0 text-ink-4 ltr:rotate-180" aria-hidden />}
                    </>
                  );
                  return (
                    <li key={l.id}>
                      {l.href ? (
                        <Link href={l.href} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
                          {body}
                        </Link>
                      ) : (
                        <div className="flex items-start gap-3 px-4 py-3">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
          {nextCursor && (
            <div className="text-center">
              <Link href={href({ cursor: nextCursor })} className={buttonClass("secondary", "sm")}>
                {t("loadMore")}
              </Link>
            </div>
          )}
        </div>
      )}
      <p className="mt-4 text-xs text-ink-4">{t("immutable")}</p>
    </>
  );
}
