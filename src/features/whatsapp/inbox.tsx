"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { AlertTriangle, ArrowLeft, Check, CheckCheck, Clock, FileText, Loader2, Paperclip, Pencil, Search, Send, Sparkles, UserRound, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { toast } from "@/components/ui/toast";
import type { CustomerContext, InboxFilter, InboxItem, ThreadPage } from "@/server/whatsapp/inbox";
import { conversationAction, customerContextAction, listConversationsAction, prepareDraftAction, prepareFollowupAction, previewTemplateAction, rejectDraftAction, sendAttachmentAction, sendDraftAction, sendReplyAction, sendTemplateAction, setOptOutAction } from "./actions";
import { createOpportunityAction, moveStageAction, scheduleFollowUpAction } from "@/features/sales/desk-actions";

export type ApprovedTemplate = { id: string; name: string; language: string; body: string };
type Msg = ThreadPage["messages"][number];

export function WhatsAppInbox({ initial, initialSelected, templates, canSend }: { initial: { items: InboxItem[]; nextCursor: string | null }; initialSelected: string | null; templates: ApprovedTemplate[]; canSend: boolean }) {
  const t = useTranslations("whatsapp.inbox");
  const te = useTranslations("errors");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [q, setQ] = useState("");
  const [list, setList] = useState(initial);
  const [selected, setSelected] = useState<string | null>(initialSelected ?? null);
  const [thread, setThread] = useState<ThreadPage | null>(null);
  const [ctxPanel, setCtxPanel] = useState<CustomerContext | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "chat">(initialSelected ? "chat" : "list");
  const [contextOpen, setContextOpen] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);

  const refreshList = useCallback(async (f = filter, query = q) => {
    const r = await listConversationsAction({ filter: f, q: query || null });
    if (r.ok) setList(r.data);
  }, [filter, q]);

  const loadThread = useCallback(async (id: string, silent = false) => {
    if (!silent) setLoadingThread(true);
    const r = await conversationAction({ id });
    if (!silent) setLoadingThread(false);
    if (!r.ok) return toast(te(r.error as "unexpected"), "error");
    setThread(r.data);
    if (r.data.conversation.leadId) {
      const c = await customerContextAction({ leadId: r.data.conversation.leadId });
      if (c.ok) setCtxPanel(c.data);
    }
  }, [te]);

  useEffect(() => {
    if (selected) queueMicrotask(() => void loadThread(selected));
  }, [selected, loadThread]);

  // Light polling: new messages and delivery states (the webhook writes; we just re-read).
  useEffect(() => {
    const id = setInterval(() => {
      void refreshList();
      if (selected) void loadThread(selected, true);
    }, 12_000);
    return () => clearInterval(id);
  }, [selected, refreshList, loadThread]);

  const open = (id: string) => {
    setSelected(id);
    setMobileView("chat");
    setList((l) => ({ ...l, items: l.items.map((i) => (i.id === id ? { ...i, unread: 0 } : i)) }));
    window.history.replaceState(null, "", `/whatsapp/inbox?c=${id}`);
  };

  const more = async () => {
    if (!list.nextCursor) return;
    const r = await listConversationsAction({ filter, q: q || null, cursor: list.nextCursor });
    if (r.ok) setList({ items: [...list.items, ...r.data.items], nextCursor: r.data.nextCursor });
  };

  const current = list.items.find((i) => i.id === selected) ?? null;

  return (
    <div className="grid h-[calc(100dvh-230px)] min-h-[520px] max-lg:h-[calc(100dvh-340px)] max-lg:min-h-[440px] overflow-hidden rounded-[24px] border border-line bg-surface shadow-xs lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_300px]">
      {/* Conversation list */}
      <aside className={cn("flex min-h-0 flex-col border-line lg:border-e", mobileView === "chat" && "max-lg:hidden")} aria-label={t("select")}>
        <div className="space-y-2 border-b border-line p-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-4" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void refreshList(filter, q)}
              placeholder={t("search")}
              aria-label={t("search")}
              className="h-10 w-full rounded-xl border border-line bg-surface-2 ps-9 pe-3 text-sm outline-none focus:border-nova-blue"
            />
          </label>
          <div className="flex gap-1 overflow-x-auto [scrollbar-width:none]" role="tablist">
            {(["all", "unread", "needs_human", "drafts"] as const).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} onClick={() => { setFilter(f); void refreshList(f); }} className={cn("whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold", filter === f ? "bg-ink text-ink-inverse" : "text-ink-3 hover:bg-sunken")}>
                {t(`filters.${f}`)}
              </button>
            ))}
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto" data-testid="wa-conversations">
          {list.items.length === 0 && <li className="p-6 text-center text-sm text-ink-3">{t("empty")}</li>}
          {list.items.map((c) => (
            <li key={c.id}>
              <button onClick={() => open(c.id)} aria-current={selected === c.id ? "true" : undefined} className={cn("flex w-full items-start gap-3 border-b border-line/60 px-3 py-3 text-start transition", selected === c.id ? "bg-nova-blue-soft/60" : "hover:bg-surface-2")}>
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e7f8ee] text-sm font-bold text-[#178a45]">{c.name.slice(0, 1)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-ink">{c.name}</span>
                    <TimeAgo at={c.at} className="ms-auto shrink-0 text-[11px] text-ink-4" />
                  </span>
                  <span className="block truncate text-xs text-ink-4" dir="ltr">{c.phone}</span>
                  <span className="mt-0.5 block truncate text-xs text-ink-3" dir="auto">{c.last?.direction === "OUTBOUND" ? "↪ " : ""}{c.last?.body ?? "—"}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {c.needsHuman && <Chip tone="accent">{t("needsHuman")}</Chip>}
                    {c.hasDraft && <Chip tone="blue">{t("draft")}</Chip>}
                    {c.optedOut && <Chip tone="muted">{t("optedOut")}</Chip>}
                  </span>
                </span>
                {c.unread > 0 && <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#1fa855] text-[11px] font-bold text-white">{c.unread}</span>}
              </button>
            </li>
          ))}
          {list.nextCursor && (
            <li className="p-3">
              <button onClick={() => void more()} className="w-full rounded-xl border border-line py-2 text-sm font-medium text-ink-2 hover:bg-surface-2">{t("loadMore")}</button>
            </li>
          )}
        </ul>
      </aside>

      {/* Active conversation */}
      <section className={cn("flex min-h-0 flex-col", mobileView === "list" && "max-lg:hidden")} aria-label={current?.name ?? t("select")}>
        {!selected || !thread ? (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-ink-3">{loadingThread ? <Loader2 className="size-5 animate-spin" /> : t("select")}</div>
        ) : (
          <Thread
            key={selected}
            thread={thread}
            name={current?.name ?? ctxPanel?.name ?? "—"}
            phone={current?.phone ?? ctxPanel?.phone ?? null}
            templates={templates}
            canSend={canSend}
            onBack={() => setMobileView("list")}
            onContext={() => setContextOpen(true)}
            reload={() => { void loadThread(selected, true); void refreshList(); }}
            leadId={thread.conversation.leadId}
          />
        )}
      </section>

      {/* Customer context: side panel (xl) or drawer */}
      {ctxPanel && selected && (
        <>
          <aside className="hidden min-h-0 overflow-y-auto border-s border-line xl:block">
            <ContextPanel c={ctxPanel} canSend={canSend} onChanged={() => selected && void loadThread(selected, true)} />
          </aside>
          {contextOpen && (
            <div className="fixed inset-0 z-50 flex justify-end bg-overlay xl:hidden" role="dialog" aria-modal="true" aria-label={t("context")} onClick={() => setContextOpen(false)}>
              <div className="h-full w-full max-w-sm overflow-y-auto bg-surface shadow-lg" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between border-b border-line p-3">
                  <span className="text-sm font-bold">{t("context")}</span>
                  <button onClick={() => setContextOpen(false)} className="rounded-full p-2 hover:bg-sunken" aria-label={t("back")}>
                    <X className="size-4" />
                  </button>
                </div>
                <ContextPanel c={ctxPanel} canSend={canSend} onChanged={() => selected && void loadThread(selected, true)} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone: "accent" | "blue" | "muted" }) {
  return <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold", tone === "accent" ? "bg-accent-soft text-accent-ink" : tone === "blue" ? "bg-nova-blue-soft text-nova-blue" : "bg-sunken text-ink-3")}>{children}</span>;
}

function TimeAgo({ at, className }: { at: string; className?: string }) {
  const f = useFormatter();
  return <time dateTime={at} className={className}>{f.relativeTime(new Date(at))}</time>;
}

function Thread({ thread, name, phone, templates, canSend, onBack, onContext, reload, leadId }: { thread: ThreadPage; name: string; phone: string | null; templates: ApprovedTemplate[]; canSend: boolean; onBack: () => void; onContext: () => void; reload: () => void; leadId: string | null }) {
  const t = useTranslations("whatsapp.inbox");
  const te = useTranslations("errors");
  const f = useFormatter();
  const [messages, setMessages] = useState<Msg[]>(thread.messages);
  const [older, setOlder] = useState(thread.olderCursor);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [pickTemplate, setPickTemplate] = useState(false);
  const [pending, start] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const convId = thread.conversation.id;
  const windowOpen = thread.conversation.window.open;

  useEffect(() => {
    queueMicrotask(() => setMessages((prev) => {
      // Keep older pages the user already loaded; the newest page always comes fresh from the server.
      const ids = new Set(thread.messages.map((m) => m.id));
      const first = thread.messages[0]?.at;
      return [...prev.filter((m) => first && m.at < first && !ids.has(m.id)), ...thread.messages];
    }));
  }, [thread]);
  useEffect(() => {
    // Braces matter: newer browsers return a Promise from scrollIntoView, which must not be the effect cleanup.
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const draft = messages.filter((m) => m.status === "DRAFT" && m.aiDrafted).at(-1) ?? null;
  const shown = messages.filter((m) => m.status !== "DRAFT");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast(te((r.error ?? "unexpected") as "unexpected"), "error");
      after?.();
      reload();
    });

  const loadOlder = async () => {
    if (!older) return;
    const r = await conversationAction({ id: convId, before: older });
    if (r.ok) {
      setMessages((m) => [...r.data.messages, ...m]);
      setOlder(r.data.olderCursor);
    }
  };

  const upload = (file: File) =>
    start(async () => {
      const form = new FormData();
      form.set("file", file);
      form.set("purpose", "whatsapp_media");
      const res = await fetch("/api/uploads", { method: "POST", body: form });
      const json = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !json.id) return void toast(te((json.error ?? "unexpected") as "unexpected"), "error");
      const r = await sendAttachmentAction({ conversationId: convId, fileId: json.id, caption: text.trim() || undefined });
      if (!r.ok) return void toast(te((r.error ?? "unexpected") as "unexpected"), "error");
      setText("");
      reload();
    });

  return (
    <>
      <header className="flex items-center gap-3 border-b border-line px-3 py-2.5">
        <button onClick={onBack} className="rounded-full p-2 hover:bg-sunken lg:hidden" aria-label={t("back")}>
          <ArrowLeft className="size-4 ltr:rotate-180" />
        </button>
        <span className="flex size-9 items-center justify-center rounded-full bg-[#e7f8ee] text-sm font-bold text-[#178a45]">{name.slice(0, 1)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{name}</span>
          <span className="block text-xs text-ink-4" dir="ltr">{phone}</span>
        </span>
        {leadId && (
          <Link href={`/leads/${leadId}`} className="hidden rounded-full border border-line px-3 py-1.5 text-xs font-semibold hover:bg-surface-2 sm:inline-flex">{t("openProfile")}</Link>
        )}
        <button onClick={onContext} className="rounded-full p-2 hover:bg-sunken xl:hidden" aria-label={t("context")}>
          <UserRound className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#f5f1ea] px-3 py-4 dark:bg-sunken" data-testid="wa-thread">
        {older && (
          <div className="text-center">
            <button onClick={() => void loadOlder()} className="rounded-full bg-surface px-3 py-1 text-xs font-medium text-ink-3 shadow-xs">{t("older")}</button>
          </div>
        )}
        {shown.map((m) => (
          <Bubble key={m.id} m={m} time={f.dateTime(new Date(m.at), { hour: "numeric", minute: "2-digit" })} />
        ))}
        <div ref={bottom} />
      </div>

      {canSend && draft && (
        <div className="border-t border-nova-blue-line bg-nova-blue-soft/50 px-3 py-3" data-testid="wa-draft">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-nova-blue">
            <Sparkles className="size-3.5" /> {t("novaSuggests")}
          </p>
          {editing !== null ? (
            <textarea value={editing} onChange={(e) => setEditing(e.target.value)} rows={3} className="w-full rounded-xl border border-nova-blue-line bg-surface p-2.5 text-sm outline-none" dir="auto" aria-label={t("edit")} />
          ) : (
            <p className="whitespace-pre-wrap rounded-xl bg-surface p-2.5 text-sm text-ink" dir="auto">{draft.body}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button disabled={pending || !windowOpen} onClick={() => run(() => sendDraftAction({ messageId: draft.id, body: editing ?? undefined }), () => setEditing(null))} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#1fa855] px-3 text-sm font-semibold text-white disabled:opacity-50" data-testid="wa-send-draft">
              <Send className="size-3.5 flip-rtl" /> {t("send")}
            </button>
            <button onClick={() => setEditing(editing === null ? draft.body : null)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-semibold">
              <Pencil className="size-3.5" /> {t("edit")}
            </button>
            <button disabled={pending} onClick={() => run(() => rejectDraftAction({ messageId: draft.id }))} className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-ink-3 hover:bg-surface">
              <X className="size-3.5" /> {t("reject")}
            </button>
          </div>
        </div>
      )}

      {canSend && (
        <footer className="border-t border-line p-3">
          {windowOpen ? (
            <>
              <p className="mb-2 flex items-center gap-1.5 text-[11px] text-ink-4">
                <Clock className="size-3" /> {t("windowOpen", { time: f.dateTime(new Date(thread.conversation.window.closesAt!), { weekday: "short", hour: "numeric", minute: "2-digit" }) })}
              </p>
              <div className="flex items-end gap-2">
                <input ref={fileRef} type="file" className="sr-only" accept="image/png,image/jpeg,image/webp,application/pdf,audio/mpeg,audio/ogg,video/mp4" onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(file); e.target.value = ""; }} />
                <button onClick={() => fileRef.current?.click()} disabled={pending} className="rounded-xl p-2.5 text-ink-3 hover:bg-sunken" aria-label={t("attach")}>
                  <Paperclip className="size-5" />
                </button>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && text.trim()) {
                      e.preventDefault();
                      run(() => sendReplyAction({ conversationId: convId, body: text }), () => setText(""));
                    }
                  }}
                  rows={1}
                  placeholder={t("placeholder")}
                  aria-label={t("placeholder")}
                  dir="auto"
                  className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm outline-none focus:border-[#1fa855]"
                  data-testid="wa-composer"
                />
                <button disabled={pending || !text.trim()} onClick={() => run(() => sendReplyAction({ conversationId: convId, body: text }), () => setText(""))} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#1fa855] text-white disabled:opacity-40" aria-label={t("send")}>
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4 flip-rtl" />}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button disabled={pending} onClick={() => run(() => prepareDraftAction({ conversationId: convId }))} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-nova-blue-line px-3 text-xs font-semibold text-nova-blue hover:bg-nova-blue-soft" data-testid="wa-prepare">
                  <Sparkles className="size-3.5" /> {t("prepare")}
                </button>
                <button onClick={() => setPickTemplate((v) => !v)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-semibold hover:bg-surface-2">
                  <FileText className="size-3.5" /> {t("template")}
                </button>
                {leadId && (
                  <button disabled={pending} onClick={() => run(() => prepareFollowupAction({ leadId }), () => toast(t("followupAdded")))} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-semibold hover:bg-surface-2">
                    {t("addFollowup")}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div role="status" className="mb-2 flex items-start gap-2 rounded-2xl bg-warning-soft px-3 py-2.5 text-sm text-ink" data-testid="wa-window-closed">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              {t("windowClosed")}
            </div>
          )}
          {(pickTemplate || !windowOpen) && <TemplatePicker templates={templates} conversationId={convId} leadId={leadId} onSent={() => { setPickTemplate(false); reload(); }} />}
        </footer>
      )}
    </>
  );
}

function Bubble({ m, time }: { m: Msg; time: string }) {
  const t = useTranslations("whatsapp.inbox");
  const out = m.direction === "OUTBOUND";
  const failed = m.status === "FAILED" || m.delivery === "failed";
  return (
    <div className={cn("flex", out ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-xs", out ? "rounded-ee-md bg-[#d9fdd3] text-[#0b2e13] dark:bg-[#12402a] dark:text-[#e3ffe8]" : "rounded-es-md bg-surface text-ink")}>
        {(m.template || m.aiDrafted) && (
          <p className="mb-1 flex gap-1.5 text-[10px] font-bold uppercase tracking-wide opacity-70">
            {m.template && <span>{t("template")}: {m.template}</span>}
            {m.aiDrafted && <span>{t("aiAssisted")}</span>}
          </p>
        )}
        {m.media && (m.media.mime?.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.media.url} alt="" className="mb-1 max-h-60 rounded-xl object-cover" />
        ) : (
          <a href={m.media.url} target="_blank" rel="noopener noreferrer" className="mb-1 flex items-center gap-2 rounded-xl bg-black/5 px-2.5 py-2 text-xs font-medium underline-offset-2 hover:underline">
            <FileText className="size-4" /> {m.type}
          </a>
        ))}
        <p className="whitespace-pre-wrap break-words" dir="auto">{m.body}</p>
        <p className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-60">
          {time}
          {out && (failed ? <AlertTriangle className="size-3 text-danger" aria-label={t("delivery.failed")} /> : m.delivery === "read" ? <CheckCheck className="size-3.5 text-[#34b7f1]" aria-label={t("delivery.read")} /> : m.delivery === "delivered" ? <CheckCheck className="size-3.5" aria-label={t("delivery.delivered")} /> : <Check className="size-3.5" aria-label={t("delivery.sent")} />)}
        </p>
        {failed && m.failedReason && <p className="mt-0.5 text-[10px] text-danger">{m.failedReason}</p>}
      </div>
    </div>
  );
}

function TemplatePicker({ templates, conversationId, leadId, onSent }: { templates: ApprovedTemplate[]; conversationId: string; leadId: string | null; onSent: () => void }) {
  const t = useTranslations("whatsapp.inbox");
  const te = useTranslations("errors");
  const [id, setId] = useState(templates[0]?.id ?? "");
  const [preview, setPreview] = useState<{ text: string; missing: number[] } | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!id) return;
    let alive = true;
    void previewTemplateAction({ id, leadId }).then((r) => alive && r.ok && setPreview(r.data));
    return () => {
      alive = false;
    };
  }, [id, leadId]);
  if (!templates.length)
    return (
      <p className="text-sm text-ink-3">
        {t("noApproved")}{" "}
        <Link href="/whatsapp/templates" className="font-semibold text-nova-blue hover:underline">{t("manageTemplates")}</Link>
      </p>
    );
  return (
    <div className="space-y-2 rounded-2xl border border-line p-3" data-testid="wa-template-picker">
      <label className="block text-xs font-semibold text-ink-2">
        {t("chooseTemplate")}
        <select value={id} onChange={(e) => setId(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm">
          {templates.map((x) => (
            <option key={x.id} value={x.id}>{x.name} · {x.language}</option>
          ))}
        </select>
      </label>
      {preview && (
        <p className="whitespace-pre-wrap rounded-xl bg-[#d9fdd3] p-2.5 text-sm text-[#0b2e13]" dir="auto">
          {preview.text}
        </p>
      )}
      <button
        disabled={pending || !id || Boolean(preview?.missing.length)}
        onClick={() =>
          start(async () => {
            const r = await sendTemplateAction({ conversationId, templateId: id });
            if (!r.ok) return void toast(te((r.error ?? "unexpected") as "unexpected"), "error");
            toast(t("sent"));
            onSent();
          })
        }
        className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#1fa855] px-3 text-sm font-semibold text-white disabled:opacity-50"
        data-testid="wa-send-template"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5 flip-rtl" />} {t("sendTemplate")}
      </button>
      {preview?.missing.length ? <p className="text-xs text-danger">{te("whatsapp_template_missing_values")}</p> : null}
    </div>
  );
}

function ContextPanel({ c, canSend, onChanged }: { c: CustomerContext; canSend: boolean; onChanged: () => void }) {
  const t = useTranslations("whatsapp.context");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const f = useFormatter();
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast(te((r.error ?? "unexpected") as "unexpected"), "error");
      if (done) toast(done);
      onChanged();
    });
  const tomorrow = () => {
    const d = new Date(Date.now() + 86_400_000);
    d.setHours(10, 0, 0, 0);
    return d.toISOString();
  };
  return (
    <div className="space-y-4 p-4" data-testid="wa-context">
      <div>
        <p className="text-base font-bold">{c.name}</p>
        {c.company && <p className="text-sm text-ink-3">{c.company}</p>}
      </div>
      <dl className="divide-y divide-line/70">
        <CtxRow none={t("none")} label={t("stage")} value={tc(`cmd.stages.${c.stage}` as "cmd.stages.NEW")} />
        <CtxRow none={t("none")} label={t("interest")} value={c.interests.join("، ")} />
        <CtxRow none={t("none")} label={t("lastContact")} value={c.lastContactAt ? f.relativeTime(new Date(c.lastContactAt)) : null} />
        <CtxRow none={t("none")} label={t("opportunity")} value={c.opportunity ? `${c.opportunity.title}${c.opportunity.value != null ? ` · ${f.number(c.opportunity.value / 100, { style: "currency", currency: c.opportunity.currency })}` : ""}` : null} />
        <CtxRow none={t("none")} label={t("owner")} value={c.owner} />
        <CtxRow none={t("none")} label={t("tags")} value={c.tags.join("، ")} />
        <CtxRow none={t("none")} label={t("source")} value={c.source} />
        <CtxRow none={t("none")} label={t("meeting")} value={c.meeting?.at ? f.dateTime(new Date(c.meeting.at), { dateStyle: "medium", timeStyle: "short" }) : null} />
      </dl>
      {canSend && (
        <div className="grid gap-2">
          {!c.opportunity && (
            <button disabled={pending} onClick={() => act(() => createOpportunityAction({ leadId: c.id, title: `${c.name} — WhatsApp`, kind: "DEAL" }), t("actions.createOpportunity"))} className="h-9 rounded-xl border border-line text-sm font-semibold hover:bg-surface-2">
              {t("actions.createOpportunity")}
            </button>
          )}
          <button disabled={pending} onClick={() => act(() => scheduleFollowUpAction({ leadId: c.id, title: "WhatsApp follow-up", dueAt: tomorrow(), channel: "WHATSAPP" }), t("actions.scheduleFollowup"))} className="h-9 rounded-xl border border-line text-sm font-semibold hover:bg-surface-2">
            {t("actions.scheduleFollowup")}
          </button>
          <Link href={`/leads/${c.id}#meetings`} className="flex h-9 items-center justify-center rounded-xl border border-line text-sm font-semibold hover:bg-surface-2">{t("actions.bookMeeting")}</Link>
          <Link href={`/leads/${c.id}#quotes`} className="flex h-9 items-center justify-center rounded-xl border border-line text-sm font-semibold hover:bg-surface-2">{t("actions.createQuote")}</Link>
          {["NEW", "CONTACTED"].includes(c.stage) && (
            <button disabled={pending} onClick={() => act(() => moveStageAction({ id: c.id, stage: "QUALIFIED" }), t("actions.markQualified"))} className="h-9 rounded-xl border border-line text-sm font-semibold hover:bg-surface-2">
              {t("actions.markQualified")}
            </button>
          )}
          <button disabled={pending} onClick={() => act(() => setOptOutAction({ leadId: c.id, optOut: !c.optedOut }))} className="h-9 rounded-xl text-xs font-semibold text-ink-3 hover:bg-surface-2">
            {c.optedOut ? t("optIn") : t("optOut")}
          </button>
        </div>
      )}
    </div>
  );
}

function CtxRow({ label, value, none }: { label: string; value: React.ReactNode; none: string }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 truncate text-end font-medium text-ink">{value || none}</dd>
    </div>
  );
}
