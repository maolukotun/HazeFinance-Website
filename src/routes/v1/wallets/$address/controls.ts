// SPDX-License-Identifier: MIT
import { createFileRoute } from "@tanstack/react-router";
import { CONTROL_TO_CATEGORY } from "@/server/aggregation/controlsMapping";
import { store } from "@/server/singletons";
import { requireWalletSession } from "@/server/auth/walletAuth";

function notFoundProfile(walletAddress: string) {
  return Response.json({ error: "no_profile", message: `no profile registered for ${walletAddress}` }, { status: 404 });
}

/**
 * POST /v1/wallets/:address/controls
 * Body: { control: "trading"|"risk"|"defi"|"equity"|"timing"|"crossasset", enabled: boolean }
 */
export const Route = createFileRoute("/v1/wallets/$address/controls")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { address } = params;
        const authError = requireWalletSession(request, address);
        if (authError) return authError;

        const profile = await store.getOwnProfile(address);
        if (!profile) return notFoundProfile(address);

        let body: any;
        try {
          body = JSON.parse(await request.text());
        } catch {
          return Response.json({ error: "invalid_request", message: "body must be valid JSON" }, { status: 400 });
        }

        const { control, enabled } = body ?? {};
        if (typeof control !== "string" || typeof enabled !== "boolean" || !(control in CONTROL_TO_CATEGORY)) {
          return Response.json(
            {
              error: "invalid_request",
              message: `control must be one of ${Object.keys(CONTROL_TO_CATEGORY).join(", ")}, enabled must be boolean`,
            },
            { status: 400 },
          );
        }

        // `control in CONTROL_TO_CATEGORY` was just checked above, so this
        // key definitely exists — narrow past noUncheckedIndexedAccess's
        // otherwise-`| undefined` result.
        const category = CONTROL_TO_CATEGORY[control] as string | null;
        if (category === null) {
          // Honest no-op — see controlsMapping.ts for why these three don't
          // have a backing category yet.
          return Response.json({
            applied: false,
            reason: `"${control}" isn't backed by an excludable data category yet — see controlsMapping.ts`,
          });
        }

        const current = new Set(profile.excludedCategories);
        if (enabled) current.delete(category); // enabled = sharing ON = not excluded
        else current.add(category);

        await store.updateExclusions(address, [...current]);
        return Response.json({ applied: true, control, category, enabled });
      },
    },
  },
});
