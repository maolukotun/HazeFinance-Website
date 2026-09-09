// SPDX-License-Identifier: MIT
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ActivityLog } from "../src/activity/activityLog.js";

describe("ActivityLog", () => {
  test("forWallet only returns events that included that wallet", () => {
    const log = new ActivityLog();
    log.record(["0xa", "0xb"], 0.02, {});
    log.record(["0xb", "0xc"], 0.02, {});

    const forA = log.forWallet("0xa");
    assert.equal(forA.length, 1);
    const forB = log.forWallet("0xb");
    assert.equal(forB.length, 2);
    const forZ = log.forWallet("0xz");
    assert.equal(forZ.length, 0);
  });

  test("forWallet returns newest first", () => {
    const log = new ActivityLog();
    log.record(["0xa"], 0.01, {});
    log.record(["0xa"], 0.02, {});

    const events = log.forWallet("0xa");
    assert.equal(events[0].priceUsdc, 0.02);
    assert.equal(events[1].priceUsdc, 0.01);
  });

  test("classifies day_trader / cross-asset filters as trading_agent", () => {
    const log = new ActivityLog();
    log.record(["0xa"], 0.02, { traderType: "day_trader" });
    log.record(["0xa"], 0.02, { requireCrossAssetActivity: true });

    const events = log.forWallet("0xa");
    assert.ok(events.every((e) => e.buyerType === "trading_agent"));
  });

  test("classifies riskProfile / assetAllocationStyle filters as research_agent", () => {
    const log = new ActivityLog();
    log.record(["0xa"], 0.02, { riskProfile: "aggressive" });

    assert.equal(log.forWallet("0xa")[0].buyerType, "research_agent");
  });

  test("classifies volume filters as analytics_firm", () => {
    const log = new ActivityLog();
    log.record(["0xa"], 0.02, { minAvgDailyVolumeUsd: 500 });

    assert.equal(log.forWallet("0xa")[0].buyerType, "analytics_firm");
  });

  test("empty filters classify as other", () => {
    const log = new ActivityLog();
    log.record(["0xa"], 0.02, {});

    assert.equal(log.forWallet("0xa")[0].buyerType, "other");
  });

  test("all() returns every recorded event regardless of wallet", () => {
    const log = new ActivityLog();
    log.record(["0xa"], 0.02, {});
    log.record(["0xb"], 0.03, {});
    assert.equal(log.all().length, 2);
  });
});
