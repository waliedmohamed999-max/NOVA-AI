/**
 * Runs once per server instance. When NOVA_INLINE_WORKER=true (default in
 * local development) the job worker runs inside the Next.js process so a
 * single `npm run dev` is enough. Production should run `npm run worker`
 * as a separate process instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NOVA_INLINE_WORKER !== "true") return;
  const { startWorker } = await import("./server/jobs/runner");
  void startWorker({ concurrency: 2 });
}
