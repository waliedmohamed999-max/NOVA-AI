import type { Metadata } from "next";
import { requireTenant } from "@/server/context";
import { ProfileForm } from "@/features/settings/forms";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const ctx = await requireTenant();
  return <ProfileForm user={{ name: ctx.user.name ?? "", email: ctx.user.email, locale: ctx.user.locale === "ar" ? "ar" : "en" }} />;
}
