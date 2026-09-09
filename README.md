# Your Online Home

build my site

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/9f4b510f-9e16-4757-bb5f-ec63f287eca3).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Backend integration (Haze dashboard)

`/dashboard` (`src/routes/dashboard.tsx` + `src/content/dashboard.*`) is
wired to the `haze-backend` API — see `../haze-backend/README.md` for
what that serves. To run the dashboard against it locally:

```sh
# in a separate terminal, from the haze-backend project:
cd ../haze-backend && npm run dev
# prints a seeded wallet address and starts the API on :8402

# then run this frontend as usual, and visit:
http://localhost:<vite-port>/dashboard?devWallet=<the address it printed>
```

The `?devWallet=` query param is a local-dev-only override that skips
needing a browser wallet extension — see the comment block at the top of
`dashboard.0.classic.js`. Without it, the dashboard tries `window.ethereum`
(MetaMask-style) and falls back to a "Connect wallet" prompt.

To point at a non-local backend, set `VITE_HAZE_API_URL` — copy
`.env.example` to `.env.local`.

**Known gaps, carried over honestly from the backend:**
- Three of the six Data Controls toggles (`trading`, `risk`, `crossasset`)
  are shown disabled — they aren't backed by an excludable data category
  in the backend yet. See `haze-backend/src/aggregation/controlsMapping.js`.
- Earnings and the Withdraw button run against a backend *simulation* of
  `HazeSplitter`'s on-chain economics, not the real deployed contract. A
  real withdrawal needs a wallet library (viem/wagmi, not included here)
  signing a transaction against the actual contract in `protocol-contracts/`.
- There's no authentication on the wallet routes — see the backend
  README's "Security" section before this goes anywhere real.
- No websocket — the dashboard polls every 5s. Fine for now, worth
  revisiting if the data needs to feel more "live."
