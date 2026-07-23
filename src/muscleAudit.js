/* ---------- weekly muscle-set audit (pure) ----------------------------------
 * Rotation adherence (rotation.js) answers "are the day-types even?" This answers
 * the finer question underneath it: "is each MUSCLE getting enough weekly work?"
 * The owner's real data showed the split running fine on paper while squat and RDL
 * volume quietly starved — a rotation can look balanced and still under-train the
 * hinge. So we count effective weekly sets per muscle from the logged sessions and
 * grade each against an evidence-based range.
 *
 * Effective sets: a working set counts 1.0 toward the exercise's primary muscle
 * and 0.5 toward each secondary mover it meaningfully loads (an incline press
 * gives the front delts and triceps real, if partial, stimulus). Only performed
 * sets count — reps must be logged.
 *
 * Pure: reads state.days sessions + todayIso. No React, no I/O.
 * -------------------------------------------------------------------------- */
import { EXERCISES } from './train'

const shiftIso = (iso, delta) => {
  const [y, m, d] = iso.split('-').map(Number)
  const nd = new Date(new Date(y, m - 1, d).getTime() + delta * 86400000)
  const p = (n) => String(n).padStart(2, '0')
  return `${nd.getFullYear()}-${p(nd.getMonth() + 1)}-${p(nd.getDate())}`
}

// Secondary movers each exercise loads at ~half credit. Keyed by exercise id; the
// PRIMARY muscle comes from EXERCISES[id].muscle and is never repeated here.
const SECONDARY = {
  bench_press: ['shoulders', 'triceps'],
  incline_db_press: ['shoulders', 'triceps'],
  shoulder_press: ['triceps'],
  cable_fly: ['shoulders'],
  triceps_pushdown: [],
  overhead_ext: [],
  lateral_raise: [],
  pull_up: ['biceps'],
  lat_pulldown: ['biceps'],
  barbell_row: ['biceps', 'rear-delts'],
  seated_row: ['biceps', 'rear-delts'],
  rear_delt_fly: [],
  face_pull: [],
  shrug: [],
  db_curl: [],
  hammer_curl: ['forearms'],
  wrist_curl: [],
  back_ext: ['glutes', 'hamstrings'],
  squat: ['glutes', 'hamstrings'],
  rdl: ['glutes', 'lower-back'],
  hip_thrust: ['hamstrings'],
  leg_press: ['glutes'],
  leg_curl: [],
  leg_ext: [],
  cable_kickback: [],
  calf_raise: [],
  tib_raise: [],
}

// The muscles we grade, with a weekly effective-set range. Compounds carry a
// wider band than isolation work. Movement-pattern priority (hinge, squat, press,
// pull) is expressed by giving the prime movers a firmer floor.
export const MUSCLE_TARGETS = {
  chest:      { label: 'Chest',      low: 10, high: 20, pattern: 'press' },
  back:       { label: 'Back',       low: 10, high: 20, pattern: 'pull' },
  quads:      { label: 'Quads',      low: 8,  high: 18, pattern: 'squat' },
  hamstrings: { label: 'Hamstrings', low: 8,  high: 16, pattern: 'hinge', priority: true },
  glutes:     { label: 'Glutes',     low: 6,  high: 16, pattern: 'hinge' },
  shoulders:  { label: 'Shoulders',  low: 8,  high: 18, pattern: 'press' },
  'rear-delts': { label: 'Rear delts', low: 6, high: 14, pattern: 'pull' },
  triceps:    { label: 'Triceps',    low: 6,  high: 14, pattern: 'press' },
  biceps:     { label: 'Biceps',     low: 6,  high: 14, pattern: 'pull' },
  calves:     { label: 'Calves',     low: 6,  high: 16, pattern: 'legs' },
  core:       { label: 'Core',       low: 6,  high: 16, pattern: 'core' },
}
// Below this effective-set count a muscle is genuinely under-exposed; above the
// excessive line it's likely stealing recovery from priority work.
const UNDEREXPOSED = 4
const EXCESSIVE = 16

// Tally effective sets per muscle over the last `days` days of completed sessions.
export function weeklyMuscleSets(state, todayIso, days = 7, exerciseMuscles = {}) {
  const D = state?.days || {}
  const tally = {}
  const add = (m, credit) => { if (m) tally[m] = (tally[m] || 0) + credit }
  for (let i = 0; i < days; i++) {
    const sess = D[shiftIso(todayIso, -i)]?.workout?.session
    if (!sess || sess.status !== 'done') continue
    for (const ex of sess.exercises || []) {
      const performed = (ex.sets || []).filter((s) => s.reps > 0).length
      if (!performed) continue
      const meta = EXERCISES[ex.id]
      // Custom exercises carry their muscles inline (primary + optional secondary).
      const primary = meta?.muscle || ex.muscle || exerciseMuscles[ex.id]?.primary
      const secondary = meta ? (SECONDARY[ex.id] || []) : (ex.secondary || exerciseMuscles[ex.id]?.secondary || [])
      add(normalizeMuscle(primary), performed * 1.0)
      for (const s of secondary) add(normalizeMuscle(s), performed * 0.5)
    }
  }
  return tally
}

// Fold the fine-grained exercise muscles onto the graded groups (lats/traps →
// back, side/front delts → shoulders, etc.) so the audit reads at a useful level.
function normalizeMuscle(m) {
  if (!m) return null
  const map = {
    lats: 'back', traps: 'back', 'lower-back': 'back',
    'side-delts': 'shoulders', 'front-delts': 'shoulders', neck: null, forearms: 'biceps', tibialis: 'calves',
  }
  return m in map ? map[m] : m
}

// The graded audit: every tracked muscle with its weekly effective sets, its
// range, and a verdict. `status`: 'under' (below the range floor), 'low' (inside
// the low third), 'ok', 'high' (above the range ceiling), 'excessive'.
export function muscleAudit(state, todayIso, days = 7, exerciseMuscles = {}) {
  const sets = weeklyMuscleSets(state, todayIso, days, exerciseMuscles)
  const rows = Object.entries(MUSCLE_TARGETS).map(([key, t]) => {
    const n = Math.round((sets[key] || 0) * 10) / 10
    let status
    if (n < UNDEREXPOSED) status = 'under'
    else if (n < t.low) status = 'low'
    else if (n > EXCESSIVE && n > t.high) status = 'excessive'
    else if (n > t.high) status = 'high'
    else status = 'ok'
    return { key, label: t.label, sets: n, low: t.low, high: t.high, pattern: t.pattern, priority: !!t.priority, status }
  })
  const under = rows.filter((r) => r.status === 'under' || r.status === 'low')
  const excessive = rows.filter((r) => r.status === 'excessive')
  // Priority patterns (hinge/squat) are called out first when they lag.
  const priorityGaps = under.filter((r) => r.pattern === 'hinge' || r.pattern === 'squat')
  return { rows, under, excessive, priorityGaps, hasData: Object.keys(sets).length > 0 }
}

// One directive coach line from the audit, or null. Priority movement patterns
// (the hinge and squat) speak first — the exact gap the owner's data exposed.
export function muscleAuditCoachLine(audit) {
  if (!audit || !audit.hasData) return null
  if (audit.priorityGaps.length) {
    const g = audit.priorityGaps.sort((a, b) => a.sets - b.sets)[0]
    return {
      headline: `${g.label} is under-trained.`,
      detail: `Only ${g.sets} effective sets this week against a ${g.low}–${g.high} target. The hinge and squat drive the whole lower body — add a working set or two before touching anything else.`,
    }
  }
  if (audit.under.length) {
    const g = audit.under.sort((a, b) => a.sets - b.sets)[0]
    return {
      headline: `${g.label} volume is light.`,
      detail: `${g.sets} sets this week, below the ${g.low}–${g.high} range. Add a set the next time it comes up.`,
    }
  }
  if (audit.excessive.length) {
    const g = audit.excessive[0]
    return {
      headline: `${g.label} volume is very high.`,
      detail: `${g.sets} sets this week — past the ${g.high} ceiling. That's eating recovery; pull it back toward the range and spend the effort on a lagging group.`,
    }
  }
  return null
}
