import type { IntentKey, IntentKind, RoutingMode } from "./registry";
import type { Entities } from "./parse";

/** A translatable message: the client renders `common.cmd.msg.<key>` with `values`. */
export type Msg = { key: string; values?: Record<string, string | number> };

export type CommandStatus =
  | "understood"
  | "processing"
  | "completed"
  | "partial"
  | "queued"
  | "failed"
  | "denied"
  | "needs_choice"
  | "needs_confirmation"
  | "needs_approval"
  | "needs_input"
  | "ai_unavailable"
  | "cancelled";

export type ResultItem = { title: string; subtitle?: string | null; href?: string | null; badge?: string | null };
/** `label` = `common.cmd.actions.<label>`; `command` = `common.cmd.commands.<command>` (runs that command). */
export type ResultAction = { label: string; href?: string; command?: string; primary?: boolean };

/** What the Command Center returns — the UI never talks to individual services. */
export type CommandResponse = {
  executionId: string;
  intent: IntentKey | null;
  type: IntentKind | "unknown";
  status: CommandStatus;
  message: Msg;
  /** Human reason for a failure / unavailable state: an `errors.<code>` key. */
  reason?: string | null;
  /** Free text that is data (a brief, an answer, a suggested caption) — never a status message. */
  text?: string | null;
  items?: ResultItem[];
  stats?: { key: string; value: string | number }[];
  /** "This will: …" lines for large or risky commands. */
  preview?: Msg[];
  /** Quiet informational lines (e.g. a policy reminder) — no "this will" heading. */
  notes?: Msg[];
  choices?: { index: number; title: string; subtitle?: string | null }[];
  confirmLabel?: string | null;
  actions?: ResultAction[];
  navigation?: string | null;
  runId?: string | null;
  progress?: { done: number; total: number } | null;
  aiUsed: boolean;
  /** How it was answered: local / brain / ai / brain_ai (shown as a small, quiet label). */
  mode?: RoutingMode | null;
  /** Number of Company Brain sources the answer relied on. */
  sources?: number | null;
};

export type Params = Omit<Entities, "date"> & {
  date: Entities["date"];
  leadId?: string;
  fileIds?: string[];
  /** Raw command text (redacted) for workflows that take the request as input. */
  input?: string;
};

/** Server-side state for a pending choice/confirmation. The client only ever sends an index or "confirm". */
export type Plan = {
  step: "choice" | "confirm";
  params: Params;
  candidates?: string[];
  data?: Record<string, unknown>;
};

export type Receipt = { action: string; entity: string; entityId: string; status: string; at: string };
