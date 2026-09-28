/**
 * Sales Desk intelligence — pure functions (no DB, no AI), unit tested.
 * Every number and every "why" shown in the Sales Desk comes from here or from direct DB counts.
 * Nothing is estimated: unknown values stay unknown (null), and insights only fire when the data supports them.
 */

export const OPEN_STAGES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION"] as const;
export const isOpen = (stage: string) => (OPEN_STAGES as readonly string[]).includes(stage);

const DAY = 86_400_000;
const daysBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / DAY);

// ── Follow-up signals: "why does this need follow-up?" ──

export type SignalKind = "followup_overdue" | "unanswered_question" | "proposal_no_response" | "hot_no_next_step" | "no_contact" | "stalled";
export type Signal = { kind: SignalKind; days: number; severity: "high" | "medium" };

export type SignalLead = {
  stage: string;
  temperature: string;
  createdAt: Date;
  stageChangedAt: Date;
  lastContactAt: Date | null;
  nextActionAt: Date | null;
  /** Open (not done, not paused) follow-ups. */
  openFollowUps: { dueAt: Date | null }[];
  /** Latest message in any conversation with this lead. */
  lastMessage: { direction: "INBOUND" | "OUTBOUND"; at: Date } | null;
  /** When a quote was last sent (Quote entity), if any. */
  quoteSentAt?: Date | null;
};

export const SIGNAL_RULES = { noContactDays: 5, proposalDays: 3, stalledDays: 14, unansweredHours: 24 };

/** Deterministic follow-up signals for an open lead, most urgent first. */
export function leadSignals(l: SignalLead, now = new Date(), rules = SIGNAL_RULES): Signal[] {
  if (!isOpen(l.stage)) return [];
  const out: Signal[] = [];
  const overdue = l.openFollowUps.filter((f) => f.dueAt && f.dueAt < now).map((f) => f.dueAt!);
  if (overdue.length) out.push({ kind: "followup_overdue", days: daysBetween(new Date(Math.min(...overdue.map((d) => d.getTime()))), now), severity: "high" });
  if (l.lastMessage?.direction === "INBOUND" && now.getTime() - l.lastMessage.at.getTime() >= rules.unansweredHours * 3_600_000) {
    out.push({ kind: "unanswered_question", days: daysBetween(l.lastMessage.at, now), severity: "high" });
  }
  const proposalSince = l.quoteSentAt ?? (l.stage === "PROPOSAL" ? l.stageChangedAt : null);
  const repliedSince = l.lastMessage?.direction === "INBOUND" && proposalSince && l.lastMessage.at > proposalSince;
  if (proposalSince && !repliedSince && daysBetween(proposalSince, now) >= rules.proposalDays) {
    out.push({ kind: "proposal_no_response", days: daysBetween(proposalSince, now), severity: "high" });
  }
  const hasNextStep = l.openFollowUps.length > 0 || (l.nextActionAt != null && l.nextActionAt >= new Date(now.getTime() - DAY));
  if (l.temperature === "HOT" && !hasNextStep) out.push({ kind: "hot_no_next_step", days: daysBetween(l.createdAt, now), severity: "high" });
  const lastTouch = l.lastContactAt ?? l.createdAt;
  if (daysBetween(lastTouch, now) >= rules.noContactDays) out.push({ kind: "no_contact", days: daysBetween(lastTouch, now), severity: "medium" });
  if (daysBetween(l.stageChangedAt, now) >= rules.stalledDays && l.stage !== "NEW") out.push({ kind: "stalled", days: daysBetween(l.stageChangedAt, now), severity: "medium" });
  return out;
}

// ── Temperature: level + explicit reasons (no 0–100 number in the UI) ──

export type TempReason = "recent_reply" | "buying_intent" | "quote_requested" | "meeting" | "urgency" | "repeat_contact" | "business_email" | "value_known" | "no_recent_activity";

/** Reasons behind a lead's temperature, from explicit signals only. */
export function temperatureReasons(i: {
  scoreReasons: string[];
  lastInboundAt: Date | null;
  stage: string;
  hasQuote: boolean;
  hasMeeting: boolean;
  inboundCount: number;
  lastContactAt: Date | null;
  createdAt: Date;
  urgent: boolean;
  now?: Date;
}): TempReason[] {
  const now = i.now ?? new Date();
  const r: TempReason[] = [];
  if (i.lastInboundAt && daysBetween(i.lastInboundAt, now) <= 3) r.push("recent_reply");
  if (i.scoreReasons.includes("buying_intent")) r.push("buying_intent");
  if (i.hasQuote || i.stage === "PROPOSAL" || i.stage === "NEGOTIATION") r.push("quote_requested");
  if (i.hasMeeting) r.push("meeting");
  if (i.urgent) r.push("urgency");
  if (i.inboundCount >= 2) r.push("repeat_contact");
  if (i.scoreReasons.includes("business_email")) r.push("business_email");
  if (i.scoreReasons.includes("value_known")) r.push("value_known");
  if (!r.length && daysBetween(i.lastContactAt ?? i.createdAt, now) >= 14) r.push("no_recent_activity");
  return r;
}

export const URGENCY = /\b(asap|urgent|this week|today|immediately|deadline)\b|(عاجل|بسرعة|هذا الأسبوع|اليوم|فورًا|فورا)/i;

// ── Money: value per lead, forecast ──

export type Money = { cents: number; currency: string };

/**
 * A lead's deal value: the sum of its open opportunities that have a value; otherwise the lead's own
 * estimate; otherwise unknown (null). Never 0 for "unknown".
 */
export function leadValue(lead: { estimatedValueCents: number | null; currency: string }, opps: { valueCents: number | null; currency: string; status: string }[], status: "OPEN" | "WON" = "OPEN"): Money | null {
  const known = opps.filter((o) => o.status === status && o.valueCents != null);
  if (known.length) return { cents: known.reduce((a, o) => a + o.valueCents!, 0), currency: known[0].currency };
  return lead.estimatedValueCents != null ? { cents: lead.estimatedValueCents, currency: lead.currency } : null;
}

export type ForecastLead = { stage: string; value: Money | null };
export type Forecast = {
  /** null = no open lead has a known value. */
  pipeline: Money | null;
  weighted: Money | null;
  won: Money | null;
  openCount: number;
  openWithValue: number;
  wonCount: number;
  wonWithValue: number;
  /** Values in other currencies aren't summed into the main one. */
  otherCurrencies: string[];
};

/** Weighted = value × stage probability, only where both are known. */
export function forecast(leads: ForecastLead[], probability: Record<string, number | undefined>, currency: string): Forecast {
  const open = leads.filter((l) => isOpen(l.stage));
  const won = leads.filter((l) => l.stage === "WON");
  const other = new Set<string>();
  const inCur = (xs: ForecastLead[]) =>
    xs.filter((l) => {
      if (!l.value) return false;
      if (l.value.currency !== currency) {
        other.add(l.value.currency);
        return false;
      }
      return true;
    });
  const openV = inCur(open);
  const wonV = inCur(won);
  const weightedRows = openV.filter((l) => probability[l.stage] != null);
  const sum = (xs: ForecastLead[], f: (l: ForecastLead) => number) => (xs.length ? { cents: Math.round(xs.reduce((a, l) => a + f(l), 0)), currency } : null);
  return {
    pipeline: sum(openV, (l) => l.value!.cents),
    weighted: sum(weightedRows, (l) => (l.value!.cents * probability[l.stage]!) / 100),
    won: sum(wonV, (l) => l.value!.cents),
    openCount: open.length,
    openWithValue: open.filter((l) => l.value).length,
    wonCount: won.length,
    wonWithValue: won.filter((l) => l.value).length,
    otherCurrencies: [...other],
  };
}

// ── Insights (rules over real data; each one explains itself) ──

export type Insight = { key: "stale_open" | "overdue_followups" | "hot_without_step" | "top_source" | "high_value_slower"; params: Record<string, string | number>; leadIds: string[]; action: "followups" | "hot" | "pipeline" | "customers" };

export function salesInsights(
  leads: { id: string; stage: string; temperature: string; source: string | null; createdAt: Date; stageChangedAt: Date; value: Money | null; signals: Signal[] }[],
  now = new Date(),
): Insight[] {
  const out: Insight[] = [];
  const open = leads.filter((l) => isOpen(l.stage));
  const stale = open.filter((l) => l.signals.some((s) => s.kind === "no_contact"));
  if (stale.length) out.push({ key: "stale_open", params: { count: stale.length, days: SIGNAL_RULES.noContactDays }, leadIds: stale.map((l) => l.id), action: "followups" });
  const overdue = open.filter((l) => l.signals.some((s) => s.kind === "followup_overdue"));
  if (overdue.length) out.push({ key: "overdue_followups", params: { count: overdue.length }, leadIds: overdue.map((l) => l.id), action: "followups" });
  const hot = open.filter((l) => l.signals.some((s) => s.kind === "hot_no_next_step"));
  if (hot.length) out.push({ key: "hot_without_step", params: { count: hot.length }, leadIds: hot.map((l) => l.id), action: "hot" });

  // Source concentration: only with ≥5 qualified leads in 30 days and one source ≥ 50%.
  const qualified = leads.filter((l) => ["QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON"].includes(l.stage) && now.getTime() - l.createdAt.getTime() <= 30 * DAY && l.source);
  if (qualified.length >= 5) {
    const by = new Map<string, string[]>();
    for (const l of qualified) by.set(l.source!, [...(by.get(l.source!) ?? []), l.id]);
    const [source, ids] = [...by.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (ids.length / qualified.length >= 0.5) out.push({ key: "top_source", params: { source, count: ids.length, total: qualified.length }, leadIds: ids, action: "customers" });
  }

  // Higher-value deals sitting longer in Proposal: ≥3 per group and ≥30% slower.
  const inProposal = open.filter((l) => l.stage === "PROPOSAL" && l.value);
  if (inProposal.length >= 6) {
    const sorted = [...inProposal].sort((a, b) => a.value!.cents - b.value!.cents);
    const mid = Math.floor(sorted.length / 2);
    const low = sorted.slice(0, mid);
    const high = sorted.slice(mid);
    const avgDays = (xs: typeof sorted) => xs.reduce((a, l) => a + (now.getTime() - l.stageChangedAt.getTime()) / DAY, 0) / xs.length;
    const [lowD, highD] = [avgDays(low), avgDays(high)];
    if (low.length >= 3 && high.length >= 3 && lowD > 0 && highD >= lowD * 1.3) {
      out.push({ key: "high_value_slower", params: { threshold: Math.round(high[0].value!.cents / 100), currency: high[0].value!.currency, highDays: Math.round(highD), lowDays: Math.round(lowD) }, leadIds: high.map((l) => l.id), action: "pipeline" });
    }
  }
  return out;
}

// ── CSV import (client + server share this parser) ──

/** RFC 4180-ish CSV parser: quoted fields, escaped quotes, CRLF/LF, BOM, comma or semicolon. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((x) => x.trim())) rows.push(row.map((x) => x.trim()));
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row.map((x) => x.trim()));
  return rows;
}

export const IMPORT_FIELDS = ["name", "company", "email", "phone", "source", "value", "notes", "tags"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Guesses a column mapping from header names (EN/AR). */
export function guessMapping(headers: string[]): Record<number, ImportField | null> {
  const rules: [ImportField, RegExp][] = [
    ["email", /e-?mail|بريد|ايميل|إيميل/i],
    ["phone", /phone|mobile|tel|whats|هاتف|جوال|موبايل|رقم/i],
    ["company", /company|organi[sz]ation|business|شركة|مؤسسة|جهة/i],
    ["name", /^(full ?)?name$|contact|الاسم|اسم/i],
    ["source", /source|channel|المصدر|القناة/i],
    ["value", /value|amount|budget|deal|القيمة|المبلغ|الميزانية/i],
    ["tags", /tags?|labels?|وسوم|تصنيف/i],
    ["notes", /notes?|comment|message|ملاحظ|رسالة/i],
  ];
  const used = new Set<ImportField>();
  return Object.fromEntries(
    headers.map((h, i) => {
      const hit = rules.find(([f, re]) => !used.has(f) && re.test(h));
      if (hit) used.add(hit[0]);
      return [i, hit ? hit[0] : null];
    }),
  );
}
