import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BookOpen, Mail, MessageSquareText } from "lucide-react";
import { brand } from "@/config/brand";
import { PageHeader } from "@/components/ui/card";
import { HelpAsk } from "@/features/help/ask";

export const metadata: Metadata = { title: "Help" };

export default async function HelpPage() {
  const t = await getTranslations("settings.help");
  const faqs = t.raw("faqs") as { q: string; a: string }[];
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-3 sm:grid-cols-3">
        <HelpAsk />
        <Link href="/knowledge" className="rounded-2xl border border-line bg-surface p-5 transition hover:shadow-md">
          <BookOpen className="size-5 text-ink-2" />
          <div className="mt-3 font-semibold">{t("teach")}</div>
          <p className="text-sm text-ink-3">{t("teachBody")}</p>
        </Link>
        <a href={`mailto:${brand.supportEmail}`} className="rounded-2xl border border-line bg-surface p-5 transition hover:shadow-md">
          <Mail className="size-5 text-ink-2" />
          <div className="mt-3 font-semibold">{t("contact")}</div>
          <p className="text-sm text-ink-3" dir="ltr">{brand.supportEmail}</p>
        </a>
      </div>
      <h2 className="mb-4 mt-10 flex items-center gap-2 text-sm font-semibold">
        <MessageSquareText className="size-4" /> {t("faqTitle")}
      </h2>
      <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
        {faqs.map((f) => (
          <details key={f.q} className="px-5 py-4">
            <summary className="cursor-pointer list-none font-medium">{f.q}</summary>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{f.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
