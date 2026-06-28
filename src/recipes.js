/* ---------- recipe library (pure) -------------------------------------------
 * An authored library of recipes built FROM the pantry. Each recipe references
 * pantry item ids for its ingredients (qty = multiplier of that item's stated
 * portion) so macros derive from one source of truth, and adds the cooking
 * metadata: meal slots, location, time, complexity, and step-by-step method.
 * The suggestion engine and the guided RecipeFlow read from here.
 *
 * No runtime AI — the library is curated. "Variety" = filtering/ranking these
 * by what's in stock, the remaining macro gap, location, and time available.
 * -------------------------------------------------------------------------- */
import { DEFAULT_PANTRY, pantryFor, dayTotals, calorieTarget, PROTEIN_TARGET_DEFAULT } from './diet'

const BY_ID = Object.fromEntries(DEFAULT_PANTRY.map((it) => [it.id, it]))

// Time is stored in minutes; bucket it for the "I've got 15 minutes" filter.
//   quick <= 10 · medium 11-25 · involved > 25
export function timeBucket(min) { return min <= 10 ? 'quick' : min <= 25 ? 'medium' : 'involved' }
export const TIME_BUCKET_LABEL = { quick: 'Quick', medium: 'Medium', involved: 'Involved' }
export const COMPLEXITY = ['easy', 'medium', 'involved']

// ingredients: [{ id, qty }] — id is a pantry item, qty multiplies its portion.
// meals: which slots it suits · loc: where you can make it · timeMin · complexity.
export const RECIPES = [
  { id: 'cajun_chicken_sweet_potato', name: 'Cajun Chicken & Sweet Potato', loc: 'home',
    meals: ['lunch', 'dinner'], timeMin: 25, complexity: 'easy', tags: ['high-protein', 'recomp'],
    ingredients: [{ id: 'chicken_thigh', qty: 1.5 }, { id: 'air_fried_sweet_potato', qty: 1 }, { id: 'bbq_sauce', qty: 1 }],
    steps: [
      'Pat the thighs dry; rub with cajun spice, salt, a little olive oil.',
      'Air-fry or pan-sear the thighs ~18 min at 200°C, flipping once, to 74°C internal.',
      'Air-fry the sweet potato alongside until the edges crisp.',
      'Rest the chicken 3 min, slice, plate with the sweet potato, finish with BBQ sauce.',
    ] },
  { id: 'protein_egg_bowl', name: 'High-Protein Egg Bowl', loc: 'home',
    meals: ['breakfast', 'lunch'], timeMin: 15, complexity: 'easy', tags: ['high-protein'],
    ingredients: [{ id: 'egg', qty: 3 }, { id: 'cottage_cheese', qty: 8 }, { id: 'air_fried_sweet_potato', qty: 1 }],
    steps: [
      'Soft-scramble the eggs over low heat — pull them while still glossy.',
      'Warm the air-fried sweet potato.',
      'Build the bowl: sweet potato base, eggs on top, cottage cheese alongside.',
      'Season with salt, pepper, chili flakes.',
    ] },
  { id: 'stirfry_chicken_veg', name: 'Stir-Fried Chicken & Veg', loc: 'home',
    meals: ['lunch', 'dinner'], timeMin: 20, complexity: 'medium', tags: ['high-protein', 'low-cal'],
    ingredients: [{ id: 'chicken_breast', qty: 1.5 }, { id: 'broccoli', qty: 1.5 }, { id: 'mushrooms', qty: 1 }, { id: 'sriracha', qty: 1 }, { id: 'soy_sauce', qty: 1 }],
    steps: [
      'Cube the chicken; sear hard in a hot pan until just cooked, set aside.',
      'Stir-fry broccoli and mushrooms with a splash of water to steam-crisp.',
      'Return the chicken; toss with soy sauce and sriracha for 1 min.',
      'Serve hot — high protein, low calorie, big volume.',
    ] },
  { id: 'berries_yogurt_bowl', name: 'Berries & Greek Yogurt Bowl', loc: 'home',
    meals: ['breakfast', 'snack'], timeMin: 5, complexity: 'easy', tags: ['high-protein', 'fiber'],
    ingredients: [{ id: 'fage_total_0', qty: 2 }, { id: 'blueberries', qty: 0.5 }, { id: 'strawberries', qty: 0.5 }, { id: 'raspberries', qty: 0.5 }, { id: 'honey', qty: 1 }],
    steps: [
      'Spoon the Fage into a bowl.',
      'Top with the berries.',
      'Drizzle a teaspoon of honey. Done.',
    ] },
  { id: 'cottage_cheese_omelette', name: 'Cottage Cheese Omelette', loc: 'home',
    meals: ['breakfast'], timeMin: 10, complexity: 'easy', tags: ['high-protein'],
    ingredients: [{ id: 'egg', qty: 3 }, { id: 'cottage_cheese', qty: 8 }, { id: 'bbq_sauce', qty: 1 }],
    steps: [
      'Beat the eggs; pour into a warm non-stick pan.',
      'When half-set, spoon the cottage cheese down the middle.',
      'Fold, finish on low until set, slide out.',
      'Streak with BBQ sauce.',
    ] },
  { id: 'whey_banana_shake', name: 'Whey & Banana Recovery Shake', loc: 'both',
    meals: ['snack'], timeMin: 3, complexity: 'easy', tags: ['high-protein', 'post-workout'],
    ingredients: [{ id: 'whey_isolate', qty: 2 }, { id: 'banana', qty: 1 }, { id: 'oat_milk', qty: 1 }, { id: 'peanut_butter', qty: 1 }],
    steps: [
      'Add oat milk, whey, banana and peanut butter to a shaker or blender.',
      'Blend or shake hard with ice until smooth.',
      'Drink within the post-training window.',
    ] },
  { id: 'potato_chicken_plate', name: 'Air-Fried Potato & Chicken', loc: 'home',
    meals: ['lunch', 'dinner'], timeMin: 25, complexity: 'easy', tags: ['high-protein'],
    ingredients: [{ id: 'chicken_breast', qty: 1.5 }, { id: 'air_fried_potato', qty: 1.5 }, { id: 'sriracha', qty: 1 }],
    steps: [
      'Season the chicken; sear 5–6 min per side to 74°C, then rest.',
      'Air-fry the potato slices until golden, ~15 min, shaking halfway.',
      'Slice the chicken, plate with the potatoes, hit with sriracha.',
    ] },
  { id: 'office_chicken_rice_bowl', name: 'Office Grilled Chicken Rice Bowl', loc: 'office',
    meals: ['lunch'], timeMin: 5, complexity: 'easy', tags: ['high-protein', 'assemble'],
    ingredients: [{ id: 'office_grilled_chicken', qty: 1.5 }, { id: 'white_rice', qty: 1 }, { id: 'hummus', qty: 1 }],
    steps: [
      'Rice as the base.',
      'Pile the grilled chicken on top.',
      'Spoon hummus over, season. No cooking — assemble and go.',
    ] },
  { id: 'tzatziki_chicken_carrots', name: 'Tzatziki Chicken & Carrots', loc: 'office',
    meals: ['lunch', 'snack'], timeMin: 5, complexity: 'easy', tags: ['high-protein', 'low-cal', 'assemble'],
    ingredients: [{ id: 'office_grilled_chicken', qty: 1.5 }, { id: 'tzatziki', qty: 2 }, { id: 'baby_carrots', qty: 1 }],
    steps: [
      'Plate the grilled chicken with the baby carrots.',
      'Tzatziki on the side for dipping.',
      'Lean, high-protein, no kitchen needed.',
    ] },
  { id: 'indian_chicken_broccoli', name: 'Indian-Style Chicken & Broccoli', loc: 'home',
    meals: ['dinner'], timeMin: 30, complexity: 'medium', tags: ['high-protein'],
    ingredients: [{ id: 'chicken_breast', qty: 1.5 }, { id: 'broccoli', qty: 1.5 }, { id: 'olive_oil', qty: 1 }],
    steps: [
      'Marinate the chicken in yogurt, ginger-garlic, chilli, turmeric, garam masala (15 min if you can).',
      'Sear in olive oil over high heat until charred at the edges and cooked through.',
      'Steam or blister the broccoli; toss with the pan spices.',
      'Plate together; finish with lemon.',
    ] },
  { id: 'cottage_cheese_fruit_bowl', name: 'Cottage Cheese & Fruit Bowl', loc: 'home',
    meals: ['breakfast', 'snack'], timeMin: 5, complexity: 'easy', tags: ['high-protein'],
    ingredients: [{ id: 'cottage_cheese', qty: 8 }, { id: 'banana', qty: 1 }, { id: 'blueberries', qty: 0.5 }, { id: 'peanut_butter', qty: 1 }],
    steps: [
      'Cottage cheese in a bowl.',
      'Slice the banana over it, add blueberries.',
      'Swirl in a tablespoon of peanut butter.',
    ] },
  { id: 'avocado_egg_scramble', name: 'Avocado Egg Scramble', loc: 'home',
    meals: ['breakfast'], timeMin: 12, complexity: 'easy', tags: ['healthy-fats'],
    ingredients: [{ id: 'egg', qty: 3 }, { id: 'avocado', qty: 0.5 }, { id: 'sriracha', qty: 1 }],
    steps: [
      'Soft-scramble the eggs over low heat.',
      'Slice the avocado onto the plate.',
      'Eggs alongside, sriracha over the top, salt and pepper.',
    ] },
  { id: 'sweet_potato_cottage_cheese', name: 'Sweet Potato & Cottage Cheese', loc: 'home',
    meals: ['snack'], timeMin: 10, complexity: 'easy', tags: ['high-protein', 'fiber'],
    ingredients: [{ id: 'air_fried_sweet_potato', qty: 1 }, { id: 'cottage_cheese', qty: 8 }, { id: 'honey', qty: 1 }],
    steps: [
      'Warm the air-fried sweet potato; split it open.',
      'Spoon cottage cheese over the top.',
      'Finish with a thread of honey and cinnamon.',
    ] },
  { id: 'office_steak_veg', name: 'Office Beef & Carrots', loc: 'office',
    meals: ['lunch', 'dinner'], timeMin: 5, complexity: 'easy', tags: ['high-protein', 'assemble'],
    ingredients: [{ id: 'office_beef', qty: 1.5 }, { id: 'baby_carrots', qty: 1 }, { id: 'tzatziki', qty: 1 }],
    steps: [
      'Plate the beef with the carrots.',
      'Tzatziki on the side.',
      'Heavy protein, minimal carbs — a lean office default.',
    ] },
]

export const RECIPE_BY_ID = Object.fromEntries(RECIPES.map((r) => [r.id, r]))

// Office-day lunches: a curated rotation of healthy spots a short walk / quick
// pickup from the office (141 Portland St → Kendall Sq). No cooking — pick one
// and order the prescribed build. Macros are estimates for THAT optimized order
// (build-your-own, so they vary with toppings). Confirmed open as of June 2026.
export const OFFICE_LUNCH = [
  { id: 'cava_bowl', name: 'CAVA — Chicken Greens+Grains Bowl', restaurant: 'CAVA', address: '82 Ames St', loc: 'office', meals: ['lunch'],
    order: 'Greens + grains base · double grilled chicken · hummus · tomato + cucumber · pickled onion · tzatziki. Skip the pita.',
    macros: { kcal: 600, protein: 48, carbs: 40, fat: 26, fiber: 9, sugar: 6 } },
  { id: 'naya_bowl', name: 'NAYA — Double Chicken Shawarma Bowl', restaurant: 'NAYA', address: '355 Main St', loc: 'office', meals: ['lunch'],
    order: 'Greens or rice base · double chicken shawarma · hummus · salad toppings · light garlic/tahini.',
    macros: { kcal: 580, protein: 50, carbs: 38, fat: 24, fiber: 8, sugar: 5 } },
  { id: 'sweetgreen_plate', name: 'Sweetgreen — Chicken Protein Plate', restaurant: 'Sweetgreen', address: '201 Galileo Galilei Way', loc: 'office', meals: ['lunch'],
    order: 'Grilled/blackened chicken over warm grains + greens · roasted veg · light dressing. Skip the heavy hot-honey/avocado load.',
    macros: { kcal: 550, protein: 43, carbs: 45, fat: 22, fiber: 10, sugar: 8 } },
  { id: 'aceituna_bowl', name: 'Aceituna Grill — Chicken Shawarma Bowl', restaurant: 'Aceituna Grill', address: 'Kendall Sq', loc: 'office', meals: ['lunch'],
    order: 'Salad or rice base · chicken shawarma · hummus · salad + veg. Go easy on the sauces.',
    macros: { kcal: 600, protein: 42, carbs: 45, fat: 26, fiber: 7, sugar: 6 } },
  { id: 'shybird_plate', name: 'Shy Bird — Rotisserie Chicken Plate', restaurant: 'Shy Bird', address: 'Kendall Sq', loc: 'office', meals: ['lunch'],
    order: 'Rotisserie chicken · a salad + one veg side. Skip the fries.',
    macros: { kcal: 520, protein: 46, carbs: 25, fat: 28, fiber: 6, sugar: 5 } },
]
export const OFFICE_LUNCH_BY_ID = Object.fromEntries(OFFICE_LUNCH.map((r) => [r.id, r]))

// Sum macros from the referenced pantry items (× qty). `pantry` optional — pass
// effectivePantry(state) so user-edited macros win; falls back to the seed.
// Restaurant orders carry explicit `macros` (no pantry ingredients) — use those.
export function recipeMacros(recipe, pantry) {
  if (recipe.macros) return recipe.macros
  const byId = pantry ? Object.fromEntries(pantry.map((it) => [it.id, it])) : BY_ID
  const m = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0 }
  for (const ing of recipe.ingredients || []) {
    const it = byId[ing.id]; if (!it) continue
    const q = ing.qty || 1
    m.kcal += (it.kcal || 0) * q; m.protein += (it.protein || 0) * q; m.carbs += (it.carbs || 0) * q
    m.fat += (it.fat || 0) * q; m.fiber += (it.fiber || 0) * q; m.sugar += (it.sugar || 0) * q
  }
  const r1 = (n) => Math.round(n * 10) / 10
  return { kcal: Math.round(m.kcal), protein: r1(m.protein), carbs: r1(m.carbs), fat: r1(m.fat), fiber: r1(m.fiber), sugar: r1(m.sugar) }
}

// Editable components for the RecipeFlow / buildFromComponents (each holds the
// macros for its default qty, so the flow can scale a part up or down on the fly).
export function recipeComponents(recipe, pantry) {
  const byId = pantry ? Object.fromEntries(pantry.map((it) => [it.id, it])) : BY_ID
  const r1 = (n) => Math.round(n * 10) / 10
  return (recipe.ingredients || []).map((ing) => {
    const it = byId[ing.id] || {}; const q = ing.qty || 1
    return { id: ing.id, name: it.name || ing.id, unit: '×portion', default: q,
      kcal: Math.round((it.kcal || 0) * q), protein: r1((it.protein || 0) * q), carbs: r1((it.carbs || 0) * q),
      fat: r1((it.fat || 0) * q), fiber: r1((it.fiber || 0) * q), sugar: r1((it.sugar || 0) * q) }
  })
}

// Which seed ingredients a recipe still needs that aren't available (placeholder
// until the stock layer lands — for now everything seed-known counts as present).
export function recipeIngredientNames(recipe, pantry) {
  const byId = pantry ? Object.fromEntries(pantry.map((it) => [it.id, it])) : BY_ID
  return (recipe.ingredients || []).map((ing) => (byId[ing.id]?.name) || ing.id)
}

// Suggest recipes for right now: filter by location + (optional) meal slot +
// time budget, then rank by how much of the remaining protein gap they close
// without blowing the calorie ceiling. Goal-aware, not a random list.
export function suggestRecipes(state, dateIso, { loc = 'home', meal, maxTime, limit = 3 } = {}) {
  const day = state.days?.[dateIso] || {}
  const totals = dayTotals(day)
  const proteinTarget = state.profile?.proteinTarget || PROTEIN_TARGET_DEFAULT
  const gap = Math.max(0, proteinTarget - totals.protein)
  const ct = calorieTarget(state)
  const kcalLeft = ct ? ct.ceiling - totals.kcal : Infinity
  const atLoc = (r) => r.loc === loc || r.loc === 'both'

  const scored = RECIPES
    .filter(atLoc)
    .filter((r) => !meal || (r.meals || []).includes(meal))
    .filter((r) => maxTime == null || r.timeMin <= maxTime)
    .map((r) => {
      const m = recipeMacros(r, undefined)
      // protein toward the gap, penalized for overshooting the calorie room.
      const fits = m.kcal <= kcalLeft + 80
      const protScore = gap > 0 ? Math.min(m.protein, gap) / gap : m.protein / proteinTarget
      const over = m.kcal > kcalLeft ? (m.kcal - kcalLeft) / 400 : 0
      return { recipe: r, macros: m, score: protScore - over + (fits ? 0.1 : 0) }
    })
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}
