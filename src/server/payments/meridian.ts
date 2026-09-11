// SPDX-License-Identifier: MIT
import type { PaymentVerification, PaymentVerifier } from "./x402";

/**
 * Real Meridian-backed payment verifier. NOT IMPLEMENTED.
 *
 * This is the actual integration point you need before x402 payments can
 * settle for real on Robinhood Chain. It's stubbed out on purpose rather
 * than guessed at, because Meridian's client library and the exact
 * payment-proof format it expects aren't things to invent — get the
 * current SDK/API details before filling this in, the same way you'd get
 * current RPC and faucet details rather than assuming they haven't
 * changed.
 *
 * Once you have the real details, this class should:
 *   1. Decode the payment proof from the `x-payment` header (format TBD
 *      by Meridian's SDK).
 *   2. Verify the payment actually settled on-chain for at least
 *      `requiredUsdc`, to the protocol's receiving address.
 *   3. Return { valid: true, paidAmountUsdc } only once settlement is
 *      confirmed — do not return valid:true on an unconfirmed/pending
 *      payment, since that's a direct revenue-leak vector (query served,
 *      payment never lands).
 */
export class MeridianPaymentVerifier implements PaymentVerifier {
  async verify(_paymentHeader: string, _requiredUsdc: number): Promise<PaymentVerification> {
    throw new Error(
      "MeridianPaymentVerifier is not implemented. Wire up real Meridian " +
        "settlement verification before using this outside of local dev " +
        "(use MockPaymentVerifier from x402.ts for that).",
    );
  }
}
