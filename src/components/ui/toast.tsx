"use client";

import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; message: string; action?: { label: string; onClick: () => void } };

let counter = 0;
const listeners = new Set<(t: ToastItem) => void>();

/** Fire-and-forget toast from anywhere on the client. */
export function toast(message: string, kind: ToastKind = "success", action?: ToastItem["action"]) {
  const item = { id: ++counter, kind, message, action };
  listeners.forEach((l) => l(item));
}
toast.error = (message: string) => toast(message, "error");
toast.info = (message: string) => toast(message, "info");

const icons = { success: CheckCircle2, error: AlertCircle, info: Info };
const colors = { success: "text-success", error: "text-danger", info: "text-info" };

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const add = (t: ToastItem) => {
      setItems((prev) => [...prev.slice(-3), t]);
      setTimeout(() => setItems((prev) => prev.filter((p) => p.id !== t.id)), t.kind === "error" ? 7000 : 4500);
    };
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6">
      {items.map((t) => {
        const Icon = icons[t.kind];
        return (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm shadow-lg animate-fade-up"
          >
            <Icon className={cn("size-5 shrink-0", colors[t.kind])} aria-hidden />
            <p className="flex-1 text-ink">{t.message}</p>
            {t.action && (
              <button className="text-sm font-semibold text-accent-ink hover:underline" onClick={t.action.onClick}>
                {t.action.label}
              </button>
            )}
            <button
              className="rounded-full p-1 text-ink-4 hover:text-ink"
              onClick={() => setItems((prev) => prev.filter((p) => p.id !== t.id))}
              aria-label="Dismiss"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
