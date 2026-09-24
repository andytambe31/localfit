/* ---------- program phase (pure) --------------------------------------------
 * The TOP layer over everything: which chapter of the journey the owner is in.
 * Phase 1 was foundation — build the habits, a flexible protein-first diet, a
 * 3-day Push/Pull/Legs rotation at a moderate deficit. Phase 2 ("Strength &
 * Lean") is the deliberate step up: a modest deficit so heavy lifting leads,
 * more protein, four harder training days across a five-type split, and a rigid
 * daily meal plan instead of a loose target.
 *
 * The design keeps coupling low: starting a phase WRITES its concrete numbers
 * into the profile (deficit, gymTargetPerWeek, proteinPerKg), so the existing
 * diet + training engines pick them up with almost no rewiring. This module owns
 * the phase definitions, the transition patch, the meal-plan template, and the
 * small read helpers the command center renders.
 *
 * Pure: functions of profile + state + date. No React, no I/O.
 * -------------------------------------------------------------------------- */

// Every phase's parameters. `id` is the phase number; the profile stores
// { id, startedDate, goal } and the concrete dials get copied onto the profile
// at transition so the engines read them directly.
export const PHASE_DEFS = {
  1: {
    id: 1, name: 'Phase 1', tag: 'Foundation',
    blurb: 'Build the habits. Moderate deficit, protein-first, three days on the rotation.',
    deficit: 500,
    proteinPerKg: { floor: 1.7, preferred: 1.9, stretch: 2.1 },
    gymTargetPerWeek: 3,
    split: ['push', 'pull', 'legs'],
    intensity: { rirTarget: '2', extraCompoundSets: 0, finisher: false },
  },
  2: {
    id: 2, name: 'Phase 2', tag: 'Strength & Lean',
    blurb: 'Heavy lifting leads. A modest deficit protects strength while you lean out, protein goes up, and training gets harder and more frequent.',
    goal: 'strength-lean',
    // Modest deficit: fat loss is secondary to holding and building strength.
    deficit: 300,
    // More protein to fuel heavy work on a deficit.
    proteinPerKg: { floor: 1.9, preferred: 2.1, stretch: 2.3 },
    // Four harder days across a five-type rolling split (upper/lower add frequency).
    gymTargetPerWeek: 4,
    split: ['upper', 'lower', 'push', 'pull', 'legs'],
    // Push effort: less in reserve, an extra compound set, a finisher on the last move.
    intensity: { rirTarget: '1', extraCompoundSets: 1, finisher: true },
    // Rigid daily meal plan: fixed slots at fixed times, each with a share of the
    // day's protein + calories. Suggestions are filled from the pantry/location by
    // the diet layer; this template just fixes the shape and timing.
    meals: [
      { slot: 'breakfast', time: '8:00 AM', label: 'Breakfast', proteinShare: 0.22, kcalShare: 0.22, note: 'Protein + slow carbs to open the day.' },
      { slot: 'lunch', time: '12:30 PM', label: 'Lunch', proteinShare: 0.28, kcalShare: 0.30, note: 'Your biggest protein hit — lean meat, a full plate.' },
      { slot: 'snack', time: '4:00 PM', label: 'Pre-lift fuel', proteinShare: 0.18, kcalShare: 0.16, note: 'A protein snack before you train — carries the heavy sets.' },
      { slot: 'dinner', time: '8:00 PM', label: 'Dinner', proteinShare: 0.28, kcalShare: 0.28, note: 'Post-lift: protein to recover, keep it lean.' },
      { slot: 'bedtime', time: '10:00 PM', label: 'Before bed', proteinShare: 0.04, kcalShare: 0.04, note: 'Optional slow protein — Greek yogurt or casein if you\'re short.' },
    ],
  },
}

export const MAX_PHASE = 2

// The phase the owner is currently in (defaults to 1 for a fresh profile).
export function currentPhaseId(profile) {
  return profile?.phase?.id || 1
}
export function phaseDef(id) { return PHASE_DEFS[id] || PHASE_DEFS[1] }
export function currentPhase(profile) { return phaseDef(currentPhaseId(profile)) }

// The profile patch that STARTS a phase: stamps the transition and copies the
// phase's concrete dials onto the profile so the diet + training engines read
// them without extra wiring. Applied via updateProfile.
export function startPhasePatch(id, dateIso) {
  const d = phaseDef(id)
  return {
    phase: { id: d.id, startedDate: dateIso, goal: d.goal || null },
    deficit: d.deficit,
    gymTargetPerWeek: d.gymTargetPerWeek,
    proteinPerKg: d.proteinPerKg,
  }
}

// Is the owner eligible to advance? (There's a next phase, and they're not on it.)
export function nextPhaseId(profile) {
  const cur = currentPhaseId(profile)
  return cur < MAX_PHASE ? cur + 1 : null
}

const MS_DAY = 86400000
const daysBetween = (aIso, bIso) =>
  Math.round((new Date(bIso + 'T00:00:00') - new Date(aIso + 'T00:00:00')) / MS_DAY)

// Days / weeks since the current phase began (0 if never started / today).
export function phaseElapsed(profile, todayIso) {
  const started = profile?.phase?.startedDate
  if (!started) return { days: 0, weeks: 0, started: null }
  const days = Math.max(0, daysBetween(started, todayIso))
  return { days, weeks: Math.floor(days / 7) + 1, started }
}

// Is this the profile's split running a five-type (upper/lower) rotation? Used to
// switch the rotation engine over without a hard dependency on phase internals.
export function phaseSplit(profile) {
  return currentPhase(profile).split || ['push', 'pull', 'legs']
}
export function phaseIntensity(profile) {
  return currentPhase(profile).intensity || { rirTarget: '2', extraCompoundSets: 0, finisher: false }
}
