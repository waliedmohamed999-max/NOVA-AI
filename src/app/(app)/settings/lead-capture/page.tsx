import type { Metadata } from "next";
import { requireTenant } from "@/server/context";
import { LeadCaptureSettings } from "@/features/settings/sections";

export const metadata: Metadata = { title: "Website lead capture" };

export default async function LeadCapturePage() {
  const ctx = await requireTenant();
  const forms = await ctx.db.leadCaptureForm.findMany({ orderBy: { createdAt: "asc" } });
  return (
    <LeadCaptureSettings
      appUrl={process.env.APP_URL ?? "http://localhost:3000"}
      canEdit={ctx.can("settings:manage")}
      forms={forms.map((f) => ({ id: f.id, name: f.name, publicKey: f.publicKey, allowedOrigins: f.allowedOrigins, isActive: f.isActive, submissions: f.submissions, successMessage: f.successMessage ?? "" }))}
    />
  );
}
