// SPDX-License-Identifier: MIT
/**
 * x402 payment gate. Implements the flow described in the onboarding doc:
 *   1. Buyer requests a query without paying.
 *   2. Server replies 402 with the price and where to pay.
 *   3. Buyer's client pays (USDC via Meridian) and retries with proof of
 *      payment.
 *   4. Server verifies and runs the query.
 *
 * x402 tooling is early and thinner than something like ERC-20 tooling.
 * This module defines a `PaymentVerifier`-shaped interface so the actual
 * verification logic is swappable — ship with `MockPaymentVerifier` for
 * local dev/tests, and write a real Meridian-backed verifier (see
 * meridian.ts) before this ever sees production traffic. Don't mistake
 * the mock for something that's safe to deploy.
 *
 * Ported from a plain node:http-based gate (haze-backend/src/payments/x402.js)
 * to operate on the standard fetch Request/Response objects TanStack
 * Start's server routes use.
 */

export interface PaymentVerification {
  valid: boolean;
  /** present when valid; amount paid, in USDC */
  paidAmountUsdc?: number;
}

export interface PaymentVerifier {
  verify(paymentHeader: string, requiredUsdc: number): Promise<PaymentVerification>;
}

/**
 * Header the buyer sends proof of payment in. Real x402 implementations
 * vary on the exact header/encoding — confirm the current convention
 * against whatever Meridian's client library expects before wiring this
 * to production; don't assume this name is final.
 */
export const PAYMENT_HEADER = "x-payment";

export interface X402Config {
  priceUsdc: number;
  payToAddress: string;
  verifier: PaymentVerifier;
}

export type X402Gate = { paid: true } | { paid: false; response: Response };

/**
 * Runs the 402 gate for a single request. Callers are expected to check
 * `.paid` and, if false, return `.response` directly (already a fully
 * formed 402 Response) rather than writing another response.
 */
export async function enforceX402(request: Request, config: X402Config): Promise<X402Gate> {
  const paymentHeader = request.headers.get(PAYMENT_HEADER);

  if (!paymentHeader) {
    return { paid: false, response: send402(config) };
  }

  const verification = await config.verifier.verify(paymentHeader, config.priceUsdc);

  if (!verification.valid || (verification.paidAmountUsdc ?? 0) < config.priceUsdc) {
    return { paid: false, response: send402(config) };
  }

  return { paid: true };
}

function send402(config: X402Config): Response {
  return Response.json(
    {
      error: "payment_required",
      priceUsdc: config.priceUsdc,
      currency: "USDC",
      payTo: config.payToAddress,
      network: "robinhood_chain",
      header: PAYMENT_HEADER,
    },
    { status: 402 },
  );
}

/**
 * Dev/test-only verifier. Accepts headers of the form "mock:<amount>",
 * e.g. "mock:0.02". Never wire this into anything that touches real
 * money — it exists so the gate and the API around it are testable
 * without a live Meridian integration.
 */
export class MockPaymentVerifier implements PaymentVerifier {
  async verify(paymentHeader: string): Promise<PaymentVerification> {
    const match = /^mock:(\d+(\.\d+)?)$/.exec(paymentHeader);
    if (!match) return { valid: false };

    const paidAmountUsdc = Number(match[1]);
    return { valid: true, paidAmountUsdc };
  }
}
