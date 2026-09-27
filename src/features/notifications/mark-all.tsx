"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markNotificationsRead } from "./actions";

export function MarkAllRead() {
  const t = useTranslations("app.notifications");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="secondary" loading={pending} icon={<CheckCheck className="size-4" />} onClick={() => start(async () => { await markNotificationsRead({}); router.refresh(); })}>
      {t("markAll")}
    </Button>
  );
}
