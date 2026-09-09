// SPDX-License-Identifier: MIT
import { CONTROL_TO_CATEGORY } from "../../aggregation/controlsMapping.js";
import { fingerprintBarPercentages, profileStrength } from "../../aggregation/scoring.js";
import { applyExclusions } from "../../aggregation/privacyLayer.js";

/**
 * Wallet-owner-facing routes — everything the dashboard needs that ISN'T
 * the buyer-facing x402 query endpoint. These are NOT x402-gated (the
 * wallet owner isn't paying to see their own data) but they also aren't
 * authenticated: this scaffold trusts the `:address` URL segment as
 * given. Before this goes anywhere near production, add real auth (e.g.
 * a signed-message challenge proving control of the address) — right
 * now anyone can pass any address and read/mutate that "wallet's" data
 * controls in the dev store. See the README.
 */

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

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function notFoundProfile(res, walletAddress) {
  sendJson(res, 404, { error: "no_profile", message: `no profile registered for ${walletAddress}` });
}

/**
 * GET /v1/wallets/:address/profile
 *
 * Shows the fingerprint WITH exclusions already applied — i.e. what the
 * market actually sees, matching the toggle states in the Data Controls
 * panel. (If you want the owner's raw, unredacted fingerprint for some
 * other view, that's store.getOwnProfile().fingerprint directly — this
 * route intentionally does not expose that.)
 *
 * @param {import("../../aggregation/store.js").ProfileStore} store
 */
export function makeGetProfileHandler(store) {
  return function handleGetProfile(req, res, walletAddress) {
    const profile = store.getOwnProfile(walletAddress);
    if (!profile) return notFoundProfile(res, walletAddress);

    const visibleFingerprint = applyExclusions(profile.fingerprint, profile.excludedCategories);

    sendJson(res, 200, {
      walletAddress,
      profileStrength: profileStrength(profile.weight),
      fingerprint: visibleFingerprint,
      fingerprintBars: fingerprintBarPercentages(visibleFingerprint),
      excludedCategories: profile.excludedCategories,
    });
  };
}

/**
 * POST /v1/wallets/:address/controls
 * Body: { control: "trading"|"risk"|"defi"|"equity"|"timing"|"crossasset", enabled: boolean }
 * @param {import("../../aggregation/store.js").ProfileStore} store
 */
export function makePostControlsHandler(store) {
  return async function handlePostControls(req, res, walletAddress) {
    const profile = store.getOwnProfile(walletAddress);
    if (!profile) return notFoundProfile(res, walletAddress);

    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: "invalid_request", message: "body must be valid JSON" });
    }

    const { control, enabled } = body ?? {};
    if (typeof control !== "string" || typeof enabled !== "boolean" || !(control in CONTROL_TO_CATEGORY)) {
      return sendJson(res, 400, {
        error: "invalid_request",
        message: `control must be one of ${Object.keys(CONTROL_TO_CATEGORY).join(", ")}, enabled must be boolean`,
      });
    }

    const category = CONTROL_TO_CATEGORY[control];
    if (category === null) {
      // Honest no-op — see controlsMapping.js for why these three don't
      // have a backing category yet.
      return sendJson(res, 200, {
        applied: false,
        reason: `"${control}" isn't backed by an excludable data category yet — see controlsMapping.js`,
      });
    }

    const current = new Set(profile.excludedCategories);
    if (enabled) current.delete(category); // enabled = sharing ON = not excluded
    else current.add(category);

    store.updateExclusions(walletAddress, [...current]);
    sendJson(res, 200, { applied: true, control, category, enabled });
  };
}

/**
 * GET /v1/wallets/:address/earnings
 * @param {import("../../aggregation/store.js").ProfileStore} store
 * @param {import("../../earnings/splitterSimulator.js").SplitterSimulator} splitterSim
 */
export function makeGetEarningsHandler(store, splitterSim) {
  return function handleGetEarnings(req, res, walletAddress) {
    const profile = store.getOwnProfile(walletAddress);
    if (!profile) return notFoundProfile(res, walletAddress);

    const withdrawable = splitterSim.claimable(walletAddress);
    const totalClaimed = splitterSim.totalClaimed(walletAddress);
    const totalEarned = withdrawable + totalClaimed;

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const history = splitterSim.depositHistory();
    const totalWeight = store.getSyncSnapshot().reduce((s, r) => s + r.weight, 0) || 1;
    const myShare = (profile.weight / totalWeight) * 0.8; // 80% pool, pro-rated

    const sumSince = (msAgo) =>
      history.filter((h) => now - h.timestamp <= msAgo).reduce((s, h) => s + h.amountUsdc * myShare, 0);

    sendJson(res, 200, {
      walletAddress,
      totalEarnedUsdc: round2(totalEarned),
      todayEarnedUsdc: round2(sumSince(dayMs)),
      monthEarnedUsdc: round2(sumSince(30 * dayMs)),
      withdrawableUsdc: round2(withdrawable),
    });
  };
}

/**
 * GET /v1/wallets/:address/earnings/history?range=7d|30d|90d|all
 * @param {import("../../aggregation/store.js").ProfileStore} store
 * @param {import("../../earnings/splitterSimulator.js").SplitterSimulator} splitterSim
 */
export function makeGetEarningsHistoryHandler(store, splitterSim) {
  return function handleGetEarningsHistory(req, res, walletAddress, query) {
    const profile = store.getOwnProfile(walletAddress);
    if (!profile) return notFoundProfile(res, walletAddress);

    const range = query.get("range") ?? "30d";
    const rangeMs = { "7d": 7, "30d": 30, "90d": 90, all: Infinity }[range];
    if (rangeMs === undefined) {
      return sendJson(res, 400, { error: "invalid_request", message: "range must be 7d, 30d, 90d, or all" });
    }

    const now = Date.now();
    const cutoff = rangeMs === Infinity ? 0 : now - rangeMs * 24 * 60 * 60 * 1000;
    const totalWeight = store.getSyncSnapshot().reduce((s, r) => s + r.weight, 0) || 1;
    const myShare = (profile.weight / totalWeight) * 0.8;

    let running = 0;
    const points = splitterSim
      .depositHistory()
      .filter((h) => h.timestamp >= cutoff)
      .map((h) => {
        running += h.amountUsdc * myShare;
        return { timestamp: h.timestamp, cumulativeUsdc: round2(running) };
      });

    sendJson(res, 200, { walletAddress, range, points });
  };
}

/**
 * GET /v1/wallets/:address/activity
 * @param {import("../../aggregation/store.js").ProfileStore} store
 * @param {import("../../activity/activityLog.js").ActivityLog} activityLog
 */
export function makeGetActivityHandler(store, activityLog) {
  return function handleGetActivity(req, res, walletAddress) {
    const profile = store.getOwnProfile(walletAddress);
    if (!profile) return notFoundProfile(res, walletAddress);

    const events = activityLog.forWallet(walletAddress);

    const counts = { trading_agent: 0, research_agent: 0, analytics_firm: 0, other: 0 };
    for (const e of events) counts[e.buyerType]++;
    const total = events.length || 1;

    sendJson(res, 200, {
      walletAddress,
      recent: events.slice(0, 20).map((e) => ({
        timestamp: e.timestamp,
        buyerType: e.buyerType,
        priceUsdc: e.priceUsdc,
      })),
      breakdown: {
        tradingAgentsPct: round1((counts.trading_agent / total) * 100),
        researchAgentsPct: round1((counts.research_agent / total) * 100),
        analyticsFirmsPct: round1((counts.analytics_firm / total) * 100),
        otherPct: round1((counts.other / total) * 100),
      },
    });
  };
}

/**
 * POST /v1/wallets/:address/withdraw
 *
 * DEV SIMULATION ONLY. A real withdrawal is the wallet owner calling
 * HazeSplitter.claim() themselves, signed by their own wallet — that's a
 * client-side transaction (needs a wallet library like viem/wagmi wired
 * into the frontend), not something this backend can or should do on a
 * user's behalf. This endpoint just moves the simulated claimable balance
 * to "claimed" so the dashboard has something to show when the button is
 * clicked locally.
 *
 * @param {import("../../aggregation/store.js").ProfileStore} store
 * @param {import("../../earnings/splitterSimulator.js").SplitterSimulator} splitterSim
 */
export function makePostWithdrawHandler(store, splitterSim) {
  return function handlePostWithdraw(req, res, walletAddress) {
    const profile = store.getOwnProfile(walletAddress);
    if (!profile) return notFoundProfile(res, walletAddress);

    const amount = splitterSim.claim(walletAddress);
    sendJson(res, 200, {
      walletAddress,
      withdrawnUsdc: round2(amount),
      simulated: true,
      note: "Dev simulation only — see the doc comment on makePostWithdrawHandler.",
    });
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
