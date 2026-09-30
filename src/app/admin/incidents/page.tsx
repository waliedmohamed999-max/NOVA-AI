import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/server/context";
import { adminHealth, adminIncidents } from "@/server/admin/queries";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Admin · Incidents" };

export default async function AdminIncidentsPage() {
  await requirePlatformAdmin();
  const t = await getTranslations("settings.admin");
  const th = await getTranslations("settings.admin.health");
  const format = await getFormatter();
  const [items, health] = await Promise.all([adminIncidents(), adminHealth()]);
  const ms = (v: number | null) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-3">{t("incidentsWindow")}</p>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="health-counts">
        {(Object.entries(health.counts) as [keyof typeof health.counts, number][]).map(([k, v]) => (
          <div key={k} className="rounded-2xl border border-line bg-surface p-4">
            <dt className="text-xs text-ink-3">{th(`counts.${k}`)}</dt>
            <dd className={`text-2xl font-semibold tabular ${v > 0 ? "text-danger" : ""}`}>{v}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-2 rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold">{th("latency")}</h2>
          <p className="font-mono text-xs text-ink-2" dir="ltr">
            AI p50 {ms(health.latency.aiP50)} · p95 {ms(health.latency.aiP95)} — jobs p50 {ms(health.latency.jobP50)} · p95 {ms(health.latency.jobP95)}
          </p>
          <h3 className="pt-2 text-xs font-semibold text-ink-3">{th("providerFailures")}</h3>
          {health.providerFailures.length || health.slowCalls.length ? (
            <ul className="space-y-1 font-mono text-xs" dir="ltr">
              {health.providerFailures.map((p) => <li key={`${p.host}-${p.kind}`}>{p.host} · {p.kind} × {p.count}</li>)}
              {health.slowCalls.map((s) => <li key={`slow-${s.host}`} className="text-warning">{s.host} · slow × {s.count} (max {ms(s.maxMs)})</li>)}
            </ul>
          ) : <p className="text-xs text-ink-4">{th("none")}</p>}
          <h3 className="pt-2 text-xs font-semibold text-ink-3">{th("oauth")}</h3>
          {health.oauth.length ? (
            <ul className="space-y-1 font-mono text-xs" dir="ltr">{health.oauth.map((o) => <li key={`${o.provider}-${o.outcome}`}>{o.provider} · {o.outcome} × {o.count}</li>)}</ul>
          ) : <p className="text-xs text-ink-4">{th("none")}</p>}
          <p className="pt-2 text-xs text-ink-4">{health.sentry ? th("sentryOn") : th("sentryOff")}</p>
        </section>

        <section className="space-y-2 rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold">{th("reconnect")}</h2>
          {health.reconnect.length ? (
            <ul className="divide-y divide-line text-sm">
              {health.reconnect.map((r) => (
                <li key={r.id} className="flex items-center gap-2 py-2">
                  <Badge tone={r.status === "EXPIRED" ? "warning" : "danger"}>{r.status}</Badge>
                  <span className="font-medium">{r.provider}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{r.statusMessage ?? "—"}</span>
                  <span className="font-mono text-[11px] text-ink-4" dir="ltr">{r.organizationId.slice(-6)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-ink-4">{th("none")}</p>}
          <h3 className="pt-2 text-xs font-semibold text-ink-3">{th("validations")}</h3>
          {health.validationFailures.length ? (
            <ul className="space-y-1 text-xs">
              {health.validationFailures.map((v) => <li key={`${v.provider}-${v.createdAt.toISOString()}`}><span className="font-semibold">{v.provider}/{v.check}</span> <span className="font-mono text-ink-3" dir="ltr">{v.detail ?? ""}</span></li>)}
            </ul>
          ) : <p className="text-xs text-ink-4">{th("none")}</p>}
        </section>
      </div>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface px-5 py-8 text-center text-sm text-ink-3">{t("noIncidents")}</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {items.map((i) => (
            <li key={`${i.kind}-${i.id}`} className="flex items-start gap-3 px-5 py-3 text-sm">
              <Badge tone={i.kind === "job" ? "danger" : i.kind === "integration" ? "warning" : "info"}>{t(`kinds.${i.kind}` as "kinds.job")}</Badge>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{i.title}</div>
                <div className="truncate text-xs text-ink-3">{i.detail ?? "—"}</div>
              </div>
              <span className="text-xs text-ink-4">{i.at ? format.relativeTime(i.at) : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
