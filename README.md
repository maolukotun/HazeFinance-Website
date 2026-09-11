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

**Also attach Postgres before relying on real wallet connections** —
Project → Storage → Create Database → Postgres. Without it, wallet data
does not reliably survive between requests in production (see
`src/server/singletons.ts`'s persistence comment, and item #1 below);
`?devWallet=` links still work either way since seeded synthetic wallets
are deterministic. See that same comment for exactly what breaks and why.

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

1. **Persistence — FIXED, but only once you attach Postgres.**
   `ProfileStore`, `SplitterSimulator`, and `ActivityLog`
   (`src/server/singletons.ts`) now read and write Postgres
   (`src/server/db/client.ts`) whenever a connection string is present —
   attach one via Project → Storage → Create Database → Postgres (or the
   Supabase marketplace integration — this project's database is
   Supabase-hosted) and every table is created automatically on first
   query, no migration step to run. The query client is `postgres`
   (postgres.js), a standard TCP Postgres client — not `@vercel/postgres`,
   whose transport only works against Neon; see `src/server/db/client.ts`'s
   module comment for the full story if this ever needs revisiting. This
   was a real, reproduced bug, not a theoretical one:
   on the in-memory version, a wallet registered via `POST
   /v1/wallets/import` on one Vercel Function instance was invisible to
   a `GET .../profile` that happened to land on a different (or later,
   cold) instance — confirmed live on tryhazefi.com, where import
   succeeded and five straight profile reads all 404'd right after.
   **Without Postgres attached, that bug is still present** — the three
   classes fall back to the original in-memory Maps/arrays so local
   `npm run dev` keeps working with zero setup, but production is exactly
   as fragile as before until the integration is attached. `?devWallet=`
   links work either way, Postgres or not, since seeded synthetic wallet
   addresses are deterministic (same seed every process) and so exist
   independently on every instance.
2. **Authentication — FIXED.** Every `/v1/wallets/:address/*` route now
   requires proof the caller actually controls `:address`, not just
   knowledge of it. The flow (`src/shared/authMessage.ts`,
   `src/server/auth/walletAuth.ts`, `src/routes/v1/auth/{verify,logout}.ts`):
   the wallet signs a short-lived, address-bound message
   (`personal_sign` — no gas, no transaction) via
   `signInWithWallet()` (`src/lib/walletProviders.ts`); the client posts
   `{address, issuedAt, signature}` to `POST /v1/auth/verify`, which
   recovers the signer with `viem`'s `verifyMessage()` and, on a match,
   sets an httpOnly, 24-hour session cookie
   (`address.expiresAt.hmac`, HMAC-SHA256, timing-safe compare — see
   `walletAuth.ts`); every `/v1/wallets/:address/*` route then calls
   `requireWalletSession(request, address)` and 401s if the cookie is
   missing, expired, tampered with, or issued for a different address.
   `POST /v1/auth/logout` clears the cookie. The session is intentionally
   **stateless** (no server-side session store) so it doesn't reintroduce
   the same "different serverless instances disagree" bug class as item
   #1 above — any instance can verify any session using only
   `HAZE_SESSION_SECRET`.
   **Required in production**: set `HAZE_SESSION_SECRET` in Vercel's
   Environment Variables (any long random string, e.g. `openssl rand -hex
   32`) — `walletAuth.ts` intentionally throws if it's unset outside
   local dev, rather than silently generating a different secret per
   instance. See `.env.example` for the full explanation. Local `npm run
   dev` needs no setup — it falls back to a fixed, clearly-labeled
   insecure dev secret.
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
first — particularly #1 (attach Postgres) and #2 (set
`HAZE_SESSION_SECRET`), which are now both config steps away rather than
code-writing projects.

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
    v1/auth/verify.ts                                POST /v1/auth/verify — wallet-signature sign-in
    v1/auth/logout.ts                                POST /v1/auth/logout — clears the session cookie
  server/                    framework-independent backend logic (ported from haze-backend)
    types.ts                             shared types/constants
    aggregation/{fingerprint,privacyLayer,scoring,store,controlsMapping}.ts
    indexer/{realIndexer,syntheticIndexer}.ts
    payments/{x402,meridian}.ts
    earnings/splitterSimulator.ts
    activity/activityLog.ts
    registryBridge/syncWeights.ts
    auth/walletAuth.ts       session cookie issuance/verification — see "Authentication" above
    db/client.ts             Postgres connection + lazy schema creation — see singletons.ts's persistence comment
    singletons.ts            shared store/simulator/log instances + seeding — READ THE COMMENT AT THE TOP
    cors.ts                  CORS helper for the two buyer-facing routes
  shared/                    code shared between client and server bundles
    authMessage.ts           builds the exact sign-in message string both sides must agree on
  components/, hooks/, lib/, content/   unchanged from the original frontend, plus lib/walletProviders.ts's new signInWithWallet()/getCoinbaseProvider()
```
