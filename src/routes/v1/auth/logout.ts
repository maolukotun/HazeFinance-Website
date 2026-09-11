// SPDX-License-Identifier: MIT
import { createFileRoute } from "@tanstack/react-router";
import { clearSessionCookie } from "@/server/auth/walletAuth";

/**
 * POST /v1/auth/logout
 *
 * Clears this browser's session cookie. Called by the dashboard's
 * "Disconnect wallet" action alongside its existing best-effort
 * wallet-side disconnect (see dashboard.0.classic.js's
 * disconnectCurrentWallet()). Note the same caveat walletAuth.ts's
 * module comment describes: this is a stateless session (no server-side
 * revocation list), so it can only forget the cookie in the browser that
 * calls it — a token that somehow leaked elsewhere stays valid until it
 * naturally expires.
 */
export const Route = createFileRoute("/v1/auth/logout")({
  server: {
    handlers: {
      POST: async () => {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": clearSessionCookie(),
          },
        });
      },
    },
  },
});
