import { z } from "zod";

/**
 * Guided company setup: the option catalogues, validation and progress rules shared by the onboarding UI
 * and the server actions. Option labels live here (both languages) because the chosen label is what gets
 * written into the Company Brain (brand kit, profile, facts) — one source for the UI and the stored value.
 */

export type Lang = "ar" | "en";
type Opt = { ar: string; en: string };
const o = (en: string, ar: string): Opt => ({ en, ar });

export const SETUP_STEPS = ["business", "audience", "brand", "goals", "channels", "review"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export const BUSINESS_TYPES = { PRODUCTS: o("Products", "منتجات"), SERVICES: o("Services", "خدمات"), BOTH: o("Both", "الاثنين") } as const;
export type BusinessType = keyof typeof BUSINESS_TYPES;

export const CUSTOMER_TYPES = { B2C: o("Individuals", "الأفراد"), B2B: o("Businesses", "الشركات"), BOTH: o("Both", "كلاهما") } as const;
export type CustomerType = keyof typeof CUSTOMER_TYPES;

export const TONES = {
  professional: o("Professional", "احترافي"),
  friendly: o("Friendly", "ودود"),
  bold: o("Bold", "جريء"),
  luxury: o("Luxury", "فاخر"),
  playful: o("Playful", "مرح"),
  warm: o("Warm", "دافئ"),
  direct: o("Direct", "مباشر"),
  technical: o("Technical", "تقني"),
} as const;
export type Tone = keyof typeof TONES;

export const GOALS = {
  sales: o("Increase sales", "زيادة المبيعات"),
  leads: o("More leads", "زيادة العملاء المحتملين"),
  brand: o("Build the brand", "بناء العلامة التجارية"),
  traffic: o("More website visits", "زيادة الزيارات"),
  content: o("Better content", "تحسين المحتوى"),
  followup: o("Automate follow-ups", "أتمتة المتابعة"),
  expand: o("Expand the market", "توسيع السوق"),
} as const;
export type Goal = keyof typeof GOALS;

export const VISUAL_STYLES = {
  minimal: o("Clean & minimal", "بسيط ونظيف"),
  bold: o("Bold & colorful", "جريء وملوّن"),
  elegant: o("Elegant & premium", "أنيق وفاخر"),
  friendly: o("Friendly & playful", "ودود ومرح"),
  corporate: o("Corporate & trustworthy", "مؤسسي وموثوق"),
} as const;
export type VisualStyle = keyof typeof VISUAL_STYLES;

export const CONTENT_STYLES = {
  educational: o("Educational", "تعليمي"),
  storytelling: o("Storytelling", "قصصي"),
  promotional: o("Promotional", "ترويجي"),
  inspirational: o("Inspirational", "ملهم"),
  behind: o("Behind the scenes", "خلف الكواليس"),
} as const;
export type ContentStyle = keyof typeof CONTENT_STYLES;

export const CTA_STYLES = {
  soft: o("Soft invitation", "دعوة لطيفة"),
  direct: o("Clear & direct", "واضحة ومباشرة"),
  urgent: o("Time-limited", "محدودة بوقت"),
} as const;
export type CtaStyle = keyof typeof CTA_STYLES;

export const BUDGETS = {
  low: o("Budget-conscious", "ميزانية محدودة"),
  mid: o("Mid-range", "متوسطة"),
  high: o("Premium", "مرتفعة"),
  varies: o("Varies", "متفاوتة"),
} as const;
export type Budget = keyof typeof BUDGETS;

export const COMPANY_SIZES = {
  micro: o("1–10 employees", "1–10 موظفين"),
  small: o("11–50 employees", "11–50 موظفًا"),
  mid: o("51–250 employees", "51–250 موظفًا"),
  large: o("250+ employees", "أكثر من 250 موظفًا"),
} as const;
export type CompanySize = keyof typeof COMPANY_SIZES;

export const CHANNELS = ["INSTAGRAM", "TIKTOK", "LINKEDIN", "X", "FACEBOOK", "SNAPCHAT", "YOUTUBE", "WHATSAPP", "WEBSITE", "EMAIL"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<Channel, Opt> = {
  INSTAGRAM: o("Instagram", "إنستغرام"),
  TIKTOK: o("TikTok", "تيك توك"),
  LINKEDIN: o("LinkedIn", "لينكدإن"),
  X: o("X", "إكس"),
  FACEBOOK: o("Facebook", "فيسبوك"),
  SNAPCHAT: o("Snapchat", "سناب شات"),
  YOUTUBE: o("YouTube", "يوتيوب"),
  WHATSAPP: o("WhatsApp", "واتساب"),
  WEBSITE: o("Website", "الموقع"),
  EMAIL: o("Email", "البريد"),
};

/** Industries offered in the combobox; free text is allowed too ("Other"). */
export const INDUSTRIES = {
  technology: o("Information technology", "تقنية المعلومات"),
  marketing: o("Marketing & advertising", "التسويق والإعلان"),
  retail: o("Retail", "التجزئة"),
  ecommerce: o("E-commerce", "التجارة الإلكترونية"),
  healthcare: o("Healthcare", "الرعاية الصحية"),
  education: o("Education & training", "التعليم والتدريب"),
  consulting: o("Consulting", "الاستشارات"),
  real_estate: o("Real estate", "العقارات"),
  food: o("Food & restaurants", "الأغذية والمطاعم"),
  beauty: o("Beauty & wellness", "التجميل والعناية"),
  construction: o("Construction & contracting", "البناء والمقاولات"),
  finance: o("Finance & insurance", "المالية والتأمين"),
  tourism: o("Travel & tourism", "السفر والسياحة"),
  manufacturing: o("Manufacturing", "التصنيع"),
  other: o("Other", "أخرى"),
} as const;
export type Industry = keyof typeof INDUSTRIES;

/** Countries offered first (the product's core markets); the list is ISO-3166 alpha-2. */
export const COUNTRIES = ["SA", "AE", "EG", "KW", "QA", "BH", "OM", "JO", "LB", "IQ", "MA", "DZ", "TN", "LY", "SD", "YE", "PS", "SY", "TR", "GB", "US", "DE", "FR", "CA", "IN", "PK"] as const;

export const label = (opt: Opt | undefined, lang: Lang) => (opt ? opt[lang] : "");
export function countryName(code: string, lang: Lang) {
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

// ── Local suggestions (no AI): keyword rules over the website's title, description and offerings ──

const INDUSTRY_RULES: [Industry, RegExp][] = [
  ["technology", /(software|saas|it services|cloud|app development|web ?development|website development|hosting|cyber|برمج|تطبيقات|تطوير (المواقع|الويب|البرمجيات)|تقنية|تقنيه|الحوسبة|استضافة|أمن المعلومات|حلول رقمية)/i],
  ["marketing", /(marketing|advertis|branding|social media|seo|agency|تسويق|إعلان|اعلان|هوية بصرية|سوشيال ميديا|وكالة)/i],
  ["ecommerce", /(online store|shop now|add to cart|free shipping|متجر إلكتروني|متجر الكتروني|أضف إلى السلة|اضف للسلة|شحن مجاني)/i],
  ["healthcare", /(clinic|hospital|dental|medical|pharmacy|عيادة|مستشفى|طب |أسنان|اسنان|صيدلية|طبي)/i],
  ["education", /(academy|course|training|school|university|tutoring|أكاديمية|اكاديمية|دورة|دورات|تدريب|مدرسة|جامعة|تعليم)/i],
  ["real_estate", /(real estate|property|apartments|villas|عقار|شقق|فلل|عقارات)/i],
  ["food", /(restaurant|cafe|coffee|bakery|catering|menu|مطعم|مقهى|كافيه|قهوة|مخبز|حلويات|تموين)/i],
  ["beauty", /(salon|spa|beauty|cosmetic|skincare|صالون|سبا|تجميل|عناية بالبشرة|مستحضرات)/i],
  ["construction", /(construction|contracting|engineering|interior design|مقاولات|بناء|هندسة|تصميم داخلي|ديكور)/i],
  ["finance", /(accounting|finance|insurance|bank|investment|محاسبة|مالية|تأمين|بنك|استثمار)/i],
  ["tourism", /(travel|tour|hotel|umrah|booking|سفر|سياحة|فندق|عمرة|رحلات)/i],
  ["consulting", /(consult|advisory|استشار)/i],
  ["manufacturing", /(factory|manufactur|مصنع|تصنيع)/i],
  ["retail", /(store|showroom|retail|معرض|محل|متجر)/i],
];

export function suggestIndustry(text: string): Industry | null {
  for (const [key, re] of INDUSTRY_RULES) if (re.test(text)) return key;
  return null;
}

const B2B = /(\bb2b\b|for businesses|enterprises?|smes?\b|companies|corporate|للشركات|والشركات|وللشركات|المؤسسات|الشركات الصغيرة|قطاع الأعمال|المنشآت)/i;
const B2C = /(for you|your home|families|individuals|customers like you|shop now|للأفراد|لك ولعائلتك|العائلات|الأسر|تسوق الآن)/i;

export function suggestCustomerType(text: string): CustomerType | null {
  const b2b = B2B.test(text);
  const b2c = B2C.test(text);
  return b2b && b2c ? "BOTH" : b2b ? "B2B" : b2c ? "B2C" : null;
}

// ── Answers stored on the organization while the setup is in progress ──

export type SetupAnswers = {
  website?: string | null;
  noWebsite?: boolean;
  description?: string;
  sells?: string;
  offerings?: string[];
  industry?: string;
  businessType?: BusinessType;
  country?: string;
  markets?: string;
  customerType?: CustomerType;
  customers?: string;
  audience?: {
    locations?: string;
    industries?: string[];
    companySize?: CompanySize | null;
    ageMin?: number | null;
    ageMax?: number | null;
    budget?: Budget | null;
    painPoints?: string[];
    buyingTriggers?: string[];
    decisionMaker?: string;
  };
  /** Localized labels (what the analysis and the brain read). */
  tone?: string[];
  colors?: string[];
  goals?: string[];
  brand?: { tones?: Tone[]; visualStyle?: VisualStyle; contentStyles?: ContentStyle[]; ctaStyle?: CtaStyle; logoFileId?: string | null };
  goalKeys?: Goal[];
  goal90?: string;
  channels?: Channel[];
  focusOffering?: string;
  setup?: { currentStep?: SetupStep; completed?: SetupStep[]; updatedAt?: string; icpId?: string; strategyId?: string; importId?: string };
  runId?: string;
};

// ── Validation (the server re-validates everything with these schemas) ──

const text = (max: number) => z.string().trim().max(max);
const list = (max: number, each = 120) => z.array(z.string().trim().min(1).max(each)).max(max);
export const WEBSITE_RE = /^(https?:\/\/)?([\p{L}\p{N}-]+\.)+[\p{L}]{2,}(:\d{2,5})?(\/\S*)?$/u;

export const businessSchema = z
  .object({
    companyName: z.string().trim().min(1).max(120),
    website: z.string().trim().max(300).regex(WEBSITE_RE).nullable(),
    noWebsite: z.boolean(),
    description: text(2000),
    offerings: list(12),
    industry: text(120),
    businessType: z.enum(["PRODUCTS", "SERVICES", "BOTH"]),
    country: z.string().regex(/^[A-Z]{2}$/).nullable(),
    markets: text(200),
    customerType: z.enum(["B2C", "B2B", "BOTH"]),
  })
  .partial();

export const audienceSchema = z
  .object({
    customers: text(1000),
    locations: text(200),
    industries: list(8, 80),
    companySize: z.enum(["micro", "small", "mid", "large"]).nullable(),
    ageMin: z.number().int().min(13).max(100).nullable(),
    ageMax: z.number().int().min(13).max(100).nullable(),
    budget: z.enum(["low", "mid", "high", "varies"]).nullable(),
    painPoints: list(8, 200),
    buyingTriggers: list(8, 200),
    decisionMaker: text(160),
  })
  .partial()
  .refine((a) => a.ageMin == null || a.ageMax == null || a.ageMin <= a.ageMax, { message: "age_range", path: ["ageMax"] });

const HEX = /^#[0-9a-fA-F]{6}$/;
export const brandSchema = z
  .object({
    tones: z.array(z.enum(Object.keys(TONES) as [Tone, ...Tone[]])).max(8),
    colors: z.array(z.string().regex(HEX)).max(4),
    visualStyle: z.enum(Object.keys(VISUAL_STYLES) as [VisualStyle, ...VisualStyle[]]).nullable(),
    contentStyles: z.array(z.enum(Object.keys(CONTENT_STYLES) as [ContentStyle, ...ContentStyle[]])).max(5),
    ctaStyle: z.enum(Object.keys(CTA_STYLES) as [CtaStyle, ...CtaStyle[]]).nullable(),
  })
  .partial();

export const goalsSchema = z
  .object({
    goals: z.array(z.enum(Object.keys(GOALS) as [Goal, ...Goal[]])).max(7),
    goal90: text(300),
    channels: z.array(z.enum(CHANNELS)).max(10),
    focusOffering: text(120),
  })
  .partial();

// ── Progress: required answers (80%) + confirmed steps (20%) ──

export const REQUIRED: Record<Exclude<SetupStep, "review" | "channels">, (a: SetupAnswers, companyName: string) => boolean[]> = {
  business: (a, name) => [Boolean(name.trim()), Boolean(a.businessType), Boolean(a.industry?.trim()), Boolean(a.customerType)],
  audience: (a) => [Boolean(a.customers?.trim()), Boolean(a.audience?.locations?.trim() || a.markets?.trim())],
  brand: (a) => [Boolean(a.brand?.tones?.length)],
  goals: (a) => [Boolean(a.goalKeys?.length)],
};

/** Steps with required answers ("channels" and "review" never block). */
const GATED = ["business", "audience", "brand", "goals"] as const;

export function stepReady(step: SetupStep, a: SetupAnswers, companyName: string) {
  return step === "review" || step === "channels" ? true : REQUIRED[step](a, companyName).every(Boolean);
}

export function setupProgress(a: SetupAnswers, companyName: string) {
  const checks = (Object.keys(REQUIRED) as (keyof typeof REQUIRED)[]).flatMap((s) => REQUIRED[s](a, companyName));
  const confirmed = (a.setup?.completed ?? []).filter((s) => (GATED as readonly string[]).includes(s) && stepReady(s, a, companyName)).length;
  const percent = Math.round((checks.filter(Boolean).length / checks.length) * 80 + (confirmed / GATED.length) * 20);
  const done = SETUP_STEPS.filter((s) => s !== "review" && (a.setup?.completed ?? []).includes(s) && stepReady(s, a, companyName)).length;
  return { percent: Math.min(100, percent), doneSteps: done };
}
