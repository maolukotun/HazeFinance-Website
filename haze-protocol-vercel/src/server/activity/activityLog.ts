// SPDX-License-Identifier: MIT
/**
 * DEV-ONLY activity log. Records each paid query so the dashboard's
 * "Recent activity" and "Query breakdown" panels have something real to
 * render locally. A production deployment would persist this (Postgres,
 * or another durable store) and derive `buyerType` from actual buyer
 * account metadata rather than the illustrative filter-shape heuristic
 * used here — don't mistake `classifyBuyer` for a real classification
 * system.
 */

import type { QueryFilters } from "../types";

export const BUYER_TYPES = ["trading_agent", "research_agent", "analytics_firm", "other"] as const;
export type BuyerType = (typeof BUYER_TYPES)[number];

export interface ActivityEvent {
  timestamp: number;
  buyerType: BuyerType;
  priceUsdc: number;
  includedWallets: string[];
}

export class ActivityLog {
  #events: ActivityEvent[] = [];

  record(includedWallets: string[], priceUsdc: number, filters: QueryFilters): void {
    this.#events.push({
      timestamp: Date.now(),
      buyerType: classifyBuyer(filters),
      priceUsdc,
      includedWallets,
    });
  }

  forWallet(walletAddress: string): ActivityEvent[] {
    return this.#events.filter((e) => e.includedWallets.includes(walletAddress)).reverse(); // newest first
  }

  all(): ActivityEvent[] {
    return [...this.#events];
  }
}

/**
 * Illustrative-only classification: real buyer typing should come from
 * buyer account metadata (registered API client type / use case), not be
 * guessed from filter shape. Placeholder so "Query breakdown" has
 * something to render locally.
 */
function classifyBuyer(filters: QueryFilters): BuyerType {
  if (filters.traderType === "day_trader" || filters.requireCrossAssetActivity) return "trading_agent";
  if (filters.riskProfile || filters.assetAllocationStyle) return "research_agent";
  if (filters.minAvgDailyVolumeUsd !== undefined) return "analytics_firm";
  return "other";
}
