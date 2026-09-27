import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/features/auth/forms";
import { getSession } from "@/server/auth/session";
import { googleAuthEnabled } from "@/server/auth/google";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignUpPage(props: PageProps<"/sign-up">) {
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : undefined;
  if (await getSession()) redirect(next ?? "/onboarding");
  return <SignUpForm googleEnabled={googleAuthEnabled()} next={next} />;
}
