import { createFileRoute } from "@tanstack/react-router";
import { RawPage } from "@/components/RawPage";
import css from "@/content/dashboard.css?raw";
import html from "@/content/dashboard.html?raw";
import script0Raw from "@/content/dashboard.0.classic.js?raw";
import {
  connectCoinbaseWallet,
  connectInjectedProvider,
  discoverInjectedProviders,
  disconnectWallet,
  ensureRobinhoodChain,
  getLegacyInjectedProvider,
  openMetaMaskInstallLink,
} from "@/lib/walletProviders";

// dashboard.0.classic.js runs as a plain inline <script> tag, not an ES
// module, so it has no access to import.meta.env itself. This is the one
// place that IS a real module (Vite processes this file), so the API
// base URL substitution happens here.
//
// The backend used to be a separately-hosted service (see the old
// haze-backend repo), so this defaulted to http://localhost:8402. Now
// that the API lives in this same project as TanStack Start server
// routes (see src/routes/v1/**), the default is "" — a same-origin
// relative path (fetch('' + '/v1/...') === fetch('/v1/...')), so it
// works unmodified on localhost, preview deployments, and production.
// Set VITE_HAZE_API_URL only if you deliberately want the dashboard to
// call a *different*, separately-hosted backend instead.
const HAZE_API_BASE = import.meta.env.VITE_HAZE_API_URL ?? "";
const script0 = script0Raw.replace('"__HAZE_API_BASE__"', JSON.stringify(HAZE_API_BASE));

// Same reasoning as above, one level further: real wallet connection
// (Coinbase Wallet SDK, EIP-6963 discovery of MetaMask/other injected
// wallets) needs real npm packages, which only work from an actual ES
// module. dashboard.0.classic.js can't `import` them, so this module
// bridges the functions onto `window` before the classic script runs —
// it reads them at click time via window.__hazeWallet, not at import
// time, so ordering just needs this module to have evaluated first, which
// it always has (this file is what renders the <script> tag in the first
// place). See src/lib/walletProviders.ts for what each function does.
if (typeof window !== "undefined") {
  (window as unknown as { __hazeWallet: Record<string, unknown> }).__hazeWallet = {
    connectCoinbaseWallet,
    connectInjectedProvider,
    discoverInjectedProviders,
    disconnectWallet,
    ensureRobinhoodChain,
    getLegacyInjectedProvider,
    openMetaMaskInstallLink,
  };
}

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Haze" },
      {
        name: "description",
        content:
          "Track your Haze earnings, wallet activity, data streams and payouts in one live dashboard.",
      },
      { property: "og:title", content: "Dashboard — Haze" },
      {
        property: "og:description",
        content: "Track your Haze earnings, activity and payouts in one live dashboard.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  return <RawPage css={css} html={html} scripts={[{ code: script0 }]} />;
}
