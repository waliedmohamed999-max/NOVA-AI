import { NextResponse, type NextRequest } from "next/server";
import { readiness } from "@/server/health";
import { safeEqual } from "@/server/crypto";

export const dynamic = "force-dynamic";

/**
 * Readiness: 200 when this instance can serve traffic (status ok/degraded), 503 when a critical dependency
 * fails. Details (which variable, which check) only with `Authorization: Bearer $CRON_SECRET` (or
 * READY_TOKEN); the public answer carries statuses only.
 */
export async function GET(req: NextRequest) {
  const r = await readiness();
  const token = process.env.READY_TOKEN || process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const detailed = Boolean(token && safeEqual(auth, `Bearer ${token}`));
  const body = detailed ? r : { status: r.status, checks: Object.fromEntries(Object.entries(r.checks).map(([k, c]) => [k, { status: c.status }])) };
  return NextResponse.json(body, { status: r.status === "fail" ? 503 : 200, headers: { "cache-control": "no-store" } });
}
