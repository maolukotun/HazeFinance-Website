// SPDX-License-Identifier: MIT
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ProfileStore } from "../src/aggregation/store.js";
import { generateSyntheticWallets } from "../src/indexer/syntheticIndexer.js";
import { createHazeApiServer } from "../src/api/server.js";
import { MockPaymentVerifier, PAYMENT_HEADER } from "../src/payments/x402.js";

async function withServer(walletCount, run) {
  const store = new ProfileStore();
  const wallets = generateSyntheticWallets(walletCount, 55);
  for (const w of wallets) store.registerWallet(w);

  const server = createHazeApiServer({
    store,
    priceUsdc: 0.02,
    payToAddress: "0xTestSplitter",
    verifier: new MockPaymentVerifier(),
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`, store, server, wallets);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

describe("wallet routes", () => {
  test("GET /v1/wallets/:address/profile returns fingerprint + strength for a known wallet", async () => {
    await withServer(5, async (baseUrl, store, server, wallets) => {
      const address = wallets[0].walletAddress;
      const res = await fetch(`${baseUrl}/v1/wallets/${address}/profile`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.walletAddress, address);
      assert.ok(body.profileStrength >= 0 && body.profileStrength <= 100);
      assert.ok(body.fingerprint);
      assert.ok(body.fingerprintBars);
      assert.deepEqual(body.excludedCategories, []);
    });
  });

  test("GET /v1/wallets/:address/profile 404s for an unknown wallet", async () => {
    await withServer(5, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/v1/wallets/0xNeverSeen/profile`);
      assert.equal(res.status, 404);
    });
  });

  test("CORS headers are present on every response", async () => {
    await withServer(5, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health`);
      assert.equal(res.headers.get("access-control-allow-origin"), "*");
    });
  });

  test("POST controls with a mapped category actually excludes it", async () => {
    await withServer(5, async (baseUrl, store, server, wallets) => {
      const address = wallets[0].walletAddress;

      const res = await fetch(`${baseUrl}/v1/wallets/${address}/controls`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ control: "defi", enabled: false }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.applied, true);
      assert.equal(body.category, "defi_usage");

      const profileRes = await fetch(`${baseUrl}/v1/wallets/${address}/profile`);
      const profile = await profileRes.json();
      assert.ok(profile.excludedCategories.includes("defi_usage"));
      assert.equal(profile.fingerprint.defiUsage, null);
    });
  });

  test("POST controls with an unmapped control (trading/risk/crossasset) is an honest no-op", async () => {
    await withServer(5, async (baseUrl, store, server, wallets) => {
      const address = wallets[0].walletAddress;
      const res = await fetch(`${baseUrl}/v1/wallets/${address}/controls`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ control: "risk", enabled: false }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.applied, false);
      assert.ok(body.reason.includes("risk"));
    });
  });

  test("POST controls rejects an unknown control id", async () => {
    await withServer(5, async (baseUrl, store, server, wallets) => {
      const address = wallets[0].walletAddress;
      const res = await fetch(`${baseUrl}/v1/wallets/${address}/controls`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ control: "not_a_real_control", enabled: false }),
      });
      assert.equal(res.status, 400);
    });
  });

  test("earnings start at zero and grow after several paid queries", async () => {
    await withServer(10, async (baseUrl, store, server, wallets) => {
      const address = wallets[0].walletAddress;

      const before = await (await fetch(`${baseUrl}/v1/wallets/${address}/earnings`)).json();
      assert.equal(before.withdrawableUsdc, 0);

      // A single $0.02 query split across 10 wallets rounds to $0.00 at 2dp
      // — run enough real paid queries to accumulate a visible balance,
      // same as it would take real query volume in production.
      for (let i = 0; i < 50; i++) {
        await fetch(`${baseUrl}/v1/profiles/query`, {
          method: "POST",
          headers: { "content-type": "application/json", [PAYMENT_HEADER]: "mock:0.02" },
          body: JSON.stringify({}),
        });
      }

      const after = await (await fetch(`${baseUrl}/v1/wallets/${address}/earnings`)).json();
      assert.ok(after.withdrawableUsdc > 0);
    });
  });

  test("withdraw moves withdrawable balance to zero and reports the amount", async () => {
    await withServer(10, async (baseUrl, store, server, wallets) => {
      const address = wallets[0].walletAddress;
      for (let i = 0; i < 50; i++) {
        await fetch(`${baseUrl}/v1/profiles/query`, {
          method: "POST",
          headers: { "content-type": "application/json", [PAYMENT_HEADER]: "mock:0.02" },
          body: JSON.stringify({}),
        });
      }

      const withdrawRes = await fetch(`${baseUrl}/v1/wallets/${address}/withdraw`, { method: "POST" });
      const withdrawBody = await withdrawRes.json();
      assert.equal(withdrawBody.simulated, true);
      assert.ok(withdrawBody.withdrawnUsdc > 0);

      const after = await (await fetch(`${baseUrl}/v1/wallets/${address}/earnings`)).json();
      assert.equal(after.withdrawableUsdc, 0);
    });
  });

  test("earnings/history rejects an invalid range", async () => {
    await withServer(5, async (baseUrl, store, server, wallets) => {
      const address = wallets[0].walletAddress;
      const res = await fetch(`${baseUrl}/v1/wallets/${address}/earnings/history?range=bogus`);
      assert.equal(res.status, 400);
    });
  });

  test("earnings/history returns points for a valid range", async () => {
    await withServer(10, async (baseUrl, store, server, wallets) => {
      const address = wallets[0].walletAddress;
      await fetch(`${baseUrl}/v1/profiles/query`, {
        method: "POST",
        headers: { "content-type": "application/json", [PAYMENT_HEADER]: "mock:0.02" },
        body: JSON.stringify({}),
      });

      const res = await fetch(`${baseUrl}/v1/wallets/${address}/earnings/history?range=7d`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.range, "7d");
      assert.ok(Array.isArray(body.points));
      assert.ok(body.points.length >= 1);
    });
  });

  test("activity breakdown percentages sum to ~100 after some queries", async () => {
    await withServer(10, async (baseUrl, store, server, wallets) => {
      const address = wallets[0].walletAddress;
      for (let i = 0; i < 3; i++) {
        await fetch(`${baseUrl}/v1/profiles/query`, {
          method: "POST",
          headers: { "content-type": "application/json", [PAYMENT_HEADER]: "mock:0.02" },
          body: JSON.stringify({}),
        });
      }

      const res = await fetch(`${baseUrl}/v1/wallets/${address}/activity`);
      const body = await res.json();
      assert.equal(body.recent.length, 3);

      const sum =
        body.breakdown.tradingAgentsPct +
        body.breakdown.researchAgentsPct +
        body.breakdown.analyticsFirmsPct +
        body.breakdown.otherPct;
      assert.ok(Math.abs(sum - 100) < 0.5);
    });
  });
});
