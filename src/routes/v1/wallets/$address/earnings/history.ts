// SPDX-License-Identifier: MIT
import { createFileRoute } from "@tanstack/react-router";
import { store, splitterSim } from "@/server/singletons";

function notFoundProfile(walletAddress: string) {
  return Response.json({ error: "no_profile", message: `no profile registered for ${walletAddress}` }, { status: 404 });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, all: Infinity };

/** GET /v1/wallets/:address/earnings/history?range=7d|30d|90d|all */
export const Route = createFileRoute("/v1/wallets/$address/earnings/history")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { address } = params;
        const profile = store.getOwnProfile(address);
        if (!profile) return notFoundProfile(address);

        const url = new URL(request.url);
        const range = url.searchParams.get("range") ?? "30d";
        const rangeMs = RANGE_DAYS[range];
        if (rangeMs === undefined) {
          return Response.json({ error: "invalid_request", message: "range must be 7d, 30d, 90d, or all" }, { status: 400 });
        }

        const now = Date.now();
        const cutoff = rangeMs === Infinity ? 0 : now - rangeMs * 24 * 60 * 60 * 1000;
        const syntheticSnapshot = store.getSyncSnapshot().filter((r) => r.synthetic);
        const totalWeight = syntheticSnapshot.reduce((s, r) => s + r.weight, 0) || 1;
        const myShare = profile.synthetic ? (profile.weight / totalWeight) * 0.8 : 0;

        let running = 0;
        const points = splitterSim
          .depositHistory()
          .filter((h) => h.timestamp >= cutoff)
          .map((h) => {
            running += h.amountUsdc * myShare;
            return { timestamp: h.timestamp, cumulativeUsdc: round2(running) };
          });

        return Response.json({ walletAddress: address, range, points });
      },
    },
  },
});
