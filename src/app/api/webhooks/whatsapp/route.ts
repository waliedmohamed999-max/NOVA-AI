import { NextResponse, type NextRequest } from "next/server";
import { verifySignature, verifyWebhookChallenge } from "@/server/whatsapp/cloud-api";
import { processWebhook } from "@/server/whatsapp/service";
import { logger } from "@/server/logger";
import { reportError } from "@/server/observability";
import { requestIdFrom } from "@/server/request-id";

/** Meta webhook subscription check: echo hub.challenge only when hub.verify_token matches WHATSAPP_VERIFY_TOKEN. */
export async function GET(req: NextRequest) {
  const challenge = verifyWebhookChallenge(req.nextUrl.searchParams);
  if (challenge == null) return new NextResponse("forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

/** Inbound messages + delivery statuses. Rejects anything without a valid X-Hub-Signature-256. */
export async function POST(req: NextRequest) {
  const requestId = requestIdFrom(req.headers.get("x-request-id"));
  if ((Number(req.headers.get("content-length")) || 0) > 1_000_000) return new NextResponse("too large", { status: 413 });
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    logger.warn({ requestId }, "whatsapp webhook: invalid signature");
    return new NextResponse("invalid signature", { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("bad json", { status: 400 });
  }
  try {
    const r = await processWebhook(body);
    logger.info({ requestId, ...r }, "whatsapp webhook processed");
    return NextResponse.json({ ok: true, ...r }, { headers: { "x-request-id": requestId } });
  } catch (err) {
    // 500 → Meta retries; processing is idempotent by message id.
    reportError(err, "webhook", { provider: "whatsapp", requestId });
    return NextResponse.json({ ok: false }, { status: 500, headers: { "x-request-id": requestId } });
  }
}
