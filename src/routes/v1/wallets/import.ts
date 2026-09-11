// SPDX-License-Identifier: MIT
import { createFileRoute } from "@tanstack/react-router";
import { indexRealWallet } from "@/server/indexer/realIndexer";
import { fingerprintBarPercentages, profileStrength } from "@/server/aggregation/scoring";
import { applyExclusions } from "@/server/aggregation/privacyLayer";
import { store } from "@/server/singletons";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * POST /v1/wallets/import
 * Body: { address: "0x...", network?: "testnet"|"mainnet" }
 *
 * Replaces the synthetic-seed flow for a single wallet: indexes the
 * address's real public Robinhood Chain history (see
 * src/server/indexer/realIndexer.ts) and registers (or refreshes, if it's
 * already known) that wallet's profile in the store. Returns the same
 * shape as GET /v1/wallets/:address/profile, plus `dataGaps` — fields the
 * indexer could not honestly compute from real chain data yet, so callers
 * (the dashboard included) can show that plainly instead of presenting
 * placeholder data as if it were real.
 *
 * Not authenticated, same as every other wallet route in this scaffold —
 * see the project README's "Security" section before this goes near
 * production. Unlike the synthetic seed, this one makes outbound network
 * calls (to the Robinhood Chain explorer and a price feed), so it can
 * fail for reasons outside this server's control — those surface as 502,
 * not 500.
 */
export const Route = createFileRoute("/v1/wallets/import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: any;
        try {
          const text = await request.text();
          body = JSON.parse(text || "{}");
        } catch {
          return Response.json({ error: "invalid_request", message: "body must be valid JSON" }, { status: 400 });
        }

        const address = body?.address;
        if (typeof address !== "string" || !ADDRESS_RE.test(address)) {
          return Response.json(
            { error: "invalid_request", message: "address must be a 0x-prefixed 40-hex-character address" },
            { status: 400 },
          );
        }
        if (body.network !== undefined && !["testnet", "mainnet"].includes(body.network)) {
          return Response.json({ error: "invalid_request", message: 'network must be "testnet" or "mainnet"' }, { status: 400 });
        }

        let indexed;
        try {
          indexed = await indexRealWallet(address, { network: body.network });
        } catch (err) {
          return Response.json(
            {
              error: "indexing_failed",
              message: `could not index ${address} from Robinhood Chain: ${(err as Error).message}`,
            },
            { status: 502 },
          );
        }

        // TEMPORARY DIAGNOSTIC — narrows down a live 500 on this route.
        // Do not leave this shipped: it exposes internal error detail on a
        // route with no auth. Remove once the root cause is fixed.
        let alreadyRegistered: boolean;
        try {
          alreadyRegistered = (await store.getOwnProfile(address)) !== null;
          if (alreadyRegistered) {
            await store.refreshFromActivity(address, indexed.raw);
          } else {
            // synthetic: false — this is a real, wallet-connect-imported
            // address, not a dev seed wallet. See store.ts's registerWallet()
            // doc comment for why that flag matters.
            await store.registerWallet(indexed.raw, [], { synthetic: false });
          }
        } catch (err) {
          return Response.json(
            {
              status: "error",
              debugMessage: (err as Error)?.message,
              debugName: (err as Error)?.name,
              debugStack: (err as Error)?.stack,
            },
            { status: 200 },
          );
        }

        const profile = (await store.getOwnProfile(address))!;
        const visibleFingerprint = applyExclusions(profile.fingerprint, profile.excludedCategories);

        return Response.json({
          walletAddress: address,
          imported: !alreadyRegistered,
          refreshed: alreadyRegistered,
          profileStrength: profileStrength(profile.weight),
          fingerprint: visibleFingerprint,
          fingerprintBars: fingerprintBarPercentages(visibleFingerprint, { synthetic: profile.synthetic }),
          excludedCategories: profile.excludedCategories,
          dataGaps: indexed.dataGaps,
          sourcedFrom: indexed.sourcedFrom,
        });
      },
    },
  },
});
