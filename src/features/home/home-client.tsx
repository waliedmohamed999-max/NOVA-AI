"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
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
