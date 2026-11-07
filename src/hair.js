/* ---------- hair engine (pure) ----------------------------------------------
 * A low-friction routine built around the products the owner actually owns:
 * Rogaine 5% (minoxidil), Native shampoo + conditioner, Moroccanoil Treatment,
 * and (optional, off by default) Moroccanoil Curl Defining Cream.
 *
 * Principles honored:
 *   - Minoxidil keeps its existing schedule — AM daily, PM every day except the
 *     weekend rest nights (Sat/Sun). Dosage/frequency are NOT changed here.
 *   - Washing is FLEXIBLE: shampoo + condition are optional "when needed" steps,
 *     never forced daily.
 *   - Styling products are optional. Moroccanoil Treatment goes on lengths/ends,
 *     away from the scalp and minoxidil areas. Curl cream is optional and OFF by
 *     default (profile.hair.curlCream).
 *   - No ketoconazole shampoo, no scalp oils, no derma roller — not owned/confirmed.
 * Step ids (minox_am / minox_pm / shampoo_gentle / condition) are preserved from
 * the prior engine so historical completion logs carry over.
 * -------------------------------------------------------------------------- */

// Owned hair products (surfaced in the flow's empty state / manage screen).
export const HAIR_PRODUCTS = [
  { id: 'minoxidil', name: 'Rogaine 5% (minoxidil)', why: 'the proven regrowth driver — on your existing schedule' },
  { id: 'shampoo', name: 'Native Sandalwood & Shea Shampoo', why: 'wash the scalp and hair when it needs it' },
  { id: 'conditioner', name: 'Native Full & Thick Conditioner', why: 'mid-lengths to ends after shampooing' },
  { id: 'moroccanoil', name: 'Moroccanoil Treatment', why: 'a little on damp lengths and ends — smooths and softens' },
  { id: 'curl_cream', name: 'Moroccanoil Curl Defining Cream', why: 'optional styling — off by default' },
]

export const HAIR_DOW_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Minoxidil's existing cadence: AM every day; PM every day except the weekend rest
// nights. This preserves the prior schedule's frequency (it is editable, but not
// changed here). Washing is intentionally NOT scheduled — it's flexible.
function schedule(dow) {
  return { minoxPM: !(dow === 6 || dow === 0) } // skip Sat/Sun PM (weekend rest nights)
}

const step = (id, title, instruction, extra = {}) => ({ id, title, instruction, ...extra })

export function hairPlanForDay(dateIso, state) {
  const dow = new Date(dateIso + 'T00:00:00').getDay()
  const s = schedule(dow)
  const curlOn = state?.profile?.hair?.curlCream === true

  // ---- AM ----
  const am = []
  // Washing is flexible — these are optional "when needed" steps, not daily musts.
  am.push(step('shampoo_gentle', 'Shampoo (when needed)',
    'Wash with the Native sandalwood shampoo only when your hair or scalp needs it — not necessarily every day.',
    { tag: 'Optional', optional: true }))
  am.push(step('condition', 'Condition (if you washed)',
    'After shampooing, work the Native conditioner through the mid-lengths and ends. Keep it off the scalp so the roots stay light.',
    { tag: 'Optional', optional: true }))
  am.push(step('minox_am', 'Minoxidil (Rogaine 5%)',
    'Apply Rogaine to the thinning crown and hairline on a dry scalp, per the label. Spread it evenly and wash your hands after. Let it dry before anything else goes near the scalp.',
    { tag: 'Daily' }))
  am.push(step('moroccanoil', 'Moroccanoil Treatment (optional)',
    'Optional — a small amount smoothed through damp lengths and ends. Keep it off the scalp and away from where you applied minoxidil.',
    { tag: 'Optional', optional: true }))
  if (curlOn) {
    am.push(step('curl_cream', 'Curl cream (optional styling)',
      'Optional styling — a little Moroccanoil Curl Defining Cream through the lengths for the look you want. Nothing on the scalp.',
      { tag: 'Optional', optional: true }))
  }

  // ---- PM ----
  const pm = []
  if (s.minoxPM) {
    pm.push(step('minox_pm', 'Minoxidil (Rogaine 5%)',
      'Second Rogaine dose of the day on a dry scalp, per the label. Spread evenly, wash your hands after.',
      { tag: 'Daily' }))
  }

  return { am, pm }
}

// Which slots still need doing today (for the tile/coach), given the day's logs.
export function hairDue(dateIso, state) {
  const day = state.days?.[dateIso] || {}
  const plan = hairPlanForDay(dateIso, state)
  return {
    amPending: plan.am.length > 0 && !day.routines?.haircareAM,
    pmPending: plan.pm.length > 0 && !day.routines?.haircarePM,
    amCount: plan.am.length, pmCount: plan.pm.length,
  }
}
