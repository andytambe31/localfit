/* ---------- pantry stock + groceries (pure) ---------------------------------
 * A light stock layer over the pantry: each item is Stocked / Low / Out. The
 * shopping list falls out of what's Low or Out; a restock nudge fires on the
 * grocery cadence (every N days) or the moment anything goes Out.
 *
 * Stock lives under `profile.stock` (a { [itemId]: level } map), NOT a new
 * top-level field — the server merge only preserves profile/days/logs/pantry,
 * so anything top-level would be dropped on sync. Same for lastHaulDate +
 * groceryCadenceDays. Unset stock reads as 'stocked' (assume you have it).
 * -------------------------------------------------------------------------- */
import { effectivePantry, groupOf, GROUP_ORDER } from './diet'

// A raw ingredient you actually buy/stock — NOT a composed dish. Meals (their own
// category), ingredient-combos, and multi-part custom builds are excluded so the
// pantry/shopping list shows groceries, not recipes.
const MEAL_CATS = new Set(['homemade_meal', 'office_food', 'restaurant_meal'])
export function isRawIngredient(it) {
  if (!it) return false
  if (MEAL_CATS.has(it.category)) return false   // homemade / office / restaurant meals
  if (it.ingredients?.length) return false        // combos built from other items
  if ((it.mods?.length || 0) >= 2) return false   // multi-part custom dishes
  return true
}

// --- the grocery catalog ----------------------------------------------------
// A DELIBERATE, curated list of raw ingredients you buy & cook with — distinct
// from the food-log menu (DEFAULT_PANTRY), which exists for fast diary logging
// and includes meals, drinks, restaurant items, snacks. Grocery ids match the
// ingredient ids recipes reference, so shopping and cooking stay connected.
// aisle drives the shopping-list grouping; perishability drives the pantry tiers.
export const GROCERY_CATALOG = [
  // Protein
  { id: 'chicken_breast', name: 'Chicken Breast', aisle: 'Protein', perishability: 'fridge' },
  { id: 'chicken_thigh',  name: 'Chicken Thigh',  aisle: 'Protein', perishability: 'fridge' },
  { id: 'ground_turkey',  name: 'Lean Ground Turkey', aisle: 'Protein', perishability: 'fridge', staple: true },
  { id: 'lean_beef_93',   name: '93% Lean Beef',  aisle: 'Protein', perishability: 'fridge', staple: true },
  { id: 'salmon',         name: 'Salmon',         aisle: 'Protein', perishability: 'fresh',  staple: true },
  { id: 'shrimp',         name: 'Shrimp',         aisle: 'Protein', perishability: 'fridge', staple: true },
  { id: 'canned_tuna',    name: 'Canned Tuna',    aisle: 'Protein', perishability: 'stable', staple: true },
  { id: 'sardines',       name: 'Sardines',       aisle: 'Protein', perishability: 'stable', staple: true },
  { id: 'tofu',           name: 'Firm Tofu',      aisle: 'Protein', perishability: 'fridge', staple: true },
  { id: 'egg',            name: 'Eggs',           aisle: 'Protein', perishability: 'fridge' },
  { id: 'egg_whites',     name: 'Egg Whites',     aisle: 'Protein', perishability: 'fridge', staple: true },
  // Dairy
  { id: 'cottage_cheese', name: 'Cottage Cheese', aisle: 'Dairy', perishability: 'fridge' },
  { id: 'fage_total_0',   name: 'Fage Total 0%',  aisle: 'Dairy', perishability: 'fridge' },
  { id: 'oikos_triple_zero', name: 'Oikos Triple Zero', aisle: 'Dairy', perishability: 'fridge' },
  { id: 'whole_milk',     name: 'Whole Milk',     aisle: 'Dairy', perishability: 'fridge' },
  { id: 'oat_milk',       name: 'Oat Milk',       aisle: 'Dairy', perishability: 'fridge' },
  // Grains & legumes
  { id: 'rolled_oats',    name: 'Rolled Oats',    aisle: 'Grains', perishability: 'stable', staple: true },
  { id: 'quinoa',         name: 'Quinoa',         aisle: 'Grains', perishability: 'stable', staple: true },
  { id: 'brown_rice',     name: 'Brown Rice',     aisle: 'Grains', perishability: 'stable', staple: true },
  { id: 'red_lentils',    name: 'Red Lentils',    aisle: 'Grains', perishability: 'stable', staple: true },
  { id: 'chickpeas',      name: 'Chickpeas',      aisle: 'Grains', perishability: 'stable', staple: true },
  // Produce
  { id: 'broccoli',       name: 'Broccoli',       aisle: 'Produce', perishability: 'fresh' },
  { id: 'spinach',        name: 'Spinach',        aisle: 'Produce', perishability: 'fresh', staple: true },
  { id: 'bell_pepper',    name: 'Bell Pepper',    aisle: 'Produce', perishability: 'fresh', staple: true },
  { id: 'asparagus',      name: 'Asparagus',      aisle: 'Produce', perishability: 'fresh', staple: true },
  { id: 'green_beans',    name: 'Green Beans',    aisle: 'Produce', perishability: 'fresh', staple: true },
  { id: 'mushrooms',      name: 'Mushrooms',      aisle: 'Produce', perishability: 'fresh' },
  { id: 'baby_carrots',   name: 'Baby Carrots',   aisle: 'Produce', perishability: 'fresh' },
  { id: 'sweet_potato',   name: 'Sweet Potato',   aisle: 'Produce', perishability: 'fresh' },
  { id: 'banana',         name: 'Banana',         aisle: 'Produce', perishability: 'fresh' },
  { id: 'blueberries',    name: 'Blueberries',    aisle: 'Produce', perishability: 'fresh' },
  { id: 'strawberries',   name: 'Strawberries',   aisle: 'Produce', perishability: 'fresh' },
  { id: 'raspberries',    name: 'Raspberries',    aisle: 'Produce', perishability: 'fresh' },
  { id: 'blackberries',   name: 'Blackberries',   aisle: 'Produce', perishability: 'fresh' },
  { id: 'avocado',        name: 'Avocado',        aisle: 'Produce', perishability: 'fresh' },
  { id: 'honeycrisp_apple', name: 'Apples',       aisle: 'Produce', perishability: 'fresh' },
  // Pantry & condiments
  { id: 'whey_isolate',   name: 'Whey Isolate',   aisle: 'Pantry', perishability: 'stable', staple: true },
  { id: 'creatine',       name: 'Creatine',       aisle: 'Pantry', perishability: 'stable' },
  { id: 'peanut_butter',  name: 'Peanut Butter',  aisle: 'Pantry', perishability: 'stable', staple: true },
  { id: 'almonds',        name: 'Almonds',        aisle: 'Pantry', perishability: 'stable', staple: true },
  { id: 'chia_seeds',     name: 'Chia Seeds',     aisle: 'Pantry', perishability: 'stable', staple: true },
  { id: 'olive_oil',      name: 'Olive Oil',      aisle: 'Pantry', perishability: 'stable' },
  { id: 'honey',          name: 'Honey',          aisle: 'Pantry', perishability: 'stable' },
  { id: 'sriracha',       name: 'Sriracha',       aisle: 'Pantry', perishability: 'stable' },
  { id: 'soy_sauce',      name: 'Soy Sauce',      aisle: 'Pantry', perishability: 'stable' },
  { id: 'bbq_sauce',      name: 'BBQ Sauce',      aisle: 'Pantry', perishability: 'stable' },
  { id: 'hummus',         name: 'Hummus',         aisle: 'Pantry', perishability: 'fridge' },
]
export const GROCERY_BY_ID = Object.fromEntries(GROCERY_CATALOG.map((g) => [g.id, g]))

export const STOCK_LEVELS = ['stocked', 'low', 'out']
export const STOCK_LABEL = { stocked: 'Stocked', low: 'Low', out: 'Out' }

export function stockLevel(state, id) { return state?.profile?.stock?.[id] || 'stocked' }
// Tap-to-cycle order: stocked -> low -> out -> stocked.
export function cycleStock(level) { return level === 'stocked' ? 'low' : level === 'low' ? 'out' : 'stocked' }

// The shopping list: every grocery currently Low or Out, grouped by aisle.
const AISLE_ORDER = ['Protein', 'Dairy', 'Grains', 'Produce', 'Pantry']
export function shoppingList(state) {
  const stock = state?.profile?.stock || {}
  const need = GROCERY_CATALOG.filter((g) => stock[g.id] === 'low' || stock[g.id] === 'out')
  const groups = {}
  for (const g of need) (groups[g.aisle] ||= []).push({ item: g, level: stock[g.id] })
  return AISLE_ORDER.filter((a) => groups[a]).map((a) => ({ group: a, items: groups[a] }))
}

export function lowCount(state) {
  const stock = state?.profile?.stock || {}
  return GROCERY_CATALOG.filter((g) => stock[g.id] === 'low' || stock[g.id] === 'out').length
}

const _day = (iso) => new Date(iso + 'T00:00:00')

// Restock nudge: due when it's been >= cadence days since the last haul, OR
// anything is Out (a critical item pulls the reminder early).
export function restockDue(state, todayIso) {
  const cadence = state?.profile?.groceryCadenceDays || 3
  const last = state?.profile?.lastHaulDate
  const daysSince = last ? Math.round((_day(todayIso) - _day(last)) / 86400000) : 999
  const out = Object.values(state?.profile?.stock || {}).some((v) => v === 'out')
  const low = lowCount(state)
  return { due: low > 0 && (daysSince >= cadence || out), daysSince, cadence, out, low }
}

// --- perishability: what to stockpile vs buy fresh ---------------------------
// An item's own `perishability` wins; otherwise it's inferred from its category.
// Drives the pantry view's Stockpile / Fridge / Fresh grouping (you restock by
// how long things last, not by food group).
const PERISH_BY_CAT = {
  condiment: 'stable', dip: 'stable', supplement: 'stable', protein_snack: 'stable', beverage: 'stable', dessert: 'stable',
  dairy: 'fridge', dairy_alt: 'fridge', protein: 'fridge', office_food: 'fridge',
  fruit: 'fresh', vegetable: 'fresh', side: 'fresh', homemade_meal: 'fresh', restaurant_meal: 'fresh',
}
export function perishabilityOf(it) { return it?.perishability || PERISH_BY_CAT[it?.category] || 'fridge' }
export const PERISH_TIERS = ['stable', 'fridge', 'fresh']
export const PERISH_META = {
  stable: { label: 'Stockpile', hint: 'shelf-stable · buy in bulk' },
  fridge: { label: 'Fridge / Freezer', hint: 'lasts a week or two' },
  fresh:  { label: 'Fresh', hint: 'perishable · buy often' },
}
