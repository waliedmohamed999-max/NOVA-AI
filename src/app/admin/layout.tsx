import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Shield } from "lucide-react";
import { requirePlatformAdmin } from "@/server/context";
import { Logo } from "@/components/brand/logo";
import { AdminNav } from "@/features/admin/nav";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requirePlatformAdmin();
  const t = await getTranslations("settings.admin");
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-5">
          <Logo />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-xs font-semibold text-ink-inverse"><Shield className="size-3.5" /> {t("badge")}</span>
          <Link href="/home" className="ms-auto inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink"><ArrowLeft className="size-4 flip-rtl" /> {t("back")}</Link>
        </div>
        <AdminNav />
      </header>
      <main className="mx-auto max-w-7xl px-5 py-8">{children}</main>
    </div>
  );
}
