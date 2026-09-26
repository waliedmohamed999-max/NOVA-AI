import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/features/auth/forms";
import { getSession } from "@/server/auth/session";
import { googleAuthEnabled } from "@/server/auth/google";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignUpPage() {
  if (await getSession()) redirect("/onboarding");
  return <SignUpForm googleEnabled={googleAuthEnabled()} />;
}
