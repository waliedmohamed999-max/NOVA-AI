import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/server/context";
import { adminUsers } from "@/server/admin/queries";
import { Badge } from "@/components/ui/badge";
import { AdminSearch, AdminTable } from "@/features/admin/ui";

export const metadata: Metadata = { title: "Admin · Users" };

export default async function AdminUsersPage(props: PageProps<"/admin/users">) {
  await requirePlatformAdmin();
  const t = await getTranslations("settings.admin");
  const format = await getFormatter();
  const q = String((await props.searchParams).q ?? "").slice(0, 100);
  const users = await adminUsers(q);
  return (
    <div className="space-y-5">
      <AdminSearch placeholder={t("searchUsers")} />
      <AdminTable head={[t("col.user"), t("col.orgs"), t("col.verified"), t("col.lastLogin"), t("col.created")]}>
        {users.map((u) => (
          <tr key={u.id}>
            <td className="px-4 py-3"><div className="font-medium">{u.name ?? "—"} {u.isPlatformAdmin && <Badge tone="accent">admin</Badge>}</div><div className="text-xs text-ink-3" dir="ltr">{u.email}</div></td>
            <td className="px-4 py-3 tabular">{u._count.memberships}</td>
            <td className="px-4 py-3">{u.emailVerifiedAt ? "✓" : "—"}</td>
            <td className="px-4 py-3 text-ink-3">{u.lastLoginAt ? format.relativeTime(u.lastLoginAt) : "—"}</td>
            <td className="px-4 py-3 text-ink-3">{format.dateTime(u.createdAt, { dateStyle: "medium" })}</td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}
