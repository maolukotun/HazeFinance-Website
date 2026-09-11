// SPDX-License-Identifier: MIT
/**
 * Records each paid query so the dashboard's "Recent activity" and "Query
 * breakdown" panels have something real to render. Stored in Postgres
 * when it's configured (see db/client.ts) — same reasoning as store.ts
 * and splitterSimulator.ts: an in-memory array doesn't survive between
 * requests on Vercel's serverless functions. Falls back to the original
 * in-memory array for local dev with no Postgres attached.
 *
 * `buyerType` is derived from the illustrative filter-shape heuristic in
 * classifyBuyer() below, same as before — a production deployment would
 * derive it from actual buyer account metadata instead. Don't mistake
 * classifyBuyer() for a real classification system.
 */

import type { QueryFilters } from "../types";
import { getSql, isDatabaseConfigured } from "../db/client";

export const BUYER_TYPES = ["trading_agent", "research_agent", "analytics_firm", "other"] as const;
export type BuyerType = (typeof BUYER_TYPES)[number];

export interface ActivityEvent {
  timestamp: number;
  buyerType: BuyerType;
  priceUsdc: number;
  includedWallets: string[];
}

// Caps how many of a wallet's past events forWallet() considers. Keeps the
// query (and the "Query breakdown" percentages computed from it) bounded
// once a deployment has real, ongoing query volume; the dashboard itself
// already only ever renders the newest 20 anyway (see the
// /v1/wallets/:address/activity route).
const MAX_EVENTS_PER_WALLET = 500;

export class ActivityLog {
  #usePostgres = isDatabaseConfigured();
  #memEvents: ActivityEvent[] = [];

  async record(includedWallets: string[], priceUsdc: number, filters: QueryFilters): Promise<void> {
    const buyerType = classifyBuyer(filters);

    if (this.#usePostgres) {
      const sql = await getSql();
      await sql`
        INSERT INTO activity_events (buyer_type, price_usdc, included_wallets)
        VALUES (${buyerType}, ${priceUsdc}, ${JSON.stringify(includedWallets)}::jsonb)
      `;
      return;
    }

    this.#memEvents.push({ timestamp: Date.now(), buyerType, priceUsdc, includedWallets });
  }

  /** Newest first. */
  async forWallet(walletAddress: string): Promise<ActivityEvent[]> {
    if (this.#usePostgres) {
      const sql = await getSql();
      const result = await sql`
        SELECT occurred_at, buyer_type, price_usdc, included_wallets
        FROM activity_events
        WHERE included_wallets @> ${JSON.stringify([walletAddress])}::jsonb
        ORDER BY occurred_at DESC
        LIMIT ${MAX_EVENTS_PER_WALLET}
      `;
      return result.rows.map(rowToEvent);
    }

    return this.#memEvents.filter((e) => e.includedWallets.includes(walletAddress)).reverse();
  }

  async all(): Promise<ActivityEvent[]> {
    if (this.#usePostgres) {
      const sql = await getSql();
      const result = await sql`
        SELECT occurred_at, buyer_type, price_usdc, included_wallets
        FROM activity_events ORDER BY occurred_at DESC
      `;
      return result.rows.map(rowToEvent);
    }
    return [...this.#memEvents];
  }
}

function rowToEvent(r: Record<string, unknown>): ActivityEvent {
  return {
    timestamp: new Date(r["occurred_at"] as string).getTime(),
    buyerType: r["buyer_type"] as BuyerType,
    priceUsdc: r["price_usdc"] as number,
    includedWallets: r["included_wallets"] as string[],
  };
}

/**
 * Illustrative-only classification: real buyer typing should come from
 * buyer account metadata (registered API client type / use case), not be
 * guessed from filter shape. Placeholder so "Query breakdown" has
 * something to render.
 */
function classifyBuyer(filters: QueryFilters): BuyerType {
  if (filters.traderType === "day_trader" || filters.requireCrossAssetActivity) return "trading_agent";
  if (filters.riskProfile || filters.assetAllocationStyle) return "research_agent";
  if (filters.minAvgDailyVolumeUsd !== undefined) return "analytics_firm";
  return "other";
}
