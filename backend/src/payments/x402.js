// SPDX-License-Identifier: MIT

/**
 * x402 payment gate. Implements the flow described in the onboarding doc:
 *   1. Buyer requests a query without paying.
 *   2. Server replies 402 with the price and where to pay.
 *   3. Buyer's client pays (USDC via Meridian) and retries with proof of
 *      payment.
 *   4. Server verifies and runs the query.
 *
 * The onboarding doc's own honest caveat applies here: x402 tooling is
 * early and thinner than something like ERC-20 tooling. This module
 * defines a `PaymentVerifier`-shaped interface (any object with an async
 * `verify(paymentHeader, requiredUsdc)` method) so the actual verification
 * logic is swappable — ship with `MockPaymentVerifier` for local dev and
 * tests, and write a real Meridian-backed verifier (see meridian.js)
 * before this ever sees production traffic. Don't mistake the mock for
 * something that's safe to deploy.
 *
 * @typedef {Object} PaymentVerification
 * @property {boolean} valid
 * @property {number} [paidAmountUsdc] - present when valid; amount paid, in USDC
 *
 * @typedef {Object} PaymentVerifier
 * @property {(paymentHeader: string, requiredUsdc: number) => Promise<PaymentVerification>} verify
 */

/**
 * Header the buyer sends proof of payment in. Real x402 implementations
 * vary on the exact header/encoding — confirm the current convention
 * against whatever Meridian's client library expects before wiring this
 * to production; don't assume this name is final.
 */
export const PAYMENT_HEADER = "x-payment";

/**
 * @typedef {Object} X402Config
 * @property {number} priceUsdc
 * @property {string} payToAddress
 * @property {PaymentVerifier} verifier
 */

/**
 * Runs the 402 gate for a single request. Callers are expected to check
 * `.paid` and, if false, that this function has already written the 402
 * response — do not write another response in that case.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {X402Config} config
 * @returns {Promise<{paid: boolean}>}
 */
export async function enforceX402(req, res, config) {
  const paymentHeader = req.headers[PAYMENT_HEADER];

  if (!paymentHeader || Array.isArray(paymentHeader)) {
    send402(res, config);
    return { paid: false };
  }

  const verification = await config.verifier.verify(paymentHeader, config.priceUsdc);

  if (!verification.valid || (verification.paidAmountUsdc ?? 0) < config.priceUsdc) {
    send402(res, config);
    return { paid: false };
  }

  return { paid: true };
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {X402Config} config
 */
function send402(res, config) {
  res.writeHead(402, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      error: "payment_required",
      priceUsdc: config.priceUsdc,
      currency: "USDC",
      payTo: config.payToAddress,
      network: "robinhood_chain",
      header: PAYMENT_HEADER,
    }),
  );
}

/**
 * Dev/test-only verifier. Accepts headers of the form "mock:<amount>",
 * e.g. "mock:0.02". Never wire this into anything that touches real
 * money — it exists so the gate and the API around it are testable
 * without a live Meridian integration.
 *
 * @implements {PaymentVerifier}
 */
export class MockPaymentVerifier {
  /**
   * @param {string} paymentHeader
   * @returns {Promise<PaymentVerification>}
   */
  async verify(paymentHeader) {
    const match = /^mock:(\d+(\.\d+)?)$/.exec(paymentHeader);
    if (!match) return { valid: false };

    const paidAmountUsdc = Number(match[1]);
    return { valid: true, paidAmountUsdc };
  }
}
