import type { BrainSnapshot } from "./brain";
import { pillarsOf } from "./brain";
import type { CampaignPlan, CompanyAnalysis, ContentPlan, PlannedPost } from "./schemas";

/**
 * Deterministic builders used ONLY by the offline development AI provider.
 * They assemble drafts from the company's own stored data (name, offerings,
 * audience, pillars) — never invented metrics or claims.
 */

type Lang = "en" | "ar";
type Platform = PlannedPost["platform"];

const HOOKS: Record<Lang, ((topic: string, company: string) => string)[]> = {
  en: [
    (t) => `Most people get ${t.toLowerCase()} wrong. Here's the simple fix.`,
    (t) => `3 things we wish every customer knew about ${t.toLowerCase()}.`,
    (_t, c) => `A look behind the scenes at ${c}.`,
    (t) => `Before you decide on ${t.toLowerCase()}, read this.`,
    (t) => `The question we hear most about ${t.toLowerCase()} — answered.`,
    (_t, c) => `Why our customers keep coming back to ${c}.`,
    (t) => `Your quick guide to ${t.toLowerCase()} this week.`,
  ],
  ar: [
    (t) => `أغلب الناس يخطئون في ${t}. إليك الحل البسيط.`,
    (t) => `3 أشياء نتمنى أن يعرفها كل عميل عن ${t}.`,
    (_t, c) => `نظرة من خلف الكواليس في ${c}.`,
    (t) => `قبل أن تقرر بخصوص ${t}، اقرأ هذا.`,
    (t) => `السؤال الأكثر تكرارًا عن ${t} — وإجابته.`,
    (_t, c) => `لماذا يعود عملاؤنا إلى ${c} دائمًا؟`,
    (t) => `دليلك السريع إلى ${t} هذا الأسبوع.`,
  ],
};

const CTAS: Record<Lang, string[]> = {
  en: ["Send us a message to learn more.", "Save this for later.", "Book a free consultation.", "Share this with someone who needs it.", "Visit the link in our bio."],
  ar: ["راسلنا لمعرفة المزيد.", "احفظ المنشور للرجوع إليه.", "احجز استشارة مجانية.", "شاركه مع من يحتاجه.", "زر الرابط في الملف التعريفي."],
};

const FORMAT_BY_PLATFORM: Record<Platform, PlannedPost["format"][]> = {
  INSTAGRAM: ["CAROUSEL", "POST", "REEL", "STORY"],
  FACEBOOK: ["POST", "CAROUSEL", "SHORT_VIDEO"],
  LINKEDIN: ["LINKEDIN_POST", "CAROUSEL"],
  TIKTOK: ["SHORT_VIDEO", "REEL"],
};

const TIMES = ["10:00", "13:00", "18:30", "20:00", "11:30", "17:00", "19:30"];

function hashtag(s: string) {
  return `#${s.replace(/[^\p{L}\p{N}]+/gu, "")}`;
}

function topicsFor(b: BrainSnapshot, topic: string | null): string[] {
  const fromOfferings = b.offerings.map((o) => o.name);
  const base = topic ? [topic] : [];
  const fallback = b.locale === "ar" ? ["خدماتنا", "تجربة العملاء", "نصائح عملية"] : ["our services", "customer experience", "practical tips"];
  return [...base, ...fromOfferings, ...fallback];
}

function audienceName(b: BrainSnapshot) {
  const a = (b.profile?.audience as { name?: string }[] | null)?.[0]?.name;
  return a ?? (b.locale === "ar" ? "عملائنا" : "our customers");
}

export function offlinePost(b: BrainSnapshot, i: number, opts: { platform?: Platform | null; topic?: string | null; pillar?: string } = {}): PlannedPost {
  const lang: Lang = b.locale;
  const pillars = pillarsOf(b);
  const pillar = opts.pillar ?? pillars[i % pillars.length];
  const platforms: Platform[] = opts.platform ? [opts.platform] : ["INSTAGRAM", "LINKEDIN", "FACEBOOK", "INSTAGRAM", "TIKTOK", "INSTAGRAM", "LINKEDIN"];
  const platform = platforms[i % platforms.length];
  const format = FORMAT_BY_PLATFORM[platform][i % FORMAT_BY_PLATFORM[platform].length];
  const topics = topicsFor(b, opts.topic ?? null);
  const topic = topics[i % topics.length];
  const company = b.org.name;
  const hook = HOOKS[lang][i % HOOKS[lang].length](topic, company);
  const cta = CTAS[lang][i % CTAS[lang].length];
  const who = audienceName(b);
  const value = b.profile?.valueProps[i % Math.max(1, b.profile.valueProps.length)];

  const caption =
    lang === "ar"
      ? `${hook}\n\nفي ${company} نساعد ${who} في ${topic}.${value ? ` ${value}.` : ""}\n\n${pillar}: نشارك ما تعلمناه من العمل اليومي مع عملائنا لتصل إلى نتيجة أفضل بخطوات واضحة.\n\n${cta}`
      : `${hook}\n\nAt ${company}, we help ${who} with ${topic}.${value ? ` ${value}.` : ""}\n\n${pillar}: we're sharing what we've learned working with customers every day, in clear, practical steps.\n\n${cta}`;

  const palette = [...(b.brandKit?.primaryColors ?? []), ...(b.brandKit?.secondaryColors ?? [])].slice(0, 3);
  return {
    platform,
    format,
    pillar,
    title: lang === "ar" ? `${pillar} — ${topic}` : `${pillar}: ${topic}`,
    hook,
    caption,
    cta,
    hashtags: [hashtag(company), hashtag(topic), hashtag(pillar)].slice(0, 3),
    designBrief: {
      concept: lang === "ar" ? `تصميم بسيط يبرز فكرة "${topic}" بهوية ${company}` : `Clean branded visual highlighting "${topic}" for ${company}`,
      layout: format === "CAROUSEL" ? (lang === "ar" ? "5 شرائح: غلاف، 3 نقاط، دعوة لاتخاذ إجراء" : "5 slides: cover, 3 points, call to action") : lang === "ar" ? "عنوان كبير مع مساحة بيضاء وشعار صغير" : "Bold headline, generous whitespace, small logo",
      visualElements: lang === "ar" ? ["عنوان واضح", "أيقونة بسيطة", "شعار العلامة"] : ["Clear headline", "Simple icon", "Brand logo"],
      textOnImage: hook.length < 80 ? hook : null,
      palette: palette.length ? palette : ["#17161C", "#F7F5F1"],
    },
    dayOffset: i % 7,
    time: TIMES[i % TIMES.length],
    rationale:
      lang === "ar"
        ? `يغطي محور "${pillar}" ويخاطب ${who} على ${platform === "LINKEDIN" ? "لينكدإن" : "المنصة"} بصيغة مناسبة.`
        : `Covers the "${pillar}" pillar and speaks to ${who} in a format suited to ${platform.toLowerCase()}.`,
  };
}

export function offlineContentPlan(b: BrainSnapshot, count: number, platform: Platform | null, topic: string | null): ContentPlan {
  const posts = Array.from({ length: count }, (_, i) => offlinePost(b, i, { platform, topic }));
  const themes = [...new Set(posts.map((p) => p.pillar))];
  return {
    summary:
      b.locale === "ar"
        ? `خطة من ${count} منشورات توازن بين ${themes.join(" و")}، مبنية على خدماتك وجمهورك.`
        : `A ${count}-post plan balancing ${themes.join(", ")}, built from your offerings and audience.`,
    themes,
    posts,
  };
}

export function offlineCampaign(b: BrainSnapshot, topic: string | null): CampaignPlan {
  const lang = b.locale;
  const subject = topic ?? b.offerings[0]?.name ?? (lang === "ar" ? "خدمتنا الجديدة" : "our new service");
  const posts = Array.from({ length: 7 }, (_, i) => ({ ...offlinePost(b, i, { topic: subject }), dayOffset: i * 2 }));
  posts[1] = { ...posts[1], format: "SHORT_VIDEO", platform: "TIKTOK" };
  posts[4] = { ...posts[4], format: "REEL", platform: "INSTAGRAM" };
  posts[2] = { ...posts[2], format: "CAROUSEL", platform: "INSTAGRAM" };
  return {
    name: lang === "ar" ? `حملة إطلاق: ${subject}` : `Launch: ${subject}`,
    objective: lang === "ar" ? `بناء الوعي بـ ${subject} وجذب عملاء محتملين مؤهلين` : `Build awareness for ${subject} and attract qualified leads`,
    audience: audienceName(b),
    offer: null,
    concept: lang === "ar" ? `"${subject}" كما لم تره من قبل — قصة واضحة من المشكلة إلى النتيجة.` : `"${subject}", explained simply — a clear story from problem to result.`,
    keyMessage: b.profile?.valueProps[0] ?? (lang === "ar" ? `${b.org.name} يجعل الأمر أسهل.` : `${b.org.name} makes it easier.`),
    creativeDirection: lang === "ar" ? "تصاميم هادئة بألوان العلامة، صور حقيقية، نصوص قصيرة" : "Calm on-brand visuals, real photography, short on-image text",
    cta: CTAS[lang][2],
    kpis: lang === "ar" ? ["الوصول", "الحفظ والمشاركة", "الرسائل الواردة", "العملاء المحتملون"] : ["Reach", "Saves & shares", "Inbound messages", "Leads"],
    channels: [...new Set(posts.map((p) => p.platform))],
    durationDays: 14,
    posts,
  };
}

export type OnboardingAnswers = {
  companyName?: string;
  website?: string | null;
  description?: string;
  sells?: string;
  offerings?: string[];
  customers?: string;
  customerType?: "B2B" | "B2C" | "BOTH";
  markets?: string;
  tone?: string[];
  colors?: string[];
  goals?: string[];
};

export function offlineAnalysis(
  lang: Lang,
  a: OnboardingAnswers,
  site: { description: string | null; headings: string[]; social: Record<string, string> } | null,
): CompanyAnalysis {
  const name = a.companyName ?? "Company";
  const offerings = (a.offerings?.length ? a.offerings : site?.headings.slice(0, 3) ?? []).slice(0, 6);
  const tone = a.tone?.length ? a.tone : lang === "ar" ? ["ودود", "خبير"] : ["Friendly", "Expert"];
  const b2b = a.customerType === "B2B";
  const channels: CompanyAnalysis["recommendedChannels"] = [];
  const reason = (p: string) =>
    lang === "ar" ? `مناسب لجمهورك${site?.social[p] ? " ولديك حساب قائم" : ""}` : `Fits your audience${site?.social[p] ? " and you already have an account" : ""}`;
  if (b2b) channels.push({ platform: "LINKEDIN", reason: reason("linkedin") });
  channels.push({ platform: "INSTAGRAM", reason: reason("instagram") });
  if (!b2b) channels.push({ platform: "TIKTOK", reason: reason("tiktok") });
  channels.push({ platform: "FACEBOOK", reason: reason("facebook") });

  const desc = a.description || site?.description || (lang === "ar" ? `${name} شركة تقدم ${a.sells ?? "خدماتها"}` : `${name} offers ${a.sells ?? "its services"}`);
  const customers = a.customers || (lang === "ar" ? "العملاء المهتمون بخدماتنا" : "Customers interested in our offerings");
  const pillarsEn = ["Education", "Behind the scenes", "Customer stories", "Offers & updates"];
  const pillarsAr = ["محتوى تعليمي", "خلف الكواليس", "قصص العملاء", "العروض والتحديثات"];
  const pillarNames = lang === "ar" ? pillarsAr : pillarsEn;
  return {
    summary: desc.slice(0, 400),
    tagline: null,
    industry: a.sells?.slice(0, 60) ?? (lang === "ar" ? "خدمات" : "Services"),
    audience: [{ name: customers.slice(0, 60), description: customers.slice(0, 200), pains: [], motivations: [] }],
    brandVoice: { tone: tone.join(", "), traits: tone.slice(0, 5), doSay: [], dontSay: [] },
    offerings: offerings.map((o) => ({ name: o.slice(0, 80), type: "SERVICE" as const, description: "" })),
    valueProps: [],
    contentPillars: pillarNames.map((n) => ({ name: n, description: "" })),
    recommendedChannels: channels.slice(0, 3),
    contentOpportunities:
      lang === "ar"
        ? [
            { title: "أجب عن أسئلة العملاء المتكررة", description: "حوّل الأسئلة التي تصلك إلى منشورات تعليمية قصيرة." },
            { title: "اعرض طريقة عملك", description: "محتوى خلف الكواليس يبني الثقة بسرعة." },
          ]
        : [
            { title: "Answer your customers' most common questions", description: "Turn the questions you hear into short educational posts." },
            { title: "Show how you work", description: "Behind-the-scenes content builds trust quickly." },
          ],
    salesOpportunities:
      lang === "ar"
        ? [{ title: "اجمع العملاء المحتملين من موقعك", description: "أضف نموذج تواصل ذكي ليتولى وكيل المبيعات تأهيلهم تلقائيًا." }]
        : [{ title: "Capture leads from your website", description: "Add a smart contact form so the Sales Agent can qualify inquiries automatically." }],
    strategy: {
      positioning: desc.slice(0, 200),
      firstMonthFocus: lang === "ar" ? "بناء حضور منتظم ومحتوى تعليمي يعرّف بخدماتك" : "Build a consistent presence with educational content about your offerings",
      postingCadence: lang === "ar" ? "3–4 منشورات أسبوعيًا" : "3–4 posts per week",
      kpis: lang === "ar" ? ["معدل التفاعل", "الرسائل الواردة", "العملاء المحتملون"] : ["Engagement rate", "Inbound messages", "Leads"],
    },
  };
}
