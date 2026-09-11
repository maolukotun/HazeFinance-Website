// SPDX-License-Identifier: MIT
/**
 * Shared shapes and value constants for the Haze off-chain aggregation
 * pipeline. TypeScript port of the original haze-backend's src/types.js —
 * see that project's README for the original design rationale. Dimensions
 * follow the "typical fingerprint" list in the product brief: trader type,
 * asset allocation style, cross-asset behavior, risk profile, DeFi usage
 * patterns, equity behavior, spending rhythm, reactivity, and wallet
 * maturity.
 */

export const TRADER_TYPES = ["day_trader", "swing_trader", "holder", "farmer", "passive"] as const;
export type TraderType = (typeof TRADER_TYPES)[number];

export const ASSET_ALLOCATION_STYLES = ["equity_heavy", "crypto_heavy", "balanced", "rotational"] as const;
export type AssetAllocationStyle = (typeof ASSET_ALLOCATION_STYLES)[number];

export const RISK_PROFILES = ["conservative", "moderate", "aggressive"] as const;
export type RiskProfile = (typeof RISK_PROFILES)[number];

export const EARNINGS_REACTIONS = ["hedges_into_stablecoins", "doubles_down", "no_reaction"] as const;
export type EarningsReaction = (typeof EARNINGS_REACTIONS)[number];

/** The data categories a user can individually opt out of sharing. */
export const DATA_CATEGORIES = [
  "equity_trading",
  "defi_usage",
  "spending_rhythm",
  "reactivity",
  "wallet_maturity",
] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];

export interface CrossAssetBehavior {
  rotatesStockGainsIntoCrypto: boolean;
  rotatesCryptoGainsIntoStock: boolean;
  hedgesIntoStablecoinsBeforeEarnings: boolean;
  usesMorphoForStockCollateralLeverage: boolean;
}

export interface DefiUsage {
  uniswapTradesPerMonth: number;
  morphoLendingActive: boolean;
  morphoBorrowingActive: boolean;
  lpPositionsActive: boolean;
}

export interface EquityBehavior {
  sectorPreferences: string[];
  earningsReactionPattern: EarningsReaction;
  avgHoldingDurationDays: number;
}

export interface SpendingRhythm {
  avgDailyVolumeUsd: number;
  /** 0-23 */
  peakHourUtc: number;
  /** >1 means more active on weekdays */
  weekdayVsWeekendRatio: number;
}

export interface Reactivity {
  avgResponseTimeToMarketMoveMinutes: number;
}

export interface WalletMaturity {
  ageInDays: number;
  totalTransactionCount: number;
  /** 0-1, how consistent activity has been */
  activityConsistencyScore: number;
}

/**
 * The full behavioral fingerprint. Individual sections become `null` when
 * the user has excluded that data category — see privacyLayer.ts.
 */
export interface BehavioralFingerprint {
  traderType: TraderType;
  assetAllocationStyle: AssetAllocationStyle;
  riskProfile: RiskProfile;
  crossAssetBehavior: CrossAssetBehavior;
  defiUsage: DefiUsage | null;
  equityBehavior: EquityBehavior | null;
  spendingRhythm: SpendingRhythm | null;
  reactivity: Reactivity | null;
  walletMaturity: WalletMaturity | null;
}

/**
 * Raw wallet-derived metrics that feed fingerprint computation. Produced
 * either by indexer/syntheticIndexer.ts (fake demo data) or
 * indexer/realIndexer.ts (real Robinhood Chain data, with honest gaps —
 * see that module's doc comment).
 */
export interface RawWalletMetrics {
  walletAddress: string;
  ageInDays: number;
  totalTransactionCount: number;
  stockTradeCount: number;
  cryptoTradeCount: number;
  uniswapSwapsPerMonth: number;
  morphoLendingActive: boolean;
  morphoBorrowingActive: boolean;
  /** 0 = no leverage */
  morphoLeverageRatio: number;
  lpPositionsActive: boolean;
  liquidationCount: number;
  avgPositionSizeUsd: number;
  avgDailyVolumeUsd: number;
  peakHourUtc: number;
  weekdayVsWeekendRatio: number;
  avgResponseTimeToMarketMoveMinutes: number;
  sectorPreferences: string[];
  earningsReactionPattern: EarningsReaction;
  avgEquityHoldingDurationDays: number;
  /** 0-1 */
  stockToCryptoRotationRate: number;
  /** 0-1 */
  cryptoToStockRotationRate: number;
  /** 0-1 */
  activityConsistencyScore: number;
}

/** What buyers actually see. No wallet address, no tx hashes, ever. */
export interface AnonymizedProfile {
  profileId: string;
  fingerprint: BehavioralFingerprint;
}

/**
 * Internal-only record. This shape should never be handed to an API route
 * handler directly — only aggregation/store.ts and registryBridge/* should
 * ever see a wallet address next to a fingerprint.
 */
export interface InternalProfileRecord {
  profileId: string;
  walletAddress: string;
  fingerprint: BehavioralFingerprint;
  /** on-chain payout weight, mirrors ProfileRegistry.profileWeight */
  weight: number;
  excludedCategories: string[];
  /** false for a real, wallet-connect-imported wallet; true for dev seed data */
  synthetic: boolean;
}

export interface QueryFilters {
  traderType?: TraderType;
  assetAllocationStyle?: AssetAllocationStyle;
  riskProfile?: RiskProfile;
  requireCrossAssetActivity?: boolean;
  minAvgDailyVolumeUsd?: number;
}
