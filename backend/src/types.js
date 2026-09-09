// SPDX-License-Identifier: MIT
/**
 * Shared shapes and value constants for the Haze off-chain backend.
 *
 * This is the vanilla-JS equivalent of what used to be TypeScript's type
 * system. Two things replace it:
 *
 *   1. Where the TS version had a union type (e.g. `TraderType = "day_trader"
 *      | "swing_trader" | ...`), this file exports the actual array of
 *      allowed values instead, e.g. `TRADER_TYPES`. TypeScript checked
 *      these at compile time; here they're just plain data you can use at
 *      runtime (e.g. to validate input, or loop over in a test).
 *   2. Where the TS version had an `interface` describing an object's
 *      shape (e.g. `RawWalletMetrics`), this file documents the same shape
 *      as a `@typedef` JSDoc comment. Nothing enforces it at runtime —
 *      that's the actual trade-off of dropping TypeScript — but editors
 *      like VS Code still read JSDoc typedefs and will show you the shape
 *      on hover/autocomplete, and it's here for humans reading the code.
 *
 * Dimensions follow the "typical fingerprint" list in the product brief:
 * trader type, asset allocation style, cross-asset behavior, risk profile,
 * DeFi usage patterns, equity behavior, spending rhythm, reactivity, and
 * wallet maturity.
 */

export const TRADER_TYPES = ["day_trader", "swing_trader", "holder", "farmer", "passive"];

export const ASSET_ALLOCATION_STYLES = ["equity_heavy", "crypto_heavy", "balanced", "rotational"];

export const RISK_PROFILES = ["conservative", "moderate", "aggressive"];

export const EARNINGS_REACTIONS = ["hedges_into_stablecoins", "doubles_down", "no_reaction"];

/** The data categories a user can individually opt out of sharing. */
export const DATA_CATEGORIES = [
  "equity_trading",
  "defi_usage",
  "spending_rhythm",
  "reactivity",
  "wallet_maturity",
];

/**
 * @typedef {Object} CrossAssetBehavior
 * @property {boolean} rotatesStockGainsIntoCrypto
 * @property {boolean} rotatesCryptoGainsIntoStock
 * @property {boolean} hedgesIntoStablecoinsBeforeEarnings
 * @property {boolean} usesMorphoForStockCollateralLeverage
 */

/**
 * @typedef {Object} DefiUsage
 * @property {number} uniswapTradesPerMonth
 * @property {boolean} morphoLendingActive
 * @property {boolean} morphoBorrowingActive
 * @property {boolean} lpPositionsActive
 */

/**
 * @typedef {Object} EquityBehavior
 * @property {string[]} sectorPreferences
 * @property {"hedges_into_stablecoins"|"doubles_down"|"no_reaction"} earningsReactionPattern
 * @property {number} avgHoldingDurationDays
 */

/**
 * @typedef {Object} SpendingRhythm
 * @property {number} avgDailyVolumeUsd
 * @property {number} peakHourUtc - 0-23
 * @property {number} weekdayVsWeekendRatio - >1 means more active on weekdays
 */

/**
 * @typedef {Object} Reactivity
 * @property {number} avgResponseTimeToMarketMoveMinutes
 */

/**
 * @typedef {Object} WalletMaturity
 * @property {number} ageInDays
 * @property {number} totalTransactionCount
 * @property {number} activityConsistencyScore - 0-1, how consistent activity has been
 */

/**
 * The full behavioral fingerprint. Individual sections become `null` when
 * the user has excluded that data category — see privacyLayer.js.
 *
 * @typedef {Object} BehavioralFingerprint
 * @property {"day_trader"|"swing_trader"|"holder"|"farmer"|"passive"} traderType
 * @property {"equity_heavy"|"crypto_heavy"|"balanced"|"rotational"} assetAllocationStyle
 * @property {"conservative"|"moderate"|"aggressive"} riskProfile
 * @property {CrossAssetBehavior} crossAssetBehavior
 * @property {DefiUsage|null} defiUsage
 * @property {EquityBehavior|null} equityBehavior
 * @property {SpendingRhythm|null} spendingRhythm
 * @property {Reactivity|null} reactivity
 * @property {WalletMaturity|null} walletMaturity
 */

/**
 * Raw, synthetic-only, wallet-derived metrics that feed fingerprint
 * computation. In production this would come from the indexer reading
 * real RPC/indexer data; here it comes from indexer/syntheticIndexer.js.
 *
 * @typedef {Object} RawWalletMetrics
 * @property {string} walletAddress
 * @property {number} ageInDays
 * @property {number} totalTransactionCount
 * @property {number} stockTradeCount
 * @property {number} cryptoTradeCount
 * @property {number} uniswapSwapsPerMonth
 * @property {boolean} morphoLendingActive
 * @property {boolean} morphoBorrowingActive
 * @property {number} morphoLeverageRatio - 0 = no leverage
 * @property {boolean} lpPositionsActive
 * @property {number} liquidationCount
 * @property {number} avgPositionSizeUsd
 * @property {number} avgDailyVolumeUsd
 * @property {number} peakHourUtc
 * @property {number} weekdayVsWeekendRatio
 * @property {number} avgResponseTimeToMarketMoveMinutes
 * @property {string[]} sectorPreferences
 * @property {"hedges_into_stablecoins"|"doubles_down"|"no_reaction"} earningsReactionPattern
 * @property {number} avgEquityHoldingDurationDays
 * @property {number} stockToCryptoRotationRate - 0-1
 * @property {number} cryptoToStockRotationRate - 0-1
 * @property {number} activityConsistencyScore - 0-1
 */

/**
 * What buyers actually see. No wallet address, no tx hashes, ever.
 *
 * @typedef {Object} AnonymizedProfile
 * @property {string} profileId
 * @property {BehavioralFingerprint} fingerprint
 */

/**
 * Internal-only record. This shape should never be handed to API route
 * handlers — only aggregation/store.js and registryBridge/* should ever
 * see a wallet address next to a fingerprint.
 *
 * @typedef {Object} InternalProfileRecord
 * @property {string} profileId
 * @property {string} walletAddress
 * @property {BehavioralFingerprint} fingerprint
 * @property {number} weight - on-chain payout weight, mirrors ProfileRegistry.profileWeight
 * @property {string[]} excludedCategories
 */

/**
 * @typedef {Object} QueryFilters
 * @property {string} [traderType]
 * @property {string} [assetAllocationStyle]
 * @property {string} [riskProfile]
 * @property {boolean} [requireCrossAssetActivity]
 * @property {number} [minAvgDailyVolumeUsd]
 */
