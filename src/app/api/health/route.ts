import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness: the process is up. No dependencies are touched (use /api/ready for those). */
export function GET() {
  return NextResponse.json(
    { status: "ok", release: process.env.SENTRY_RELEASE || null, uptimeSeconds: Math.round(process.uptime()), time: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
