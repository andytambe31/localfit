/* ---------- training engine (pure) ------------------------------------------
 * The "brains" of the trainer. Given the full app state and today's date, it
 * decides ONE authoritative session: which day-type (Push/Pull/Legs or Rest),
 * which lagging body part to emphasize, and the exact exercises — warm-up,
 * working sets (with double-progression targets pre-filled from history), and a
 * full cooldown stretch routine. The user never picks or swaps anything.
 *
 * Everything here is a pure function of `state` + `dateIso`; no React, no I/O.
 * Weights are pounds (lb). Progressive overload = double progression: hold the
 * weight and add a rep until the top of the range, then bump weight (smart
 * per-exercise jump) and reset reps to the bottom.
 * -------------------------------------------------------------------------- */

// ---- libraries --------------------------------------------------------------

// Working-set exercise library (commercial gym, full equipment). `inc` is the
// smart weight jump in lb when double progression tops out. `emph` lists the
// lagging body parts an exercise serves, so emphasis days can pull from here.
export const EXERCISES = {
  // --- PUSH ---
  bench_press:        { name: 'Barbell Bench Press',        day: 'push', muscle: 'chest',     role: 'compound',   sets: 4, repLow: 6,  repHigh: 10, inc: 5 },
  incline_db_press:   { name: 'Incline Dumbbell Press',     day: 'push', muscle: 'chest',     role: 'compound',   sets: 3, repLow: 8,  repHigh: 12, inc: 5 },
  shoulder_press:     { name: 'Seated DB Shoulder Press',   day: 'push', muscle: 'shoulders', role: 'compound',   sets: 3, repLow: 8,  repHigh: 12, inc: 5 },
  lateral_raise:      { name: 'Cable Lateral Raise',        day: 'push', muscle: 'shoulders', role: 'isolation',  sets: 3, repLow: 12, repHigh: 18, inc: 5,  emph: ['side-delts'] },
  cable_fly:          { name: 'Cable Chest Fly',            day: 'push', muscle: 'chest',     role: 'isolation',  sets: 3, repLow: 12, repHigh: 15, inc: 5 },
  triceps_pushdown:   { name: 'Triceps Rope Pushdown',      day: 'push', muscle: 'triceps',   role: 'isolation',  sets: 3, repLow: 10, repHigh: 15, inc: 5 },
  overhead_ext:       { name: 'Overhead Cable Extension',   day: 'push', muscle: 'triceps',   role: 'isolation',  sets: 3, repLow: 10, repHigh: 15, inc: 5 },

  // --- PULL ---
  lat_pulldown:       { name: 'Lat Pulldown',               day: 'pull', muscle: 'back',      role: 'compound',   sets: 4, repLow: 8,  repHigh: 12, inc: 5,  emph: ['lats'] },
  barbell_row:        { name: 'Barbell Row',                day: 'pull', muscle: 'back',      role: 'compound',   sets: 3, repLow: 8,  repHigh: 12, inc: 5 },
  seated_row:         { name: 'Seated Cable Row',           day: 'pull', muscle: 'back',      role: 'compound',   sets: 3, repLow: 10, repHigh: 14, inc: 5,  emph: ['lats'] },
  rear_delt_fly:      { name: 'Reverse Pec-Deck Fly',       day: 'pull', muscle: 'shoulders', role: 'isolation',  sets: 3, repLow: 12, repHigh: 18, inc: 5,  emph: ['rear-delts'] },
  face_pull:          { name: 'Cable Face Pull',            day: 'pull', muscle: 'shoulders', role: 'isolation',  sets: 3, repLow: 15, repHigh: 20, inc: 5,  emph: ['rear-delts'] },
  shrug:              { name: 'Dumbbell Shrug',             day: 'pull', muscle: 'traps',     role: 'isolation',  sets: 3, repLow: 12, repHigh: 15, inc: 5,  emph: ['neck'] },
  db_curl:            { name: 'Incline Dumbbell Curl',      day: 'pull', muscle: 'biceps',    role: 'isolation',  sets: 3, repLow: 8,  repHigh: 12, inc: 5 },
  hammer_curl:        { name: 'Hammer Curl',                day: 'pull', muscle: 'biceps',    role: 'isolation',  sets: 3, repLow: 10, repHigh: 14, inc: 5,  emph: ['forearms'] },
  wrist_curl:         { name: 'Seated Wrist Curl',          day: 'pull', muscle: 'forearms',  role: 'isolation',  sets: 3, repLow: 12, repHigh: 20, inc: 5,  emph: ['forearms'] },
  back_ext:           { name: 'Back Extension',             day: 'pull', muscle: 'lower-back',role: 'isolation',  sets: 3, repLow: 12, repHigh: 15, inc: 5,  emph: ['lower-back'] },

  // --- LEGS ---
  squat:              { name: 'Barbell Back Squat',         day: 'legs', muscle: 'quads',     role: 'compound',   sets: 4, repLow: 6,  repHigh: 10, inc: 10 },
  rdl:                { name: 'Romanian Deadlift',          day: 'legs', muscle: 'hamstrings',role: 'compound',   sets: 3, repLow: 8,  repHigh: 12, inc: 10, emph: ['glutes', 'lower-back'] },
  hip_thrust:         { name: 'Barbell Hip Thrust',         day: 'legs', muscle: 'glutes',    role: 'compound',   sets: 3, repLow: 8,  repHigh: 12, inc: 10, emph: ['glutes'] },
  leg_press:          { name: 'Leg Press',                  day: 'legs', muscle: 'quads',     role: 'compound',   sets: 3, repLow: 10, repHigh: 15, inc: 10 },
  leg_curl:           { name: 'Seated Leg Curl',            day: 'legs', muscle: 'hamstrings',role: 'isolation',  sets: 3, repLow: 10, repHigh: 15, inc: 5 },
  leg_ext:            { name: 'Leg Extension',              day: 'legs', muscle: 'quads',     role: 'isolation',  sets: 3, repLow: 12, repHigh: 15, inc: 5 },
  cable_kickback:     { name: 'Cable Glute Kickback',       day: 'legs', muscle: 'glutes',    role: 'isolation',  sets: 3, repLow: 12, repHigh: 15, inc: 5,  emph: ['glutes'] },
  calf_raise:         { name: 'Standing Calf Raise',        day: 'legs', muscle: 'calves',    role: 'isolation',  sets: 4, repLow: 10, repHigh: 15, inc: 10, emph: ['calves'] },
  tib_raise:          { name: 'Tibialis Raise',             day: 'legs', muscle: 'tibialis',  role: 'isolation',  sets: 3, repLow: 15, repHigh: 20, inc: 5,  emph: ['tibialis'] },
}

// Per day-type: the spine of the session. `core` always runs; `emphasisPool`
// holds extra isolation work pulled in when a lagging part is emphasized.
const DAY_PLAN = {
  push: { label: 'Push', muscles: ['chest', 'shoulders', 'triceps'],
          core: ['bench_press', 'incline_db_press', 'shoulder_press', 'cable_fly', 'triceps_pushdown'],
          emphasisPool: { 'side-delts': ['lateral_raise'], neck: ['shrug'], calves: ['calf_raise'] } },
  pull: { label: 'Pull', muscles: ['back', 'biceps', 'rear-delts'],
          core: ['lat_pulldown', 'barbell_row', 'seated_row', 'db_curl', 'hammer_curl'],
          emphasisPool: { lats: ['seated_row'], 'rear-delts': ['rear_delt_fly', 'face_pull'], forearms: ['wrist_curl'], 'lower-back': ['back_ext'], neck: ['shrug'] } },
  legs: { label: 'Legs', muscles: ['quads', 'hamstrings', 'glutes'],
          core: ['squat', 'rdl', 'leg_press', 'leg_curl', 'leg_ext'],
          emphasisPool: { glutes: ['hip_thrust', 'cable_kickback'], calves: ['calf_raise'], tibialis: ['tib_raise'], 'lower-back': ['back_ext'] } },
}

// Lagging body parts that biomechanically belong to each day (rotation order =
// priority). The engine emphasizes one per session, least-recently-hit first.
const LAGGING_BY_DAY = {
  push: ['side-delts', 'neck', 'calves'],
  pull: ['lats', 'rear-delts', 'forearms', 'lower-back', 'neck'],
  legs: ['glutes', 'calves', 'tibialis', 'lower-back'],
}

// Warm-up: a general primer plus day-specific activation. Optional treadmill is
// offered, never forced. `hold` null = no countdown (these are dynamic).
const WARMUPS = {
  push: [
    { id: 'wu_treadmill', name: 'Treadmill Walk', instruction: 'Five easy minutes to warm up. Optional — skip if you walked in.', optional: true, cardio: true, hold: null },
    { id: 'wu_arm_circles', name: 'Arm Circles', instruction: 'Twenty forward, twenty back. Loosen the shoulders.', hold: null },
    { id: 'wu_band_pullapart', name: 'Band Pull-Aparts', instruction: 'Two sets of fifteen. Wake up the upper back before pressing.', hold: null },
    { id: 'wu_light_press', name: 'Light Press Ramp', instruction: 'One light set of the first press to groove the pattern.', hold: null },
  ],
  pull: [
    { id: 'wu_treadmill', name: 'Treadmill Walk', instruction: 'Five easy minutes to warm up. Optional — skip if you walked in.', optional: true, cardio: true, hold: null },
    { id: 'wu_scap_pullup', name: 'Scapular Hangs', instruction: 'Two sets of ten scapular pulls from a bar. Set the shoulder blades.', hold: null },
    { id: 'wu_band_pullapart', name: 'Band Pull-Aparts', instruction: 'Two sets of fifteen. Prime the rear delts and mid-back.', hold: null },
    { id: 'wu_light_pulldown', name: 'Light Pulldown Ramp', instruction: 'One light set to feel the lats engage.', hold: null },
  ],
  legs: [
    { id: 'wu_treadmill', name: 'Treadmill Walk', instruction: 'Five easy minutes to warm up. Optional — skip if you walked in.', optional: true, cardio: true, hold: null },
    { id: 'wu_leg_swings', name: 'Leg Swings', instruction: 'Fifteen each leg, front-to-back and side-to-side.', hold: null },
    { id: 'wu_bodyweight_squat', name: 'Bodyweight Squats', instruction: 'Two sets of fifteen, full depth. Open the hips and knees.', hold: null },
    { id: 'wu_light_squat', name: 'Light Squat Ramp', instruction: 'Empty bar, then one light set to groove depth.', hold: null },
  ],
}

// Full cooldown stretch routine per day. `hold` seconds => the card shows a
// countdown you start; `hold: null` => dynamic, no timer.
const COOLDOWNS = {
  push: [
    { id: 'st_doorway_chest', name: 'Doorway Chest Stretch', instruction: 'Forearm on the frame, step through until you feel the chest open. Each side.', hold: 30 },
    { id: 'st_cross_shoulder', name: 'Cross-Body Shoulder', instruction: 'Pull the arm across your chest. Each side.', hold: 30 },
    { id: 'st_overhead_tri', name: 'Overhead Triceps', instruction: 'Reach down your back, gentle press on the elbow. Each side.', hold: 30 },
    { id: 'st_neck_lateral', name: 'Neck Lateral Stretch', instruction: 'Ear to shoulder, light hand assist. Each side.', hold: 20 },
  ],
  pull: [
    { id: 'st_lat_hang', name: 'Lat Hang Stretch', instruction: 'Hang from a bar or hold a post and lean back to lengthen the lats.', hold: 30 },
    { id: 'st_child_pose', name: "Child's Pose Reach", instruction: 'Sit back on your heels, reach long, sink the chest.', hold: 40 },
    { id: 'st_biceps_wall', name: 'Biceps Wall Stretch', instruction: 'Palm on the wall behind you, rotate away. Each side.', hold: 30 },
    { id: 'st_forearm', name: 'Forearm Flexor Stretch', instruction: 'Arm out, gently pull the fingers back. Each side.', hold: 25 },
  ],
  legs: [
    { id: 'st_kneeling_hip', name: 'Kneeling Hip Flexor', instruction: 'Half-kneel, tuck the pelvis, push the hips forward. Each side.', hold: 40 },
    { id: 'st_seated_ham', name: 'Seated Hamstring Reach', instruction: 'Leg extended in front, hinge forward over it. Each side.', hold: 40 },
    { id: 'st_pigeon_glute', name: 'Pigeon Glute Stretch', instruction: 'Shin across in front, fold forward over it. Each side.', hold: 45 },
    { id: 'st_calf_wall', name: 'Calf Wall Stretch', instruction: 'Back leg straight, heel down, lean into the wall. Each side.', hold: 30 },
    { id: 'st_quad_stand', name: 'Standing Quad Stretch', instruction: 'Heel to glute, knees together. Each side.', hold: 30 },
  ],
}

// ---- gym hours (a hard fact about the owner's gym) --------------------------
// Opens 8 AM every day. Closes 10 PM Mon–Thu, 9 PM Fri, 7 PM Sat–Sun. The
// trainer won't tell you to lift when the place is shut, and warns when the
// window is too tight for a real session. Hours are 24h; JS getDay: Sun=0..Sat=6.
const GYM = { open: 8, closeByDow: { 0: 19, 1: 22, 2: 22, 3: 22, 4: 22, 5: 21, 6: 19 } }
const SESSION_BUFFER_MIN = 15  // breathing room beyond the raw session estimate before we say "hurry"

function fmtHour(h) {
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr} ${ampm}`
}
// Open/closed + minutes until close for a given date and clock time.
export function gymStatus(dateIso, hour, minute = 0) {
  const dow = new Date(dateIso + 'T00:00:00').getDay()
  const closesAt = GYM.closeByDow[dow]
  const now = hour + minute / 60
  return {
    open: now >= GYM.open && now < closesAt,
    opensAt: GYM.open, closesAt,
    openLabel: fmtHour(GYM.open), closeLabel: fmtHour(closesAt),
    minsToClose: Math.max(0, Math.round((closesAt - now) * 60)),
  }
}

// ---- date helpers (date-only, local ISO YYYY-MM-DD) -------------------------

function daysBetween(aIso, bIso) {
  const a = new Date(aIso + 'T00:00:00'), b = new Date(bIso + 'T00:00:00')
  return Math.round((b - a) / 86400000)
}
// Monday-start week key, so "sessions this week" resets each Monday.
function weekKey(iso) {
  const d = new Date(iso + 'T00:00:00')
  const dow = (d.getDay() + 6) % 7 // Mon=0..Sun=6
  d.setDate(d.getDate() - dow)
  return d.toISOString().slice(0, 10)
}

// ---- history extraction -----------------------------------------------------

// Past *lifting* days, ascending: [{ date, day:'push'|'pull'|'legs', emphasis }].
// Reads new session shape; tolerates legacy `workout.type` ('Weights' => unknown
// day-type, still counts as a session but doesn't drive rotation).
export function liftingHistory(state, beforeIso) {
  const days = state.days || {}
  const out = []
  for (const date of Object.keys(days).sort()) {
    if (beforeIso && date >= beforeIso) continue
    const w = days[date].workout
    if (!w) continue
    const sess = w.session
    if (sess && sess.status === 'done' && DAY_PLAN[sess.dayType]) {
      out.push({ date, day: sess.dayType, emphasis: sess.emphasis || [] })
    } else if (w.did && w.type === 'Weights') {
      out.push({ date, day: null, emphasis: [] }) // legacy lift, day-type unknown
    }
  }
  return out
}

function sessionsThisWeek(hist, todayIso) {
  const wk = weekKey(todayIso)
  return hist.filter((h) => weekKey(h.date) === wk).length
}

const ROTATION = ['push', 'pull', 'legs']
function rotateAfter(day) {
  const i = ROTATION.indexOf(day)
  return i === -1 ? 'push' : ROTATION[(i + 1) % ROTATION.length]
}

// ---- the decisions ----------------------------------------------------------

// Decide today's day-type and *why*. Returns { dayType, reason, rest } where
// dayType is 'push'|'pull'|'legs' or 'rest'. Flexible scheduling: behind on the
// weekly target => train; target met and freshly trained => rest.
export function decideDayType(state, todayIso) {
  const profile = state.profile || {}
  const target = profile.gymTargetPerWeek || 3
  const hist = liftingHistory(state, todayIso) // exclude today; today is what we're deciding
  const last = hist[hist.length - 1]
  const lastTyped = [...hist].reverse().find((h) => h.day) // last day we know the type of
  const sinceLast = last ? daysBetween(last.date, todayIso) : Infinity
  const weekCount = sessionsThisWeek(hist, todayIso)

  // Rest recommendation: weekly target already met and trained within ~a day.
  if (weekCount >= target && sinceLast <= 1) {
    return { dayType: 'rest', rest: true,
      reason: `You've trained ${weekCount}× this week and lifted ${sinceLast === 0 ? 'today' : 'yesterday'}. Recover — walk, hit your steps, let the work land.` }
  }

  const next = lastTyped ? rotateAfter(lastTyped.day) : 'push'
  const plan = DAY_PLAN[next]
  let reason
  if (!lastTyped) {
    reason = `First session on record — we open the rotation with ${plan.label}.`
  } else {
    const ago = sinceLast === 1 ? 'yesterday' : sinceLast === Infinity ? 'a while ago' : `${sinceLast} days ago`
    reason = `Last lift was ${DAY_PLAN[lastTyped.day].label.toLowerCase()} ${ago} — those muscles are recovering, so today is ${plan.label}.`
  }
  return { dayType: next, rest: false, reason }
}

// Pick ONE lagging body part to emphasize for this day-type: the one belonging
// to this day that's gone longest without emphasis.
export function pickEmphasis(state, todayIso, dayType) {
  const candidates = LAGGING_BY_DAY[dayType] || []
  if (!candidates.length) return null
  const hist = liftingHistory(state, todayIso)
  let best = candidates[0], bestAgo = -1
  for (const part of candidates) {
    const lastHit = [...hist].reverse().find((h) => (h.emphasis || []).includes(part))
    const ago = lastHit ? daysBetween(lastHit.date, todayIso) : Infinity
    if (ago > bestAgo) { bestAgo = ago; best = part }
  }
  return best
}

// ---- progressive overload (double progression) ------------------------------

// The most recent completed sets logged for an exercise, scanning backwards.
function lastPerformed(state, exId, todayIso) {
  const days = state.days || {}
  for (const date of Object.keys(days).sort().reverse()) {
    if (date >= todayIso) continue
    const ex = days[date].workout?.session?.exercises?.find((e) => e.id === exId)
    if (ex && ex.sets?.some((s) => s.done && s.reps)) return ex.sets.filter((s) => s.done && s.reps)
  }
  return null
}

// The target to put in front of the user for an exercise this session. Double
// progression: add a rep until repHigh across the board, then +inc lb, reset to
// repLow. No history => blank weight, scaffold reps, a first-time note.
export function targetFor(state, exId, todayIso) {
  const ex = EXERCISES[exId]
  const last = lastPerformed(state, exId, todayIso)
  if (!last) {
    return { weight: null, reps: ex.repLow, sets: ex.sets, first: true,
      note: 'First time on record — log the weight you work with and we build from here.' }
  }
  const topReps = Math.max(...last.map((s) => s.reps))
  const topSet = last.find((s) => s.reps === topReps) || last[0]
  const topWeight = topSet.weight || 0
  const allAtTop = last.every((s) => s.reps >= ex.repHigh)
  if (allAtTop) {
    return { weight: topWeight + ex.inc, reps: ex.repLow, sets: ex.sets,
      note: `Every set hit ${ex.repHigh}. Up to ${topWeight + ex.inc} lb, back to ${ex.repLow} reps.` }
  }
  const goalReps = Math.min(ex.repHigh, topReps + 1)
  return { weight: topWeight, reps: goalReps, sets: ex.sets,
    note: `Last top set: ${topReps} reps at ${topWeight} lb. Beat it — ${goalReps} reps.` }
}

// ---- session assembly -------------------------------------------------------

// Build the full authoritative session for the day. Returns either a rest
// recommendation or { dayType, emphasis, warmup[], exercises[], cooldown[], reason }.
// `exercises` carry their double-progression target pre-filled.
export function buildSession(state, todayIso, opts = {}) {
  const decision = decideDayType(state, todayIso)
  if (decision.rest && !opts.force) return { dayType: 'rest', reason: decision.reason }

  // Rest was recommended but the user chose to train anyway → run the next
  // rotation day regardless.
  let dayType = decision.dayType
  if (decision.rest) {
    const hist = liftingHistory(state, todayIso)
    const lastTyped = [...hist].reverse().find((h) => h.day)
    dayType = lastTyped ? rotateAfter(lastTyped.day) : 'push'
  }
  const plan = DAY_PLAN[dayType]
  const emphasis = pickEmphasis(state, todayIso, dayType)

  // Core lifts, plus emphasis isolation appended (deduped, capped).
  const ids = [...plan.core]
  for (const exId of plan.emphasisPool[emphasis] || []) {
    if (!ids.includes(exId)) ids.push(exId)
  }

  const exercises = ids.map((id) => {
    const meta = EXERCISES[id]
    const target = targetFor(state, id, todayIso)
    return {
      id, name: meta.name, muscle: meta.muscle, role: meta.role,
      repLow: meta.repLow, repHigh: meta.repHigh, inc: meta.inc,
      emphasized: (meta.emph || []).includes(emphasis),
      cue: cueFor(id), rir: null, // form/intent cue + reps-in-reserve (effort)
      target,
      // a blank, logged-as-you-go set scaffold the flow fills in
      sets: Array.from({ length: target.sets }, () => ({ weight: target.weight, reps: null, done: false })),
    }
  })

  return {
    dayType, emphasis,
    label: plan.label,
    reason: decision.rest ? `Rest was the call, but you're training — so it's ${plan.label}, next in the rotation.` : decision.reason,
    emphasisReason: emphasis ? `Extra focus on ${labelFor(emphasis)} — it's lagging and fits ${plan.label.toLowerCase()} day.` : null,
    warmup: WARMUPS[dayType],
    exercises,
    cooldown: COOLDOWNS[dayType],
  }
}

function labelFor(part) {
  return { 'side-delts': 'side delts', 'rear-delts': 'rear delts', 'lower-back': 'lower back', lats: 'lats / back width' }[part] || part
}

// ---- in-the-moment coaching: form/intent cues (hypertrophy focus) -----------
const CUES = {
  bench_press: 'Blades pinned, slow to the chest, drive through the chest — not the shoulders.',
  incline_db_press: 'Stretch at the bottom, press up and slightly in, squeeze the upper chest.',
  shoulder_press: 'Brace your core, press without flaring, stop just short of lockout.',
  lateral_raise: 'Lead with the elbows, no swing — slow up, slower down. Side delts do the work.',
  cable_fly: 'Soft elbows, deep stretch, then hug the rep and squeeze the chest together.',
  triceps_pushdown: 'Elbows pinned to your sides, full lockout, control the way back up.',
  overhead_ext: 'Elbows tight, deep stretch behind the head, drive to lockout.',
  lat_pulldown: 'Drive elbows down and back to the upper chest — feel the lats, not the arms.',
  barbell_row: 'Hinge, flat back, pull to the belt, squeeze the shoulder blades.',
  seated_row: 'Chest up, pull to the stomach, control the stretch forward. Width is in the lats.',
  rear_delt_fly: 'Slight bend, lead with the pinkies, squeeze the rear delts — no momentum.',
  face_pull: 'Pull to your eyes, rotate the wrists out, hold the squeeze a beat.',
  shrug: 'Straight up to the ears, pause at the top, slow down. No rolling.',
  db_curl: 'Elbows still, turn the pinky up as you curl, full squeeze, slow negative.',
  hammer_curl: 'Neutral grip, no swing — control both directions. Hits the forearm too.',
  wrist_curl: 'Slow, full range off the bench, squeeze the forearm at the top.',
  back_ext: 'Hinge from the hips, squeeze glutes and lower back at the top — don\'t overextend.',
  squat: 'Brace hard, sit between the hips, drive the floor away, full depth.',
  rdl: 'Soft knees, push the hips back, feel the hamstring stretch, drive the hips through.',
  hip_thrust: 'Chin tucked, drive through the heels, squeeze the glutes hard at the top.',
  leg_press: 'Controlled depth, push through mid-foot, no lockout slam.',
  leg_curl: 'Squeeze the hamstrings, slow the negative, full range.',
  leg_ext: 'Pause and squeeze the quads at the top, control it down.',
  cable_kickback: 'Squeeze the glute at the top, no lower-back arch, slow return.',
  calf_raise: 'Full stretch at the bottom, big squeeze at the top, pause both ends.',
  tib_raise: 'Pull the toes up hard, control down — protects your knees and shins.',
}
export function cueFor(exId) { return CUES[exId] || 'Controlled tempo, full range, squeeze at the top.' }

// ---- progress: recent completed sessions, for the "you're getting stronger" view --
export function recentSessions(state, limit = 6) {
  const days = state.days || {}
  const out = []
  for (const date of Object.keys(days).sort().reverse()) {
    const s = days[date].workout?.session
    if (!s || s.status !== 'done') continue
    let sets = 0, volume = 0, beaten = 0
    for (const e of s.exercises || []) {
      for (const st of e.sets || []) if (st.reps) { sets++; volume += (st.weight || 0) * st.reps }
      if (e.target && !e.target.first && e.sets?.some((st) => st.done && st.reps && st.reps >= e.target.reps && (st.weight || 0) >= (e.target.weight || 0))) beaten++
    }
    out.push({ date, label: s.label || s.dayType, sets, volume: Math.round(volume), beaten, minutes: s.completedTs && s.startedTs ? Math.round((s.completedTs - s.startedTs) / 60000) : null })
    if (out.length >= limit) break
  }
  return out
}

// Rough wall-clock for a built session, in minutes: warm-up + working sets
// (compounds cost more per set for the heavier rest) + cooldown stretches.
// This is what makes a leg day "know" it needs ~an hour and a push day less.
export function estimateSessionMinutes(session) {
  const WARMUP = 8
  let work = 0
  for (const e of session.exercises || []) {
    const perSet = e.role === 'compound' ? 3 : 2
    work += (e.sets?.length || 0) * perSet
  }
  const cooldown = (session.cooldown?.length || 0) * 2
  return Math.round(WARMUP + work + cooldown)
}

// ---- the evening triage: walk or lift? --------------------------------------

// How many days THIS week already cleared the step target — a consistency read.
function stepDaysThisWeek(state, todayIso, stepTarget) {
  const days = state.days || {}
  const wk = weekKey(todayIso)
  let n = 0
  for (const date of Object.keys(days)) {
    if (date > todayIso || weekKey(date) !== wk) continue
    if ((days[date].steps || 0) >= stepTarget) n++
  }
  return n
}

// Today's diet adherence from logged meals. 'on'/'off' = on-plan/off-plan;
// null = unlogged. offPlan => the deficit needs the walk more tonight.
function dietToday(day) {
  const m = day.meals || {}
  const vals = ['breakfast', 'lunch', 'dinner'].map((k) => m[k])
  const off = vals.filter((v) => v === 'off').length
  const on = vals.filter((v) => v === 'on').length
  return { dinnerLogged: m.dinner != null, off, on, offPlan: off > 0 && off >= on, onPlan: on > 0 && off === 0 }
}

// Protein advisory vs the daily target — null if unlogged, so we never nag blind.
function proteinNote(state, day) {
  const target = state.profile?.proteinTarget || 150
  const p = day.nutrition?.protein
  if (p == null) return null
  return p >= target ? `Protein's in (${p}g) — recovery's covered.`
    : `Protein's at ${p}g of ${target}g — close that tonight so the work recovers.`
}

// Answer the recurring question: it's evening, steps are short — do I walk to
// close them, or skip them and lift? Decided from the WHOLE week, not just today.
// Returns { focus:'train'|'walk'|'both'|'done', headline, support }.
//   - Lifts are recovery-gated and time-sensitive: a session skipped tonight is
//     gone. Steps are fungible: a low day is recoverable tomorrow. So on a
//     training day the lift wins; steps are the move only on rest days or once
//     the weekly lift target is already banked.
export function decideEveningPriority(state, todayIso, hour, minute = 0) {
  const profile = state.profile || {}
  const stepTarget = profile.stepTarget || 10000
  const liftTarget = profile.gymTargetPerWeek || 3
  const day = state.days?.[todayIso] || {}
  const steps = day.steps || 0
  const stepsShort = steps < stepTarget
  const gap = Math.max(0, stepTarget - steps)
  const trainedToday = day.workout?.session?.status === 'done'

  const dec = decideDayType(state, todayIso)
  const dayLabel = DAY_PLAN[dec.dayType]?.label || dec.dayType
  const hist = liftingHistory(state, todayIso)
  const weekLifts = sessionsThisWeek(hist, todayIso)
  const stepDays = stepDaysThisWeek(state, todayIso, stepTarget)
  const late = hour >= 20
  const stepsLine = `${steps.toLocaleString()} of ${stepTarget.toLocaleString()} steps`

  // Meal signals: protein for recovery (advisory) + adherence (tilts the call).
  const diet = dietToday(day)
  const protein = proteinNote(state, day)
  const offPlanWalk = diet.offPlan ? ` And you ate off-plan today, so don't skip the walk — it's protecting your deficit.` : ''

  // Already lifted today — the session's banked; steps are all that's left.
  if (trainedToday) {
    if (!stepsShort) return { focus: 'done', headline: 'Trained and stepped. Done.', support: 'Session in, steps in. Close the day out — food and sleep do the rest.', advisories: [protein].filter(Boolean) }
    return { focus: 'walk', headline: `Lift's done — walk off the last ${gap.toLocaleString()} steps.`,
      support: `You're at ${stepsLine}. A short walk now tops it off and doubles as recovery from the session.${offPlanWalk}`, advisories: [protein].filter(Boolean) }
  }

  // Rest day — no lift owed, so the walk is the actual work.
  if (dec.rest) {
    if (!stepsShort) return { focus: 'done', headline: 'Rest day, handled.', support: 'No session owed and your steps are in. Let the week of training land.', advisories: [protein].filter(Boolean) }
    return { focus: 'walk', headline: `Off day — the walk is tonight's work.`,
      support: `No lift today; you've trained ${weekLifts}× this week. So tonight the job is steps: you're at ${stepsLine}. Get the walk in — it's how the deficit holds on rest days.${offPlanWalk}`, advisories: [protein].filter(Boolean) }
  }

  // Training day, not yet trained — but does TODAY's session actually fit the
  // remaining gym window? A leg day needs ~an hour; a 30-min window can't hold it.
  const gym = gymStatus(todayIso, hour, minute)
  const session = buildSession(state, todayIso)
  const estMin = estimateSessionMinutes(session)
  const fits = gym.open && gym.minsToClose >= estMin
  const closeSoon = fits && gym.minsToClose < estMin + SESSION_BUFFER_MIN
  const hurry = closeSoon ? ` Gym closes at ${gym.closeLabel} — move fast and skip the treadmill.` : ''
  const gymWhy = !gym.open
    ? `The gym's shut (closes ${gym.closeLabel}).`
    : `A ${dayLabel.toLowerCase()} day runs about ${estMin} min and the gym closes at ${gym.closeLabel}, ${gym.minsToClose} min out — it won't fit tonight.`

  // Pre-workout fuel: training in the evening on an empty stomach (no dinner
  // logged) earns a light-snack nudge — but only when there's room before close.
  const underFueled = hour >= 16 && !diet.dinnerLogged
  const fuel = underFueled
    ? `You haven't had dinner — if you're running empty, a light snack first will carry the heavy sets${closeSoon ? `, but be quick, the gym closes ${gym.closeLabel}` : ''}.`
    : null
  const trainAdvice = [fuel, protein].filter(Boolean)

  // Steps already done → lift if it fits, otherwise call it a night.
  if (!stepsShort) {
    if (fits) return { focus: 'train', headline: `Steps are in. Now the ${dayLabel} session.`,
      support: `${dec.reason} Walk's handled — go train.${hurry}`, advisories: trainAdvice }
    return { focus: 'done', headline: `Steps in — ${dayLabel} moves to tomorrow.`,
      support: `${gymWhy} Nothing more to chase tonight; we hit ${dayLabel} fresh tomorrow.`, advisories: [protein].filter(Boolean) }
  }

  // Weekly lift target already banked? Then an extra session is optional and the
  // real gap is steps — walk regardless of the gym window.
  if (weekLifts >= liftTarget) {
    return { focus: 'walk', headline: `You've hit ${weekLifts} sessions — tonight, close the steps.`,
      support: `Your ${liftTarget}×/week lifting is already banked, so an extra session can wait. The open gap is movement: ${stepsLine}. Walk it off; lift again tomorrow if you want the bonus.${offPlanWalk}`, advisories: [protein].filter(Boolean) }
  }

  // Behind on lifts, but today's session won't fit the window — the lift's off
  // tonight. Offer the honest fallback: claw back steps with a walk, or rest.
  if (!fits) {
    return { focus: 'walk', headline: `${dayLabel} won't fit the window — walk or rest tonight.`,
      support: `${gymWhy} You can't get the session in, so don't force it: take a walk to claw back some steps (${stepsLine}), or just take the night and rest. Either way, ${dayLabel} is first thing tomorrow.${offPlanWalk}`, advisories: [protein].filter(Boolean) }
  }

  // Behind on lifts AND on steps, and the gym's open. Lift wins — it's the one
  // you can't get back; steps you can recover.
  const consistency = stepDays >= 2
    ? `you've cleared steps ${stepDays} day${stepDays > 1 ? 's' : ''} already this week, so one lighter day won't hurt`
    : `make the steps up tomorrow`
  const stepsTail = consistency.startsWith('you') ? 'lean on the week' : 'catch them tomorrow'
  const noTime = late || closeSoon
  // Adherence tilt: off-plan today means the walk matters more. With time, push
  // both; without time, at least flag tomorrow's steps.
  const offPlanTail = diet.offPlan
    ? (noTime ? ` You ate off-plan today — make tomorrow's steps count.` : ` You ate off-plan today, so don't skip that walk — it's protecting the deficit.`)
    : ''
  const after = closeSoon
    ? `Move fast — the gym closes at ${gym.closeLabel}, so skip the treadmill. Let the steps go and ${stepsTail}.`
    : late
      ? `It's late — get the lift in, let the steps go tonight and ${stepsTail}.`
      : `Lift first, then walk off what steps you can — even ${Math.min(gap, 3000).toLocaleString()} helps.`
  return { focus: noTime ? 'train' : 'both', headline: `Skip the walk for now — train. ${dayLabel} day.`,
    support: `Here's the call: you've lifted ${weekLifts}× of ${liftTarget} this week, and a session you skip tonight is gone — but steps you can recover (${consistency}). So the lift comes first. ${after}${offPlanTail}`,
    advisories: trainAdvice }
}
