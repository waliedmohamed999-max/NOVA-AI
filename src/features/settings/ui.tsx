"use client";

import { useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";

export function Section({ title, description, children, footer }: { title: string; description?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="space-y-1 border-b border-line px-6 py-5">
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="text-sm text-ink-3">{description}</p>}
      </div>
      <div className="space-y-4 px-6 py-5">{children}</div>
      {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-2 px-6 py-4">{footer}</div>}
    </Card>
  );
}

/** Runs a server action with toasts for success and human-friendly errors. */
export function useAct() {
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        if (ok) toast(ok);
        after?.();
        router.refresh();
      } else toast.error(te((r.error ?? "unexpected") as "unexpected"));
    });
  return { act, pending };
}
