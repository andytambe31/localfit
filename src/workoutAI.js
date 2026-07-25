/* ---------- AI-tailored workouts (pure) -------------------------------------
 * Same round-trip pattern as the day-plan and food loggers, aimed at the session
 * itself. `buildWorkoutPrompt` hands an LLM the full training context — the day
 * that's due, this week's intent, recovery, the LAST session of this type (with
 * the actual loads), the weekly per-muscle set audit, best lifts, strength goals,
 * and the exercise library — and asks it to build today's session with the reps
 * and weights pre-populated from past performance and lagging muscles prioritised.
 * `parseWorkoutPlan` reads the JSON back; `buildAiSession` turns it into a session
 * TrainFlow can run, reusing the same warm-up / cooldown / cue scaffolding.
 * -------------------------------------------------------------------------- */
import { EXERCISES, cueFor, buildSession, liftingHistory, decideDayType, bestLifts, weekEffort } from './train'
import { rotationState } from './rotation'
import { muscleAudit } from './muscleAudit'
import { strengthGoalsFor } from './strengthGoals'
import { recoveryState } from './sleep'
import { trainingPhase } from './periodize'
import { sanitizeJson } from './diet'

const DAY_LABEL = { push: 'Push', pull: 'Pull', legs: 'Legs', upper: 'Upper', lower: 'Lower' }

// The most recent COMPLETED session of a given day-type, with each lift's top set.
function lastSessionOfType(state, dateIso, dayType) {
  const days = state.days || {}
  for (const d of Object.keys(days).sort().reverse()) {
    if (d >= dateIso) continue
    const s = days[d]?.workout?.session
    if (!s || s.status !== 'done' || s.dayType !== dayType) continue
    const lifts = (s.exercises || []).map((e) => {
      const sets = (e.sets || []).filter((x) => x.reps > 0)
      if (!sets.length) return null
      const top = sets.reduce((a, b) => ((b.weight || 0) > (a.weight || 0) ? b : a))
      return { name: e.name, sets: sets.length, topWeight: top.weight || 0, topReps: top.reps || 0 }
    }).filter(Boolean)
    return { date: d, lifts }
  }
  return null
}

// The exercise library the LLM chooses from — ids are the contract, so the app can
// render cues + track progression. Grouped by the day it belongs to.
function libraryFor(dayType) {
  const rows = []
  for (const [id, m] of Object.entries(EXERCISES)) {
    // Offer the day's own pool + core; skip unrelated day-types to keep it tight.
    if (m.day !== dayType && m.day !== 'core') continue
    rows.push(`  ${id} — ${m.name} (${m.muscle}, ${m.role}, ${m.repLow}-${m.repHigh} reps${m.db ? ', dumbbell/hand' : ''}${m.bodyweight ? ', bodyweight' : ''})`)
  }
  return rows.join('\n')
}

// Build the tailoring prompt for the session that's due (or an explicit dayType).
export function buildWorkoutPrompt(state, today, dayType) {
  const dt = dayType || decideDayType(state, today).dayType
  if (!DAY_LABEL[dt]) return null // rest day — nothing to tailor
  const label = DAY_LABEL[dt]
  const phase = trainingPhase(state, today)
  const effort = weekEffort(phase)
  const rec = recoveryState(state, today, state.profile)
  const last = lastSessionOfType(state, today, dt)
  const audit = muscleAudit(state, today, 7)
  const rot = rotationState(liftingHistory(state, today), today, { targetPerWeek: state.profile?.gymTargetPerWeek || 3 })
  const lifts = bestLifts(state).filter((l) => l.best).map((l) => `  ${l.name}: best ${l.best.weight}×${l.best.reps} (est 1RM ${Math.round(l.best.e1rm)} lb), ${l.sessions} sessions`)
  const goals = strengthGoalsFor(state, today).filter((g) => !g.achieved).map((g) => `  ${g.name}: ${g.current} → ${g.target} ${g.unit}`)

  const lastBlock = last
    ? `LAST ${label.toUpperCase()} SESSION (${last.date}):\n` + last.lifts.map((l) => `  ${l.name}: ${l.sets} sets, top set ${l.topReps} reps${l.topWeight ? ` at ${l.topWeight} lb` : ''}`).join('\n')
    : `LAST ${label.toUpperCase()} SESSION: none on record — this is a baseline session.`
  const auditBlock = audit.hasData
    ? 'WEEKLY EFFECTIVE SETS BY MUSCLE (last 7 days):\n' + audit.rows.map((r) => `  ${r.label}: ${r.sets} (target ${r.low}-${r.high}) — ${r.status}`).join('\n') + (audit.under.length ? `\nUNDER-TRAINED: ${audit.under.map((r) => r.label).join(', ')}` : '')
    : 'WEEKLY EFFECTIVE SETS: not enough logged sessions yet.'

  return `You are my elite, evidence-based strength & hypertrophy coach. Build me TODAY's ${label} session, tailored to my history and what's lagging. Everything you need is below.

First, tell me in a sentence or two how you're tailoring today (what you're prioritising and why). Then output ONLY this JSON — no code fences, nothing after it:
{"dayType":"${dt}","focus":"","exercises":[{"id":"","sets":0,"targetWeight":0,"targetReps":0,"note":""}]}
RULES:
- id: MUST be an id from the EXERCISE LIBRARY below (use the exact id so my app renders cues and tracks progression). If you truly need something not listed, use a short lowercase id and also add "name" and "muscle" fields for it.
- sets: number of working sets (2-5). targetWeight: pounds — for dumbbell lifts use ONE dumbbell's weight; use 0 for bodyweight. targetReps: the rep target for the working sets.
- note: one short coaching line — why this lift today, and the progression from last time (e.g. "Beat last week's 3×8×145: go 8×150").
- focus: one sentence naming today's theme and what you prioritised.
- 5 to 8 exercises, ordered exactly as I should perform them (compounds / priorities first).
- PRIORITISE lagging muscles and under-trained movement patterns (see the audit). Base weights/reps on my last performance — progress a rep or a small load when I hit the top of a range; hold or reduce if recovery is strained.

THIS SESSION: ${label} (${dt})
THIS WEEK'S INTENT: ${effort.short} — ${effort.line}
RECOVERY: ${rec.level === 'reduce' ? `strained (${rec.poorNights} poor nights recently) — ease off, hold loads, trim a little volume` : 'normal — progress as earned'}
ROTATION: ${rot.imbalanced ? `split is uneven — ${rot.underTrained.map((t) => DAY_LABEL[t]).join('/')} behind` : 'balanced'}

${lastBlock}

${auditBlock}

MY BEST LIFTS:
${lifts.length ? lifts.join('\n') : '  none logged yet'}

STRENGTH GOALS:
${goals.length ? goals.join('\n') : '  none set'}

EXERCISE LIBRARY (choose ids from here):
${libraryFor(dt)}`
}

// Parse the LLM's session JSON into a plan { dayType, focus, exercises[] }.
export function parseWorkoutPlan(text) {
  if (!text || !text.trim()) return { ok: false, error: 'Paste the AI\'s reply first.' }
  const raw = sanitizeJson(text.trim())
  let parsed = null
  try { parsed = JSON.parse(raw) } catch { const m = raw.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]) } catch { /* bad */ } } }
  if (parsed == null || typeof parsed !== 'object') return { ok: false, error: "That doesn't look like valid JSON — copy the AI's full reply." }
  const arr = Array.isArray(parsed.exercises) ? parsed.exercises : (Array.isArray(parsed) ? parsed : null)
  if (!arr) return { ok: false, error: 'No "exercises" list found in that reply.' }
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null }
  const exercises = arr.map((e) => {
    if (!e || typeof e !== 'object') return null
    const id = String(e.id || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_')
    const name = String(e.name || '').trim()
    if (!id && !name) return null
    return {
      id: id || name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      name: name || null, muscle: String(e.muscle || '').trim() || null,
      sets: Math.max(1, Math.min(6, Math.round(num(e.sets) || 3))),
      targetWeight: num(e.targetWeight ?? e.weight),
      targetReps: num(e.targetReps ?? e.reps) || null,
      note: String(e.note || '').trim(),
    }
  }).filter(Boolean)
  if (!exercises.length) return { ok: false, error: 'Couldn\'t read any exercises from that reply.' }
  const dayType = ['push', 'pull', 'legs', 'upper', 'lower'].includes(parsed.dayType) ? parsed.dayType : null
  return { ok: true, plan: { dayType, focus: String(parsed.focus || '').trim(), exercises } }
}

// Turn a parsed plan into a runnable session: reuse buildSession's warm-up /
// cooldown / phase / effort scaffolding, but swap in the AI's exercise selection
// with pre-filled targets. Known ids get their real metadata + cues; unknown ids
// become custom entries so nothing is lost.
export function buildAiSession(state, dateIso, plan) {
  const dt = plan.dayType || decideDayType(state, dateIso).dayType || 'push'
  const base = buildSession(state, dateIso, { dayType: dt, force: true })
  const exercises = plan.exercises.map((e) => {
    const meta = EXERCISES[e.id]
    const reps = e.targetReps ?? (meta ? meta.repLow : 8)
    const w = e.targetWeight
    const sets = Array.from({ length: e.sets }, () => ({ weight: w ?? null, reps: null, done: false }))
    const target = { weight: w ?? null, reps, sets: e.sets, note: e.note || '', ai: true }
    if (meta) {
      return { id: e.id, name: meta.name, muscle: meta.muscle, role: meta.role, db: !!meta.db, bodyweight: !!meta.bodyweight,
        repLow: meta.repLow, repHigh: meta.repHigh, inc: meta.inc, emphasized: false, cue: cueFor(e.id), rir: null, target, sets, ai: true }
    }
    return { id: e.id, name: e.name || e.id, muscle: e.muscle || '', role: 'isolation', db: false, bodyweight: false,
      repLow: reps, repHigh: reps + 4, inc: 5, emphasized: false, cue: 'Controlled tempo, full range, squeeze at the top.', rir: null, target, sets, ai: true, custom: true }
  })
  return {
    ...base,
    exercises,
    aiTailored: true,
    aiFocus: plan.focus || null,
    label: base.label,
    reason: plan.focus ? `AI-tailored — ${plan.focus}` : base.reason,
    emphasisReason: null,
  }
}
