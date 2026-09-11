// SPDX-License-Identifier: MIT
/**
 * Turns raw wallet metrics into the behavioral fingerprint dimensions
 * listed in the product brief. Deterministic and pure — same input always
 * produces the same fingerprint, which is what makes this testable
 * without a live indexer.
 *
 * The thresholds below are illustrative, not tuned on real data. Expect to
 * revisit them once real Robinhood Chain activity is flowing through this;
 * treat them as a first cut, not a calibrated model.
 */

import type {
  AssetAllocationStyle,
  BehavioralFingerprint,
  RawWalletMetrics,
  RiskProfile,
  TraderType,
} from "../types";

export function computeFingerprint(raw: RawWalletMetrics): BehavioralFingerprint {
  return {
    traderType: deriveTraderType(raw),
    assetAllocationStyle: deriveAssetAllocationStyle(raw),
    riskProfile: deriveRiskProfile(raw),
    crossAssetBehavior: {
      rotatesStockGainsIntoCrypto: raw.stockToCryptoRotationRate > 0.4,
      rotatesCryptoGainsIntoStock: raw.cryptoToStockRotationRate > 0.4,
      hedgesIntoStablecoinsBeforeEarnings: raw.earningsReactionPattern === "hedges_into_stablecoins",
      usesMorphoForStockCollateralLeverage: raw.morphoBorrowingActive && raw.morphoLeverageRatio > 0,
    },
    defiUsage: {
      uniswapTradesPerMonth: raw.uniswapSwapsPerMonth,
      morphoLendingActive: raw.morphoLendingActive,
      morphoBorrowingActive: raw.morphoBorrowingActive,
      lpPositionsActive: raw.lpPositionsActive,
    },
    equityBehavior: {
      sectorPreferences: raw.sectorPreferences,
      earningsReactionPattern: raw.earningsReactionPattern,
      avgHoldingDurationDays: raw.avgEquityHoldingDurationDays,
    },
    spendingRhythm: {
      avgDailyVolumeUsd: raw.avgDailyVolumeUsd,
      peakHourUtc: raw.peakHourUtc,
      weekdayVsWeekendRatio: raw.weekdayVsWeekendRatio,
    },
    reactivity: {
      avgResponseTimeToMarketMoveMinutes: raw.avgResponseTimeToMarketMoveMinutes,
    },
    walletMaturity: {
      ageInDays: raw.ageInDays,
      totalTransactionCount: raw.totalTransactionCount,
      activityConsistencyScore: raw.activityConsistencyScore,
    },
  };
}

function deriveTraderType(raw: RawWalletMetrics): TraderType {
  const tradesPerMonth = (raw.stockTradeCount + raw.cryptoTradeCount) / Math.max(1, raw.ageInDays / 30);

  if (raw.morphoLendingActive && !raw.morphoBorrowingActive && tradesPerMonth < 5) return "farmer";
  if (tradesPerMonth > 60) return "day_trader";
  if (tradesPerMonth > 10) return "swing_trader";
  if (tradesPerMonth < 2 && raw.avgEquityHoldingDurationDays > 30) return "holder";
  return "passive";
}

function deriveAssetAllocationStyle(raw: RawWalletMetrics): AssetAllocationStyle {
  const total = raw.stockTradeCount + raw.cryptoTradeCount;
  if (total === 0) return "balanced";

  const equityShare = raw.stockTradeCount / total;
  const rotationActivity = Math.max(raw.stockToCryptoRotationRate, raw.cryptoToStockRotationRate);

  if (rotationActivity > 0.5) return "rotational";
  if (equityShare > 0.65) return "equity_heavy";
  if (equityShare < 0.35) return "crypto_heavy";
  return "balanced";
}

function deriveRiskProfile(raw: RawWalletMetrics): RiskProfile {
  if (raw.liquidationCount > 0 || raw.morphoLeverageRatio > 2) return "aggressive";
  if (raw.morphoLeverageRatio > 0 || raw.avgPositionSizeUsd > 5_000) return "moderate";
  return "conservative";
}
