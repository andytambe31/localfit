/* ---------- PPL rotation adherence (pure) -----------------------------------
 * The owner runs a 3-day Push / Pull / Legs split and wants to STAY on it and
 * execute it well — not switch programs. The honest adherence question isn't
 * "did you train 3× this calendar week" (a Monday reset hides a lagging Legs day
 * behind a busy Push/Pull week). It's "are you completing the rotation evenly,
 * rolling and continuous?"
 *
 * So this module reads the typed session history as ONE unbroken sequence — no
 * week boundary — and derives: how many full Push→Pull→Legs rotations you've
 * completed lately, which type is up next, how long since each type, the recent
 * distribution, whichever type is overdue, and the callouts for imbalance. The
 * recommendation is least-recently-trained-first, so a neglected Legs day jumps
 * the queue instead of waiting for a strict cycle to come back around.
 *
 * Pure: every function takes `hist` (ascending [{date, day}] of typed PPL
 * sessions, as produced by train.liftingHistory) + todayIso. No React, no I/O.
 * -------------------------------------------------------------------------- */

export const PPL = ['push', 'pull', 'legs']
export const PPL_LABEL = { push: 'Push', pull: 'Pull', legs: 'Legs' }

const daysBetween = (aIso, bIso) => {
  const a = new Date(aIso + 'T00:00:00'), b = new Date(bIso + 'T00:00:00')
  return Math.round((b - a) / 86400000)
}

// Keep only the typed Push/Pull/Legs sessions, ascending. Legacy/unknown-type
// lifts and Upper/Lower swaps don't drive the rotation read.
export function pplHistory(hist) {
  return (hist || []).filter((h) => PPL.includes(h.day)).sort((a, b) => a.date.localeCompare(b.date))
}

// Days since each PPL type was last trained (null = never on record).
export function daysSinceEach(hist, todayIso) {
  const h = pplHistory(hist)
  const out = {}
  for (const t of PPL) {
    const last = [...h].reverse().find((x) => x.day === t)
    out[t] = last ? daysBetween(last.date, todayIso) : null
  }
  return out
}

// Session count per type inside a rolling window (days back from today).
export function distribution(hist, todayIso, windowDays) {
  const h = pplHistory(hist)
  const out = { push: 0, pull: 0, legs: 0 }
  for (const x of h) {
    if (daysBetween(x.date, todayIso) < windowDays) out[x.day] = (out[x.day] || 0) + 1
  }
  return out
}

// The type to train next. Least-recently-trained wins (a never-trained type,
// null, sorts first), so an overdue Legs jumps a strict Push→Pull→Legs cycle and
// the rotation self-corrects. Ties break in canonical PPL order. When perfectly
// balanced this collapses to the ordinary cyclic "next after the last session".
export function nextType(hist, todayIso) {
  const h = pplHistory(hist)
  if (!h.length) return 'push'
  const since = daysSinceEach(hist, todayIso)
  const rank = (t) => (since[t] == null ? Infinity : since[t])
  return [...PPL].sort((a, b) => {
    const d = rank(b) - rank(a) // longest-ago first
    if (d !== 0) return d
    return PPL.indexOf(a) - PPL.indexOf(b) // stable canonical tiebreak
  })[0]
}

// The full rolling-rotation adherence read for today.
export function rotationState(hist, todayIso, opts = {}) {
  const targetPerWeek = opts.targetPerWeek || 3
  const h = pplHistory(hist)
  const since = daysSinceEach(hist, todayIso)
  const dist14 = distribution(hist, todayIso, 14)
  const dist28 = distribution(hist, todayIso, 28)

  // Completed rotations = full Push+Pull+Legs sets. In a 28-day window, the
  // number of complete rotations is bounded by the least-trained type — you can't
  // have finished a rotation without hitting each day once.
  const completedRotations28 = Math.min(dist28.push, dist28.pull, dist28.legs)

  const next = nextType(hist, todayIso)

  // Expected cadence: at N sessions/week over 3 day-types, each type should recur
  // roughly every (7 / (N/3)) = 21/N days. A type is OVERDUE once it's gone past
  // ~1.5× that gap (or has never been trained while others have).
  const expectedGap = 21 / Math.max(1, targetPerWeek)
  const overdueThreshold = Math.round(expectedGap * 1.3)
  const overdue = PPL.filter((t) => {
    if (since[t] == null) return h.length > 0 // never trained, but training has started
    return since[t] > overdueThreshold
  }).sort((a, b) => (since[b] == null ? 1e6 : since[b]) - (since[a] == null ? 1e6 : since[a]))

  // Longest exposure gap: the most days any single type has gone untrained right
  // now — the sharp edge of an uneven rotation.
  const gapVals = PPL.map((t) => (since[t] == null ? (h.length ? Infinity : 0) : since[t]))
  const longestGapType = PPL[gapVals.indexOf(Math.max(...gapVals))]
  const longestGapDays = since[longestGapType]

  // Imbalance: over 28 days, is one type trained materially more than another?
  const counts = PPL.map((t) => dist28[t])
  const most = Math.max(...counts), least = Math.min(...counts)
  const overTrained = PPL.filter((t) => dist28[t] === most)
  const underTrained = PPL.filter((t) => dist28[t] === least)
  const imbalanced = h.length >= 3 && most - least >= 2

  return {
    daysSince: since,
    dist14, dist28,
    completedRotations28,
    next, nextLabel: PPL_LABEL[next],
    overdue, // ordered most-overdue first
    overdueType: overdue[0] || null,
    longestGapType, longestGapDays,
    imbalanced, overTrained, underTrained,
    sessionsPerWeekTarget: targetPerWeek,
    total: h.length,
  }
}

// One-line rotation guidance for the coach: names what's next and why, and
// surfaces the imbalance honestly. Returns { headline, detail } or null.
export function rotationCoachLine(rs) {
  if (!rs || !rs.total) return null
  const nextLabel = rs.nextLabel
  // An overdue type is the emphatic case — it jumped the queue for a reason.
  if (rs.overdueType && rs.overdueType === rs.next) {
    const since = rs.daysSince[rs.next]
    const ago = since == null ? "hasn't been on the schedule yet"
      : since >= 14 ? `hasn't been trained in ${since} days`
      : `is ${since} days out — the longest of the three`
    return {
      headline: `${nextLabel} is next.`,
      detail: `${nextLabel} ${ago}, so it jumps the rotation. Even the split before adding volume anywhere else.`,
    }
  }
  if (rs.imbalanced && rs.underTrained.length) {
    const under = rs.underTrained.map((t) => PPL_LABEL[t]).join(' and ')
    return {
      headline: `${nextLabel} is next.`,
      detail: `Your split is running heavy on ${rs.overTrained.map((t) => PPL_LABEL[t]).join('/')} — ${under} ${rs.underTrained.length > 1 ? 'are' : 'is'} behind. Prioritise the lagging day to even the rotation.`,
    }
  }
  return { headline: `${nextLabel} is next.`, detail: `Next in the rotation. Keep the Push / Pull / Legs cycle rolling.` }
}
