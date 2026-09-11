// SPDX-License-Identifier: MIT
import { createFileRoute } from "@tanstack/react-router";
import { store, splitterSim } from "@/server/singletons";

function notFoundProfile(walletAddress: string) {
  return Response.json({ error: "no_profile", message: `no profile registered for ${walletAddress}` }, { status: 404 });
}

/**
 * POST /v1/wallets/:address/withdraw
 *
 * DEV SIMULATION ONLY. A real withdrawal is the wallet owner calling
 * HazeSplitter.claim() themselves, signed by their own wallet — a
 * client-side transaction (needs a wallet library like viem/wagmi wired
 * into the frontend for the actual claim call; this project's
 * src/lib/walletProviders.ts only ever reads an address today, it never
 * signs a transaction). This endpoint just moves the simulated claimable
 * balance to "claimed" so the dashboard has something to show when the
 * button is clicked locally/in a demo.
 */
export const Route = createFileRoute("/v1/wallets/$address/withdraw")({
  server: {
    handlers: {
      POST: async ({ params }) => {
        const { address } = params;
        const profile = await store.getOwnProfile(address);
        if (!profile) return notFoundProfile(address);

        const amount = await splitterSim.claim(address);
        return Response.json({
          walletAddress: address,
          withdrawnUsdc: Math.round(amount * 100) / 100,
          simulated: true,
          note: "Dev simulation only — see the doc comment on this route.",
        });
      },
    },
  },
});
