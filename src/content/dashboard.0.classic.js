
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

// Wallet address resolution, local-dev-friendly:
//   1. ?devWallet=0x... in the URL — lets you test against any seeded
//      wallet the backend printed on startup, no browser wallet needed.
//   2. window.ethereum (MetaMask-style injected provider), read silently
//      first (eth_accounts, no popup), then via eth_requestAccounts if the
//      user clicks the wallet indicator.
// There is no transaction signing here at all — this only ever reads an
// address. Real withdrawals need a wallet library (viem/wagmi) wired to
// the actual HazeSplitter contract; see the backend README.
let currentWallet = null

function getDevWalletOverride() {
  const params = new URLSearchParams(window.location.search)
  return params.get('devWallet')
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

async function requestWalletConnection() {
  const devWallet = getDevWalletOverride()
  if (devWallet) return devWallet // dev override always wins, no popup needed

  if (!window.ethereum) {
    setWalletDisplay('No wallet found')
    return null
  }
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
    return accounts && accounts[0] ? accounts[0] : null
  } catch (err) {
    console.warn('[Haze] wallet connection rejected', err)
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
            <div class="act-amount">+${formatUsd(e.priceUsdc * 0.8)}</div>
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

async function refreshEarningsAndActivity(address) {
  try {
    const [earnings, activity] = await Promise.all([getEarnings(address), getActivity(address)])
    renderEarnings(earnings)
    renderActivity(activity)
  } catch (err) {
    console.error('[Haze] refresh failed', err)
  }
}

async function initWallet() {
  setWalletDisplay('Connecting…')

  const devWallet = getDevWalletOverride()
  const silent = devWallet || (await getInjectedAccountSilently())

  if (silent) {
    currentWallet = silent
    loadDashboard(currentWallet)
    return
  }

  setWalletDisplay('Connect wallet', false)
  ;['sidebarAddr', 'topbarAddr'].forEach((id) => {
    const el = document.getElementById(id)
    if (!el) return
    el.style.cursor = 'pointer'
    el.addEventListener('click', async () => {
      const address = await requestWalletConnection()
      if (address) {
        currentWallet = address
        loadDashboard(currentWallet)
      }
    })
  })

  if (window.ethereum?.on) {
    window.ethereum.on('accountsChanged', (accounts) => {
      if (accounts[0]) {
        currentWallet = accounts[0]
        loadDashboard(currentWallet)
      } else {
        currentWallet = null
        setWalletDisplay('Connect wallet', false)
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
