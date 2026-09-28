/**
 * Company Brain entity definitions, shared by the server (validation, whitelisting) and the UI (editors).
 * Pure data — no server imports. Field labels live in i18n under `brain.fields.<entity>.<field>`.
 */

export type FieldKind = "text" | "textarea" | "list" | "select";
export type FieldDef = { name: string; kind: FieldKind; required?: boolean; max?: number; options?: readonly string[] };

export type EntityDef = {
  /** Prisma delegate name on the tenant client. */
  model: "brainFaq" | "brainObjection" | "competitor" | "customerSegment" | "idealCustomerProfile" | "strategy" | "offering";
  /** Field shown as the row title. */
  title: string;
  subtitle?: string;
  fields: FieldDef[];
  /** Has approved/pending/rejected. */
  approvable?: boolean;
};

const t = (name: string, max = 200, required = false): FieldDef => ({ name, kind: "text", max, required });
const ta = (name: string, max = 4000, required = false): FieldDef => ({ name, kind: "textarea", max, required });
const l = (name: string): FieldDef => ({ name, kind: "list", max: 300 });
const sel = (name: string, options: readonly string[]): FieldDef => ({ name, kind: "select", options });

export const STRATEGY_TYPES = ["business", "marketing", "sales", "content", "retention"] as const;
export const STRATEGY_STATUSES = ["DRAFT", "REVIEW", "APPROVED", "ARCHIVED"] as const;

export const BRAIN_ENTITIES = {
  faq: { model: "brainFaq", title: "question", subtitle: "answer", approvable: true, fields: [t("question", 500, true), ta("answer", 4000, true), t("category", 80), t("audience", 120), t("channel", 60)] },
  objection: { model: "brainObjection", title: "objection", subtitle: "response", approvable: true, fields: [t("objection", 300, true), ta("response", 2000, true), ta("proof", 1000), sel("automation", ["draft_only", "auto_allowed"])] },
  competitor: {
    model: "competitor",
    title: "name",
    subtitle: "positioning",
    fields: [t("name", 160, true), t("website", 300), ta("positioning", 1000), l("services"), t("pricing", 300), l("strengths"), l("weaknesses"), l("contentThemes"), l("channels"), ta("notes", 2000)],
  },
  segment: { model: "customerSegment", title: "name", subtitle: "definition", approvable: true, fields: [t("name", 120, true), ta("definition", 1000), ta("notes", 1000)] },
  icp: {
    model: "idealCustomerProfile",
    title: "name",
    subtitle: "industry",
    fields: [sel("kind", ["B2B", "B2C"]), t("name", 120, true), t("industry", 120), t("companySize", 120), t("location", 160), t("budget", 120), l("painPoints"), l("buyingTriggers"), t("decisionMaker", 160), l("objections"), t("salesCycle", 120), l("channels")],
  },
  strategy: {
    model: "strategy",
    title: "title",
    subtitle: "objective",
    fields: [sel("type", STRATEGY_TYPES), t("title", 160, true), ta("objective", 1000), ta("targetAudience", 1000), ta("positioning", 1000), l("channels"), l("kpis"), l("initiatives"), l("risks"), t("timeline", 160), t("owner", 120)],
  },
  offering: {
    model: "offering",
    title: "name",
    subtitle: "description",
    fields: [
      sel("type", ["SERVICE", "PRODUCT"]),
      t("name", 120, true),
      t("category", 120),
      ta("description", 1000),
      t("targetCustomer", 300),
      ta("problemSolved", 1000),
      l("benefits"),
      l("features"),
      t("priceText", 60),
      t("currency", 3),
      t("deliveryModel", 160),
      t("salesCycle", 120),
      l("upsell"),
      l("crossSell"),
      l("objections"),
      l("proofPoints"),
      l("caseStudies"),
      sel("status", ["active", "draft", "retired"]),
    ],
  },
} as const satisfies Record<string, EntityDef>;

export type BrainEntityType = keyof typeof BRAIN_ENTITIES;
export const BRAIN_ENTITY_TYPES = Object.keys(BRAIN_ENTITIES) as BrainEntityType[];

/** Single-record sections (edited as one panel). */
export const PROFILE_FIELDS: FieldDef[] = [
  t("name", 160, true),
  t("industry", 120),
  l("markets"),
  l("countries"),
  l("languages"),
  t("businessModel", 200),
  t("website", 300),
  ta("description", 2000),
  ta("mission", 1000),
  ta("vision", 1000),
  l("valueProps"),
  l("whyChooseUs"),
  l("differentiators"),
  t("brandPromise", 300),
];

export const SALES_FIELDS: FieldDef[] = [
  ta("playbook", 6000),
  l("qualificationQuestions"),
  l("discoveryQuestions"),
  l("pricingRules"),
  l("discountRules"),
  l("proposalRules"),
  t("followUpCadence", 300),
  l("redFlags"),
  l("escalationRules"),
];

/** Content knowledge = brand kit (voice) + content pillars from the profile. */
export const CONTENT_FIELDS: FieldDef[] = [
  t("tone", 200),
  l("voiceTraits"),
  l("contentPillars"),
  l("topics"),
  l("forbiddenClaims"),
  l("dontSay"),
  t("ctaStyle", 300),
  l("hashtagRules"),
  ta("imageStyle", 500),
  l("seasonalThemes"),
];

/** Source trust (highest first). AI-inferred facts never outrank a human or an official source. */
export const SOURCE_KINDS = ["manual", "crm", "website", "document", "public_web", "ai"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const SOURCE_TRUST: Record<SourceKind, number> = { manual: 6, crm: 5, website: 4, document: 3, public_web: 2, ai: 1 };

/** Critical facts: machine-extracted values need an explicit human approval before agents use them. */
export const CRITICAL_CATEGORIES = ["pricing", "legal", "discount", "policy"] as const;
export const isCriticalCategory = (c: string | null | undefined) => (CRITICAL_CATEGORIES as readonly string[]).includes(c ?? "");
