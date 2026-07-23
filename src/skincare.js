/* ---------- skincare engine: pure, no React ----------
 * Frequency-aware guided skincare planner. All state is derived from the
 * day logs (state.days[iso].skincare.{am,pm}.steps[id] === 'done'), so it
 * works offline and survives sync — no separate mutable "lastDone".
 */

// Product catalog. `when`: 'am' | 'pm' | 'both'. `kind`: 'daily' | 'active' | 'shave'.
// Actives carry an `unlock` week and (when scheduled) a `days` weekday list (0=Sun..6=Sat).
export const PRODUCTS = [
  { id: 'cleanser', name: 'Gentle cleanser', when: 'both', kind: 'daily', suggest: 'Non-stripping — CeraVe Hydrating or Vanicream' },
  { id: 'moisturizer', name: 'Moisturizer', when: 'both', kind: 'daily', why: 'buffers the actives, treats surface dehydration', suggest: 'Lightweight — CeraVe PM, Vanicream, or La Roche-Posay Double Repair' },
  { id: 'spf', name: 'SPF 30-50', when: 'am', kind: 'daily', why: 'without it pigmentation lingers and the retinoid works less', suggest: 'Daily SPF 30-50, reapply if outdoors' },
  { id: 'guasha', name: 'Gua sha', when: 'pm', kind: 'daily' },
  { id: 'eyeserum', name: 'Caffeine eye serum', when: 'both', kind: 'daily', why: 'dark circles' },
  { id: 'vitc', name: 'Vitamin C serum', when: 'am', kind: 'active', unlock: 2, optional: true, why: 'antioxidant, brightening (optional)' },
  { id: 'niacinamide', name: 'Niacinamide 10%', when: 'am', kind: 'active', unlock: 1, optional: true, why: 'pigmentation, oil control (optional)' },
  // Priority #1 for the nose: BHA runs 2-3 nights/week, on the nights adapalene doesn't.
  { id: 'bha', name: 'BHA 2% (salicylic acid)', when: 'pm', kind: 'active', unlock: 2, days: [1, 4], cap: 2, why: 'the nose — sebaceous filaments and congestion; the single biggest win', suggest: "Paula's Choice 2% BHA, The Ordinary Salicylic Acid 2%, or CeraVe Acne Control" },
  // Priority #2: adapalene, ramped up over weeks (see activeSchedule).
  { id: 'retinoid', name: 'Adapalene 0.1% (Differin)', when: 'pm', kind: 'active', unlock: 3, days: [2, 5, 0], cap: 3, why: 'prevents clogged pores, smooths texture, fades scars and comedones', suggest: 'Adapalene 0.1% (Differin)' },
  { id: 'azelaic', name: 'Azelaic acid', when: 'pm', kind: 'active', unlock: 4, optional: true, why: 'pigmentation (optional)' },
  { id: 'facialoil', name: 'Facial oil', when: 'pm', kind: 'daily', optional: true, why: 'overnight barrier (optional)' },
  { id: 'shave', name: 'Shave', when: 'am', kind: 'shave' },
]

// The dermatologist's "what not to do" — surfaced in the products screen so the
// cautions live next to the routine, not just in someone's memory.
export const SKIN_CAUTIONS = [
  "No pore strips — they don't clear sebaceous filaments and irritate the skin.",
  "Don't squeeze the bumps under your eyes — they're likely milia; a dermatologist can remove them in minutes.",
  'No physical scrubs on the nose — the BHA does the exfoliating, gently.',
  'Skip harsh alcohol toners; they strip the barrier and push oil production up.',
  "Don't layer BHA and adapalene the same night until your skin is fully adjusted (several weeks).",
]
export const PRODUCT_BY_ID = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]))

// Default ownership for a fresh profile.
export const DEFAULT_OWNED = ['cleanser', 'moisturizer', 'spf', 'guasha', 'shave']

// Step copy. Title = imperative; instruction = one calm sentence.
const STEP_COPY = {
  cleanser: { title: 'Cleanse', instruction: 'Wash with lukewarm water and pat dry.' },
  shave: { title: 'Shave', instruction: 'Shave with the grain, then rinse cool.' },
  vitc: { title: 'Apply Vitamin C', instruction: 'A few drops to a dry face, avoid the eyes.' },
  niacinamide: { title: 'Apply niacinamide', instruction: 'A thin layer over the whole face.' },
  eyeserum: { title: 'Apply eye serum', instruction: 'Tap a small amount gently under each eye.' },
  moisturizer: { title: 'Moisturize', instruction: 'Smooth an even layer over your face and neck.' },
  spf: { title: 'Apply SPF', instruction: 'Two fingers of sunscreen, the last thing before you leave.' },
  bha: { title: 'Exfoliate (BHA)', instruction: 'Thin layer on a dry face — work it over the nose and T-zone. No scrubbing; let it sink in a minute.' },
  retinoid: { title: 'Apply adapalene', instruction: 'A pea-sized amount across forehead, cheeks and chin. Keep it off the eyelids and the skin right under your eyes.' },
  azelaic: { title: 'Apply azelaic acid', instruction: 'A thin layer over pigmented areas.' },
  facialoil: { title: 'Seal with facial oil', instruction: 'A few drops pressed in over your moisturizer.' },
  guasha: { title: 'Gua sha', instruction: 'Glide upward and out along the jaw and cheeks, slow and light.' },
}

// ---- date helpers (calendar, local, ISO yyyy-mm-dd) ----
const DAY_MS = 86400000
const parseIso = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d) }
const toIso = (dt) => { const p = (n) => String(n).padStart(2, '0'); return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}` }
const shift = (iso, delta) => toIso(new Date(parseIso(iso).getTime() + delta * DAY_MS))
const daysBetween = (aIso, bIso) => Math.round((parseIso(bIso).getTime() - parseIso(aIso).getTime()) / DAY_MS)
const weekdayOf = (iso) => parseIso(iso).getDay()

// Did a given step log as actually done on a given day/slot?
const stepDone = (day, slot, id) => day?.skincare?.[slot]?.steps?.[id] === 'done'

export function weeksSinceStart(dateIso, startedDate) {
  if (!startedDate) return 0
  return Math.max(0, Math.floor(daysBetween(startedDate, dateIso) / 7))
}

// Is a product owned? Shave is always owned.
const isOwned = (id, owned) => id === 'shave' || (owned || []).includes(id)

// Is a product available (owned + unlocked) on this date?
function isAvailable(prod, dateIso, state) {
  if (!isOwned(prod.id, state.profile?.skincare?.ownedProducts)) return false
  if (prod.kind === 'active') {
    const w = weeksSinceStart(dateIso, state.profile?.skincare?.startedDate)
    if (w < (prod.unlock || 0)) return false
  }
  return true
}

function mkStep(id, due, extra = {}) {
  const c = STEP_COPY[id] || { title: id, instruction: '' }
  const p = PRODUCT_BY_ID[id]
  return { id, title: c.title, instruction: c.instruction, kind: p?.kind || 'daily', due, ...extra }
}

// ---- shave cadence: rolling every-2-days, anchored to last actual shave ----
function lastShaveIso(dateIso, state, lookback = 30) {
  for (let i = 1; i <= lookback; i++) {
    const iso = shift(dateIso, -i)
    if (stepDone(state.days?.[iso], 'am', 'shave')) return iso
  }
  return null
}
export function shaveState(dateIso, state) {
  if (!isOwned('shave', state.profile?.skincare?.ownedProducts)) return { due: false, overdue: false }
  const last = lastShaveIso(dateIso, state)
  if (!last) return { due: true, overdue: false, last: null }
  const gap = daysBetween(last, dateIso)
  return { due: gap >= 2, overdue: gap > 2, last }
}

// Count this-week completions of an active from the logs (Mon-anchored week of dateIso).
function weekStartIso(dateIso) {
  const wd = weekdayOf(dateIso) // 0=Sun
  const back = (wd + 6) % 7 // days since Monday
  return shift(dateIso, -back)
}
function activeDoneThisWeek(id, dateIso, state) {
  const start = weekStartIso(dateIso)
  let n = 0
  for (let i = 0; i < 7; i++) {
    const iso = shift(start, i)
    if (iso > dateIso) break
    if (stepDone(state.days?.[iso], 'pm', id)) n++
  }
  return n
}

// The first night adapalene was actually logged (its true ramp anchor), or null.
function firstRetinoidNight(dateIso, state) {
  const days = state.days || {}
  const dates = Object.keys(days).sort()
  for (const iso of dates) {
    if (iso > dateIso) break
    if (stepDone(days[iso], 'pm', 'retinoid')) return iso
  }
  return null
}

// Weeks the owner has been using adapalene, for the ramp. So the ramp begins when
// adapalene actually starts (not the app's old start date): prefer an explicit
// retinoidStart, else the first logged adapalene night, else — once it's in the
// routine but not yet logged — week 0 (the 2×/week ramp-in). Negative = adapalene
// isn't in the routine yet.
function retinoidUseWeeks(dateIso, state) {
  const sk = state.profile?.skincare || {}
  const anchor = sk.retinoidStart || firstRetinoidNight(dateIso, state)
  if (anchor) return Math.floor(daysBetween(anchor, dateIso) / 7)
  // No anchor yet: if adapalene is owned + unlocked, it's about to start → ramp-in.
  const w = weeksSinceStart(dateIso, sk.startedDate)
  const unlock = PRODUCT_BY_ID.retinoid.unlock || 3
  return w >= unlock ? 0 : w - unlock
}

// The derm's plan as an EFFECTIVE weekly schedule per active on a given date.
// Adapalene ramps: 2 nights/week for the first two weeks, then every other night
// ("eventually nightly if tolerated" stays a manual step, not auto-forced). BHA
// takes the alternating nights — 2×/week while adapalene is still ramping in, then
// 3×/week once adapalene is every-other-night, so one active runs each night and
// the two never land together. Returns { days:[weekday], cap:number }.
export function activeSchedule(prodId, dateIso, state) {
  if (prodId === 'retinoid') {
    const rw = retinoidUseWeeks(dateIso, state)
    if (rw < 0) return { days: [], cap: 0 }
    if (rw < 2) return { days: [2, 5], cap: 2 }        // ramp-in: Tue / Fri
    return { days: [0, 2, 4, 6], cap: 4 }              // every other night: Sun/Tue/Thu/Sat
  }
  if (prodId === 'bha') {
    const retAvail = isAvailable(PRODUCT_BY_ID.retinoid, dateIso, state)
    const rw = retinoidUseWeeks(dateIso, state)
    if (retAvail && rw >= 2) return { days: [1, 3, 5], cap: 3 } // fill the gaps: Mon/Wed/Fri
    return { days: [1, 4], cap: 2 }                             // gentle start: Mon / Thu
  }
  const p = PRODUCT_BY_ID[prodId]
  return { days: p?.days || null, cap: p?.cap || 0 }
}

// The PM active scheduled for tonight (today is one of its weekdays), if any.
function scheduledTonight(dateIso, state) {
  const wd = weekdayOf(dateIso)
  for (const p of PRODUCTS) {
    if (p.kind !== 'active' || p.when !== 'pm') continue
    if (!isAvailable(p, dateIso, state)) continue
    const sch = activeSchedule(p.id, dateIso, state)
    if (sch.days && sch.days.includes(wd)) return p
  }
  return null
}

// A carried-over active: scheduled on a recent prior night but not done since,
// surfaced now. At most one, nothing older than ~7 days, respect weekly caps.
function carriedActive(dateIso, state, blockId) {
  const MAX_BACK = 7
  for (const p of PRODUCTS) {
    if (p.kind !== 'active' || p.when !== 'pm') continue
    if (p.id === blockId) continue
    if (!isAvailable(p, dateIso, state)) continue
    const sch = activeSchedule(p.id, dateIso, state)
    if (!sch.days || !sch.days.length) continue
    if (sch.cap && activeDoneThisWeek(p.id, dateIso, state) >= sch.cap) continue
    // most recent scheduled prior day
    for (let i = 1; i <= MAX_BACK; i++) {
      const iso = shift(dateIso, -i)
      if (!sch.days.includes(weekdayOf(iso))) continue
      // it was a scheduled night; was it done on or after that night?
      let doneSince = false
      for (let j = i; j >= 0; j--) {
        if (stepDone(state.days?.[shift(dateIso, -j)], 'pm', p.id)) { doneSince = true; break }
      }
      if (!doneSince) return p
      break // only consider the most recent scheduled night
    }
  }
  return null
}

// Resolve which single active (if any) runs tonight, honoring caps + no-double rule.
export function tonightActive(dateIso, state) {
  let sched = scheduledTonight(dateIso, state)
  // Respect the (ramp-aware) weekly cap on the scheduled one; if capped, drop it.
  if (sched) {
    const cap = activeSchedule(sched.id, dateIso, state).cap
    if (cap && activeDoneThisWeek(sched.id, dateIso, state) >= cap) sched = null
  }
  const active = sched || carriedActive(dateIso, state, null) // no scheduled → allow one carry-over
  // Dynamic: when skin is flagged sensitive (feedback), ease off — skip tonight's
  // active if another active ran within the last 2 nights, so the barrier recovers.
  if (active && state.profile?.skincare?.sensitive) {
    for (let i = 1; i <= 2; i++) {
      const steps = state.days?.[shift(dateIso, -i)]?.skincare?.pm?.steps || {}
      if (Object.entries(steps).some(([id, v]) => v === 'done' && PRODUCT_BY_ID[id]?.kind === 'active')) return null
    }
  }
  return active
}

// ---- the plan ----
export function planForDay(dateIso, state) {
  const owned = state.profile?.skincare?.ownedProducts
  const avail = (id) => isAvailable(PRODUCT_BY_ID[id], dateIso, state)

  // AM
  const am = []
  if (avail('cleanser')) am.push(mkStep('cleanser', 'daily'))
  const shave = shaveState(dateIso, state)
  if (shave.due) {
    am.push(mkStep('shave', 'shave', shave.overdue
      ? { overdue: true, title: 'Shave', instruction: "You're past due — shave today, with the grain, then rinse cool." }
      : {}))
  }
  if (avail('vitc')) am.push(mkStep('vitc', 'active'))
  if (avail('niacinamide')) am.push(mkStep('niacinamide', 'active'))
  if (avail('eyeserum')) am.push(mkStep('eyeserum', 'daily'))
  if (avail('moisturizer')) am.push(mkStep('moisturizer', 'daily'))
  if (avail('spf')) am.push(mkStep('spf', 'daily'))

  // PM
  const pm = []
  if (avail('cleanser')) pm.push(mkStep('cleanser', 'daily'))
  const active = tonightActive(dateIso, state)
  if (active) {
    const sched = scheduledTonight(dateIso, state)
    const carried = !(sched && sched.id === active.id)
    pm.push(mkStep(active.id, 'active', carried ? { carried: true } : {}))
  }
  if (avail('eyeserum')) pm.push(mkStep('eyeserum', 'daily'))
  if (avail('moisturizer')) pm.push(mkStep('moisturizer', 'daily'))
  if (avail('facialoil')) pm.push(mkStep('facialoil', 'daily'))
  if (avail('guasha')) pm.push(mkStep('guasha', 'daily'))

  return { am, pm }
}

// Small status object for the coach + dashboard.
export function dueSummary(dateIso, state) {
  const plan = planForDay(dateIso, state)
  const day = state.days?.[dateIso]
  const slotPending = (slot, steps) => {
    if (!steps.length) return false
    // pending unless every step is already logged done or skipped
    const logged = day?.skincare?.[slot]?.steps || {}
    return !steps.every((s) => logged[s.id] === 'done' || logged[s.id] === 'skipped')
  }
  const active = plan.pm.find((s) => s.due === 'active')
  const shave = shaveState(dateIso, state)
  return {
    amPending: slotPending('am', plan.am),
    pmPending: slotPending('pm', plan.pm),
    tonightActive: active ? active.id : null,
    shaveDue: shave.due,
    shaveOverdue: shave.overdue,
  }
}
