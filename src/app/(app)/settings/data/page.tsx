import type { Metadata } from "next";
import { getFormatter } from "next-intl/server";
import { requireTenant } from "@/server/context";
import { signedFileUrl } from "@/server/storage";
import { DataSettings } from "@/features/settings/sections";

export const metadata: Metadata = { title: "Data & privacy" };

export default async function DataPage() {
  const ctx = await requireTenant();
  const format = await getFormatter();
  const exports = await ctx.db.dataExport.findMany({ orderBy: { createdAt: "desc" }, take: 5 });
  return (
    <DataSettings
      orgName={ctx.organization.name}
      email={ctx.user.email}
      canExport={ctx.can("data:export")}
      canDelete={ctx.can("org:delete")}
      exports={exports.map((e) => ({ id: e.id, status: e.status, date: format.dateTime(e.createdAt, { dateStyle: "medium", timeStyle: "short" }), url: e.status === "READY" && e.fileId && (!e.expiresAt || e.expiresAt > new Date()) ? signedFileUrl(e.fileId, 600) : null }))}
    />
  );
}
