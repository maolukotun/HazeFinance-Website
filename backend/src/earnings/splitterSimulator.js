// SPDX-License-Identifier: MIT

/**
 * DEV-ONLY simulation of the on-chain HazeSplitter contract's economics,
 * so the dashboard has real numbers to render against during local
 * development. In production, wallet earnings must come from reading
 * `claimable()` on the real, deployed HazeSplitter via RPC — see
 * registryBridge/syncWeights.js for the same "don't guess the ABI, get
 * the real details" pattern used there. This simulator exists purely so
 * the dashboard isn't staring at zeros while that chain integration is
 * being built; nothing here touches a real chain or moves real money.
 *
 * Mirrors HazeSplitter.sol's math exactly: 80% of every simulated deposit
 * is claimable by wallet owners, pro-rated by their ProfileRegistry
 * weight; 20% is the protocol's share (not modeled further here, since
 * the dashboard is the wallet owner's view, not the protocol treasury's).
 */

export const WALLET_OWNER_BPS = 8000;
export const BPS_DENOMINATOR = 10000;

export class SplitterSimulator {
  #totalReceived = 0;
  /** @type {Map<string, number>} walletAddress -> USDC already claimed */
  #claimed = new Map();
  /** @type {Array<{timestamp: number, amountUsdc: number}>} */
  #depositHistory = [];

  /** @param {import("../aggregation/store.js").ProfileStore} store */
  constructor(store) {
    this.store = store;
  }

  /** Simulates Meridian settling x402 query revenue into the pool. */
  deposit(amountUsdc) {
    this.#totalReceived += amountUsdc;
    this.#depositHistory.push({ timestamp: Date.now(), amountUsdc });
  }

  /** @param {string} walletAddress */
  claimable(walletAddress) {
    const snapshot = this.store.getSyncSnapshot();
    const totalWeight = snapshot.reduce((sum, s) => sum + s.weight, 0);
    if (totalWeight === 0) return 0;

    const entry = snapshot.find((s) => s.walletAddress === walletAddress);
    if (!entry) return 0;

    const pool = (this.#totalReceived * WALLET_OWNER_BPS) / BPS_DENOMINATOR;
    const owed = (pool * entry.weight) / totalWeight;
    const alreadyClaimed = this.#claimed.get(walletAddress) ?? 0;

    return Math.max(0, owed - alreadyClaimed);
  }

  /** @param {string} walletAddress */
  claim(walletAddress) {
    const amount = this.claimable(walletAddress);
    if (amount <= 0) return 0;
    this.#claimed.set(walletAddress, (this.#claimed.get(walletAddress) ?? 0) + amount);
    return amount;
  }

  /** @param {string} walletAddress */
  totalClaimed(walletAddress) {
    return this.#claimed.get(walletAddress) ?? 0;
  }

  /** @returns {Array<{timestamp: number, amountUsdc: number}>} */
  depositHistory() {
    return [...this.#depositHistory];
  }
}
