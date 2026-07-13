/* ---------- strength goals (pure) -------------------------------------------
 * Concrete lift targets with a deadline — "15 pull-ups", "squat 1.25x
 * bodyweight" — tracked like the weight-loss milestones: current vs target,
 * progress, and whether the recent rate of improvement is on pace to hit the
 * date. Reads only the logged session history, so it works offline.
 *
 * Weighted lifts are scored by estimated 1-rep max (Epley), so heavier-for-fewer
 * and lighter-for-more both count. Bodyweight lifts (pull-ups) are scored by max
 * reps in a set. Targets default to bodyweight-relative strength standards and
 * are overridable via profile.strengthGoals later.
 * -------------------------------------------------------------------------- */
const LB_PER_KG = 2.20462
const MS_DAY = 86400000
const dayD = (iso) => new Date(iso + 'T00:00:00')
const daysBetween = (a, b) => Math.round((dayD(b) - dayD(a)) / MS_DAY)
const epley = (w, r) => (w || 0) * (1 + (r || 0) / 30)
const round5 = (n) => Math.round(n / 5) * 5

// Latest logged bodyweight in pounds (targets scale off it), or null.
function bodyweightLb(state) {
  const wl = [...(state.weightLog || [])].sort((a, b) => a.date.localeCompare(b.date))
  const kg = wl.length ? wl[wl.length - 1].kg : null
  return kg ? Math.round(kg * LB_PER_KG) : null
}

// Per-session best value for a lift, ascending by date. metric:
//   'reps'  → max reps in any set (bodyweight lifts)
//   'e1rm'  → max Epley 1RM across sets with real load
function liftSeries(state, exId, metric) {
  const days = state.days || {}
  const out = []
  for (const date of Object.keys(days).sort()) {
    const ex = days[date].workout?.session?.exercises?.find((e) => e.id === exId)
    if (!ex) continue
    let best = null
    for (const s of ex.sets || []) {
      if (!(s.reps > 0)) continue
      const v = metric === 'reps' ? s.reps : (s.weight > 0 ? epley(s.weight, s.reps) : null)
      if (v == null) continue
      if (best == null || v > best) best = v
    }
    if (best != null) out.push({ date, value: metric === 'e1rm' ? Math.round(best) : best })
  }
  return out
}

// The default goal set, seeded to what he told us + relative-strength standards.
// Deadline shared with the body-fat deadline (end of year) unless overridden.
function defaultGoals(state) {
  const bw = bodyweightLb(state)
  const deadline = state.profile?.strengthDeadline || state.profile?.bodyFatDeadline || '2026-12-31'
  return [
    { id: 'pull_up', metric: 'reps', name: 'Pull-Ups', unit: 'reps', deadline,
      target: 15, basis: 'your goal' },
    { id: 'squat', metric: 'e1rm', name: 'Barbell Squat', unit: 'lb', deadline,
      target: bw ? round5(bw * 1.25) : 185, basis: bw ? '1.25× bodyweight' : 'starter target' },
    { id: 'incline_db_press', metric: 'e1rm', name: 'Incline DB Press', unit: 'lb', deadline, perDumbbell: true,
      target: bw ? round5(bw * 0.4) : 55, basis: bw ? '0.4× bodyweight per dumbbell' : 'starter target' },
  ]
}

function statusFor(g, state, today) {
  const series = liftSeries(state, g.id, g.metric)
  const best = series.reduce((m, p) => (m == null || p.value > m.value ? p : m), null) // all-time best + its date
  const current = best ? best.value : 0
  const first = series.length ? series[0] : null
  const daysLeft = Math.max(0, daysBetween(today, g.deadline))
  const pct = Math.max(0, Math.min(100, Math.round((current / g.target) * 100)))
  const remaining = Math.max(0, g.target - current)
  const achieved = current >= g.target

  // Rate of improvement from first record to best; project to the deadline.
  let onPace = null, projected = null, line
  if (achieved) {
    line = `Done — you hit ${g.target} ${g.unit}. Hold it.`
  } else if (!series.length) {
    line = `Not logged yet. Log ${g.name.toLowerCase()} in a session and this starts tracking.`
  } else if (series.length < 2 || !first || best.date === first.date) {
    line = `At ${current} ${g.unit} — ${remaining} ${g.unit} to go. Log a few more sessions and I can read your pace.`
  } else {
    const span = Math.max(1, daysBetween(first.date, best.date))
    const rate = (current - first.value) / span // per day
    projected = rate > 0 ? current + rate * daysLeft : current
    onPace = projected >= g.target
    // Note: a straight line overstates strength gains far out (they taper), so we
    // report the on/off verdict but don't quote the inflated projected number.
    if (rate <= 0) {
      line = `Stalled at ${current} ${g.unit}. ${g.metric === 'reps' ? 'Add a rep target each session' : 'Nudge the load or reps'} to get moving again.`
    } else if (onPace) {
      line = `On pace — you're trending up fast enough to get there. Keep the progression going.`
    } else {
      line = `Behind pace — ${remaining} ${g.unit} to go in ${daysLeft} days. ${g.metric === 'reps' ? 'Add pull-up volume each week' : 'Push the load or reps a little harder'} to close it.`
    }
  }
  return { ...g, current, best, pct, remaining, daysLeft, achieved, onPace, projected, line }
}

export function strengthGoalsFor(state, today) {
  const goals = (state.profile?.strengthGoals?.length ? state.profile.strengthGoals : defaultGoals(state))
  return goals.map((g) => statusFor(g, state, today))
}
