import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Which Command Center execution the current async flow belongs to. Every AI call logged while a
 * command runs is tagged with it (ai_runs.commandExecutionId), so tokens/cost per command are exact —
 * including calls made deep inside existing services (studio, router).
 */
const store = new AsyncLocalStorage<{ commandExecutionId: string }>();

export function withCommandAttribution<T>(commandExecutionId: string, fn: () => Promise<T>): Promise<T> {
  return store.run({ commandExecutionId }, fn);
}

export function currentCommandExecutionId(): string | null {
  return store.getStore()?.commandExecutionId ?? null;
}
