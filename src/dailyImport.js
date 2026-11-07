/* ---------- ChatGPT daily import (pure) -------------------------------------
 * Paste a JSON object describing a day → validate → preview a diff → merge into
 * the existing day record. One importer that maps to the EXISTING models (no second
 * tracking system): cardio, steps, water, weight, sleep, nutrition→diary, skincare/
 * haircare routine completion, supplements, workout-completed, and daily notes.
 *
 * Design rules honored:
 *   - Treat pasted JSON as untrusted: size cap, safe parse, prototype-pollution
 *     guard, strict category/range validation, no code execution.
 *   - Never invent data: estimates are flagged (e.g. caloriesSource), unknowns are
 *     omitted, and a planned (not completed) activity is NEVER marked done.
 *   - Smart merge: partial-day updates, preserve unrelated entries, dedupe so
 *     repeated imports are idempotent, surface conflicts instead of overwriting.
 *   - Unsupported categories are reported, not silently dropped.
 *
 * Pure: functions of state + payload. No React, no I/O. Reuses diet.sanitizeJson.
 * -------------------------------------------------------------------------- */

import { sanitizeJson } from './diet'

export const IMPORT_SCHEMA_VERSION = '1.0'
export const MAX_IMPORT_BYTES = 50 * 1024 // 50 KB cap on pasted payloads

// Supported categories (drives the generated prompt + the preview). Each maps to an
// existing day/profile field — nothing here invents a new store.
export const IMPORT_CATEGORIES = [
  { key: 'cardio', label: 'Cardio', model: 'day.cardio',
    note: 'array or object: type, durationMin, intensity 0–10, calories, caloriesSource (machine_estimate|measured|estimate), heartRate, completed' },
  { key: 'steps', label: 'Steps', model: 'day.steps', note: 'object: count, completed' },
  { key: 'water', label: 'Water', model: 'day.water', note: 'object: glasses (250 ml each) OR liters OR ml' },
  { key: 'weight', label: 'Body weight', model: 'weightLog', note: 'object: kg OR lb, source (measured|estimate)' },
  { key: 'sleep', label: 'Sleep', model: 'day.sleep', note: 'object: hours OR minutes, quality 1–10 (optional)' },
  { key: 'nutrition', label: 'Meals', model: 'day.food', note: 'array: name, meal (breakfast|lunch|snack|dinner), kcal, protein, carbs, fat, fiber, estimated' },
  { key: 'skincare', label: 'Skincare', model: 'day.routines', note: 'object: am true/false, pm true/false (completed)' },
  { key: 'haircare', label: 'Haircare', model: 'day.routines', note: 'object: am true/false, pm true/false (completed)' },
  { key: 'supplements', label: 'Supplements', model: 'day.supps', note: 'object: am true/false, pm true/false (taken)' },
  { key: 'workout', label: 'Strength workout', model: 'day.workout', note: 'object: completed true/false, type (e.g. "Upper Body A")' },
  { key: 'notes', label: 'Notes', model: 'day.notes', note: 'array of short strings (irritation, mood, context…)' },
]
const SUPPORTED_KEYS = new Set(IMPORT_CATEGORIES.map((c) => c.key))
// Non-category top-level keys that are allowed (metadata).
const META_KEYS = new Set(['schemaVersion', 'date', 'timezone', 'source', 'activities', 'bodyMetrics', 'routines'])

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const clampWarn = (v, lo, hi) => (isNum(v) && (v < lo || v > hi))

// Recursively strip prototype-pollution keys from a parsed object.
function stripDangerous(v) {
  if (Array.isArray(v)) return v.map(stripDangerous)
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
      out[k] = stripDangerous(v[k])
    }
    return out
  }
  return v
}

// Parse + validate a pasted payload. Returns { ok, payload, errors[] }.
export function parseImport(text, todayIso) {
  const errors = []
  if (typeof text !== 'string' || !text.trim()) return { ok: false, payload: null, errors: ['Paste a JSON object first.'] }
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, payload: null, errors: [`Payload too large (max ${Math.round(MAX_IMPORT_BYTES / 1024)} KB).`] }
  let raw
  try { raw = JSON.parse(sanitizeJson(text)) } catch (e) { return { ok: false, payload: null, errors: ['Not valid JSON — check for a missing comma or bracket.'] } }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, payload: null, errors: ['Top level must be a JSON object.'] }
  const payload = stripDangerous(raw)

  // schema version
  const ver = String(payload.schemaVersion || '1.0')
  if (ver.split('.')[0] !== IMPORT_SCHEMA_VERSION.split('.')[0]) errors.push(`Unsupported schemaVersion "${ver}" (expected ${IMPORT_SCHEMA_VERSION}).`)
  // date
  if (payload.date != null && !(typeof payload.date === 'string' && ISO_RE.test(payload.date) && !Number.isNaN(Date.parse(payload.date + 'T00:00:00')))) {
    errors.push(`Invalid date "${payload.date}" — use YYYY-MM-DD.`)
  }
  if (!payload.date) payload.date = todayIso
  if (errors.length) return { ok: false, payload, errors }
  return { ok: true, payload, errors: [] }
}

// Coerce water into glasses (250 ml each).
function toGlasses(w) {
  if (isNum(w?.glasses)) return Math.round(w.glasses)
  if (isNum(w?.liters)) return Math.round((w.liters * 1000) / 250)
  if (isNum(w?.ml)) return Math.round(w.ml / 250)
  return null
}
function toKg(w) {
  if (isNum(w?.kg)) return Math.round(w.kg * 10) / 10
  if (isNum(w?.lb)) return Math.round(w.lb * 0.45359 * 10) / 10
  return null
}
function sleepMinutes(s) {
  if (isNum(s?.minutes)) return Math.round(s.minutes)
  if (isNum(s?.hours)) return Math.round(s.hours * 60)
  return null
}
const MEALS = new Set(['breakfast', 'lunch', 'snack', 'dinner'])

// Build the ordered list of import operations for a payload against current state.
// Each op: { category, action, label, detail, estimated?, warn?, value } where
// action ∈ create|update|skip|planned|error. `value` carries what applyImport needs.
export function planImport(state, payload) {
  const date = payload.date
  const day = state?.days?.[date] || {}
  const ops = []
  const unsupported = []

  // report unknown top-level keys
  for (const k of Object.keys(payload)) {
    if (SUPPORTED_KEYS.has(k) || META_KEYS.has(k)) continue
    unsupported.push(k)
  }

  // ---- cardio ----
  if (payload.cardio != null) {
    const items = Array.isArray(payload.cardio) ? payload.cardio : [payload.cardio]
    items.forEach((c, i) => {
      if (c == null || typeof c !== 'object') { ops.push({ category: 'cardio', action: 'error', label: 'Cardio', detail: 'not an object' }); return }
      if (c.completed === false || c.planned === true) { ops.push({ category: 'cardio', action: 'planned', label: 'Cardio (planned)', detail: `${c.type || 'cardio'} — planned, not logged` }); return }
      const minutes = isNum(c.durationMin) ? Math.round(c.durationMin) : (isNum(c.minutes) ? Math.round(c.minutes) : null)
      if (minutes != null && clampWarn(minutes, 0, 600)) { ops.push({ category: 'cardio', action: 'error', label: 'Cardio', detail: `duration ${minutes} out of range` }); return }
      const type = typeof c.type === 'string' ? c.type.slice(0, 40) : 'cardio'
      const est = c.caloriesSource && c.caloriesSource !== 'measured'
      const existing = day.cardio
      const dup = existing && existing.type === type && Number(existing.minutes) === minutes
      const value = { type, minutes, avgHr: isNum(c.heartRate) ? Math.round(c.heartRate) : null, rpe: isNum(c.intensity) ? c.intensity : null,
        calories: isNum(c.calories) ? Math.round(c.calories) : null, caloriesSource: c.caloriesSource || null, done: true, ts: Date.now() }
      ops.push({ category: 'cardio', action: dup ? 'skip' : (existing ? 'update' : 'create'),
        label: `Cardio · ${type}`, estimated: !!est,
        detail: `${minutes != null ? `${minutes} min` : 'duration unknown'}${value.rpe != null ? ` · intensity ${value.rpe}/10` : ''}${value.calories != null ? ` · ${value.calories} cal${est ? ' (est)' : ''}` : ''}${value.avgHr ? ` · ${value.avgHr} bpm` : ''}`,
        value })
    })
  }

  // ---- steps ----
  if (payload.steps != null) {
    const s = payload.steps
    const count = isNum(s) ? Math.round(s) : (isNum(s?.count) ? Math.round(s.count) : null)
    if (s?.completed === false || s?.planned === true) ops.push({ category: 'steps', action: 'planned', label: 'Steps (planned)', detail: 'planned, not logged' })
    else if (count != null && clampWarn(count, 0, 100000)) ops.push({ category: 'steps', action: 'error', label: 'Steps', detail: `count ${count} out of range` })
    else {
      const dup = (day.steps === count && count != null) || (count == null && day.stepsDone)
      ops.push({ category: 'steps', action: dup ? 'skip' : (day.stepsDone || day.steps ? 'update' : 'create'),
        label: 'Steps', detail: count != null ? `${count.toLocaleString()} steps` : 'marked done', value: { count } })
    }
  }

  // ---- water ----
  if (payload.water != null) {
    const g = toGlasses(payload.water)
    if (g == null) ops.push({ category: 'water', action: 'error', label: 'Water', detail: 'no glasses/liters/ml' })
    else if (clampWarn(g, 0, 40)) ops.push({ category: 'water', action: 'error', label: 'Water', detail: `${g} glasses out of range` })
    else ops.push({ category: 'water', action: day.water === g ? 'skip' : (day.water ? 'update' : 'create'), label: 'Water', detail: `${g} glass${g === 1 ? '' : 'es'}`, value: { glasses: g } })
  }

  // ---- weight ----
  if (payload.weight != null) {
    const kg = toKg(payload.weight)
    if (kg == null) ops.push({ category: 'weight', action: 'error', label: 'Body weight', detail: 'no kg/lb' })
    else if (clampWarn(kg, 30, 300)) ops.push({ category: 'weight', action: 'error', label: 'Body weight', detail: `${kg} kg out of range` })
    else {
      const ex = (state.weightLog || []).find((w) => w.date === date)
      ops.push({ category: 'weight', action: ex && ex.kg === kg ? 'skip' : (ex ? 'update' : 'create'),
        label: 'Body weight', estimated: payload.weight.source === 'estimate', detail: `${kg} kg`, value: { kg } })
    }
  }

  // ---- sleep ----
  if (payload.sleep != null) {
    const mins = sleepMinutes(payload.sleep)
    if (mins == null) ops.push({ category: 'sleep', action: 'error', label: 'Sleep', detail: 'no hours/minutes' })
    else if (clampWarn(mins, 0, 960)) ops.push({ category: 'sleep', action: 'error', label: 'Sleep', detail: `${mins} min out of range` })
    else {
      const dup = day.sleep?.minutes === mins && day.sleep?.source === 'import'
      const h = Math.floor(mins / 60), m = mins % 60
      ops.push({ category: 'sleep', action: dup ? 'skip' : (day.sleep ? 'update' : 'create'), label: 'Sleep',
        detail: `${h}h ${m}m${isNum(payload.sleep.quality) ? ` · quality ${payload.sleep.quality}/10` : ''}`,
        value: { minutes: mins, quality: isNum(payload.sleep.quality) ? payload.sleep.quality : null } })
    }
  }

  // ---- nutrition → diary ----
  if (payload.nutrition != null) {
    const items = Array.isArray(payload.nutrition) ? payload.nutrition : [payload.nutrition]
    const existing = day.food || []
    items.forEach((f) => {
      if (f == null || typeof f !== 'object' || !f.name) { ops.push({ category: 'nutrition', action: 'error', label: 'Meal', detail: 'missing name' }); return }
      const meal = MEALS.has(f.meal) ? f.meal : 'snack'
      const kcal = isNum(f.kcal) ? Math.round(f.kcal) : 0
      if (clampWarn(kcal, 0, 10000)) { ops.push({ category: 'nutrition', action: 'error', label: `Meal · ${f.name}`, detail: `kcal ${kcal} out of range` }); return }
      const name = String(f.name).slice(0, 80)
      const dup = existing.some((e) => e.name === name && (e.meal || 'snack') === meal && Math.round(e.kcal || 0) === kcal)
      const est = f.estimated !== false
      ops.push({ category: 'nutrition', action: dup ? 'skip' : 'create', label: `Meal · ${name}`, estimated: est,
        detail: `${meal} · ${kcal} cal${isNum(f.protein) ? ` · ${Math.round(f.protein)}g P` : ''}${est ? ' · est' : ''}`,
        value: { id: `imp_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24)}_${kcal}`, name, meal, kcal,
          protein: isNum(f.protein) ? f.protein : 0, carbs: isNum(f.carbs) ? f.carbs : 0, fat: isNum(f.fat) ? f.fat : 0,
          fiber: isNum(f.fiber) ? f.fiber : 0, sugar: isNum(f.sugar) ? f.sugar : 0, provisional: est, fromImport: true } })
    })
  }

  // ---- routines (skincare / haircare) ----
  for (const [cat, keyAM, keyPM] of [['skincare', 'skincareAM', 'skincarePM'], ['haircare', 'haircareAM', 'haircarePM']]) {
    if (payload[cat] == null) continue
    const r = payload[cat]
    for (const [slot, rkey] of [['am', keyAM], ['pm', keyPM]]) {
      if (r[slot] == null) continue
      if (r[slot] === false) { ops.push({ category: cat, action: 'planned', label: `${cap(cat)} ${slot.toUpperCase()}`, detail: 'not completed — left as is' }); continue }
      const done = !!day.routines?.[rkey]
      ops.push({ category: cat, action: done ? 'skip' : 'create', label: `${cap(cat)} ${slot.toUpperCase()}`, detail: 'completed', value: { rkey } })
    }
  }

  // ---- supplements ----
  if (payload.supplements != null) {
    const sp = payload.supplements
    for (const slot of ['am', 'pm']) {
      if (sp[slot] == null) continue
      if (sp[slot] === false) { ops.push({ category: 'supplements', action: 'planned', label: `Supplements ${slot.toUpperCase()}`, detail: 'not taken — left as is' }); continue }
      const taken = day.supps?.[slot]?.taken
      ops.push({ category: 'supplements', action: taken ? 'skip' : 'create', label: `Supplements ${slot.toUpperCase()}`, detail: 'taken', value: { slot } })
    }
  }

  // ---- workout (strength) ----
  if (payload.workout != null) {
    const w = payload.workout
    if (w.completed === false || w.planned === true) ops.push({ category: 'workout', action: 'planned', label: 'Strength workout (planned)', detail: `${w.type || 'session'} — planned, not logged` })
    else if (day.workout?.did) ops.push({ category: 'workout', action: 'skip', label: 'Strength workout', detail: 'already logged' })
    else ops.push({ category: 'workout', action: 'create', label: 'Strength workout', detail: `${w.type || 'session'} completed`, value: { type: typeof w.type === 'string' ? w.type.slice(0, 40) : 'Strength' } })
  }

  // ---- notes ----
  if (payload.notes != null) {
    const items = Array.isArray(payload.notes) ? payload.notes : [payload.notes]
    const existing = (day.notes || []).map((n) => (typeof n === 'string' ? n : n.text))
    items.forEach((n) => {
      const text = (typeof n === 'string' ? n : n?.text || '').toString().trim().slice(0, 500)
      if (!text) return
      const dup = existing.includes(text)
      ops.push({ category: 'notes', action: dup ? 'skip' : 'create', label: 'Note', detail: text, value: { text } })
    })
  }

  return { date, ops, unsupported, errors: ops.filter((o) => o.action === 'error') }
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

// Apply the plan to a CLONED state (caller clones). Only create/update ops apply;
// skip/planned/error are no-ops. Writes to days[date] + weightLog, records an import
// metadata entry on the day (for history + undo). Returns counts.
export function applyImport(next, payload, opts = {}) {
  const date = payload.date
  const { ops } = planImport(next, payload)
  next.days = next.days || {}
  const day = next.days[date] || (next.days[date] = {})
  let created = 0, updated = 0, skipped = 0
  const prevSnapshot = opts.snapshot ? JSON.parse(JSON.stringify(day)) : null

  for (const op of ops) {
    if (op.action === 'skip') { skipped++; continue }
    if (op.action === 'planned' || op.action === 'error') { skipped++; continue }
    const bump = () => { op.action === 'update' ? updated++ : created++ }
    switch (op.category) {
      case 'cardio': day.cardio = op.value; bump(); break
      case 'steps': {
        if (op.value.count != null) day.steps = op.value.count
        day.stepsDone = true; bump(); break
      }
      case 'water': day.water = op.value.glasses; bump(); break
      case 'weight': {
        day.weight = op.value.kg
        next.weightLog = next.weightLog || []
        const e = next.weightLog.find((w) => w.date === date)
        if (e) e.kg = op.value.kg; else next.weightLog.push({ date, kg: op.value.kg })
        next.weightLog.sort((a, b) => a.date.localeCompare(b.date)); bump(); break
      }
      case 'sleep': day.sleep = { minutes: op.value.minutes, userQualityRating: op.value.quality, source: 'import', confirmed: true, ts: Date.now() }; bump(); break
      case 'nutrition': day.food = [...(day.food || []), op.value]; bump(); break
      case 'skincare': case 'haircare': day.routines = { ...(day.routines || {}), [op.value.rkey]: true, ...(op.category === 'haircare' ? { haircare: true } : {}) }; bump(); break
      case 'supplements': { const supps = { ...(day.supps || {}) }; supps[op.value.slot] = { ...(supps[op.value.slot] || {}), taken: true, ts: Date.now() }; day.supps = supps; bump(); break }
      case 'workout': day.workout = { ...(day.workout || {}), did: true, type: op.value.type, importedComplete: true }; bump(); break
      case 'notes': day.notes = [...(day.notes || []), { text: op.value.text, ts: Date.now(), source: 'import' }]; bump(); break
      default: skipped++
    }
  }

  day._ts = Date.now()
  const record = { ts: Date.now(), date, created, updated, skipped, source: payload.source || 'chatgpt' }
  day.imports = [...(day.imports || []), record].slice(-20)
  return { counts: { created, updated, skipped }, record, prevSnapshot }
}

// The ChatGPT instructions — generated from the schema so the output can't drift.
export function buildImportPrompt(date, timezone, state) {
  const cats = IMPORT_CATEGORIES.map((c) => `- ${c.key} (${c.label}): ${c.note}`).join('\n')
  return `You are helping me log a day into my fitness app, Local Fit. Convert our conversation into ONE valid JSON object matching the schema below. Return ONLY the JSON — no prose, no markdown fences.

RULES
- Include ONLY activities and information I actually reported. Do not invent anything.
- Do not invent missing measurements. If I didn't give a number (duration, heart rate, calories), omit that field or use null.
- Distinguish estimates from measurements. A machine's calorie readout is an estimate: set "caloriesSource":"machine_estimate". Measured values use "measured".
- Distinguish planned from completed. Only set completed:true for things I actually did. If I only plan to do something, set completed:false (it will NOT be logged as done).
- Omit any category I didn't mention. Partial days are fine.
- Use explicit units as specified. Water in glasses (250 ml), liters, or ml. Weight in kg or lb. Sleep in hours or minutes.

SCHEMA (schemaVersion "${IMPORT_SCHEMA_VERSION}")
{
  "schemaVersion": "${IMPORT_SCHEMA_VERSION}",
  "date": "${date}",
  "timezone": "${timezone || 'local'}",
  "source": "chatgpt",
  ... include only the categories I mentioned ...
}

CATEGORIES
${cats}

EXAMPLE
{"schemaVersion":"${IMPORT_SCHEMA_VERSION}","date":"${date}","source":"chatgpt","cardio":[{"type":"cross trainer","durationMin":45,"intensity":3,"calories":330,"caloriesSource":"machine_estimate","completed":true}],"skincare":{"am":true},"notes":["Felt good, moderate effort."]}

Now convert our conversation into that JSON for ${date}.`
}
