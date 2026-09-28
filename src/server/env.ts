/** "development" | "staging" | "production". APP_ENV wins; otherwise derived from NODE_ENV. */
export function appEnvironment(env: NodeJS.ProcessEnv = process.env): "development" | "staging" | "production" {
  const v = (env.APP_ENV ?? "").trim().replace(/^["']|["']$/g, "").toLowerCase();
  if (v === "staging" || v === "production" || v === "development") return v;
  return env.NODE_ENV === "production" ? "production" : "development";
}

/** Public HTTPS (not localhost / private dev hosts) — required for every provider callback outside development. */
export function isPublicHttps(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u.hostname) && !u.hostname.endsWith(".local");
  } catch {
    return false;
  }
}
