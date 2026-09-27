import { ClipboardList, Handshake, LineChart, Palette, PenLine, Sparkles } from "lucide-react";
import { AGENT_BY_KEY } from "@/config/agents";
import { cn } from "@/lib/cn";
import type { AgentKey } from "@/generated/prisma/enums";

const ICONS = { Sparkles, PenLine, Palette, LineChart, Handshake, ClipboardList };

const ACCENT: Record<string, { text: string; bg: string; ring: string; dot: string }> = {
  social: { text: "text-agent-social", bg: "bg-[color-mix(in_oklab,var(--agent-social)_12%,transparent)]", ring: "ring-[color-mix(in_oklab,var(--agent-social)_25%,transparent)]", dot: "bg-agent-social" },
  content: { text: "text-agent-content", bg: "bg-[color-mix(in_oklab,var(--agent-content)_13%,transparent)]", ring: "ring-[color-mix(in_oklab,var(--agent-content)_25%,transparent)]", dot: "bg-agent-content" },
  design: { text: "text-agent-design", bg: "bg-[color-mix(in_oklab,var(--agent-design)_12%,transparent)]", ring: "ring-[color-mix(in_oklab,var(--agent-design)_25%,transparent)]", dot: "bg-agent-design" },
  analyst: { text: "text-agent-analyst", bg: "bg-[color-mix(in_oklab,var(--agent-analyst)_12%,transparent)]", ring: "ring-[color-mix(in_oklab,var(--agent-analyst)_25%,transparent)]", dot: "bg-agent-analyst" },
  sales: { text: "text-agent-sales", bg: "bg-[color-mix(in_oklab,var(--agent-sales)_12%,transparent)]", ring: "ring-[color-mix(in_oklab,var(--agent-sales)_25%,transparent)]", dot: "bg-agent-sales" },
  assistant: { text: "text-agent-assistant", bg: "bg-[color-mix(in_oklab,var(--agent-assistant)_13%,transparent)]", ring: "ring-[color-mix(in_oklab,var(--agent-assistant)_25%,transparent)]", dot: "bg-agent-assistant" },
};

export function agentAccent(key: AgentKey) {
  return ACCENT[AGENT_BY_KEY[key].accent];
}

export function AgentMark({ agent, size = 40, className, working }: { agent: AgentKey; size?: number; className?: string; working?: boolean }) {
  const meta = AGENT_BY_KEY[agent];
  const Icon = ICONS[meta.icon];
  const a = ACCENT[meta.accent];
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center rounded-2xl ring-1", a.bg, a.text, a.ring, className)} style={{ width: size, height: size }} aria-hidden>
      <Icon style={{ width: size * 0.45, height: size * 0.45 }} strokeWidth={1.9} />
      {working && <span className={cn("absolute -end-0.5 -top-0.5 size-2.5 rounded-full ring-2 ring-surface animate-pulse-soft", a.dot)} />}
    </span>
  );
}
