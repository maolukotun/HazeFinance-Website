// SPDX-License-Identifier: MIT

/**
 * Bridges off-chain profile weights (aggregation/store.js) to the on-chain
 * ProfileRegistry contract from protocol-contracts/.
 *
 * Split into two halves on purpose:
 *   - buildSyncPlan(): pure, no blockchain dependency, fully unit
 *     testable. Computes what needs to change on-chain given the current
 *     off-chain weights and what the registry last reported.
 *   - applySyncPlan(): actually sends the transactions. This needs viem
 *     (`npm install viem`) and a funded operator key, neither of which
 *     this scaffold sets up for you — see the README before using it.
 *
 * @typedef {Object} RegistrySnapshot
 * @property {string} walletAddress
 * @property {number} weight
 *
 * @typedef {{type: "register", walletAddress: string, weight: number}
 *   | {type: "update", walletAddress: string, oldWeight: number, newWeight: number}
 *   | {type: "delete", walletAddress: string}} SyncAction
 */

/**
 * Diffs the off-chain store's current weights against the last-known
 * on-chain state and returns the minimal set of actions needed to bring
 * ProfileRegistry back in sync. No network access, no viem — pure data in,
 * pure data out, so it's cheap to test extensively.
 *
 * @param {RegistrySnapshot[]} offChain
 * @param {RegistrySnapshot[]} onChain
 * @returns {SyncAction[]}
 */
export function buildSyncPlan(offChain, onChain) {
  const onChainByWallet = new Map(onChain.map((r) => [r.walletAddress, r.weight]));
  const offChainWallets = new Set(offChain.map((r) => r.walletAddress));
  /** @type {SyncAction[]} */
  const actions = [];

  for (const { walletAddress, weight } of offChain) {
    const existing = onChainByWallet.get(walletAddress);
    if (existing === undefined) {
      actions.push({ type: "register", walletAddress, weight });
    } else if (existing !== weight) {
      actions.push({ type: "update", walletAddress, oldWeight: existing, newWeight: weight });
    }
  }

  for (const { walletAddress } of onChain) {
    if (!offChainWallets.has(walletAddress)) {
      actions.push({ type: "delete", walletAddress });
    }
  }

  return actions;
}

/**
 * Sends the actual transactions for a sync plan via viem. NOT wired up —
 * requires `npm install viem`, a configured wallet client pointed at the
 * current Robinhood Chain RPC (get it from Nick, don't hardcode a stale
 * one), and the deployed ProfileRegistry address from
 * protocol-contracts/script/Deploy.s.sol's output.
 *
 * Left as a documented shape rather than a working implementation because
 * guessing at gas/nonce/retry handling for a contract that moves payout
 * weight is exactly the kind of thing worth doing deliberately with the
 * real registry ABI in front of you, not scaffolding blind.
 *
 * @param {SyncAction[]} _actions
 * @param {{rpcUrl: string, registryAddress: string, operatorPrivateKey: string}} _config
 * @returns {Promise<void>}
 */
export async function applySyncPlan(_actions, _config) {
  throw new Error(
    "applySyncPlan is not implemented. Install viem, wire up a wallet " +
      "client against ProfileRegistry's real ABI, and implement register/" +
      "updateWeight/deleteProfile calls per SyncAction — see the comment " +
      "above this function.",
  );
}
