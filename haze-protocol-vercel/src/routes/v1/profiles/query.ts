// SPDX-License-Identifier: MIT
import { createFileRoute } from "@tanstack/react-router";
import { enforceX402 } from "@/server/payments/x402";
import { store, splitterSim, activityLog, paymentVerifier, QUERY_PRICE_USDC, PAY_TO_ADDRESS } from "@/server/singletons";
import { withCors, corsPreflightResponse } from "@/server/cors";
import type { QueryFilters } from "@/server/types";

const ALLOWED_FILTER_KEYS = [
  "traderType",
  "assetAllocationStyle",
  "riskProfile",
  "requireCrossAssetActivity",
  "minAvgDailyVolumeUsd",
];

function isValidFilters(body: unknown): body is QueryFilters {
  if (typeof body !== "object" || body === null) return false;
  return Object.keys(body).every((k) => ALLOWED_FILTER_KEYS.includes(k));
}

/**
 * POST /v1/profiles/query
 *
 * x402-gated per the brief: "No API key, no subscription, no account
 * creation required for the buyer. Pure x402 pay-per-query." Body is a
 * QueryFilters JSON object; response is either a cohort of anonymized
 * profiles or a 422 refusal if the cohort is below the k-anonymity floor.
 *
 * A successful paid query also deposits its price into the shared
 * SplitterSimulator and records an ActivityLog entry, so the dashboard's
 * earnings/activity panels have something real to show — see
 * src/server/singletons.ts for the important caveat that this bookkeeping
 * (like everything else here) is in-memory only.
 */
export const Route = createFileRoute("/v1/profiles/query")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const gate = await enforceX402(request, {
          priceUsdc: QUERY_PRICE_USDC,
          payToAddress: PAY_TO_ADDRESS,
          verifier: paymentVerifier,
        });
        if (!gate.paid) return withCors(gate.response);

        let filters: QueryFilters;
        try {
          const text = await request.text();
          const parsed = text.length > 0 ? JSON.parse(text) : {};
          if (!isValidFilters(parsed)) throw new Error("invalid filter keys");
          filters = parsed;
        } catch {
          return withCors(
            Response.json(
              { error: "invalid_request", message: "body must be a valid QueryFilters JSON object" },
              { status: 400 },
            ),
          );
        }

        const result = store.queryCohort(filters);

        if (!result.ok) {
          // Deliberately does not reveal how many profiles DID match — only
          // that it was below the floor. Revealing the near-miss count is a
          // classic way to erode k-anonymity through repeated querying.
          return withCors(
            Response.json(
              {
                error: "cohort_too_small",
                message: `fewer than the required minimum of ${result.minimumRequired} profiles match this query`,
              },
              { status: 422 },
            ),
          );
        }

        // Bookkeeping: record revenue + activity against the wallets that
        // matched. Uses the privileged getMatchingWallets() accessor — this
        // never touches the response body, which still only ever contains
        // result.profiles (anonymized).
        const matchingWallets = store.getMatchingWallets(filters);
        splitterSim.deposit(QUERY_PRICE_USDC);
        activityLog.record(matchingWallets, QUERY_PRICE_USDC, filters);

        return withCors(Response.json({ profiles: result.profiles }));
      },
      OPTIONS: async () => corsPreflightResponse(),
    },
  },
});
