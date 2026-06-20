/* ---------- periodization (pure) --------------------------------------------
 * The MACRO layer over the training engine. The engine (train.js) handles the
 * micro — which day, which lifts, double-progression set/rep/weight targets. This
 * adds the strategy: where are we in the journey to the body-fat deadline, and
 * what's this week's intent.
 *
 * One repeating 4-week block (3:1), the same shape the whole way — the constant
 * philosophy. Each block waves: Accumulate -> Progress -> Intensify (heavy) ->
 * Deload. It DRIVES the session numbers (heavy week drops reps + adds load;
 * deload lightens load and cuts volume) and is ANNOUNCED on the dashboard.
 *
 * Pure: a function of profile.trainStart + profile.bodyFatDeadline + the date.
 * -------------------------------------------------------------------------- */

export const BLOCK_LEN = 4

// The four weeks of every block, in order. `line` = dashboard one-liner; `coach`
// = a longer directive read for the coach / session gate.
const PHASES = [
  { key: 'accumulate', label: 'Accumulate', short: 'Build 1',
    line: 'Build the base — full rep ranges, moderate load, bank the volume.',
    coach: 'Accumulation week. Clean reps in your normal range, 1–2 left in the tank. We lay the foundation this week.' },
  { key: 'progress', label: 'Progress', short: 'Build 2',
    line: 'Push the progression — add a rep or a little weight on every lift.',
    coach: 'Progress week. Beat last week — add a rep or nudge the weight wherever the bar lets you.' },
  { key: 'intensify', label: 'Intensify', short: 'Heavy',
    line: 'Strategic heavy week — compounds drop to 4–6 reps, load goes up.',
    coach: 'Heavy week — this is the strategic one. Compounds drop to 4–6 reps with more weight. It is how we keep strength while the fat comes off.' },
  { key: 'deload', label: 'Deload', short: 'Deload',
    line: 'Deload — about 65% load, fewer sets. Recover and get back on your feet.',
    coach: 'Deload week. Pull back to ~65% and cut the sets — this is planned, not a step back. Shed the fatigue so the next block hits harder.' },
]
export const PHASE_BY_KEY = Object.fromEntries(PHASES.map((p) => [p.key, p]))

const MS_DAY = 86400000
function mondayOf(iso) {
  const d = new Date(iso + 'T00:00:00')
  const dow = (d.getDay() + 6) % 7 // Mon=0..Sun=6
  d.setDate(d.getDate() - dow)
  return d.toISOString().slice(0, 10)
}
function daysBetween(aIso, bIso) {
  return Math.round((new Date(bIso + 'T00:00:00') - new Date(aIso + 'T00:00:00')) / MS_DAY)
}

// How a phase modifies the prescribed session numbers. loadMult scales the
// working weight; setDelta adjusts set count; heavy weeks swap in a low rep range.
export function phaseLoadMods(key) {
  switch (key) {
    case 'deload':    return { loadMult: 0.65, setDelta: -1, heavy: false, rir: 4 }
    case 'intensify': return { loadMult: 1.0, setDelta: 0, heavy: true, heavyRepLow: 4, heavyRepHigh: 6, rir: 1 }
    case 'progress':  return { loadMult: 1.0, setDelta: 0, heavy: false, rir: 1 }
    default:          return { loadMult: 1.0, setDelta: 0, heavy: false, rir: 2 } // accumulate
  }
}

// Where are we today in the macrocycle? Anchored to the Monday of profile.trainStart
// (set once when the feature launches) and bounded by the body-fat deadline.
export function trainingPhase(state, todayIso) {
  const profile = state.profile || {}
  const start = mondayOf(profile.trainStart || todayIso)
  const weekIndex = Math.max(0, Math.floor(daysBetween(start, todayIso) / 7)) // 0-based
  const phaseIdx = ((weekIndex % BLOCK_LEN) + BLOCK_LEN) % BLOCK_LEN
  const def = PHASES[phaseIdx]
  const blockNumber = Math.floor(weekIndex / BLOCK_LEN) + 1

  const deadline = profile.bodyFatDeadline || null
  let totalWeeks = null, totalBlocks = null, daysLeft = null, weeksLeft = null
  if (deadline) {
    daysLeft = Math.max(0, daysBetween(todayIso, deadline))
    const totalDays = Math.max(1, daysBetween(start, deadline))
    totalWeeks = Math.max(weekIndex + 1, Math.ceil(totalDays / 7))
    totalBlocks = Math.ceil(totalWeeks / BLOCK_LEN)
    weeksLeft = Math.ceil(daysLeft / 7)
  }

  return {
    key: def.key, label: def.label, short: def.short, line: def.line, coach: def.coach,
    weekIndex, weekNumber: weekIndex + 1, blockNumber, weekInBlock: phaseIdx + 1, blockLen: BLOCK_LEN,
    deload: def.key === 'deload', heavy: def.key === 'intensify',
    totalWeeks, totalBlocks, daysLeft, weeksLeft, deadline,
    mods: phaseLoadMods(def.key),
  }
}
