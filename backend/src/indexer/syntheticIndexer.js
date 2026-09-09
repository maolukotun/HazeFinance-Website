// SPDX-License-Identifier: MIT
import { EARNINGS_REACTIONS } from "../types.js";

/**
 * Synthetic indexer. Generates fake wallet histories that LOOK like the
 * output of reading real Robinhood Chain RPC data, but contain no real
 * user data whatsoever.
 *
 * This matches Phase 3 of the build plan on purpose: "Build the
 * aggregation service against synthetic contributions you generate...
 * No real user data anywhere near this." Do not point this module at a
 * real indexer without a deliberate, separate decision to do so — and if
 * you do, the aggregation/privacy layer downstream still has to hold,
 * unchanged.
 */

const SECTORS = ["tech", "healthcare", "energy", "financials", "consumer_discretionary"];

/** Small deterministic PRNG (mulberry32) so test runs are reproducible.
 * @param {number} seed
 * @returns {() => number}
 */
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {() => number} rand */
function randomHexAddress(rand) {
  let hex = "0x";
  for (let i = 0; i < 40; i++) {
    hex += Math.floor(rand() * 16).toString(16);
  }
  return hex;
}

/**
 * @template T
 * @param {() => number} rand
 * @param {T[]} options
 * @returns {T}
 */
function pick(rand, options) {
  return options[Math.floor(rand() * options.length)];
}

/** @param {() => number} rand */
function pickSectors(rand) {
  const count = 1 + Math.floor(rand() * 3);
  const shuffled = [...SECTORS].sort(() => rand() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * Generates `count` synthetic wallets. Same `seed` always produces the
 * same dataset, which is what makes the test suite deterministic.
 *
 * @param {number} count
 * @param {number} [seed]
 * @returns {import("../types.js").RawWalletMetrics[]}
 */
export function generateSyntheticWallets(count, seed = 42) {
  const rand = mulberry32(seed);
  const wallets = [];

  for (let i = 0; i < count; i++) {
    const ageInDays = 30 + Math.floor(rand() * 900);
    const stockTradeCount = Math.floor(rand() * 400);
    const cryptoTradeCount = Math.floor(rand() * 600);
    const totalTransactionCount =
      stockTradeCount + cryptoTradeCount + Math.floor(rand() * 200);

    wallets.push({
      walletAddress: randomHexAddress(rand),
      ageInDays,
      totalTransactionCount,
      stockTradeCount,
      cryptoTradeCount,
      uniswapSwapsPerMonth: Math.floor(rand() * 60),
      morphoLendingActive: rand() > 0.6,
      morphoBorrowingActive: rand() > 0.75,
      morphoLeverageRatio: rand() > 0.75 ? Math.round(rand() * 3 * 100) / 100 : 0,
      lpPositionsActive: rand() > 0.7,
      liquidationCount: rand() > 0.9 ? Math.floor(rand() * 3) : 0,
      avgPositionSizeUsd: Math.round(50 + rand() * 20_000),
      avgDailyVolumeUsd: Math.round(10 + rand() * 5_000),
      peakHourUtc: Math.floor(rand() * 24),
      weekdayVsWeekendRatio: Math.round((0.8 + rand() * 2) * 100) / 100,
      avgResponseTimeToMarketMoveMinutes: Math.round(1 + rand() * 240),
      sectorPreferences: pickSectors(rand),
      earningsReactionPattern: pick(rand, EARNINGS_REACTIONS),
      avgEquityHoldingDurationDays: Math.round(1 + rand() * 60),
      stockToCryptoRotationRate: Math.round(rand() * 100) / 100,
      cryptoToStockRotationRate: Math.round(rand() * 100) / 100,
      activityConsistencyScore: Math.round(rand() * 100) / 100,
    });
  }

  return wallets;
}
