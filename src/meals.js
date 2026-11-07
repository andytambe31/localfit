/* ---------- program meal library + weekly plan (pure) -----------------------
 * The transformation program's reusable meal templates (A–G) and the default
 * 7-day meal plan. All macros are ESTIMATES until verified against real labels —
 * every template carries `estimate: true`, and the UI never claims the plan meets
 * a target until planDayTotals is actually computed against it.
 *
 * Templates are kept simple (name, slot, estimated macros, an ingredient list) so
 * logging one just drops a diary entry; the existing food logger then lets you edit
 * portions. The weekly plan (profile.mealPlan) is fully editable — swap any slot.
 *
 * Pure: data + helpers, no imports.
 * -------------------------------------------------------------------------- */

// Meals A–G. `slots` = which meal slots it suits. Macros are per the stated
// portions and are estimates. `customizable` meals (Sweetgreen) carry a rough
// estimate the user is expected to refine against the real order.
export const MEAL_LIBRARY = {
  A: { id: 'A', letter: 'A', name: 'Eggs & Toast', slots: ['breakfast'], estimate: true,
    kcal: 360, protein: 34, carbs: 28, fat: 11, fiber: 5,
    ingredients: ['2 whole eggs', '150 g egg whites', '1 slice whole-wheat bread', '100 g berries'] },
  B: { id: 'B', letter: 'B', name: 'Chicken Rice Bowl', slots: ['lunch', 'dinner'], estimate: true,
    kcal: 670, protein: 61, carbs: 64, fat: 17, fiber: 7,
    ingredients: ['170 g cooked chicken breast', '180 g cooked rice', '200 g mixed vegetables', '10 g olive oil'] },
  C: { id: 'C', letter: 'C', name: 'Chicken & Potatoes', slots: ['lunch', 'dinner'], estimate: true,
    kcal: 650, protein: 61, carbs: 63, fat: 17, fiber: 11,
    ingredients: ['170 g cooked chicken breast', '250 g potatoes', '200 g vegetables', 'Measured cooking oil'] },
  D: { id: 'D', letter: 'D', name: 'Yogurt Snack', slots: ['snack'], estimate: true,
    kcal: 225, protein: 16, carbs: 35, fat: 1, fiber: 3,
    ingredients: ['1 Oikos protein yogurt', '1 banana'] },
  E: { id: 'E', letter: 'E', name: 'Chicken Wrap', slots: ['lunch', 'dinner'], estimate: true,
    kcal: 460, protein: 52, carbs: 33, fat: 11, fiber: 4,
    ingredients: ['150 g cooked chicken breast', '1 whole-wheat wrap', 'Lettuce', 'Tomatoes', 'Measured sauce'] },
  F: { id: 'F', letter: 'F', name: 'Oats Breakfast', slots: ['breakfast'], estimate: true,
    kcal: 420, protein: 35, carbs: 53, fat: 7, fiber: 8,
    ingredients: ['50 g oats', '1 serving protein powder', '100 g berries', 'Milk or water'] },
  G: { id: 'G', letter: 'G', name: 'Sweetgreen Hot Honey Chicken', slots: ['lunch', 'dinner'], estimate: true, customizable: true,
    kcal: 700, protein: 45, carbs: 60, fat: 30, fiber: 8,
    ingredients: ['Hot Honey Chicken bowl — base, chicken, toppings, dressing'],
    note: 'Restaurant meal — estimate only. Edit the portions/ingredients against your actual order.' },
}

export const MEAL_LIST = Object.values(MEAL_LIBRARY)
export const SLOTS = ['breakfast', 'lunch', 'snack', 'dinner']
export const SLOT_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', snack: 'Snack', dinner: 'Dinner' }

// Default 7-day plan (weekday 0=Sun..6=Sat), from the program's meal plan.
export const WEEKLY_MEAL_PLAN_DEFAULT = {
  1: { breakfast: 'A', lunch: 'B', snack: 'D', dinner: 'C' }, // Mon
  2: { breakfast: 'F', lunch: 'G', snack: 'D', dinner: 'B' }, // Tue
  3: { breakfast: 'A', lunch: 'G', snack: 'D', dinner: 'E' }, // Wed
  4: { breakfast: 'F', lunch: 'B', snack: 'D', dinner: 'C' }, // Thu
  5: { breakfast: 'A', lunch: 'B', snack: 'D', dinner: 'B' }, // Fri
  6: { breakfast: 'A', lunch: 'E', snack: 'D', dinner: 'C' }, // Sat
  0: { breakfast: 'F', lunch: 'B', snack: 'D', dinner: 'C' }, // Sun
}

export const mealById = (id) => MEAL_LIBRARY[id] || null

export function planFor(profile) {
  return { ...WEEKLY_MEAL_PLAN_DEFAULT, ...(profile?.mealPlan || {}) }
}

// The planned meals for an ISO date, as [{ slot, meal }] in slot order.
export function mealPlanForDate(profile, iso) {
  const wd = new Date(iso + 'T00:00:00').getDay()
  const day = planFor(profile)[wd] || {}
  return SLOTS.map((slot) => ({ slot, meal: mealById(day[slot]) })).filter((r) => r.meal)
}

// Computed totals for a planned day — the honest sum, not a claim. Returns the
// macro totals plus whether each target is actually met (computed, not asserted).
export function planDayTotals(profile, iso, targets) {
  const rows = mealPlanForDate(profile, iso)
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
  for (const { meal } of rows) {
    t.kcal += meal.kcal || 0; t.protein += meal.protein || 0; t.carbs += meal.carbs || 0
    t.fat += meal.fat || 0; t.fiber += meal.fiber || 0
  }
  const r = (n) => Math.round(n)
  const totals = { kcal: r(t.kcal), protein: r(t.protein), carbs: r(t.carbs), fat: r(t.fat), fiber: r(t.fiber) }
  const meets = targets ? {
    protein: totals.protein >= targets.protein,
    kcalInRange: totals.kcal >= (targets.kcalMin || targets.kcal - 100) && totals.kcal <= (targets.kcalMax || targets.kcal + 50),
    fiber: totals.fiber >= (targets.fiberMin || 25),
  } : null
  return { rows, totals, meets, estimate: true }
}

// Build a diary food entry from a meal template (for logging it to the day).
export function mealEntry(meal, slot, ts) {
  return {
    id: `meal_${meal.id}`, name: meal.name, meal: slot, ts: ts || Date.now(),
    kcal: meal.kcal || 0, protein: meal.protein || 0, carbs: meal.carbs || 0, fat: meal.fat || 0,
    fiber: meal.fiber || 0, sugar: 0, provisional: !!meal.estimate, fromPlan: true,
  }
}

// Which grocery-catalog items each meal needs (ids match groceries.js GROCERY_CATALOG).
// Used to generate a shopping list from the plan. Sweetgreen (G) needs nothing bought.
export const MEAL_GROCERIES = {
  A: ['egg', 'egg_whites', 'whole_wheat_bread', 'blueberries'],
  B: ['chicken_breast', 'white_rice', 'broccoli', 'olive_oil'],
  C: ['chicken_breast', 'potato', 'broccoli', 'olive_oil'],
  D: ['oikos_triple_zero', 'banana'],
  E: ['chicken_breast', 'whole_wheat_wrap', 'romaine_lettuce', 'tomato'],
  F: ['rolled_oats', 'whey_isolate', 'strawberries', 'oat_milk'],
  G: [],
}

const p2 = (n) => String(n).padStart(2, '0')
const isoOf = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`

// Grocery items the plan needs over `days` days from startIso, as
// [{ groceryId, servings }] — servings = how many planned meals use that item,
// a serving-count proxy for quantity. The UI resolves names/stock and lets the
// user check off, edit, or substitute.
export function weeklyGroceryPlan(profile, startIso, days = 7) {
  const counts = {}
  const d0 = new Date(startIso + 'T00:00:00')
  for (let i = 0; i < days; i++) {
    const iso = isoOf(new Date(d0.getTime() + i * 86400000))
    for (const { meal } of mealPlanForDate(profile, iso)) {
      for (const g of (MEAL_GROCERIES[meal.id] || [])) counts[g] = (counts[g] || 0) + 1
    }
  }
  return Object.entries(counts).map(([groceryId, servings]) => ({ groceryId, servings })).sort((a, b) => b.servings - a.servings)
}
