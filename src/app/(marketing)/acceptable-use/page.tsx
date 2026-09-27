import type { Metadata } from "next";
import { LegalPage } from "@/features/legal/legal-page";

export const metadata: Metadata = { title: "Acceptable Use Policy" };

export default function Page() {
  return <LegalPage doc="acceptable-use" />;
}
