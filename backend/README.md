# Haze Protocol backend — vanilla JavaScript

Plain-JavaScript rewrite of the Haze off-chain scaffold: synthetic indexer,
fingerprint/aggregation pipeline, k-anonymity-gated buyer query API, and
the wallet-owner-facing dashboard API this powers `hazefinance-frontend/`.

No TypeScript, no build step, no ts-node. Everything is standard ES
modules (`"type": "module"` in package.json) running on Node's own
`http`, `crypto`, and `node:test` — zero runtime dependencies, so
`npm install` has nothing to fetch and the project runs on any Node 18+.

Where TypeScript used to give compile-time types, this version uses two
plain-JS equivalents instead, documented fully in `src/types.js`:
- union types (e.g. `TraderType`) became exported constant arrays
  (`TRADER_TYPES`) — real runtime data, not just compile-time checking
- `interface`s became `@typedef` JSDoc comments — editors still show them
  on hover, but nothing enforces them at runtime, which is the actual
  trade-off of dropping TypeScript

`ProfileStore`'s two internal maps use real ES2022 private class fields
(`#records`, `#profileIdByWallet`) — a standard JavaScript feature, not a
TypeScript one — so the privacy boundary is enforced by the language at
runtime, not just by a compiler that's no longer there.

## What's here

```
src/
  types.js                        JSDoc typedefs + value constants (ex-union-types)
  indexer/syntheticIndexer.js     generates FAKE wallet histories (no real data)
  aggregation/
    fingerprint.js                raw metrics -> behavioral fingerprint
    privacyLayer.js                category exclusion, anonymization, payout-weight heuristic
    store.js                      in-memory store; enforces k-anonymity + the privacy boundary
    scoring.js                    fingerprint/weight -> 0-100 display percentages (dashboard only)
    controlsMapping.js            dashboard toggle ids -> DATA_CATEGORIES (honest 3-of-6 mapping)
  payments/
    x402.js                       402 gate + PaymentVerifier interface + mock verifier
    meridian.js                   stub for real Meridian settlement verification (not implemented)
  earnings/
    splitterSimulator.js          DEV-ONLY mirror of HazeSplitter's 80/20 math
  activity/
    activityLog.js                DEV-ONLY query log for the activity/breakdown panels
  api/
    server.js                     plain node:http wiring + manual routing + CORS
    routes/
      queryProfiles.js            POST /v1/profiles/query — buyer-facing, x402-gated
      health.js                   GET /health
      wallets.js                  wallet-owner-facing routes (see below)
  registryBridge/
    syncWeights.js                diffs off-chain weights vs on-chain ProfileRegistry state
scripts/
  dev.js                          seeds profiles, starts the API, simulates ongoing revenue
test/                             66 tests, all passing — see "Test" below
```

## Setup

```bash
npm install    # nothing to fetch — zero dependencies, just confirms package.json is sane
npm run dev
# -> Haze dev API listening on http://localhost:8402
# -> prints a seeded wallet address you can use to test the dashboard against
```

## Test

```bash
npm test
```

66 tests across 13 files, all passing, including full HTTP round-trips
(not just unit-level mocks) for both the buyer query flow and every wallet
route.

## API

### Buyer-facing (x402-gated)

**`POST /v1/profiles/query`** — unchanged from the TypeScript version.
402 without payment, cohort of anonymized profiles with it, 422 if the
match count is below the k-anonymity floor (5).

### Wallet-owner-facing (not x402-gated, but also not authenticated —
see "Security" below)

- **`GET /v1/wallets/:address/profile`** — fingerprint (with the owner's
  own exclusions already applied, i.e. what the market actually sees),
  `profileStrength` (0-100), `fingerprintBars` (per-dimension 0-100 for
  the dashboard's bar chart), `excludedCategories`.
- **`POST /v1/wallets/:address/controls`** — body `{control, enabled}`.
  `control` is one of the dashboard's own toggle ids: `trading`, `risk`,
  `defi`, `equity`, `timing`, `crossasset`. Only `defi`, `equity`, and
  `timing` are backed by a real excludable category today — see
  `controlsMapping.js` for exactly why the other three are honest no-ops
  (`{applied: false, reason: "..."}`), not faked support.
- **`GET /v1/wallets/:address/earnings`** — `totalEarnedUsdc`,
  `todayEarnedUsdc`, `monthEarnedUsdc`, `withdrawableUsdc`. Backed by
  `SplitterSimulator`, a dev-only in-memory mirror of `HazeSplitter.sol`'s
  80/20 math — **not** a real chain read. See "What's NOT wired up."
- **`GET /v1/wallets/:address/earnings/history?range=7d|30d|90d|all`** —
  cumulative-earnings points for the dashboard's chart.
- **`GET /v1/wallets/:address/activity`** — recent paid queries that
  included this wallet, plus a buyer-type breakdown (`tradingAgentsPct`
  etc.) for the "Query breakdown" panel. Buyer typing is an illustrative
  heuristic (`classifyBuyer` in `activityLog.js`), not real classification.
- **`POST /v1/wallets/:address/withdraw`** — **dev simulation only.**
  Moves the simulated claimable balance to claimed. A real withdrawal is
  the wallet owner calling `HazeSplitter.claim()` themselves, signed by
  their own wallet — a client-side transaction, not something a backend
  should ever do on a user's behalf.

## Security — read before deploying anywhere real

The wallet routes trust the `:address` URL segment as given. There is
**no authentication** — anyone can currently read or mutate any wallet's
data controls by address. Before this goes near production, add a real
auth step (e.g. a signed-message challenge proving control of the private
key for that address) in front of every `/v1/wallets/:address/*` route.
This scaffold intentionally does not guess at that design — it's a real
security decision, not a default to fake.

CORS is wide open (`Access-Control-Allow-Origin: *`) by default, which is
fine for local dev against the Vite dev server and wrong for production —
set `CORS_ORIGIN` to your actual frontend origin before deploying.

## What's NOT wired up yet, on purpose

- **Real earnings/withdrawal.** `SplitterSimulator` is an off-chain mirror
  of `HazeSplitter.sol`'s math so the dashboard has numbers to render
  locally. Production must read `claimable()` from the real, deployed
  `HazeSplitter` via RPC, and a real withdraw is a client-signed
  transaction against that contract — see `protocol-contracts/` for the
  actual Solidity. Wiring this requires a wallet library (viem/wagmi) on
  the frontend; none is included yet (see the frontend README).
- **Real Meridian payment verification** — `meridian.js` throws on purpose.
- **Real on-chain registry syncing** — `registryBridge/syncWeights.js`'s
  `applySyncPlan()` throws on purpose; needs `npm install viem`.
- **A real indexer** reading Robinhood Chain — everything runs on
  `syntheticIndexer.js`'s fake data.
- **Persistence** — `ProfileStore`, `SplitterSimulator`, and `ActivityLog`
  are all in-memory and reset on restart.
- **Wallet authentication** for the wallet-owner routes — see "Security"
  above.
