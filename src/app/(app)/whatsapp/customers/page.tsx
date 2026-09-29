import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/context";

export const metadata: Metadata = { title: "WhatsApp · Customers" };

/** WhatsApp customers = CRM leads with a WhatsApp conversation (same records — nothing copied). Cursor paged. */
export default async function WhatsAppCustomers(props: PageProps<"/whatsapp/customers">) {
  const ctx = await requireTenant({ permission: "leads:read" });
  const t = await getTranslations("whatsapp.customers");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const sp = await props.searchParams;
  const cursor = typeof sp.after === "string" ? sp.after : undefined;
  const rows = await ctx.db.lead.findMany({
    where: { conversations: { some: { channel: "WHATSAPP" } } },
    orderBy: [{ lastContactAt: "desc" }, { id: "desc" }],
    take: 31,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, name: true, phone: true, stage: true, lastContactAt: true, whatsappOptOut: true, conversations: { where: { channel: "WHATSAPP" }, select: { id: true }, take: 1 } },
  });
  const page = rows.slice(0, 30);
  return (
    <section className="space-y-3">
      <p className="text-sm text-ink-3">{t("hint")}</p>
      {page.length === 0 ? (
        <p className="rounded-[20px] border border-dashed border-line-strong bg-surface-2 p-10 text-center text-sm text-ink-3">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-[20px] border border-line bg-surface">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-line text-start text-xs text-ink-3">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{t("name")}</th>
                <th className="px-4 py-3 text-start font-medium">{t("phone")}</th>
                <th className="px-4 py-3 text-start font-medium">{t("stage")}</th>
                <th className="px-4 py-3 text-start font-medium">{t("last")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {page.map((l) => (
                <tr key={l.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <Link href={`/leads/${l.id}`} className="font-semibold hover:underline">{l.name}</Link>
                    {l.whatsappOptOut && <span className="ms-2 rounded-full bg-sunken px-2 py-0.5 text-[11px] text-ink-3">{t("optedOut")}</span>}
                  </td>
                  <td className="px-4 py-3 text-ink-2" dir="ltr">{l.phone}</td>
                  <td className="px-4 py-3">{tc(`cmd.stages.${l.stage}` as "cmd.stages.NEW")}</td>
                  <td className="px-4 py-3 text-ink-3">{l.lastContactAt ? format.relativeTime(l.lastContactAt) : "—"}</td>
                  <td className="px-4 py-3 text-end">
                    {l.conversations[0] && <Link href={`/whatsapp/inbox?c=${l.conversations[0].id}`} className="text-sm font-semibold text-[#178a45] hover:underline">{t("chat")}</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 30 && (
        <Link href={`/whatsapp/customers?after=${page[page.length - 1].id}`} className="inline-flex rounded-xl border border-line px-4 py-2 text-sm font-medium hover:bg-surface-2">{tc("pagination.next")}</Link>
      )}
    </section>
  );
}
