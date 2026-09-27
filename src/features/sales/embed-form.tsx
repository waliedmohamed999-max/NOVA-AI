"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import type { FormField } from "@/server/sales/capture";

/** Copy lives here (not in the app catalogs) because the embed follows the company's language, not the visitor's session. */
const COPY = {
  en: { send: "Send", sent: "Thanks! We'll be in touch shortly.", error: "Something went wrong. Please try again.", required: "Please fill in the highlighted fields.", limited: "Too many attempts. Please try again later." },
  ar: { send: "إرسال", sent: "شكرًا لك! سنتواصل معك قريبًا.", error: "حدث خطأ. حاول مرة أخرى.", required: "يرجى تعبئة الحقول المحددة.", limited: "محاولات كثيرة. حاول لاحقًا." },
};

export function EmbedLeadForm({ publicKey, fields, companyName, locale, successMessage }: { publicKey: string; fields: FormField[]; companyName: string; locale: "en" | "ar"; successMessage: string | null }) {
  const c = COPY[locale];
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [bad, setBad] = useState<string[]>([]);
  const started = useRef(0);
  useEffect(() => {
    started.current = Date.now();
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    const params = new URLSearchParams(window.location.search);
    const res = await fetch(`/api/public/leads/${publicKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...data, _ts: started.current, utm_source: params.get("utm_source") ?? undefined, utm_campaign: params.get("utm_campaign") ?? undefined, referrer: document.referrer || undefined }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setState("done");
      setMessage(json.message ?? null);
    } else {
      setState("error");
      setBad(json.fields ?? []);
      setMessage(res.status === 429 ? c.limited : res.status === 422 ? c.required : c.error);
    }
  }

  if (state === "done") {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 text-center" role="status">
        <CheckCircle2 className="size-10 text-success" />
        <p className="text-lg font-medium">{message ?? successMessage ?? c.sent}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-md space-y-4" noValidate>
      {companyName && <h1 className="text-xl font-semibold">{companyName}</h1>}
      {fields.map((f) => (
        <Field key={f.key} label={f.label} error={bad.includes(f.key) ? " " : undefined}>
          {(p) => (f.type === "textarea" ? <Textarea {...p} name={f.key} required={f.required} rows={4} maxLength={4000} /> : <Input {...p} name={f.key} type={f.type} required={f.required} maxLength={200} />)}
        </Field>
      ))}
      {/* Honeypot: hidden from people, tempting for bots. */}
      <div aria-hidden className="absolute -start-[9999px] h-0 overflow-hidden">
        <label>Website<input name="company_website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {state === "error" && message && <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{message}</p>}
      <Button type="submit" size="lg" className="w-full" loading={state === "sending"}>{c.send}</Button>
    </form>
  );
}
