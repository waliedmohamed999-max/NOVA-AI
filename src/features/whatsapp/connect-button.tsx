"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { completeSignupAction } from "./actions";
import { WhatsAppGlyph } from "./ui";

type FB = {
  init(o: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(cb: (r: { authResponse?: { code?: string } | null }) => void, o: Record<string, unknown>): void;
};
declare global {
  interface Window {
    FB?: FB;
    fbAsyncInit?: () => void;
  }
}

export type SignupConfig = { available: boolean; appId: string | null; configId: string | null; apiVersion: string; testMode: boolean };

function loadSdk(appId: string, version: string) {
  return new Promise<FB>((resolve, reject) => {
    if (window.FB) return resolve(window.FB);
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(window.FB!);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => reject(new Error("sdk"));
    document.body.appendChild(s);
  });
}

/**
 * "Connect WhatsApp Business" — Meta Embedded Signup (official flow). The customer signs in with Meta and
 * picks/creates their business number; we receive only a one-time code + ids, exchanged server-side for a
 * token that is stored encrypted. No IDs or tokens are ever typed or shown. In local test mode (never in
 * production) the flow is simulated against the test transport.
 */
export function ConnectWhatsAppButton({ config, onConnected, size = "md" }: { config: SignupConfig; onConnected?: (n: { display: string | null; name: string | null }) => void; size?: "md" | "lg" }) {
  const t = useTranslations("whatsapp.connect");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ display: string | null; name: string | null } | null>(null);
  const session = useRef<{ phoneNumberId?: string; wabaId?: string }>({});

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!/facebook\.com$/.test(new URL(e.origin).hostname)) return;
      try {
        const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (data?.type === "WA_EMBEDDED_SIGNUP" && data.event?.startsWith("FINISH")) session.current = { phoneNumberId: data.data?.phone_number_id, wabaId: data.data?.waba_id };
      } catch {
        /* other SDK messages */
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const finish = (code: string, phoneNumberId: string, wabaId: string) =>
    start(async () => {
      const r = await completeSignupAction({ code, phoneNumberId, wabaId });
      if (!r.ok) return setError(r.error ?? "integration_error");
      setDone(r.data);
      onConnected?.(r.data);
      router.refresh();
    });

  const connect = () => {
    setError(null);
    // Local test mode only (never production): a unique fake number per workspace.
    if (config.testMode) return finish("test-mode-code", `1${String(Date.now()).slice(-11)}`, "209876543210");
    if (!config.available || !config.appId || !config.configId) return;
    start(async () => {
      try {
        const fb = await loadSdk(config.appId!, config.apiVersion);
        fb.login(
          (resp) => {
            const code = resp.authResponse?.code;
            const { phoneNumberId, wabaId } = session.current;
            if (!code || !phoneNumberId || !wabaId) return setError("cancelled");
            finish(code, phoneNumberId, wabaId);
          },
          { config_id: config.configId, response_type: "code", override_default_response_type: true, extras: { setup: {}, featureType: "", sessionInfoVersion: "3" } },
        );
      } catch {
        setError("integration_error");
      }
    });
  };

  if (done)
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-success-soft px-4 py-3 text-sm text-success" data-testid="wa-connected">
        <CheckCircle2 className="size-5" />
        <span className="font-semibold">{t("done")}</span>
        {done.display && (
          <span className="text-ink-2" dir="ltr">
            {done.display}
          </span>
        )}
      </div>
    );

  const usable = config.available || config.testMode;
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={connect}
        disabled={pending || !usable}
        data-testid="wa-connect"
        className={cn("inline-flex items-center gap-2.5 rounded-2xl bg-[#1fa855] font-semibold text-white shadow-[0_10px_24px_-12px_#1fa855] transition hover:bg-[#178a45] disabled:opacity-50", size === "lg" ? "h-12 px-6 text-[15px]" : "h-10 px-4 text-sm")}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <WhatsAppGlyph className="size-5" />}
        {pending ? t("connecting") : t("cta")}
      </button>
      {!usable && <p className="text-xs text-ink-3">{t("unavailable")}</p>}
      {usable && <p className="text-xs text-ink-3">{t("official")}</p>}
      {error && (
        <p role="alert" className="text-xs font-medium text-danger">
          {error === "cancelled" ? t("cancelled") : te(error as "unexpected")}
        </p>
      )}
    </div>
  );
}
