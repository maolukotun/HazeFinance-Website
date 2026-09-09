// SPDX-License-Identifier: MIT
import { randomUUID } from "node:crypto";

/**
 * Applies the user's data-category opt-outs. Per the brief: "The user
 * controls exactly what data categories are included. They can exclude
 * stock trading data, specific protocols, time periods, or behavioral
 * dimensions." This nulls out excluded sections rather than fabricating
 * placeholder values, so a buyer can tell a category was withheld (not
 * that it happens to be empty).
 *
 * @param {import("../types.js").BehavioralFingerprint} fingerprint
 * @param {string[]} excluded
 * @returns {import("../types.js").BehavioralFingerprint}
 */
export function applyExclusions(fingerprint, excluded) {
  const result = { ...fingerprint };

  for (const category of excluded) {
    switch (category) {
      case "equity_trading":
        result.equityBehavior = null;
        break;
      case "defi_usage":
        result.defiUsage = null;
        break;
      case "spending_rhythm":
        result.spendingRhythm = null;
        break;
      case "reactivity":
        result.reactivity = null;
        break;
      case "wallet_maturity":
        result.walletMaturity = null;
        break;
    }
  }

  return result;
}

/**
 * Strips everything except the random profile id and the (possibly
 * category-redacted) fingerprint. This is the only function that should
 * ever produce something handed to a buyer-facing API response — unlike
 * TypeScript, plain JS can't make it *impossible* to add a wallet address
 * field back in by accident, so treat this function's field list as the
 * actual privacy boundary and review changes to it carefully.
 *
 * @param {import("../types.js").InternalProfileRecord} record
 * @returns {import("../types.js").AnonymizedProfile}
 */
export function toAnonymizedProfile(record) {
  return {
    profileId: record.profileId,
    fingerprint: applyExclusions(record.fingerprint, record.excludedCategories),
  };
}

/** @returns {string} */
export function generateProfileId() {
  return `haze_${randomUUID()}`;
}

/**
 * Off-chain scoring heuristic that produces the same number that gets
 * written to ProfileRegistry.profileWeight on-chain. Illustrative, not
 * tuned: rewards wallet maturity, activity volume, and consistency, since
 * those are the dimensions that make a profile more valuable to buyers
 * (a fingerprint built on 900 days of consistent activity says more than
 * one built on 30 days of noise).
 *
 * Kept deliberately simple and pure so it's easy to reason about and to
 * swap out once there's real query-demand data to calibrate against.
 *
 * @param {import("../types.js").BehavioralFingerprint} fingerprint
 * @returns {number}
 */
export function computeWeight(fingerprint) {
  let weight = 10; // base weight so every registered profile earns something

  if (fingerprint.walletMaturity) {
    weight += Math.min(50, fingerprint.walletMaturity.ageInDays / 20);
    weight += Math.min(30, fingerprint.walletMaturity.totalTransactionCount / 20);
    weight += fingerprint.walletMaturity.activityConsistencyScore * 20;
  }

  if (fingerprint.spendingRhythm) {
    weight += Math.min(40, fingerprint.spendingRhythm.avgDailyVolumeUsd / 100);
  }

  // Cross-asset activity is the brief's stated differentiator — profiles
  // that actually show it are worth more, so weight reflects that.
  const crossAssetSignals = [
    fingerprint.crossAssetBehavior.rotatesStockGainsIntoCrypto,
    fingerprint.crossAssetBehavior.rotatesCryptoGainsIntoStock,
    fingerprint.crossAssetBehavior.usesMorphoForStockCollateralLeverage,
  ].filter(Boolean).length;
  weight += crossAssetSignals * 15;

  return Math.round(weight);
}
