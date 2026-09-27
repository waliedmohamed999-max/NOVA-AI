/**
 * Content-Security-Policy for HTML responses. Built per request in proxy.ts with a fresh nonce;
 * Next.js reads the nonce from the request's CSP header and stamps it on its own scripts.
 *
 * - script-src: nonce + 'strict-dynamic' — no inline or third-party script runs without the nonce.
 * - style-src: 'unsafe-inline' is kept because React/motion write inline `style` attributes
 *   (a nonce cannot cover attributes). Styles cannot execute script.
 * - img-src: https: so social avatars/thumbnails from platform CDNs render; images cannot run code.
 * - connect-src: same origin only (server actions, AI streaming, polling).
 * - frame-ancestors: 'self' for the app; '*' only for the embeddable lead form.
 * - OAuth works because sign-in/connect are top-level navigations, which CSP does not restrict.
 */
export function buildCsp(nonce: string, opts: { dev?: boolean; embed?: boolean; https?: boolean; extraImgSrc?: string[] } = {}) {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(opts.dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:", ...(opts.extraImgSrc ?? [])],
    "font-src": ["'self'", "data:"],
    "media-src": ["'self'", "blob:", "https:"],
    "connect-src": ["'self'", ...(opts.dev ? ["ws:", "wss:"] : [])],
    "frame-src": ["'self'"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": [opts.embed ? "*" : "'self'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${[...new Set(v)].join(" ")}`);
  if (opts.https) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

export function makeNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** Presigned S3 redirects load images from the bucket origin (not needed when files stream through the app). */
export function storageImgOrigin(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.STORAGE_DRIVER !== "s3" || env.S3_SIGNED_REDIRECT !== "true") return [];
  try {
    if (env.S3_ENDPOINT) return [new URL(env.S3_ENDPOINT).origin];
  } catch {
    return [];
  }
  return [`https://${env.S3_BUCKET}.s3.${env.S3_REGION || "us-east-1"}.amazonaws.com`];
}
