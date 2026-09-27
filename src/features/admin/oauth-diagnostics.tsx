import { getFormatter, getTranslations } from "next-intl/server";
import { CheckCircle2, CircleDashed, CircleSlash } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ProviderDiagnostics } from "@/server/admin/oauth-diagnostics";

function Scopes({ list, tone }: { list: string[]; tone: "ok" | "muted" | "bad" }) {
  if (!list.length) return <span className="text-xs text-ink-4">—</span>;
  const cls = tone === "ok" ? "bg-success-soft text-success" : tone === "bad" ? "bg-danger-soft text-danger" : "bg-sunken text-ink-3";
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((s) => (
        <code key={s} className={`rounded px-1.5 py-0.5 text-[11px] ${cls}`}>{s}</code>
      ))}
    </span>
  );
}

/** Admin-only. Redirect URIs and scope names are not secrets; secrets and tokens are never read here. */
export async function OAuthDiagnostics({ rows }: { rows: ProviderDiagnostics[] }) {
  const t = await getTranslations("settings.admin.oauth");
  const format = await getFormatter();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {rows.map((r) => (
        <article key={r.id} className="space-y-4 rounded-2xl border border-line bg-surface p-5 text-sm" data-oauth={r.id}>
          <header className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold">{r.id === "meta" ? "Facebook Pages (Meta)" : r.id === "instagram" ? "Instagram Direct" : "LinkedIn"}</h3>
            <Badge tone={r.configured && !r.redirectProblem ? "success" : "danger"}>{r.configured ? (r.redirectProblem ? t("redirectInvalid") : t("configured")) : t("missing")}</Badge>
          </header>
          {r.credentialProblem && r.credentialProblem !== "missing" && (
            <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">{t(`credential.${r.credentialProblem}` as "credential.secret_format")}</p>
          )}
          {r.instagramAccount && (
            <p className="rounded-xl bg-surface-2 p-3 text-xs">
              <span className="text-ink-3">{t("assets.instagram")}: </span>
              {r.instagramAccount.connected ? (
                <span className="font-semibold text-success" dir="auto">
                  {r.instagramAccount.handle} · {r.instagramAccount.type === "BUSINESS" ? "Business" : r.instagramAccount.type === "CREATOR" ? "Creator" : "—"}
                  {!r.instagramAccount.selected && ` (${t("assets.notSelected")})`}
                </span>
              ) : (
                <span className="text-ink-3">{t("assets.notConnected")}</span>
              )}
            </p>
          )}
          {r.assets && (
            <ul className="grid gap-1.5 rounded-xl bg-surface-2 p-3 text-xs sm:grid-cols-2">
              <li>
                <span className="block text-ink-3">{t("assets.identity")}</span>
                <span className={r.assets.identity ? "font-semibold text-success" : "text-ink-3"}>{r.assets.identity ? t("assets.connected") : t("assets.notConnected")}</span>
              </li>
              <li>
                <span className="block text-ink-3">{t("assets.pages")}</span>
                <span className={r.assets.pages ? "font-semibold text-success" : "text-ink-3"}>{r.assets.pages === null ? t("assets.permissionRequired") : r.assets.pages > 0 ? t("assets.available", { count: r.assets.pages }) : t("assets.noneFound")}</span>
              </li>
              {r.assets.selectedPages.length > 0 && (
                <li className="sm:col-span-2">
                  <span className="text-ink-3">{t("assets.selected")}: </span>
                  <span dir="auto">{r.assets.selectedPages.join(" · ")}</span>
                </li>
              )}
            </ul>
          )}
          <dl className="space-y-3">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-ink-3">{t("redirectUri")}</dt>
              <dd className="mt-1 break-all font-mono text-xs" dir="ltr">{r.redirectUri ?? r.redirectProblem}</dd>
            </div>
            {r.mode && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-ink-3">{t("mode")}</dt>
                <dd className="mt-1 text-xs">{r.mode}{r.loginConfigId ? ` · ${t("loginConfig")}` : ""}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-ink-3">{t("requested")}</dt>
              <dd className="mt-1"><Scopes list={r.requested} tone="muted" /></dd>
            </div>
            {r.optional.length > 0 && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-ink-3">{t("optional")}</dt>
                <dd className="mt-1"><Scopes list={r.optional} tone="muted" /></dd>
              </div>
            )}
            {r.rejected.length > 0 && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-danger">{t("rejected")}</dt>
                <dd className="mt-1"><Scopes list={r.rejected} tone="bad" /></dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-ink-3">{t("lastAttempt")}</dt>
              <dd className="mt-1 space-y-1.5">
                {r.lastAttempt ? (
                  <>
                    <p className="text-xs">
                      <Badge tone={r.lastAttempt.outcome?.startsWith("connected") || r.lastAttempt.outcome === "authorized" ? "success" : r.lastAttempt.outcome === "started" ? "neutral" : "warning"}>
                        {t.has(`outcomes.${r.lastAttempt.outcome}` as "outcomes.started") ? t(`outcomes.${r.lastAttempt.outcome}` as "outcomes.started") : r.lastAttempt.outcome}
                      </Badge>{" "}
                      <span className="text-ink-3">{format.relativeTime(new Date(r.lastAttempt.at))}</span>
                    </p>
                    <p className="text-xs text-ink-3">{t("granted")}:</p>
                    <Scopes list={r.lastAttempt.granted} tone="ok" />
                    {r.lastAttempt.missing.length > 0 && r.lastAttempt.outcome !== "started" && (
                      <>
                        <p className="text-xs text-ink-3">{t("notGranted")}:</p>
                        <Scopes list={r.lastAttempt.missing} tone="bad" />
                      </>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-ink-4">{t("noAttempt")}</span>
                )}
              </dd>
            </div>
          </dl>
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-3">{t("capabilities")}</p>
            <ul className="space-y-1">
              {r.capabilities.map((c) => (
                <li key={`${c.platform}-${c.capability}`} className="flex flex-wrap items-center gap-x-2 text-xs">
                  {c.status === "available" ? <CheckCircle2 className="size-3.5 text-success" /> : c.status === "not_granted" ? <CircleDashed className="size-3.5 text-warning" /> : <CircleSlash className="size-3.5 text-ink-4" />}
                  <span className={c.status === "available" ? "font-medium" : "text-ink-3"}>{c.platform} · {c.capability}</span>
                  <span className="text-ink-4">({t(`capStatus.${c.status}`)} — {c.scopes.join(", ")})</span>
                </li>
              ))}
            </ul>
          </div>
        </article>
      ))}
    </div>
  );
}
