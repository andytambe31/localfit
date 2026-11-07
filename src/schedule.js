/* ---------- fixed weekly training schedule (pure) ---------------------------
 * The transformation program runs a FIXED day-of-week split (not the rolling
 * least-recently-trained rotation): Upper A / Cardio+Mobility / Upper B /
 * Recovery / Lower A / Lower B / Active Recovery. Each lifting day has an explicit
 * exercise list (the spec's). Periodization waves (accumulate/progress/heavy/
 * deload, from periodize.js) still drive the set/rep/load numbers on top of these.
 *
 * Everything here is a DEFAULT: the real schedule lives in profile.weeklySchedule
 * (weekday 0=Sun..6=Sat → session key) and is fully editable, so Saturday's lower
 * day can be moved to Sunday, days swapped, etc.
 *
 * Exercise set/rep schemes come from the EXERCISES library (train.js), whose
 * defaults were set to match the program; templates just list the ids + the core
 * block + the morning cardio note. Pure: data + small helpers, no imports.
 * -------------------------------------------------------------------------- */

// Session templates. `kind:'lift'` days carry `dayType` (upper/lower — drives
// warmups/cooldowns + history), an ordered `exercises` list, and a `core` block.
// Non-lifting days carry cardio / mobility / recovery guidance instead.
export const SESSION_TEMPLATES = {
  upper_a: {
    key: 'upper_a', kind: 'lift', dayType: 'upper', label: 'Upper Body A',
    exercises: ['db_bench_press', 'lat_pulldown', 'incline_db_press', 'seated_row', 'lateral_raise', 'triceps_pushdown', 'db_curl'],
    core: ['cable_crunch', 'dead_bug'],
    morningCardioMin: 15, cardioNote: '15–20 min easy cardio in the morning.',
  },
  upper_b: {
    key: 'upper_b', kind: 'lift', dayType: 'upper', label: 'Upper Body B',
    exercises: ['incline_db_press', 'chest_supported_row', 'shoulder_press', 'lat_pulldown', 'lateral_raise', 'cable_curl', 'overhead_ext'],
    core: ['pallof_press'],
    morningCardioMin: 15, cardioNote: '15–20 min easy cardio in the morning.',
  },
  lower_a: {
    key: 'lower_a', kind: 'lift', dayType: 'lower', label: 'Lower Body A',
    exercises: ['goblet_squat', 'rdl', 'bulgarian_split_squat', 'leg_curl', 'calf_raise', 'farmers_carry'],
    core: [],
    morningCardioMin: 12, cardioNote: '10–15 min easy cardio in the morning.',
  },
  lower_b: {
    key: 'lower_b', kind: 'lift', dayType: 'lower', label: 'Lower Body B',
    exercises: ['leg_press', 'hip_thrust', 'reverse_lunge', 'leg_curl', 'seated_calf_raise'],
    core: ['side_plank'],
    morningCardioMin: 15, cardioNote: 'Optional 15–20 min easy cardio in the morning.', lighter: true,
  },
  cardio_mobility: {
    key: 'cardio_mobility', kind: 'cardio', label: 'Cardio & Mobility',
    cardioMin: 20, mobility: true,
    note: '20 min cross-trainer in the morning. Optional 10 min mobility in the evening — no mandatory gym session.',
  },
  recovery: {
    key: 'recovery', kind: 'recovery', label: 'Cardio & Recovery',
    cardioMin: 20, optionalWalk: true,
    note: '20 min easy cross-trainer in the morning. Rest or light mobility in the evening; optional 15–20 min walk.',
  },
  active_recovery: {
    key: 'active_recovery', kind: 'recovery', label: 'Active Recovery',
    cardioMin: 20, mobility: true, review: true,
    note: 'Optional 15–20 min easy cardio or a walk, 10 min mobility. Weekly review and meal prep.',
  },
}

export const SESSION_OPTIONS = Object.values(SESSION_TEMPLATES).map((t) => ({ key: t.key, label: t.label, kind: t.kind }))

// Default weekly schedule (weekday 0=Sun … 6=Sat).
export const WEEKLY_SCHEDULE_DEFAULT = {
  0: 'active_recovery', // Sun
  1: 'upper_a',         // Mon
  2: 'cardio_mobility', // Tue
  3: 'upper_b',         // Wed
  4: 'recovery',        // Thu
  5: 'lower_a',         // Fri
  6: 'lower_b',         // Sat
}

export const WEEKDAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function scheduleFor(profile) {
  return { ...WEEKLY_SCHEDULE_DEFAULT, ...(profile?.weeklySchedule || {}) }
}

// The session key scheduled for a given weekday (0=Sun..6=Sat).
export function sessionKeyForWeekday(profile, weekday) {
  return scheduleFor(profile)[weekday] || 'recovery'
}

export const templateFor = (key) => SESSION_TEMPLATES[key] || null
export const isLiftKey = (key) => SESSION_TEMPLATES[key]?.kind === 'lift'

// The template scheduled for an ISO date (local weekday).
export function sessionForDate(profile, iso) {
  const wd = new Date(iso + 'T00:00:00').getDay()
  return templateFor(sessionKeyForWeekday(profile, wd))
}
