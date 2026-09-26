import type { AgentKey } from "@/generated/prisma/enums";

/**
 * The AI Growth Team roster. Presentation metadata only — behaviour lives in
 * src/server/agents. `accent` maps to design tokens (--agent-*).
 */
export type AgentMeta = {
  key: AgentKey;
  accent: "social" | "content" | "design" | "analyst" | "sales" | "assistant";
  icon: "Sparkles" | "PenLine" | "Palette" | "LineChart" | "Handshake" | "ClipboardList";
  team: "social" | "sales";
};

export const AGENTS: AgentMeta[] = [
  { key: "SOCIAL_MANAGER", accent: "social", icon: "Sparkles", team: "social" },
  { key: "CONTENT_STRATEGIST", accent: "content", icon: "PenLine", team: "social" },
  { key: "DESIGNER", accent: "design", icon: "Palette", team: "social" },
  { key: "PERFORMANCE_ANALYST", accent: "analyst", icon: "LineChart", team: "social" },
  { key: "SALES_AGENT", accent: "sales", icon: "Handshake", team: "sales" },
  { key: "SALES_ASSISTANT", accent: "assistant", icon: "ClipboardList", team: "sales" },
];

export const AGENT_BY_KEY = Object.fromEntries(AGENTS.map((a) => [a.key, a])) as Record<AgentKey, AgentMeta>;

export const AGENT_DEFAULT_NAMES: Record<AgentKey, { en: string; ar: string }> = {
  SOCIAL_MANAGER: { en: "AI Social Manager", ar: "مدير التواصل الذكي" },
  CONTENT_STRATEGIST: { en: "Content Strategist", ar: "استراتيجي المحتوى" },
  DESIGNER: { en: "AI Designer", ar: "المصمم الذكي" },
  PERFORMANCE_ANALYST: { en: "Performance Analyst", ar: "محلل الأداء" },
  SALES_AGENT: { en: "AI Sales Agent", ar: "وكيل المبيعات الذكي" },
  SALES_ASSISTANT: { en: "Sales Assistant", ar: "مساعد المبيعات" },
};
