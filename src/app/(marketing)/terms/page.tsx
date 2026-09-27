import type { Metadata } from "next";
import { LegalPage } from "@/features/legal/legal-page";

export const metadata: Metadata = { title: "Terms of Service" };

export default function Page() {
  return <LegalPage doc="terms" />;
}
