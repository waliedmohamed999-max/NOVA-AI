import type { Permission } from "../rbac";
import type { BrainPurpose, BrainSection, Budget } from "../knowledge/company-context";
import type { Entities } from "./parse";

/**
 * CommandIntentRegistry — the single allowlist of what the Command Center can do.
 * Local patterns run first (no AI). The AI fallback may only choose one of these keys; the server then
 * re-checks permission, tenant, parameters and approval rules exactly as for a local match.
 */

export type IntentKind = "navigation" | "read" | "action" | "high_risk";
export type EntityKind = "lead" | "count" | "date" | "topic" | "body" | "file";

export type IntentDef = {
  key: IntentKey;
  kind: IntentKind;
  permission: Permission;
  /** Entities the handler cannot run without (it asks for them instead of guessing). */
  requires: EntityKind[];
  /** never = no approval; policy = the existing approval rules decide; always = never executes directly. */
  approval: "never" | "policy" | "always";
  /** none = local only; content = real (non-offline) AI; agent = the agent runtime's AI (offline provider allowed in development). */
  ai: "none" | "content" | "agent" | "images";
  route?: string;
  /**
   * Routing decided before execution (Company-Brain-first):
   * local = app/database only (AI forbidden) · brain = Company Brain only (AI forbidden) ·
   * brain_ai = selective brain context + generation · ai = generation / classification only.
   */
  mode: RoutingMode;
  /** Brain purpose → which sections are read (sales / content / support / facts). */
  brain?: BrainPurpose;
  brainSections?: BrainSection[];
  /** Context-token budget for brain_ai (default small). */
  budget?: Budget;
  /** Data the handler reads — declared for the execution plan / audit. */
  data?: string[];
  /** Brain-only answers that depend on nothing but the brain may be cached by brain version. */
  cacheable?: boolean;
  match: (n: string, hasFiles: boolean, e?: Pick<Entities, "name">) => boolean;
};

export type RoutingMode = "local" | "brain" | "ai" | "brain_ai";

const has = (re: RegExp) => (n: string) => re.test(n);
const NAV = /(^|\s)(افتح|افتحلي|افتحي|روح|روحي|وديني|خذني|اذهب|انتقل|اعرض|اعرضلي|ورني|وريني|فرجيني)(\s|$)|^(open|go to|goto|take me to|navigate to|show me the|show)\b/;
const QUESTION = /(^|\s)(مين|من هم|من هو|ايه|ايش|اش|شو|كم|ما هي|ما هو|ماهي|هل|قولي|قلي|قل لي|عرفني|محتاج|محتاجين|يحتاج|يحتاجون|تحتاج|اللي|لماذا|ليه|ليش)(\s|$)|^(who|what|which|why|how many|how much|list|tell me|do i|are there|is there)\b|\bneed\b/;
const SUMMARY = /(^|\s)(لخص|لخصلي|ملخص|حاله|وضع|اوضاع|موجز|نظره)(\s|$)|\b(summar\w*|status|overview|how (are|is|did))\b/;
const CREATE = /(^|\s)(اعمل|اعملي|انشي|انشئ|اضف|ضيف|ضف|سجل|حط|حدد|ذكرني|ابدا)(\s|$)|\b(create|add|new|schedule|set up|log|remind me|open a|start a)\b/;
const PREPARE = /(^|\s)(جهز|جهزلي|حضر|اكتب|اكتبلي|خطط|اعمل|اعملي|انشي|انشئ|ولد|صمم)(\s|$)|\b(prepare|draft|write|plan|create|make|generate)\b/;
const SEND = /(^|\s)(ابعت|ابعث|ارسل|راسل)(\s|$)|\bsend\b/;
const FOLLOW = /متابع|follow.?up|followup|تذكير|reminder/;
const WA = /واتساب|واتس اب|وتساب|واتس|whats ?app/;

const BRAIN_Q = /(^|\s)(ما|ماذا|ايه|اي|ايش|شو|وش|مين|هل|عرفني|قولي|اعرض)(\s|$)|نقدم|نقدمها|نبيع|بتاعتنا|بتاعنا|عندنا|لدينا|^(what|which|who|list|tell me|show)\b|\b(we offer|do we|our)\b/;

// No-AI allowlist (mode "local"): navigation, counts, pipeline math, follow-up dates, calendar lookup,
// approval status, customer lookup, stage updates, activity history, connected-account / provider status.
const d = (def: Omit<IntentDef, "requires" | "approval" | "ai" | "mode"> & Partial<Pick<IntentDef, "requires" | "approval" | "ai" | "mode">>): IntentDef => ({
  requires: [],
  approval: "never",
  ai: "none",
  mode: "local",
  ...def,
});
/** Company Brain factual answer: retrieval + formatted answer, never a model call. */
const brainFact = (key: IntentKey, sections: BrainSection[], match: IntentDef["match"]) =>
  d({ key, kind: "read", permission: "workspace:read", mode: "brain", brain: "facts", brainSections: sections, cacheable: true, match });

/** Order matters: the most specific / riskiest intents are tested first. */
export const INTENTS = [
  // A greeting is answered locally with what NOVA can do — never "needs AI".
  d({ key: "greeting", kind: "read", permission: "workspace:read", match: (n) => n.split(" ").length <= 4 && /^(هلا|هلو|اهلا|اهلين|مرحبا|مرحب|السلام عليكم|سلام|صباح الخير|مساء الخير|hi|hello|hey|good (morning|evening|afternoon))(\s|$)/.test(n) }),
  // ── High-risk ──
  d({ key: "delete_anything", kind: "high_risk", permission: "workspace:read", approval: "always", match: has(/(^|\s)(احذف|امسح|شيل|الغي)(\s|$)|\b(delete|remove|erase|wipe)\b/) }),
  d({ key: "approve_all", kind: "high_risk", permission: "workspace:read", approval: "always", match: (n) => /(^|\s)(وافق|اعتمد|اقبل)(\s|$)|\bapprove\b/.test(n) && /(^|\s)(الكل|كل|كله|جميع)(\s|$)|\b(all|everything)\b/.test(n) }),
  d({ key: "approve_item", kind: "high_risk", permission: "workspace:read", approval: "always", route: "/approvals", match: has(/(^|\s)(وافق|اعتمد)(\s|$)|\bapprove\b/) }),
  d({ key: "publish_content", kind: "high_risk", permission: "content:publish", approval: "always", match: has(/(^|\s)(انشر|نزل|انشري)(\s|$)|\bpublish\b|\bpost (it|now|this)\b/) }),
  d({ key: "send_discount", kind: "high_risk", permission: "leads:manage", approval: "always", match: has(/خصم|تخفيض|discount/) }),
  d({ key: "send_quote", kind: "high_risk", permission: "leads:manage", approval: "policy", requires: ["lead"], match: (n) => SEND.test(n) && /عرض|quote|proposal/.test(n) }),
  d({ key: "send_message", kind: "high_risk", permission: "leads:manage", approval: "always", requires: ["lead", "body"], match: (n) => SEND.test(n) && /رساله|رسايل|واتساب|واتس|ايميل|بريد|message|whatsapp|email|text/.test(n) }),
  d({ key: "move_stage", kind: "action", permission: "leads:manage", approval: "policy", requires: ["lead"], data: ["lead"], match: (n) => /(^|\s)(انقل|حرك|حول)(\s|$)|\bmove\b/.test(n) && /مرحله|stage|تفاوض|مؤهل|عرض|تواصل|ناجح|مكسوب|خاسر|negotiat|proposal|qualified|contacted|won|lost/.test(n) }),
  d({ key: "close_deal", kind: "high_risk", permission: "leads:manage", approval: "policy", requires: ["lead"], match: (n) => /(^|\s)(اغلق|اقفل|قفل|سكر|علم)(\s|$)|\b(close|mark)\b/.test(n) && /صفقه|فرصه|deal|won|lost|كسب|خسر|مكسوب/.test(n) }),

  // ── WhatsApp (local: navigation, counts, drafts — a command never sends) ──
  d({ key: "prepare_whatsapp_followups", kind: "action", permission: "leads:manage", approval: "always", data: ["sales_activities", "leads", "conversations"], match: (n) => WA.test(n) && (PREPARE.test(n) || CREATE.test(n)) && FOLLOW.test(n) }),
  d({ key: "create_whatsapp_campaign", kind: "action", permission: "campaign:manage", approval: "always", data: ["leads", "segments"], match: (n) => WA.test(n) && (PREPARE.test(n) || CREATE.test(n)) && /حمله|حملات|campaign/.test(n) }),
  d({ key: "whatsapp_campaign_summary", kind: "read", permission: "leads:read", data: ["campaigns"], match: (n) => WA.test(n) && /حمله|حملات|campaign/.test(n) && (SUMMARY.test(n) || QUESTION.test(n)) }),
  d({ key: "whatsapp_unread", kind: "read", permission: "leads:read", data: ["conversations"], match: (n) => WA.test(n) && /غير مقروء|مقروءه|unread|جديد|new|تحتاج|need/.test(n) && QUESTION.test(n) }),
  d({ key: "whatsapp_templates", kind: "navigation", permission: "leads:read", route: "/whatsapp/templates", match: (n) => WA.test(n) && /قوالب|قالب|templates?/.test(n) }),
  d({ key: "whatsapp_customers", kind: "navigation", permission: "leads:read", route: "/whatsapp/customers", match: (n) => WA.test(n) && /عملا|عميل|customers|contacts/.test(n) && NAV.test(n) }),
  d({ key: "open_whatsapp_inbox", kind: "navigation", permission: "leads:read", route: "/whatsapp/inbox", match: (n) => WA.test(n) && /محادث|رسايل|رساله|inbox|conversations|messages|chats?/.test(n) }),
  d({ key: "open_whatsapp", kind: "navigation", permission: "leads:read", route: "/whatsapp", match: (n) => WA.test(n) && (NAV.test(n) || n.split(" ").length <= 2) }),

  // ── Create / action ──
  d({ key: "import_leads", kind: "action", permission: "leads:manage", requires: ["file"], match: (n, files) => /(استخرج|استورد|import|extract)/.test(n) || (files && /(عملا|عميل|leads|customers|contacts)/.test(n)) }),
  // "Prepare a follow-up message for Falcon" — one named customer: only that customer's data + sales rules.
  d({ key: "draft_sales_message", kind: "action", permission: "leads:manage", approval: "policy", ai: "agent", mode: "brain_ai", brain: "sales", budget: "small", requires: ["lead"], data: ["lead", "last_messages"], match: (n, _f, e) => Boolean(e?.name) && PREPARE.test(n) && /رساله|رد(\s|$)|message|email|ايميل|reply/.test(n) }),
  d({ key: "prepare_followups", mode: "brain_ai", brain: "sales", budget: "small", data: ["sales_activities", "leads", "messages"], kind: "action", permission: "leads:manage", approval: "policy", ai: "agent", match: (n) => (PREPARE.test(n) && /(رسايل|رساله|المتابعات|متابعات|messages|follow.?ups|followups)/.test(n) && FOLLOW.test(n)) || (/^(تابع|follow up with|follow-up with)(\s|$)/.test(n) && /ساخن|مهتم|hot|warm/.test(n)) }),
  d({ key: "create_followup", kind: "action", permission: "leads:manage", requires: ["lead"], match: (n) => (CREATE.test(n) || PREPARE.test(n)) && FOLLOW.test(n) }),
  d({ key: "create_b2b_opportunity", kind: "action", permission: "leads:manage", requires: ["lead"], match: (n) => CREATE.test(n) && /فرصه|opportunit|صفقه|deal/.test(n) }),
  d({ key: "create_quote", kind: "action", permission: "leads:manage", requires: ["lead"], route: "/sales?view=quotes", match: (n) => (PREPARE.test(n) || CREATE.test(n)) && /عرض سعر|عرض اسعار|عرض للسعر|quote|quotation|proposal/.test(n) }),
  d({ key: "create_lead", kind: "action", permission: "leads:manage", requires: ["lead"], match: (n) => CREATE.test(n) && /عميل|زبون|lead|customer|client|contact/.test(n) }),
  d({ key: "create_carousel", mode: "brain_ai", brain: "content", budget: "small", kind: "action", permission: "content:create", ai: "content", requires: ["topic"], match: has(/كاروسيل|كاروسل|كروسيل|carousel/) }),
  d({ key: "design_post", mode: "ai", kind: "action", permission: "content:create", ai: "images", match: (n) => /(^|\s)(صمم|صمملي)(\s|$)|تصميم|\bdesign\b|\bvisual\b|\bimage for\b/.test(n) && !/محتوي|اسبوع|week/.test(n) && !/(^|\s)(عن|حول|بخصوص)(\s|$)|\babout\b/.test(n) }),
  d({ key: "improve_content", mode: "brain_ai", brain: "content", budget: "small", kind: "action", permission: "content:create", ai: "content", match: has(/(^|\s)(حسن|طور|حسنلي|عدل|اعد كتابه)(\s|$)|\b(improve|polish|enhance|rewrite)\b/) }),
  d({ key: "create_campaign", mode: "brain_ai", brain: "content", budget: "medium", kind: "action", permission: "campaign:manage", ai: "agent", match: (n) => (PREPARE.test(n) || CREATE.test(n) || /(^|\s)(اطلق)(\s|$)|\blaunch\b/.test(n)) && /حمله|حملات|campaign/.test(n) }),
  d({ key: "prepare_week_content", mode: "brain_ai", brain: "content", budget: "small", kind: "action", permission: "content:create", ai: "agent", match: (n) => PREPARE.test(n) && /منشور|بوست|posts?\b|محتوي|content|كابشن|caption/.test(n) }),
  d({ key: "run_sales_cycle", kind: "action", permission: "leads:manage", match: has(/دوره المبيعات|sales cycle|(حلل|راجع) (العملا|كل العملا|الصفقات)|analy[sz]e (my |all )?(leads|customers|deals)/) }),

  // ── Company Brain facts (retrieval + formatted answer — never a model call) ──
  brainFact("brain_icp", ["icp"], has(/عميلنا المثالي|العميل المثالي|عملاءنا المثاليين|ideal customer|\bicp\b/)),
  brainFact("brain_objections", ["objections"], has(/اعتراضات|اعتراض|objections?/)),
  brainFact("brain_content_strategy", ["strategy", "contentPillars", "brandVoice"], (n) => /استراتيجيه المحتوي|استراتيجيه التسويق|content strategy|marketing strategy/.test(n)),
  brainFact("brain_top_products", ["products", "services"], (n) => /(المنتجات|الخدمات|products|services)/.test(n) && /(الاعلي قيمه|اعلي قيمه|الاغلي|highest.?value|most expensive|top.?value)/.test(n)),
  brainFact("brain_about", ["company", "valueProps"], has(/مين احنا|من نحن|عن الشركه|عن شركتنا|نبذه عن|عرفني بالشركه|about (us|the company|our company)|who are we/)),
  brainFact("brain_services", ["company", "services"], (n) => /(خدمات|خدمه|services?\b)/.test(n) && BRAIN_Q.test(n)),
  brainFact("brain_products", ["company", "products"], (n) => /(منتجات|منتج|products?\b)/.test(n) && BRAIN_Q.test(n)),
  brainFact("brain_audience", ["company", "audience"], has(/جمهور|الفيه المستهدفه|الفئه المستهدفه|العملاء المستهدفين|عملاءنا المستهدفين|target audience|\baudience\b|\bicp\b|ideal customer/)),
  brainFact("brain_strengths", ["company", "valueProps"], has(/مميزات|ميزات|نقاط القوه|يميزنا|بيميزنا|القيمه المضافه|strengths|differentiators|value prop|why us|\busp\b/)),
  brainFact("brain_pricing", ["pricing", "services", "products"], (n) => /سياسه الاسعار|سياسه التسعير|اسعارنا|الاسعار|التسعير|pricing|prices|price list|بكام/.test(n) && !/عروض/.test(n)),
  brainFact("brain_tone", ["brandVoice", "contentPillars"], has(/نبره|اسلوب الكتابه|صوت العلامه|هويه العلامه|\btone\b|brand voice/)),

  // ── Read ──
  d({ key: "pipeline_value", kind: "read", permission: "leads:read", data: ["leads", "opportunities", "pipeline_stages"], match: (n) => /قيمه|value|worth|forecast|توقع|المتوقع/.test(n) && /pipeline|بايب|الفرص|الصفقات|مبيعات|deals|opportunit/.test(n) }),
  d({ key: "calendar_lookup", kind: "read", permission: "workspace:read", data: ["meetings", "sales_activities"], match: (n) => /مواعيد|موعد|مواعيدي|اجتماع|اجتماعات|ميتنج|meetings?\b|appointments?|agenda|جدولي/.test(n) && !CREATE.test(n) && !NAV.test(n) }),
  d({ key: "lead_activity", kind: "read", permission: "leads:read", requires: ["lead"], data: ["lead_events"], match: (n, _f, e) => Boolean(e?.name) && /اخر نشاط|اخر تواصل|سجل التعامل|تاريخ التعامل|activity|history|timeline/.test(n) }),
  d({ key: "integrations_status", kind: "read", permission: "workspace:read", data: ["integrations"], match: (n) => /حاله|وضع|status|شغال|مربوط|متصل/.test(n) && /الحسابات|حساباتي|التكاملات|الربط|integrations?|connected accounts|providers?|المنصات/.test(n) && !NAV.test(n) }),
  d({ key: "stalled_deals", kind: "read", permission: "leads:read", match: has(/متوقف|واقف|متعثر|نايم|stalled|stuck|stale/) }),
  d({ key: "overdue_followups", kind: "read", permission: "leads:read", match: (n) => /متاخر|فات|overdue|late|missed/.test(n) && (FOLLOW.test(n) || /عملا|leads/.test(n)) && !NAV.test(n) }),
  d({ key: "followups_today", data: ["sales_activities", "leads"], kind: "read", permission: "leads:read", match: (n) => FOLLOW.test(n) && (QUESTION.test(n) || /(^|\s)(راجع|شوف)(\s|$)|\bdue\b/.test(n)) && !NAV.test(n) }),
  d({ key: "hot_leads", kind: "read", permission: "leads:read", match: (n) => /ساخن|hot/.test(n) && QUESTION.test(n) && !NAV.test(n) }),
  d({ key: "approvals_summary", kind: "read", permission: "workspace:read", match: (n) => /موافق|approv/.test(n) && QUESTION.test(n) && !NAV.test(n) }),
  d({ key: "sales_brief", kind: "read", permission: "workspace:read", match: has(/موجز اليوم|ملخص اليوم|الموجز اليومي|daily brief|today'?s brief|brief me/) }),
  d({ key: "best_content", kind: "read", permission: "analytics:read", match: (n) => /افضل|احسن|best|top/.test(n) && /محتوي|منشور|بوست|content|post/.test(n) }),
  d({ key: "lead_sources", kind: "read", permission: "analytics:read", match: (n) => /منين|من اين|من فين|مصدر|مصادر|\bwhere\b|\bsources?\b/.test(n) && /عملا|عميل|leads?\b|customers/.test(n) }),
  d({ key: "campaign_summary", kind: "read", permission: "workspace:read", match: (n) => /حمل|campaign/.test(n) && (SUMMARY.test(n) || QUESTION.test(n)) && !NAV.test(n) }),
  d({ key: "analytics_summary", kind: "read", permission: "analytics:read", match: (n) => /اداء|perform|نتايج|results|تحليل/.test(n) && (SUMMARY.test(n) || QUESTION.test(n) || /اسبوع|week|شهر|month/.test(n)) && !NAV.test(n) }),
  d({ key: "sales_summary", data: ["leads", "sales_activities", "approvals", "quotes"], kind: "read", permission: "leads:read", match: (n) => (SUMMARY.test(n) && /مبيعات|pipeline|بايب|sales|صفقات|deals|فرص/.test(n)) || /كم صفق|كم فرص|how many (open )?deals|open deals/.test(n) }),

  // ── Navigation ── (a verb like "open", or a short noun phrase)
  d({ key: "open_hot_leads", kind: "navigation", permission: "leads:read", route: "/sales?view=hot", match: has(/ساخن|hot/) }),
  d({ key: "open_overdue_followups", kind: "navigation", permission: "leads:read", route: "/sales?view=followups&tab=overdue", match: (n) => FOLLOW.test(n) && /متاخر|overdue/.test(n) }),
  d({ key: "open_followups", kind: "navigation", permission: "leads:read", route: "/sales?view=followups&tab=today", match: (n) => FOLLOW.test(n) }),
  d({ key: "open_content_pending", kind: "navigation", permission: "workspace:read", route: "/content?view=approval", match: (n) => /محتوي|منشور|content|posts/.test(n) && /موافق|مراجع|approval|review|pending/.test(n) }),
  d({ key: "open_approvals", kind: "navigation", permission: "workspace:read", route: "/approvals", match: has(/موافق|approval/) }),
  d({ key: "open_calendar", kind: "navigation", permission: "workspace:read", route: "/calendar", match: has(/تقويم|كالندر|جدول النشر|calendar|schedule/) }),
  d({ key: "open_messages", kind: "navigation", permission: "leads:read", route: "/inbox", match: has(/رسايل|رساله|محادث|انبوكس|inbox|messages|conversations/) }),
  d({ key: "open_pipeline", kind: "navigation", permission: "leads:read", route: "/sales?view=pipeline", match: has(/pipeline|بايب|خط المبيعات|مسار المبيعات|الصفقات|deals/) }),
  d({ key: "open_quotes", kind: "navigation", permission: "leads:read", route: "/sales?view=quotes", match: has(/عروض الاسعار|عروض السعر|quotes/) }),
  d({ key: "open_b2b", kind: "navigation", permission: "leads:read", route: "/sales?view=b2b", match: has(/b2b|بي تو بي/) }),
  d({ key: "open_sales", kind: "navigation", permission: "leads:read", route: "/sales", match: has(/مبيعات|sales/) }),
  d({ key: "open_customers", kind: "navigation", permission: "leads:read", route: "/sales?view=customers", match: has(/عملا|عميل|زباين|customers|leads|clients|contacts/) }),
  d({ key: "open_content", kind: "navigation", permission: "workspace:read", route: "/content", match: has(/محتوي|منشورات|بوستات|استوديو|content|posts|studio/) }),
  d({ key: "open_campaigns", kind: "navigation", permission: "workspace:read", route: "/campaigns", match: has(/حملات|حمله|campaign/) }),
  d({ key: "open_analytics", kind: "navigation", permission: "analytics:read", route: "/analytics", match: has(/تحليلات|احصاييات|احصاءات|analytics|stats|insights/) }),
  d({ key: "open_reports", kind: "navigation", permission: "workspace:read", route: "/reports", match: has(/تقارير|reports/) }),
  d({ key: "open_integrations", kind: "navigation", permission: "workspace:read", route: "/settings/connected-accounts", match: has(/(^|\s)(اربط|ربط|الربط)(\s|$)|حساباتك|الحسابات المرتبطه|integrations|connected accounts|connect (my |your )?accounts?/) }),
  d({ key: "open_settings", kind: "navigation", permission: "workspace:read", route: "/settings", match: has(/اعدادات|الاعدادات|settings/) }),
  d({ key: "open_knowledge", kind: "navigation", permission: "workspace:read", route: "/knowledge", match: has(/عقل الشركه|المعرفه|knowledge|company brain/) }),
  d({ key: "open_team", kind: "navigation", permission: "workspace:read", route: "/team", match: has(/فريق|الوكلا|team|agents/) }),
  d({ key: "open_home", kind: "navigation", permission: "workspace:read", route: "/home", match: has(/الرييسيه|الرئيسيه|home|dashboard/) }),
  // "Open Falcon Group" — an entity, resolved against the tenant's customers.
  d({ key: "open_entity", kind: "navigation", permission: "leads:read", requires: ["lead"], match: (n) => NAV.test(n) }),

  // Only reachable through the AI fallback: a question answered from company knowledge by the existing agent workflow.
  // Reached through the service for question-shaped text the parser doesn't know: brain first, AI only on low confidence.
  d({ key: "brain_question", kind: "read", permission: "workspace:read", mode: "brain", brain: "support", budget: "small", cacheable: true, match: () => false }),
  d({ key: "ask_question", mode: "brain_ai", brain: "support", budget: "small", kind: "read", permission: "agents:command", ai: "content", match: () => false }),
] as const satisfies readonly IntentDef[];

export type IntentKey =
  | "greeting" | "delete_anything" | "approve_all" | "approve_item" | "publish_content" | "send_discount" | "send_quote" | "send_message" | "close_deal" | "move_stage"
  | "import_leads" | "create_campaign" | "draft_sales_message" | "prepare_followups" | "create_followup" | "create_b2b_opportunity" | "create_quote" | "create_lead" | "create_carousel" | "design_post" | "improve_content" | "prepare_week_content" | "run_sales_cycle"
  | "brain_about" | "brain_services" | "brain_products" | "brain_audience" | "brain_strengths" | "brain_pricing" | "brain_tone" | "brain_icp" | "brain_objections" | "brain_content_strategy" | "brain_top_products" | "brain_question"
  | "pipeline_value" | "calendar_lookup" | "lead_activity" | "integrations_status" | "stalled_deals" | "overdue_followups" | "followups_today" | "hot_leads" | "approvals_summary" | "sales_brief" | "best_content" | "lead_sources" | "campaign_summary" | "analytics_summary" | "sales_summary"
  | "open_hot_leads" | "open_overdue_followups" | "open_followups" | "open_content_pending" | "open_approvals" | "open_calendar" | "open_messages" | "open_pipeline" | "open_quotes" | "open_b2b" | "open_sales" | "open_customers"
  | "open_content" | "open_campaigns" | "open_analytics" | "open_reports" | "open_integrations" | "open_settings" | "open_knowledge" | "open_team" | "open_home" | "open_entity"
  | "open_whatsapp" | "open_whatsapp_inbox" | "whatsapp_unread" | "create_whatsapp_campaign" | "whatsapp_campaign_summary" | "prepare_whatsapp_followups" | "whatsapp_customers" | "whatsapp_templates"
  | "ask_question";

export const INTENT_KEYS = INTENTS.map((i) => i.key) as IntentKey[];

export function intentDef(key: string): IntentDef | null {
  return (INTENTS as readonly IntentDef[]).find((i) => i.key === key) ?? null;
}

/**
 * Local (deterministic) detection. Navigation without a verb only matches short phrases
 * ("the approvals", "hot leads") so free-form sentences fall through to the AI router.
 */
export function detectIntent(n: string, hasFiles = false, e?: Pick<Entities, "name">): IntentDef | null {
  const words = n.split(" ").length;
  for (const def of INTENTS as readonly IntentDef[]) {
    if (def.key === "ask_question" || def.key === "brain_question") continue;
    if (def.kind === "navigation" && !NAV.test(n) && words > 4) continue;
    if (def.key === "open_entity" && words < 2) continue;
    if (def.match(n, hasFiles, e)) return def;
  }
  return null;
}

/** Intents where a model call is never allowed (explicit allowlist, enforced in tests). */
export const NO_AI_INTENTS = (INTENTS as readonly IntentDef[]).filter((i) => i.mode === "local" || i.mode === "brain").map((i) => i.key);
