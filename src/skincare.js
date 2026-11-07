/* ---------- skincare engine: pure, no React ----------
 * Frequency-aware guided skincare planner. All state is derived from the
 * day logs (state.days[iso].skincare.{am,pm}.steps[id] === 'done'), so it
 * works offline and survives sync — no separate mutable "lastDone".
 */

// Product catalog — the owner's actual products. `when`: 'am'|'pm'|'both'.
// `kind`: 'daily' (every routine) | 'active' (scheduled, ramped in) | 'alt'
// (alternative, not a step) | 'shave'. Actives carry an `unlock` week (gradual
// introduction) and a `days`/`cap` weekly schedule. Ids reuse the prior catalog
// where the concept maps (cleanser/moisturizer/spf/niacinamide) so historical
// completion logs carry straight over.
export const PRODUCTS = [
  { id: 'cleanser', name: 'Cetaphil Oil-to-Foam Cleanser', when: 'both', kind: 'daily',
    suggest: 'A water-only rinse is fine in the morning if your skin feels dry.' },
  { id: 'cleanser_foam', name: 'Medicube Kojic Turmeric Cleansing Foam', when: 'both', kind: 'alt', optional: true,
    why: 'an alternative cleanser — use it in place of the Cetaphil, never as a second wash' },
  { id: 'niacinamide', name: 'Medicube Kojic Niacinamide Serum', when: 'am', kind: 'active', unlock: 2, days: [1, 3, 5], cap: 3, optional: true,
    why: 'brightening and even tone — introduced gradually, about 3×/week once skin is settled' },
  { id: 'moisturizer', name: 'Medicube Kojic Turmeric Capsule Cream', when: 'both', kind: 'daily',
    why: 'moisturizes and buffers the actives', suggest: 'Pause it for a few days if it stings or you start to flake.' },
  { id: 'spf', name: 'La Roche-Posay Tinted Mineral SPF 50', when: 'am', kind: 'daily',
    why: 'the daily priority — sun is what keeps dark patches and uneven tone around',
    suggest: 'Reapply every ~2 hours outdoors, and after sweating or swimming.' },
  { id: 'toner', name: 'Medicube Kojic Turmeric Resurfacing Toner', when: 'pm', kind: 'active', unlock: 4, days: [3], cap: 1, optional: true,
    why: 'an optional weekly treatment — read the label first, and skip it whenever skin is irritated' },
  { id: 'body_scrub', name: 'Tree Hut Moroccan Rose Sugar Scrub', when: 'pm', kind: 'body', days: [0], optional: true,
    why: 'optional weekly body exfoliation — never on irritated or psoriasis-affected skin' },
  { id: 'shave', name: 'Shave', when: 'am', kind: 'shave' },
]

// Safety / "what not to do" — surfaced in the products screen. Deliberately makes
// no medical claims about the darker forehead or under-eye appearance.
export const SKIN_CAUTIONS = [
  'Introduce one active at a time — never start every Medicube product at once.',
  'If anything stings, burns, or flakes, pause that product for a few days and let the barrier settle.',
  'Sunscreen every morning is the priority — uneven tone and dark patches set in fastest without it.',
  'A darker forehead and under-eye shadows have many harmless causes. Treat gently, stay consistent, and judge it over weeks, not days.',
  'Keep the resurfacing toner infrequent (about once a week) and check its directions before each use.',
  'No harsh physical scrubbing on the face — let the products do the work.',
]
export const PRODUCT_BY_ID = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]))

// Default ownership for a fresh profile (the owner's products; the cleansing foam
// is an alternative, never an extra step).
export const DEFAULT_OWNED = ['cleanser', 'cleanser_foam', 'niacinamide', 'moisturizer', 'spf', 'toner', 'body_scrub', 'shave']

// Step copy. Title = imperative; instruction = one calm sentence.
const STEP_COPY = {
  cleanser: { title: 'Cleanse', instruction: 'Cetaphil oil-to-foam with lukewarm water, then pat dry. If your skin feels dry in the morning, a water-only rinse is fine.' },
  shave: { title: 'Shave', instruction: 'Shave with the grain, then rinse cool.' },
  niacinamide: { title: 'Brightening serum', instruction: 'A few drops of the Medicube niacinamide serum over the whole face. Scheduled days only — about 3×/week once your skin is settled.' },
  moisturizer: { title: 'Moisturize', instruction: 'An even layer of the Medicube capsule cream over face and neck. Pause it if it stings or you start flaking.' },
  spf: { title: 'Apply SPF 50', instruction: 'Two fingers of the La Roche-Posay tinted mineral sunscreen — the last thing before you leave. Reapply every ~2 hours outdoors.' },
  toner: { title: 'Resurfacing toner (optional)', instruction: 'Optional weekly treatment — a light swipe of the Medicube resurfacing toner on dry skin, no more than once a week. Check the label, and skip it if your skin is irritated.' },
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
  if (!prod) return false
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

// Trim: the small daily "finishers" (eye serum, facial oil, gua sha) used to each
// get their own full-screen card, which made the routine feel like a long march.
// They now fold onto the moisturize step as a single "and then…" finish, so the
// flow keeps only the essential cards (cleanse, actives, moisturize, SPF).
const FINISH_CLAUSE = {
  eyeserum: 'tap eye serum under each eye',
  facialoil: 'press in a few drops of facial oil',
  guasha: 'gua sha upward along the jaw and cheeks',
}
const joinClauses = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`)
function moisturizeStep(finisherIds, avail) {
  const finishers = finisherIds.filter((id) => avail(id))
  if (!finishers.length) return mkStep('moisturizer', 'daily')
  const base = STEP_COPY.moisturizer.instruction
  const instruction = `${base} Then ${joinClauses(finishers.map((id) => FINISH_CLAUSE[id]))}.`
  return { ...mkStep('moisturizer', 'daily'), title: 'Moisturize & finish', instruction, folds: finishers }
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
function activeDoneThisWeek(id, dateIso, state, slot = 'pm') {
  const start = weekStartIso(dateIso)
  let n = 0
  for (let i = 0; i < 7; i++) {
    const iso = shift(start, i)
    if (iso > dateIso) break
    if (stepDone(state.days?.[iso], slot, id)) n++
  }
  return n
}

// Is a scheduled active due in a given slot today? (owned + unlocked + today is one
// of its weekdays + not already at its weekly cap). Drives the AM brightening serum,
// which the PM-only tonightActive machinery doesn't cover.
function activeDue(id, slot, dateIso, state) {
  const prod = PRODUCT_BY_ID[id]
  if (!prod || !isAvailable(prod, dateIso, state)) return false
  const sch = activeSchedule(id, dateIso, state)
  if (!sch.days || !sch.days.includes(weekdayOf(dateIso))) return false
  if (sch.cap && activeDoneThisWeek(id, dateIso, state, slot) >= sch.cap) return false
  return true
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
    if (p.optional) continue // optional treatments (e.g. the weekly toner) never nag via carry-over
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
  if (activeDue('niacinamide', 'am', dateIso, state)) am.push(mkStep('niacinamide', 'active'))
  if (avail('moisturizer')) am.push(moisturizeStep(['eyeserum'], avail))
  else if (avail('eyeserum')) am.push(mkStep('eyeserum', 'daily'))
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
  if (avail('moisturizer')) pm.push(moisturizeStep(['eyeserum', 'facialoil', 'guasha'], avail))
  else {
    if (avail('eyeserum')) pm.push(mkStep('eyeserum', 'daily'))
    if (avail('facialoil')) pm.push(mkStep('facialoil', 'daily'))
    if (avail('guasha')) pm.push(mkStep('guasha', 'daily'))
  }
  // Optional weekly body exfoliation (Sundays) — body only, never on irritated or
  // psoriasis-affected skin.
  if (isAvailable(PRODUCT_BY_ID.body_scrub, dateIso, state) && weekdayOf(dateIso) === 0) {
    pm.push({ id: 'body_scrub', title: 'Body scrub (optional, weekly)', kind: 'body', due: 'weekly', optional: true,
      instruction: 'Optional weekly Tree Hut sugar scrub in the shower — gently, on the body only. Avoid any irritated skin and psoriasis-affected areas.' })
  }

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
