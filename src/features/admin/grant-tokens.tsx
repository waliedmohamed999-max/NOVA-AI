"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { grantTokensAction } from "./actions";

/** Inline "add tokens" for one organization (platform admins). */
export function GrantTokens({ organizationId }: { organizationId: string }) {
  const t = useTranslations("settings.admin.tokens");
  const te = useTranslations("errors");
  const router = useRouter();
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  const tokens = Number(value);
  return (
    <div className="flex items-center gap-1.5">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
        inputMode="numeric"
        placeholder={t("grantPlaceholder")}
        aria-label={t("grantPlaceholder")}
        className="h-8 w-28 rounded-[8px] border border-line bg-surface px-2 text-xs tabular focus:border-line-strong focus:outline-none"
        dir="ltr"
      />
      <Button
        size="icon-sm"
        variant="secondary"
        loading={pending}
        disabled={!tokens || tokens < 1000}
        aria-label={t("grant")}
        icon={<Plus className="size-4" />}
        onClick={() =>
          start(async () => {
            const r = await grantTokensAction({ organizationId, tokens });
            if (r.ok) {
              toast(t("granted"));
              setValue("");
              router.refresh();
            } else toast.error(te((r.error ?? "unexpected") as "unexpected"));
          })
        }
      />
    </div>
  );
}
