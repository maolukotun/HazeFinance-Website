// SPDX-License-Identifier: MIT

/**
 * DEV-ONLY activity log. Records each paid query so the dashboard's
 * "Recent activity" and "Query breakdown" panels have something real to
 * render locally. A production deployment would persist this (Postgres)
 * and derive `buyerType` from actual buyer account metadata rather than
 * the illustrative filter-shape heuristic used here — don't mistake
 * `classifyBuyer` for a real classification system.
 */

export const BUYER_TYPES = ["trading_agent", "research_agent", "analytics_firm", "other"];

export class ActivityLog {
  /** @type {Array<{timestamp: number, buyerType: string, priceUsdc: number, includedWallets: string[]}>} */
  #events = [];

  /**
   * @param {string[]} includedWallets
   * @param {number} priceUsdc
   * @param {import("../types.js").QueryFilters} filters
   */
  record(includedWallets, priceUsdc, filters) {
    this.#events.push({
      timestamp: Date.now(),
      buyerType: classifyBuyer(filters),
      priceUsdc,
      includedWallets,
    });
  }

  /** @param {string} walletAddress */
  forWallet(walletAddress) {
    return this.#events.filter((e) => e.includedWallets.includes(walletAddress)).reverse(); // newest first
  }

  all() {
    return [...this.#events];
  }
}

/**
 * Illustrative-only classification: real buyer typing should come from
 * buyer account metadata (registered API client type / use case), not be
 * guessed from filter shape. Placeholder so "Query breakdown" has
 * something to render locally.
 * @param {import("../types.js").QueryFilters} filters
 */
function classifyBuyer(filters) {
  if (filters.traderType === "day_trader" || filters.requireCrossAssetActivity) return "trading_agent";
  if (filters.riskProfile || filters.assetAllocationStyle) return "research_agent";
  if (filters.minAvgDailyVolumeUsd !== undefined) return "analytics_firm";
  return "other";
}
