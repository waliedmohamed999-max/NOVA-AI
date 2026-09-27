import { NextResponse, type NextRequest } from "next/server";
import { handleStripeEvent, verifyStripeSignature } from "@/server/billing/stripe";
import { logger } from "@/server/logger";

/** Stripe webhook: signature-verified, processed once per event id; 500 makes Stripe retry. */
export async function POST(req: NextRequest) {
  if ((Number(req.headers.get("content-length")) || 0) > 1_000_000) return new NextResponse("too large", { status: 413 });
  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"))) {
    logger.warn("stripe webhook: invalid signature");
    return new NextResponse("invalid signature", { status: 400 });
  }
  let event: Parameters<typeof handleStripeEvent>[0];
  try {
    event = JSON.parse(raw);
  } catch {
    return new NextResponse("bad json", { status: 400 });
  }
  try {
    const outcome = await handleStripeEvent(event);
    return NextResponse.json({ received: true, outcome });
  } catch {
    return NextResponse.json({ received: false }, { status: 500 });
  }
}
