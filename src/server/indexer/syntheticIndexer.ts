// SPDX-License-Identifier: MIT
import { EARNINGS_REACTIONS, type RawWalletMetrics } from "../types";

/**
 * Synthetic indexer. Generates fake wallet histories that LOOK like the
 * output of reading real Robinhood Chain RPC data, but contain no real
 * user data whatsoever. Used only to seed local dev / demo data so the
 * dashboard has moving numbers to show — never point this at anything
 * that pretends to be real.
 */

const SECTORS = ["tech", "healthcare", "energy", "financials", "consumer_discretionary"];

/** Small deterministic PRNG (mulberry32) so seeded runs are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomHexAddress(rand: () => number): string {
  let hex = "0x";
  for (let i = 0; i < 40; i++) {
    hex += Math.floor(rand() * 16).toString(16);
  }
  return hex;
}

function pick<T>(rand: () => number, options: readonly T[]): T {
  return options[Math.floor(rand() * options.length)]!;
}

function pickSectors(rand: () => number): string[] {
  const count = 1 + Math.floor(rand() * 3);
  const shuffled = [...SECTORS].sort(() => rand() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * Generates `count` synthetic wallets. Same `seed` always produces the
 * same dataset.
 */
export function generateSyntheticWallets(count: number, seed = 42): RawWalletMetrics[] {
  const rand = mulberry32(seed);
  const wallets: RawWalletMetrics[] = [];

  for (let i = 0; i < count; i++) {
    const ageInDays = 30 + Math.floor(rand() * 900);
    const stockTradeCount = Math.floor(rand() * 400);
    const cryptoTradeCount = Math.floor(rand() * 600);

    wallets.push({
      walletAddress: randomHexAddress(rand),
      ageInDays,
      totalTransactionCount: stockTradeCount + cryptoTradeCount + Math.floor(rand() * 200),
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
