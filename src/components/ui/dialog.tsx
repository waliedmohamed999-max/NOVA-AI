"use client";

import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

type ContentProps = {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  hideTitle?: boolean;
};

const widths = { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" };

/** Centered on desktop, bottom sheet on mobile. */
export function DialogContent({ title, description, children, footer, className, size = "md", hideTitle }: ContentProps) {
  const t = useTranslations("common.actions");
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-[fade-up_.2s_ease-out]" />
      <D.Content
        className={cn(
          "fixed z-50 flex max-h-[92dvh] w-full flex-col overflow-hidden border border-line bg-surface shadow-lg focus:outline-none",
          "inset-x-0 bottom-0 rounded-t-[26px] sm:inset-auto sm:start-1/2 sm:top-1/2 sm:-translate-y-1/2 sm:rounded-[26px] ltr:sm:-translate-x-1/2 rtl:sm:translate-x-1/2",
          "data-[state=open]:animate-[fade-up_.28s_var(--ease-out-soft)]",
          widths[size],
          className,
        )}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line-strong sm:hidden" aria-hidden />
        <div className={cn("flex items-start justify-between gap-4 px-6 pt-5 sm:pt-6", hideTitle && "sr-only")}>
          <div className="space-y-1">
            <D.Title className="text-lg font-semibold tracking-tight">{title}</D.Title>
            {description ? <D.Description className="text-sm text-ink-3">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close className="-me-2 -mt-1 rounded-full p-2 text-ink-3 hover:bg-sunken hover:text-ink" aria-label={t("close")}>
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-2 px-6 py-4">{footer}</div>}
      </D.Content>
    </D.Portal>
  );
}

/** Side panel (end side), full-screen on mobile. */
export function SheetContent({ title, description, children, footer, className }: Omit<ContentProps, "size">) {
  const t = useTranslations("common.actions");
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-overlay" />
      <D.Content
        className={cn(
          "fixed inset-y-0 end-0 z-50 flex w-full flex-col border-s border-line bg-surface shadow-lg focus:outline-none sm:max-w-xl",
          "data-[state=open]:animate-[fade-up_.25s_var(--ease-out-soft)]",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0 space-y-1">
            <D.Title className="truncate text-lg font-semibold tracking-tight">{title}</D.Title>
            {description ? <D.Description className="text-sm text-ink-3">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close className="-me-2 rounded-full p-2 text-ink-3 hover:bg-sunken hover:text-ink" aria-label={t("close")}>
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </D.Content>
    </D.Portal>
  );
}
