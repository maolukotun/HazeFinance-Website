// SPDX-License-Identifier: MIT
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { enforceX402, MockPaymentVerifier, PAYMENT_HEADER } from "../src/payments/x402.js";

/** @param {(baseUrl: string) => Promise<void>} run */
async function withTestServer(run) {
  const server = createServer(async (req, res) => {
    const gate = await enforceX402(req, res, {
      priceUsdc: 0.02,
      payToAddress: "0xTestSplitter",
      verifier: new MockPaymentVerifier(),
    });
    if (!gate.paid) return;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

describe("x402 gate", () => {
  test("responds 402 with price info when no payment header is present", async () => {
    await withTestServer(async (baseUrl) => {
      const res = await fetch(baseUrl);
      assert.equal(res.status, 402);
      const body = await res.json();
      assert.equal(body.priceUsdc, 0.02);
      assert.equal(body.currency, "USDC");
      assert.equal(body.payTo, "0xTestSplitter");
    });
  });

  test("responds 402 when payment is below the required price", async () => {
    await withTestServer(async (baseUrl) => {
      const res = await fetch(baseUrl, { headers: { [PAYMENT_HEADER]: "mock:0.01" } });
      assert.equal(res.status, 402);
    });
  });

  test("responds 402 on a malformed payment header", async () => {
    await withTestServer(async (baseUrl) => {
      const res = await fetch(baseUrl, { headers: { [PAYMENT_HEADER]: "not-a-real-payment" } });
      assert.equal(res.status, 402);
    });
  });

  test("passes through when payment meets the required price", async () => {
    await withTestServer(async (baseUrl) => {
      const res = await fetch(baseUrl, { headers: { [PAYMENT_HEADER]: "mock:0.02" } });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
    });
  });

  test("passes through when payment exceeds the required price", async () => {
    await withTestServer(async (baseUrl) => {
      const res = await fetch(baseUrl, { headers: { [PAYMENT_HEADER]: "mock:1.00" } });
      assert.equal(res.status, 200);
    });
  });
});
