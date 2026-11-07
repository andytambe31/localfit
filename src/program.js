/* ---------- six-month transformation program (pure) -------------------------
 * The calendar spine over everything: a dated Nov 8 2026 – Apr 30 2027 program
 * broken into seven phases (0–6). Unlike the old habit-tier phases, these advance
 * by the CALENDAR — the current phase is simply whichever dated window contains
 * today — and a phase transition NEVER changes a calorie or training target.
 * Phases carry focus, not dials; targets are the user's, edited explicitly.
 *
 * Program dates and daily targets are editable: the engine reads profile.program
 * and profile.targets, falling back to these defaults.
 *
 * Pure: functions of profile + date. No React, no I/O, no imports.
 * -------------------------------------------------------------------------- */

export const PROGRAM = { start: '2026-11-08', end: '2027-04-30', startWeightKg: 74.5 }

// The seven phases, dated and inclusive. `focus` = this phase's intentions (shown,
// not enforced). Copy is directive but never prescribes an automatic calorie cut.
export const PROGRAM_PHASES = [
  { n: 0, tag: 'Baseline', start: '2026-11-08', end: '2026-11-15',
    line: 'Set the baseline — log food, start training, take your first photos.',
    focus: ['Establish baseline weight, waist, and photos', 'Set up food logging', 'Begin structured training', 'Establish grocery planning'] },
  { n: 1, tag: 'Consistency', start: '2026-11-16', end: '2026-12-13',
    line: 'Lock in the habits — nutrition consistency and clean technique.',
    focus: ['Nutrition consistency', 'Exercise technique', 'Progressive overload', 'Consistent morning habits'] },
  { n: 2, tag: 'Build Capacity', start: '2026-12-14', end: '2027-01-10',
    line: 'Keep the fat coming off while strength and cardio climb.',
    focus: ['Continue gradual fat loss', 'Improve strength', 'Build cardio capacity', 'Review recovery'] },
  { n: 3, tag: 'Develop', start: '2027-01-11', end: '2027-02-07',
    line: 'Review the trend, adjust nutrition if needed, build muscle.',
    focus: ['Review progress', 'Adjust nutrition if necessary', 'Continue muscular development'] },
  { n: 4, tag: 'Reinforce', start: '2027-02-08', end: '2027-03-07',
    line: 'Hold the line — abs and progressive resistance.',
    focus: ['Maintain consistency', 'Improve abdominal strength', 'Continue progressive resistance training'] },
  { n: 5, tag: 'Refine', start: '2027-03-08', end: '2027-04-04',
    line: 'Evaluate composition, keep strength, no crash dieting.',
    focus: ['Evaluate body composition', 'Maintain strength', 'Avoid unnecessary aggressive dieting'] },
  { n: 6, tag: 'Assess', start: '2027-04-05', end: '2027-04-30',
    line: 'Final assessment — repeat the baseline and plan what is next.',
    focus: ['Final progress assessment', 'Repeat baseline measurements', 'Compare strength and fitness', 'Evaluate sustainable next steps'] },
]

// Default editable daily targets. Calories are a RANGE the user owns (the auto-TDEE
// engine only advises). Carbs are the remainder after protein + fat.
export const DEFAULT_TARGETS = {
  kcal: 1950, kcalMin: 1900, kcalMax: 2000,
  protein: 150,
  fat: 60, fatMin: 55, fatMax: 65,
  fiberMin: 25, fiberMax: 35,
  waterMl: 2500,
}

const MS_DAY = 86400000
const parseIso = (iso) => new Date(iso + 'T00:00:00')
const daysBetween = (aIso, bIso) => Math.round((parseIso(bIso) - parseIso(aIso)) / MS_DAY)

export function programWindow(profile) {
  const p = profile?.program || {}
  return { start: p.start || PROGRAM.start, end: p.end || PROGRAM.end, startWeightKg: p.startWeightKg ?? PROGRAM.startWeightKg }
}

// The phase for a given date: the dated window that contains it. Before the program
// starts → { pre:true } pointing at Phase 0; after it ends → { post:true } at Phase 6.
export function programPhase(profile, todayIso) {
  const { start, end } = programWindow(profile)
  if (todayIso < start) return { ...PROGRAM_PHASES[0], pre: true, startsIn: daysBetween(todayIso, start) }
  if (todayIso > end) return { ...PROGRAM_PHASES[PROGRAM_PHASES.length - 1], post: true }
  const found = PROGRAM_PHASES.find((ph) => todayIso >= ph.start && todayIso <= ph.end)
  return found || { ...PROGRAM_PHASES[0] }
}

// Where are we in the whole program? day / total / week / percent / days left.
export function programProgress(profile, todayIso) {
  const { start, end } = programWindow(profile)
  const totalDays = Math.max(1, daysBetween(start, end) + 1)
  const dayIndex = Math.min(totalDays, Math.max(0, daysBetween(start, todayIso) + 1)) // 1-based once started
  const started = todayIso >= start
  const weekIndex = started ? Math.floor(daysBetween(start, todayIso) / 7) + 1 : 0
  const daysLeft = Math.max(0, daysBetween(todayIso, end))
  const pct = started ? Math.min(100, Math.round((dayIndex / totalDays) * 100)) : 0
  return { totalDays, dayIndex: started ? dayIndex : 0, weekIndex, daysLeft, pct, started, totalWeeks: Math.ceil(totalDays / 7) }
}

// Day index WITHIN the current phase (1-based) + its length, for "day 3 of 8".
export function phaseProgress(profile, todayIso) {
  const ph = programPhase(profile, todayIso)
  const len = daysBetween(ph.start, ph.end) + 1
  const day = todayIso < ph.start ? 0 : Math.min(len, daysBetween(ph.start, todayIso) + 1)
  return { day, len, weeks: Math.ceil(len / 7) }
}
