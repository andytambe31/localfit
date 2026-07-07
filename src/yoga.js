/* ---------- yoga / mobility engine (pure) -----------------------------------
 * Yoga is the recovery pillar: mobility for the tight chains lifting builds
 * (hips, hamstrings, thoracic spine, shoulders, ankles), plus breath work for
 * sleep and stress. Scored by weekly CADENCE (2–3×/week), not daily adherence,
 * so it can actually reach 10; stays null until the first session so adding the
 * pillar never retroactively dents the on-track average.
 *
 * Safety rule baked into the data: `preLiftSafe` is false for long static holds
 * (pigeon, deep folds) — prolonged static stretching before heavy lifting saps
 * strength, so those belong on rest days or after training. Voice: directive,
 * no emojis. Sourced from ACE, BarBend, Yoga Journal, and sports-science on
 * acute static-stretching effects.
 * -------------------------------------------------------------------------- */

const shiftIso = (iso, delta) => {
  const [y, m, d] = iso.split('-').map(Number)
  const nd = new Date(new Date(y, m - 1, d).getTime() + delta * 86400000)
  const p = (n) => String(n).padStart(2, '0')
  return `${nd.getFullYear()}-${p(nd.getMonth() + 1)}-${p(nd.getDate())}`
}

// The pose library. holdSec = seconds to hold the shape (the flow shows a
// countdown). side:true = repeat both sides. phase groups a session.
export const POSES = {
  cat_cow:      { id: 'cat_cow',      name: 'Cat–Cow',                 targets: ['spine', 'thoracic'],            phase: 'warmup', holdSec: 45,  side: false, preLiftSafe: true,  cue: 'On all-fours: inhale, drop the belly and lift the chest; exhale, round the spine. Move with the breath.' },
  down_dog:     { id: 'down_dog',     name: 'Downward Dog',            targets: ['hamstrings', 'calves', 'shoulders'], phase: 'flow', holdSec: 40, side: false, preLiftSafe: true, cue: 'Hips high, heels reaching toward the floor, fingers spread, spine long. Bend the knees if your back rounds.' },
  low_lunge:    { id: 'low_lunge',    name: 'Low Lunge',               targets: ['hips', 'hip flexors', 'quads'], phase: 'flow',   holdSec: 40,  side: true,  preLiftSafe: true,  cue: 'Back knee down, sink the hips forward, tall chest. Feel the front of the back hip open.' },
  warrior2:     { id: 'warrior2',     name: 'Warrior II',              targets: ['hips', 'adductors', 'shoulders'], phase: 'flow', holdSec: 30,  side: true,  preLiftSafe: true,  cue: 'Front knee stacked over the ankle, arms level, gaze over the front hand. Strong and steady.' },
  triangle:     { id: 'triangle',     name: 'Triangle',                targets: ['hamstrings', 'hips', 'spine'],  phase: 'flow',   holdSec: 30,  side: true,  preLiftSafe: true,  cue: 'Long side body, hinge over the front leg, open the chest toward the ceiling.' },
  cobra:        { id: 'cobra',        name: 'Cobra / Sphinx',          targets: ['thoracic', 'chest', 'hip flexors'], phase: 'flow', holdSec: 30, side: false, preLiftSafe: true, cue: 'Lift the chest, shoulders back and down, soft elbows. This counters the lifting hunch.' },
  thread_needle:{ id: 'thread_needle',name: 'Thread-the-Needle',       targets: ['thoracic', 'shoulders'],        phase: 'flow',   holdSec: 30,  side: true,  preLiftSafe: true,  cue: 'From all-fours, thread one arm under the other, shoulder and temple to the mat. Rotate from the mid-back.' },
  bridge:       { id: 'bridge',       name: 'Bridge',                  targets: ['hip flexors', 'glutes', 'chest'], phase: 'flow', holdSec: 30,  side: false, preLiftSafe: true,  cue: 'Feet flat, drive the hips up, roll the shoulders under. Squeeze the glutes, open the front of the hips.' },
  malasana:     { id: 'malasana',     name: 'Deep Squat (Malasana)',   targets: ['ankles', 'hips', 'adductors'],  phase: 'deep',   holdSec: 60,  side: false, preLiftSafe: true,  cue: 'Feet ~shoulder width, sink low, elbows press the knees open, chest tall. Heels on a rolled towel if they lift.' },
  pigeon:       { id: 'pigeon',       name: 'Pigeon',                  targets: ['glutes', 'hips'],               phase: 'deep',   holdSec: 90,  side: true,  preLiftSafe: false, cue: 'Front shin angled forward, hips square, fold over the front leg. Breathe into the glute and let it soften.' },
  lizard:       { id: 'lizard',       name: 'Lizard Lunge',            targets: ['hips', 'groin', 'adductors'],   phase: 'deep',   holdSec: 60,  side: true,  preLiftSafe: false, cue: 'Both hands inside the front foot, hips low; lower to forearms (or blocks) if you can. Deep hip opener.' },
  forward_fold: { id: 'forward_fold', name: 'Seated Forward Fold',     targets: ['hamstrings', 'low back'],       phase: 'deep',   holdSec: 60,  side: false, preLiftSafe: false, cue: 'Hinge from the hips, keep the spine long, knees soft. Reach for the shins or feet — no rounding through the back.' },
  happy_baby:   { id: 'happy_baby',   name: 'Happy Baby',              targets: ['hips', 'groin', 'low back'],    phase: 'deep',   holdSec: 45,  side: false, preLiftSafe: true,  cue: 'On your back, grab the feet, draw the knees toward the armpits, gently rock side to side.' },
  seated_twist: { id: 'seated_twist', name: 'Seated Twist',            targets: ['spine', 'glutes'],              phase: 'deep',   holdSec: 30,  side: true,  preLiftSafe: true,  cue: 'Sit tall, rotate from the mid-back, gentle lever with the elbow. Lengthen up on each inhale.' },
  childs_pose:  { id: 'childs_pose',  name: "Child's Pose",            targets: ['lats', 'shoulders', 'recovery'],phase: 'relax',  holdSec: 45,  side: false, preLiftSafe: true,  cue: 'Hips to heels, arms forward, forehead down. Breathe into the back of the ribs and let go.' },
  legs_up_wall: { id: 'legs_up_wall', name: 'Legs-up-the-Wall',        targets: ['recovery'],                     phase: 'relax',  holdSec: 120, side: false, preLiftSafe: true,  cue: 'Hips near the wall, legs vertical, arms open. Nothing to do here — just breathe and recover.' },
}

// Breath blocks bookend a session — down-regulate the nervous system (better
// sleep, lower stress). kind:'breath' so the flow labels them differently.
export const BREATH = {
  ujjayi: { id: 'ujjayi', name: 'Ujjayi breathing', kind: 'breath', targets: ['recovery'], phase: 'warmup', holdSec: 60, side: false, preLiftSafe: true, cue: 'Breathe in and out through the nose with a soft ocean sound in the throat. Let it set the pace for the whole practice.' },
  box:    { id: 'box',    name: 'Box breathing',    kind: 'breath', targets: ['recovery'], phase: 'relax',  holdSec: 60, side: false, preLiftSafe: true, cue: 'Inhale 4, hold 4, exhale 4, hold 4. Down-shift before you close — carry this to bed tonight.' },
}

const step = (k) => POSES[k] || BREATH[k]

// Two starter sequences from the research: a short dynamic flow safe any day,
// and a longer rest-day session that adds the deep, held hip/hamstring work.
export const SESSIONS = {
  mobility10: {
    id: 'mobility10', label: '10-min mobility', minutes: 10, allDay: true,
    blurb: 'A short dynamic flow. Loosen up in the morning or after a lift — nothing held long, safe before or after training.',
    steps: ['cat_cow', 'down_dog', 'low_lunge', 'malasana', 'thread_needle', 'bridge', 'childs_pose'],
  },
  full30: {
    id: 'full30', label: '25-min full session', minutes: 26, allDay: false,
    blurb: 'Warm up, flow, then deep rest-day release for the hips, hamstrings and spine that lifting tightens. Best on a rest day.',
    steps: ['ujjayi', 'cat_cow', 'down_dog', 'low_lunge', 'warrior2', 'triangle', 'cobra', 'thread_needle', 'pigeon', 'lizard', 'forward_fold', 'happy_baby', 'malasana', 'legs_up_wall', 'box'],
  },
}

// Ordered pose/breath objects for a session id.
export function sessionSteps(id) {
  const s = SESSIONS[id]
  return s ? s.steps.map(step).filter(Boolean) : []
}

// ---- logging + scoring ------------------------------------------------------
export const yogaDone = (d) => !!(d?.yoga?.done || d?.yoga?.session)

export function yogaSessionsInWindow(days, today, n = 7) {
  let c = 0
  for (let i = 0; i < n; i++) if (yogaDone(days[shiftIso(today, -i)])) c++
  return c
}

// /10 by weekly cadence vs target. null until the first session is ever logged.
export function yogaScore(state, today, profile) {
  const days = state?.days || {}
  const target = profile?.yogaTargetPerWeek || 2
  const ever = Object.keys(days).some((iso) => yogaDone(days[iso]))
  if (!ever) return null
  const recent = yogaSessionsInWindow(days, today, 7)
  return Math.max(0, Math.min(10, Math.round((recent / target) * 10)))
}

// Behind on this week's cadence and not done today → worth prompting.
export function yogaDue(state, today) {
  const days = state?.days || {}
  if (yogaDone(days[today])) return false
  const target = state?.profile?.yogaTargetPerWeek || 2
  return yogaSessionsInWindow(days, today, 7) < target
}

// Total sessions ever, for the beginner progression banding.
export function yogaTotal(state) {
  const days = state?.days || {}
  return Object.keys(days).filter((iso) => yogaDone(days[iso])).length
}

// Week-banded coaching note for the flow intro (8–12 week beginner arc).
export function yogaStage(state) {
  const n = yogaTotal(state)
  if (n < 4)  return { week: 'Weeks 1–2', note: 'Learn the shapes and just breathe. Use blocks or a rolled towel freely — form over depth.' }
  if (n < 8)  return { week: 'Weeks 3–4', note: 'Link the poses to your breath and hold a little longer. Ease off the props as your range allows.' }
  if (n < 16) return { week: 'Weeks 5–8', note: 'Add the deep rest-day holds — pigeon and the folds for two to three minutes. Deeper, but never forcing.' }
  return { week: 'Weeks 9+', note: 'Full sessions now — smoother flow, deeper hip and thoracic work. Find the stretch, then back off ten percent.' }
}
