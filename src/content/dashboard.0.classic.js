
// ============================================================================
// Haze dashboard <-> backend wiring
// ============================================================================
// API base URL: this placeholder is replaced by dashboard.tsx at render
// time with import.meta.env.VITE_HAZE_API_URL (falling back to
// http://localhost:8402) — see that file. It has to happen there, not
// here, because this script runs as a plain inline <script> tag (not an
// ES module), so import.meta.env isn't available inside it.
const HAZE_API_BASE = "__HAZE_API_BASE__"

// Maps this dashboard's data-control toggle ids to whether the backend
// currently supports excluding that category. Keep this in sync with
// haze-backend/src/aggregation/controlsMapping.js — three of six toggles
// (trading, risk, crossasset) aren't backed by an excludable fingerprint
// field yet, so they're shown disabled here rather than pretending to work.
const SUPPORTED_CONTROLS = { defi: true, equity: true, timing: true, trading: false, risk: false, crossasset: false }

// Wallet address resolution:
//   1. ?devWallet=0x... in the URL — lets you test against any seeded
//      wallet the backend printed on startup, no browser wallet needed.
//      Never goes through /v1/wallets/import (see connectRealWallet below)
//      — it's already a registered synthetic profile.
//   2. A real wallet — Coinbase Wallet (via the SDK) or any injected
//      wallet (MetaMask, Rainbow, Brave, etc., discovered via EIP-6963).
//      window.ethereum is read silently first (eth_accounts, no popup) to
//      restore a session without a click; otherwise the wallet indicator
//      opens a small chooser. See src/lib/walletProviders.ts (bridged onto
//      window.__hazeWallet by dashboard.tsx — this file is a plain inline
//      script, not a module, so it can't `import` that directly) for the
//      actual connection logic.
// A real wallet's address is registered with the backend via
// POST /v1/wallets/import before its dashboard data is loaded — see
// connectRealWallet(). There is no transaction signing anywhere in this
// file — it only ever reads an address. Real withdrawals still need the
// deployed HazeSplitter contract's ABI/address wired in; see the backend
// README's "what's NOT wired up" section.
let currentWallet = null

// Set right before the page navigates away after an explicit "Disconnect
// wallet" click (see disconnectCurrentWallet() below), and checked by
// initWallet() on the next load. Neither the Coinbase Wallet SDK nor a
// classic injected wallet (MetaMask, etc.) can be told to truly forget a
// site the way a server-side session can be logged out of — the wallet
// extension still knows this site was authorized, so a plain
// `eth_accounts` check on the next page load would silently reconnect the
// same address again. This flag is what makes "sign out" actually stick
// from the dashboard's point of view: initWallet() skips the silent
// reconnect while it's set, and any explicit connect (picking a wallet
// from the menu, or the accountsChanged listener) clears it again.
const WALLET_DISCONNECTED_KEY = 'haze:walletDisconnected'

function getDevWalletOverride() {
  const params = new URLSearchParams(window.location.search)
  return params.get('devWallet')
}

function getWalletDisconnectedFlag() {
  try {
    return localStorage.getItem(WALLET_DISCONNECTED_KEY) === '1'
  } catch {
    return false
  }
}

function setWalletDisconnectedFlag(value) {
  try {
    if (value) localStorage.setItem(WALLET_DISCONNECTED_KEY, '1')
    else localStorage.removeItem(WALLET_DISCONNECTED_KEY)
  } catch {
    // Private mode / storage disabled — the flag just won't survive a
    // reload in that case, which only means the silent-reconnect skip
    // below doesn't persist; the button itself still works this session.
  }
}

async function getInjectedAccountSilently() {
  if (!window.ethereum) return null
  try {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' })
    return accounts && accounts[0] ? accounts[0] : null
  } catch {
    return null
  }
}

function shortenAddress(address) {
  if (!address) return 'Not connected'
  return address.slice(0, 6) + '…' + address.slice(-4)
}

function setWalletDisplay(text, connected = false) {
  const sidebar = document.getElementById('sidebarAddr')
  const topbar = document.getElementById('topbarAddr')
  if (sidebar) sidebar.textContent = text
  if (topbar) topbar.textContent = text
  document.querySelectorAll('.sb-wallet-dot, .topbar-dot').forEach((dot) => {
    dot.style.background = connected ? 'var(--green)' : ''
  })
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function hazeFetch(path, options) {
  const res = await fetch(HAZE_API_BASE + path, options)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(`${path} -> ${res.status}: ${body.message || body.error || 'request failed'}`)
  }
  return res.json()
}

// Wallet-independent protocol constants (query price, wallet-owner revenue
// share) for the "Protocol stats" card — see renderProtocolStats() below.
// Real backend values (health.js), not the hardcoded numbers this card
// used to have baked into dashboard.html (including a stale $0.01 that
// didn't even match the server's actual default of $0.02).
function getHealth() {
  return hazeFetch('/health')
}
function getProfile(address) {
  return hazeFetch(`/v1/wallets/${address}/profile`)
}
function getEarnings(address) {
  return hazeFetch(`/v1/wallets/${address}/earnings`)
}
function getEarningsHistory(address, range) {
  return hazeFetch(`/v1/wallets/${address}/earnings/history?range=${range}`)
}
function getActivity(address) {
  return hazeFetch(`/v1/wallets/${address}/activity`)
}
function postControl(address, control, enabled) {
  return hazeFetch(`/v1/wallets/${address}/controls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ control, enabled }),
  })
}
function postWithdraw(address) {
  return hazeFetch(`/v1/wallets/${address}/withdraw`, { method: 'POST' })
}
// Registers (or refreshes) a real wallet's profile from its actual
// Robinhood Chain history — see haze-backend's POST /v1/wallets/import.
// Response includes `dataGaps`: fields the indexer couldn't honestly
// compute yet (DeFi usage, sector preferences, ...) — see
// maybeShowDataGapsNotice() below for where that surfaces in the UI.
function importWallet(address) {
  return hazeFetch(`/v1/wallets/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
  })
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function formatUsd(n) {
  return '$' + (n ?? 0).toFixed(2)
}

function renderEarnings(earnings) {
  const totalEl = document.getElementById('totalEarned')
  const todayEl = document.getElementById('todayEarned')
  const monthEl = document.getElementById('monthEarned')
  const withdrawEl = document.getElementById('withdrawBal')
  const earnSubEl = document.getElementById('earnSub')

  if (totalEl) totalEl.textContent = formatUsd(earnings.totalEarnedUsdc)
  if (todayEl) todayEl.textContent = formatUsd(earnings.todayEarnedUsdc)
  if (monthEl) monthEl.textContent = formatUsd(earnings.monthEarnedUsdc)
  if (withdrawEl) withdrawEl.textContent = formatUsd(earnings.withdrawableUsdc)
  if (earnSubEl) earnSubEl.textContent = 'From anonymized behavioral data queries'
}

function renderProtocolStats(health) {
  const shareEl = document.getElementById('protoRevenueShare')
  const priceEl = document.getElementById('protoQueryPrice')
  if (shareEl) shareEl.textContent = Math.round(health.walletOwnerSharePct) + '%'
  if (priceEl) priceEl.textContent = formatUsd(health.priceUsdc)
}

// Wallet-independent, so this runs once on load rather than inside
// loadDashboard()/initWallet() — it has nothing to do with which wallet
// (if any) is connected. Best-effort: a failure here shouldn't block
// wallet connection or dashboard data, so it's isolated in its own catch.
getHealth()
  .then(renderProtocolStats)
  .catch((err) => console.error('[Haze] failed to load protocol stats', err))

const FP_ROW_ORDER = ['traderType', 'assetAllocationStyle', 'riskProfile', 'defiUsage', 'equityBehavior', 'crossAssetBehavior', 'reactivity']

function renderProfile(profile) {
  const scoreNum = document.getElementById('scoreNum')
  const scoreRing = document.getElementById('scoreRing')
  if (scoreNum) scoreNum.textContent = String(profile.profileStrength)
  if (scoreRing) {
    const circumference = 327 // matches the fixed stroke-dasharray already in the SVG
    const offset = circumference - (profile.profileStrength / 100) * circumference
    scoreRing.style.strokeDashoffset = String(offset)
  }

  const rows = document.querySelectorAll('#fpBars .fp-row')
  rows.forEach((row, i) => {
    const key = FP_ROW_ORDER[i]
    if (!key) return
    const pct = Math.round(profile.fingerprintBars[key] ?? 0)
    const fill = row.querySelector('.fp-fill')
    const label = row.querySelector('.fp-pct')
    if (fill) {
      fill.dataset.width = String(pct)
      fill.style.width = pct + '%'
    }
    if (label) label.textContent = pct + '%'
  })

  // Sync the Data Controls toggles to the profile's actual exclusions, and
  // disable the three not-yet-supported ones so the UI doesn't imply they
  // work — see SUPPORTED_CONTROLS above.
  document.querySelectorAll('.toggle input[data-control]').forEach((input) => {
    const control = input.dataset.control
    const supported = SUPPORTED_CONTROLS[control]
    input.disabled = !supported
    input.closest('.toggle').style.opacity = supported ? '1' : '0.45'
    input.closest('.toggle').style.cursor = supported ? 'pointer' : 'not-allowed'
    if (supported) {
      const category = CONTROL_CATEGORY_LOOKUP[control]
      input.checked = !profile.excludedCategories.includes(category)
    }
  })
}

// Mirrors controlsMapping.js — only needed client-side to read initial
// toggle state back out of excludedCategories.
const CONTROL_CATEGORY_LOOKUP = { defi: 'defi_usage', equity: 'equity_trading', timing: 'spending_rhythm' }

function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return minutes + 'm ago'
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours + 'h ago'
  return Math.floor(hours / 24) + 'd ago'
}

const BUYER_LABELS = {
  trading_agent: 'Trading agent',
  research_agent: 'Research agent',
  analytics_firm: 'Analytics firm',
  other: 'Other buyer',
}

function renderActivity(activity) {
  const list = document.getElementById('activityList')
  if (list) {
    if (activity.recent.length === 0) {
      list.innerHTML = `
        <div class="empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          <h4>No activity yet</h4>
          <p>Queries will appear here in real time once your profile is live</p>
        </div>`
    } else {
      list.innerHTML = activity.recent
        .map(
          (e) => `
        <div class="act-item">
          <div class="act-left">
            <div class="act-icon query">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </div>
            <div>
              <div class="act-type">${BUYER_LABELS[e.buyerType] || 'Query'}</div>
              <div class="act-detail">Anonymized cohort query</div>
            </div>
          </div>
          <div class="act-right">
            <div class="act-amount">+${formatUsd(e.myShareUsdc)}</div>
            <div class="act-time">${timeAgo(e.timestamp)}</div>
          </div>
        </div>`,
        )
        .join('')
    }
  }

  const qb = activity.breakdown
  const bars = [
    ['qbTrading', qb.tradingAgentsPct],
    ['qbResearch', qb.researchAgentsPct],
    ['qbAnalytics', qb.analyticsFirmsPct],
    ['qbOther', qb.otherPct],
  ]
  bars.forEach(([id, pct]) => {
    const fill = document.getElementById(id)
    if (!fill) return
    fill.style.width = pct + '%'
    const label = fill.closest('.fp-row')?.querySelector('.fp-pct')
    if (label) label.textContent = pct.toFixed(0) + '%'
  })
}

function buildChartGeometry(points) {
  const width = 600
  const top = 10
  const bottom = 160

  if (!points.length) {
    return {
      line: `0,${bottom} ${width},${bottom}`,
      area: `0,${bottom} ${width},${bottom} ${width},180 0,180`,
      yLabels: ['$0.00', '$0.00', '$0.00'],
      xLabels: ['', '', '', '', '', 'Today'],
    }
  }

  const max = Math.max(...points.map((p) => p.cumulativeUsdc), 0.01)
  const coords = points.map((p, i) => {
    const x = points.length === 1 ? width : (i / (points.length - 1)) * width
    const y = bottom - (p.cumulativeUsdc / max) * (bottom - top)
    return [x, y]
  })
  if (coords.length === 1) coords.unshift([0, bottom])

  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${coords[0][0]},${bottom} ${line} ${width},${bottom}`

  const xLabels = []
  const xCount = 6
  for (let i = 0; i < xCount; i++) {
    if (i === xCount - 1) {
      xLabels.push('Today')
      continue
    }
    const idx = Math.round((i / (xCount - 1)) * (points.length - 1))
    const ts = points[idx]?.timestamp
    xLabels.push(ts ? new Date(ts).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) : '')
  }

  return { line, area, yLabels: [formatUsd(max), formatUsd(max / 2), formatUsd(0)], xLabels }
}

function renderChart(points) {
  const geometry = buildChartGeometry(points)

  const lineEl = document.querySelector('.sparkline-line')
  const areaEl = document.querySelector('.chart-area polygon.area')
  if (lineEl) lineEl.setAttribute('points', geometry.line)
  if (areaEl) areaEl.setAttribute('points', geometry.area)

  const yLabelEls = document.querySelectorAll('#chartArea > div:first-child span')
  yLabelEls.forEach((el, i) => (el.textContent = geometry.yLabels[i] ?? ''))

  // The x-axis label row is the LAST child div inside #chartArea (after
  // the y-axis label div and the svg) — not a sibling of #chartArea.
  const xLabelContainer = document.querySelector('#chartArea > div:last-child')
  if (xLabelContainer) {
    xLabelContainer.querySelectorAll('span').forEach((el, i) => (el.textContent = geometry.xLabels[i] ?? ''))
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function loadDashboard(address) {
  setWalletDisplay(shortenAddress(address), true)

  try {
    const [profile, earnings, activity, history] = await Promise.all([
      getProfile(address),
      getEarnings(address),
      getActivity(address),
      getEarningsHistory(address, '30d'),
    ])
    renderProfile(profile)
    renderEarnings(earnings)
    renderActivity(activity)
    renderChart(history.points)
  } catch (err) {
    console.error('[Haze] failed to load dashboard data', err)
    const earnSubEl = document.getElementById('earnSub')
    if (earnSubEl) earnSubEl.textContent = 'Could not reach the Haze API — is the backend running?'
  }
}

// Resets every wallet-dependent panel to a neutral "nothing connected"
// state. Called right after disconnectCurrentWallet() so a signed-out
// dashboard doesn't keep showing the previous wallet's numbers, which
// would otherwise look like it's still connected (or worse, like a new
// wallet inherited the old one's data).
function clearDashboardState() {
  renderEarnings({ totalEarnedUsdc: 0, todayEarnedUsdc: 0, monthEarnedUsdc: 0, withdrawableUsdc: 0 })
  renderProfile({ profileStrength: 0, fingerprintBars: {}, excludedCategories: [] })
  renderActivity({
    recent: [],
    breakdown: { tradingAgentsPct: 0, researchAgentsPct: 0, analyticsFirmsPct: 0, otherPct: 0 },
  })
  renderChart([])
  const earnSubEl = document.getElementById('earnSub')
  if (earnSubEl) earnSubEl.textContent = 'Connect a wallet to see your earnings'
  maybeShowDataGapsNotice(null)
  const devBanner = document.getElementById('devWalletBanner')
  if (devBanner) devBanner.hidden = true
}

async function refreshEarningsAndActivity(address) {
  try {
    const [earnings, activity] = await Promise.all([getEarnings(address), getActivity(address)])
    renderEarnings(earnings)
    renderActivity(activity)
  } catch (err) {
    console.error('[Haze] refresh failed', err)
  }
}

// ---------------------------------------------------------------------------
// Real wallet connection (Coinbase Wallet + injected/EIP-6963 wallets)
// ---------------------------------------------------------------------------
// window.__hazeWallet is bridged in by dashboard.tsx, a real ES module —
// see the comment at the top of this file for why that has to happen
// there instead of here.

function haze() {
  return window.__hazeWallet || null
}

function closeWalletMenu() {
  const existing = document.getElementById('walletMenu')
  if (existing) existing.remove()
  document.removeEventListener('click', onDocumentClickCloseMenu, true)
}

function onDocumentClickCloseMenu(e) {
  const menu = document.getElementById('walletMenu')
  if (menu && !menu.contains(e.target)) closeWalletMenu()
}

function addWalletMenuItem(menu, label, icon, onClick) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'wallet-menu-item'
  if (icon) {
    const img = document.createElement('img')
    img.src = icon
    img.alt = ''
    img.className = 'wallet-menu-icon'
    btn.appendChild(img)
  }
  const span = document.createElement('span')
  span.textContent = label
  btn.appendChild(span)
  btn.addEventListener('click', async () => {
    closeWalletMenu()
    setWalletDisplay('Connecting…')
    const address = await onClick()
    if (address) {
      await connectRealWallet(address)
    } else {
      setWalletDisplay('Connect wallet', false)
    }
  })
  menu.appendChild(btn)
}

// Like addWalletMenuItem, but for an action that isn't "connect to this
// address" (currently just "Disconnect wallet") — it runs onClick()
// directly instead of feeding its return value into connectRealWallet().
function addWalletMenuAction(menu, label, onClick, className) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = className ? `wallet-menu-item ${className}` : 'wallet-menu-item'
  const span = document.createElement('span')
  span.textContent = label
  btn.appendChild(span)
  btn.addEventListener('click', async () => {
    closeWalletMenu()
    await onClick()
  })
  menu.appendChild(btn)
}

// Opens a small popover next to the clicked wallet indicator listing
// Coinbase Wallet plus every injected wallet the page can see (MetaMask,
// Rainbow, Brave, etc. — via EIP-6963; window.ethereum alone only ever
// exposes one provider when several extensions are installed).
async function openWalletMenu(anchorEl) {
  closeWalletMenu()
  const bridge = haze()

  const menu = document.createElement('div')
  menu.id = 'walletMenu'
  menu.className = 'wallet-menu'
  const rect = anchorEl.getBoundingClientRect()
  menu.style.left = `${Math.round(Math.min(rect.left, window.innerWidth - 216))}px`

  // The wallet indicator lives at the bottom of the sidebar on desktop, so
  // opening the menu downward (the old default) pushed most of it off the
  // bottom of the window — the "Disconnect wallet" item especially was
  // never reachable. Open upward (anchored above the button, growing
  // toward the top of the screen) whenever there isn't comfortably enough
  // room below the button for the menu's contents; a rough ceiling on menu
  // height (up to ~5 wallet entries plus the divider + disconnect row)
  // is good enough here since this is just picking a direction, not laying
  // out anything pixel-precise.
  const spaceBelow = window.innerHeight - rect.bottom
  const MENU_MAX_HEIGHT_ESTIMATE = 260
  if (spaceBelow < MENU_MAX_HEIGHT_ESTIMATE) {
    menu.style.bottom = `${Math.round(window.innerHeight - rect.top + 8)}px`
  } else {
    menu.style.top = `${Math.round(rect.bottom + 8)}px`
  }

  if (!bridge) {
    menu.innerHTML = '<div class="wallet-menu-empty">Wallet connect unavailable — reload the page</div>'
    document.body.appendChild(menu)
    setTimeout(() => document.addEventListener('click', onDocumentClickCloseMenu, true), 0)
    return
  }

  menu.innerHTML = '<div class="wallet-menu-empty">Loading wallets…</div>'
  document.body.appendChild(menu)
  setTimeout(() => document.addEventListener('click', onDocumentClickCloseMenu, true), 0)

  const injected = await bridge.discoverInjectedProviders()
  menu.innerHTML = ''
  addWalletMenuItem(menu, 'Coinbase Wallet', null, () => bridge.connectCoinbaseWallet())
  // The Coinbase Wallet browser extension (when installed) also announces
  // itself via EIP-6963, same as any other injected wallet — without this
  // filter it showed up a second time in this same list, right below the
  // "Coinbase Wallet" entry the line above already always adds via the SDK
  // path. Anything whose name/rdns identifies it as Coinbase is skipped
  // here so it only ever appears once.
  const nonCoinbaseInjected = injected.filter((detail) => {
    const name = (detail.info?.name || '').toLowerCase()
    const rdns = (detail.info?.rdns || '').toLowerCase()
    return !name.includes('coinbase') && !rdns.includes('coinbase')
  })
  if (nonCoinbaseInjected.length > 0) {
    for (const detail of nonCoinbaseInjected) {
      addWalletMenuItem(menu, detail.info.name, detail.info.icon, () => bridge.connectInjectedProvider(detail))
    }
  } else if (bridge.getLegacyInjectedProvider()) {
    addWalletMenuItem(menu, 'Browser wallet', null, () => bridge.connectInjectedProvider())
  }

  // "Sign out" — only offered when a real wallet is actually connected.
  // A ?devWallet= session isn't a real connection (see
  // getDevWalletOverride()), so there's nothing to disconnect; the way
  // out of dev mode is removing the query param, same as today.
  if (currentWallet && !getDevWalletOverride()) {
    const divider = document.createElement('div')
    divider.className = 'wallet-menu-divider'
    menu.appendChild(divider)
    addWalletMenuAction(menu, 'Disconnect wallet', disconnectCurrentWallet, 'wallet-menu-item-danger')
  }
}

// Signs the user out of the currently connected wallet: best-effort tells
// the wallet provider to drop this site's permission (see
// disconnectWallet() in walletProviders.ts for exactly what that does and
// doesn't accomplish), clears local state, resets the dashboard's panels,
// and sets the "don't silently reconnect" flag so a page reload doesn't
// immediately log the same wallet back in via eth_accounts.
async function disconnectCurrentWallet() {
  const bridge = haze()
  const provider = bridge?.getLegacyInjectedProvider?.()
  try {
    await bridge?.disconnectWallet?.(provider)
  } catch (err) {
    console.warn('[Haze] wallet disconnect failed', err)
  }

  currentWallet = null
  setWalletDisconnectedFlag(true)
  setWalletDisplay('Connect wallet', false)
  clearDashboardState()
}

// Shows the "this whole page is fake seeded test data" banner for a
// ?devWallet= session — unmissable and distinct from
// maybeShowDataGapsNotice() below, which is for a REAL wallet missing a
// few fields, not an entirely synthetic one. See dashboard.html for the
// element and dashboard.css for why it's styled the way it is.
function showDevWalletBanner(address) {
  const el = document.getElementById('devWalletBanner')
  if (!el) return
  el.innerHTML =
    '<strong>Dev mode</strong> — showing fake seeded data for <code>' +
    shortenAddress(address) +
    '</code>, not a real wallet. Remove <code>?devWallet=</code> from the URL to connect a real wallet.'
  el.hidden = false
}

// Shows (or hides) the "some fields are placeholders" banner — see
// haze-backend's POST /v1/wallets/import `dataGaps` field. Only ever
// called for real wallets; ?devWallet= sessions pass null and hide it,
// since seeded synthetic profiles have every field populated already.
function maybeShowDataGapsNotice(dataGaps) {
  const el = document.getElementById('dataGapsNotice')
  if (!el) return
  if (!dataGaps || dataGaps.length === 0) {
    el.hidden = true
    return
  }
  el.innerHTML =
    '<strong>Some fields are placeholders.</strong> This wallet was just imported from real Robinhood Chain activity — a few fingerprint fields (DeFi usage, sector preferences, and others) aren’t wired to real on-chain data yet. See the backend README for what’s real today.'
  el.hidden = false
}

// Registers the address with the backend (POST /v1/wallets/import, which
// indexes its real Robinhood Chain history) before loading dashboard data
// for it — a freshly-connected real wallet has no profile yet, unlike a
// ?devWallet= address, which is already a seeded synthetic profile. Also
// idempotent: calling it again for an already-known wallet just refreshes
// it from fresh activity, so re-clicking the wallet indicator to
// reconnect the same wallet doubles as a manual refresh.
async function connectRealWallet(address) {
  currentWallet = address
  setWalletDisconnectedFlag(false)
  setWalletDisplay('Importing wallet…', false)
  let importResult
  try {
    importResult = await importWallet(address)
  } catch (err) {
    console.error('[Haze] wallet import failed', err)
    setWalletDisplay('Import failed — click to retry', false)
    return
  }
  maybeShowDataGapsNotice(importResult.dataGaps)
  await getEthChainSwitchBestEffort()
  loadDashboard(currentWallet)
}

// Best-effort prompt to switch/add Robinhood Chain on whichever provider
// is currently connected — purely so a later real transaction (e.g. an
// actual withdraw, once that's wired) would already be on the right
// network. Never blocks loading the dashboard if it fails or the user
// declines; see ensureRobinhoodChain()'s own doc comment.
async function getEthChainSwitchBestEffort() {
  const bridge = haze()
  const provider = bridge?.getLegacyInjectedProvider?.()
  if (!bridge || !provider) return
  try {
    await bridge.ensureRobinhoodChain(provider)
  } catch (err) {
    console.warn('[Haze] chain switch prompt failed', err)
  }
}

async function initWallet() {
  setWalletDisplay('Connecting…')

  const devWallet = getDevWalletOverride()
  if (devWallet) {
    currentWallet = devWallet
    showDevWalletBanner(devWallet)
    maybeShowDataGapsNotice(null)
    loadDashboard(currentWallet)
    return
  }

  // Skip the silent eth_accounts reconnect if the user explicitly signed
  // out last time (see disconnectCurrentWallet()) — otherwise the wallet
  // extension, which still considers this site authorized, would just log
  // them back in on this next load without them clicking anything.
  const silent = getWalletDisconnectedFlag() ? null : await getInjectedAccountSilently()
  if (silent) {
    await connectRealWallet(silent)
  } else {
    setWalletDisplay('Connect wallet', false)
  }

  ;['sidebarAddr', 'topbarAddr'].forEach((id) => {
    const el = document.getElementById(id)
    if (!el) return
    el.style.cursor = 'pointer'
    el.addEventListener('click', (e) => {
      openWalletMenu(e.currentTarget)
    })
  })

  if (window.ethereum?.on) {
    window.ethereum.on('accountsChanged', (accounts) => {
      if (getDevWalletOverride()) return // dev override always wins
      if (accounts[0]) {
        connectRealWallet(accounts[0])
      } else {
        // The wallet extension itself disconnected/locked (not our
        // "Disconnect wallet" button, which already handles its own
        // state) — mirror the same reset so the dashboard doesn't keep
        // showing stale data for a wallet that's no longer connected.
        currentWallet = null
        setWalletDisplay('Connect wallet', false)
        clearDashboardState()
      }
    })
  }
}

initWallet()

// Chart tab switching — refetches real history for the selected range.
document.querySelectorAll('.chart-tab').forEach((tab) => {
  tab.addEventListener('click', async () => {
    document.querySelectorAll('.chart-tab').forEach((t) => t.classList.remove('active'))
    tab.classList.add('active')
    if (!currentWallet) return
    try {
      const history = await getEarningsHistory(currentWallet, tab.dataset.range)
      renderChart(history.points)
    } catch (err) {
      console.error('[Haze] failed to load chart range', tab.dataset.range, err)
    }
  })
})

// Data control toggles — POSTs to /controls; unsupported ones are
// disabled in renderProfile() so this only fires for supported controls.
document.querySelectorAll('.toggle input[data-control]').forEach((input) => {
  input.addEventListener('change', async () => {
    if (!currentWallet) return
    const control = input.dataset.control
    const enabled = input.checked
    try {
      const result = await postControl(currentWallet, control, enabled)
      if (!result.applied) {
        console.warn(`[Haze] control "${control}" not applied:`, result.reason)
        input.checked = !enabled // revert
        return
      }
      console.log(`[Haze] Data control "${control}" → ${enabled ? 'enabled' : 'disabled'}`)
      const profile = await getProfile(currentWallet)
      renderProfile(profile)
    } catch (err) {
      console.error('[Haze] failed to update control', control, err)
      input.checked = !enabled // revert on error too
    }
  })
})

// Withdraw button — DEV SIMULATION ONLY. A real withdrawal is a
// client-signed transaction against HazeSplitter.claim(), which needs a
// wallet library (viem/wagmi) this frontend doesn't have yet. This calls
// the backend's simulated /withdraw endpoint so the button isn't dead
// during local development — see the backend README before relying on it
// for anything real.
const withdrawBtn = document.getElementById('withdrawBtn')
if (withdrawBtn) {
  withdrawBtn.addEventListener('click', async () => {
    if (!currentWallet) return
    const originalText = withdrawBtn.textContent
    withdrawBtn.textContent = 'Withdrawing…'
    withdrawBtn.disabled = true
    try {
      const result = await postWithdraw(currentWallet)
      console.log(`[Haze] Withdrew ${result.withdrawnUsdc} USDC (simulated)`)
      await refreshEarningsAndActivity(currentWallet)
      withdrawBtn.textContent = 'Withdrawn ✓'
    } catch (err) {
      console.error('[Haze] withdraw failed', err)
      withdrawBtn.textContent = 'Failed — retry'
    } finally {
      withdrawBtn.disabled = false
      setTimeout(() => (withdrawBtn.textContent = originalText), 2500)
    }
  })
}

// Animate fingerprint bars on load
setTimeout(()=>{
  document.querySelectorAll('#fpBars .fp-fill').forEach(el=>{
    el.style.width=el.dataset.width+'%'
  })
},400)

// Sidebar + bottom nav — scroll to section, update active state and page title
const pageNames = {
  overview: 'Dashboard',
  activity: 'Activity',
  earnings: 'Earnings',
  data: 'Data Controls',
  profile: 'Profile'
}
const pageDescs = {
  overview: 'Your behavioral data earnings at a glance',
  activity: 'Recent queries and settlements',
  earnings: 'Earnings history and trends',
  data: 'Control what data your profile shares',
  profile: 'Your profile and protocol stats'
}

function navigateTo(page) {
  document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'))
  document.querySelectorAll('.bn-item').forEach(i => i.classList.remove('active'))
  document.querySelectorAll(`[data-page="${page}"]`).forEach(i => i.classList.add('active'))

  const h1 = document.querySelector('.page-head h1')
  const p = document.querySelector('.page-head p')
  if (h1) h1.textContent = pageNames[page] || 'Dashboard'
  if (p) p.textContent = pageDescs[page] || ''

  const section = document.getElementById('sec-' + page)
  if (section) {
    const main = document.querySelector('.main')
    const offset = section.offsetTop - 120
    main.scrollTo({ top: offset, behavior: 'smooth' })
  }
}

document.querySelectorAll('.sb-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault()
    navigateTo(item.dataset.page)
  })
})

document.querySelectorAll('.bn-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault()
    navigateTo(item.dataset.page)
  })
})

// Scroll spy — update active nav as user scrolls
const mainEl = document.querySelector('.main')
const sections = ['overview','earnings','activity','data','profile']
mainEl.addEventListener('scroll', () => {
  const scrollTop = mainEl.scrollTop + 160
  let current = 'overview'
  for (const id of sections) {
    const el = document.getElementById('sec-' + id)
    if (el && el.offsetTop <= scrollTop) current = id
  }
  document.querySelectorAll('.sb-item').forEach(i => i.classList.toggle('active', i.dataset.page === current))
  document.querySelectorAll('.bn-item').forEach(i => i.classList.toggle('active', i.dataset.page === current))
})

// Periodic refresh — polling rather than a websocket, since the backend
// doesn't have one (see haze-backend README). Every 5s is fine for a
// dashboard that isn't showing sub-second data; swap for a websocket
// later if that changes.
setInterval(() => {
  if (currentWallet) refreshEarningsAndActivity(currentWallet)
}, 5000)
