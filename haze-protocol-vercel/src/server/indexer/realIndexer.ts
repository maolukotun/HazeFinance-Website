// SPDX-License-Identifier: MIT
/**
 * Real Robinhood Chain indexer. Given a real address, reads that wallet's
 * actual public transaction history via Robinhood Chain's Blockscout
 * explorer API (no API key required) and turns it into the same
 * RawWalletMetrics shape fingerprint.ts already expects — so nothing
 * downstream (fingerprint computation, the privacy layer, the store) has
 * to change.
 *
 * Honesty over completeness: several RawWalletMetrics fields cannot be
 * computed correctly without protocol-specific information this scaffold
 * does not have — the Uniswap/Morpho pool addresses and the
 * tokenized-stock registry on Robinhood Chain (those addresses live in a
 * separate protocol-contracts repo). Rather than guess, this module fills
 * those fields with explicit, documented neutral defaults and reports
 * exactly which ones in `dataGaps`. Do not remove a dataGaps entry
 * without actually wiring the field it describes to real on-chain data.
 *
 * What IS real here: wallet age, total transaction count, activity timing
 * (peak hour / weekday vs weekend), activity consistency, and volume/
 * position sizing derived from native ETH transfers (priced via a live
 * ETH/USD quote). That volume figure undercounts ERC-20/stablecoin
 * transfers — noted in dataGaps too.
 */

import { EARNINGS_REACTIONS, type RawWalletMetrics } from "../types";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

interface NetworkPreset {
  chainId: number;
  rpcUrl: string;
  explorerApiUrl: string;
}

/** Network presets. Override any single URL with ROBINHOOD_RPC_URL /
 * ROBINHOOD_EXPLORER_API_URL env vars without switching the whole preset. */
export const ROBINHOOD_NETWORKS: Record<string, NetworkPreset> = {
  testnet: {
    chainId: 46630,
    rpcUrl: "https://rpc.testnet.chain.robinhood.com",
    explorerApiUrl: "https://explorer.testnet.chain.robinhood.com/api/v2",
  },
  mainnet: {
    chainId: 4663,
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    explorerApiUrl: "https://robinhoodchain.blockscout.com/api/v2",
  },
};

const MAX_TX_PAGES = 3; // public Blockscout endpoint is rate-limited; keep this modest
const TX_PAGE_SIZE_HINT = 50; // Blockscout's own default page size, not user-configurable via query param

function resolveNetworkConfig(network: string, env: Record<string, string | undefined> = process.env): NetworkPreset {
  const preset = ROBINHOOD_NETWORKS[network];
  if (!preset) {
    throw new Error(`unknown network "${network}" — expected one of ${Object.keys(ROBINHOOD_NETWORKS).join(", ")}`);
  }
  return {
    chainId: preset.chainId,
    rpcUrl: env["ROBINHOOD_RPC_URL"] || preset.rpcUrl,
    explorerApiUrl: env["ROBINHOOD_EXPLORER_API_URL"] || preset.explorerApiUrl,
  };
}

type FetchImpl = (url: string) => Promise<Response>;

async function fetchAddressActivity(
  explorerApiUrl: string,
  address: string,
  fetchImpl: FetchImpl,
  dataGaps: string[],
): Promise<{ transactions: any[]; overview: any | null }> {
  let overview: any | null = null;
  try {
    const res = await fetchImpl(`${explorerApiUrl}/addresses/${address}`);
    if (res.ok) overview = await res.json();
  } catch (err) {
    dataGaps.push(`walletMaturity: could not reach explorer for address overview (${(err as Error).message})`);
  }

  const transactions: any[] = [];
  let nextPageParams: Record<string, unknown> | null = null;
  for (let page = 0; page < MAX_TX_PAGES; page++) {
    const qs = nextPageParams
      ? "?" + new URLSearchParams(Object.entries(nextPageParams).map(([k, v]) => [k, String(v)])).toString()
      : "";
    let body: any;
    try {
      const res = await fetchImpl(`${explorerApiUrl}/addresses/${address}/transactions${qs}`);
      if (!res.ok) break;
      body = await res.json();
    } catch (err) {
      dataGaps.push(`activityConsistencyScore/timing: transaction history fetch failed partway (${(err as Error).message})`);
      break;
    }
    const items = Array.isArray(body?.items) ? body.items : [];
    transactions.push(...items);
    nextPageParams = body?.next_page_params ?? null;
    if (!nextPageParams || items.length < TX_PAGE_SIZE_HINT) break;
  }

  return { transactions, overview };
}

async function fetchEthUsdPrice(fetchImpl: FetchImpl, dataGaps: string[]): Promise<number | null> {
  try {
    const res = await fetchImpl("https://api.coinbase.com/v2/prices/ETH-USD/spot");
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body: any = await res.json();
    const amount = Number(body?.data?.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("unexpected response shape");
    return amount;
  } catch (err) {
    dataGaps.push(
      `spendingRhythm/avgPositionSizeUsd: could not fetch a live ETH/USD price (${(err as Error).message}) — USD figures default to 0`,
    );
    return null;
  }
}

function computeTimingAndVolume(transactions: any[], address: string, ethUsdPrice: number | null, dataGaps: string[]) {
  const lower = address.toLowerCase();
  const hourCounts = new Array(24).fill(0);
  let weekdayCount = 0;
  let weekendCount = 0;
  const activeDayKeys = new Set<string>();
  let earliestMs: number | null = null;
  const nativeValuesWei: bigint[] = [];

  for (const tx of transactions) {
    const ts = tx?.timestamp ? Date.parse(tx.timestamp) : NaN;
    if (Number.isFinite(ts)) {
      const d = new Date(ts);
      hourCounts[d.getUTCHours()] = (hourCounts[d.getUTCHours()] ?? 0) + 1;
      const day = d.getUTCDay(); // 0 = Sunday, 6 = Saturday
      if (day === 0 || day === 6) weekendCount++;
      else weekdayCount++;
      activeDayKeys.add(d.toISOString().slice(0, 10));
      if (earliestMs === null || ts < earliestMs) earliestMs = ts;
    }

    const from = typeof tx?.from?.hash === "string" ? tx.from.hash.toLowerCase() : null;
    const to = typeof tx?.to?.hash === "string" ? tx.to.hash.toLowerCase() : null;
    if ((from === lower || to === lower) && tx?.value !== undefined) {
      const wei = BigInt(tx.value || "0");
      if (wei > 0n) nativeValuesWei.push(wei);
    }
  }

  const ageInDays = earliestMs !== null ? Math.max(0, Math.floor((Date.now() - earliestMs) / 86_400_000)) : 0;

  const peakHourUtc = hourCounts.reduce(
    (bestHour: number, count: number, hour: number) => (count > (hourCounts[bestHour] ?? 0) ? hour : bestHour),
    0,
  );
  const weekdayVsWeekendRatio =
    weekendCount === 0 ? weekdayCount || 1 : Math.round((weekdayCount / weekendCount) * 100) / 100;

  // Consistency: fraction of the wallet's observed lifetime (capped at 90
  // days, since we only sample recent pages of history) that had at least
  // one transaction. Real signal, not a guess — just bounded by sample size.
  const consistencyWindowDays = Math.max(1, Math.min(ageInDays, 90));
  const activityConsistencyScore = Math.min(1, Math.round((activeDayKeys.size / consistencyWindowDays) * 100) / 100);

  let avgDailyVolumeUsd = 0;
  let avgPositionSizeUsd = 0;
  if (ethUsdPrice && nativeValuesWei.length > 0) {
    const totalWei = nativeValuesWei.reduce((s, v) => s + v, 0n);
    const totalEth = Number(totalWei) / 1e18;
    const avgEth = totalEth / nativeValuesWei.length;
    avgPositionSizeUsd = Math.round(avgEth * ethUsdPrice * 100) / 100;
    const spanDays = Math.max(1, ageInDays);
    avgDailyVolumeUsd = Math.round(((totalEth * ethUsdPrice) / spanDays) * 100) / 100;
  }
  dataGaps.push(
    "spendingRhythm/avgPositionSizeUsd: reflects native ETH transfers only — ERC-20 and tokenized-stock transfer volume isn't priced yet",
  );

  return { ageInDays, peakHourUtc, weekdayVsWeekendRatio, activityConsistencyScore, avgDailyVolumeUsd, avgPositionSizeUsd };
}

export interface IndexRealWalletResult {
  raw: RawWalletMetrics;
  dataGaps: string[];
  sourcedFrom: { network: string; chainId: number; explorerApiUrl: string; transactionSampleSize: number };
}

/** Indexes one real wallet address on Robinhood Chain. */
export async function indexRealWallet(
  address: string,
  options: { network?: string; fetchImpl?: FetchImpl } = {},
): Promise<IndexRealWalletResult> {
  if (typeof address !== "string" || !ADDRESS_RE.test(address)) {
    throw new Error(`invalid wallet address: ${JSON.stringify(address)}`);
  }

  const network = options.network || process.env["HAZE_NETWORK"] || "testnet";
  const fetchImpl = options.fetchImpl || (globalThis.fetch as FetchImpl | undefined);
  if (!fetchImpl) {
    throw new Error("no fetch implementation available — Node 18+ provides one globally, or pass options.fetchImpl");
  }

  const { chainId, explorerApiUrl } = resolveNetworkConfig(network);

  const dataGaps: string[] = [];

  const [{ transactions, overview }, ethUsdPrice] = await Promise.all([
    fetchAddressActivity(explorerApiUrl, address, fetchImpl, dataGaps),
    fetchEthUsdPrice(fetchImpl, dataGaps),
  ]);

  const timing = computeTimingAndVolume(transactions, address, ethUsdPrice, dataGaps);

  const overviewTxCount = Number(overview?.transactions_count);
  const totalTransactionCount =
    Number.isFinite(overviewTxCount) && overviewTxCount > 0 ? overviewTxCount : transactions.length;

  // DeFi usage, equity classification, and market-reactivity fields all
  // need protocol addresses / a stock registry / a market-moves feed this
  // scaffold doesn't have. Honest no-op defaults, not guesses.
  dataGaps.push(
    "defiUsage: Uniswap/Morpho pool addresses for Robinhood Chain aren't configured — all DeFi usage fields default to false/0",
    "equityBehavior/sectorPreferences/earningsReactionPattern: no tokenized-stock registry configured — every detected transaction is bucketed as generic on-chain activity (cryptoTradeCount), none is positively identified as an equity trade",
    "reactivity: avgResponseTimeToMarketMoveMinutes needs a market-moves feed this scaffold doesn't have — defaults to 0",
  );

  const raw: RawWalletMetrics = {
    walletAddress: address,
    ageInDays: timing.ageInDays,
    totalTransactionCount,
    stockTradeCount: 0,
    cryptoTradeCount: totalTransactionCount,
    uniswapSwapsPerMonth: 0,
    morphoLendingActive: false,
    morphoBorrowingActive: false,
    morphoLeverageRatio: 0,
    lpPositionsActive: false,
    liquidationCount: 0,
    avgPositionSizeUsd: timing.avgPositionSizeUsd,
    avgDailyVolumeUsd: timing.avgDailyVolumeUsd,
    peakHourUtc: timing.peakHourUtc,
    weekdayVsWeekendRatio: timing.weekdayVsWeekendRatio,
    avgResponseTimeToMarketMoveMinutes: 0,
    sectorPreferences: [],
    earningsReactionPattern: EARNINGS_REACTIONS[2],
    avgEquityHoldingDurationDays: 0,
    stockToCryptoRotationRate: 0,
    cryptoToStockRotationRate: 0,
    activityConsistencyScore: timing.activityConsistencyScore,
  };

  return {
    raw,
    dataGaps,
    sourcedFrom: { network, chainId, explorerApiUrl, transactionSampleSize: transactions.length },
  };
}
