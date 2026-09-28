"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import type { CommandResponse } from "@/server/command/types";
import { commandStatusAction, replyCommandAction, runCommandAction, understandCommandAction } from "./center-actions";

/** idle → understanding (intent/entities/permission) → executing (the real action) → done (result card). */
export type Phase = "idle" | "understanding" | "executing" | "done";

function newKey() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

const MUTATING = new Set(["completed", "partial", "needs_approval", "queued"]);

/**
 * The one client entry point to the Command Center (Home input, ⌘K dialog, voice, attachments).
 * One idempotency key per submission; a second submit while one is running is ignored.
 */
export function useCommandCenter(opts: { onNavigate?: () => void } = {}) {
  const router = useRouter();
  const locale = useLocale();
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<CommandResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastText, setLastText] = useState<string | null>(null);
  const busy = useRef(false);
  const onNavigate = useRef(opts.onNavigate);
  useEffect(() => {
    onNavigate.current = opts.onNavigate;
  });

  const apply = useCallback(
    (r: CommandResponse) => {
      setResult(r);
      setPhase("done");
      if (r.navigation && r.status === "completed") {
        router.push(r.navigation);
        onNavigate.current?.();
      } else if (r.type !== "navigation" && r.type !== "read" && MUTATING.has(r.status)) {
        router.refresh();
      }
    },
    [router],
  );

  const submit = useCallback(
    async (text: string, fileIds: string[] = []) => {
      const v = text.trim();
      if (v.length < 2 || busy.current) return false;
      busy.current = true;
      setError(null);
      setResult(null);
      setLastText(v);
      setPhase("understanding");
      try {
        const u = await understandCommandAction({ text: v, locale: locale === "ar" ? "ar" : "en", idempotencyKey: newKey(), fileIds });
        if (!u.ok) {
          setError(u.error);
          setPhase("done");
          return true;
        }
        if (u.data.status !== "understood") {
          apply(u.data);
          return true;
        }
        setPhase("executing");
        const r = await runCommandAction({ executionId: u.data.executionId });
        if (!r.ok) {
          setError(r.error);
          setPhase("done");
        } else apply(r.data);
        return true;
      } catch {
        setError("unexpected");
        setPhase("done");
        return true;
      } finally {
        busy.current = false;
      }
    },
    [apply, locale],
  );

  const reply = useCallback(
    async (answer: { choice?: number; confirm?: boolean; cancel?: boolean }) => {
      if (!result || busy.current) return;
      busy.current = true;
      setError(null);
      setPhase("executing");
      try {
        const r = await replyCommandAction({ executionId: result.executionId, ...answer });
        if (!r.ok) {
          setError(r.error);
          setPhase("done");
        } else apply(r.data);
      } catch {
        setError("unexpected");
        setPhase("done");
      } finally {
        busy.current = false;
      }
    },
    [apply, result],
  );

  // Live status for queued jobs: never "done" before the job is.
  const queuedId = result?.status === "queued" && result.runId ? result.executionId : null;
  useEffect(() => {
    if (!queuedId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const r = await commandStatusAction({ executionId: queuedId }).catch(() => null);
      if (!alive) return;
      if (r?.ok) {
        setResult(r.data);
        if (r.data.status !== "queued") {
          router.refresh();
          return;
        }
      }
      timer = setTimeout(tick, 1200);
    };
    timer = setTimeout(tick, 800);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [queuedId, router]);

  const reset = useCallback(() => {
    if (busy.current) return;
    setResult(null);
    setError(null);
    setPhase("idle");
  }, []);

  return { phase, result, error, lastText, pending: phase === "understanding" || phase === "executing", submit, reply, reset };
}
