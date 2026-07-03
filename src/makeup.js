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

  // --- steps: cumulative deficit through yesterday, carried until paid --------
  // Only days you actually engaged count (logged steps, or an explicit skip) —
  // a day with nothing logged is unknown, not a 10k deficit.
  let running = 0 // negative = behind
  for (const iso of keys) {
    if (iso >= today) continue // today handled live below
    const d = days[iso]
    const sk = d.stepsSkip
    if (sk && !sk.owed) continue // forgiven — no requirement
    const s = d.steps || 0
    if (s <= 0 && !sk) continue // not tracked that day
    running += s - stepTarget
    if (running > 0) running = 0 // overshoot clears debt but doesn't bank credit
  }
  const baseStepDebt = Math.max(0, Math.round(-running))
  const todaySteps = days[today]?.steps || 0
  const todaySurplus = Math.max(0, todaySteps - stepTarget)
  const stepDebt = Math.max(0, baseStepDebt - todaySurplus)

  // --- this week's balance, for the weekly framing ---------------------------
  const ws = weekStart(today)
  let weekActual = 0, weekReqDays = 0
  for (let iso = ws; iso <= today; iso = shiftIso(iso, 1)) {
    const d = days[iso]
    const sk = d?.stepsSkip
    if (sk && !sk.owed) continue // forgiven days don't count against the week
    if ((d?.steps || 0) <= 0 && !sk && iso !== today) continue
    weekReqDays += 1
    weekActual += d?.steps || 0
  }
  const weekTarget = stepTarget * weekReqDays
  const daysLeftInWeek = Math.round((new Date(shiftIso(ws, 7) + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000)

  // --- reminders + strategy ---------------------------------------------------
  const items = []
  if (gymDebt > 0) items.push({
    kind: 'gym', debt: gymDebt,
    text: `${gymDebt} missed session${gymDebt > 1 ? 's' : ''} to answer for. Your next lift runs harder — an extra set on the main lifts — to win back the stimulus.`,
  })
  if (stepDebt >= 1000) {
    const perDay = daysLeftInWeek > 0 ? Math.round(stepDebt / daysLeftInWeek / 100) * 100 : stepDebt
    items.push({
      kind: 'steps', debt: stepDebt,
      text: daysLeftInWeek > 0
        ? `You're ${stepDebt.toLocaleString()} steps behind pace. Add about ${perDay.toLocaleString()}/day over the ${daysLeftInWeek} day${daysLeftInWeek > 1 ? 's' : ''} left this week to square it.`
        : `You're ${stepDebt.toLocaleString()} steps behind. Bank a long walk to clear it and start the week even.`,
    })
  }

  return {
    gym: { debt: gymDebt, extraSets: gymDebt > 0 ? 1 : 0 },
    steps: { debt: stepDebt, weekActual, weekTarget, weekReqDays, daysLeftInWeek, perDay: stepTarget },
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
