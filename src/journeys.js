/* ---------- journeys engine (pure) ------------------------------------------
 * Three leveled paths that replace the ring grid. A level is earned by BOTH
 * holding the habit AND hitting the result — so a level actually means
 * something. Everything derives from existing logs, so it syncs and works
 * offline. Each journey returns a uniform shape the UI renders:
 *   { key, name, level, maxLevel, focus, pct, nextLine, locked }
 * `locked` = the result is there but the habit isn't held yet (or vice-versa).
 * -------------------------------------------------------------------------- */
import { sleepScore } from './sleep'

const shiftIso = (iso, delta) => {
  const [y, m, d] = iso.split('-').map(Number)
  const nd = new Date(new Date(y, m - 1, d).getTime() + delta * 86400000)
  const p = (n) => String(n).padStart(2, '0')
  return `${nd.getFullYear()}-${p(nd.getMonth() + 1)}-${p(nd.getDate())}`
}
const clampPct = (n) => Math.max(4, Math.min(100, Math.round(n)))

// --- signals -----------------------------------------------------------------
function trainedDaysIn(state, today, n) {
  const D = state?.days || {}
  let c = 0
  for (let i = 0; i < n; i++) {
    const w = D[shiftIso(today, -i)]?.workout
    if (w?.session?.status === 'done' || (w?.did && w.type !== 'Rest')) c++
  }
  return c
}
function skincareAdherence(state, today, n) {
  const D = state?.days || {}
  let done = 0, logged = 0
  for (let i = 0; i < n; i++) {
    const r = D[shiftIso(today, -i)]?.routines
    if (!r) continue
    logged++
    if (r.skincareAM && r.skincarePM) done++
  }
  return logged ? done / logged : 0
}
const latestBF = (state) => { const l = state?.bodyFatLog || []; return l.length ? l[l.length - 1].pct : null }

// --- Lean & Strong: body-fat bracket (result) + weekly lifting (habit) -------
const LEAN_UPPER = [30, 25, 22, 18]   // top of each level's BF band
const LEAN_NEXT = [25, 22, 18, 15]    // beat this to reach the next level
function leanJourney(state, today) {
  const bf = latestBF(state)
  let level = 1
  if (bf != null) level = bf >= 25 ? 1 : bf >= 22 ? 2 : bf >= 18 ? 3 : bf >= 15 ? 4 : 5
  const trained14 = trainedDaysIn(state, today, 14)
  const habitOk = trained14 >= 5
  let pct = 8, nextLine
  if (bf == null) { pct = 6; nextLine = 'Log a body-fat estimate to place your level.' }
  else if (level >= 5) { pct = 100; nextLine = 'Top level — hold it.' }
  else {
    const upper = LEAN_UPPER[level - 1], next = LEAN_NEXT[level - 1]
    pct = clampPct(((upper - bf) / (upper - next)) * 100)
    nextLine = habitOk
      ? `Reach ${next}% body fat to hit Level ${level + 1}.`
      : `Hold 3 lifts a week, then drop to ${next}% for Level ${level + 1}.`
  }
  return {
    key: 'lean', name: 'Lean & Strong', level, maxLevel: 5,
    focus: bf != null ? `${bf}% body fat · ${trained14} lifts in 14d` : `${trained14} lifts in 14d · estimate your body fat`,
    pct, nextLine, locked: bf != null && level < 5 && !habitOk,
  }
}

// --- Clear → Glass Skin: routine adherence now; skin self-check comes later --
const SKIN_LEVELS = ['Calm the breakouts', 'Unclog & steady', 'Treat & even', 'Refine & barrier', 'Glass skin']
function skinJourney(state, today) {
  const adh = skincareAdherence(state, today, 21)
  const level = 1 // everyone begins at "calm the breakouts"; advances as we build it out
  const pct = clampPct(adh * 100)
  const held = adh >= 0.7
  const nextLine = held
    ? 'Routine is holding — next: add BHA for the nose to reach Level 2.'
    : 'Run the AM + PM routine daily; that consistency unlocks Level 2.'
  return {
    key: 'skin', name: 'Clear → Glass Skin', level, maxLevel: 5,
    focus: SKIN_LEVELS[0], pct, nextLine, locked: !held,
  }
}

// --- Sleep & Energy: driven by the sleep score (duration + consistency) ------
const SLEEP_LEVELS = ['Anchor a bedtime', 'Consistent 7 hours', 'Steady & unbroken', 'Fully recovered']
function sleepJourney(state, today, profile) {
  const s = sleepScore(state, today, profile) // 0..10 or null
  let level = 1, pct = 8, nextLine = 'Set and hold a lights-out time to begin.'
  if (s != null) {
    level = s >= 8 ? 4 : s >= 6 ? 3 : s >= 4 ? 2 : 1
    pct = clampPct(s * 10)
    nextLine = level < 4 ? `Sleep score ${s}/10 — steady it up to reach Level ${level + 1}.` : `Sleep score ${s}/10 — dialed in.`
  }
  return {
    key: 'sleep', name: 'Sleep & Energy', level, maxLevel: 4,
    focus: SLEEP_LEVELS[Math.min(level - 1, 3)], pct, nextLine, locked: false,
  }
}

// Order matches the concept: skin, body, sleep.
export function journeysFor(state, today, profile) {
  return [
    skinJourney(state, today),
    leanJourney(state, today),
    sleepJourney(state, today, profile),
  ]
}
