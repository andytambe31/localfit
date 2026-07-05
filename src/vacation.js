/* ---------- vacation mode (pure) -------------------------------------------
 * A planned break is a forgiven skip at the life level. When today falls inside
 * a vacation date range, the app flips from "hit your cut" to "protect what
 * you've built, enjoy deliberately, come back clean."
 *
 * The diet guardrail is calorie BANKING, not a flat ceiling:
 *   trip budget = (trip days × maintenance) + (deficit you banked this week)
 * Spend it across the whole trip however you like. Stay inside it and the week
 * nets break-even at worst — you physically can't revert; beat it and you still
 * end the week in a deficit. The buffer is a reward for the discipline you
 * already showed, and it enforces "overeating never exceeds the deficit banked."
 *
 * All derived from profile.vacations[] + day logs, so it syncs like everything
 * else. Voice stays directive and no-guilt; no emojis.
 * -------------------------------------------------------------------------- */
import { calorieTarget, dayTotals } from './diet'

const MS_DAY = 86400000
const dayD = (iso) => new Date(iso + 'T00:00:00')
const shiftIso = (iso, delta) => {
  const [y, m, d] = iso.split('-').map(Number)
  const nd = new Date(new Date(y, m - 1, d).getTime() + delta * MS_DAY)
  const p = (n) => String(n).padStart(2, '0')
  return `${nd.getFullYear()}-${p(nd.getMonth() + 1)}-${p(nd.getDate())}`
}
const between = (iso, a, b) => iso >= a && iso <= b
const daysInclusive = (a, b) => Math.max(1, Math.round((dayD(b) - dayD(a)) / MS_DAY) + 1)
// Monday-anchored week start.
function weekStart(iso) {
  const dow = (dayD(iso).getDay() + 6) % 7
  return shiftIso(iso, -dow)
}

const RETURN_DAYS = 3 // re-entry window after a trip: routines resume, scale stays off

// Trips are defined here in code, by design — tell Claude "I'm away Jul 5–7" and
// it adds a line. No in-app trip planner. Dates are inclusive (YYYY-MM-DD).
export const VACATIONS = [
  { start: '2026-07-04', end: '2026-07-04', label: "NYC — sister's birthday" },
]

const norm = (v) => ({ start: v.start, end: v.end || v.start, label: v.label || 'Vacation' })
const sorted = () => [...VACATIONS].map(norm).sort((a, b) => a.start.localeCompare(b.start))

// The vacation covering today, if any.
export function activeVacation(state, today) {
  return sorted().find((v) => between(today, v.start, v.end)) || null
}
// A vacation that starts tomorrow — powers the night-before prep nudge.
export function upcomingVacation(state, today) {
  const t = shiftIso(today, 1)
  return sorted().find((v) => v.start === t) || null
}
// Just back: within RETURN_DAYS after a trip ended (and not on another trip).
export function returnWindow(state, today) {
  if (activeVacation(state, today)) return null
  for (const v of sorted()) {
    const since = Math.round((dayD(today) - dayD(v.end)) / MS_DAY)
    if (since >= 1 && since <= RETURN_DAYS) return { vac: v, daysSince: since, weighUnlockIn: RETURN_DAYS - since + 1 }
  }
  return null
}
// Weigh-ins hide during a trip and through the return window, so you judge
// yourself on a settled number, not a bloated one.
export function weighInsHidden(state, today) {
  return !!activeVacation(state, today) || !!returnWindow(state, today)
}

const kcalOf = (day) => (day?.food || []).reduce((a, e) => a + (e.kcal || 0), 0)

// The banked-budget engine for an active trip.
export function vacationBudget(state, today, vac) {
  const v = vac || activeVacation(state, today)
  if (!v) return null
  const days = state.days || {}
  const ct = calorieTarget(state)
  const M = ct?.tdee || null // maintenance
  const D = state.profile?.deficit ?? 500
  const tripDays = daysInclusive(v.start, v.end)

  // Bank the deficit from this week's on-plan days BEFORE the trip. Honest: only
  // days you actually logged count, and a day you overate spends the buffer back.
  let banked = 0
  if (M) {
    const ws = weekStart(v.start)
    for (let iso = ws; iso < v.start; iso = shiftIso(iso, 1)) {
      const d = days[iso]
      if (!(d?.food?.length)) continue
      banked += M - kcalOf(d)
    }
    banked = Math.max(0, Math.min(banked, D * 6)) // clamp: no runaway buffer
  }

  const budget = M ? Math.round((tripDays * M + banked) / 10) * 10 : null
  // Spent so far across trip days up to today.
  let spent = 0
  for (let iso = v.start; iso <= today && iso <= v.end; iso = shiftIso(iso, 1)) spent += kcalOf(days[iso])
  const remaining = budget != null ? budget - spent : null
  const dayIndex = daysInclusive(v.start, today) // 1-based day of the trip
  const daysLeft = Math.max(0, daysInclusive(today, v.end) - 0)
  const todayIntake = kcalOf(days[today])
  const bigDay = M ? todayIntake > M + 800 : false // soft per-day sanity flag

  return {
    label: v.label, start: v.start, end: v.end,
    maintenance: M, banked: Math.round(banked), tripDays,
    budget, spent, remaining,
    dayIndex, daysLeft, todayIntake, bigDay,
    onTrack: remaining == null ? null : remaining >= 0, // in budget → week can't revert
  }
}

// A short, true reassurance for the return ramp — quantifies why a few days off
// can't undo months. Uses the trip's own overshoot when we can compute it.
export function reassurance(state, vac) {
  const overshoot = (() => {
    const b = vacationBudget(state, vac.end, vac)
    return b && b.remaining != null && b.remaining < 0 ? -b.remaining : 0
  })()
  const gainKg = Math.round((overshoot / 7700) * 100) / 100
  if (overshoot > 0 && gainKg >= 0.1) {
    return `You went ~${overshoot.toLocaleString()} cal past your budget — about ${gainKg} kg of real fat. One week back on your deficit erases it. You didn't start over.`
  }
  return `Any scale bump right now is water, sodium, and glycogen — not fat. You stayed inside what you banked, so the trip cost you nothing. Resume and keep going.`
}

export { RETURN_DAYS }
