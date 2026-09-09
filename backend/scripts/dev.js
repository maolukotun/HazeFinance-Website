// SPDX-License-Identifier: MIT
import { ProfileStore } from "../src/aggregation/store.js";
import { generateSyntheticWallets } from "../src/indexer/syntheticIndexer.js";
import { createDevServer } from "../src/api/server.js";

const WALLET_COUNT = Number(process.env.SEED_WALLET_COUNT ?? 40);
const PORT = Number(process.env.PORT ?? 8402);
const PRICE_USDC = Number(process.env.QUERY_PRICE_USDC ?? 0.02);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";

function main() {
  const store = new ProfileStore();
  const wallets = generateSyntheticWallets(WALLET_COUNT);

  for (const wallet of wallets) {
    store.registerWallet(wallet);
  }

  console.log(`Seeded ${store.size()} synthetic profiles (all fake — no real user data).`);

  const server = createDevServer(store, PRICE_USDC);
  const { splitterSim, activityLog } = server.hazeInternals;

  // Dev-only: simulate query traffic every few seconds so the dashboard
  // (earnings, activity, query breakdown) has moving numbers to show
  // without needing a real buyer hitting /v1/profiles/query. Picks a
  // random wallet from the seed set as "the one you're viewing" isn't
  // needed here — every registered wallet accrues its pro-rata share of
  // every simulated deposit, same as the real 80/20 splitter math.
  // Dev-only: simulate query traffic every couple seconds so the
  // dashboard (earnings, activity, query breakdown) has moving numbers to
  // show without needing a real buyer hitting /v1/profiles/query. The
  // per-tick amount ($0.50-$2.00) is deliberately much larger than the
  // real $0.01-$0.05 per-query price from the brief — that's purely so a
  // local demo shows visible cents within seconds instead of requiring
  // thousands of real queries to accumulate; it is NOT a realistic
  // revenue rate. Every registered wallet accrues its pro-rata share of
  // every simulated deposit, same as the real 80/20 splitter math.
  setInterval(() => {
    const amount = Math.round((0.5 + Math.random() * 1.5) * 100) / 100;
    splitterSim.deposit(amount);
    const sampleFilters = [{}, { traderType: "day_trader" }, { riskProfile: "aggressive" }, { minAvgDailyVolumeUsd: 100 }][
      Math.floor(Math.random() * 4)
    ];
    const matching = store.getMatchingWallets(sampleFilters);
    activityLog.record(matching, amount, sampleFilters);
  }, 2000);

  server.listen(PORT, () => {
    const firstWallet = store.getSyncSnapshot()[0]?.walletAddress;
    console.log(`Haze dev API listening on http://localhost:${PORT} (CORS origin: ${CORS_ORIGIN})`);
    console.log(`  GET  /health`);
    console.log(`  POST /v1/profiles/query          (x402-gated, $${PRICE_USDC}/query)`);
    console.log(`  GET  /v1/wallets/:address/profile`);
    console.log(`  POST /v1/wallets/:address/controls`);
    console.log(`  GET  /v1/wallets/:address/earnings`);
    console.log(`  GET  /v1/wallets/:address/earnings/history?range=7d|30d|90d|all`);
    console.log(`  GET  /v1/wallets/:address/activity`);
    console.log(`  POST /v1/wallets/:address/withdraw   (dev simulation only)`);
    if (firstWallet) {
      console.log(`\nTry a seeded wallet address in the dashboard's dev wallet override:\n  ${firstWallet}`);
    }
  });
}

main();
