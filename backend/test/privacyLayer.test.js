// SPDX-License-Identifier: MIT
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeFingerprint } from "../src/aggregation/fingerprint.js";
import {
  applyExclusions,
  computeWeight,
  generateProfileId,
  toAnonymizedProfile,
} from "../src/aggregation/privacyLayer.js";

/** @param {Partial<import("../src/types.js").RawWalletMetrics>} [overrides] */
function raw(overrides = {}) {
  return {
    walletAddress: "0xdeadbeef",
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

describe("applyExclusions", () => {
  test("nulls out excluded categories, leaves others intact", () => {
    const fp = computeFingerprint(raw());
    const redacted = applyExclusions(fp, ["equity_trading", "defi_usage"]);

    assert.equal(redacted.equityBehavior, null);
    assert.equal(redacted.defiUsage, null);
    assert.notEqual(redacted.spendingRhythm, null);
    assert.equal(redacted.traderType, fp.traderType);
  });

  test("no exclusions leaves fingerprint unchanged", () => {
    const fp = computeFingerprint(raw());
    assert.deepEqual(applyExclusions(fp, []), fp);
  });
});

describe("toAnonymizedProfile", () => {
  test("never includes a wallet address field", () => {
    const fp = computeFingerprint(raw());
    /** @type {import("../src/types.js").InternalProfileRecord} */
    const record = {
      profileId: generateProfileId(),
      walletAddress: "0xSHOULD_NOT_LEAK",
      fingerprint: fp,
      weight: 42,
      excludedCategories: [],
    };

    const anonymized = toAnonymizedProfile(record);
    const serialized = JSON.stringify(anonymized);

    assert.equal("walletAddress" in anonymized, false);
    assert.equal(serialized.includes("0xSHOULD_NOT_LEAK"), false);
    assert.equal("weight" in anonymized, false); // payout weight is internal too
  });

  test("respects the record's excluded categories", () => {
    const fp = computeFingerprint(raw());
    /** @type {import("../src/types.js").InternalProfileRecord} */
    const record = {
      profileId: generateProfileId(),
      walletAddress: "0xabc",
      fingerprint: fp,
      weight: 10,
      excludedCategories: ["reactivity"],
    };

    assert.equal(toAnonymizedProfile(record).fingerprint.reactivity, null);
  });
});

describe("computeWeight", () => {
  test("higher volume and maturity produce higher weight", () => {
    const lowActivity = computeFingerprint(raw({ ageInDays: 30, avgDailyVolumeUsd: 10, activityConsistencyScore: 0.1 }));
    const highActivity = computeFingerprint(
      raw({ ageInDays: 900, avgDailyVolumeUsd: 5000, activityConsistencyScore: 0.95 }),
    );

    assert.ok(computeWeight(highActivity) > computeWeight(lowActivity));
  });

  test("cross-asset signals increase weight", () => {
    const noCrossAsset = computeFingerprint(
      raw({ stockToCryptoRotationRate: 0, cryptoToStockRotationRate: 0, morphoBorrowingActive: false }),
    );
    const crossAsset = computeFingerprint(
      raw({ stockToCryptoRotationRate: 0.9, cryptoToStockRotationRate: 0.9, morphoBorrowingActive: true, morphoLeverageRatio: 2 }),
    );

    assert.ok(computeWeight(crossAsset) > computeWeight(noCrossAsset));
  });

  test("weight is always a positive integer", () => {
    const fp = computeFingerprint(raw());
    const w = computeWeight(fp);
    assert.ok(Number.isInteger(w));
    assert.ok(w > 0);
  });
});
