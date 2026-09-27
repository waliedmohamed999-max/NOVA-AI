"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { retryJobAction } from "./actions";

export function AdminSearch({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  return (
    <form
      role="search"
      className="relative max-w-sm"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`?q=${encodeURIComponent(q)}`);
      }}
    >
      <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-4" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="ps-10" />
    </form>
  );
}

export function AdminTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[20px] border border-line bg-surface">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-line bg-surface-2 text-xs uppercase tracking-wider text-ink-3">
          <tr>{head.map((h) => <th key={h} scope="col" className="px-4 py-3 text-start font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function RetryJob({ id }: { id: string }) {
  const t = useTranslations("settings.admin");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="xs" variant="secondary" loading={pending} onClick={() => start(async () => {
      const r = await retryJobAction({ id });
      if (r.ok) { toast(t("requeued")); router.refresh(); } else toast.error(te(r.error as "unexpected"));
    })}>
      {t("retry")}
    </Button>
  );
}
