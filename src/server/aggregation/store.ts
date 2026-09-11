// SPDX-License-Identifier: MIT
import { computeFingerprint } from "./fingerprint";
import { applyExclusions, computeWeight, generateProfileId } from "./privacyLayer";
import { getSql, isDatabaseConfigured } from "../db/client";
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

/**
 * Defensive decoder for the two JSONB columns on wallet_profiles
 * (fingerprint, excluded_categories). postgres.js is supposed to
 * auto-decode json/jsonb columns into real objects/arrays based on the
 * column's Postgres type, so this SHOULD always hit the `return value`
 * branch below — but it's cheap insurance, and it's exactly the kind of
 * gap that turned into a real production crash: the first real (not
 * synthetic-seeded) wallet import to actually reach this code path after
 * the postgres.js migration hit `TypeError: Cannot read properties of
 * undefined (reading 'rotatesStockGainsIntoCrypto')` in
 * fingerprintBarPercentages(), which only makes sense if the fingerprint
 * that came back out of Postgres wasn't the parsed object it should have
 * been. Handling a raw JSON string here — in addition to an
 * already-parsed value — closes that gap regardless of which layer
 * turned out to be responsible for it.
 */
function parseJsonbColumn<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value == null ? fallback : (value as T);
}

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
 * Holds every registered profile. Every method is async because the
 * PRODUCTION path (see src/server/db/client.ts) is backed by Postgres —
 * required on Vercel, where each server route can run in its own function
 * instance and instances are recycled on their own schedule, so plain
 * in-memory state is not guaranteed to survive between requests, let
 * alone across a deploy. This was a real, reproduced bug, not a
 * theoretical one: importing a wallet on tryhazefi.com and immediately
 * reading its profile back 404'd every time, because the import and the
 * read landed on different instances that each had their own empty copy
 * of what used to be a plain in-memory Map.
 *
 * DEV FALLBACK: with no Postgres connection string configured (the
 * common case for `npm run dev` with no Vercel Storage integration
 * attached), this class transparently falls back to the original
 * in-memory Maps — same behavior as before, zero setup required. See
 * isDatabaseConfigured() in db/client.ts for exactly what flips this on.
 *
 * Design note on privacy boundary: `queryCohort` is the ONLY public method
 * that returns profile data, and it returns AnonymizedProfile objects (no
 * wallet address field). The in-memory fallback's two Maps use real
 * JavaScript private class fields (the `#` prefix) so code outside this
 * class cannot reach in and read them even by accident. Anything that
 * needs the wallet address — registry syncing, payout — goes through
 * `getSyncSnapshot()`, named deliberately so it's obvious in a code review
 * that it's a privileged accessor, not something an API route should ever
 * call directly in a response body.
 */
export class ProfileStore {
  #usePostgres = isDatabaseConfigured();
  #memRecords = new Map<string, InternalProfileRecord>();
  #memProfileIdByWallet = new Map<string, string>();

  /**
   * Register a new wallet's profile. Returns the assigned profile id.
   * Throws if the wallet is already registered — callers (the real
   * wallet-import route) are expected to check getOwnProfile() first and
   * call refreshFromActivity() instead if it already exists.
   *
   * `synthetic` defaults to true because every existing caller other than
   * the real wallet-import route registers fake demo wallets. The wallet
   * import route — the ONLY caller that registers a real,
   * wallet-connect-imported address — passes `{ synthetic: false }`
   * explicitly. This flag is what keeps SplitterSimulator's dev-only fake
   * revenue ticks from paying out to a real wallet that has never
   * actually generated any protocol revenue.
   */
  async registerWallet(
    raw: RawWalletMetrics,
    excludedCategories: string[] = [],
    { synthetic = true }: { synthetic?: boolean } = {},
  ): Promise<string> {
    const fingerprint = computeFingerprint(raw);
    const profileId = generateProfileId();
    const weight = computeWeight(fingerprint);

    if (this.#usePostgres) {
      const sql = await getSql();
      const existing = await sql`SELECT 1 FROM wallet_profiles WHERE wallet_address = ${raw.walletAddress}`;
      if (existing.rows.length > 0) {
        throw new Error(`wallet ${raw.walletAddress} already has a profile`);
      }
      await sql`
        INSERT INTO wallet_profiles (wallet_address, profile_id, fingerprint, weight, excluded_categories, synthetic)
        VALUES (${raw.walletAddress}, ${profileId}, ${JSON.stringify(fingerprint)}::jsonb, ${weight}, ${JSON.stringify(excludedCategories)}::jsonb, ${synthetic})
      `;
      return profileId;
    }

    if (this.#memProfileIdByWallet.has(raw.walletAddress)) {
      throw new Error(`wallet ${raw.walletAddress} already has a profile`);
    }
    const record: InternalProfileRecord = {
      profileId,
      walletAddress: raw.walletAddress,
      fingerprint,
      weight,
      excludedCategories,
      synthetic,
    };
    this.#memRecords.set(profileId, record);
    this.#memProfileIdByWallet.set(raw.walletAddress, profileId);
    return profileId;
  }

  /**
   * Seeds a synthetic demo wallet WITHOUT throwing if it's already
   * registered — used only by singletons.ts's startup seeding loop.
   * Synthetic wallet addresses are deterministic (same seed every
   * process — see indexer/syntheticIndexer.ts), so with Postgres
   * attached, re-seeding on every cold start must be a no-op past the
   * first time, not a crash. Returns true if a new row was actually
   * inserted.
   */
  async seedSyntheticWallet(raw: RawWalletMetrics): Promise<boolean> {
    const fingerprint = computeFingerprint(raw);
    const weight = computeWeight(fingerprint);

    if (this.#usePostgres) {
      const sql = await getSql();
      const profileId = generateProfileId();
      const result = await sql`
        INSERT INTO wallet_profiles (wallet_address, profile_id, fingerprint, weight, excluded_categories, synthetic)
        VALUES (${raw.walletAddress}, ${profileId}, ${JSON.stringify(fingerprint)}::jsonb, ${weight}, '[]'::jsonb, true)
        ON CONFLICT (wallet_address) DO NOTHING
      `;
      return (result.rowCount ?? 0) > 0;
    }

    if (this.#memProfileIdByWallet.has(raw.walletAddress)) return false;
    const profileId = generateProfileId();
    this.#memRecords.set(profileId, {
      profileId,
      walletAddress: raw.walletAddress,
      fingerprint,
      weight,
      excludedCategories: [],
      synthetic: true,
    });
    this.#memProfileIdByWallet.set(raw.walletAddress, profileId);
    return true;
  }

  /**
   * Recompute a profile from fresh raw metrics. Per the brief, "the
   * fingerprint is recomputed daily as new transactions come in" — this is
   * that recomputation, not a rare edge case.
   */
  async refreshFromActivity(walletAddress: string, raw: RawWalletMetrics): Promise<void> {
    const fingerprint = computeFingerprint(raw);
    const weight = computeWeight(fingerprint);

    if (this.#usePostgres) {
      const sql = await getSql();
      const result = await sql`
        UPDATE wallet_profiles
        SET fingerprint = ${JSON.stringify(fingerprint)}::jsonb, weight = ${weight}, updated_at = now()
        WHERE wallet_address = ${walletAddress}
      `;
      if ((result.rowCount ?? 0) === 0) throw new Error(`no profile for wallet ${walletAddress}`);
      return;
    }

    const profileId = this.#memProfileIdByWallet.get(walletAddress);
    if (!profileId) throw new Error(`no profile for wallet ${walletAddress}`);
    const existing = this.#memRecords.get(profileId)!;
    existing.fingerprint = fingerprint;
    existing.weight = weight;
  }

  async updateExclusions(walletAddress: string, excludedCategories: string[]): Promise<void> {
    if (this.#usePostgres) {
      const sql = await getSql();
      const result = await sql`
        UPDATE wallet_profiles SET excluded_categories = ${JSON.stringify(excludedCategories)}::jsonb, updated_at = now()
        WHERE wallet_address = ${walletAddress}
      `;
      if ((result.rowCount ?? 0) === 0) throw new Error(`no profile for wallet ${walletAddress}`);
      return;
    }

    const profileId = this.#memProfileIdByWallet.get(walletAddress);
    if (!profileId) throw new Error(`no profile for wallet ${walletAddress}`);
    this.#memRecords.get(profileId)!.excludedCategories = excludedCategories;
  }

  /**
   * "Users can delete their profile and all associated data at any time
   * with one tap." This is that delete — it removes the fingerprint and
   * the wallet mapping entirely, immediately, from this store (plus any
   * splitter-claim bookkeeping, on the Postgres path). The caller is
   * responsible for also calling ProfileRegistry.deleteProfile() on-chain
   * (see registryBridge/) so payout weight zeroes out too.
   */
  async deleteProfile(walletAddress: string): Promise<void> {
    if (this.#usePostgres) {
      const sql = await getSql();
      const result = await sql`DELETE FROM wallet_profiles WHERE wallet_address = ${walletAddress}`;
      if ((result.rowCount ?? 0) === 0) throw new Error(`no profile for wallet ${walletAddress}`);
      await sql`DELETE FROM splitter_claims WHERE wallet_address = ${walletAddress}`;
      return;
    }

    const profileId = this.#memProfileIdByWallet.get(walletAddress);
    if (!profileId) throw new Error(`no profile for wallet ${walletAddress}`);
    this.#memRecords.delete(profileId);
    this.#memProfileIdByWallet.delete(walletAddress);
  }

  /**
   * The only method that returns profile data outside this module.
   * Enforces the k-anonymity floor: fewer than minCohortSize distinct
   * matching wallets means refusal, not a smaller-than-usual result.
   *
   * Filtering happens in application code (matchesFilters below) rather
   * than as a translated SQL WHERE clause even on the Postgres path — the
   * match logic touches nested/nullable fingerprint fields, and keeping
   * one code path for it means the two backends can never silently
   * disagree on what "matches" means. Fine at this project's scale (a
   * demo scaffold's wallet count, not billions of rows).
   */
  async queryCohort(filters: QueryFilters, minCohortSize = K_ANONYMITY_MIN): Promise<QueryCohortResult> {
    const records = await this.#allRecords();
    const matches = records.filter((r) => matchesFilters(r.fingerprint, filters));

    if (matches.length < minCohortSize) {
      return { ok: false, reason: "cohort_too_small", minimumRequired: minCohortSize };
    }

    // Same field list toAnonymizedProfile() in privacyLayer.ts strips down
    // to — replicated inline here (rather than importing that helper)
    // because it's typed to take a full InternalProfileRecord, and the row
    // shape #allRecords() returns deliberately carries only what this
    // method and getMatchingWallets() actually need, not a wallet's weight
    // (registry/payout data has no business being anywhere near a
    // buyer-facing query result). Treat this field list as the same
    // privacy boundary toAnonymizedProfile() documents.
    return {
      ok: true,
      profiles: matches.map((r) => ({
        profileId: r.profileId,
        fingerprint: applyExclusions(r.fingerprint, r.excludedCategories),
      })),
    };
  }

  async size(): Promise<number> {
    if (this.#usePostgres) {
      const sql = await getSql();
      const result = await sql`SELECT COUNT(*)::int AS count FROM wallet_profiles`;
      return (result.rows[0]?.["count"] as number | undefined) ?? 0;
    }
    return this.#memRecords.size;
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
  async getOwnProfile(walletAddress: string): Promise<OwnProfile | null> {
    if (this.#usePostgres) {
      const sql = await getSql();
      const result = await sql`
        SELECT fingerprint, weight, excluded_categories, synthetic
        FROM wallet_profiles WHERE wallet_address = ${walletAddress}
      `;
      const row = result.rows[0];
      if (!row) return null;
      return {
        fingerprint: parseJsonbColumn<BehavioralFingerprint>(row["fingerprint"], {} as BehavioralFingerprint),
        weight: row["weight"] as number,
        excludedCategories: parseJsonbColumn<string[]>(row["excluded_categories"], []),
        synthetic: row["synthetic"] as boolean,
      };
    }

    const profileId = this.#memProfileIdByWallet.get(walletAddress);
    if (!profileId) return null;
    const record = this.#memRecords.get(profileId)!;
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
  async getSyncSnapshot(): Promise<Array<{ walletAddress: string; weight: number; synthetic: boolean }>> {
    if (this.#usePostgres) {
      const sql = await getSql();
      const result = await sql`SELECT wallet_address, weight, synthetic FROM wallet_profiles`;
      return result.rows.map((r) => ({
        walletAddress: r["wallet_address"] as string,
        weight: r["weight"] as number,
        synthetic: r["synthetic"] as boolean,
      }));
    }
    return [...this.#memRecords.values()].map((r) => ({
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
  async getMatchingWallets(filters: QueryFilters): Promise<string[]> {
    const records = await this.#allRecords({ syntheticOnly: true });
    return records.filter((r) => matchesFilters(r.fingerprint, filters)).map((r) => r.walletAddress);
  }

  async #allRecords(opts: { syntheticOnly?: boolean } = {}): Promise<
    Array<{ walletAddress: string; profileId: string; fingerprint: BehavioralFingerprint; excludedCategories: string[] }>
  > {
    if (this.#usePostgres) {
      const sql = await getSql();
      const result = opts.syntheticOnly
        ? await sql`SELECT wallet_address, profile_id, fingerprint, excluded_categories FROM wallet_profiles WHERE synthetic = true`
        : await sql`SELECT wallet_address, profile_id, fingerprint, excluded_categories FROM wallet_profiles`;
      return result.rows.map((r) => ({
        walletAddress: r["wallet_address"] as string,
        profileId: r["profile_id"] as string,
        fingerprint: parseJsonbColumn<BehavioralFingerprint>(r["fingerprint"], {} as BehavioralFingerprint),
        excludedCategories: parseJsonbColumn<string[]>(r["excluded_categories"], []),
      }));
    }
    const all = [...this.#memRecords.values()];
    return (opts.syntheticOnly ? all.filter((r) => r.synthetic) : all).map((r) => ({
      walletAddress: r.walletAddress,
      profileId: r.profileId,
      fingerprint: r.fingerprint,
      excludedCategories: r.excludedCategories,
    }));
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
    // Same defensive guard as scoring.ts's fingerprintBarPercentages — see
    // its comment. Treat a missing crossAssetBehavior as "no signal"
    // rather than crashing the whole query.
    const hasCrossAssetActivity = Boolean(
      c && (c.rotatesStockGainsIntoCrypto || c.rotatesCryptoGainsIntoStock || c.usesMorphoForStockCollateralLeverage),
    );
    if (!hasCrossAssetActivity) return false;
  }

  if (filters.minAvgDailyVolumeUsd !== undefined) {
    if (!fingerprint.spendingRhythm) return false; // excluded category can't satisfy a volume filter
    if (fingerprint.spendingRhythm.avgDailyVolumeUsd < filters.minAvgDailyVolumeUsd) return false;
  }

  return true;
}
