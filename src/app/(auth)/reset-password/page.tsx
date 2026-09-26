import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/features/auth/forms";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage(props: PageProps<"/reset-password">) {
  const { token } = await props.searchParams;
  if (typeof token !== "string" || !token) redirect("/forgot-password");
  return <ResetPasswordForm token={token} />;
}
