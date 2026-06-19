/* ---------- hair engine (pure) ----------------------------------------------
 * Minoxidil daily; derma roller once a week (default Sunday), spaced away from
 * minoxidil — freshly rolled skin absorbs more and irritates, so the roller day
 * skips minoxidil. Returns the day's plan, like the skincare engine.
 * -------------------------------------------------------------------------- */
export const HAIR_DOW_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ROLLER_DAY_DEFAULT = 0 // Sunday

export function rollerDay(state) {
  return state?.profile?.hair?.rollerDay ?? ROLLER_DAY_DEFAULT
}

export function hairPlanForDay(dateIso, state) {
  const dow = new Date(dateIso + 'T00:00:00').getDay()
  if (dow === rollerDay(state)) {
    return {
      kind: 'roller', title: 'Derma roller night',
      steps: [
        { id: 'derma_roller', title: 'Derma roller', instruction: 'Disinfect the roller. Roll 1.0–1.5 mm over the thinning areas — 6–8 passes each direction, light pressure. Disinfect again after.' },
        { id: 'roller_rest', title: 'No minoxidil tonight', note: true, instruction: 'Skip minoxidil for ~24h after rolling — rolled skin absorbs far more and irritates easily. Resume tomorrow.' },
      ],
    }
  }
  return {
    kind: 'minoxidil', title: 'Minoxidil',
    steps: [{ id: 'minoxidil', title: 'Minoxidil', instruction: '1 mL to the scalp on the thinning areas, on dry hair. Spread evenly, leave on 4h+, wash your hands after.' }],
  }
}
