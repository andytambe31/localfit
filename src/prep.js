/* ---------- meal-prep checklists (pure) -------------------------------------
 * Sunday (full prep) and Wednesday (restock + midweek prep) checklists, straight
 * from the program. Checked items persist to day.prep[key][itemId]. Storage notes
 * stay inside safe-handling guidance — never "keep cooked food for a week".
 * Pure: data + a tiny date helper.
 * -------------------------------------------------------------------------- */

export const SUNDAY_PREP = [
  { id: 'review', text: "Review the week's meals" },
  { id: 'list', text: 'Generate the grocery list' },
  { id: 'shop', text: 'Shop for ingredients' },
  { id: 'chicken', text: 'Batch-cook the chicken' },
  { id: 'rice', text: 'Cook the rice' },
  { id: 'veg', text: 'Prep the vegetables' },
  { id: 'portion', text: 'Portion meals into containers' },
  { id: 'store', text: 'Refrigerate or freeze appropriately' },
  { id: 'snacks', text: 'Pack the office snacks' },
]

export const WEDNESDAY_PREP = [
  { id: 'check', text: 'Check remaining ingredients' },
  { id: 'restock', text: "Restock what's low or out" },
  { id: 'prep', text: 'Prepare Thursday & Friday meals' },
]

export const STORAGE_NOTES = [
  'Cooked chicken and rice: refrigerate within 2 hours; eat within 3–4 days.',
  "Freeze anything you won't eat within ~4 days; thaw in the fridge overnight.",
  "Cool food before sealing containers so steam doesn't speed spoilage.",
]

// The prep checklist for a given date (Sunday / Wednesday), or null.
export function prepForDay(iso) {
  const wd = new Date(iso + 'T00:00:00').getDay()
  if (wd === 0) return { key: 'sunday', title: 'Sunday meal prep', items: SUNDAY_PREP }
  if (wd === 3) return { key: 'wednesday', title: 'Wednesday restock & prep', items: WEDNESDAY_PREP }
  return null
}
