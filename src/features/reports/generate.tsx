"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { generateWeekly } from "./actions";

export function GenerateReportButton() {
  const t = useTranslations("settings.reports");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      loading={pending}
      icon={<FileText className="size-4" />}
      onClick={() =>
        start(async () => {
          const r = await generateWeekly({});
          if (r.ok) router.push(`/reports/${r.data.id}`);
          else toast.error(te(r.error as "unexpected"));
        })
      }
    >
      {t("generate")}
    </Button>
  );
}
