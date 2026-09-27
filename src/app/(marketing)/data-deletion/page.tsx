import type { Metadata } from "next";
import { LegalPage } from "@/features/legal/legal-page";

export const metadata: Metadata = { title: "Data Deletion" };

export default function Page() {
  return <LegalPage doc="data-deletion" />;
}
