"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import type { ConnectionTestResult } from "@/server/integrations/diagnostics";
import { publishTestPostAction, testConnectionAction } from "./actions";

type Row = { id: string; provider: string; status: string; accounts: number };

export function ConnectionTests({ rows, testText, confirmWord }: { rows: Row[]; testText: string; confirmWord: string }) {
  const t = useTranslations("settings.admin.tests");
  const te = useTranslations("errors");
  const [results, setResults] = useState<Record<string, ConnectionTestResult>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<{ accountId: string; label: string } | null>(null);
  const [typed, setTyped] = useState("");
  const [posted, setPosted] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const err = (code: string) => (te.has(code as "unexpected") ? te(code as "unexpected") : code);

  const run = (id: string) => {
    setBusy(id);
    start(async () => {
      const r = await testConnectionAction({ integrationId: id });
      setBusy(null);
      if (r.ok) setResults((x) => ({ ...x, [id]: r.data }));
      else toast.error(err(r.error));
    });
  };

  const publish = () =>
    start(async () => {
      if (!publishing) return;
      const r = await publishTestPostAction({ accountId: publishing.accountId, confirmation: typed });
      if (r.ok) {
        setPosted((x) => ({ ...x, [publishing.accountId]: r.data.externalId }));
        toast(t("posted", { id: r.data.externalId }));
        setPublishing(null);
        setTyped("");
      } else toast.error(err(r.error));
    });

  if (!rows.length)
    return (
      <p className="rounded-2xl border border-dashed border-line-strong bg-surface-2 px-4 py-6 text-sm text-ink-3">
        {t("empty")} <Link href="/settings/connected-accounts" className="font-semibold text-accent-ink hover:underline">{t("connectLink")}</Link>
      </p>
    );

  return (
    <div className="space-y-4">
      {rows.map((row) => {
        const res = results[row.id];
        return (
          <div key={row.id} className="space-y-3 rounded-2xl border border-line bg-surface p-5" data-integration={row.provider}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{row.provider}</h3>
                <Badge tone={row.status === "CONNECTED" ? "success" : "danger"}>{row.status}</Badge>
              </div>
              <Button size="sm" variant="secondary" loading={busy === row.id} onClick={() => run(row.id)}>
                {t("run", { provider: row.provider === "LINKEDIN" ? "LinkedIn" : row.provider === "INSTAGRAM" ? "Instagram" : "Meta" })}
              </Button>
            </div>
            {res && (
              <div className="space-y-3 text-sm">
                <p className={cn("flex items-center gap-2 font-medium", res.valid ? "text-success" : "text-danger")}>
                  {res.valid ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                  {res.valid ? t("valid") : t("invalid", { reason: res.error ?? "unknown" })}
                  {res.expiresAt && <span className="font-normal text-ink-3">· {t("expires", { date: res.expiresAt.slice(0, 10) })}</span>}
                </p>
                {res.profile && <p className="text-ink-2">{t("member")}: <span className="font-medium">{res.profile.name}</span>{res.profile.email ? ` · ${res.profile.email}` : ""}</p>}
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-3">{t("scopes")}</p>
                  <div className="flex flex-wrap gap-1">{res.scopes.length ? res.scopes.map((s) => <code key={s} className="rounded bg-sunken px-1.5 py-0.5 text-xs">{s}</code>) : <span className="text-xs text-ink-4">—</span>}</div>
                </div>
                <ul className="space-y-2">
                  {res.accounts.map((a) => (
                    <li key={`${a.platform}-${a.name}`} className="rounded-xl bg-surface-2 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          <Badge tone="outline">{a.platform}</Badge> <span className="font-medium" dir="auto">{a.name}</span> {a.handle && <span className="text-ink-3" dir="ltr">{a.handle}</span>}
                          {!a.linked && <span className="ms-2 text-xs text-ink-4">{t("notLinked")}</span>}
                        </span>
                        {a.id && a.active && a.platform !== "INSTAGRAM" && (
                          <Button size="xs" variant="outline" onClick={() => setPublishing({ accountId: a.id!, label: `${a.platform} · ${a.name}` })}>{t("publish")}</Button>
                        )}
                        {a.platform === "INSTAGRAM" && <span className="text-xs text-ink-4">{t("igNeedsMedia")}</span>}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {a.capabilities.map((c) => (
                          <span key={c.key} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]", c.available ? "bg-success-soft text-success" : "bg-sunken text-ink-4")}>
                            {c.available ? <CheckCircle2 className="size-3" /> : <CircleDashed className="size-3" />}
                            {c.key}{!c.available && c.reason ? ` (${c.reason})` : ""}
                          </span>
                        ))}
                      </div>
                      {a.id && posted[a.id] && <p className="mt-2 text-xs text-success">{t("posted", { id: posted[a.id] })}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}

      <Dialog open={Boolean(publishing)} onOpenChange={(o) => { if (!o) { setPublishing(null); setTyped(""); } }}>
        <DialogContent title={t("confirmTitle")} description={publishing?.label}>
          <div className="space-y-4">
            <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm">{testText}</p>
            <p className="text-sm text-ink-3">{t("confirmBody", { word: confirmWord })}</p>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} dir="ltr" aria-label={t("confirmLabel", { word: confirmWord })} placeholder={confirmWord} />
            <Button variant="danger" className="w-full" disabled={typed !== confirmWord} loading={pending} onClick={publish}>{t("publishNow")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
