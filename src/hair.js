/* ---------- hair engine (pure) ----------------------------------------------
 * A committed, involved hair-care routine with AM/PM plans that vary by day —
 * mirrors the skincare engine so it can drive a story-style guided flow.
 *
 * Weekly rhythm:
 *   Minoxidil 5%   AM every day; PM every day EXCEPT oil night (Sat) + roller night (Sun)
 *   Shampoo        Ketoconazole 2% Tue/Fri · gentle Sun/Thu  (non-wash: Mon/Wed/Sat)
 *   Peptide serum  AM daily
 *   Scalp massage  AM + PM (timed)
 *   Supplement     AM daily
 *   Rosemary oil   Sat PM (massage, leave overnight → washed out Sun AM)
 *   Derma roller   Sun PM (1.0–1.5mm), then a copper-peptide serum, no minoxidil
 * -------------------------------------------------------------------------- */

// Products to buy for the full regimen (surfaced in the flow's empty state).
export const HAIR_PRODUCTS = [
  { id: 'minoxidil', name: 'Minoxidil 5% (Kirkland foam / Rogaine)', why: 'the proven regrowth driver — AM + PM' },
  { id: 'peptide_serum', name: "The Ordinary Multi-Peptide Serum for Hair Density", why: 'peptides + caffeine for density, daily AM' },
  { id: 'keto_shampoo', name: 'Ketoconazole 2% shampoo (Nizoral)', why: 'anti-DHT + scalp health, 2×/week' },
  { id: 'gentle_shampoo', name: 'Gentle sulfate-free shampoo', why: 'clean without stripping, other wash days' },
  { id: 'conditioner', name: 'Lightweight conditioner', why: 'mid-lengths to ends only' },
  { id: 'rosemary_oil', name: 'Rosemary oil + jojoba carrier', why: 'evidence comparable to minoxidil for some — weekly' },
  { id: 'derma_roller', name: 'Derma roller 1.0–1.5mm (titanium)', why: 'micro-needling boosts absorption + collagen, weekly' },
  { id: 'copper_peptide', name: 'Copper-peptide / hyaluronic serum', why: 'soothe + feed the scalp right after rolling' },
  { id: 'supplement', name: 'Hair supplement (Nutrafol / biotin + saw palmetto + collagen)', why: 'daily, with food' },
  { id: 'silk_pillowcase', name: 'Silk pillowcase', why: 'less friction + breakage overnight' },
]

export const HAIR_DOW_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function schedule(dow) {
  const keto = dow === 2 || dow === 5          // Tue, Fri
  const gentle = dow === 0 || dow === 4        // Sun, Thu
  return {
    keto, gentle, wash: keto || gentle,
    oilNight: dow === 6,                        // Sat
    rollerNight: dow === 0,                     // Sun
    minoxPM: !(dow === 6 || dow === 0),         // skip on oil + roller nights
  }
}

const step = (id, title, instruction, extra = {}) => ({ id, title, instruction, ...extra })

export function hairPlanForDay(dateIso, state) {
  const dow = new Date(dateIso + 'T00:00:00').getDay()
  const s = schedule(dow)

  // ---- AM ----
  const am = []
  if (s.wash) {
    am.push(step(s.keto ? 'shampoo_keto' : 'shampoo_gentle',
      s.keto ? 'Ketoconazole shampoo' : 'Gentle shampoo',
      s.keto
        ? 'Lather Nizoral 2% into the scalp and leave it 3–5 minutes before rinsing — that contact time is what lowers scalp DHT.'
        : 'Gentle sulfate-free wash. Massage the scalp, rinse clean.',
      s.keto ? { tag: 'Anti-DHT', hold: 240 } : {}))
    am.push(step('condition', 'Condition', 'Mid-lengths to ends only — keep it off the scalp so roots stay light.'))
    am.push(step('dry_scalp', 'Dry the scalp', 'Towel and air-dry until the scalp is fully dry — minoxidil only works on a dry scalp.', { tag: 'Before minoxidil' }))
  }
  am.push(step('peptide_am', 'Peptide scalp serum', 'A few drops of the Multi-Peptide serum to the thinning areas; work it in with the fingertips.'))
  am.push(step('minox_am', 'Minoxidil 5%', 'Half a cap of foam (or 1 mL solution) to the thinning crown + hairline, on the dry scalp. Spread evenly, wash your hands after.', { tag: 'Daily' }))
  am.push(step('massage_am', 'Scalp massage', 'Three minutes of firm circular massage — drives blood flow and helps the minoxidil absorb.', { hold: 180 }))
  // Hair supplement now lives in the consolidated supplements flow (supps.js),
  // folded into the morning routine — so it isn't prompted twice.

  // ---- PM ----
  const pm = []
  if (s.rollerNight) {
    pm.push(step('roller_clean', 'Disinfect the roller', 'Soak the derma roller in 70% isopropyl alcohol for a couple of minutes.', { tag: 'Roller night' }))
    pm.push(step('derma_roller', 'Derma roller', 'Clean, dry scalp. Roll 1.0–1.5 mm over the thinning areas — 6–8 passes each direction (vertical, horizontal, diagonal), light pressure.', { tag: 'Weekly' }))
    pm.push(step('roller_after', 'Copper-peptide serum', 'Press a few drops of the copper-peptide / hyaluronic serum into the rolled areas to soothe and feed the scalp.'))
    pm.push(step('roller_store', 'Disinfect & store', 'Re-soak the roller in alcohol and let it air-dry on its stand.'))
    pm.push(step('no_minox_roller', 'No minoxidil tonight', 'Skip minoxidil for ~24h after rolling — freshly needled skin absorbs far more and irritates. Resume tomorrow.', { tag: 'Important' }))
  } else if (s.oilNight) {
    pm.push(step('rosemary', 'Rosemary oil treatment', 'Warm a few drops of rosemary oil with jojoba carrier between the palms. Massage into the scalp for five minutes and leave it in overnight.', { tag: 'Weekly', hold: 300 }))
    pm.push(step('no_minox_oil', 'No minoxidil tonight', 'Leave the oil in overnight; wash it out with your gentle shampoo in the morning. Minoxidil resumes tomorrow.', { tag: 'Important' }))
  } else if (s.minoxPM) {
    pm.push(step('minox_pm', 'Minoxidil 5%', 'Second dose of the day — half a cap of foam (or 1 mL) to the thinning areas on a dry scalp.', { tag: 'Daily' }))
    pm.push(step('massage_pm', 'Scalp massage', 'Two minutes of circular massage to finish — keeps the blood flowing while you sleep.', { hold: 120 }))
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
