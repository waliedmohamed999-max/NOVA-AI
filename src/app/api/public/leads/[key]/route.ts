import { NextResponse, type NextRequest } from "next/server";
import { captureLead, originAllowed } from "@/server/sales/capture";
import { db } from "@/server/db/client";
import { logger } from "@/server/logger";

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

async function corsHeaders(key: string, origin: string | null): Promise<Record<string, string>> {
  if (!origin) return {};
  const form = await db.leadCaptureForm.findUnique({ where: { publicKey: key }, select: { allowedOrigins: true } });
  if (!form || !originAllowed(origin, form.allowedOrigins, appUrl())) return {};
  return { "access-control-allow-origin": origin, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", vary: "origin" };
}

export async function OPTIONS(req: NextRequest, ctx: RouteContext<"/api/public/leads/[key]">) {
  const { key } = await ctx.params;
  return new NextResponse(null, { status: 204, headers: await corsHeaders(key, req.headers.get("origin")) });
}

/** Public, unauthenticated lead capture endpoint used by the embed and by customer websites. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/public/leads/[key]">) {
  const { key } = await ctx.params;
  const origin = req.headers.get("origin");
  const headers = await corsHeaders(key, origin);
  if ((Number(req.headers.get("content-length")) || 0) > 32_000) return NextResponse.json({ error: "validation" }, { status: 413, headers });
  let body: Record<string, unknown> = {};
  try {
    const type = req.headers.get("content-type") ?? "";
    body = type.includes("application/json") ? await req.json() : Object.fromEntries((await req.formData()).entries());
  } catch {
    return NextResponse.json({ error: "validation" }, { status: 400, headers });
  }
  try {
    const res = await captureLead(key, body, { ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, origin, appUrl: appUrl() });
    if (!res.ok) return NextResponse.json({ error: res.error, fields: res.fields }, { status: res.status, headers });
    return NextResponse.json({ ok: true, message: res.message }, { status: 201, headers });
  } catch (err) {
    logger.error({ err, key }, "lead capture failed");
    return NextResponse.json({ error: "unexpected" }, { status: 500, headers });
  }
}
