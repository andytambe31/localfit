/* ---------- cardio / heart-health engine (pure) -----------------------------
 * The "healthy on the inside" pillar. Zone-2 steady cardio builds the aerobic
 * base and heart health without eating into strength recovery; resting heart
 * rate is the headline biomarker that should trend DOWN as the heart gets
 * fitter. Scored by weekly Zone-2 minutes vs a target (like the mobility ring),
 * null until the first session so it can't dent the on-track average.
 *
 * Intensity is dual-gauge: a heart-rate zone when a monitor is worn, and the
 * talk test / RPE as the always-available fallback. Voice: directive, no emojis.
 * -------------------------------------------------------------------------- */

const shiftIso = (iso, delta) => {
  const [y, m, d] = iso.split('-').map(Number)
  const nd = new Date(new Date(y, m - 1, d).getTime() + delta * 86400000)
  const p = (n) => String(n).padStart(2, '0')
  return `${nd.getFullYear()}-${p(nd.getMonth() + 1)}-${p(nd.getDate())}`
}

// Steady-state modalities. `note` is the how-to cue shown on the card.
export const CARDIO_TYPES = [
  { id: 'incline_walk', name: 'Incline Treadmill', note: 'Steep incline, brisk but conversational. The lifter\'s favourite Zone-2.' },
  { id: 'bike', name: 'Stationary Bike', note: 'Steady spin, moderate resistance. Easy on the knees.' },
  { id: 'row', name: 'Rower', note: 'Long, smooth strokes — legs then back then arms. Keep it aerobic.' },
  { id: 'elliptical', name: 'Elliptical', note: 'Even, continuous stride. Low impact, easy to hold Zone-2.' },
  { id: 'outdoor_walk', name: 'Brisk Walk', note: 'Fast outdoor walk, pump the arms, find some hills.' },
  { id: 'jog', name: 'Easy Jog', note: 'Slow, relaxed jog — if you can\'t talk, you\'re going too hard.' },
  { id: 'stairs', name: 'Stair Climber', note: 'Steady pace, stand tall, don\'t lean on the rails.' },
]
export const cardioTypeName = (id) => (CARDIO_TYPES.find((t) => t.id === id) || {}).name || 'Cardio'

// Zone-2 heart-rate window from age (max HR ≈ 220−age; Zone 2 ≈ 60–70%). Also
// returns the MAF ceiling (180−age), a simple aerobic cap. null without age.
export function zone2(age) {
  if (!(Number(age) > 0)) return null
  const max = 220 - age
  return { low: Math.round(max * 0.6), high: Math.round(max * 0.7), maf: 180 - age, max }
}

// RPE guide for the talk test (Zone 2 is a 3–4 / "comfortably hard but chatty").
export const TALK_TEST = 'Zone 2 is a full-sentence pace: you can talk, but not sing. Nose-breathing should just about keep up. If you\'re gasping, ease off.'

export const cardioMinutes = (day) => Number(day?.cardio?.minutes) || 0
export const cardioDone = (day) => !!(day?.cardio?.done || cardioMinutes(day) > 0)

export function cardioMinutesInWindow(days, today, n = 7) {
  let sum = 0
  for (let i = 0; i < n; i++) sum += cardioMinutes(days[shiftIso(today, -i)])
  return sum
}

// /10 by weekly Zone-2 minutes vs target. null until the first session logged.
export function cardioScore(state, today, profile) {
  const days = state?.days || {}
  const target = profile?.cardioTargetPerWeek || 150
  const ever = Object.keys(days).some((iso) => cardioDone(days[iso]))
  if (!ever) return null
  const recent = cardioMinutesInWindow(days, today, 7)
  return Math.max(0, Math.min(10, Math.round((recent / target) * 10)))
}

// Behind on the weekly minutes target → worth prompting (best on rest days).
export function cardioDue(state, today) {
  const target = rampTargetMin(state, today)
  return cardioMinutesInWindow(state?.days || {}, today, 7) < target
}

const shiftBack = (iso, i) => shiftIso(iso, -i)

// The FIRST day cardio was ever logged — the start of the ramp. null if never.
function cardioStart(state) {
  const days = state?.days || {}
  const dates = Object.keys(days).filter((iso) => cardioDone(days[iso])).sort()
  return dates.length ? dates[0] : null
}

// Coming from zero, a 150-min/week goal dropped on day one is a wall. Ramp it:
// week 1 → 75–90, week 2 → 100–120, week 3+ → the full 150. The target used for
// scoring/prompts is the LOW end of the current step, so a fair week counts.
export function rampTargetMin(state, today) {
  const full = state?.profile?.cardioTargetPerWeek || 150
  const start = cardioStart(state)
  if (!start) return 75 // not started — the entry target is the week-1 floor
  const wk = Math.floor(Math.max(0, (new Date(today + 'T00:00:00') - new Date(start + 'T00:00:00')) / 86400000) / 7)
  if (wk <= 0) return 75
  if (wk === 1) return 100
  return full
}

// The full cardio-ramp read for the coach: which step you're on, this week's
// window, what's already banked, and intensity guidance. `hardIntervalsOk` is
// false when recovery is compromised (poor sleep or a deep calorie hole) — steady
// Zone-2 only on those days, never intervals.
export function cardioRamp(state, today, opts = {}) {
  const full = state?.profile?.cardioTargetPerWeek || 150
  const start = cardioStart(state)
  const done = cardioMinutesInWindow(state?.days || {}, today, 7)
  const wk = start ? Math.floor(Math.max(0, (new Date(today + 'T00:00:00') - new Date(start + 'T00:00:00')) / 86400000) / 7) : -1
  let step, low, high, label
  if (wk < 0) { step = 0; low = 75; high = 90; label = 'Week 1 — start easy' }
  else if (wk === 0) { step = 1; low = 75; high = 90; label = 'Week 1 of the ramp' }
  else if (wk === 1) { step = 2; low = 100; high = 120; label = 'Week 2 of the ramp' }
  else { step = 3; low = full; high = full; label = 'Full target' }
  const remaining = Math.max(0, low - done)
  const recoveryStrained = !!opts.recoveryStrained
  const hardIntervalsOk = !recoveryStrained
  const headline = wk < 0
    ? `Start Zone-2 cardio — ${low}–${high} min this week.`
    : step === 3
      ? `Cardio target: ${full} min this week.`
      : `${label}: aim ${low}–${high} min.`
  const guidance = hardIntervalsOk
    ? `${TALK_TEST} Steady is the whole point — you're building the aerobic base, not chasing a burn. Slot it on a rest day or after a lift, never in place of an overdue Push/Pull/Legs session.`
    : `${TALK_TEST} Recovery's a bit thin right now — keep it easy steady-state, no hard intervals today. It still counts and won't cost you on the platform tomorrow.`
  return { step, weekOfRamp: Math.max(1, wk + 1), targetLow: low, targetHigh: high, fullTarget: full, doneThisWeek: done, remaining, atFull: step === 3, hardIntervalsOk, headline, guidance, label }
}

// Resting-HR trend: latest reading + change vs the average of the prior month,
// so a falling number reads as a fitter heart. Reads days[iso].restingHr.
export function restingHrTrend(state, today) {
  const days = state?.days || {}
  const pts = []
  for (let i = 0; i < 90; i++) {
    const iso = shiftIso(today, -i)
    const v = Number(days[iso]?.restingHr)
    if (v > 0) pts.push({ iso, v })
  }
  if (!pts.length) return null
  const latest = pts[0]
  const older = pts.filter((p) => p.iso <= shiftIso(today, -14))
  const baseline = older.length ? older.reduce((a, p) => a + p.v, 0) / older.length : null
  const delta = baseline != null ? Math.round(latest.v - baseline) : null
  return { latest: latest.v, latestIso: latest.iso, baseline: baseline != null ? Math.round(baseline) : null, delta, count: pts.length }
}
