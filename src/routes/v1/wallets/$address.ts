// SPDX-License-Identifier: MIT
import { createFileRoute } from "@tanstack/react-router";
import { store } from "@/server/singletons";

/**
 * DELETE /v1/wallets/:address
 *
 * Removes a wallet's profile and fingerprint from the store entirely —
 * this is the "delete my profile and all associated data" flow described
 * in the product brief, wired up to HTTP.
 *
 * Not authenticated, same caveat as every other wallet route here — see
 * the project README's "Security" section.
 */
export const Route = createFileRoute("/v1/wallets/$address")({
  server: {
    handlers: {
      DELETE: async ({ params }) => {
        const { address } = params;
        try {
          await store.deleteProfile(address);
        } catch {
          return Response.json({ error: "no_profile", message: `no profile registered for ${address}` }, { status: 404 });
        }
        return Response.json({ deleted: true, walletAddress: address });
      },
    },
  },
});
