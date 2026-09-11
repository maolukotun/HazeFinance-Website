// SPDX-License-Identifier: MIT
/**
 * Robinhood Chain network parameters, in the shape `wallet_addEthereumChain`
 * / `wallet_switchEthereumChain` expect (EIP-3085 / EIP-3326). Values are
 * Robinhood Chain's own public endpoints — see
 * https://docs.robinhood.com/chain/connecting — not something this repo
 * controls, so double-check them if wallet connections start failing.
 *
 * Which network the DASHBOARD talks to for real wallet data is a separate
 * concern controlled by the backend's HAZE_NETWORK env var (see
 * ../haze-backend/.env.example) — this file only affects which chain the
 * user's wallet itself is prompted to add/switch to.
 */

export interface AddEthereumChainParameter {
  chainId: string; // 0x-prefixed hex
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls: string[];
}

export const ROBINHOOD_CHAIN_TESTNET: AddEthereumChainParameter = {
  chainId: "0xb626", // 46630
  chainName: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.testnet.chain.robinhood.com"],
  blockExplorerUrls: ["https://explorer.testnet.chain.robinhood.com"],
};

export const ROBINHOOD_CHAIN_MAINNET: AddEthereumChainParameter = {
  chainId: "0x1237", // 4663
  chainName: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
  blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
};

/** Defaults to testnet — keep this in lockstep with the backend's default
 * HAZE_NETWORK (see .env.example) so a connected wallet and the profile the
 * backend indexes agree on which chain "your activity" means. */
export const DEFAULT_ROBINHOOD_CHAIN = ROBINHOOD_CHAIN_TESTNET;
