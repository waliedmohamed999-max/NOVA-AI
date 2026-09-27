"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCheck, MessageSquareText, Megaphone, PenSquare, RefreshCw, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { openCommand } from "@/features/command/store";
import { refreshBrief } from "./actions";

export function RefreshBriefButton() {
  const t = useTranslations("app.home");
  const te = useTranslations("errors");
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      variant="ghost"
      loading={pending}
      icon={<RefreshCw className="size-3.5" />}
      onClick={() =>
        start(async () => {
          const res = await refreshBrief({});
          if (!res.ok) toast.error(te(res.error as "unexpected"));
        })
      }
    >
      {t("briefRefresh")}
    </Button>
  );
}

export function QuickActions() {
  const t = useTranslations("app.home.quick");
  const router = useRouter();
  const actions = [
    { key: "create", icon: PenSquare, run: () => openCommand(t("prompts.create")) },
    { key: "campaign", icon: Megaphone, run: () => openCommand(t("prompts.campaign")) },
    { key: "approvals", icon: CheckCheck, run: () => router.push("/approvals") },
    { key: "opportunities", icon: Search, run: () => openCommand(t("prompts.opportunities"), { autoSubmit: true }) },
    { key: "leads", icon: Users, run: () => router.push("/leads") },
    { key: "ask", icon: MessageSquareText, run: () => openCommand() },
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {actions.map(({ key, icon: Icon, run }) => (
        <button
          key={key}
          onClick={run}
          className="group flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 text-start text-sm font-medium text-ink-2 shadow-xs transition hover:border-line-strong hover:text-ink hover:shadow-sm"
        >
          <Icon className="size-[18px] shrink-0 text-ink-3 transition group-hover:text-accent" aria-hidden />
          {t(key)}
        </button>
      ))}
    </div>
  );
}
