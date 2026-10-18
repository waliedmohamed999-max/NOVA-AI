"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";

/** Search, category and date filters for the activity log; all of it lives in the URL. */
export function ActivityFilters({ q, category, from, to }: { q: string; category: string; from: string; to: string }) {
  const t = useTranslations("settings.activity");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(q);
  const push = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v); else next.delete(k);
    next.delete("cursor");
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  useEffect(() => {
    if (value === q) return;
    const id = setTimeout(() => push({ q: value.trim() || null }), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const field = "h-10 rounded-[10px] border border-line bg-surface px-3 text-sm text-ink-2 focus:border-line-strong focus:outline-none";
  const filtered = Boolean(q || category || from || to);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 focus-within:border-line-strong">
        <Search className="size-4 shrink-0 text-ink-4" aria-hidden />
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-4 focus:outline-none" />
      </label>
      <select value={category} onChange={(e) => push({ category: e.target.value || null })} aria-label={t("categoryLabel")} className={field}>
        <option value="">{t("all")}</option>
        <option value="SECURITY">{t("security")}</option>
        <option value="BUSINESS">{t("business")}</option>
      </select>
      <label className="flex flex-col gap-1 text-xs text-ink-4">
        {t("from")}
        <input type="date" value={from} max={to || undefined} onChange={(e) => push({ from: e.target.value || null })} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-4">
        {t("to")}
        <input type="date" value={to} min={from || undefined} onChange={(e) => push({ to: e.target.value || null })} className={field} />
      </label>
      {filtered && (
        <button
          type="button"
          onClick={() => {
            setValue("");
            router.replace(pathname, { scroll: false });
          }}
          className="inline-flex h-10 items-center gap-1.5 rounded-[10px] px-3 text-sm font-medium text-ink-3 hover:bg-surface-2 hover:text-ink"
        >
          <X className="size-4" /> {t("clear")}
        </button>
      )}
    </div>
  );
}
