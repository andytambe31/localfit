/* ---------- movement make-up (pure) ----------------------------------------
 * Skip a lift or a steps day for a reason, and the app keeps the books:
 *   · Reason decides debt. Sick / injured / need-rest = a legitimate skip, no
 *     make-up owed (recovery is training too). Busy / travel / no-time = the
 *     stimulus is deferred, so you owe it back.
 *   · Gym make-up = harder next sessions. Each owed lift adds a set to your main
 *     lifts on the next training day until it's answered (buildSession reads
 *     gymMakeup). The weekly count isn't padded with extra days.
 *   · Steps make-up = balance over the week. Skipped/short step days leave you
 *     behind your weekly pace; walk a little over target until you're square.
 *   · No cap — debt carries until it's actually paid down.
 * All derived from day logs (skips are written onto the day), so it merges and
 * survives like everything else. Voice stays directive, no emojis.
 * -------------------------------------------------------------------------- */

const shiftIso = (iso, delta) => {
  const [y, m, d] = iso.split('-').map(Number)
  const nd = new Date(new Date(y, m - 1, d).getTime() + delta * 86400000)
  const p = (n) => String(n).padStart(2, '0')
  return `${nd.getFullYear()}-${p(nd.getMonth() + 1)}-${p(nd.getDate())}`
}

// Reasons offered when you skip. `owed:false` = forgiven (no make-up).
export const SKIP_REASONS = [
  { id: 'rest', label: 'Need a rest day', owed: false },
  { id: 'sick', label: 'Under the weather', owed: false },
  { id: 'injured', label: 'Injury or pain', owed: false },
  { id: 'busy', label: 'Too busy', owed: true },
  { id: 'travel', label: 'Traveling', owed: true },
  { id: 'notime', label: 'Ran out of time', owed: true },
]
export const reasonById = (id) => SKIP_REASONS.find((r) => r.id === id) || null
// The skip object to write onto the day (owed derived from the reason).
export function skipRecord(reasonId, ts) {
  const r = reasonById(reasonId)
  return { reason: reasonId, label: r?.label || reasonId, owed: !!r?.owed, ts: ts || null }
}

// Monday-anchored week start for a date (ISO weeks: Mon…Sun).
function weekStart(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7 // 0 = Monday
  return shiftIso(iso, -dow)
}

const trained = (day) => day?.workout?.session?.status === 'done' || (day?.workout?.did && day?.workout?.type !== 'Rest')

// Steps are binary now: you either hit your 10k that day or you didn't. The
// exact count is irrelevant — anything past target is just bonus. `stepsDone`
// is the tap; legacy days with a logged number still count as hit if >= target.
export const stepsHit = (day, target = 10000) => !!day?.stepsDone || (day?.steps || 0) >= target
// A day you actually used the app — so an un-hit walk on a blank, untracked day
// isn't counted as a miss you owe.
const dayLogged = (d) => !!(d && (d.routines?.skincareAM || d.routines?.skincarePM || d.routines?.haircareAM || d.routines?.haircarePM || d.workout?.did || d.workout?.session || d.workout?.skip || (d.food && d.food.length) || d.steps || d.stepsDone || d.stepsSkip || d.water))

// The full movement account: gym debt (owed lifts) + step balance, with a
// reminder and the make-up strategy for each.
export function movementAccount(state, today) {
  const profile = state.profile || {}
  const days = state.days || {}
  const stepTarget = profile.stepTarget || 10000
  const keys = Object.keys(days).filter((d) => d <= today).sort()

  // --- gym: owed lifts, paid down by the next completed session ---------------
  let gymDebt = 0
  for (const iso of keys) {
    const d = days[iso]
    if (d.workout?.skip?.owed) gymDebt += 1
    if (trained(d) && gymDebt > 0) gymDebt -= 1
  }

  // --- steps: missed 10k walks this week (binary) -----------------------------
  // Any day you used the app but didn't hit your 10k — or an owed skip — is a
  // make-up walk you owe. Forgiven skips (rest/sick/injured) don't count. Scoped
  // to this week ("balance over the week"); the count is walks, not steps.
  const ws = weekStart(today)
  let stepsOwed = 0
  for (let iso = ws; iso < today; iso = shiftIso(iso, 1)) {
    const d = days[iso]
    const sk = d?.stepsSkip
    if (sk && !sk.owed) continue // forgiven
    if (sk && sk.owed) { stepsOwed += 1; continue }
    if (dayLogged(d) && !stepsHit(d, stepTarget)) stepsOwed += 1
  }
  const hitToday = stepsHit(days[today], stepTarget)
  const daysLeftInWeek = Math.round((new Date(shiftIso(ws, 7) + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000)

  // --- reminders + strategy ---------------------------------------------------
  const items = []
  if (gymDebt > 0) items.push({
    kind: 'gym', debt: gymDebt,
    text: `${gymDebt} missed session${gymDebt > 1 ? 's' : ''} to answer for. Your next lift runs harder — an extra set on the main lifts — to win back the stimulus.`,
  })
  if (stepsOwed > 0) items.push({
    kind: 'steps', debt: stepsOwed,
    text: daysLeftInWeek > 1
      ? `${stepsOwed} missed 10k walk${stepsOwed > 1 ? 's' : ''} this week. ${daysLeftInWeek} days left — don't miss another; string the rest together.`
      : `${stepsOwed} missed 10k walk${stepsOwed > 1 ? 's' : ''} this week.${hitToday ? '' : ' Close it out — get your walk in today.'}`,
  })

  return {
    gym: { debt: gymDebt, extraSets: gymDebt > 0 ? 1 : 0 },
    steps: { owed: stepsOwed, hitToday, daysLeftInWeek },
    items,
    hasDebt: items.length > 0,
  }
}

// What buildSession needs: how much to intensify today's lift to make up owed
// sessions. Kept as its own tiny read so the trainer doesn't pull the whole card.
export function gymMakeup(state, today) {
  const acc = movementAccount(state, today)
  return acc.gym // { debt, extraSets }
}
