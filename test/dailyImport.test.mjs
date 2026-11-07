/* Tests for the ChatGPT daily import engine (src/dailyImport.js).
 * Run with: npm test  (bundles with esbuild, then runs on node).
 * The app is single-user and localStorage-backed, so auth/ownership and DB
 * transaction-failure cases from the spec are covered by the host (one setState,
 * all-or-nothing) rather than this pure engine; the engine tests cover parsing,
 * validation, mapping, merge/idempotency, and the planned/estimated distinctions.
 */
import { parseImport, planImport, applyImport, buildImportPrompt, IMPORT_SCHEMA_VERSION } from '../src/dailyImport.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL:', m) } }
const clone = (o) => JSON.parse(JSON.stringify(o))
const today = '2026-11-16'
const P = (o) => parseImport(JSON.stringify(o), today).payload

// 1. valid daily import
let r = parseImport(JSON.stringify({ schemaVersion: '1.0', date: today, cardio: [{ type: 'cross trainer', durationMin: 45, intensity: 3, calories: 330, caloriesSource: 'machine_estimate', completed: true }], skincare: { am: true }, water: { glasses: 6 } }), today)
ok(r.ok, '1 valid import parses')
let pl = planImport({ days: {} }, r.payload)
ok(pl.ops.some((o) => o.category === 'cardio' && o.action === 'create' && o.estimated), '1 cardio create + estimated flag')
ok(pl.ops.some((o) => o.category === 'water' && o.detail === '6 glasses'), '1 water mapped')

// 2. invalid JSON
ok(!parseImport('{nope', today).ok, '2 invalid JSON rejected')

// 3. missing optional fields are null, not invented
let c = planImport({ days: {} }, P({ date: today, cardio: { type: 'walk', durationMin: 30, completed: true } })).ops[0]
ok(c.value.avgHr === null && c.value.calories === null, '3 missing optionals null (not invented)')

// 4. multiple meals
ok(planImport({ days: {} }, P({ date: today, nutrition: [{ name: 'Eggs', meal: 'breakfast', kcal: 300 }, { name: 'Bowl', meal: 'lunch', kcal: 650 }] })).ops.filter((o) => o.category === 'nutrition' && o.action === 'create').length === 2, '4 multiple meals create')

// 5. repeated import is idempotent (no duplicate meals)
const mealsP = P({ date: today, nutrition: [{ name: 'Eggs', meal: 'breakfast', kcal: 300 }, { name: 'Bowl', meal: 'lunch', kcal: 650 }] })
let n1 = { days: {} }; applyImport(n1, mealsP)
let res2 = applyImport(n1, mealsP)
ok(n1.days[today].food.length === 2 && res2.counts.created === 0, '5 repeated import idempotent')

// 6. partial-day merge preserves unrelated entries
let d = { days: {} }
applyImport(d, P({ date: today, cardio: { type: 'bike', durationMin: 40, completed: true } }))
applyImport(d, P({ date: today, water: { liters: 2 } }))
ok(d.days[today].cardio && d.days[today].water === 8, '6 partial-day merge (cardio + water, 2L=8 glasses)')

// 7. planned never marked completed
let pp = planImport({ days: {} }, P({ date: today, workout: { completed: false, type: 'Legs' }, cardio: { type: 'run', durationMin: 20, completed: false } }))
ok(pp.ops.every((o) => o.action === 'planned'), '7 planned activities flagged planned')
let dp = { days: {} }; applyImport(dp, P({ date: today, workout: { completed: false, type: 'Legs' } }))
ok(!dp.days[today].workout, '7 planned workout not logged')

// 8. estimated vs measured
ok(planImport({ days: {} }, P({ date: today, weight: { kg: 74.5, source: 'measured' } })).ops[0].estimated === false, '8 measured weight not flagged')
ok(planImport({ days: {} }, P({ date: today, nutrition: [{ name: 'Guess', meal: 'lunch', kcal: 500 }] })).ops[0].estimated === true, '8 meal defaults to estimate')

// 9. unknown categories reported, not silently dropped
ok(planImport({ days: {} }, P({ date: today, mood: 'great', steps: { count: 8000 } })).unsupported.includes('mood'), '9 unknown category reported')

// 10. bad date rejected
ok(!parseImport(JSON.stringify({ date: '2026-13-99', steps: 5000 }), today).ok, '10 invalid date rejected')

// 11. schema version mismatch rejected
ok(!parseImport(JSON.stringify({ schemaVersion: '2.0', date: today }), today).ok, '11 unsupported schemaVersion rejected')

// 12. prototype pollution stripped
let rp = parseImport('{"date":"' + today + '","__proto__":{"polluted":true},"steps":{"count":5000}}', today)
ok(rp.ok && ({}).polluted === undefined, '12 prototype pollution stripped')

// 13. numeric range validation
ok(planImport({ days: {} }, P({ date: today, water: { glasses: 999 } })).ops[0].action === 'error', '13 out-of-range water -> error')

// 14. conflict detection
let ex = { days: { [today]: { cardio: { type: 'bike', minutes: 40 } } } }
ok(planImport(ex, P({ date: today, cardio: { type: 'run', durationMin: 30, completed: true } })).ops[0].action === 'update', '14 different cardio -> update')
ok(planImport(ex, P({ date: today, cardio: { type: 'bike', durationMin: 40, completed: true } })).ops[0].action === 'skip', '14 same cardio -> skip (idempotent)')

// 15. prompt generated from schema
const prompt = buildImportPrompt(today, 'America/New_York', {})
ok(prompt.includes('schemaVersion') && prompt.includes(IMPORT_SCHEMA_VERSION) && prompt.includes('machine_estimate') && prompt.includes(today), '15 prompt built from schema')

// 16. date defaults to today when omitted
ok(parseImport(JSON.stringify({ steps: { count: 100 } }), today).payload.date === today, '16 missing date defaults to today')

// 17. routines map to completion flags
let dr = { days: {} }; applyImport(dr, P({ date: today, skincare: { am: true, pm: false }, haircare: { am: true } }))
ok(dr.days[today].routines.skincareAM === true && dr.days[today].routines.skincarePM === undefined && dr.days[today].routines.haircareAM === true, '17 routines -> completion flags (pm:false not set)')

// 18. import records metadata on the day
ok(Array.isArray(dr.days[today].imports) && dr.days[today].imports.length === 1, '18 import metadata recorded')

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
