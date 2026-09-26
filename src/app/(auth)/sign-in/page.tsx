import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "@/features/auth/forms";
import { getSession } from "@/server/auth/session";
import { googleAuthEnabled } from "@/server/auth/google";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage(props: PageProps<"/sign-in">) {
  if (await getSession()) redirect("/home");
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  return <SignInForm googleEnabled={googleAuthEnabled()} next={next} />;
}
