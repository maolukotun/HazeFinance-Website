// SPDX-License-Identifier: MIT
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ProfileStore } from "../src/aggregation/store.js";
import { generateSyntheticWallets } from "../src/indexer/syntheticIndexer.js";
import { createHazeApiServer } from "../src/api/server.js";
import { MockPaymentVerifier, PAYMENT_HEADER } from "../src/payments/x402.js";

async function withServer(walletCount, run) {
  const store = new ProfileStore();
  for (const w of generateSyntheticWallets(walletCount, 11)) store.registerWallet(w);

  const server = createHazeApiServer({
    store,
    priceUsdc: 0.02,
    payToAddress: "0xTestSplitter",
    verifier: new MockPaymentVerifier(),
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`, store);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

describe("Haze API end to end", () => {
  test("health endpoint reports profile count", async () => {
    await withServer(50, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health`);
      const body = await res.json();
      assert.equal(body.status, "ok");
      assert.equal(body.profileCount, 50);
    });
  });

  test("query without payment gets 402, same query with payment succeeds", async () => {
    await withServer(50, async (baseUrl) => {
      const unpaid = await fetch(`${baseUrl}/v1/profiles/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(unpaid.status, 402);

      const paid = await fetch(`${baseUrl}/v1/profiles/query`, {
        method: "POST",
        headers: { "content-type": "application/json", [PAYMENT_HEADER]: "mock:0.02" },
        body: JSON.stringify({}),
      });
      assert.equal(paid.status, 200);
      const body = await paid.json();
      assert.equal(body.profiles.length, 50);
    });
  });

  test("a narrow filter that undershoots k-anonymity is refused even when paid", async () => {
    await withServer(1, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/v1/profiles/query`, {
        method: "POST",
        headers: { "content-type": "application/json", [PAYMENT_HEADER]: "mock:0.02" },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 422);
      const body = await res.json();
      assert.equal(body.error, "cohort_too_small");
      assert.equal(JSON.stringify(body).includes('"1"'), false);
    });
  });

  test("rejects a query body with unknown filter keys", async () => {
    await withServer(50, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/v1/profiles/query`, {
        method: "POST",
        headers: { "content-type": "application/json", [PAYMENT_HEADER]: "mock:0.02" },
        body: JSON.stringify({ walletAddress: "0xshouldNotBeAFilter" }),
      });
      assert.equal(res.status, 400);
    });
  });

  test("returned profiles are valid JSON with no wallet addresses anywhere in the payload", async () => {
    await withServer(50, async (baseUrl, store) => {
      const res = await fetch(`${baseUrl}/v1/profiles/query`, {
        method: "POST",
        headers: { "content-type": "application/json", [PAYMENT_HEADER]: "mock:0.02" },
        body: JSON.stringify({}),
      });
      const raw = await res.text();
      const realAddresses = store.getSyncSnapshot().map((s) => s.walletAddress);
      for (const addr of realAddresses) {
        assert.equal(raw.includes(addr), false);
      }
    });
  });

  test("unknown route returns 404", async () => {
    await withServer(5, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/nope`);
      assert.equal(res.status, 404);
    });
  });
});
