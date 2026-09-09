// SPDX-License-Identifier: MIT
import { enforceX402 } from "../../payments/x402.js";

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const ALLOWED_FILTER_KEYS = [
  "traderType",
  "assetAllocationStyle",
  "riskProfile",
  "requireCrossAssetActivity",
  "minAvgDailyVolumeUsd",
];

/** @param {unknown} body */
function isValidFilters(body) {
  if (typeof body !== "object" || body === null) return false;
  return Object.keys(body).every((k) => ALLOWED_FILTER_KEYS.includes(k));
}

/**
 * POST /v1/profiles/query
 *
 * x402-gated per the brief: "No API key, no subscription, no account
 * creation required for the buyer. Pure x402 pay-per-query." Body is a
 * QueryFilters JSON object; response is either a cohort of anonymized
 * profiles or a 422 refusal if the cohort is below the k-anonymity floor.
 *
 * @param {import("../../aggregation/store.js").ProfileStore} store
 * @param {{priceUsdc: number, payToAddress: string, verifier: import("../../payments/x402.js").PaymentVerifier}} x402
 * @param {{splitterSim?: import("../../earnings/splitterSimulator.js").SplitterSimulator, activityLog?: import("../../activity/activityLog.js").ActivityLog}} [dev]
 *   Optional dev-only hooks: when provided, a successful paid query also
 *   deposits its price into the local SplitterSimulator and records an
 *   ActivityLog entry, so the dashboard's earnings/activity panels have
 *   something real to show. Neither is required for the endpoint's core
 *   behavior — omit both and this route works exactly as before.
 */
export function makeQueryProfilesHandler(store, x402, dev = {}) {
  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  return async function handleQueryProfiles(req, res) {
    const gate = await enforceX402(req, res, x402);
    if (!gate.paid) return; // enforceX402 already wrote the 402 response

    let filters;
    try {
      const body = await readBody(req);
      const parsed = body.length > 0 ? JSON.parse(body) : {};
      if (!isValidFilters(parsed)) throw new Error("invalid filter keys");
      filters = parsed;
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_request", message: "body must be a valid QueryFilters JSON object" }));
      return;
    }

    const result = store.queryCohort(filters);

    if (!result.ok) {
      // Deliberately does not reveal how many profiles DID match — only
      // that it was below the floor. Revealing the near-miss count is a
      // classic way to erode k-anonymity through repeated querying.
      res.writeHead(422, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: "cohort_too_small",
          message: `fewer than the required minimum of ${result.minimumRequired} profiles match this query`,
        }),
      );
      return;
    }

    // Dev-only bookkeeping: record revenue + activity against the wallets
    // that matched. Uses the privileged getMatchingWallets() accessor —
    // note this never touches the response body, which still only ever
    // contains result.profiles (anonymized).
    if (dev.splitterSim || dev.activityLog) {
      const matchingWallets = store.getMatchingWallets(filters);
      dev.splitterSim?.deposit(x402.priceUsdc);
      dev.activityLog?.record(matchingWallets, x402.priceUsdc, filters);
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ profiles: result.profiles }));
  };
}
