// SPDX-License-Identifier: MIT
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildSyncPlan } from "../src/registryBridge/syncWeights.js";

describe("buildSyncPlan", () => {
  test("new off-chain wallet produces a register action", () => {
    const plan = buildSyncPlan([{ walletAddress: "0xa", weight: 10 }], []);
    assert.deepEqual(plan, [{ type: "register", walletAddress: "0xa", weight: 10 }]);
  });

  test("changed weight produces an update action", () => {
    const plan = buildSyncPlan(
      [{ walletAddress: "0xa", weight: 20 }],
      [{ walletAddress: "0xa", weight: 10 }],
    );
    assert.deepEqual(plan, [{ type: "update", walletAddress: "0xa", oldWeight: 10, newWeight: 20 }]);
  });

  test("unchanged weight produces no action", () => {
    const plan = buildSyncPlan(
      [{ walletAddress: "0xa", weight: 10 }],
      [{ walletAddress: "0xa", weight: 10 }],
    );
    assert.deepEqual(plan, []);
  });

  test("wallet present on-chain but not off-chain produces a delete action", () => {
    const plan = buildSyncPlan([], [{ walletAddress: "0xa", weight: 10 }]);
    assert.deepEqual(plan, [{ type: "delete", walletAddress: "0xa" }]);
  });

  test("mixed diff produces the correct set of actions", () => {
    const offChain = [
      { walletAddress: "0xnew", weight: 5 },
      { walletAddress: "0xchanged", weight: 99 },
      { walletAddress: "0xsame", weight: 7 },
    ];
    const onChain = [
      { walletAddress: "0xchanged", weight: 50 },
      { walletAddress: "0xsame", weight: 7 },
      { walletAddress: "0xgone", weight: 3 },
    ];

    const plan = buildSyncPlan(offChain, onChain);
    const byType = (t) => plan.filter((a) => a.type === t);

    assert.equal(byType("register").length, 1);
    assert.equal(byType("update").length, 1);
    assert.equal(byType("delete").length, 1);
    assert.equal(plan.length, 3); // 0xsame produces nothing
  });
});
