/**
 * Returns `value` only if it is a same-origin path. Rejects protocol-relative ("//x"),
 * backslash tricks ("/\x" — browsers treat "\" as "/"), control characters and absolute URLs.
 */
export function safeInternalPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const base = "http://nova.invalid";
    const u = new URL(value, base);
    return u.origin === base ? `${u.pathname}${u.search}${u.hash}` : null;
  } catch {
    return null;
  }
}
