"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Check } from "lucide-react";
import { AgentMark } from "@/components/agents/agent-mark";
import type { AgentKey } from "@/generated/prisma/enums";

const FEED: { agent: AgentKey; key: string }[] = [
  { agent: "SOCIAL_MANAGER", key: "social" },
  { agent: "DESIGNER", key: "designer" },
  { agent: "PERFORMANCE_ANALYST", key: "analyst" },
  { agent: "SALES_AGENT", key: "sales" },
];

/** A calm, simulated product surface — clearly illustrative, never presented as real data. */
export function HeroWorkspace() {
  const t = useTranslations("landing.workspace");
  const tc = useTranslations("common");
  const reduce = useReducedMotion();
  const [count, setCount] = useState(reduce ? FEED.length : 1);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setCount((c) => (c >= FEED.length ? 1 : c + 1)), 2400);
    return () => clearInterval(id);
  }, [reduce]);

  return (
    <div className="relative animate-fade-up [animation-delay:150ms]">
      <div className="absolute -inset-6 rounded-[44px] ai-aura blur-2xl" aria-hidden />
      <div className="relative overflow-hidden rounded-[30px] border border-line bg-surface shadow-lg" role="img" aria-label={t("label")}>
        <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="ms-3 text-xs font-medium text-ink-3">{t("title")}</span>
        </div>
        <div className="space-y-3 p-5 sm:p-6">
          <div className="rounded-2xl bg-sunken px-4 py-3 text-sm text-ink-2">✦ {t("prompt")}</div>
          <AnimatePresence initial={false}>
            {FEED.slice(0, count).map((f) => (
              <motion.div
                key={f.key}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-3.5 shadow-xs"
              >
                <AgentMark agent={f.agent} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-ink-3">{tc(`agents.${f.agent}.name`)}</div>
                  <div className="text-[15px] font-medium text-ink">{t(`items.${f.key}`)}</div>
                </div>
                <Check className="mt-1 size-4 text-success" />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

const EVENTS = ["planned", "connected", "analyzed", "approved", "scheduled", "followed", "booked"] as const;

export function ActivityStrip() {
  const t = useTranslations("landing.activity");
  return (
    <div className="relative border-y border-line bg-surface/60 backdrop-blur" aria-label={t("label")}>
      <ul className="mx-auto flex max-w-7xl flex-wrap justify-center gap-x-8 gap-y-3 px-5 py-5 lg:px-8">
        {EVENTS.map((e, i) => (
          <motion.li
            key={e}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08 }}
            className="flex items-center gap-2 text-sm text-ink-2"
          >
            <span className="size-1.5 rounded-full bg-accent" /> {t(e)}
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

export function BrainDiagram({ items, center }: { items: string[]; center: string }) {
  const reduce = useReducedMotion();
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[460px]" aria-hidden>
      <motion.div className="absolute inset-0 rounded-full border border-dashed border-line-strong" animate={reduce ? undefined : { rotate: 360 }} transition={{ duration: 60, repeat: Infinity, ease: "linear" }} />
      <div className="absolute inset-[18%] rounded-full border border-line" />
      <div className="absolute inset-[34%] flex items-center justify-center rounded-full bg-ink text-center text-ink-inverse shadow-lg">
        <div className="absolute inset-0 rounded-full shadow-[0_0_90px_var(--accent-glow)]" />
        <span className="relative px-4 text-sm font-semibold">{center}</span>
      </div>
      {items.map((label, i) => {
        const angle = (i / items.length) * Math.PI * 2 - Math.PI / 2;
        const x = 50 + Math.cos(angle) * 44;
        const y = 50 + Math.sin(angle) * 44;
        return (
          <motion.span
            key={label}
            className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 shadow-sm"
            style={{ left: `${x}%`, top: `${y}%` }}
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 + i * 0.07 }}
          >
            {label}
          </motion.span>
        );
      })}
    </div>
  );
}
