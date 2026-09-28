"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { searchBrainAction } from "./actions";

type Hit = { kind: string; id: string; title: string; snippet: string | null; tab: string };

/** "Search the Company Brain" — structured records first, then knowledge snippets. */
export function BrainSearch() {
  const t = useTranslations("brain");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const id = setTimeout(async () => {
      const r = await searchBrainAction({ q });
      setHits(r.ok ? r.data : []);
    }, 250);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setHits(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <div ref={box} className="relative w-full sm:w-80">
      <label className="flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-3.5 focus-within:border-accent/60">
        <Search className="size-4 text-ink-4" aria-hidden />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (e.target.value.trim().length < 2) setHits(null);
          }}
          onKeyDown={(e) => e.key === "Escape" && (setHits(null), setQ(""))}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-ink-4 focus:outline-none"
        />
      </label>
      {hits && (
        <div className="absolute inset-x-0 top-12 z-30 max-h-96 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-lg" data-brain-search-results>
          {hits.length === 0 ? (
            <p className="px-3 py-3 text-sm text-ink-3">{t("searchEmpty")}</p>
          ) : (
            hits.map((h, i) => (
              <Link key={`${h.kind}-${h.id}-${i}`} href={h.kind === "source" || h.kind === "chunk" ? `/knowledge/sources/${h.id}` : `/knowledge?tab=${h.tab}`} onClick={() => setHits(null)} className="block rounded-xl px-3 py-2 hover:bg-sunken">
                <span className="me-2 rounded-full bg-sunken px-1.5 py-0.5 text-[10px] uppercase text-ink-4">{t(`kinds.${h.kind}`)}</span>
                <span className="text-sm font-medium text-ink" dir="auto">{h.title}</span>
                {h.snippet && <span className="mt-0.5 block truncate text-xs text-ink-3" dir="auto">{h.snippet}</span>}
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
