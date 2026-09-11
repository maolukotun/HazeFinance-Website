// SPDX-License-Identifier: MIT
import { createFileRoute } from "@tanstack/react-router";
import { verifySignIn, createSessionCookie } from "@/server/auth/walletAuth";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * POST /v1/auth/verify
 * Body: { address: "0x...", issuedAt: "<ISO timestamp>", signature: "0x..." }
 *
 * Proves control of `address` via a personal_sign signature over the
 * standard sign-in message (src/shared/authMessage.ts) for that exact
 * address + issuedAt pair — see src/lib/walletProviders.ts's
 * signInWithWallet() for what produces this request. On success, sets an
 * httpOnly session cookie that every /v1/wallets/:address/* route checks
 * from here on (see src/server/auth/walletAuth.ts).
 *
 * Same-origin only, deliberately no CORS headers here — unlike /health
 * and /v1/profiles/query, this sets a cookie meant only for this
 * project's own dashboard, not for an external caller on another origin.
 */
export const Route = createFileRoute("/v1/auth/verify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: any;
        try {
          const text = await request.text();
          body = JSON.parse(text || "{}");
        } catch {
          return Response.json({ error: "invalid_request", message: "body must be valid JSON" }, { status: 400 });
        }

        const address = body?.address;
        const issuedAt = body?.issuedAt;
        const signature = body?.signature;

        if (typeof address !== "string" || !ADDRESS_RE.test(address)) {
          return Response.json(
            { error: "invalid_request", message: "address must be a 0x-prefixed 40-hex-character address" },
            { status: 400 },
          );
        }
        if (typeof issuedAt !== "string" || typeof signature !== "string") {
          return Response.json(
            { error: "invalid_request", message: "issuedAt and signature are required" },
            { status: 400 },
          );
        }

        const ok = await verifySignIn(address, issuedAt, signature);
        if (!ok) {
          return Response.json(
            { error: "invalid_signature", message: "signature did not verify for this address, or has expired" },
            { status: 401 },
          );
        }

        return new Response(JSON.stringify({ ok: true, address }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": createSessionCookie(address),
          },
        });
      },
    },
  },
});
