"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, PlusCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { LogoMark } from "@/components/brand/logo";

export const SHOWCASE_KEYS = ["home", "content", "calendar", "sales", "whatsapp", "analytics", "approvals"] as const;
type Key = (typeof SHOWCASE_KEYS)[number];

/**
 * Reference hero centrepiece: a list of product areas on the left and the real product on the right
 * (screenshots of NOVA's own demo workspace, one per area), with a floating "Brain" chip wearing the
 * page's single rainbow border. Rotates on its own until the visitor picks an area.
 */
export function ProductShowcase() {
  const t = useTranslations("landing.v2.showcase");
  const locale = useLocale() === "ar" ? "ar" : "en";
  const [active, setActive] = useState<Key>("home");
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => setActive((k) => SHOWCASE_KEYS[(SHOWCASE_KEYS.indexOf(k) + 1) % SHOWCASE_KEYS.length]), 4200);
    return () => clearInterval(id);
  }, [auto]);

  return (
    <section id="product" aria-label={t("label")} className="relative border-t border-line">
      <div className="mx-auto grid max-w-[1200px] lg:grid-cols-[200px_minmax(0,1fr)]">
        <ul className="flex gap-1 overflow-x-auto border-line px-5 py-4 scrollbar-none lg:flex-col lg:gap-0 lg:border-x lg:px-5 lg:py-5">
          {SHOWCASE_KEYS.map((k) => {
            const on = k === active;
            return (
              <li key={k} className="shrink-0">
                <button
                  onClick={() => {
                    setAuto(false);
                    setActive(k);
                  }}
                  aria-pressed={on}
                  className={cn(
                    "flex items-center gap-2.5 rounded-full py-1.5 pe-3 text-[15px] font-medium transition-colors duration-150 lg:w-full lg:py-2",
                    on ? "text-nova-blue" : "text-ink-3 hover:text-ink",
                  )}
                >
                  {on ? <CheckCircle2 className="size-[18px] fill-nova-blue text-white" aria-hidden /> : <PlusCircle className="size-[18px] text-ink-4" aria-hidden />}
                  {t(`items.${k}`)}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="relative overflow-hidden border-line px-5 pt-2 lg:border-e lg:px-0 lg:ps-2 lg:pt-2">
          <div className="relative aspect-[1440/860] overflow-hidden rounded-t-[12px] border border-b-0 border-line bg-surface-2 shadow-product">
            {SHOWCASE_KEYS.map((k) => (
              // eslint-disable-next-line @next/next/no-img-element -- static product screenshots, sized by the frame
              <img
                key={k}
                src={`/landing/${locale}-${k}.jpg`}
                alt={t(`items.${k}`)}
                loading={k === "home" ? "eager" : "lazy"}
                className={cn("absolute inset-0 size-full object-cover object-top transition-opacity duration-500 ease-[var(--ease-out-soft)]", k === active ? "opacity-100" : "opacity-0")}
              />
            ))}
          </div>
          <div className="absolute bottom-10 end-8 z-10 hidden sm:block">
            <div className="rainbow-border rounded-[16px]">
            <div className="flex items-center gap-3 rounded-[16px] bg-surface px-4 py-3 shadow-float">
              <LogoMark size={34} />
              <div className="leading-tight">
                <div className="text-[17px] font-semibold text-ink">{t("chip.title")}</div>
                <div className="bg-[linear-gradient(83deg,#40ddff,#7612fa_51%,#fa12e3)] bg-clip-text text-[13px] font-medium text-transparent">{t("chip.status")}</div>
              </div>
            </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
