// SPDX-License-Identifier: MIT
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ProfileStore } from "../src/aggregation/store.js";
import { generateSyntheticWallets } from "../src/indexer/syntheticIndexer.js";
import { SplitterSimulator } from "../src/earnings/splitterSimulator.js";

function makeStoreWithTwoWallets() {
  const store = new ProfileStore();
  const [a, b] = generateSyntheticWallets(2, 100);
  store.registerWallet(a);
  store.registerWallet(b);
  return { store, walletA: a.walletAddress, walletB: b.walletAddress };
}

describe("SplitterSimulator", () => {
  test("claimable is zero before any deposit", () => {
    const { store, walletA } = makeStoreWithTwoWallets();
    const sim = new SplitterSimulator(store);
    assert.equal(sim.claimable(walletA), 0);
  });

  test("80% of a deposit is claimable across wallets, pro-rated by weight", () => {
    const { store, walletA, walletB } = makeStoreWithTwoWallets();
    const sim = new SplitterSimulator(store);
    sim.deposit(100);

    const weightA = store.getSyncSnapshot().find((s) => s.walletAddress === walletA).weight;
    const weightB = store.getSyncSnapshot().find((s) => s.walletAddress === walletB).weight;
    const totalWeight = weightA + weightB;

    const expectedA = (100 * 0.8 * weightA) / totalWeight;
    assert.ok(Math.abs(sim.claimable(walletA) - expectedA) < 1e-9);

    const sum = sim.claimable(walletA) + sim.claimable(walletB);
    assert.ok(Math.abs(sum - 80) < 1e-9);
  });

  test("claim() moves claimable balance into totalClaimed and zeroes claimable", () => {
    const { store, walletA } = makeStoreWithTwoWallets();
    const sim = new SplitterSimulator(store);
    sim.deposit(100);

    const before = sim.claimable(walletA);
    const claimed = sim.claim(walletA);

    assert.equal(claimed, before);
    assert.equal(sim.claimable(walletA), 0);
    assert.equal(sim.totalClaimed(walletA), before);
  });

  test("a second deposit after a claim makes a new claimable share available", () => {
    const { store, walletA } = makeStoreWithTwoWallets();
    const sim = new SplitterSimulator(store);
    sim.deposit(100);
    sim.claim(walletA);

    sim.deposit(100);
    assert.ok(sim.claimable(walletA) > 0);
  });

  test("claiming with zero claimable returns 0 and does not throw", () => {
    const { store, walletA } = makeStoreWithTwoWallets();
    const sim = new SplitterSimulator(store);
    assert.equal(sim.claim(walletA), 0);
  });

  test("depositHistory records every deposit with timestamps", () => {
    const { store } = makeStoreWithTwoWallets();
    const sim = new SplitterSimulator(store);
    sim.deposit(10);
    sim.deposit(20);

    const history = sim.depositHistory();
    assert.equal(history.length, 2);
    assert.equal(history[0].amountUsdc, 10);
    assert.equal(history[1].amountUsdc, 20);
    assert.ok(typeof history[0].timestamp === "number");
  });

  test("unregistered wallet has zero claimable even after deposits", () => {
    const { store } = makeStoreWithTwoWallets();
    const sim = new SplitterSimulator(store);
    sim.deposit(100);
    assert.equal(sim.claimable("0xNeverRegistered"), 0);
  });
});
