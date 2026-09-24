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
export const PPL_LABEL = { push: 'Push', pull: 'Pull', legs: 'Legs', upper: 'Upper', lower: 'Lower' }

const daysBetween = (aIso, bIso) => {
  const a = new Date(aIso + 'T00:00:00'), b = new Date(bIso + 'T00:00:00')
  return Math.round((b - a) / 86400000)
}

// Keep only the typed sessions in the split, ascending. `types` defaults to PPL
// (Phase 1); Phase 2 passes a five-type split (upper/lower/push/pull/legs).
export function pplHistory(hist, types = PPL) {
  const set = new Set(types)
  return (hist || []).filter((h) => set.has(h.day)).sort((a, b) => a.date.localeCompare(b.date))
}

// Days since each split type was last trained (null = never on record).
export function daysSinceEach(hist, todayIso, types = PPL) {
  const h = pplHistory(hist, types)
  const out = {}
  for (const t of types) {
    const last = [...h].reverse().find((x) => x.day === t)
    out[t] = last ? daysBetween(last.date, todayIso) : null
  }
  return out
}

// Session count per type inside a rolling window (days back from today).
export function distribution(hist, todayIso, windowDays, types = PPL) {
  const h = pplHistory(hist, types)
  const out = {}
  for (const t of types) out[t] = 0
  for (const x of h) {
    if (daysBetween(x.date, todayIso) < windowDays) out[x.day] = (out[x.day] || 0) + 1
  }
  return out
}

// The type to train next. Least-recently-trained wins (a never-trained type,
// null, sorts first), so an overdue day jumps a strict cycle and the rotation
// self-corrects. Ties break in the split's canonical order.
export function nextType(hist, todayIso, types = PPL) {
  const h = pplHistory(hist, types)
  if (!h.length) return types[0]
  const since = daysSinceEach(hist, todayIso, types)
  const rank = (t) => (since[t] == null ? Infinity : since[t])
  return [...types].sort((a, b) => {
    const d = rank(b) - rank(a) // longest-ago first
    if (d !== 0) return d
    return types.indexOf(a) - types.indexOf(b) // stable canonical tiebreak
  })[0]
}

// The full rolling-rotation adherence read for today.
export function rotationState(hist, todayIso, opts = {}) {
  const types = opts.types || PPL
  const targetPerWeek = opts.targetPerWeek || 3
  const h = pplHistory(hist, types)
  const since = daysSinceEach(hist, todayIso, types)
  const dist14 = distribution(hist, todayIso, 14, types)
  const dist28 = distribution(hist, todayIso, 28, types)

  // Completed rotations = full sets covering every type in the split. Bounded by
  // the least-trained type — you can't finish a rotation without hitting each once.
  const completedRotations28 = Math.min(...types.map((t) => dist28[t]))

  const next = nextType(hist, todayIso, types)

  // Expected cadence: at N sessions/week over K day-types, each type should recur
  // roughly every (7*K/N) days. A type is OVERDUE once it's ~1.3× past that gap
  // (or has never been trained while others have).
  const expectedGap = (7 * types.length) / Math.max(1, targetPerWeek)
  const overdueThreshold = Math.round(expectedGap * 1.3)
  const overdue = types.filter((t) => {
    if (since[t] == null) return h.length > 0 // never trained, but training has started
    return since[t] > overdueThreshold
  }).sort((a, b) => (since[b] == null ? 1e6 : since[b]) - (since[a] == null ? 1e6 : since[a]))

  // Longest exposure gap: the most days any single type has gone untrained now.
  const gapVals = types.map((t) => (since[t] == null ? (h.length ? Infinity : 0) : since[t]))
  const longestGapType = types[gapVals.indexOf(Math.max(...gapVals))]
  const longestGapDays = since[longestGapType]

  // Imbalance: over 28 days, is one type trained materially more than another?
  const counts = types.map((t) => dist28[t])
  const most = Math.max(...counts), least = Math.min(...counts)
  const overTrained = types.filter((t) => dist28[t] === most)
  const underTrained = types.filter((t) => dist28[t] === least)
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
