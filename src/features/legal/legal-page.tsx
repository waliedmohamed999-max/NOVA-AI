import Link from "next/link";
import { getLocale } from "next-intl/server";
import { Logo } from "@/components/brand/logo";
import { legalDoc, type LegalKey } from "@/content/legal";

const LINKS: { key: LegalKey; en: string; ar: string }[] = [
  { key: "privacy", en: "Privacy", ar: "الخصوصية" },
  { key: "terms", en: "Terms", ar: "الشروط" },
  { key: "data-deletion", en: "Data deletion", ar: "حذف البيانات" },
  { key: "acceptable-use", en: "Acceptable use", ar: "الاستخدام المقبول" },
];

export async function LegalPage({ doc: key }: { doc: LegalKey }) {
  const locale = (await getLocale()) === "ar" ? "ar" : "en";
  const doc = legalDoc(key, locale);
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5">
          <Link href="/" aria-label="NOVA"><Logo /></Link>
          <nav className="flex flex-wrap gap-3 text-sm text-ink-3">
            {LINKS.map((l) => (
              <Link key={l.key} href={`/${l.key}`} className={l.key === key ? "font-semibold text-ink" : "hover:text-ink"}>{l[locale]}</Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-8 px-5 py-12">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">{doc.title}</h1>
          <p className="text-sm text-ink-3">{locale === "ar" ? "آخر تحديث" : "Last updated"}: {doc.updated}</p>
          <p className="text-ink-2">{doc.intro}</p>
        </div>
        {doc.sections.map((s) => (
          <section key={s.h} className="space-y-2">
            <h2 className="text-lg font-semibold">{s.h}</h2>
            {s.p.length > 2 ? (
              <ul className="list-disc space-y-1.5 ps-5 text-ink-2">{s.p.map((x) => <li key={x}>{x}</li>)}</ul>
            ) : (
              s.p.map((x) => <p key={x} className="text-ink-2">{x}</p>)
            )}
          </section>
        ))}
      </main>
    </div>
  );
}

export function LegalLinks({ locale }: { locale: "en" | "ar" }) {
  return (
    <nav className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
      {LINKS.map((l) => (
        <Link key={l.key} href={`/${l.key}`} className="hover:text-ink hover:underline">{l[locale]}</Link>
      ))}
    </nav>
  );
}
