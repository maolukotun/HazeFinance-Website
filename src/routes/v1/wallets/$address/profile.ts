// SPDX-License-Identifier: MIT
import { createFileRoute } from "@tanstack/react-router";
import { fingerprintBarPercentages, profileStrength } from "@/server/aggregation/scoring";
import { applyExclusions } from "@/server/aggregation/privacyLayer";
import { store } from "@/server/singletons";
import { requireWalletSession } from "@/server/auth/walletAuth";

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
 * wallet owner isn't paying to see their own data) but ARE now
 * authenticated: requireWalletSession() below requires the caller to have
 * already proven control of `:address` via a wallet signature (see
 * POST /v1/auth/verify and src/server/auth/walletAuth.ts's doc comment).
 */
export const Route = createFileRoute("/v1/wallets/$address/profile")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { address } = params;
        const authError = requireWalletSession(request, address);
        if (authError) return authError;

        const profile = await store.getOwnProfile(address);
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
