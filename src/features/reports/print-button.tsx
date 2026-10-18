"use client";

import { useTranslations } from "next-intl";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Prints only the report (see data-print-root in globals.css); "Save as PDF" in the print dialog exports it. */
export function PrintButton() {
  const t = useTranslations("settings.reports");
  return (
    <Button variant="secondary" size="sm" icon={<Printer className="size-4" />} onClick={() => window.print()}>
      {t("print")}
    </Button>
  );
}
