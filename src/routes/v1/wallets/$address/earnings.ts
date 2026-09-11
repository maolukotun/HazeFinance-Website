// SPDX-License-Identifier: MIT
import { createFileRoute } from "@tanstack/react-router";
import { store, splitterSim } from "@/server/singletons";

function notFoundProfile(walletAddress: string) {
  return Response.json({ error: "no_profile", message: `no profile registered for ${walletAddress}` }, { status: 404 });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** GET /v1/wallets/:address/earnings */
export const Route = createFileRoute("/v1/wallets/$address/earnings")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { address } = params;
        const profile = await store.getOwnProfile(address);
        if (!profile) return notFoundProfile(address);

        const withdrawable = await splitterSim.claimable(address);
        const totalClaimed = await splitterSim.totalClaimed(address);
        const totalEarned = withdrawable + totalClaimed;

        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        const history = await splitterSim.depositHistory();
        // A real (non-synthetic) wallet never earns a share of the dev-only
        // simulated deposits below — see splitterSimulator.ts's doc comment.
        const syntheticSnapshot = (await store.getSyncSnapshot()).filter((r) => r.synthetic);
        const totalWeight = syntheticSnapshot.reduce((s, r) => s + r.weight, 0) || 1;
        const myShare = profile.synthetic ? (profile.weight / totalWeight) * 0.8 : 0; // 80% pool, pro-rated

        const sumSince = (msAgo: number) =>
          history.filter((h) => now - h.timestamp <= msAgo).reduce((s, h) => s + h.amountUsdc * myShare, 0);

        return Response.json({
          walletAddress: address,
          totalEarnedUsdc: round2(totalEarned),
          todayEarnedUsdc: round2(sumSince(dayMs)),
          monthEarnedUsdc: round2(sumSince(30 * dayMs)),
          withdrawableUsdc: round2(withdrawable),
        });
      },
    },
  },
});
