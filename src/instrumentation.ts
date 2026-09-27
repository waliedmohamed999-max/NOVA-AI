/**
 * Runs once per server instance. When NOVA_INLINE_WORKER=true (default in
 * local development) the job worker runs inside the Next.js process so a
 * single `npm run dev` is enough. Production should run `npm run worker`
 * as a separate process instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") {
    // OAuth setup diagnostic: status only — no client secrets, tokens or URIs in the log.
    const { oauthSetupSummary } = await import("./server/integrations/registry");
    for (const p of oauthSetupSummary()) {
      const name = p.id === "linkedin" ? "LinkedIn" : p.id === "instagram" ? "Instagram" : "Meta";
      console.info(`[nova] ${name} redirect URI: ${p.problem ? "INVALID — see /admin/providers" : p.explicit ? "configured" : "derived from APP_URL"}${p.configured ? "" : " (app credentials missing or invalid)"}`);
    }
    const { metaCredentialProblem } = await import("./server/integrations/providers/meta");
    const problem = metaCredentialProblem();
    if (problem && problem !== "missing") console.warn(`[nova] Meta app credentials: INVALID (${problem}) — see /admin/providers`);
    const { instagramCredentialProblem } = await import("./server/integrations/providers/instagram");
    const ig = instagramCredentialProblem();
    if (ig && ig !== "missing") console.warn(`[nova] Instagram app credentials: INVALID (${ig}) — see /admin/providers`);
  }
  if (process.env.NOVA_INLINE_WORKER !== "true") return;
  const { startWorker } = await import("./server/jobs/runner");
  void startWorker({ concurrency: 2 });
}
