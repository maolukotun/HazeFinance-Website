// SPDX-License-Identifier: MIT
import { createFileRoute } from "@tanstack/react-router";
import { store } from "@/server/singletons";
import { requireWalletSession } from "@/server/auth/walletAuth";

/**
 * DELETE /v1/wallets/:address
 *
 * Removes a wallet's profile and fingerprint from the store entirely —
 * this is the "delete my profile and all associated data" flow described
 * in the product brief, wired up to HTTP.
 *
 * Authenticated — see src/server/auth/walletAuth.ts. This is arguably the
 * single most important route to have gotten this right on: before auth,
 * anyone who knew a wallet address could delete that wallet's profile.
 */
export const Route = createFileRoute("/v1/wallets/$address")({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        const { address } = params;
        const authError = requireWalletSession(request, address);
        if (authError) return authError;

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
