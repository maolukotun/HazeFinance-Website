// SPDX-License-Identifier: MIT
import { createServer } from "node:http";
import { makeHealthHandler } from "./routes/health.js";
import { makeQueryProfilesHandler } from "./routes/queryProfiles.js";
import {
  makeGetActivityHandler,
  makeGetEarningsHandler,
  makeGetEarningsHistoryHandler,
  makeGetProfileHandler,
  makePostControlsHandler,
  makePostWithdrawHandler,
} from "./routes/wallets.js";
import { MockPaymentVerifier } from "../payments/x402.js";
import { SplitterSimulator } from "../earnings/splitterSimulator.js";
import { ActivityLog } from "../activity/activityLog.js";

/**
 * @typedef {Object} ServerOptions
 * @property {import("../aggregation/store.js").ProfileStore} store
 * @property {number} priceUsdc
 * @property {string} payToAddress
 * @property {import("../payments/x402.js").PaymentVerifier} verifier
 * @property {string} [corsOrigin] - defaults to "*" (fine for local dev; tighten before deploying anywhere real)
 * @property {import("../earnings/splitterSimulator.js").SplitterSimulator} [splitterSim] - dev-only, created if omitted
 * @property {import("../activity/activityLog.js").ActivityLog} [activityLog] - dev-only, created if omitted
 */

const WALLET_PATH = /^\/v1\/wallets\/([^/]+)\/(profile|controls|earnings|earnings\/history|activity|withdraw)$/;

/**
 * Builds the HTTP server without starting it, so tests can spin up an
 * instance on an ephemeral port and tear it down cleanly.
 *
 * Deliberately built on plain `node:http` rather than Express/Fastify —
 * this project has zero runtime dependencies so it runs anywhere Node
 * runs without an `npm install` first. The manual route matching below is
 * the cost of that choice; swap in a framework once real routing
 * complexity shows up, nothing here fights that decision later.
 *
 * @param {ServerOptions} options
 * @returns {import("node:http").Server}
 */
export function createHazeApiServer(options) {
  const corsOrigin = options.corsOrigin ?? "*";
  const splitterSim = options.splitterSim ?? new SplitterSimulator(options.store);
  const activityLog = options.activityLog ?? new ActivityLog();

  const health = makeHealthHandler(options.store);
  const queryProfiles = makeQueryProfilesHandler(
    options.store,
    { priceUsdc: options.priceUsdc, payToAddress: options.payToAddress, verifier: options.verifier },
    { splitterSim, activityLog },
  );

  const getProfile = makeGetProfileHandler(options.store);
  const postControls = makePostControlsHandler(options.store);
  const getEarnings = makeGetEarningsHandler(options.store, splitterSim);
  const getEarningsHistory = makeGetEarningsHistoryHandler(options.store, splitterSim);
  const getActivity = makeGetActivityHandler(options.store, activityLog);
  const postWithdraw = makePostWithdrawHandler(options.store, splitterSim);

  const server = createServer((req, res) => {
    res.setHeader("access-control-allow-origin", corsOrigin);
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type, x-payment");

    const method = req.method ?? "GET";
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://internal");

    if (method === "GET" && url.pathname === "/health") {
      health(req, res);
      return;
    }

    if (method === "POST" && url.pathname === "/v1/profiles/query") {
      queryProfiles(req, res).catch((err) => internalError(res, err));
      return;
    }

    const walletMatch = url.pathname.match(WALLET_PATH);
    if (walletMatch) {
      const [, address, subpath] = walletMatch;
      try {
        if (method === "GET" && subpath === "profile") return getProfile(req, res, address);
        if (method === "POST" && subpath === "controls") {
          postControls(req, res, address).catch((err) => internalError(res, err));
          return;
        }
        if (method === "GET" && subpath === "earnings") return getEarnings(req, res, address);
        if (method === "GET" && subpath === "earnings/history") {
          return getEarningsHistory(req, res, address, url.searchParams);
        }
        if (method === "GET" && subpath === "activity") return getActivity(req, res, address);
        if (method === "POST" && subpath === "withdraw") return postWithdraw(req, res, address);
      } catch (err) {
        internalError(res, err);
        return;
      }
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  // Exposed for local dev/demo scripts that want to inject revenue
  // directly (see scripts/dev.js) without going through a paid query.
  server.hazeInternals = { splitterSim, activityLog };

  return server;
}

function internalError(res, err) {
  res.writeHead(500, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "internal_error", message: String(err) }));
}

/**
 * Convenience factory for local dev — uses the mock verifier and permissive
 * CORS. NOT for production.
 * @param {import("../aggregation/store.js").ProfileStore} store
 * @param {number} [priceUsdc]
 * @returns {import("node:http").Server}
 */
export function createDevServer(store, priceUsdc = 0.02) {
  return createHazeApiServer({
    store,
    priceUsdc,
    payToAddress: "0xHazeSplitterAddressGoesHere",
    verifier: new MockPaymentVerifier(),
    corsOrigin: "*",
  });
}
