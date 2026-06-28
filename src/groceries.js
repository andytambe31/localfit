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

export const STOCK_LEVELS = ['stocked', 'low', 'out']
export const STOCK_LABEL = { stocked: 'Stocked', low: 'Low', out: 'Out' }

export function stockLevel(state, id) { return state?.profile?.stock?.[id] || 'stocked' }
// Tap-to-cycle order: stocked -> low -> out -> stocked.
export function cycleStock(level) { return level === 'stocked' ? 'low' : level === 'low' ? 'out' : 'stocked' }

// The shopping list: every item currently Low or Out, grouped by pantry group
// (Protein / Fruit / Veg / …) in display order. Each entry carries its level.
export function shoppingList(state) {
  const stock = state?.profile?.stock || {}
  const need = effectivePantry(state).filter((it) => stock[it.id] === 'low' || stock[it.id] === 'out')
  const groups = {}
  for (const it of need) { const g = groupOf(it); (groups[g] ||= []).push({ item: it, level: stock[it.id] }) }
  return GROUP_ORDER.filter((g) => groups[g]).map((g) => ({ group: g, items: groups[g] }))
}

export function lowCount(state) {
  return Object.values(state?.profile?.stock || {}).filter((v) => v === 'low' || v === 'out').length
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
