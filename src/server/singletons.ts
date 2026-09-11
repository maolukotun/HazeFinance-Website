// SPDX-License-Identifier: MIT
/**
 * Module-scope singletons shared by every API route handler in
 * src/routes/v1/** and src/routes/health.ts.
 *
 * ============================================================================
 * PERSISTENCE — READ THIS BEFORE POINTING REAL USERS OR AN ICO AT THIS DEPLOYMENT
 * ============================================================================
 * ProfileStore, SplitterSimulator, and ActivityLog are backed by Postgres
 * once a connection string is present (see src/server/db/client.ts's
 * isDatabaseConfigured()) — required on Vercel, where each server route
 * can run in its own function instance and instances are recycled on
 * their own schedule. This used to be a plain in-memory Maps/arrays
 * implementation, and that was a real, reproduced bug, not a theoretical
 * one: a wallet registered via POST /v1/wallets/import on one instance
 * was invisible to a GET .../profile that happened to land on a
 * different (or later, cold) instance. Confirmed live on tryhazefi.com —
 * import succeeded, then five straight profile reads all 404'd.
 *
 * To fix this on your Vercel project: Project -> Storage -> Create
 * Database -> Postgres (this provisions via the Neon integration and
 * auto-injects POSTGRES_URL and friends as env vars — nothing to copy by
 * hand). Every table is created lazily on first query, so there's no
 * separate migration step. Redeploy (or just wait for the next cold
 * start) once it's attached.
 *
 * With NO Postgres attached (the default for local `npm run dev`, and
 * for a Vercel project that hasn't added the Storage integration yet),
 * all three classes transparently fall back to the original in-memory
 * behavior — same zero-setup local dev experience as before, but the
 * production bug above still applies until Postgres is attached.
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
import { isDatabaseConfigured } from "./db/client";

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

// Always logged (not gated to dev) — this only ever reaches server-side
// function logs (Vercel's Runtime Logs / your own terminal), never an end
// user, and whether Postgres is attached is exactly the operational fact
// you need to see here. See the big comment above for what to do about it.
console.log(
  isDatabaseConfigured()
    ? "[haze] Postgres configured — wallet data will persist across serverless instances and deploys."
    : "[haze] Postgres NOT configured — wallet data will NOT reliably persist across serverless instances (see singletons.ts). Attach a Postgres integration in the Vercel dashboard's Storage tab to fix this before relying on real wallet connections in production.",
);

// Seed synthetic demo wallets once per process/instance so the dashboard
// has something to show immediately (matching the original backend's
// `npm run dev` seeding script). All fake — no real user data. A real,
// wallet-connect-imported wallet (see routes/v1/wallets/import.ts) is
// registered separately with `synthetic: false` and never mixes with
// this seed data's simulated earnings — see store.ts / splitterSimulator.ts.
//
// Synthetic wallet addresses are DETERMINISTIC (same seed every process —
// see indexer/syntheticIndexer.ts), so seedSyntheticWallet() is a safe,
// idempotent no-op past the first time on the Postgres path: every
// instance/cold-start converges on the same seeded rows instead of
// erroring on conflict or duplicating them.
//
// Top-level await is intentional and safe here: this module is
// server-only (imported only from src/routes/**, never bundled for the
// browser), and every route handler that reads `store`/`splitterSim`/
// `activityLog` already awaits an async import of this module implicitly
// by importing it at all — so seeding is guaranteed to finish before any
// handler can run, on both the in-memory and Postgres backends.
for (const wallet of generateSyntheticWallets(SEED_WALLET_COUNT)) {
  await store.seedSyntheticWallet(wallet);
}

if (process.env["NODE_ENV"] !== "production") {
  // Dev-only convenience: simulate query traffic every couple of seconds
  // so the dashboard's earnings/activity panels have moving numbers
  // during local development without needing a real buyer to hit
  // POST /v1/profiles/query. Deliberately skipped in production —
  // Vercel Functions are not long-running processes, so a setInterval
  // there would do nothing useful and could outlive the request it was
  // started in. (This means production's earnings/activity panels stay
  // at $0/empty until real buyers start hitting POST /v1/profiles/query —
  // expected today, not a bug; see the README.)
  setInterval(() => {
    void (async () => {
      const amount = Math.round((0.5 + Math.random() * 1.5) * 100) / 100;
      await splitterSim.deposit(amount);
      const sampleFilters = [
        {},
        { traderType: "day_trader" as const },
        { riskProfile: "aggressive" as const },
        { minAvgDailyVolumeUsd: 100 },
      ][Math.floor(Math.random() * 4)]!;
      const matching = await store.getMatchingWallets(sampleFilters);
      await activityLog.record(matching, amount, sampleFilters);
    })();
  }, 2000);

  const firstWallet = (await store.getSyncSnapshot())[0]?.walletAddress;
  if (firstWallet) {
    console.log(
      `[haze] seeded ${await store.size()} synthetic profiles. Try this address in the dashboard's dev wallet override:\n  ?devWallet=${firstWallet}`,
    );
  }
}
