"use client";

import { useEffect, useState } from "react";

/**
 * Tiny global store so any component (home quick actions, empty states,
 * buttons) can open the command bar — optionally pre-filled or auto-submitted.
 */
type State = { open: boolean; text: string; autoSubmit: boolean; nonce: number };
let state: State = { open: false, text: "", autoSubmit: false, nonce: 0 };
const listeners = new Set<(s: State) => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next, nonce: state.nonce + 1 };
  listeners.forEach((l) => l(state));
}

export function openCommand(text = "", opts: { autoSubmit?: boolean } = {}) {
  set({ open: true, text, autoSubmit: Boolean(opts.autoSubmit) });
}

export function closeCommand() {
  set({ open: false, autoSubmit: false });
}

export function useCommandState() {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}
