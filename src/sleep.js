/* ---------- sleep engine: pure, no React ----------
 * Infers overnight sleep from app-activity gaps. The owner doesn't use the app
 * overnight, so the long quiet gap ≈ sleep; evening routine ≈ bedtime signal,
 * morning routine ≈ wake signal, brief app-opens inside the gap = interruptions.
 * All inference is derived from state.activity (epoch-ms intervals) so it works
 * offline and survives sync. A stored manual override always wins.
 */

const MIN_MS = 60000

// Build a local epoch-ms timestamp for `dateIso` at hour h (h may be on dateIso-1).
const localEpoch = (dateIso, dayDelta, h) => {
  const [y, m, d] = dateIso.split('-').map(Number)
  return new Date(y, m - 1, d + dayDelta, h, 0, 0, 0).getTime()
}

// The sleep the owner WOKE FROM on the morning of `dateIso`, inferred from activity.
// Returns a sleep object or null.
export function inferSleep(dateIso, activity, profile) {
  if (!dateIso || !Array.isArray(activity) || !activity.length) return null
  const winStart = localEpoch(dateIso, -1, 18) // previous evening 18:00
  const winEnd = localEpoch(dateIso, 0, 14) // this day 14:00

  // Activity intervals overlapping the window, sorted by start.
  const ivs = activity
    .filter((iv) => iv && iv.e > winStart && iv.s < winEnd)
    .map((iv) => ({ s: Math.max(iv.s, winStart), e: Math.min(iv.e, winEnd) }))
    .sort((a, b) => a.s - b.s)
  if (!ivs.length) return null

  const hourOf = (ms) => new Date(ms).getHours()
  const qualifies = (start, end) => {
    if (end - start < 90 * MIN_MS) return false
    return hourOf(start) >= 21 || hourOf(end) <= 11
  }

  // Qualifying gaps between consecutive intervals.
  let sleepStart = null, sleepEnd = null
  for (let i = 0; i < ivs.length - 1; i++) {
    const gStart = ivs[i].e, gEnd = ivs[i + 1].s
    if (gEnd <= gStart) continue
    if (qualifies(gStart, gEnd)) {
      if (sleepStart == null) sleepStart = gStart
      sleepEnd = gEnd
    }
  }
  if (sleepStart == null) return null

  // Interruptions: activity strictly inside the sleep span.
  const interruptions = ivs
    .filter((iv) => iv.s > sleepStart && iv.e < sleepEnd)
    .map((iv) => ({ at: iv.s, minutes: Math.max(1, Math.round((iv.e - iv.s) / MIN_MS)) }))

  const interruptMin = interruptions.reduce((sum, i) => sum + i.minutes, 0)
  const minutes = Math.max(0, Math.min(720, Math.round((sleepEnd - sleepStart) / MIN_MS) - interruptMin))

  const bedH = hourOf(sleepStart), wakeH = hourOf(sleepEnd)
  const bedOk = (bedH >= 20 && bedH <= 23) || (bedH >= 0 && bedH <= 3)
  const plausible = bedOk && wakeH <= 12 && minutes <= 660 && minutes >= 120
  // Inference is a proxy (phone inactivity), never a certainty. Even a clean gap
  // caps at 'medium' — 'high' requires a manual confirmation from the user.
  return {
    start: sleepStart, end: sleepEnd, minutes, interruptions,
    source: 'inferred', confidence: plausible ? 'medium' : 'low', confident: plausible,
    estimatedBedtime: sleepStart, estimatedWakeTime: sleepEnd, estimatedDuration: minutes,
    userQualityRating: null,
  }
}

// Last night's sleep. A full manual edit wins outright (confidence high). A
// quality-only tap ("Poor sleep" / a rating) merges onto the inference (mixed).
export function lastNightSleep(state, dateIso) {
  const stored = state?.days?.[dateIso]?.sleep
  if (stored && stored.source === 'manual') {
    return { ...stored, source: 'manual', confidence: 'high', userQualityRating: stored.userQualityRating ?? null,
      estimatedBedtime: stored.start, estimatedWakeTime: stored.end, estimatedDuration: stored.minutes }
  }
  const inf = inferSleep(dateIso, state?.activity || [], state?.profile || {})
  if (stored && stored.source === 'quality' && stored.userQualityRating != null) {
    if (inf) return { ...inf, source: 'mixed', confidence: 'high', userQualityRating: stored.userQualityRating }
    // No usable inference, but the user rated it — carry the rating alone.
    return { start: null, end: null, minutes: null, interruptions: [], source: 'mixed', confidence: 'medium',
      userQualityRating: stored.userQualityRating, estimatedBedtime: null, estimatedWakeTime: null, estimatedDuration: null }
  }
  return inf
}

// Score one night /10 from its sleep object + profile goals.
const HHMM = (s, fallback) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || fallback)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0
}
// The objective (duration + schedule) score /10 from the sleep times alone.
// Returns null if there are no usable times (a quality-only night).
function objectiveScore(sleep, profile) {
  if (sleep.start == null || sleep.minutes == null) return null
  const target = (profile.sleepTargetHours || 7) * 60
  const minutes = sleep.minutes || 0
  const durationScore = minutes >= target ? 10 : Math.max(0, 10 - ((target - minutes) / 30) * 1.5)

  const bedGoalMin = HHMM(profile.bedGoal, '23:30')
  const graceMin = (bedGoalMin + 30) % (24 * 60)
  const bed = new Date(sleep.start)
  const evMin = (mins) => (mins < 18 * 60 ? mins + 24 * 60 : mins)
  const bedEv = evMin(bed.getHours() * 60 + bed.getMinutes())
  const graceEv = evMin(graceMin)
  const minutesLate = Math.max(0, bedEv - graceEv)
  const bedtimePenalty = minutesLate > 0 ? Math.min(4, Math.ceil(minutesLate / 30)) : 0
  const interruptionPenalty = Math.min(2, 0.5 * (sleep.interruptions?.length || 0))
  return { total: Math.max(0, Math.min(10, durationScore - bedtimePenalty - interruptionPenalty)),
    durationScore: Math.round(durationScore * 10) / 10, bedtimePenalty, interruptionPenalty }
}

// The final /10 for a night, confidence-aware. Inference can't hit a clean 10 —
// a proxy that only *looks* like enough sleep is capped. A subjective rating,
// when given, is the anchor: the night is the WORSE of felt-quality and the
// measured duration, so "6/10 quality" can't sit at 10/10 on duration alone.
export function scoreNight(sleep, profile) {
  if (!sleep) return null
  const p = profile || {}
  const obj = objectiveScore(sleep, p)
  const quality = sleep.userQualityRating
  const confidence = sleep.confidence || (sleep.source === 'manual' ? 'high' : sleep.confident ? 'medium' : 'low')
  let final
  if (quality != null && obj) final = Math.min(quality, Math.round(obj.total))
  else if (quality != null) final = quality
  else {
    const cap = confidence === 'high' ? 10 : confidence === 'medium' ? 8 : 6
    final = Math.min(Math.round(obj ? obj.total : cap), cap)
  }
  return {
    finalScore: Math.max(0, Math.min(10, final)),
    confidence, source: sleep.source,
    scoreComponents: {
      duration: obj ? obj.durationScore : null,
      schedule: obj ? Math.max(0, 10 - obj.bedtimePenalty * 2.5) : null,
      quality: quality ?? null,
    },
  }
}

// Rolling average /10 over the last 7 nights that have data. Integer, or null.
export function sleepScore(state, dateIso, profile) {
  const p = profile || state?.profile || {}
  let sum = 0, n = 0
  for (let i = 0; i < 7; i++) {
    const sleep = lastNightSleep(state, shiftIso(dateIso, -i))
    const sc = scoreNight(sleep, p)
    if (!sc) continue
    sum += sc.finalScore; n++
  }
  if (!n) return null
  return Math.round(sum / n)
}

// A recovery read for the trainer: pull training aggressiveness down when sleep
// is genuinely poor (multiple bad nights / very short), NOT for one off night.
export function recoveryState(state, dateIso, profile) {
  const p = profile || state?.profile || {}
  const scores = []
  let veryShort = 0
  for (let i = 0; i < 4; i++) {
    const sleep = lastNightSleep(state, shiftIso(dateIso, -i))
    const sc = scoreNight(sleep, p)
    if (!sc) continue
    scores.push(sc.finalScore)
    if (sleep?.minutes != null && sleep.minutes < 330) veryShort++
  }
  if (scores.length < 2) return { level: 'ok', poorNights: 0 }
  const poor = scores.filter((s) => s <= 5).length
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length
  // Two-plus poor nights, a very short streak, or a low running average → ease off.
  const strained = poor >= 2 || veryShort >= 2 || avg <= 5.5
  return { level: strained ? 'reduce' : 'ok', poorNights: poor, avg: Math.round(avg * 10) / 10 }
}

// Whether to ask the one-tap morning confirmation: an inferred night today with
// no manual/quality confirmation yet, during the morning window.
export function sleepNeedsConfirm(state, dateIso, hour) {
  if (hour == null || hour < 6 || hour >= 12) return false
  const stored = state?.days?.[dateIso]?.sleep
  if (stored && (stored.source === 'manual' || stored.source === 'quality')) return false
  const inf = inferSleep(dateIso, state?.activity || [], state?.profile || {})
  return !!inf // only ask when there's actually an estimate to confirm
}

// ---- display helpers ----
export function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(minutes || 0))
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}
export function fmtClock(epochMs) {
  if (epochMs == null) return ''
  const d = new Date(epochMs)
  let h = d.getHours()
  const ap = h < 12 ? 'AM' : 'PM'
  h = ((h + 11) % 12) + 1
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`
}

// Local-date shift, mirroring App.jsx's shiftIso (calendar-correct).
function shiftIso(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number)
  const nd = new Date(new Date(y, m - 1, d).getTime() + delta * 86400000)
  const p = (n) => String(n).padStart(2, '0')
  return `${nd.getFullYear()}-${p(nd.getMonth() + 1)}-${p(nd.getDate())}`
}
