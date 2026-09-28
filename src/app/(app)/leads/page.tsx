import { redirect } from "next/navigation";

/** Customers and sales are one workspace: /leads is the Sales Desk's customer view. */
export default async function LeadsPage(props: PageProps<"/leads">) {
  const sp = await props.searchParams;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "view") p.set(k, v);
  p.set("view", sp.view === "board" ? "pipeline" : "customers");
  redirect(`/sales?${p}`);
}
