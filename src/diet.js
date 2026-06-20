/* ---------- diet engine (pure) ----------------------------------------------
 * A protein-first pantry coach. You eat from a small, fixed, location-scoped
 * menu; the app holds the brains: it tracks protein toward a flat 150g target,
 * keeps you under a computed calorie ceiling, and suggests the next grab that
 * closes the protein gap cheapest. One running food log per day, no meal buckets.
 *
 * Pure functions of `state` + date; no React, no I/O. Macros are per the item's
 * stated portion. Calorie ceiling needs bodyweight — without it, runs protein-only.
 * -------------------------------------------------------------------------- */

export const PROTEIN_TARGET_DEFAULT = 150

// --- pantry seed (the owner's real list) ------------------------------------
// Lives in CODE ONLY — never written to synced state — so editing the list just
// ships in the app, and the sync union-merge only ever carries *custom* adds.
// `loc` ('home' | 'office' | 'outside') is derived from each item's origin:
// grocery/home -> home, office -> office, restaurant -> outside. Macros are per
// the stated `portion`; logs denormalize them so edits never rewrite history.
export const DEFAULT_PANTRY = [
  // Home (grocery + home-made). sugar = grams per the listed portion (USDA-ish).
  { id: 'banana',           name: 'Banana',             loc: 'home', category: 'fruit',      portion: '1 medium (118g)', kcal: 105, protein: 1.3, carbs: 27,   fat: 0.4,  fiber: 3.1, sugar: 14 },
  { id: 'honeycrisp_apple', name: 'Honeycrisp Apple',   loc: 'home', category: 'fruit',      portion: '1 medium (182g)', kcal: 95,  protein: 0.5, carbs: 25,   fat: 0.3,  fiber: 4.4, sugar: 19 },
  { id: 'blueberries',      name: 'Blueberries',        loc: 'both', category: 'fruit',      portion: '100g',            kcal: 57,  protein: 0.7, carbs: 14.5, fat: 0.3,  fiber: 2.4, sugar: 10 },
  { id: 'raspberries',      name: 'Raspberries',        loc: 'both', category: 'fruit',      portion: '100g',            kcal: 52,  protein: 1.2, carbs: 12,   fat: 0.7,  fiber: 6.5, sugar: 4.4 },
  { id: 'blackberries',     name: 'Blackberries',       loc: 'both', category: 'fruit',      portion: '100g',            kcal: 43,  protein: 1.4, carbs: 10,   fat: 0.5,  fiber: 5.3, sugar: 4.9 },
  { id: 'strawberries',     name: 'Strawberries',       loc: 'both', category: 'fruit',      portion: '100g',            kcal: 32,  protein: 0.7, carbs: 7.7,  fat: 0.3,  fiber: 2,   sugar: 4.9 },
  { id: 'mandarins',        name: 'Mandarins',          loc: 'home', category: 'fruit',      portion: '1 medium',        kcal: 47,  protein: 0.7, carbs: 12,   fat: 0.3,  fiber: 2,   sugar: 9 },
  { id: 'avocado',          name: 'Avocado',            loc: 'home', category: 'fruit',      portion: '100g',            kcal: 160, protein: 2,   carbs: 8.5,  fat: 14.7, fiber: 6.7, sugar: 0.7 },
  { id: 'sweet_potato',     name: 'Sweet Potato',       loc: 'home', category: 'vegetable',  portion: '1 medium cooked', kcal: 112, protein: 2,   carbs: 26,   fat: 0.1,  fiber: 4,   sugar: 6 },
  { id: 'broccoli',         name: 'Broccoli',           loc: 'home', category: 'vegetable',  portion: '100g',            kcal: 34,  protein: 2.8, carbs: 7,    fat: 0.4,  fiber: 2.6, sugar: 1.7 },
  { id: 'mushrooms',        name: 'Mushrooms',          loc: 'home', category: 'vegetable',  portion: '100g',            kcal: 22,  protein: 3.1, carbs: 3.3,  fat: 0.3,  fiber: 1,   sugar: 2 },
  { id: 'baby_carrots',     name: 'Baby Carrots',       loc: 'home', category: 'vegetable',  portion: '100g',            kcal: 41,  protein: 0.9, carbs: 10,   fat: 0.2,  fiber: 2.8, sugar: 4.7 },
  { id: 'chicken_breast',   name: 'Chicken Breast',     loc: 'home', category: 'protein',    portion: '100g cooked',     kcal: 165, protein: 31,  carbs: 0,    fat: 3.6,  fiber: 0,   sugar: 0 },
  { id: 'chicken_thigh',    name: 'Chicken Thigh',      loc: 'home', category: 'protein',    portion: '100g cooked',     kcal: 209, protein: 26,  carbs: 0,    fat: 11,   fiber: 0,   sugar: 0 },
  { id: 'egg',              name: 'Egg',                loc: 'home', category: 'protein',    portion: '1 large egg',     kcal: 72,  protein: 6.3, carbs: 0.4,  fat: 4.8,  fiber: 0,   sugar: 0.4 },
  { id: 'cottage_cheese',   name: 'Cottage Cheese',     loc: 'home', category: 'dairy',      portion: '1 tbsp',          kcal: 15,  protein: 2,   carbs: 1,    fat: 0.5,  fiber: 0,   sugar: 0.3 },
  { id: 'fage_total_0',     name: 'Fage Total 0%',      loc: 'home', category: 'dairy',      portion: '170g',            kcal: 90,  protein: 18,  carbs: 5,    fat: 0,    fiber: 0,   sugar: 5 },
  { id: 'whole_milk',       name: 'Whole Milk',         loc: 'home', category: 'dairy',      portion: '1 cup',           kcal: 149, protein: 8,   carbs: 12,   fat: 8,    fiber: 0,   sugar: 12 },
  { id: 'oat_milk',         name: 'Oat Milk',           loc: 'home', category: 'dairy_alt',  portion: '1 cup',           kcal: 120, protein: 3,   carbs: 16,   fat: 5,    fiber: 2,   sugar: 7 },
  { id: 'espresso',         name: 'Espresso',           loc: 'home', category: 'beverage',   portion: '1 shot',          kcal: 5,   protein: 0.3, carbs: 1,    fat: 0,    fiber: 0,   sugar: 0 },
  { id: 'sriracha',         name: 'Sriracha',           loc: 'home', category: 'condiment',  portion: '1 tbsp',          kcal: 15,  protein: 0,   carbs: 3,    fat: 0,    fiber: 0,   sugar: 1 },
  { id: 'barebells_bar',    name: 'Barebells Protein Bar', loc: 'home', category: 'protein_snack', portion: '1 bar',    kcal: 200, protein: 20,  carbs: 20,   fat: 7,    fiber: 3,   sugar: 1 },
  { id: 'whey_isolate',     name: 'Impact Whey Isolate',   loc: 'home', category: 'protein',       portion: '1 scoop (25g)', kcal: 100, protein: 23, carbs: 2, fat: 1, fiber: 0,   sugar: 1 },
  { id: 'creatine',         name: 'Creatine Monohydrate',  loc: 'home', category: 'supplement',    portion: '1 scoop (3g)',  kcal: 0,   protein: 0,  carbs: 0, fat: 0, fiber: 0,   sugar: 0 },
  { id: 'homemade_chicken_bowl', name: 'Homemade Chicken Bowl', loc: 'home', category: 'homemade_meal', portion: '1 bowl', kcal: 510, protein: 45, carbs: 28, fat: 23, fiber: 10, sugar: 6,
    mods: [{ id: 'chicken', label: 'Chicken (×50g)', default: 3, min: 0, max: 8, per: { kcal: 83, protein: 15.5, carbs: 0, fat: 1.8 } }] },
  { id: 'homemade_egg_bowl',     name: 'Homemade Egg Bowl',     loc: 'home', category: 'homemade_meal', portion: '1 bowl', kcal: 485, protein: 25, carbs: 28, fat: 31, fiber: 10, sugar: 6,
    mods: [{ id: 'eggs', label: 'Eggs', default: 3, min: 0, max: 8, per: { kcal: 72, protein: 6.3, carbs: 0.4, fat: 4.8, sugar: 0.4 } }] },
  // Combos — ingredients combined into dishes you actually eat (macros summed;
  // estimates, tweak as needed). The raw ingredients stay available too.
  { id: 'cappuccino_whole',      name: 'Cappuccino (Whole Milk)', loc: 'home', category: 'beverage',     portion: '1 cup',     kcal: 90,  protein: 4.5, carbs: 8,  fat: 4,  fiber: 0, sugar: 7, ingredients: ['espresso', 'whole_milk'] },
  { id: 'cappuccino_oat',        name: 'Cappuccino (Oat Milk)',   loc: 'home', category: 'beverage',     portion: '1 cup',     kcal: 70,  protein: 2,   carbs: 9,  fat: 3,  fiber: 1, sugar: 6, ingredients: ['espresso', 'oat_milk'] },
  { id: 'stirfry_chicken',       name: 'Stir-fried Chicken & Veg', loc: 'home', category: 'homemade_meal', portion: '1 plate',  kcal: 440, protein: 52,  carbs: 13, fat: 20, fiber: 4, sugar: 5, ingredients: ['chicken_breast', 'broccoli', 'mushrooms', 'sriracha'] },
  { id: 'indian_chicken_breast', name: 'Indian-style Chicken Breast', loc: 'home', category: 'homemade_meal', portion: '1 serving', kcal: 435, protein: 48, carbs: 8, fat: 22, fiber: 2, sugar: 3, ingredients: ['chicken_breast'] },
  { id: 'indian_chicken_thighs', name: 'Indian-style Chicken Thighs', loc: 'home', category: 'homemade_meal', portion: '1 serving', kcal: 505, protein: 41, carbs: 8, fat: 33, fiber: 2, sugar: 3, ingredients: ['chicken_thigh'] },
  // Office
  { id: 'oikos_triple_zero',     name: 'Oikos Triple Zero',  loc: 'office', category: 'dairy',       portion: '1 container',  kcal: 90,  protein: 15, carbs: 7,  fat: 0,    fiber: 6,   sugar: 4 },
  { id: 'office_grilled_chicken',name: 'Office Grilled Chicken', loc: 'office', category: 'office_food', portion: '100g',    kcal: 165, protein: 31, carbs: 0,  fat: 4,    fiber: 0,   sugar: 0 },
  { id: 'office_beef',           name: 'Office Beef',        loc: 'office', category: 'office_food', portion: '100g',         kcal: 250, protein: 26, carbs: 0,  fat: 15,   fiber: 0,   sugar: 0 },
  { id: 'office_pork',           name: 'Office Pork',        loc: 'office', category: 'office_food', portion: '100g',         kcal: 242, protein: 27, carbs: 0,  fat: 14,   fiber: 0,   sugar: 0 },
  { id: 'falafel',               name: 'Falafel',            loc: 'office', category: 'office_food', portion: '100g',         kcal: 333, protein: 13, carbs: 31, fat: 18,   fiber: 4,   sugar: 2 },
  { id: 'white_rice',            name: 'White Rice',         loc: 'office', category: 'office_food', portion: '1 cup cooked', kcal: 205, protein: 4,  carbs: 45, fat: 0.4,  fiber: 0.6, sugar: 0 },
  { id: 'office_chicken_burrito',name: 'Office Chicken Burrito', loc: 'office', category: 'office_food', portion: '1 small', kcal: 450, protein: 25, carbs: 45, fat: 18,   fiber: 4,   sugar: 3 },
  { id: 'pizza_slice',           name: 'Pizza Slice',        loc: 'office', category: 'office_food', portion: '1 slice',      kcal: 285, protein: 12, carbs: 36, fat: 10,   fiber: 2,   sugar: 4 },
  { id: 'hummus',                name: 'Hummus',             loc: 'office', category: 'dip',         portion: '2 tbsp',       kcal: 70,  protein: 2,  carbs: 4,  fat: 5,    fiber: 2,   sugar: 0.3 },
  { id: 'tzatziki',              name: 'Tzatziki',           loc: 'office', category: 'dip',         portion: '2 tbsp',       kcal: 35,  protein: 2,  carbs: 2,  fat: 2,    fiber: 0,   sugar: 1 },
  { id: 'french_fries',          name: 'French Fries',       loc: 'office', category: 'side',        portion: '100g',         kcal: 312, protein: 3.4,carbs: 41, fat: 15,   fiber: 3.8, sugar: 0.3 },
  { id: 'chocolate_empanada',    name: 'Chocolate Empanada', loc: 'office', category: 'dessert',     portion: '1 piece',      kcal: 250, protein: 4,  carbs: 32, fat: 12,   fiber: 1,   sugar: 15 },
  // Office cut-fruit bar
  { id: 'office_watermelon',     name: 'Watermelon (cubes)', loc: 'office', category: 'fruit',       portion: '1 cup cubes',  kcal: 46,  protein: 0.9, carbs: 11.5, fat: 0.2, fiber: 0.6, sugar: 9.5 },
  { id: 'office_honeydew',       name: 'Honeydew (cubes)',   loc: 'office', category: 'fruit',       portion: '1 cup diced',  kcal: 61,  protein: 0.9, carbs: 15,   fat: 0.2, fiber: 1.4, sugar: 14 },
  { id: 'office_mango',          name: 'Mango Slices',       loc: 'office', category: 'fruit',       portion: '1 cup sliced', kcal: 99,  protein: 1.4, carbs: 25,   fat: 0.6, fiber: 2.6, sugar: 23 },
  // Outside (restaurant)
  { id: 'sweetgreen_hot_honey_chicken', name: 'Sweetgreen Hot Honey Chicken', loc: 'outside', category: 'restaurant_meal', portion: '1 plate', kcal: 855, protein: 49, carbs: 73, fat: 39, fiber: 9, sugar: 20 },
  // Desserts & drinks (dessert calories researched; tweak if a serving differs)
  { id: 'chocolate_chip_cookie', name: 'Chocolate Chip Cookie', loc: 'office', category: 'dessert',  portion: '1 cookie', kcal: 230, protein: 3,   carbs: 31, fat: 11, fiber: 1, sugar: 17 },
  { id: 'jenis_ice_cream',       name: "Jeni's Ice Cream",      loc: 'home',   category: 'dessert',  portion: '1 scoop',  kcal: 250, protein: 4,   carbs: 28, fat: 14, fiber: 1, sugar: 24 },
  { id: 'dark_chocolate_toffee', name: 'Dark Chocolate Toffee', loc: 'both',   category: 'dessert',  portion: '3 pieces', kcal: 140, protein: 1.5, carbs: 15, fat: 9,  fiber: 1, sugar: 13 },
  { id: 'diet_coke',             name: 'Diet Coke',             loc: 'both',   category: 'beverage', portion: '1 can',    kcal: 0,   protein: 0,   carbs: 0,  fat: 0,  fiber: 0, sugar: 0 },
  { id: 'coke_zero',             name: 'Coke Zero',             loc: 'both',   category: 'beverage', portion: '1 can',    kcal: 0,   protein: 0,   carbs: 0,  fat: 0,  fiber: 0, sugar: 0 },
]
const DEFAULT_BY_ID = Object.fromEntries(DEFAULT_PANTRY.map((it) => [it.id, it]))

// The pantry the app actually uses: baked seed + the user's custom adds (synced).
// An explicit user edit (`edited:true`) overrides the matching seed so customized
// foods stick; legacy non-edited id collisions are still dropped (seed wins) so a
// stale test item can't shadow the seed.
export function effectivePantry(state) {
  const customs = (state?.pantry || []).filter((it) => !it.seed)
  const edits = Object.fromEntries(customs.filter((it) => it.edited && DEFAULT_BY_ID[it.id]).map((it) => [it.id, it]))
  const merged = DEFAULT_PANTRY.map((s) => edits[s.id] || s)
  const extras = customs.filter((it) => !DEFAULT_BY_ID[it.id])
  return [...merged, ...extras]
}

export const isSeedFood = (id) => !!DEFAULT_BY_ID[id]

// Daily fiber goal (g). ~14g per 1000 kcal → ~30g is the widely-cited target.
export const FIBER_TARGET = 30

// Units offered when adding a food / a component part, and the location chips.
export const FOOD_UNITS = ['each', 'serving', 'g', 'oz', 'ml', 'cup', 'tbsp', 'tsp', 'piece', 'slice', 'scoop', 'bowl', 'plate', 'bar', 'can', 'container', 'small', 'medium', 'large', 'handful']
export const FOOD_LOCS = [['home', 'Home'], ['office', 'Office'], ['outside', 'Outside'], ['both', 'Everywhere']]

// --- location ----------------------------------------------------------------
// Office Tue/Wed/Thu; home Mon + Fri/Sat/Sun. Outside is only ever a manual pick.
export function defaultLocation(dateIso) {
  const dow = new Date(dateIso + 'T00:00:00').getDay() // Sun=0..Sat=6
  return [2, 3, 4].includes(dow) ? 'office' : 'home'
}
export const LOCATIONS = ['home', 'office', 'outside']

// Items available at a location ('both'-tagged items show everywhere).
export function pantryFor(pantry, loc) {
  return (pantry || []).filter((it) => it.loc === loc || it.loc === 'both')
}

// --- targets -----------------------------------------------------------------
function latest(log, key) {
  if (!log?.length) return null
  return [...log].sort((a, b) => a.date.localeCompare(b.date)).at(-1)[key]
}

const _day = (iso) => new Date(iso + 'T00:00:00')

// Observed TDEE from real logs: average calories + the deficit implied by the
// smoothed weight trend (linear regression), over a rolling 28 days anchored on
// the latest weigh-in. Needs ~14 weigh-ins + 10 calorie-logged days, else null.
//   dailyDeficit = -slope(kg/day) × 7700;  TDEE = avgCalories + dailyDeficit
function observedTDEE(state) {
  const wl = [...(state.weightLog || [])].sort((a, b) => a.date.localeCompare(b.date))
  if (wl.length < 2) return null
  const anchor = _day(wl.at(-1).date)
  const start = new Date(anchor); start.setDate(start.getDate() - 28)
  const pts = wl.filter((w) => _day(w.date) >= start)
  if (pts.length < 14) return null
  const t0 = _day(pts[0].date).getTime()
  const xs = pts.map((p) => (_day(p.date).getTime() - t0) / 86400000)
  const ys = pts.map((p) => p.kg)
  const n = xs.length, sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0)
  const sxx = xs.reduce((a, b) => a + b * b, 0), sxy = xs.reduce((a, b, i) => a + b * ys[i], 0)
  const denom = n * sxx - sx * sx
  if (denom === 0) return null
  const slope = (n * sxy - sx * sy) / denom // kg/day; negative = losing
  const days = state.days || {}
  let cal = 0, calDays = 0
  for (const dt of Object.keys(days)) {
    const d = _day(dt); if (d < start || d > anchor) continue
    const food = days[dt].food || []; if (!food.length) continue
    cal += food.reduce((a, x) => a + (x.kcal || 0), 0); calDays++
  }
  if (calDays < 10) return null
  const avgCal = cal / calDays
  return { value: Math.round(avgCal + (-slope * 7700)), avgCal: Math.round(avgCal), weighIns: n, calDays }
}

// Two-stage TDEE: a formula estimate (Katch-McArdle when body fat is known, else
// Mifflin-St Jeor), blended toward the observed value as usable data accrues.
// confidence: low (formula only) · medium (threshold met) · high (28d of data).
export function tdee(state) {
  const kg = latest(state.weightLog, 'kg')
  if (!kg) return null
  const bf = latest(state.bodyFatLog, 'pct')
  const activity = state.profile?.activity || 1.45
  let bmr, method
  if (bf != null) { bmr = 370 + 21.6 * (kg * (1 - bf / 100)); method = 'Katch-McArdle' }
  else {
    const h = state.profile?.height || 170, age = state.profile?.age || 30
    bmr = 10 * kg + 6.25 * h - 5 * age + (state.profile?.sex === 'female' ? -161 : 5)
    method = 'Mifflin-St Jeor'
  }
  const formula = Math.round(bmr * activity)
  const obs = observedTDEE(state)
  let value = formula, confidence = 'low'
  if (obs) {
    const usable = Math.min(obs.weighIns, obs.calDays)
    const w = Math.max(0, Math.min(1, (usable - 7) / (24 - 7))) // ramp formula→observed
    const safeObs = Math.max(formula * 0.65, Math.min(formula * 1.5, obs.value)) // guard noise
    value = Math.round(formula * (1 - w) + safeObs * w)
    confidence = obs.weighIns >= 24 && obs.calDays >= 20 ? 'high' : 'medium'
  }
  return { value, formula, observed: obs ? obs.value : null, confidence, method, kg, bf }
}

// Daily calorie ceiling = blended TDEE − deficit. Auto-calibrates as data accrues.
// Returns null when bodyweight is unknown (UI runs protein-only until then).
export function calorieTarget(state, opts = {}) {
  const t = tdee(state)
  if (!t) return null
  const deficit = opts.deficit ?? state.profile?.deficit ?? 500
  return {
    ceiling: Math.round((t.value - deficit) / 10) * 10,
    tdee: t.value, confidence: t.confidence,
    lbm: t.bf != null ? Math.round(t.kg * (1 - t.bf / 100) * 10) / 10 : null, kg: t.kg, bf: t.bf,
  }
}

// The full picture for display: maintenance, target, deficit, expected weekly loss.
export function calorieBreakdown(state) {
  const ct = calorieTarget(state)
  if (!ct) return null
  const deficit = ct.tdee - ct.ceiling
  return { maintenance: ct.tdee, target: ct.ceiling, deficit, weeklyLoss: Math.round((deficit * 7 / 7700) * 100) / 100, confidence: ct.confidence }
}

// A calorie day isn't pass/fail — it's a zone. Eating a bit over target is fine
// (still a deficit); only real overshoot is "red". Being under target stays green.
//   green ≤ target+80 · yellow target+80…+230 · red beyond
export function calorieZone(kcal, target) {
  if (kcal <= target + 80) return 'green'
  if (kcal <= target + 230) return 'yellow'
  return 'red'
}

// --- day tally ---------------------------------------------------------------
export function dayTotals(day) {
  const log = day?.food || []
  let kcal = 0, protein = 0, carbs = 0, fat = 0, fiber = 0, sugar = 0, provisional = false
  for (const e of log) {
    kcal += e.kcal || 0; protein += e.protein || 0; carbs += e.carbs || 0; fat += e.fat || 0
    fiber += e.fiber || 0; sugar += e.sugar || 0
    if (e.provisional) provisional = true
  }
  const r1 = (n) => Math.round(n * 10) / 10
  return { kcal, protein, carbs: r1(carbs), fat: r1(fat), fiber: r1(fiber), sugar: r1(sugar), count: log.length, provisional }
}

// --- recommendation: protein-first, fit the remaining calorie room ----------
export function recommend(state, dateIso, loc, proteinTarget = PROTEIN_TARGET_DEFAULT) {
  const day = state.days?.[dateIso] || {}
  const totals = dayTotals(day)
  const gap = proteinTarget - totals.protein
  if (gap <= 0) return { done: true, gap: 0, text: `Protein's in — ${Math.round(totals.protein)}g. Hold the line on calories.` }

  const ct = calorieTarget(state)
  const kcalLeft = ct ? ct.ceiling - totals.kcal : Infinity
  // Most protein-per-calorie first — the cheapest way to close the gap.
  const items = pantryFor(effectivePantry(state), loc)
    .filter((it) => it.protein > 0)
    .sort((a, b) => (b.protein / Math.max(1, b.kcal)) - (a.protein / Math.max(1, a.kcal)))

  if (!items.length) {
    return { done: false, gap, items: [],
      text: loc === 'outside'
        ? `You're out — get ~${Math.round(gap)}g more protein from whatever's leanest.`
        : `Add items to your ${loc} list and I'll suggest the next grab.` }
  }

  // Greedy: stack the most efficient items that fit the budget until the gap closes (cap 3).
  const pick = []
  let p = 0, k = 0
  for (const it of items) {
    if (pick.length >= 3 || p >= gap) break
    if (ct && k + it.kcal > kcalLeft && pick.length) continue // don't blow the ceiling
    pick.push(it); p += it.protein; k += it.kcal
  }
  const names = pick.map((it) => it.name).join(' + ')
  const kcalNote = ct ? ` · ~${k} cal, ${Math.max(0, kcalLeft - k)} left` : ''
  return { done: false, gap, items: pick, addProtein: p, addKcal: k,
    text: `${names} → +${Math.round(p)}g protein${kcalNote}.` }
}

// --- diet score (0-10): under calories AND hit protein; calories weigh heavier --
// null until something's logged. Feeds the Diet goal ring.
export function dietScore(state, dateIso, proteinTarget = PROTEIN_TARGET_DEFAULT) {
  const day = state.days?.[dateIso] || {}
  const totals = dayTotals(day)
  if (!totals.count) return null
  const proteinAch = Math.max(0, Math.min(1, totals.protein / proteinTarget))
  const ct = calorieTarget(state)
  if (!ct) return Math.round(proteinAch * 10) // no ceiling known → protein only
  const calAdh = totals.kcal <= ct.ceiling ? 1 : Math.max(0, ct.ceiling / totals.kcal)
  return Math.round((0.6 * calAdh + 0.4 * proteinAch) * 10) // calories 60%, protein 40%
}

// --- pantry grouping (so the card shows one category at a time, not a long list) --
const GROUP_BY_CAT = {
  homemade_meal: 'Meals', office_food: 'Meals', restaurant_meal: 'Meals',
  protein: 'Protein',
  fruit: 'Fruit', vegetable: 'Veg',
  dairy: 'Dairy', dairy_alt: 'Dairy',
  beverage: 'Drinks',
  protein_snack: 'Snacks', dessert: 'Snacks', side: 'Snacks',
  supplement: 'Supplements',
  dip: 'Extras', condiment: 'Extras',
}
export const GROUP_ORDER = ['Meals', 'Protein', 'Supplements', 'Fruit', 'Veg', 'Dairy', 'Drinks', 'Snacks', 'Extras', 'Other']
// Custom adds carry an explicit `group`; seed items derive it from their category.
export function groupOf(item) { return item.group || GROUP_BY_CAT[item.category] || 'Other' }

// Items flagged as treats/junk so the UI can warn you while logging. Tunable in
// one place; custom adds can also set `unhealthy: true`.
const UNHEALTHY_IDS = new Set([
  'french_fries', 'pizza_slice', 'chocolate_empanada', 'chocolate_chip_cookie',
  'jenis_ice_cream', 'dark_chocolate_toffee',
])
export function isUnhealthy(item) { return item?.unhealthy === true || UNHEALTHY_IDS.has(item?.id) }

// Packaged/processed foods and added-sugar foods — for the goal-aligned critique.
const PROCESSED_IDS = new Set([
  'diet_coke', 'coke_zero', 'barebells_bar', 'oikos_triple_zero', 'chocolate_chip_cookie',
  'jenis_ice_cream', 'dark_chocolate_toffee', 'chocolate_empanada', 'pizza_slice',
  'french_fries', 'office_chicken_burrito',
])
const SUGARY_IDS = new Set(['jenis_ice_cream', 'dark_chocolate_toffee', 'chocolate_chip_cookie', 'chocolate_empanada'])
export function isProcessed(e) { return e?.processed === true || PROCESSED_IDS.has(e?.id) }
export function isSugary(e) { return e?.sugary === true || SUGARY_IDS.has(e?.id) }

// A goal-aligned, rule-based read on the day. Returns { tone, headline, points[] }.
// Core rule: calories are the hard ceiling — never advise eating past it to chase
// protein. Extra rules flag treats, processed load, repeats, sugar, diet soda.
export function dayCritique(state, dateIso, proteinTarget = PROTEIN_TARGET_DEFAULT) {
  const log = (state.days?.[dateIso] || {}).food || []
  const totals = dayTotals(state.days?.[dateIso] || {})
  if (!totals.count) return { tone: 'neutral', headline: 'Nothing logged yet today.', points: [] }

  const ct = calorieTarget(state)
  const short = Math.max(0, Math.round(proteinTarget - totals.protein))
  const proteinOk = totals.protein >= proteinTarget
  const RANK = { neutral: 0, good: 0, warn: 1, bad: 2 }
  let tone = 'good'
  const worsen = (t) => { if (RANK[t] > RANK[tone]) tone = t }
  const names = (list) => [...new Set(list.map((e) => e.name))].join(', ')

  // --- core: calorie ceiling vs protein -------------------------------------
  let headline
  if (!ct) {
    headline = proteinOk ? `Protein's in at ${Math.round(totals.protein)}g. Log your weight to track calories too.`
      : `${short}g short on protein. Log your weight to set a calorie ceiling.`
    if (!proteinOk) worsen('warn')
  } else {
    const room = ct.ceiling - totals.kcal
    const zone = calorieZone(totals.kcal, ct.ceiling)
    if (zone === 'red') {
      headline = `${totals.kcal} cal — well past your ${ct.ceiling} target; today's deficit is mostly gone. Stop eating and reset tomorrow.`
      worsen('bad')
    } else if (zone === 'yellow') {
      headline = `${totals.kcal} cal — a touch over target (${ct.ceiling}), but still a deficit. Fine — just don't drift higher.${proteinOk ? '' : ` ${short}g protein to go — lean sources only.`}`
      worsen('warn')
    } else if (proteinOk) {
      headline = `On track — ${Math.round(totals.protein)}g protein and calories in the green (${totals.kcal} of ${ct.ceiling}).`
    } else if (room < 150) {
      headline = `${room} cal of room and ${short}g short on protein. Lean protein only — whey, egg whites, chicken.`
      worsen('warn')
    } else {
      headline = `${room} cal of room and ${short}g protein to go — close it with a lean source (whey, chicken, Greek yogurt).`
      worsen('warn')
    }
  }

  // --- rules ----------------------------------------------------------------
  const points = []

  const treats = log.filter((e) => e.unhealthy)
  if (treats.length) {
    points.push(`${treats.length} treat${treats.length > 1 ? 's' : ''} today (${names(treats)}). On a cut, hold treats to one a day.`)
    worsen(treats.length > 1 ? 'warn' : 'neutral')
  }

  // Overconsumption of a single item (counts quantity): e.g. 6× Oikos.
  const qtyById = {}
  for (const e of log) { qtyById[e.id] = (qtyById[e.id] || 0) + (e.qty || 1) }
  for (const e of log) {
    const n = qtyById[e.id]
    if (n >= 4 && !points.some((p) => p.includes(e.name))) {
      points.push(`${n}× ${e.name} — that's a lot of one thing. Even lean packaged food adds up; vary it.`)
      worsen('warn')
    }
  }

  const processed = log.filter(isProcessed)
  if (processed.length >= 3) {
    points.push(`${processed.length} processed/packaged items — lean harder on whole foods to hit your body-fat goal.`)
    worsen('warn')
  }

  const sugary = log.filter(isSugary)
  if (sugary.length) {
    points.push(`Added sugar crept in (${names(sugary)}). The deficit hates it — swap for fruit or skip.`)
    worsen('warn')
  }

  if (log.some((e) => e.id === 'diet_coke' || e.id === 'coke_zero')) {
    points.push(`Diet soda's calorie-free, but make water the default — it's not helping the goal.`)
  }

  return { tone, headline, points }
}

// Apply ingredient modifiers (e.g. 2 vs 3 eggs in a bowl) to an item's macros.
export function applyMods(item, modCounts) {
  let { kcal = 0, protein = 0, carbs = 0, fat = 0, fiber = 0, sugar = 0 } = item
  for (const m of item.mods || []) {
    const delta = ((modCounts?.[m.id] ?? m.default) - m.default)
    kcal += delta * (m.per.kcal || 0); protein += delta * (m.per.protein || 0)
    carbs += delta * (m.per.carbs || 0); fat += delta * (m.per.fat || 0)
    fiber += delta * (m.per.fiber || 0); sugar += delta * (m.per.sugar || 0)
  }
  const r1 = (n) => Math.max(0, Math.round(n * 10) / 10)
  return { kcal: Math.max(0, Math.round(kcal)), protein: r1(protein), carbs: r1(carbs), fat: r1(fat), fiber: r1(fiber), sugar: r1(sugar) }
}

const _slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
const _r1 = (n) => Math.round((Number(n) || 0) * 10) / 10

// Turn a list of components (each holding the macros for its DEFAULT amount) into
// a base-macros + mods pair. Per-unit macros are derived (defaultMacros / default)
// so the quantity editor can scale a part up or down. base = the sum at defaults,
// so applyMods returns exactly these macros until a part is nudged.
export function buildFromComponents(components = []) {
  const base = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0 }
  const mods = []
  for (const c of components) {
    if (!c) continue
    const def = Math.max(1, Number(c.default) || 1)
    const k = Number(c.kcal) || 0, p = Number(c.protein) || 0, cb = Number(c.carbs) || 0, f = Number(c.fat) || 0
    const fib = Number(c.fiber) || 0, sug = Number(c.sugar) || 0
    base.kcal += k; base.protein += p; base.carbs += cb; base.fat += f; base.fiber += fib; base.sugar += sug
    mods.push({
      id: c.id || _slug(c.name) || `part_${mods.length + 1}`,
      label: c.name || 'Part', unit: c.unit || '',
      default: def, min: 0, max: def * 4 + 4,
      per: { kcal: _r1(k / def), protein: _r1(p / def), carbs: _r1(cb / def), fat: _r1(f / def), fiber: _r1(fib / def), sugar: _r1(sug / def) },
    })
  }
  return { base: { kcal: Math.round(base.kcal), protein: _r1(base.protein), carbs: _r1(base.carbs), fat: _r1(base.fat), fiber: _r1(base.fiber), sugar: _r1(base.sugar) }, mods }
}

// Inverse: reconstruct editable components (default-amount macros) from an item's
// mods, folding any non-component remainder into a fixed 'Base' part so nothing is
// lost when editing a seed food that carries a fixed base (e.g. the egg bowl), or
// a plain food being upgraded into parts (its whole macros become the Base part).
export function componentsFromItem(item) {
  const comps = (item.mods || []).map((m) => ({
    id: m.id, name: m.label, unit: m.unit || '', default: m.default,
    kcal: Math.round((m.per?.kcal || 0) * m.default),
    protein: _r1((m.per?.protein || 0) * m.default),
    carbs: _r1((m.per?.carbs || 0) * m.default),
    fat: _r1((m.per?.fat || 0) * m.default),
    fiber: _r1((m.per?.fiber || 0) * m.default),
    sugar: _r1((m.per?.sugar || 0) * m.default),
  }))
  const sum = comps.reduce((a, c) => ({ kcal: a.kcal + c.kcal, protein: a.protein + c.protein, carbs: a.carbs + c.carbs, fat: a.fat + c.fat, fiber: a.fiber + c.fiber, sugar: a.sugar + c.sugar }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0 })
  const res = { kcal: (item.kcal || 0) - sum.kcal, protein: _r1((item.protein || 0) - sum.protein), carbs: _r1((item.carbs || 0) - sum.carbs), fat: _r1((item.fat || 0) - sum.fat), fiber: _r1((item.fiber || 0) - sum.fiber), sugar: _r1((item.sugar || 0) - sum.sugar) }
  if (res.kcal > 1 || res.protein > 0.5 || res.carbs > 0.5 || res.fat > 0.5 || res.fiber > 0.5 || res.sugar > 0.5) {
    comps.unshift({ id: 'base', name: 'Base', unit: 'serving', default: 1, ...res })
  }
  return comps
}

// Build a log entry from a pantry item (denormalized macros + timestamp).
export function entryFromItem(item, ts, qty = 1) {
  const q = qty > 0 ? qty : 1
  const r = (n) => Math.round((n || 0) * q * 10) / 10
  return { id: item.id, name: item.name,
    portion: q === 1 ? item.portion : `${q} × ${item.portion}`,
    qty: q,
    kcal: Math.round((item.kcal || 0) * q),
    protein: r(item.protein), carbs: r(item.carbs), fat: r(item.fat), fiber: r(item.fiber), sugar: r(item.sugar),
    provisional: !!item.provisional, unhealthy: isUnhealthy(item), meal: mealForTime(new Date(ts)), ts }
}

// Auto-categorize a food by the time it was logged — no manual meal assignment.
// Breakfast 7:30–10:30, lunch 11:30–2:30, dinner 5:30–7:30; anything else = snack.
export const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snack']
export const MEAL_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' }
export function mealForTime(date) {
  const h = date.getHours() + date.getMinutes() / 60
  if (h >= 7.5 && h < 10.5) return 'breakfast'
  if (h >= 11.5 && h < 14.5) return 'lunch'
  if (h >= 17.5 && h < 19.5) return 'dinner'
  return 'snack'
}
