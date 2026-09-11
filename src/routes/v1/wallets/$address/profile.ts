// SPDX-License-Identifier: MIT
import { createFileRoute } from "@tanstack/react-router";
import { fingerprintBarPercentages, profileStrength } from "@/server/aggregation/scoring";
import { applyExclusions } from "@/server/aggregation/privacyLayer";
import { store } from "@/server/singletons";

function notFoundProfile(walletAddress: string) {
  return Response.json({ error: "no_profile", message: `no profile registered for ${walletAddress}` }, { status: 404 });
}

/**
 * GET /v1/wallets/:address/profile
 *
 * Shows the fingerprint WITH exclusions already applied — i.e. what the
 * market actually sees, matching the toggle states in the Data Controls
 * panel.
 *
 * Wallet-owner-facing routes (this one included) are NOT x402-gated (the
 * wallet owner isn't paying to see their own data) but they also aren't
 * authenticated: this scaffold trusts the `:address` URL segment as
 * given. Before this goes anywhere near production, add real auth (e.g.
 * a signed-message challenge proving control of the address) — see the
 * project README.
 */
export const Route = createFileRoute("/v1/wallets/$address/profile")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { address } = params;
        const profile = store.getOwnProfile(address);
        if (!profile) return notFoundProfile(address);

        const visibleFingerprint = applyExclusions(profile.fingerprint, profile.excludedCategories);

        return Response.json({
          walletAddress: address,
          profileStrength: profileStrength(profile.weight),
          fingerprint: visibleFingerprint,
          fingerprintBars: fingerprintBarPercentages(visibleFingerprint, { synthetic: profile.synthetic }),
          excludedCategories: profile.excludedCategories,
        });
      },
    },
  },
});
