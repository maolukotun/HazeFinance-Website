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
        return withCors(
          Response.json({
            status: "ok",
            profileCount: store.size(),
            priceUsdc: QUERY_PRICE_USDC,
            walletOwnerSharePct: (WALLET_OWNER_BPS / BPS_DENOMINATOR) * 100,
          }),
        );
      },
      OPTIONS: async () => corsPreflightResponse(),
    },
  },
});
