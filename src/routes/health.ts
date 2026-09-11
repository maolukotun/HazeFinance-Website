// SPDX-License-Identifier: MIT
import { createFileRoute } from "@tanstack/react-router";
import { store, QUERY_PRICE_USDC } from "@/server/singletons";
import { WALLET_OWNER_BPS, BPS_DENOMINATOR } from "@/server/earnings/splitterSimulator";
import { withCors, corsPreflightResponse } from "@/server/cors";

/**
 * GET /health
 *
 * Exposes live protocol constants (query price, wallet-owner revenue
 * share) so the dashboard's "Protocol stats" card and any external buyer
 * tooling can read the real, currently-configured values instead of a
 * hardcoded number that silently goes stale.
 */
export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: async () => {
        // TEMPORARY diagnostic try/catch — every /v1/wallets/** and /health
        // call started 500ing in production after the Postgres persistence
        // change landed, and the generic error page (src/lib/error-page.ts)
        // swallows the real error before it ever reaches Vercel's response,
        // so there's no way to see what's actually failing without this.
        // Remove this try/catch (restore the plain version below) once the
        // real cause is found and fixed — don't leave error details exposed
        // on a public, CORS-open route longer than needed for debugging.
        try {
          return withCors(
            Response.json({
              status: "ok",
              profileCount: await store.size(),
              priceUsdc: QUERY_PRICE_USDC,
              walletOwnerSharePct: (WALLET_OWNER_BPS / BPS_DENOMINATOR) * 100,
            }),
          );
        } catch (err) {
          return withCors(
            Response.json(
              {
                status: "error",
                debugMessage: err instanceof Error ? err.message : String(err),
                debugName: err instanceof Error ? err.name : undefined,
                debugStack: err instanceof Error ? err.stack : undefined,
              },
              { status: 200 },
            ),
          );
        }
      },
      OPTIONS: async () => corsPreflightResponse(),
    },
  },
});
