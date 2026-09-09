// SPDX-License-Identifier: MIT

/**
 * Converts internal fingerprint/weight data into the 0-100 display
 * percentages the dashboard's score ring and fingerprint bars use.
 * Purely presentational — none of this feeds back into payout weight or
 * cohort matching (that's computeWeight() in privacyLayer.js). Scaling
 * here is illustrative, not calibrated against real buyer demand.
 */

const MAX_DISPLAY_WEIGHT = 150; // roughly the ceiling computeWeight() reaches today

/** @param {number} weight */
export function profileStrength(weight) {
  return Math.max(0, Math.min(100, Math.round((weight / MAX_DISPLAY_WEIGHT) * 100)));
}

/**
 * @param {import("../types.js").BehavioralFingerprint} fingerprint
 */
export function fingerprintBarPercentages(fingerprint) {
  return {
    traderType: 100, // core dimension: always present, never excluded
    assetAllocationStyle: 100,
    riskProfile: 100,
    defiUsage: fingerprint.defiUsage
      ? Math.min(100, 40 + fingerprint.defiUsage.uniswapTradesPerMonth * 2)
      : 0,
    equityBehavior: fingerprint.equityBehavior
      ? Math.min(100, 50 + fingerprint.equityBehavior.sectorPreferences.length * 15)
      : 0,
    crossAssetBehavior:
      [
        fingerprint.crossAssetBehavior.rotatesStockGainsIntoCrypto,
        fingerprint.crossAssetBehavior.rotatesCryptoGainsIntoStock,
        fingerprint.crossAssetBehavior.usesMorphoForStockCollateralLeverage,
      ].filter(Boolean).length * 33,
    reactivity: fingerprint.reactivity
      ? Math.max(10, 100 - fingerprint.reactivity.avgResponseTimeToMarketMoveMinutes / 3)
      : 0,
  };
}
