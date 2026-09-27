import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/server/db/client";
import { EmbedLeadForm } from "@/features/sales/embed-form";
import type { FormField } from "@/server/sales/capture";

export const metadata: Metadata = { title: "Contact", robots: { index: false } };

export default async function EmbedLeadPage(props: PageProps<"/embed/lead/[key]">) {
  const { key } = await props.params;
  const form = await db.leadCaptureForm.findUnique({ where: { publicKey: key } });
  if (!form || !form.isActive) notFound();
  const org = await db.organization.findUnique({ where: { id: form.organizationId }, select: { name: true, locale: true } });
  return (
    <main className="min-h-dvh bg-surface p-5" dir={org?.locale === "ar" ? "rtl" : "ltr"} lang={org?.locale ?? "en"}>
      <EmbedLeadForm publicKey={key} fields={form.fields as FormField[]} companyName={org?.name ?? ""} locale={org?.locale === "ar" ? "ar" : "en"} successMessage={form.successMessage} />
    </main>
  );
}
