// SPDX-License-Identifier: MIT
/**
 * Converts internal fingerprint/weight data into the 0-100 display
 * percentages the dashboard's score ring and fingerprint bars use.
 * Purely presentational — none of this feeds back into payout weight or
 * cohort matching (that's computeWeight() in privacyLayer.ts). Scaling
 * here is illustrative, not calibrated against real buyer demand.
 */

import type { BehavioralFingerprint } from "../types";

const MAX_DISPLAY_WEIGHT = 150; // roughly the ceiling computeWeight() reaches today

export function profileStrength(weight: number): number {
  return Math.max(0, Math.min(100, Math.round((weight / MAX_DISPLAY_WEIGHT) * 100)));
}

export interface FingerprintBarPercentages {
  traderType: number;
  assetAllocationStyle: number;
  riskProfile: number;
  defiUsage: number;
  equityBehavior: number;
  crossAssetBehavior: number;
  reactivity: number;
}

/**
 * The three formulas below (defiUsage, equityBehavior, reactivity) all
 * assume SOME real measurement backs the field whenever it's non-null —
 * true for every synthetic seed wallet (syntheticIndexer.ts always
 * invents plausible nonzero values here), false for a real,
 * wallet-connect-imported wallet today: realIndexer.ts unconditionally
 * defaults all three to neutral zero values and reports them in
 * `dataGaps`, because the Uniswap/Morpho/stock-registry addresses these
 * dimensions actually need aren't configured yet (see that module's doc
 * comment) — not because the wallet genuinely measured zero activity
 * there. Without the `synthetic` guard below, an UNMEASURED real wallet
 * would show a 40% DeFi bar, a 50% equity bar, and — worst of all — a
 * 100% reactivity bar (the formula's floor for "no response time data",
 * `avgResponseTimeToMarketMoveMinutes: 0`, is its own MAXIMUM), i.e. the
 * dashboard would show highest confidence in the exact dimension it has
 * zero real signal for. That's a materially misleading "fake data"
 * presentation, not a rounding quirk.
 */
export function fingerprintBarPercentages(
  fingerprint: BehavioralFingerprint,
  { synthetic = true }: { synthetic?: boolean } = {},
): FingerprintBarPercentages {
  return {
    traderType: 100, // core dimension: always present, never excluded
    assetAllocationStyle: 100,
    riskProfile: 100,
    defiUsage:
      synthetic && fingerprint.defiUsage ? Math.min(100, 40 + fingerprint.defiUsage.uniswapTradesPerMonth * 2) : 0,
    equityBehavior:
      synthetic && fingerprint.equityBehavior
        ? Math.min(100, 50 + fingerprint.equityBehavior.sectorPreferences.length * 15)
        : 0,
    // Unlike defiUsage/equityBehavior/reactivity above, crossAssetBehavior
    // isn't a user-excludable category (see privacyLayer.ts's
    // applyExclusions — it's not one of the switch cases), so it's not
    // supposed to ever be null/undefined here. Guarded anyway: a
    // fingerprint arriving with this field missing for any other reason
    // (a stale row shape, a storage-layer bug) should degrade to "no
    // signal" (0), the same way the other three fields already do,
    // instead of crashing the whole request with a TypeError — that
    // crash reached production once already.
    crossAssetBehavior: fingerprint.crossAssetBehavior
      ? [
          fingerprint.crossAssetBehavior.rotatesStockGainsIntoCrypto,
          fingerprint.crossAssetBehavior.rotatesCryptoGainsIntoStock,
          fingerprint.crossAssetBehavior.usesMorphoForStockCollateralLeverage,
        ].filter(Boolean).length * 33
      : 0,
    reactivity:
      synthetic && fingerprint.reactivity
        ? Math.max(10, 100 - fingerprint.reactivity.avgResponseTimeToMarketMoveMinutes / 3)
        : 0,
  };
}
