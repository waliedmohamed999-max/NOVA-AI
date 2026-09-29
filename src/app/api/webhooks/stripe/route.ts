import { NextResponse, type NextRequest } from "next/server";
import { handleStripeEvent, verifyStripeSignature } from "@/server/billing/stripe";
import { logger } from "@/server/logger";
import { reportError } from "@/server/observability";
import { requestIdFrom } from "@/server/request-id";

/** Stripe webhook: signature-verified, processed once per event id; 500 makes Stripe retry. */
export async function POST(req: NextRequest) {
  const requestId = requestIdFrom(req.headers.get("x-request-id"));
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "x-request-id": requestId } });
  if ((Number(req.headers.get("content-length")) || 0) > 1_000_000) return reply({ error: "too large" }, 413);
  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"))) {
    logger.warn({ requestId }, "stripe webhook: invalid signature");
    return reply({ error: "invalid signature" }, 400);
  }
  let event: Parameters<typeof handleStripeEvent>[0];
  try {
    event = JSON.parse(raw);
  } catch {
    return reply({ error: "bad json" }, 400);
  }
  try {
    const outcome = await handleStripeEvent(event);
    logger.info({ requestId, eventId: event.id, type: event.type, outcome }, "stripe webhook processed");
    return reply({ received: true, outcome });
  } catch (err) {
    // 500 → Stripe retries; processing is idempotent by event id.
    reportError(err, "webhook", { provider: "stripe", eventId: event.id, type: event.type, requestId });
    return reply({ received: false }, 500);
  }
}
