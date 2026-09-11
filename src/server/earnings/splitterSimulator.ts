// SPDX-License-Identifier: MIT
/**
 * DEV-ONLY simulation of the on-chain HazeSplitter contract's economics,
 * so the dashboard has real numbers to render against during local
 * development and demos. In production, wallet earnings must come from
 * reading `claimable()` on the real, deployed HazeSplitter via RPC — see
 * registryBridge/syncWeights.ts for the same "don't guess the ABI, get
 * the real details" pattern used there. This simulator exists purely so
 * the dashboard isn't staring at zeros while that chain integration is
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
 */

import type { ProfileStore } from "../aggregation/store";

export const WALLET_OWNER_BPS = 8000;
export const BPS_DENOMINATOR = 10000;

export class SplitterSimulator {
  #totalReceived = 0;
  #claimed = new Map<string, number>();
  #depositHistory: Array<{ timestamp: number; amountUsdc: number }> = [];
  #store: ProfileStore;

  constructor(store: ProfileStore) {
    this.#store = store;
  }

  /** Simulates Meridian settling x402 query revenue into the pool. */
  deposit(amountUsdc: number): void {
    this.#totalReceived += amountUsdc;
    this.#depositHistory.push({ timestamp: Date.now(), amountUsdc });
  }

  claimable(walletAddress: string): number {
    const snapshot = this.#store.getSyncSnapshot().filter((s) => s.synthetic);
    const totalWeight = snapshot.reduce((sum, s) => sum + s.weight, 0);
    if (totalWeight === 0) return 0;

    const entry = snapshot.find((s) => s.walletAddress === walletAddress);
    if (!entry) return 0; // not found, or found but filtered out for being a real (non-synthetic) wallet

    const pool = (this.#totalReceived * WALLET_OWNER_BPS) / BPS_DENOMINATOR;
    const owed = (pool * entry.weight) / totalWeight;
    const alreadyClaimed = this.#claimed.get(walletAddress) ?? 0;

    return Math.max(0, owed - alreadyClaimed);
  }

  claim(walletAddress: string): number {
    const amount = this.claimable(walletAddress);
    if (amount <= 0) return 0;
    this.#claimed.set(walletAddress, (this.#claimed.get(walletAddress) ?? 0) + amount);
    return amount;
  }

  totalClaimed(walletAddress: string): number {
    return this.#claimed.get(walletAddress) ?? 0;
  }

  depositHistory(): Array<{ timestamp: number; amountUsdc: number }> {
    return [...this.#depositHistory];
  }
}
