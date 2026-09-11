// SPDX-License-Identifier: MIT
/**
 * Real wallet connection for the dashboard. Two connection paths:
 *
 *   1. Coinbase Wallet, via the official SDK (works whether or not the
 *      Coinbase Wallet browser extension is installed — it falls back to a
 *      QR-code/mobile flow).
 *   2. Any injected wallet (MetaMask, Rainbow, Brave Wallet, etc.),
 *      discovered via EIP-6963 (`window.ethereum` alone only ever exposes
 *      ONE provider when multiple extensions are installed — EIP-6963 is
 *      the standard that lets a page see all of them and let the user
 *      pick, which is what "connect ... other wallets" means here).
 *
 * This module only ever reads an address (`eth_requestAccounts`) — no
 * transaction signing. A real withdrawal is still a client-signed
 * transaction against the deployed HazeSplitter contract, which needs the
 * contract's ABI/address; see the backend README's "what's NOT wired up"
 * section. That's a separate, later piece of work.
 *
 * dashboard.tsx (a real ES module — see its own comment) imports this and
 * bridges the functions onto `window.__hazeWallet` because
 * dashboard.0.classic.js runs as a plain inline <script> tag, not a module,
 * so it can't `import` this directly.
 */

import { CoinbaseWalletSDK } from "@coinbase/wallet-sdk";
import { DEFAULT_ROBINHOOD_CHAIN, type AddEthereumChainParameter } from "./robinhoodChain";

/** Minimal EIP-1193 provider shape — enough for what this file needs. */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
}

/** EIP-6963 announced-provider shape (window "eip6963:announceProvider" CustomEvent.detail). */
export interface Eip6963ProviderDetail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

let coinbaseProvider: Eip1193Provider | null = null;
function getCoinbaseProvider(): Eip1193Provider {
  if (!coinbaseProvider) {
    const sdk = new CoinbaseWalletSDK({ appName: "Haze" });
    coinbaseProvider = sdk.makeWeb3Provider() as unknown as Eip1193Provider;
  }
  return coinbaseProvider;
}

/**
 * Discovers every injected wallet the page announces itself, per EIP-6963.
 * Resolves after a short window (providers announce asynchronously on
 * page load) rather than instantly, so give it a moment — call it once,
 * early, and cache the result for the "choose a wallet" menu.
 */
export function discoverInjectedProviders(timeoutMs = 250): Promise<Eip6963ProviderDetail[]> {
  if (typeof window === "undefined") return Promise.resolve([]);

  return new Promise((resolve) => {
    const found = new Map<string, Eip6963ProviderDetail>();

    function onAnnounce(event: Event) {
      const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
      if (detail?.info?.uuid) found.set(detail.info.uuid, detail);
    }

    window.addEventListener("eip6963:announceProvider", onAnnounce as EventListener);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce as EventListener);
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

/** Fallback for wallets that don't (yet) implement EIP-6963. */
export function getLegacyInjectedProvider(): Eip1193Provider | null {
  const eth = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  return eth ?? null;
}

/**
 * Sends the user to MetaMask's own install page in a new tab. Used by the
 * dashboard's wallet menu when its dedicated "MetaMask" entry is clicked
 * but no MetaMask provider was actually found (neither via EIP-6963 nor
 * the legacy `window.ethereum.isMetaMask` check) — i.e. it isn't
 * installed. Unlike Coinbase Wallet, MetaMask has no SDK-provided
 * QR-code/mobile fallback wired up here, so "not installed" has to lead
 * somewhere rather than the button silently doing nothing.
 */
export function openMetaMaskInstallLink(): void {
  if (typeof window === "undefined") return;
  window.open("https://metamask.io/download/", "_blank", "noopener,noreferrer");
}

async function requestFirstAccount(provider: Eip1193Provider): Promise<string | null> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  return accounts?.[0] ?? null;
}

/** Connects via the Coinbase Wallet SDK and returns the connected address, or null if the user declined. */
export async function connectCoinbaseWallet(): Promise<string | null> {
  try {
    return await requestFirstAccount(getCoinbaseProvider());
  } catch (err) {
    console.warn("[Haze] Coinbase Wallet connection rejected", err);
    return null;
  }
}

/**
 * Connects to a specific injected wallet (pass an EIP-6963 detail from
 * discoverInjectedProviders), or falls back to whatever `window.ethereum`
 * is if none was given.
 */
export async function connectInjectedProvider(detail?: Eip6963ProviderDetail): Promise<string | null> {
  const provider = detail?.provider ?? getLegacyInjectedProvider();
  if (!provider) return null;
  try {
    return await requestFirstAccount(provider);
  } catch (err) {
    console.warn("[Haze] injected wallet connection rejected", err);
    return null;
  }
}

/**
 * Best-effort local disconnect. Neither the Coinbase Wallet SDK's popup
 * flow nor a classic injected wallet (MetaMask, Rainbow, Brave, etc.)
 * lets a page force a full disconnect the way a server-side session
 * can — the wallet extension itself owns that connection, and the user
 * can always reconnect it from within their wallet's own UI regardless
 * of anything this function does. This does what a page *can* do:
 *   - call Coinbase Wallet SDK's own `.disconnect()`, which does end
 *     that specific connection.
 *   - ask an injected provider to revoke this site's permissions via
 *     EIP-2255 `wallet_revokePermissions`, for wallets that implement
 *     it (most, including MetaMask at time of writing, do not yet —
 *     that's fine, this is best-effort and failures are swallowed).
 * The caller is responsible for clearing its own "connected" state and
 * making sure a future silent `eth_accounts` check doesn't just log the
 * user back in — see dashboard.0.classic.js's disconnectCurrentWallet().
 */
export async function disconnectWallet(provider?: Eip1193Provider | null): Promise<void> {
  if (coinbaseProvider) {
    try {
      await (coinbaseProvider as unknown as { disconnect?: () => Promise<void> | void }).disconnect?.();
    } catch (err) {
      console.warn("[Haze] Coinbase Wallet disconnect failed", err);
    }
  }

  const target = provider ?? getLegacyInjectedProvider();
  if (target) {
    try {
      await target.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    } catch {
      // Not implemented by most wallets yet — expected, not an error.
    }
  }
}

/**
 * Prompts the connected wallet to switch to (or add, if it doesn't know
 * about it yet) Robinhood Chain. Best-effort: failures are logged, not
 * thrown — the dashboard only needs the address, not a specific active
 * chain, to import a wallet's history (see haze-backend's
 * POST /v1/wallets/import). This is purely so a later real transaction
 * (e.g. an actual withdraw) would already be on the right network.
 */
export async function ensureRobinhoodChain(
  provider: Eip1193Provider,
  chain: AddEthereumChainParameter = DEFAULT_ROBINHOOD_CHAIN,
): Promise<void> {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainId }] });
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code !== 4902) {
      console.warn("[Haze] could not switch to Robinhood Chain", err);
      return;
    }
    try {
      await provider.request({ method: "wallet_addEthereumChain", params: [chain] });
    } catch (addErr) {
      console.warn("[Haze] could not add Robinhood Chain to wallet", addErr);
    }
  }
}
