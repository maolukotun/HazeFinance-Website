// SPDX-License-Identifier: MIT
/**
 * Simulation of the on-chain HazeSplitter contract's economics, so the
 * dashboard has real numbers to render against before a real chain
 * integration exists. In production, wallet earnings must eventually come
 * from reading `claimable()` on the real, deployed HazeSplitter via RPC —
 * see registryBridge/syncWeights.ts for the same "don't guess the ABI,
 * get the real details" pattern used there. This simulator exists purely
 * so the dashboard isn't staring at zeros while that chain integration is
 * being built; nothing here touches a real chain or moves real money.
 *
 * Mirrors HazeSplitter.sol's math exactly: 80% of every simulated deposit
 * is claimable by wallet owners, pro-rated by their ProfileRegistry
 * weight; 20% is the protocol's share (not modeled further here, since
 * the dashboard is the wallet owner's view, not the protocol treasury's).
 *
 * Only registered SYNTHETIC wallets (store.ts's `synthetic` flag) ever
 * participate in this simulated pool, as both payees and as weight in the
 * denominator. A real, wallet-connect-imported address (synthetic: false)
 * has never generated any actual x402 query revenue — there is no real
 * revenue integration yet at all — so it must not appear to "earn" a
 * share of the demo per-tick deposits just because ProfileStore gives
 * every registered wallet a nonzero base weight. Until real revenue is
 * wired in, a real wallet's honest earnings are $0, not a pro-rated slice
 * of demo money.
 *
 * PERSISTENCE: deposits and claims are stored in Postgres when it's
 * configured (see db/client.ts) — same reasoning as store.ts: Vercel
 * serverless instances don't share memory, so an in-memory deposit
 * history disappears unpredictably between requests. Falls back to the
 * original in-memory arrays for local dev with no Postgres attached.
 */

import type { ProfileStore } from "../aggregation/store";
import { getSql, isDatabaseConfigured } from "../db/client";

export const WALLET_OWNER_BPS = 8000;
export const BPS_DENOMINATOR = 10000;

export class SplitterSimulator {
  #usePostgres = isDatabaseConfigured();
  #store: ProfileStore;

  // In-memory fallback state (local dev only, no Postgres configured).
  #memDepositHistory: Array<{ timestamp: number; amountUsdc: number }> = [];
  #memClaimed = new Map<string, number>();

  constructor(store: ProfileStore) {
    this.#store = store;
  }

  /** Simulates Meridian settling x402 query revenue into the pool. */
  async deposit(amountUsdc: number): Promise<void> {
    if (this.#usePostgres) {
      const sql = await getSql();
      await sql`INSERT INTO splitter_deposits (amount_usdc) VALUES (${amountUsdc})`;
      return;
    }
    this.#memDepositHistory.push({ timestamp: Date.now(), amountUsdc });
  }

  async claimable(walletAddress: string): Promise<number> {
    const snapshot = (await this.#store.getSyncSnapshot()).filter((s) => s.synthetic);
    const totalWeight = snapshot.reduce((sum, s) => sum + s.weight, 0);
    if (totalWeight === 0) return 0;

    const entry = snapshot.find((s) => s.walletAddress === walletAddress);
    if (!entry) return 0; // not found, or found but filtered out for being a real (non-synthetic) wallet

    const totalReceived = await this.#totalReceived();
    const pool = (totalReceived * WALLET_OWNER_BPS) / BPS_DENOMINATOR;
    const owed = (pool * entry.weight) / totalWeight;
    const alreadyClaimed = await this.totalClaimed(walletAddress);

    return Math.max(0, owed - alreadyClaimed);
  }

  async claim(walletAddress: string): Promise<number> {
    const amount = await this.claimable(walletAddress);
    if (amount <= 0) return 0;

    if (this.#usePostgres) {
      const sql = await getSql();
      await sql`
        INSERT INTO splitter_claims (wallet_address, claimed_usdc) VALUES (${walletAddress}, ${amount})
        ON CONFLICT (wallet_address) DO UPDATE SET claimed_usdc = splitter_claims.claimed_usdc + EXCLUDED.claimed_usdc
      `;
      return amount;
    }

    this.#memClaimed.set(walletAddress, (this.#memClaimed.get(walletAddress) ?? 0) + amount);
    return amount;
  }

  async totalClaimed(walletAddress: string): Promise<number> {
    if (this.#usePostgres) {
      const sql = await getSql();
      const result = await sql`SELECT claimed_usdc FROM splitter_claims WHERE wallet_address = ${walletAddress}`;
      return (result.rows[0]?.["claimed_usdc"] as number | undefined) ?? 0;
    }
    return this.#memClaimed.get(walletAddress) ?? 0;
  }

  async depositHistory(): Promise<Array<{ timestamp: number; amountUsdc: number }>> {
    if (this.#usePostgres) {
      const sql = await getSql();
      const result = await sql`SELECT occurred_at, amount_usdc FROM splitter_deposits ORDER BY occurred_at ASC`;
      return result.rows.map((r) => ({
        timestamp: new Date(r["occurred_at"] as string).getTime(),
        amountUsdc: r["amount_usdc"] as number,
      }));
    }
    return [...this.#memDepositHistory];
  }

  async #totalReceived(): Promise<number> {
    if (this.#usePostgres) {
      const sql = await getSql();
      const result = await sql`SELECT COALESCE(SUM(amount_usdc), 0)::float8 AS total FROM splitter_deposits`;
      return (result.rows[0]?.["total"] as number | undefined) ?? 0;
    }
    return this.#memDepositHistory.reduce((sum, d) => sum + d.amountUsdc, 0);
  }
}
