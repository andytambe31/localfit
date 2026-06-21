/* ---------- supplements engine (pure) ---------------------------------------
 * A simple daily supplement stack, folded into the AM/PM routines so it rides on
 * a ritual you already do. Each supplement has a slot (am/pm) and timing note;
 * the planner emits routine-style step cards, and adherence is logged separately
 * from skincare (day.supps.{am,pm}.steps) so it never skews the skincare score.
 *
 * Loose-skin angle: an aggressive cut at a moderate fat range rarely leaves real
 * loose skin — muscle retention (lifting), protein, hydration and time do the
 * heavy lifting. Collagen peptides + vitamin C is the one supplement combo with
 * real dermal-collagen support, so it's seeded here.
 * -------------------------------------------------------------------------- */

// slot: 'am' | 'pm'. `withFood` => take it with a meal. `for` = what it serves.
export const SUPPLEMENTS = [
  { id: 'multivitamin', name: 'Multivitamin', slot: 'am', withFood: true, for: ['general'],
    instruction: 'One-a-day multivitamin with breakfast — covers the micronutrient gaps a calorie deficit tends to open up.' },
  { id: 'collagen_c', name: 'Collagen + Vitamin C', slot: 'am', withFood: true, for: ['skin', 'loose-skin'],
    instruction: 'Collagen peptides with vitamin C — the C is what lets your body actually build the collagen. This is your skin-firmness play as you lean out; consistency matters more than dose.' },
  { id: 'hair_supp', name: 'Hair supplement', slot: 'am', withFood: true, for: ['hair'],
    instruction: 'Biotin, saw palmetto and collagen with food — feeds the hair work you do at the scalp.' },
  { id: 'omega3', name: 'Omega-3 (fish oil)', slot: 'am', withFood: true, for: ['skin', 'recovery'],
    instruction: 'Fish oil with a meal — supports the skin barrier, joints and recovery while you train hard on a deficit.' },
  { id: 'vitd3', name: 'Vitamin D3', slot: 'am', withFood: true, for: ['general'],
    instruction: 'Vitamin D3 with breakfast — most people run low; it backs mood, immunity and recovery.' },
  { id: 'magnesium', name: 'Magnesium glycinate', slot: 'pm', withFood: false, for: ['sleep', 'recovery'],
    instruction: 'Magnesium glycinate before bed — eases into sleep and helps muscles recover overnight.' },
]
export const SUPP_BY_ID = Object.fromEntries(SUPPLEMENTS.map((s) => [s.id, s]))
export const DEFAULT_SUPPS = SUPPLEMENTS.map((s) => s.id)

// The coach line on loose skin — surfaced on the body-fat goal during the cut.
export const LOOSE_SKIN_NOTE =
  "Cutting hard is fine — real loose skin is unlikely at this fat range. Your protection is the muscle you're keeping (lift + protein), hydration, and time; collagen + vitamin C in your morning routine backs it up."

const toStep = (s) => ({
  id: s.id, title: s.name, instruction: s.instruction,
  tag: 'Supplement', kind: 'supplement', withFood: !!s.withFood, slot: s.slot,
})

// Seeded stack plus any custom supplements the user added in the manage screen.
export function allSupps(state) {
  const custom = state?.profile?.supps?.custom
  return [...SUPPLEMENTS, ...(Array.isArray(custom) ? custom : [])]
}

// Enabled supplements for this profile (defaults to the full seeded stack).
function enabledSupps(state) {
  const en = state?.profile?.supps?.enabled
  const set = new Set(Array.isArray(en) ? en : DEFAULT_SUPPS)
  return allSupps(state).filter((s) => set.has(s.id))
}

// Routine-style supplement cards per slot, appended to the AM/PM skincare flow.
export function suppPlanForDay(dateIso, state) {
  const list = enabledSupps(state)
  return {
    am: list.filter((s) => s.slot === 'am' || s.slot === 'both').map(toStep),
    pm: list.filter((s) => s.slot === 'pm' || s.slot === 'both').map(toStep),
  }
}

// What's still pending today, for the tile/coach. Read from day.supps logs.
export function suppsDue(dateIso, state) {
  const day = state.days?.[dateIso] || {}
  const plan = suppPlanForDay(dateIso, state)
  const taken = (slot) => {
    const steps = day.supps?.[slot]?.steps || {}
    return plan[slot].filter((s) => steps[s.id] === 'done').length
  }
  return {
    amPending: plan.am.length > 0 && taken('am') < plan.am.length,
    pmPending: plan.pm.length > 0 && taken('pm') < plan.pm.length,
    amCount: plan.am.length, pmCount: plan.pm.length,
    amTaken: taken('am'), pmTaken: taken('pm'),
  }
}
