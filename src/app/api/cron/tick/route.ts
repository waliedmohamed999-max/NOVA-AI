import { NextResponse, type NextRequest } from "next/server";
import { drainOnce } from "@/server/jobs/runner";
import { safeEqual } from "@/server/crypto";

/**
 * For platforms without long-running processes: call this endpoint every
 * minute (e.g. Vercel Cron) with `Authorization: Bearer $CRON_SECRET`.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let processed = 0;
  const deadline = Date.now() + 50_000;
  while (Date.now() < deadline) {
    const n = await drainOnce(`cron-${Date.now()}`, 4);
    processed += n;
    if (n === 0) break;
  }
  return NextResponse.json({ processed });
}
