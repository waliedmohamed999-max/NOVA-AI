import { db } from "../../db/client";
import { aiStructured } from "../../ai";
import { retrieveKnowledge, formatContext } from "../../knowledge/service";
import { addLeadEvent, draftLeadMessage, notifyHotLead, scheduleFollowUp } from "../../sales/service";
import { temperatureFor } from "../../sales/scoring";
import { notify } from "../../notifications/service";
import { defineWorkflow } from "../runtime";
import { brainPrompt, loadBrain, type BrainSnapshot } from "../brain";
import { followUpSchema, leadQualificationSchema, type LeadQualification } from "../schemas";
import { compactContext, retrieveCompanyContext, type CompanyContext } from "../../knowledge/company-context";

const SALES_SYSTEM = (b: BrainSnapshot) =>
  [
    "You are the AI Sales Agent of this company. You qualify inbound leads and draft helpful, honest replies.",
    "Never promise discounts, custom prices, refunds, legal terms, contract terms or delivery dates that are not in the company information. If the lead asks about them, flag the matching sensitive topic and propose that a human confirms.",
    "Replies are short, warm, specific to what the lead wrote, and end with one clear next step.",
    "",
    brainPrompt(b),
  ].join("\n");

/** Follow-up drafting: a compact sales context instead of the whole company profile. */
const salesSystem = (brain: CompanyContext, locale: "ar" | "en") =>
  [
    "You are the AI Sales Agent of this company. Draft a short, warm, specific follow-up that ends with one clear next step.",
    "Never promise discounts, custom prices, refunds, legal terms, contract terms or delivery dates that are not listed below. If they come up, flag the matching sensitive topic.",
    `Write in ${locale === "ar" ? "Arabic" : "English"}.`,
    "",
    compactContext(brain),
  ].join("\n");

/** Keyword intent for offline mode. Anything unclear is "other" — never auto-answered. */
function offlineIntent(message: string): LeadQualification["replyIntent"] {
  if (!message.trim()) return null;
  if (/(price|pricing|cost|how much|سعر|أسعار|تكلفة|بكام|كم سعر)/i.test(message)) return "pricing";
  if (/(proposal|quotation|quote|عرض سعر)/i.test(message)) return "proposal";
  if (/(complain|refund|angry|شكوى|استرداد)/i.test(message)) return "complaint";
  if (/(opening hours|open today|working hours|مواعيد العمل|ساعات العمل)/i.test(message)) return "opening_hours";
  if (/(where are you|address|location|العنوان|مكانكم|فين)/i.test(message)) return "location";
  if (/(phone number|contact you|email address|رقم التليفون|رقم الهاتف|التواصل)/i.test(message)) return "contact_details";
  return "other";
}

function offlineQualification(b: BrainSnapshot, lead: { name: string; score: number; interests: string[] }, message: string): LeadQualification {
  const ar = b.locale === "ar";
  const sensitive: LeadQualification["sensitiveTopics"] = [];
  if (/(discount|خصم)/i.test(message)) sensitive.push("discount");
  if (/(refund|استرداد)/i.test(message)) sensitive.push("refund");
  if (/(proposal|quotation|quote|عرض سعر|عرض فني)/i.test(message)) sensitive.push("proposal");
  if (/(contract|عقد)/i.test(message)) sensitive.push("contract_promise");
  const temperature = temperatureFor(lead.score);
  return {
    score: lead.score,
    temperature,
    intent: message ? message.slice(0, 140) : ar ? "استفسار عام" : "General inquiry",
    summary: message ? (ar ? `${lead.name} تواصل بخصوص: ${message.slice(0, 200)}` : `${lead.name} reached out about: ${message.slice(0, 200)}`) : ar ? `${lead.name} أضيف بدون رسالة.` : `${lead.name} was added without a message.`,
    interests: lead.interests,
    objections: [],
    estimatedValue: null,
    nextAction: temperature === "HOT" ? (ar ? "اتصل اليوم" : "Call today") : ar ? "أرسل ردًا تعريفيًا" : "Send an introductory reply",
    nextActionInDays: temperature === "HOT" ? 0 : 1,
    draftReply: ar
      ? `مرحبًا ${lead.name}،\n\nشكرًا لتواصلك مع ${b.org.name}. استلمنا رسالتك وسنساعدك بكل سرور. هل يناسبك أن نحدد مكالمة قصيرة هذا الأسبوع لنفهم احتياجك بشكل أفضل؟\n\nمع التحية،\nفريق ${b.org.name}`
      : `Hi ${lead.name},\n\nThanks for reaching out to ${b.org.name}. We've received your message and we'd be glad to help. Would a short call this week work so we can understand exactly what you need?\n\nBest,\nThe ${b.org.name} team`,
    needsHuman: sensitive.length > 0,
    needsHumanReason: sensitive.length ? (ar ? "يطلب شروطًا تحتاج موافقة" : "Asks for terms that need approval") : null,
    sensitiveTopics: sensitive,
    replyIntent: offlineIntent(message),
    reasons: [],
  };
}

defineWorkflow("lead_qualify", {
  agent: "SALES_AGENT",
  steps: ["reading_lead", "reviewing_business", "qualifying", "recommending_action"],
  async run(ctx) {
    const leadId = String(ctx.params.leadId);
    const { lead, message } = await ctx.step("reading_lead", async () => {
      const lead = await db.lead.findFirstOrThrow({ where: { id: leadId, ...ctx.scope } });
      const msgs = await db.message.findMany({ where: { ...ctx.scope, conversation: { leadId } }, orderBy: { createdAt: "asc" }, take: 20 });
      return { lead, message: msgs.filter((m) => m.direction === "INBOUND").map((m) => m.body).join("\n\n") };
    });
    const { b, knowledge } = await ctx.step("reviewing_business", async () => {
      const b = await loadBrain(ctx.scope);
      const chunks = await retrieveKnowledge(ctx.scope, `${message} ${lead.interests.join(" ")}`, 4);
      return { b, knowledge: formatContext(chunks) };
    });

    const q = await ctx.step("qualifying", () =>
      aiStructured(ctx.ai, {
        task: "SALES",
        schemaName: "lead_qualification",
        schema: leadQualificationSchema,
        system: SALES_SYSTEM(b),
        prompt: [
          `Lead: ${lead.name}${lead.company ? `, ${lead.company}` : ""}`,
          `Channel: ${lead.channel}; source: ${lead.source ?? "unknown"}`,
          lead.email && `Email: ${lead.email}`,
          `Rules-based score so far: ${lead.score}/100`,
          `Their messages:\n${message || "(no message)"}`,
          `Relevant company knowledge:\n${knowledge}`,
          `Write the draft reply in ${b.locale === "ar" ? "Arabic" : "the language the lead wrote in"}. estimatedValue is in ${lead.currency} and must be null unless the pricing in the company knowledge supports it.`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        offline: () => offlineQualification(b, lead, message),
      }),
    );
    const r = q.data;

    return ctx.step("recommending_action", async () => {
      const temperature = temperatureFor(r.score);
      await db.lead.update({
        where: { id: lead.id },
        data: {
          score: r.score,
          temperature,
          intent: r.intent.slice(0, 300),
          summary: r.summary,
          interests: r.interests.length ? r.interests : lead.interests,
          objections: r.objections,
          aiInsight: r.nextAction,
          nextAction: r.nextAction.slice(0, 200),
          nextActionAt: new Date(Date.now() + r.nextActionInDays * 86_400_000),
          estimatedValueCents: lead.estimatedValueCents ?? (r.estimatedValue != null ? Math.round(r.estimatedValue * 100) : null),
          stage: lead.stage === "NEW" && r.score >= 55 ? "QUALIFIED" : lead.stage,
        },
      });
      await db.leadScore.create({ data: { ...ctx.scope, leadId: lead.id, score: r.score, temperature, reasons: r.reasons, method: q.generatedBy } });
      await addLeadEvent(ctx.scope, lead.id, {
        type: "AI_ANALYSIS",
        title: b.locale === "ar" ? "حلّل وكيل المبيعات العميل" : "Sales Agent analyzed this lead",
        body: r.summary,
        data: { score: r.score, temperature, intent: r.intent, objections: r.objections, nextAction: r.nextAction, generatedBy: q.generatedBy },
        actor: { type: "AGENT", label: "AI Sales Agent" },
      });
      if (lead.stage === "NEW" && r.score >= 55) {
        await addLeadEvent(ctx.scope, lead.id, { type: "STATUS_CHANGE", title: "NEW → QUALIFIED", data: { from: "NEW", to: "QUALIFIED" }, actor: { type: "AGENT", label: "AI Sales Agent" } });
      }
      const drafted = await draftLeadMessage(ctx.scope, lead.id, { subject: null, body: r.draftReply, sensitiveTopics: r.sensitiveTopics, intent: r.replyIntent, inbound: Boolean(message) }, { reason: r.nextAction, locale: b.locale });
      await scheduleFollowUp(ctx.scope, lead.id, { title: r.nextAction, dueAt: new Date(Date.now() + r.nextActionInDays * 86_400_000), agent: true });
      await ctx.task("SALES_AGENT", b.locale === "ar" ? `أهّل ${lead.name} (${r.score}/100)` : `Qualified ${lead.name} (${r.score}/100)`, { type: "Lead", id: lead.id });
      if (temperature === "HOT") await notifyHotLead(ctx.scope, lead, b.locale);
      else if (r.score >= 55) await notify({ ...ctx.scope, type: "LEAD_QUALIFIED", title: b.locale === "ar" ? `عميل مؤهل: ${lead.name}` : `Lead qualified: ${lead.name}`, link: `/leads/${lead.id}` });
      if (r.needsHuman) {
        await notify({ ...ctx.scope, type: "APPROVAL_NEEDED", title: b.locale === "ar" ? `${lead.name} يحتاج تدخلك` : `${lead.name} needs a human`, body: r.needsHumanReason ?? undefined, link: `/leads/${lead.id}` });
      }
      return {
        type: "leads" as const,
        title: `${lead.name} — ${r.score}/100`,
        summary: r.summary,
        stats: [{ label: "score", value: r.score }, { label: "temperature", value: temperature }],
        actions: [{ label: "open_lead", href: `/leads/${lead.id}`, primary: true }],
        entity: { type: "Lead", id: lead.id },
        items: [{ title: r.nextAction, subtitle: drafted.disposition }],
        offline: q.offline,
      };
    });
  },
});

export const FOLLOWUP_STEPS = ["finding_leads", "reviewing_conversations", "drafting_followups", "requesting_approval"];

defineWorkflow("leads_followup", {
  agent: "SALES_AGENT",
  steps: FOLLOWUP_STEPS,
  async run(ctx) {
    const b = await loadBrain(ctx.scope);
    // Specific leads (e.g. "prepare the due follow-ups") or, by default, the hottest open leads.
    const onlyIds = Array.isArray(ctx.params.leadIds) ? (ctx.params.leadIds as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 10) : null;
    const leads = await ctx.step("finding_leads", () =>
      db.lead.findMany({
        where: onlyIds ? { ...ctx.scope, id: { in: onlyIds }, stage: { notIn: ["WON", "LOST"] } } : { ...ctx.scope, stage: { notIn: ["WON", "LOST"] }, temperature: { in: ["HOT", "WARM"] } },
        orderBy: [{ score: "desc" }, { lastContactAt: "asc" }],
        take: onlyIds ? 10 : 5,
      }),
    );
    const convos = await ctx.step("reviewing_conversations", async () =>
      Promise.all(
        leads.map(async (l) => ({
          lead: l,
          history: (await db.message.findMany({ where: { ...ctx.scope, conversation: { leadId: l.id } }, orderBy: { createdAt: "desc" }, take: 3 }))
            .reverse()
            .map((m) => `${m.direction === "INBOUND" ? l.name : b.org.name}: ${m.body}`)
            .join("\n"),
        })),
      ),
    );
    const drafted = await ctx.step("drafting_followups", async () => {
      const out: { leadId: string; name: string; disposition: string }[] = [];
      // Sales context is retrieved once for the whole job and shared by every draft (offerings, ICP, pricing,
      // sales rules only — no other customers, no content history).
      const brain = await retrieveCompanyContext(ctx.scope, { purpose: "sales", budget: "small" });
      const system = salesSystem(brain, b.locale);
      Object.assign(ctx.params, { brainContextTokens: brain.contextTokens, brainItems: brain.retrievedItems });
      for (const { lead, history } of convos) {
        // Only the offerings this customer showed interest in (fall back to none rather than the whole catalogue).
        const relevant = [...brain.services, ...brain.products].filter((o) => lead.interests.some((i) => o.name.toLowerCase().includes(i.toLowerCase()) || i.toLowerCase().includes(o.name.toLowerCase())));
        const res = await aiStructured(ctx.ai, {
          task: "SALES",
          schemaName: "follow_up",
          schema: followUpSchema,
          system,
          maxTokens: 400,
          prompt: [
            `Write a short follow-up to ${lead.name}${lead.company ? ` (${lead.company})` : ""}.`,
            `Stage: ${lead.stage}. Last known intent: ${lead.intent ?? "unknown"}. Objections: ${lead.objections.join(", ") || "none"}.`,
            relevant.length ? `Relevant offering: ${relevant.map((o) => `${o.name}${o.price ? ` (${o.price})` : ""}`).join("; ")}` : null,
            `Last messages:\n${history || "(no messages yet)"}`,
          ]
            .filter(Boolean)
            .join("\n"),
          offline: () => ({
            subject: null,
            message:
              b.locale === "ar"
                ? `مرحبًا ${lead.name}، أردنا المتابعة معك بخصوص ${lead.intent ?? "طلبك"}. هل لديك أي أسئلة يمكننا الإجابة عنها؟ يسعدنا ترتيب مكالمة قصيرة في الوقت المناسب لك.`
                : `Hi ${lead.name}, just following up on ${lead.intent ?? "your inquiry"}. Do you have any questions we can answer? Happy to set up a quick call at a time that suits you.`,
            sensitiveTopics: [],
          }),
        });
        const d = await draftLeadMessage(ctx.scope, lead.id, { subject: res.data.subject, body: res.data.message, sensitiveTopics: res.data.sensitiveTopics }, { reason: "Follow-up", locale: b.locale });
        out.push({ leadId: lead.id, name: lead.name, disposition: d.disposition });
      }
      return out;
    });
    await ctx.step("requesting_approval", async () => {
      await ctx.task("SALES_AGENT", b.locale === "ar" ? `جهّز ${drafted.length} رسائل متابعة` : `Prepared ${drafted.length} follow-ups`);
    });
    return {
      type: "leads",
      title: b.locale === "ar" ? `${drafted.length} رسائل متابعة جاهزة` : `${drafted.length} follow-ups prepared`,
      summary:
        drafted.length === 0
          ? b.locale === "ar"
            ? "لا يوجد عملاء مهتمون يحتاجون متابعة الآن."
            : "No hot or warm leads need a follow-up right now."
          : b.locale === "ar"
            ? "راجع الرسائل قبل إرسالها أو اتركها للإرسال التلقائي حسب إعداداتك."
            : "Review the drafts before they go out, or let them send according to your autonomy settings.",
      items: drafted.map((d) => ({ title: d.name, subtitle: d.disposition, href: `/leads/${d.leadId}` })),
      actions: [{ label: "review_approvals", href: "/approvals?tab=SALES", primary: true }, { label: "open_leads", href: "/leads" }],
    };
  },
});
