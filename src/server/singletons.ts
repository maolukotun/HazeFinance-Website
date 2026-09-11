// SPDX-License-Identifier: MIT
/**
 * Module-scope singletons shared by every API route handler in
 * src/routes/v1/** and src/routes/health.ts.
 *
 * ============================================================================
 * READ THIS BEFORE POINTING REAL USERS OR AN ICO AT THIS DEPLOYMENT
 * ============================================================================
 * ProfileStore, SplitterSimulator, and ActivityLog all keep their state in
 * plain in-memory JS Maps/arrays — exactly like the original standalone
 * haze-backend scaffold this was merged from. That was already
 * dev/demo-only there; on Vercel it is *more* fragile, not less:
 *
 *   - Vercel Functions are not guaranteed to stay warm. A route can run in
 *     a fresh instance with empty state at any time, even seconds after a
 *     previous request populated it.
 *   - Under real traffic, multiple concurrent instances of the same
 *     function can exist simultaneously, each with its own copy of this
 *     module's state — a wallet registered against one instance will not
 *     be visible from another.
 *   - Every deploy replaces all running instances, discarding all state.
 *
 * In short: this is enough to demo the full flow (connect a wallet, see a
 * fingerprint, see earnings move) on a single warm instance, but it is
 * NOT durable storage. Before real users — and especially before an ICO
 * that depends on this working correctly for real investors — replace
 * ProfileStore/SplitterSimulator/ActivityLog's internals with a real
 * database (Vercel Postgres, Vercel KV/Upstash Redis, or any external
 * Postgres) without changing their public method signatures, so the route
 * handlers in src/routes/v1/** don't need to change at all.
 *
 * The other pieces still explicitly NOT wired up, carried over unchanged
 * from the original backend (see this project's README for detail):
 *   - No authentication on the wallet-owner routes (the :address URL
 *     segment is trusted as given).
 *   - No real Meridian x402 settlement verification (MockPaymentVerifier
 *     only — see src/server/payments/meridian.ts).
 *   - No real on-chain ProfileRegistry sync (src/server/registryBridge/syncWeights.ts's
 *     applySyncPlan() throws on purpose).
 *   - No real withdrawal (POST /v1/wallets/:address/withdraw simulates
 *     SplitterSimulator moving a balance from claimable to claimed; a real
 *     withdrawal is the wallet owner signing a transaction against the
 *     deployed HazeSplitter contract themselves).
 */

import { ProfileStore } from "./aggregation/store";
import { SplitterSimulator } from "./earnings/splitterSimulator";
import { ActivityLog } from "./activity/activityLog";
import { generateSyntheticWallets } from "./indexer/syntheticIndexer";
import { MockPaymentVerifier, type PaymentVerifier } from "./payments/x402";

const SEED_WALLET_COUNT = Number(process.env["SEED_WALLET_COUNT"] ?? 40);
export const QUERY_PRICE_USDC = Number(process.env["QUERY_PRICE_USDC"] ?? 0.02);
export const PAY_TO_ADDRESS = process.env["HAZE_SPLITTER_ADDRESS"] || "0xHazeSplitterAddressGoesHere";
export const CORS_ORIGIN = process.env["CORS_ORIGIN"] ?? "*";

export const store = new ProfileStore();
export const splitterSim = new SplitterSimulator(store);
export const activityLog = new ActivityLog();

// MockPaymentVerifier only. Swap for MeridianPaymentVerifier (see
// src/server/payments/meridian.ts) once real Meridian settlement
// verification is implemented — do not ship the mock to anywhere real
// money is expected to move.
export const paymentVerifier: PaymentVerifier = new MockPaymentVerifier();

// Seed synthetic demo wallets once per process/instance so the dashboard
// has something to show immediately (matching the original backend's
// `npm run dev` seeding script). All fake — no real user data. A real,
// wallet-connect-imported wallet (see routes/v1/wallets/import.ts) is
// registered separately with `synthetic: false` and never mixes with
// this seed data's simulated earnings — see store.ts / splitterSimulator.ts.
for (const wallet of generateSyntheticWallets(SEED_WALLET_COUNT)) {
  store.registerWallet(wallet);
}

if (process.env["NODE_ENV"] !== "production") {
  // Dev-only convenience: simulate query traffic every couple of seconds
  // so the dashboard's earnings/activity panels have moving numbers
  // during local development without needing a real buyer to hit
  // POST /v1/profiles/query. Deliberately skipped in production —
  // Vercel Functions are not long-running processes, so a setInterval
  // there would do nothing useful and could outlive the request it was
  // started in.
  setInterval(() => {
    const amount = Math.round((0.5 + Math.random() * 1.5) * 100) / 100;
    splitterSim.deposit(amount);
    const sampleFilters = [
      {},
      { traderType: "day_trader" as const },
      { riskProfile: "aggressive" as const },
      { minAvgDailyVolumeUsd: 100 },
    ][Math.floor(Math.random() * 4)]!;
    const matching = store.getMatchingWallets(sampleFilters);
    activityLog.record(matching, amount, sampleFilters);
  }, 2000);

  const firstWallet = store.getSyncSnapshot()[0]?.walletAddress;
  if (firstWallet) {
    console.log(
      `[haze] seeded ${store.size()} synthetic profiles. Try this address in the dashboard's dev wallet override:\n  ?devWallet=${firstWallet}`,
    );
  }
}
