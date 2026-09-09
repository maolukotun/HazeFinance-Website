// SPDX-License-Identifier: MIT
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ProfileStore, K_ANONYMITY_MIN } from "../src/aggregation/store.js";
import { generateSyntheticWallets } from "../src/indexer/syntheticIndexer.js";

describe("ProfileStore k-anonymity enforcement", () => {
  test("refuses a query that matches fewer than the minimum cohort size", () => {
    const store = new ProfileStore();
    const [oneWallet] = generateSyntheticWallets(1, 1);
    store.registerWallet(oneWallet);

    const result = store.queryCohort({}, 5);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "cohort_too_small");
      assert.equal(result.minimumRequired, 5);
    }
  });

  test("returns profiles once the cohort meets the minimum", () => {
    const store = new ProfileStore();
    for (const w of generateSyntheticWallets(10, 2)) store.registerWallet(w);

    const result = store.queryCohort({}, 5);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.profiles.length >= 5);
    }
  });

  test("default minimum is K_ANONYMITY_MIN", () => {
    const store = new ProfileStore();
    for (const w of generateSyntheticWallets(K_ANONYMITY_MIN - 1, 3)) store.registerWallet(w);

    const result = store.queryCohort({});
    assert.equal(result.ok, false);
  });

  test("returned profiles never carry a wallet address", () => {
    const store = new ProfileStore();
    for (const w of generateSyntheticWallets(10, 4)) store.registerWallet(w);

    const result = store.queryCohort({}, 5);
    assert.equal(result.ok, true);
    if (result.ok) {
      for (const p of result.profiles) {
        assert.equal("walletAddress" in p, false);
        assert.equal(JSON.stringify(p).includes("0x"), false);
      }
    }
  });
});

describe("ProfileStore lifecycle", () => {
  test("registerWallet rejects a duplicate wallet", () => {
    const store = new ProfileStore();
    const [wallet] = generateSyntheticWallets(1, 5);
    store.registerWallet(wallet);
    assert.throws(() => store.registerWallet(wallet));
  });

  test("deleteProfile removes the wallet from future cohorts", () => {
    const store = new ProfileStore();
    const wallets = generateSyntheticWallets(6, 6);
    for (const w of wallets) store.registerWallet(w);

    store.deleteProfile(wallets[0].walletAddress);
    assert.equal(store.size(), 5);

    // The deleted wallet's weight must not appear in a sync snapshot either.
    const snapshot = store.getSyncSnapshot();
    assert.equal(snapshot.some((s) => s.walletAddress === wallets[0].walletAddress), false);
  });

  test("refreshFromActivity recomputes weight (models daily re-scoring)", () => {
    const store = new ProfileStore();
    const [wallet] = generateSyntheticWallets(1, 7);
    store.registerWallet(wallet);

    const before = store.getSyncSnapshot()[0].weight;

    store.refreshFromActivity(wallet.walletAddress, {
      ...wallet,
      avgDailyVolumeUsd: wallet.avgDailyVolumeUsd + 50_000,
      ageInDays: wallet.ageInDays + 1000,
      activityConsistencyScore: 1,
    });

    const after = store.getSyncSnapshot()[0].weight;
    assert.ok(after > before);
  });

  test("getSyncSnapshot exposes wallet addresses (privileged accessor)", () => {
    const store = new ProfileStore();
    const wallets = generateSyntheticWallets(3, 8);
    for (const w of wallets) store.registerWallet(w);

    const snapshot = store.getSyncSnapshot();
    assert.equal(snapshot.length, 3);
    for (const w of wallets) {
      assert.ok(snapshot.some((s) => s.walletAddress === w.walletAddress));
    }
  });

  test("private fields are not reachable from outside the class", () => {
    const store = new ProfileStore();
    // Real ES private fields (#records) aren't just hidden by convention —
    // accessing them from outside the class is a SyntaxError/undefined,
    // not just "you're not supposed to." This confirms that.
    assert.equal(Object.keys(store).length, 0); // # fields don't show up as own enumerable keys
    assert.equal(/** @type {any} */ (store).records, undefined);
    assert.equal(/** @type {any} */ (store).profileIdByWallet, undefined);
  });
});

describe("ProfileStore filters", () => {
  test("traderType filter narrows the cohort", () => {
    const store = new ProfileStore();
    for (const w of generateSyntheticWallets(200, 9)) store.registerWallet(w);

    const unfiltered = store.queryCohort({}, 1);
    const filtered = store.queryCohort({ traderType: "day_trader" }, 1);

    assert.equal(unfiltered.ok, true);
    if (unfiltered.ok && filtered.ok) {
      assert.ok(filtered.profiles.length <= unfiltered.profiles.length);
      for (const p of filtered.profiles) {
        assert.equal(p.fingerprint.traderType, "day_trader");
      }
    }
  });
});
