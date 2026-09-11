# Haze Protocol — merged app (Vercel-ready)

This project merges what used to be two separate repos —
`HazeFinance-Website` (the TanStack Start frontend) and
`HazeFinance-Backend` (a plain-JavaScript, zero-dependency Node API) —
into a single TypeScript React + API-routes project that deploys to
Vercel as one unit. There is no separate backend to host anywhere else
anymore: the API lives in this same project as TanStack Start **server
routes**, which Vercel runs as Vercel Functions.

## What changed, and why it still does the same thing

- **Frontend**: unchanged. Same TanStack Start app (Vite + React 19 +
  TypeScript + shadcn/ui), same three pages (`/`, `/dashboard`, `/docs`),
  same wallet-connect code (`src/lib/walletProviders.ts`,
  `src/lib/robinhoodChain.ts`). The only edit is one line in
  `src/routes/dashboard.tsx`: the dashboard's API base URL now defaults to
  `""` (same-origin) instead of `http://localhost:8402`, since the API it
  talks to is now part of this same deployment. `dashboard.0.classic.js`
  — the dashboard's inline script — was **not touched**; every fetch call
  in it (`/health`, `/v1/wallets/:address/profile`, `/v1/profiles/query`,
  etc.) still hits the exact same paths, they just resolve same-origin
  now instead of to a separate host.
- **Backend**: ported from vanilla JavaScript (Node's own `http` module,
  zero npm dependencies) to TypeScript, and re-wired from manual
  regex-based routing in one `server.js` into TanStack Start's file-based
  **server routes** — see `src/routes/health.ts` and everything under
  `src/routes/v1/`. Same endpoints, same request/response shapes, same
  business logic (fingerprinting, k-anonymity, x402 gate, privacy
  exclusions, earnings simulation) — just TypeScript now, and colocated
  with the frontend instead of a separate repo/host. The actual logic
  (not wired to any HTTP framework) lives in `src/server/` and is unit
  logic only — the route files in `src/routes/` are thin adapters that
  parse a `Request`, call into `src/server/`, and return a `Response`.

## Why this deploys to Vercel with zero extra config

This app uses `@lovable.dev/vite-tanstack-config` (already a
dependency, unchanged), which wires up TanStack Start + Nitro under the
hood. Vercel auto-detects TanStack Start projects built with this config
(v2.6.2+; this project pins 2.20.0) and builds them with Nitro's Vercel
preset automatically — no manual Nitro plugin install, no hand-written
`vercel.json` build config. The included `vercel.json` just pins the
framework name defensively; it isn't doing anything Vercel wouldn't
already infer.

To deploy: push this to a GitHub repo and import it at
[vercel.com/new](https://vercel.com/new), or run `vercel` /
`vercel --prod` from this directory with the Vercel CLI. Set any
non-default environment variables (see `.env.example`) under Project
Settings → Environment Variables before deploying for real use.

## Local development

```bash
npm install
npm run dev
```

This starts one dev server (Vite) serving both the app and the API
routes — there is no second process to run. On startup it seeds 40
synthetic demo wallets and prints one address to the console; open
`/dashboard?devWallet=<that address>` to see the dashboard against seeded
data without connecting a real wallet. Connecting a real wallet (Coinbase
Wallet or any injected wallet like MetaMask) calls `POST
/v1/wallets/import`, which indexes that address's real public Robinhood
Chain history instead.

```bash
npm run build      # production build (what Vercel runs)
npm run test       # runs *.test.ts files under src/server/ with tsx --test
```

## API routes

All under this same deployment, same-origin with the frontend:

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | protocol stats; CORS-open |
| POST | `/v1/profiles/query` | buyer-facing, **x402-gated** ($0.01–0.05/query); CORS-open (external AI agents call this directly) |
| POST | `/v1/wallets/import` | body `{address, network?}` — indexes a real wallet |
| GET | `/v1/wallets/:address/profile` | fingerprint + profile strength |
| POST | `/v1/wallets/:address/controls` | body `{control, enabled}` |
| GET | `/v1/wallets/:address/earnings` | totals + withdrawable |
| GET | `/v1/wallets/:address/earnings/history?range=7d\|30d\|90d\|all` | chart data |
| GET | `/v1/wallets/:address/activity` | recent paid queries touching this wallet |
| POST | `/v1/wallets/:address/withdraw` | **dev simulation only** |
| DELETE | `/v1/wallets/:address` | deletes the profile |

The wallet-owner routes (`/v1/wallets/**`) intentionally do **not** send
CORS headers — they're only ever called same-origin by this project's own
dashboard now, which is a small security improvement over the original
standalone backend (which had wide-open CORS on every route, including
these). `/health` and `/v1/profiles/query` keep CORS open (`CORS_ORIGIN`
env var, default `*`) since external buyers/AI agents hit those directly.

## Before this goes near real users or an ICO — read this

This was ported feature-for-feature from a scaffold whose own README was
explicit about what it deliberately does **not** do yet. All of it
carries over unchanged by the merge, and matters more now, not less:

1. **Persistence.** `ProfileStore`, `SplitterSimulator`, and `ActivityLog`
   (`src/server/singletons.ts`) are in-memory JS objects — no database.
   On Vercel this is a real functional risk, not just a "restart wipes
   it" caveat: Vercel Functions can spin up fresh instances at any time
   and run several in parallel, each with its own copy of this state, so
   a wallet registered against one instance may not be visible from
   another, and every deploy discards all of it. This is fine for a demo
   on a single warm instance; it is **not** durable storage. Before real
   users — and especially before an ICO where investors are expected to
   import wallets and see correct, persistent data — swap these three
   classes' internals for a real database (Vercel Postgres, Vercel
   KV/Upstash Redis, or an external Postgres). Their public method
   signatures are designed to stay the same, so the route handlers in
   `src/routes/v1/**` shouldn't need to change.
2. **No authentication.** Every `/v1/wallets/:address/*` route trusts the
   `:address` URL segment as given — anyone can currently read or mutate
   any wallet's data controls by address. Add a real auth step (e.g. a
   signed-message challenge proving control of the private key for that
   address) before this is exposed to real users.
3. **No real Meridian settlement.** `src/server/payments/x402.ts` ships
   with `MockPaymentVerifier` only (accepts headers like `"mock:0.02"`).
   `src/server/payments/meridian.ts`'s `MeridianPaymentVerifier` throws on
   purpose — wire up real Meridian settlement verification before any
   x402 payment is expected to move real money.
4. **No real on-chain registry sync or withdrawal.**
   `src/server/registryBridge/syncWeights.ts`'s `applySyncPlan()` throws
   on purpose (needs `viem` + a funded operator key + the deployed
   `ProfileRegistry` ABI). `POST /v1/wallets/:address/withdraw` only moves
   a number in the in-memory `SplitterSimulator` — a real withdrawal is
   the wallet owner signing a transaction against the deployed
   `HazeSplitter` contract themselves (needs a wallet library like
   viem/wagmi wired into the frontend for the actual claim call; nothing
   here signs transactions today).
5. **Real wallet import has honest gaps, not fabricated data.**
   `src/server/indexer/realIndexer.ts` computes wallet age, transaction
   count, activity timing/consistency, and ETH-denominated volume from
   real Robinhood Chain data — but DeFi usage (Uniswap/Morpho), equity vs.
   crypto trade classification, and sector preferences all need protocol
   contract addresses this scaffold doesn't have, so those fields default
   to honest neutral values and are listed in the response's `dataGaps`
   array. Surface that in the UI rather than hiding it; don't wire in
   guessed values instead of the real addresses.
6. **No automated test suite ported yet.** The original standalone
   backend had 66 passing tests (unit tests for the pure fingerprint/
   privacy/scoring logic, plus full HTTP round-trip tests against its
   manual `node:http` router). The pure-logic modules under `src/server/`
   were type-checked and manually cross-checked line-by-line against the
   original during this merge, but the original HTTP-level tests assumed
   a manual `req`/`res` server and don't carry over mechanically to
   TanStack Start's file-based `Request`/`Response` server routes. Porting
   real route-level tests (e.g. hitting `vite dev`'s server with `fetch`,
   or using TanStack Start's own testing utilities) is a good next step
   before relying on this for anything real.

None of the above blocks deploying this to Vercel and demoing the full
flow end-to-end (connect a wallet → see a fingerprint → see simulated
earnings move) — it's exactly as far along as the original two-repo
scaffold was, just merged into one deployable unit. It does mean "deploy
this and launch an ICO around it" needs the six items above addressed
first, particularly #1 and #2.

## Project layout

```
src/
  routes/                    TanStack Router routes — both pages AND API routes
    __root.tsx, index.tsx, docs.tsx, dashboard.tsx   the 3 pages (unchanged)
    health.ts                                        GET /health
    v1/profiles/query.ts                             POST /v1/profiles/query
    v1/wallets/import.ts                             POST /v1/wallets/import
    v1/wallets/$address.ts                           DELETE /v1/wallets/:address
    v1/wallets/$address/{profile,controls,earnings,activity,withdraw}.ts
    v1/wallets/$address/earnings/history.ts
  server/                    framework-independent backend logic (ported from haze-backend)
    types.ts                             shared types/constants
    aggregation/{fingerprint,privacyLayer,scoring,store,controlsMapping}.ts
    indexer/{realIndexer,syntheticIndexer}.ts
    payments/{x402,meridian}.ts
    earnings/splitterSimulator.ts
    activity/activityLog.ts
    registryBridge/syncWeights.ts
    singletons.ts            shared store/simulator/log instances + seeding — READ THE COMMENT AT THE TOP
    cors.ts                  CORS helper for the two buyer-facing routes
  components/, hooks/, lib/, content/   unchanged from the original frontend
```
