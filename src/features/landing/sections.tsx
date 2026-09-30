import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  ArrowRight,
  BarChart3,
  Bell,
  BellRing,
  CalendarDays,
  Check,
  CheckCheck,
  ClipboardList,
  CreditCard,
  FileInput,
  FileText,
  GalleryHorizontal,
  ImagePlus,
  Inbox,
  Languages,
  LayoutTemplate,
  Lightbulb,
  Lock,
  Megaphone,
  Palette,
  Receipt,
  ScrollText,
  ShieldCheck,
  SquareKanban,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import { AGENTS } from "@/config/agents";
import { PLAN_ORDER } from "@/config/plans";
import { cn } from "@/lib/cn";
import { buttonClass } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { AgentMark } from "@/components/agents/agent-mark";
import { ChannelIcon } from "@/components/brand/channel-icon";
import { Logo, LogoMark } from "@/components/brand/logo";
import { LegalLinks } from "@/features/legal/legal-page";

const CHANNELS = [
  ["INSTAGRAM", "Instagram"],
  ["FACEBOOK", "Facebook"],
  ["LINKEDIN", "LinkedIn"],
  ["TIKTOK", "TikTok"],
  ["WHATSAPP", "WhatsApp"],
  ["GOOGLE", "Gmail"],
  ["MICROSOFT", "Outlook"],
] as const;

/** Reference "TRUSTED BY THE BEST" strip — here, the channels NOVA really connects to (grayscale wordmarks). */
export async function ChannelsStrip() {
  const t = await getTranslations("landing.v2.channels");
  return (
    <section className="border-y border-line">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4 border-x border-line px-5 py-5 sm:flex-row sm:items-center sm:gap-10">
        <p className="label-mono shrink-0">{t("label")}</p>
        <ul className="fade-x flex flex-1 items-center justify-between gap-8 overflow-x-auto scrollbar-none">
          {CHANNELS.map(([k, name]) => (
            <li key={k} className="flex shrink-0 items-center gap-2 text-[17px] font-bold tracking-[-0.02em] text-ink-4 grayscale transition hover:text-ink hover:grayscale-0">
              <ChannelIcon channel={k} className="size-7 rounded-[8px]" />
              {name}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Reference "60% of work is lost in context": centred two-tone claim, a tangled-ribbon illustration, 3 columns. */
export async function ProblemSection() {
  const t = await getTranslations("landing.v2.problem");
  const cols = t.raw("cols") as { title: string; body: string }[];
  const bubbles = t.raw("bubbles") as string[];
  return (
    <section className="mx-auto max-w-[1200px] px-5 pb-10 pt-28">
      <Reveal className="mx-auto max-w-3xl text-center">
        <h2 className="text-h2 font-semibold text-balance">
          {t("title")} <span className="tone-tail">{t("tail")}</span>
        </h2>
        <p className="mt-4 text-[17px] text-ink-3">{t("body")}</p>
      </Reveal>
      <Reveal className="relative mt-14 h-[230px]" aria-hidden>
        <svg viewBox="0 0 1200 230" className="absolute inset-0 size-full" preserveAspectRatio="none" fill="none">
          <defs>
            <linearGradient id="ribbon" x1="0" x2="1">
              <stop offset="0" stopColor="#e8e8e8" stopOpacity="0" />
              <stop offset="0.15" stopColor="#d9d9dc" />
              <stop offset="0.85" stopColor="#d9d9dc" />
              <stop offset="1" stopColor="#e8e8e8" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M-20 130 C 120 60, 220 200, 320 110 S 460 30, 560 120 S 700 210, 820 100 S 1000 40, 1220 120" stroke="url(#ribbon)" strokeWidth="22" strokeLinecap="round" />
          <path d="M-20 150 C 160 210, 260 40, 380 140 S 560 190, 640 90 S 860 30, 940 150 S 1100 200, 1220 100" stroke="url(#ribbon)" strokeWidth="14" strokeLinecap="round" opacity="0.7" />
        </svg>
        {(
          [
            ["INSTAGRAM", "8%", "30%"],
            ["WHATSAPP", "18%", "10%"],
            ["EMAIL", "24%", "55%"],
            ["LINKEDIN", "44%", "18%"],
            ["CALENDAR", "52%", "62%"],
            ["FACEBOOK", "60%", "8%"],
          ] as const
        ).map(([c, x, y], i) => (
          <span key={c} className="app-tile absolute size-12 animate-float" style={{ insetInlineStart: x, top: y, animationDelay: `${i * 0.6}s` }}>
            <ChannelIcon channel={c} className="size-8 rounded-[8px] bg-transparent!" />
          </span>
        ))}
        {bubbles.map((b, i) => (
          <span
            key={b}
            className="absolute rounded-[10px] border border-line bg-surface px-3.5 py-2 text-[15px] text-ink-2 shadow-float"
            style={{ insetInlineStart: ["70%", "80%", "72%"][i], top: ["12%", "40%", "70%"][i] }}
          >
            {b}
          </span>
        ))}
      </Reveal>
      <div className="grid gap-0 md:grid-cols-3">
        {cols.map((c, i) => (
          <Reveal key={c.title} delay={i * 90} className="border-line px-5 py-6 md:border-s md:first:border-s-0 md:[&:nth-child(n)]:border-s">
            <h3 className="text-[26px] font-semibold tracking-[-0.03em]">{c.title}</h3>
            <p className="mt-2 text-[16px] leading-relaxed text-ink-3">{c.body}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

const FEATURES: [string, LucideIcon][] = [
  ["plans", ClipboardList],
  ["calendar", CalendarDays],
  ["approvals", CheckCheck],
  ["campaigns", Megaphone],
  ["carousels", GalleryHorizontal],
  ["images", ImagePlus],
  ["analytics", BarChart3],
  ["reports", FileText],
  ["leads", Users],
  ["pipeline", SquareKanban],
  ["quotes", Receipt],
  ["followups", BellRing],
  ["meetings", Video],
  ["inbox", Inbox],
  ["forms", FileInput],
  ["brand", Palette],
  ["roles", ShieldCheck],
  ["audit", ScrollText],
  ["languages", Languages],
  ["templates", LayoutTemplate],
  ["insights", Lightbulb],
  ["notifications", Bell],
  ["billing", CreditCard],
  ["security", Lock],
];

function FeatureCell({ k, Icon, label, faded }: { k: string; Icon: LucideIcon; label: string; faded?: boolean }) {
  return (
    <div data-feature={k} className={cn("group flex h-[126px] flex-col items-center justify-center gap-2.5 px-2 text-center transition-colors duration-150 hover:bg-surface-2", faded && "opacity-40")}>
      <Icon className="size-7 text-ink-2 transition-transform duration-300 ease-[var(--ease-out-soft)] group-hover:-translate-y-0.5" aria-hidden />
      <span className="text-[14px] font-medium text-ink-3 group-hover:text-ink">{label}</span>
    </div>
  );
}

/** Reference "100+ products" grid: a hairline grid of thin icons with four highlight tiles in the middle. */
export async function FeatureGrid() {
  const t = await getTranslations("landing.v2.grid");
  const f = (k: string) => t(`features.${k}` as "features.plans");
  const cell = (i: number, faded = false) => {
    const [k, Icon] = FEATURES[i];
    return <FeatureCell key={k} k={k} Icon={Icon} label={f(k)} faded={faded} />;
  };
  const highlight = (key: "content" | "sales" | "brain" | "whatsapp", visual: React.ReactNode, tint: string) => (
    <div className={cn("relative col-span-2 row-span-2 flex flex-col items-center justify-end overflow-hidden px-6 pb-7 pt-6", tint)}>
      <div className="flex w-full flex-1 items-center justify-center">{visual}</div>
      <p className="mt-4 flex items-center gap-2 text-[26px] font-semibold tracking-[-0.03em]">{t(`highlights.${key}`)}</p>
    </div>
  );
  return (
    <section className="py-24">
      <Reveal className="mx-auto max-w-3xl px-5 text-center">
        <h2 className="text-h2 font-semibold text-balance">
          {t("title")} <span className="tone-tail">{t("tail")}</span>
        </h2>
        <p className="mt-4 text-[17px] text-ink-3">{t("body")}</p>
      </Reveal>
      <div className="fade-x mx-auto mt-14 max-w-[1320px] overflow-hidden">
        {/* Desktop: 8 columns; rows 2-5 frame four 2x2 highlight tiles (auto-placement fills the rest in order). */}
        <div className="cells hidden grid-cols-8 lg:grid">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => cell(i, i === 0 || i === 7))}
          {cell(8, true)}
          {cell(9)}
          {highlight(
            "content",
            <div className="flex gap-2">
              {["Ramadan offer", "Before & after"].map((x, i) => (
                <div key={x} className="w-32 rounded-[10px] border border-line bg-surface p-2.5 text-start shadow-float">
                  <span className={cn("inline-block rounded-[4px] px-1.5 text-[10px] font-semibold uppercase text-white", i ? "bg-nova-blue" : "bg-[#f59a3a]")}>{i ? "Scheduled" : "In review"}</span>
                  <div className="mt-2 h-1.5 w-20 rounded bg-sunken" />
                  <div className="mt-1.5 h-1.5 w-14 rounded bg-sunken" />
                  <div className="mt-2 truncate text-[11px] font-medium text-ink-2">{x}</div>
                </div>
              ))}
            </div>,
            "bg-[linear-gradient(180deg,#fff7ec,transparent)] dark:bg-none",
          )}
          {highlight(
            "sales",
            <div className="w-56 space-y-1.5">
              {[["Nasser Consulting", "bg-[#6ee7b7] text-[#064e3b]", "Won"], ["Saleh Events", "bg-nova-blue text-white", "Proposal"], ["Mariam A.", "bg-sunken text-ink-3", "Lead"]].map(([n, c, st]) => (
                <div key={n} className="flex items-center justify-between rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[11px] shadow-float">
                  <span className="font-medium text-ink-2">{n}</span>
                  <span className={cn("rounded-[4px] px-1.5 font-semibold uppercase", c)}>{st}</span>
                </div>
              ))}
            </div>,
            "bg-[linear-gradient(180deg,#eef6ff,transparent)] dark:bg-none",
          )}
          {cell(10)}
          {cell(11, true)}
          {cell(12, true)}
          {cell(13)}
          {cell(14)}
          {cell(15, true)}
          {cell(16, true)}
          {cell(17)}
          {highlight(
            "brain",
            <span className="rainbow-border block rounded-full">
              <span className="flex size-20 items-center justify-center rounded-full bg-surface">
                <LogoMark size={40} />
              </span>
            </span>,
            "bg-[linear-gradient(180deg,#f6f1ff,transparent)] dark:bg-none",
          )}
          {highlight(
            "whatsapp",
            <div className="w-56 space-y-2 text-[12px]">
              <div className="w-fit max-w-[80%] rounded-[10px] rounded-es-[3px] bg-surface px-2.5 py-1.5 text-ink-2 shadow-float">Is the facial available Friday?</div>
              <div className="ms-auto w-fit max-w-[85%] rounded-[10px] rounded-ee-[3px] bg-[#dcf8c6] px-2.5 py-1.5 text-[#1f3b1f] shadow-float">Yes — 4 pm or 6 pm. Shall I book one?</div>
            </div>,
            "bg-[linear-gradient(180deg,#ecfbf1,transparent)] dark:bg-none",
          )}
          {cell(18)}
          {cell(19, true)}
          {cell(20, true)}
          {cell(21)}
          {cell(22)}
          {cell(23, true)}
        </div>
        {/* Mobile/tablet: a plain grid. */}
        <div className="cells grid grid-cols-3 sm:grid-cols-4 lg:hidden">{FEATURES.slice(0, 12).map((_, i) => cell(i))}</div>
      </div>
    </section>
  );
}

/** Reference "A new era of humans, with Super Agents": big centred claim, two CTAs, then the team as hairline cells. */
export async function TeamSection() {
  const t = await getTranslations("landing.v2.team");
  const tl = await getTranslations("landing.team");
  const tc = await getTranslations("common");
  return (
    <section id="team" className="border-t border-line py-28">
      <Reveal className="mx-auto max-w-4xl px-5 text-center">
        <h2 className="text-display font-bold text-balance">
          {t("title")} <span className="tone-tail">{t("tail")}</span>
        </h2>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/sign-up" className={buttonClass("primary", "lg")}>{t("primary")}</Link>
          <a href="#how" className={buttonClass("secondary", "lg")}>{t("secondary")}</a>
        </div>
      </Reveal>
      <div className="mx-auto mt-16 max-w-[1200px] px-5">
        <div className="cells grid sm:grid-cols-2 lg:grid-cols-3">
          {AGENTS.map((a, i) => (
            <Reveal key={a.key} delay={(i % 3) * 80} className="group p-7 transition-colors duration-150 hover:bg-surface-2">
              <AgentMark agent={a.key} size={44} />
              <p className="label-mono mt-6">{tc(`agents.${a.key}.role`)}</p>
              <h3 className="mt-1.5 text-[22px] font-semibold tracking-[-0.025em]">{tc(`agents.${a.key}.name`)}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-3">{tl(`examples.${a.key}` as "examples.SOCIAL_MANAGER")}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Reference Brain² panel: black canvas, aurora glow, silver headline, mono labels, 3 hairline cells with vignettes. */
export async function BrainDarkSection() {
  const t = await getTranslations("landing.v2.dark");
  const th = await getTranslations("landing.how");
  const cells = t.raw("cells") as { label: string; body: string }[];
  const steps = ["connect", "understand", "create", "grow"] as const;
  return (
    <section id="how" className="on-dark relative overflow-hidden bg-black text-white" data-theme="dark">
      <div className="pointer-events-none absolute inset-x-0 top-[180px] h-[520px] aurora opacity-80 blur-2xl" aria-hidden />
      <div className="relative mx-auto max-w-[1200px] px-5 pt-28">
        <Reveal className="text-center">
          <div className="flex items-center justify-center gap-3">
            <LogoMark size={52} />
            <span className="text-[44px] font-bold tracking-[-0.04em]">{t("brand")}</span>
          </div>
          <h2 className="mx-auto mt-8 max-w-4xl text-display font-bold text-balance">
            <span className="text-silver">
              {t("title")} <em className="not-italic [font-style:italic]">{t("titleEm")}</em>
            </span>
          </h2>
          <p className="mt-6 text-[19px] text-white/70">{t("body")}</p>
          <p className="mt-6 flex items-center justify-center gap-5 font-mono text-[13px] uppercase tracking-[0.1em] text-white/45">
            {t("langs")} <span className="text-white/70">العربية</span> <span className="text-white/70">English</span>
          </p>
        </Reveal>
        <div className="cells dark relative mt-24 grid bg-black/40 backdrop-blur md:grid-cols-3">
          {cells.map((c, i) => (
            <Reveal key={c.label} delay={i * 90} className="flex min-h-[340px] flex-col p-7">
              <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-white">{c.label}</p>
              <p className="mt-3 text-[16px] leading-relaxed text-white/75">{c.body}</p>
              <div className="mt-auto pt-8">
                {i === 0 && (
                  <div className="w-64 rounded-[14px] border border-white/10 bg-[#111] p-4 shadow-[0_20px_60px_-20px_rgba(118,18,250,.6)]">
                    <div className="flex items-center justify-between text-[13px] font-semibold">{t("vignette.memory")} <LogoMark size={18} /></div>
                    <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-white/45">{t("vignette.memoryKey")}:</p>
                    <p className="text-silver text-[22px] font-semibold tracking-[-0.02em]">{t("vignette.memoryValue")}</p>
                  </div>
                )}
                {i === 1 && (
                  <div className="w-64 rounded-[14px] border border-white/10 bg-[#111] p-4">
                    <p className="flex items-center gap-2 text-[13px] text-white/70">
                      <span className="size-2 animate-pulse-soft rounded-full bg-[#fbbf24]" /> {t("vignette.approval")}
                    </p>
                    <p className="mt-2 text-[15px] font-semibold">{t("vignette.approvalItem")}</p>
                    <div className="mt-3 flex gap-2">
                      <span className="rounded-[6px] bg-white px-2.5 py-1 text-[12px] font-bold text-black">✓</span>
                      <span className="rounded-[6px] border border-white/15 px-2.5 py-1 text-[12px] text-white/70">✎</span>
                    </div>
                  </div>
                )}
                {i === 2 && (
                  <div className="w-64 rounded-[14px] border border-white/10 bg-[#111] p-4">
                    <p className="text-[13px] text-white/70">{t("vignette.learning")}</p>
                    <div className="mt-3 flex h-16 items-end gap-1.5">
                      {[30, 42, 38, 55, 48, 70, 88].map((h, j) => (
                        <span key={j} className="flex-1 rounded-t-[3px] bg-[linear-gradient(180deg,#0091ff,#7612fa)]" style={{ height: `${h}%`, opacity: 0.45 + j * 0.08 }} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal className="pb-24 pt-28 text-center">
          <h2 className="text-h2 font-semibold text-white">{t("how")}</h2>
        </Reveal>
        <ol className="cells dark relative mb-28 grid bg-black/40 md:grid-cols-4">
          {steps.map((k, i) => (
            <Reveal as="li" key={k} delay={i * 80} className="p-7">
              <p className="font-mono text-[12px] tracking-[0.12em] text-white/45">0{i + 1}</p>
              <h3 className="mt-3 text-[22px] font-semibold tracking-[-0.025em]">{th(`steps.${k}.title`)}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-white/65">{th(`steps.${k}.body`)}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

export async function PricingSection() {
  const t = await getTranslations("landing.pricing");
  const v = await getTranslations("landing.v2.pricing");
  return (
    <section id="pricing" className="border-b border-line bg-surface-2 py-28">
      <div className="mx-auto max-w-[1200px] px-5">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-h2 font-semibold text-balance">{t("title")}</h2>
          <p className="mt-4 text-[17px] text-ink-3">{t("body")}</p>
        </Reveal>
        <div className="mt-14 grid gap-4 lg:grid-cols-3">
          {PLAN_ORDER.map((p, i) => {
            const featured = p === "GROWTH";
            return (
              <Reveal
                key={p}
                delay={i * 90}
                className={cn("flex flex-col rounded-xl border p-7", featured ? "on-dark border-[#111] bg-[#111] text-white" : "border-line bg-surface")}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-[22px] font-semibold tracking-[-0.025em]">{t(`plans.${p}.name`)}</h3>
                  {featured && <span className="rounded-full bg-accent px-2.5 py-0.5 text-[12px] font-semibold text-white">{v("popular")}</span>}
                </div>
                <p className={cn("mt-2 text-[15px]", featured ? "text-white/65" : "text-ink-3")}>{t(`plans.${p}.tagline`)}</p>
                <ul className="mt-7 space-y-3 text-[15px]">
                  {(t.raw(`plans.${p}.features`) as string[]).map((f) => (
                    <li key={f} className="flex gap-2.5">
                      <Check className="mt-0.5 size-[18px] shrink-0 text-nova-blue" strokeWidth={2.5} aria-hidden /> {f}
                    </li>
                  ))}
                </ul>
                <Link href="/sign-up" className={cn("mt-auto pt-8", "block")}>
                  <span className={featured ? "inline-flex h-10 w-full items-center justify-center rounded-[10px] bg-white text-sm font-bold text-black transition-colors hover:bg-white/90" : buttonClass("primary", "md", "w-full")}>{t("cta")}</span>
                </Link>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** Reference closing panel: noise-dark aurora, big white claim, white button. */
export async function FinalCta({ signedIn }: { signedIn: boolean }) {
  const t = await getTranslations("landing.v2.final");
  return (
    <section className="on-dark relative overflow-hidden bg-black text-white" data-theme="dark">
      <div className="pointer-events-none absolute inset-x-[-10%] bottom-[-35%] h-[90%] aurora opacity-90 blur-3xl" aria-hidden />
      <Reveal className="relative mx-auto max-w-4xl px-5 py-32 text-center">
        <h2 className="text-h1 font-bold text-balance">
          {t("title")} <span className="text-white/55">{t("tail")}</span>
        </h2>
        <div className="mt-10 flex flex-col items-center gap-4">
          <Link
            href={signedIn ? "/home" : "/sign-up"}
            className="inline-flex h-[52px] items-center gap-2.5 rounded-[12px] bg-white px-6 text-[17px] font-bold tracking-[-0.02em] text-black transition-colors duration-150 hover:bg-white/90"
          >
            {t("primary")} <ArrowRight className="size-5 flip-rtl" />
          </Link>
          {!signedIn && (
            <Link href="/sign-in" className="text-[16px] font-semibold text-white/80 hover:text-white">
              {t("secondary")}
            </Link>
          )}
        </div>
      </Reveal>
    </section>
  );
}

export async function SiteFooter({ locale }: { locale: "en" | "ar" }) {
  const t = await getTranslations("landing.v2.footer");
  const tn = await getTranslations("landing.nav");
  const tc = await getTranslations("common");
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-5 py-14 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-4">
          <Logo />
          <p className="max-w-xs text-[14px] text-ink-3">{tc("subtitle")}</p>
        </div>
        <div>
          <p className="label-mono">{t("product")}</p>
          <ul className="mt-4 space-y-2.5 text-[15px] text-ink-3">
            {(["product", "team", "how", "pricing"] as const).map((k) => (
              <li key={k}>
                <a href={`#${k === "product" ? "product" : k}`} className="hover:text-ink">{tn(k)}</a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="label-mono">{t("legal")}</p>
          <div className="mt-4">
            <LegalLinks locale={locale} />
          </div>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-[1200px] px-5 py-5 font-mono text-[12px] uppercase tracking-[0.08em] text-ink-4">
          © {new Date().getFullYear()} NOVA · {t("rights")}
        </p>
      </div>
    </footer>
  );
}
