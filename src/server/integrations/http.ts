import { ProviderError, type ProviderErrorKind } from "./types";

/**
 * JSON HTTP helper for provider APIs: timeouts, error normalization, and no
 * token leakage into error messages or logs.
 */
export async function providerFetch<T>(
  url: string,
  init: RequestInit & { classify?: (status: number, body: unknown) => ProviderErrorKind | null } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(20_000) });
  } catch (err) {
    throw new ProviderError("unavailable", "Network error contacting provider", undefined, String(err));
  }
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    const kind =
      init.classify?.(res.status, body) ??
      (res.status === 401 ? "expired" : res.status === 403 ? "permission" : res.status === 429 ? "rate_limited" : res.status >= 500 ? "unavailable" : "unknown");
    throw new ProviderError(kind, `Provider request failed (${res.status})`, res.status, redact(body));
  }
  return body as T;
}

function redact(body: unknown) {
  const s = JSON.stringify(body ?? "").replace(/"(access_token|refresh_token|token)":"[^"]+"/g, '"$1":"[redacted]"');
  return s.slice(0, 1000);
}

export function form(data: Record<string, string>) {
  return { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(data) };
}
