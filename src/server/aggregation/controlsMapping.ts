// SPDX-License-Identifier: MIT
/**
 * Maps the dashboard's data-control toggle ids (the `data-control`
 * attribute in dashboard.html: trading, risk, defi, equity, timing,
 * crossasset) to backend DATA_CATEGORIES (types.ts).
 *
 * Only 3 of the 6 toggles have a real backing category today:
 *   defi      -> defi_usage
 *   equity    -> equity_trading
 *   timing    -> spending_rhythm  (peak hours / weekday-weekend rhythm)
 *
 * The other 3 (trading, risk, crossasset) map to `null` on purpose.
 * `traderType`, `riskProfile`, and `crossAssetBehavior` are core,
 * non-nullable fields on BehavioralFingerprint today — supporting
 * exclusion for them is a real backend change (making those fields
 * nullable, updating fingerprint derivation and cohort-filter matching
 * accordingly), not something to fake at the API boundary. The controls
 * route accepts all 6 ids so the UI doesn't error, but a `null`-mapped
 * control is a no-op and the response says so explicitly.
 */
export const CONTROL_TO_CATEGORY: Record<string, string | null> = {
  defi: "defi_usage",
  equity: "equity_trading",
  timing: "spending_rhythm",
  trading: null,
  risk: null,
  crossasset: null,
};
