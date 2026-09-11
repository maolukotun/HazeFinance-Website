// SPDX-License-Identifier: MIT
import { createFileRoute } from "@tanstack/react-router";
import { store, activityLog } from "@/server/singletons";

function notFoundProfile(walletAddress: string) {
  return Response.json({ error: "no_profile", message: `no profile registered for ${walletAddress}` }, { status: 404 });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** GET /v1/wallets/:address/activity */
export const Route = createFileRoute("/v1/wallets/$address/activity")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { address } = params;
        const profile = store.getOwnProfile(address);
        if (!profile) return notFoundProfile(address);

        const events = activityLog.forWallet(address);

        const counts: Record<string, number> = { trading_agent: 0, research_agent: 0, analytics_firm: 0, other: 0 };
        for (const e of events) counts[e.buyerType] = (counts[e.buyerType] ?? 0) + 1;
        const total = events.length || 1;

        // Same current-weight approximation the earnings routes use for
        // "today"/"this month" — see earnings.ts's comment.
        const syntheticSnapshot = store.getSyncSnapshot().filter((r) => r.synthetic);
        const totalWeight = syntheticSnapshot.reduce((s, r) => s + r.weight, 0) || 1;
        const myShare = profile.synthetic ? (profile.weight / totalWeight) * 0.8 : 0;

        return Response.json({
          walletAddress: address,
          recent: events.slice(0, 20).map((e) => ({
            timestamp: e.timestamp,
            buyerType: e.buyerType,
            priceUsdc: e.priceUsdc,
            myShareUsdc: Math.round(e.priceUsdc * myShare * 100) / 100,
          })),
          breakdown: {
            tradingAgentsPct: round1((counts["trading_agent"]! / total) * 100),
            researchAgentsPct: round1((counts["research_agent"]! / total) * 100),
            analyticsFirmsPct: round1((counts["analytics_firm"]! / total) * 100),
            otherPct: round1((counts["other"]! / total) * 100),
          },
        });
      },
    },
  },
});
