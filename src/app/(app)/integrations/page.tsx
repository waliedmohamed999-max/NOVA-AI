import { redirect } from "next/navigation";

/** The old Integrations page. Customers manage accounts in Settings → Connected accounts. */
export default function IntegrationsRedirect() {
  redirect("/settings/connected-accounts");
}
