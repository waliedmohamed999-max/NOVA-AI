/**
 * WhatsApp rules that decide what NOVA may do on its own — pure functions (no I/O), unit tested.
 *
 *  - 24h customer-service window: free-form messages only within 24h of the customer's last message;
 *    outside it only an APPROVED template may be sent. No bypass.
 *  - Auto-reply levels: OFF (no AI) · DRAFT (NOVA prepares, a human sends) · SAFE_AUTO (only safe FAQ
 *    intents answered from the Company Brain) · CUSTOM (the workspace's approval policies).
 *  - Sensitive topics (price negotiation, discounts, contracts, complaints, legal, refunds, custom quotes,
 *    sensitive claims) are never sent without a human.
 */

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function windowState(lastInboundAt: Date | null | undefined, now = new Date()) {
  if (!lastInboundAt) return { open: false, closesAt: null as Date | null };
  const closesAt = new Date(lastInboundAt.getTime() + SERVICE_WINDOW_MS);
  return { open: closesAt.getTime() > now.getTime(), closesAt };
}

export const AUTO_REPLY_LEVELS = ["OFF", "DRAFT", "SAFE_AUTO", "CUSTOM"] as const;
export type AutoReplyLevel = (typeof AUTO_REPLY_LEVELS)[number];
export const parseLevel = (v: string | null | undefined): AutoReplyLevel => ((AUTO_REPLY_LEVELS as readonly string[]).includes(v ?? "") ? (v as AutoReplyLevel) : "DRAFT");

export const SAFE_INTENTS = ["greeting", "opening_hours", "location", "services_info", "contact_details", "booking_info"] as const;
export const SENSITIVE_INTENTS = ["pricing", "discount", "proposal", "contract", "complaint", "legal", "refund"] as const;
export type WaIntent = (typeof SAFE_INTENTS)[number] | (typeof SENSITIVE_INTENTS)[number] | "opt_out" | "opt_in" | "other";

const RULES: [WaIntent, RegExp][] = [
  ["opt_out", /^\s*(stop|unsubscribe|cancel|opt[\s-]?out|إلغاء|الغاء|ايقاف|إيقاف|الغاء الاشتراك|إلغاء الاشتراك|لا ترسل|توقف)\s*[.!]?\s*$/i],
  ["opt_in", /^\s*(start|subscribe|اشتراك|اشترك|ابدأ)\s*[.!]?\s*$/i],
  ["refund", /(refund|money back|استرداد|استرجاع (المبلغ|الفلوس)|رجع(وا)? فلوسي)/i],
  ["legal", /(lawyer|legal|lawsuit|court|محامي|قضية|قانوني|محكمة)/i],
  ["complaint", /(complain|complaint|angry|terrible|worst|disappointed|شكوى|اشتكي|سيء جدا|زعلان|مستاء|متضايق)/i],
  ["contract", /(contract|agreement|terms and conditions|عقد|اتفاقية|شروط التعاقد)/i],
  ["discount", /(discount|coupon|promo code|cheaper|خصم|تخفيض|كوبون|أرخص|ارخص)/i],
  ["proposal", /(proposal|quotation|quote|عرض سعر|عرض فني|تسعيرة)/i],
  ["pricing", /(price|pricing|cost|how much|fees|سعر|أسعار|اسعار|تكلفة|بكام|كم سعر|كم يكلف|كم التكلفة)/i],
  ["opening_hours", /(opening hours|open today|working hours|business hours|when do you open|مواعيد العمل|ساعات العمل|مواعيد الدوام|متى تفتحون|امتى تفتحوا|الدوام)/i],
  ["location", /(where are you|address|location|directions|العنوان|مكانكم|وين موقعكم|فين مكانكم|موقعكم|لوكيشن)/i],
  ["contact_details", /(phone number|contact you|email address|رقم التليفون|رقم الهاتف|رقم التواصل|الايميل|البريد)/i],
  ["booking_info", /(book|booking|appointment|reservation|حجز|احجز|موعد)/i],
  ["services_info", /(services|what do you (offer|do)|products|خدماتكم|الخدمات|ماذا تقدمون|ايش تقدمون|منتجاتكم)/i],
  ["greeting", /^\s*(hi|hello|hey|good (morning|evening)|السلام عليكم|سلام|مرحبا|مرحبًا|هلا|أهلا|اهلا|صباح الخير|مساء الخير)\s*[!.،,]?\s*$/i],
];

/** Local intent of an inbound message (no AI). Sensitive rules are checked before safe ones. */
export function classifyIntent(text: string | null | undefined): WaIntent {
  const t = (text ?? "").trim();
  if (!t) return "other";
  for (const [intent, re] of RULES) if (re.test(t)) return intent;
  return "other";
}

export const isSensitive = (i: WaIntent | string | null | undefined) => (SENSITIVE_INTENTS as readonly string[]).includes(i ?? "");
export const isSafe = (i: WaIntent | string | null | undefined, allowed: readonly string[] = SAFE_INTENTS) => (allowed as readonly string[]).includes(i ?? "") && (SAFE_INTENTS as readonly string[]).includes(i ?? "");

/** Extra opt-out words a workspace configured (exact match, case-insensitive). */
export function isOptOut(text: string | null | undefined, extra: string[] = []) {
  const t = (text ?? "").trim().toLowerCase();
  return classifyIntent(t) === "opt_out" || extra.some((w) => w.trim() && t === w.trim().toLowerCase());
}

export type ReplyDecision = { action: "none" | "draft" | "auto_send"; needsHuman: boolean; reason: string };

/**
 * What happens to an inbound message's reply. `answer` says whether an answer exists and where it came
 * from ("brain" = approved fact/FAQ; "ai" = model draft). AI-written text is never auto-sent.
 */
export function decideReply(input: { level: AutoReplyLevel; intent: WaIntent; answer: "brain" | "ai" | null; windowOpen: boolean; optedOut: boolean; safeIntents?: readonly string[]; policyAllowsAuto?: boolean }): ReplyDecision {
  const { level, intent, answer, windowOpen, optedOut } = input;
  if (intent === "opt_out" || intent === "opt_in") return { action: "none", needsHuman: false, reason: intent };
  if (optedOut) return { action: "none", needsHuman: true, reason: "opted_out" };
  if (level === "OFF") return { action: "none", needsHuman: true, reason: "level_off" };
  const sensitive = isSensitive(intent);
  if (!answer) return { action: "none", needsHuman: true, reason: sensitive ? `sensitive:${intent}` : "no_answer" };
  if (sensitive) return { action: "draft", needsHuman: true, reason: `sensitive:${intent}` };
  if (level === "DRAFT") return { action: "draft", needsHuman: true, reason: "level_draft" };
  if (!windowOpen) return { action: "draft", needsHuman: true, reason: "window_closed" };
  if (answer !== "brain") return { action: "draft", needsHuman: true, reason: "ai_text_needs_review" };
  if (level === "SAFE_AUTO") return isSafe(intent, input.safeIntents) ? { action: "auto_send", needsHuman: false, reason: `safe:${intent}` } : { action: "draft", needsHuman: true, reason: `not_safe:${intent}` };
  // CUSTOM: the workspace's approval policies decide, but only for safe intents answered from the brain.
  return input.policyAllowsAuto && isSafe(intent, input.safeIntents) ? { action: "auto_send", needsHuman: false, reason: `policy:${intent}` } : { action: "draft", needsHuman: true, reason: "policy_review" };
}

// ── Template variables: {{1}} … {{n}}, sequential, each mapped to a CRM field ──

export const VARIABLE_SOURCES = ["customer_name", "company", "appointment", "order", "quote_amount", "agent_name", "static"] as const;
export type VariableSource = (typeof VARIABLE_SOURCES)[number];

export function templateVariables(body: string): number[] {
  return [...new Set([...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}

/** Meta requires {{1}}..{{n}} without gaps. */
export function variablesSequential(body: string) {
  const v = templateVariables(body);
  return v.every((n, i) => n === i + 1);
}

export function renderTemplate(body: string, values: string[]) {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) => values[Number(n) - 1] ?? `{{${n}}}`);
}

export const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;
