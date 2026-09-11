// SPDX-License-Identifier: MIT
import { computeFingerprint } from "./fingerprint";
import { computeWeight, generateProfileId, toAnonymizedProfile } from "./privacyLayer";
import type { AnonymizedProfile, BehavioralFingerprint, InternalProfileRecord, QueryFilters, RawWalletMetrics } from "../types";

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

export type QueryCohortResult =
  | { ok: true; profiles: AnonymizedProfile[] }
  | { ok: false; reason: "cohort_too_small"; minimumRequired: number };

export interface OwnProfile {
  fingerprint: BehavioralFingerprint;
  weight: number;
  excludedCategories: string[];
  synthetic: boolean;
}

/**
 * Holds every registered profile **in memory**. A real deployment must
 * swap this for a durable store (Postgres, Vercel KV/Postgres, etc.) — see
 * the top-level README's "Persistence" section. This matters even more
 * here than it did for the original standalone backend: on Vercel, each
 * server route can run in its own function instance, and instances are
 * recycled on their own schedule, so in-memory state is not guaranteed to
 * survive between requests, let alone across a deploy. The
 * k-anonymity enforcement and privacy boundaries below are the part that
 * has to survive that swap unchanged.
 *
 * Design note on privacy boundary: `queryCohort` is the ONLY public method
 * that returns profile data, and it returns AnonymizedProfile objects (no
 * wallet address field). The two Maps below use real JavaScript private
 * class fields (the `#` prefix) so code outside this class cannot reach
 * in and read them even by accident. Anything that needs the wallet
 * address — registry syncing, payout — goes through `getSyncSnapshot()`,
 * named deliberately so it's obvious in a code review that it's a
 * privileged accessor, not something an API route should ever call
 * directly in a response body.
 */
export class ProfileStore {
  #records = new Map<string, InternalProfileRecord>();
  #profileIdByWallet = new Map<string, string>();

  /**
   * Register a new wallet's profile. Returns the assigned profile id.
   *
   * `synthetic` defaults to true because every existing caller other than
   * the real wallet-import route registers fake demo wallets. The wallet
   * import route — the ONLY caller that registers a real,
   * wallet-connect-imported address — passes `{ synthetic: false }`
   * explicitly. This flag is what keeps SplitterSimulator's dev-only fake
   * revenue ticks from paying out to a real wallet that has never
   * actually generated any protocol revenue.
   */
  registerWallet(raw: RawWalletMetrics, excludedCategories: string[] = [], { synthetic = true }: { synthetic?: boolean } = {}): string {
    if (this.#profileIdByWallet.has(raw.walletAddress)) {
      throw new Error(`wallet ${raw.walletAddress} already has a profile`);
    }

    const fingerprint = computeFingerprint(raw);
    const profileId = generateProfileId();

    const record: InternalProfileRecord = {
      profileId,
      walletAddress: raw.walletAddress,
      fingerprint,
      weight: computeWeight(fingerprint),
      excludedCategories,
      synthetic,
    };

    this.#records.set(profileId, record);
    this.#profileIdByWallet.set(raw.walletAddress, profileId);

    return profileId;
  }

  /**
   * Recompute a profile from fresh raw metrics. Per the brief, "the
   * fingerprint is recomputed daily as new transactions come in" — this is
   * that recomputation, not a rare edge case.
   */
  refreshFromActivity(walletAddress: string, raw: RawWalletMetrics): void {
    const profileId = this.#profileIdByWallet.get(walletAddress);
    if (!profileId) throw new Error(`no profile for wallet ${walletAddress}`);

    const existing = this.#records.get(profileId)!;
    const fingerprint = computeFingerprint(raw);

    existing.fingerprint = fingerprint;
    existing.weight = computeWeight(fingerprint);
  }

  updateExclusions(walletAddress: string, excludedCategories: string[]): void {
    const profileId = this.#profileIdByWallet.get(walletAddress);
    if (!profileId) throw new Error(`no profile for wallet ${walletAddress}`);
    this.#records.get(profileId)!.excludedCategories = excludedCategories;
  }

  /**
   * "Users can delete their profile and all associated data at any time
   * with one tap." This is that delete — it removes the fingerprint and
   * the wallet mapping entirely, immediately, from this store. The caller
   * is responsible for also calling ProfileRegistry.deleteProfile()
   * on-chain (see registryBridge/) so payout weight zeroes out too.
   */
  deleteProfile(walletAddress: string): void {
    const profileId = this.#profileIdByWallet.get(walletAddress);
    if (!profileId) throw new Error(`no profile for wallet ${walletAddress}`);

    this.#records.delete(profileId);
    this.#profileIdByWallet.delete(walletAddress);
  }

  /**
   * The only method that returns profile data outside this module.
   * Enforces the k-anonymity floor: fewer than minCohortSize distinct
   * matching wallets means refusal, not a smaller-than-usual result.
   */
  queryCohort(filters: QueryFilters, minCohortSize = K_ANONYMITY_MIN): QueryCohortResult {
    const matches = [...this.#records.values()].filter((r) => matchesFilters(r.fingerprint, filters));

    if (matches.length < minCohortSize) {
      return { ok: false, reason: "cohort_too_small", minimumRequired: minCohortSize };
    }

    return { ok: true, profiles: matches.map(toAnonymizedProfile) };
  }

  size(): number {
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
   * README's "Security" section.
   */
  getOwnProfile(walletAddress: string): OwnProfile | null {
    const profileId = this.#profileIdByWallet.get(walletAddress);
    if (!profileId) return null;
    const record = this.#records.get(profileId)!;
    return {
      fingerprint: record.fingerprint,
      weight: record.weight,
      excludedCategories: record.excludedCategories,
      synthetic: record.synthetic,
    };
  }

  /**
   * Privileged accessor for registry syncing / payout only. Deliberately
   * the only place in this class that exposes wallet addresses. Do not
   * call this from an API route handler's response body.
   */
  getSyncSnapshot(): Array<{ walletAddress: string; weight: number; synthetic: boolean }> {
    return [...this.#records.values()].map((r) => ({
      walletAddress: r.walletAddress,
      weight: r.weight,
      synthetic: r.synthetic,
    }));
  }

  /**
   * Privileged accessor, same category as getSyncSnapshot(): returns
   * which real wallet addresses matched a query. Used ONLY for internal
   * revenue/activity accounting immediately after a successful
   * queryCohort() call for the SAME filters — never exposed in an HTTP
   * response body.
   *
   * Deliberately only ever returns SYNTHETIC (dev seed) wallets — same
   * reasoning as SplitterSimulator excluding real wallets from its payout
   * pool. A real, wallet-connect-imported wallet must never show up in
   * the "Recent queries" activity feed or the query-breakdown stats for a
   * query it has no real earnings from.
   */
  getMatchingWallets(filters: QueryFilters): string[] {
    return [...this.#records.values()]
      .filter((r) => r.synthetic && matchesFilters(r.fingerprint, filters))
      .map((r) => r.walletAddress);
  }
}

function matchesFilters(fingerprint: BehavioralFingerprint, filters: QueryFilters): boolean {
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
