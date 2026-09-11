// SPDX-License-Identifier: MIT
/**
 * The exact sign-in message text a wallet is asked to sign, and how long
 * a signed message stays acceptable to the server. Lives outside both
 * src/lib (client-only) and src/server (server-only) because it's
 * genuinely both: the client builds this exact string to show the wallet
 * for signing (src/lib/walletProviders.ts's signInWithWallet), and the
 * server rebuilds the SAME string from the address + issuedAt the client
 * sends back alongside the signature, to verify against (see
 * src/server/auth/walletAuth.ts's verifySignIn) — they have to agree
 * byte-for-byte, or every real signature would fail verification. One
 * shared source avoids that drifting apart.
 */

/**
 * How long after `issuedAt` a signed message is still accepted by the
 * server. This bounds how long a captured signature could be replayed —
 * it is NOT the session lifetime (how long you stay signed in once
 * verification succeeds); that's a separate, longer window controlled by
 * SESSION_TTL_MS in walletAuth.ts. Generous on purpose since this is a
 * one-time step at connect time, not something retried per request.
 */
export const SIGN_IN_MESSAGE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

export function buildSignInMessage(address: string, issuedAtIso: string): string {
  return [
    "Sign in to Haze Protocol",
    "",
    "This signature proves you control this wallet. It does not authorize any transaction, spend any funds, or cost any gas.",
    "",
    `Address: ${address.toLowerCase()}`,
    `Issued at: ${issuedAtIso}`,
  ].join("\n");
}
