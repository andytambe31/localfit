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
  const target = state?.profile?.cardioTargetPerWeek || 150
  return cardioMinutesInWindow(state?.days || {}, today, 7) < target
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
