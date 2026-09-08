
// Animate fingerprint bars on load
setTimeout(()=>{
  document.querySelectorAll('#fpBars .fp-fill').forEach(el=>{
    el.style.width=el.dataset.width+'%'
  })
},400)

// Chart tab switching (UI only — backend wires data)
document.querySelectorAll('.chart-tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.chart-tab').forEach(t=>t.classList.remove('active'))
    tab.classList.add('active')
    // Backend: fetch data for tab.dataset.range and update chart SVG
  })
})

// Toggle controls (UI only — backend wires state)
document.querySelectorAll('.toggle input').forEach(input=>{
  input.addEventListener('change',()=>{
    const control=input.dataset.control
    const enabled=input.checked
    // Backend: POST /api/controls { control, enabled }
    console.log(`[Haze] Data control "${control}" → ${enabled?'enabled':'disabled'}`)
  })
})

// Withdraw button (UI only — backend wires transaction)
document.getElementById('withdrawBtn').addEventListener('click',()=>{
  // Backend: POST /api/withdraw — initiate USDG withdrawal via Meridian
  console.log('[Haze] Withdraw requested')
})

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
  // Update active states
  document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'))
  document.querySelectorAll('.bn-item').forEach(i => i.classList.remove('active'))
  document.querySelectorAll(`[data-page="${page}"]`).forEach(i => i.classList.add('active'))

  // Update page header
  const h1 = document.querySelector('.page-head h1')
  const p = document.querySelector('.page-head p')
  if (h1) h1.textContent = pageNames[page] || 'Dashboard'
  if (p) p.textContent = pageDescs[page] || ''

  // Scroll to section
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
// On message, update todayEarned, totalEarned, monthEarned, withdrawBal
// and append new items to activityList
// Example:
// ws.onmessage = (e) => {
//   const data = JSON.parse(e.data)
//   document.getElementById('totalEarned').textContent = '$' + data.totalEarned.toFixed(2)
//   document.getElementById('todayEarned').textContent = '$' + data.todayEarned.toFixed(2)
//   document.getElementById('monthEarned').textContent = '$' + data.monthEarned.toFixed(2)
//   document.getElementById('withdrawBal').textContent = '$' + data.withdrawable.toFixed(2)
// }
