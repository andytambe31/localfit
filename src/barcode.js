/* ---------- barcode lookup (Open Food Facts) --------------------------------
 * A scanned barcode is just a number; the macros come from Open Food Facts — a
 * free, open, key-less, CORS-enabled product database. This is the app's only
 * network call for *public* data (never your data), and it degrades gracefully:
 * offline or not-found simply falls back to manual entry.
 *
 * Prefers the product's declared per-serving numbers; otherwise per-100g (with a
 * "100 g" portion you can scale). Returns null when the code isn't in the DB, or
 * { sparse:true } when it's known but has no usable macros.
 * -------------------------------------------------------------------------- */
const OFF = 'https://world.openfoodfacts.org/api/v2/product'
const FIELDS = 'product_name,brands,serving_size,serving_quantity,nutriments'

export async function lookupBarcode(code) {
  const res = await fetch(`${OFF}/${encodeURIComponent(code)}.json?fields=${FIELDS}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error('network')
  const data = await res.json()
  if (data.status !== 1 || !data.product) return null // not in the database
  const p = data.product
  const n = p.nutriments || {}
  const brand = (p.brands || '').split(',')[0].trim()
  const name = [p.product_name?.trim(), brand ? `(${brand})` : ''].filter(Boolean).join(' ').trim() || `Item ${code}`

  const hasServing = n['energy-kcal_serving'] != null || n.proteins_serving != null
  const pick = (base) => (hasServing ? n[`${base}_serving`] : n[`${base}_100g`])
  const round = (v) => (v == null ? undefined : Math.round(v * 10) / 10)
  const kcal = pick('energy-kcal')
  const portion = hasServing
    ? (p.serving_size || (p.serving_quantity ? `${p.serving_quantity} g` : '1 serving'))
    : '100 g'

  if (kcal == null && n.proteins_100g == null && n.proteins_serving == null) {
    return { code, name, portion, sparse: true } // found, but no macros to prefill
  }
  return {
    code, name, portion,
    kcal: kcal == null ? undefined : Math.round(kcal),
    protein: round(pick('proteins')), carbs: round(pick('carbohydrates')), fat: round(pick('fat')),
    fiber: round(pick('fiber')), sugar: round(pick('sugars')),
  }
}

// Split an Open Food Facts portion string ("30 g", "1 serving", "250 ml") into
// the Add-food form's amount + unit. Falls back to 1 serving.
export function parsePortion(portion) {
  const m = /^\s*([\d.]+)\s*(.*)$/.exec(portion || '')
  if (!m) return { amount: '1', unit: 'serving' }
  const amount = m[1]
  const raw = (m[2] || '').toLowerCase()
  const unit = raw.startsWith('g') ? 'g' : raw.startsWith('ml') ? 'ml' : raw.startsWith('oz') ? 'oz'
    : raw.includes('serving') ? 'serving' : raw || 'serving'
  return { amount, unit }
}
