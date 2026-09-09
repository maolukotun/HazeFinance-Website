// SPDX-License-Identifier: MIT
import { computeFingerprint } from "./fingerprint.js";
import { computeWeight, generateProfileId, toAnonymizedProfile } from "./privacyLayer.js";

/**
 * Minimum number of distinct wallets that must match a query before any
 * result is returned. This is the k-anonymity floor described in the
 * onboarding doc: "No query can return a result traceable to one person.
 * Every answer blends at least k contributors. This is a hard guarantee."
 *
 * Treat any code path that can return profiles without going through
 * queryCohort() as a security bug, not a style nit.
 */
export const K_ANONYMITY_MIN = 5;

/**
 * Holds every registered profile in memory. A real deployment would swap
 * this for Postgres, but the k-anonymity enforcement and privacy
 * boundaries below are the part that has to survive that swap unchanged.
 *
 * Design note on privacy boundary: `queryCohort` is the ONLY public method
 * that returns profile data, and it returns AnonymizedProfile objects (no
 * wallet address field). The two Maps below use real JavaScript private
 * class fields (the `#` prefix) — a standard JS feature, not a TypeScript
 * one — so code outside this class cannot reach in and read
 * `#records`/`#profileIdByWallet` even by accident; it's enforced by the
 * language at runtime, not just by convention. Anything that needs the
 * wallet address — registry syncing, payout — goes through
 * `getSyncSnapshot()`, named deliberately so it's obvious in a code review
 * that it's a privileged accessor, not something an API route should ever
 * call.
 */
export class ProfileStore {
  /** @type {Map<string, import("../types.js").InternalProfileRecord>} */
  #records = new Map();
  /** @type {Map<string, string>} */
  #profileIdByWallet = new Map();

  /**
   * Register a new wallet's profile. Returns the assigned profile id.
   * @param {import("../types.js").RawWalletMetrics} raw
   * @param {string[]} [excludedCategories]
   * @returns {string}
   */
  registerWallet(raw, excludedCategories = []) {
    if (this.#profileIdByWallet.has(raw.walletAddress)) {
      throw new Error(`wallet ${raw.walletAddress} already has a profile`);
    }

    const fingerprint = computeFingerprint(raw);
    const profileId = generateProfileId();

    /** @type {import("../types.js").InternalProfileRecord} */
    const record = {
      profileId,
      walletAddress: raw.walletAddress,
      fingerprint,
      weight: computeWeight(fingerprint),
      excludedCategories,
    };

    this.#records.set(profileId, record);
    this.#profileIdByWallet.set(raw.walletAddress, profileId);

    return profileId;
  }

  /**
   * Recompute a profile from fresh raw metrics. Per the brief, "the
   * fingerprint is recomputed daily as new transactions come in" — this is
   * that recomputation, not a rare edge case.
   * @param {string} walletAddress
   * @param {import("../types.js").RawWalletMetrics} raw
   */
  refreshFromActivity(walletAddress, raw) {
    const profileId = this.#profileIdByWallet.get(walletAddress);
    if (!profileId) throw new Error(`no profile for wallet ${walletAddress}`);

    const existing = this.#records.get(profileId);
    const fingerprint = computeFingerprint(raw);

    existing.fingerprint = fingerprint;
    existing.weight = computeWeight(fingerprint);
  }

  /**
   * @param {string} walletAddress
   * @param {string[]} excludedCategories
   */
  updateExclusions(walletAddress, excludedCategories) {
    const profileId = this.#profileIdByWallet.get(walletAddress);
    if (!profileId) throw new Error(`no profile for wallet ${walletAddress}`);
    this.#records.get(profileId).excludedCategories = excludedCategories;
  }

  /**
   * "Users can delete their profile and all associated data at any time
   * with one tap." This is that delete — it removes the fingerprint and
   * the wallet mapping entirely, immediately, from this store. The caller
   * is responsible for also calling ProfileRegistry.deleteProfile()
   * on-chain (see registryBridge/) so payout weight zeroes out too.
   * @param {string} walletAddress
   */
  deleteProfile(walletAddress) {
    const profileId = this.#profileIdByWallet.get(walletAddress);
    if (!profileId) throw new Error(`no profile for wallet ${walletAddress}`);

    this.#records.delete(profileId);
    this.#profileIdByWallet.delete(walletAddress);
  }

  /**
   * The only method that returns profile data outside this module.
   * Enforces the k-anonymity floor: fewer than minCohortSize distinct
   * matching wallets means refusal, not a smaller-than-usual result.
   *
   * @param {import("../types.js").QueryFilters} filters
   * @param {number} [minCohortSize]
   * @returns {{ok: true, profiles: import("../types.js").AnonymizedProfile[]} | {ok: false, reason: "cohort_too_small", minimumRequired: number}}
   */
  queryCohort(filters, minCohortSize = K_ANONYMITY_MIN) {
    const matches = [...this.#records.values()].filter((r) => matchesFilters(r.fingerprint, filters));

    if (matches.length < minCohortSize) {
      return { ok: false, reason: "cohort_too_small", minimumRequired: minCohortSize };
    }

    return { ok: true, profiles: matches.map(toAnonymizedProfile) };
  }

  /** @returns {number} */
  size() {
    return this.#records.size;
  }

  /**
   * Returns a wallet owner's OWN profile — fingerprint, weight, and which
   * categories they've excluded. Distinct from queryCohort(): this is the
   * owner looking at their own data (fine to show wallet-specific detail,
   * including weight), not a buyer query (which must stay anonymized and
   * k-anonymity-gated). Only call this from a route that has authenticated
   * the caller as the wallet owner in question — this scaffold takes the
   * :address URL param as given, which is NOT authentication; see the
   * README's "what's not wired up" section.
   * @param {string} walletAddress
   * @returns {{fingerprint: import("../types.js").BehavioralFingerprint, weight: number, excludedCategories: string[]} | null}
   */
  getOwnProfile(walletAddress) {
    const profileId = this.#profileIdByWallet.get(walletAddress);
    if (!profileId) return null;
    const record = this.#records.get(profileId);
    return {
      fingerprint: record.fingerprint,
      weight: record.weight,
      excludedCategories: record.excludedCategories,
    };
  }

  /**
   * Privileged accessor for registry syncing / payout only. Deliberately
   * the only place in this class that exposes wallet addresses. Do not
   * call this from an API route handler.
   * @returns {Array<{walletAddress: string, weight: number}>}
   */
  getSyncSnapshot() {
    return [...this.#records.values()].map((r) => ({
      walletAddress: r.walletAddress,
      weight: r.weight,
    }));
  }

  /**
   * Privileged accessor, same category as getSyncSnapshot(): returns
   * which real wallet addresses matched a query. Used ONLY for internal
   * revenue/activity accounting (see earnings/splitterSimulator.js and
   * activity/activityLog.js) immediately after a successful queryCohort()
   * call for the SAME filters — never exposed in an HTTP response body.
   * @param {import("../types.js").QueryFilters} filters
   * @returns {string[]}
   */
  getMatchingWallets(filters) {
    return [...this.#records.values()]
      .filter((r) => matchesFilters(r.fingerprint, filters))
      .map((r) => r.walletAddress);
  }
}

/**
 * @param {import("../types.js").BehavioralFingerprint} fingerprint
 * @param {import("../types.js").QueryFilters} filters
 * @returns {boolean}
 */
function matchesFilters(fingerprint, filters) {
  if (filters.traderType && fingerprint.traderType !== filters.traderType) return false;
  if (filters.assetAllocationStyle && fingerprint.assetAllocationStyle !== filters.assetAllocationStyle) {
    return false;
  }
  if (filters.riskProfile && fingerprint.riskProfile !== filters.riskProfile) return false;

  if (filters.requireCrossAssetActivity) {
    const c = fingerprint.crossAssetBehavior;
    const hasCrossAssetActivity =
      c.rotatesStockGainsIntoCrypto || c.rotatesCryptoGainsIntoStock || c.usesMorphoForStockCollateralLeverage;
    if (!hasCrossAssetActivity) return false;
  }

  if (filters.minAvgDailyVolumeUsd !== undefined) {
    if (!fingerprint.spendingRhythm) return false; // excluded category can't satisfy a volume filter
    if (fingerprint.spendingRhythm.avgDailyVolumeUsd < filters.minAvgDailyVolumeUsd) return false;
  }

  return true;
}
