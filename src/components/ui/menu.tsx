"use client";

import * as M from "@radix-ui/react-dropdown-menu";
import * as T from "@radix-ui/react-tooltip";
import * as P from "@radix-ui/react-popover";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export const MenuGroup = M.Group;

export function MenuContent({ className, align = "end", ...props }: ComponentPropsWithoutRef<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={8}
        className={cn(
          "z-50 min-w-52 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-lg data-[state=open]:animate-[fade-up_.18s_var(--ease-out-soft)]",
          className,
        )}
        {...props}
      />
    </M.Portal>
  );
}

export function MenuItem({ className, icon, children, tone, ...props }: ComponentPropsWithoutRef<typeof M.Item> & { icon?: ReactNode; tone?: "danger" }) {
  return (
    <M.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-ink-2 outline-none data-[highlighted]:bg-sunken data-[highlighted]:text-ink data-[disabled]:opacity-50",
        tone === "danger" && "text-danger data-[highlighted]:text-danger",
        className,
      )}
      {...props}
    >
      {icon && <span className="text-ink-3 [&_svg]:size-4">{icon}</span>}
      {children}
    </M.Item>
  );
}

export function MenuLabel({ className, ...props }: ComponentPropsWithoutRef<typeof M.Label>) {
  return <M.Label className={cn("px-3 pb-1 pt-2 text-xs font-medium text-ink-3", className)} {...props} />;
}

export function MenuSeparator() {
  return <M.Separator className="my-1.5 h-px bg-line" />;
}

export const TooltipProvider = T.Provider;

export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Root delayDuration={250}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-50 rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium text-ink-inverse shadow-md">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverClose = P.Close;

export function PopoverContent({ className, align = "end", ...props }: ComponentPropsWithoutRef<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={8}
        className={cn("z-50 rounded-2xl border border-line bg-surface shadow-lg focus:outline-none data-[state=open]:animate-[fade-up_.18s_var(--ease-out-soft)]", className)}
        {...props}
      />
    </P.Portal>
  );
}
