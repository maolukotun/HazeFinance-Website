// SPDX-License-Identifier: MIT
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeFingerprint } from "../src/aggregation/fingerprint.js";

/** @param {Partial<import("../src/types.js").RawWalletMetrics>} [overrides] */
function baseRaw(overrides = {}) {
  return {
    walletAddress: "0xabc",
    ageInDays: 400,
    totalTransactionCount: 500,
    stockTradeCount: 100,
    cryptoTradeCount: 100,
    uniswapSwapsPerMonth: 10,
    morphoLendingActive: false,
    morphoBorrowingActive: false,
    morphoLeverageRatio: 0,
    lpPositionsActive: false,
    liquidationCount: 0,
    avgPositionSizeUsd: 1000,
    avgDailyVolumeUsd: 500,
    peakHourUtc: 14,
    weekdayVsWeekendRatio: 1.2,
    avgResponseTimeToMarketMoveMinutes: 30,
    sectorPreferences: ["tech"],
    earningsReactionPattern: "no_reaction",
    avgEquityHoldingDurationDays: 10,
    stockToCryptoRotationRate: 0.1,
    cryptoToStockRotationRate: 0.1,
    activityConsistencyScore: 0.5,
    ...overrides,
  };
}

describe("computeFingerprint", () => {
  test("is deterministic for identical input", () => {
    const raw = baseRaw();
    assert.deepEqual(computeFingerprint(raw), computeFingerprint(raw));
  });

  test("classifies a high-frequency trader as day_trader", () => {
    const raw = baseRaw({ ageInDays: 30, stockTradeCount: 1000, cryptoTradeCount: 1000 });
    assert.equal(computeFingerprint(raw).traderType, "day_trader");
  });

  test("classifies low-frequency, long-hold wallet as holder", () => {
    const raw = baseRaw({
      ageInDays: 400,
      stockTradeCount: 2,
      cryptoTradeCount: 2,
      avgEquityHoldingDurationDays: 60,
    });
    assert.equal(computeFingerprint(raw).traderType, "holder");
  });

  test("classifies lending-only, low-trade wallet as farmer", () => {
    const raw = baseRaw({
      ageInDays: 400,
      stockTradeCount: 1,
      cryptoTradeCount: 1,
      morphoLendingActive: true,
      morphoBorrowingActive: false,
    });
    assert.equal(computeFingerprint(raw).traderType, "farmer");
  });

  test("high rotation rate produces rotational allocation style", () => {
    const raw = baseRaw({ stockToCryptoRotationRate: 0.9, cryptoToStockRotationRate: 0.1 });
    assert.equal(computeFingerprint(raw).assetAllocationStyle, "rotational");
  });

  test("liquidation history forces aggressive risk profile", () => {
    const raw = baseRaw({ liquidationCount: 1 });
    assert.equal(computeFingerprint(raw).riskProfile, "aggressive");
  });

  test("cross-asset behavior flags reflect rotation thresholds", () => {
    const raw = baseRaw({ stockToCryptoRotationRate: 0.8, cryptoToStockRotationRate: 0.1 });
    const fp = computeFingerprint(raw);
    assert.equal(fp.crossAssetBehavior.rotatesStockGainsIntoCrypto, true);
    assert.equal(fp.crossAssetBehavior.rotatesCryptoGainsIntoStock, false);
  });

  test("morpho leverage + borrowing sets stock-collateral leverage flag", () => {
    const raw = baseRaw({ morphoBorrowingActive: true, morphoLeverageRatio: 1.5 });
    assert.equal(computeFingerprint(raw).crossAssetBehavior.usesMorphoForStockCollateralLeverage, true);
  });
});
