/* ---------- adaptive weekly check-in (pure) ---------------------------------
 * Reads real outcomes — weight trend, lifting PRs, routine adherence — and
 * proposes concrete plan changes to keep December on track. Runs at most weekly.
 * Returns { due, findings[], changes } where `changes` is a profile patch the
 * user applies with one tap (auto-computed, visible, reversible).
 * -------------------------------------------------------------------------- */
import { recentSessions } from './train'
import { calorieTarget } from './diet'

const day = (iso) => new Date(iso + 'T00:00:00')
const latest = (log, key) => (log?.length ? [...log].sort((a, b) => a.date.localeCompare(b.date)).at(-1)[key] : null)

// kg/week trend from the weight log over a recent window (negative = losing).
export function weightTrend(state, windowDays = 28) {
  const log = [...(state.weightLog || [])].sort((a, b) => a.date.localeCompare(b.date))
  if (log.length < 2) return null
  const lastDate = log.at(-1).date
  const cutoff = day(lastDate); cutoff.setDate(cutoff.getDate() - windowDays)
  const pts = log.filter((e) => day(e.date) >= cutoff)
  if (pts.length < 2) return null
  const a = pts[0], b = pts.at(-1)
  const days = (day(b.date) - day(a.date)) / 86400000
  if (days < 5) return null
  return { perWeek: Math.round(((b.kg - a.kg) / (days / 7)) * 100) / 100, days: Math.round(days) }
}

// kg/week needed to hit the body-fat target by the deadline (holds lean mass).
function neededRate(state, today) {
  const kg = latest(state.weightLog, 'kg')
  const bf = latest(state.bodyFatLog, 'pct')
  if (!kg || bf == null) return null
  const target = state.profile?.bodyFatTarget || 12
  const deadline = state.profile?.bodyFatDeadline || '2026-12-31'
  const lose = kg - (kg * (1 - bf / 100)) / (1 - target / 100)
  const weeksLeft = (day(deadline) - day(today)) / (7 * 86400000)
  return lose > 0 && weeksLeft > 0 ? lose / weeksLeft : 0
}

// Smoothed weight rate (kg/day) by linear regression over a window — filters the
// daily noise (water, sodium, creatine) that a first-vs-last reading reacts to.
function weightSlope(state, today, windowDays = 21) {
  const log = [...(state.weightLog || [])].sort((a, b) => a.date.localeCompare(b.date))
  const cutoff = day(today); cutoff.setDate(cutoff.getDate() - windowDays)
  const pts = log.filter((e) => day(e.date) >= cutoff)
  if (pts.length < 5) return null // too few weigh-ins to trust
  const spanDays = (day(pts.at(-1).date) - day(pts[0].date)) / 86400000
  if (spanDays < 10) return null // too short a window — still mostly water
  const t0 = day(pts[0].date).getTime()
  const xs = pts.map((p) => (day(p.date).getTime() - t0) / 86400000)
  const ys = pts.map((p) => p.kg)
  const n = xs.length, sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0)
  const sxx = xs.reduce((a, b) => a + b * b, 0), sxy = xs.reduce((a, b, i) => a + b * ys[i], 0)
  const denom = n * sxx - sx * sx
  if (!denom) return null
  return { slope: (n * sxy - sx * sy) / denom, n, spanDays: Math.round(spanDays) }
}

// Adaptive deficit coach: reads the smoothed fat-loss rate vs the pace you need
// for the body-fat deadline, separates signal from noise, and prescribes a calorie
// adjustment you can apply in one tap. Returns a status object for the card.
export function deficitCoach(state, today) {
  const profile = state.profile || {}
  const ct = calorieTarget(state)
  if (!ct) return { status: 'no-weight', headline: 'Log your weight', detail: 'Add a weigh-in to start tuning calories to your real rate.' }
  const need = neededRate(state, today) // kg/week needed (>= 0)
  if (need == null) return { status: 'no-bf', headline: 'Estimate body fat', detail: 'Log a body-fat estimate so I can set the pace you need.', ceiling: ct.ceiling }
  const sl = weightSlope(state, today, 21)
  if (!sl) return { status: 'building', headline: 'Building your trend', ceiling: ct.ceiling,
    detail: 'Weigh in daily. After ~2 weeks I can read your real fat-loss rate and tune calories — short-term scale moves are mostly water (creatine, sodium, carbs), not fat.' }

  const loss = Math.round(-sl.slope * 7 * 100) / 100 // kg/week, + = losing
  const needWk = Math.round(need * 100) / 100
  const gap = needWk - loss // + = losing too slow
  const TOL = 0.15 // tolerance band so we don't chase noise
  const curDeficit = profile.deficit ?? 500
  const r25 = (n) => Math.round(n / 25) * 25
  const clampDef = (d) => Math.max(250, Math.min(800, d))
  const base = { loss, needWk, ceiling: ct.ceiling, spanDays: sl.spanDays, weighIns: sl.n }

  if (needWk <= 0.02) return { ...base, status: 'at-goal', headline: 'At your target',
    detail: "You're at or past your body-fat goal. Ease toward maintenance when you're ready." }

  if (loss > needWk + 0.3) {
    const newDef = clampDef(curDeficit - Math.min(200, r25((loss - needWk) * 1100)))
    return { ...base, status: 'too-fast', headline: 'Dropping faster than needed',
      detail: `Smoothed trend is ~${loss.toFixed(2)} kg/wk vs ~${needWk.toFixed(2)} needed. That pace risks muscle on a cut — eat a little more.`,
      adjust: newDef < curDeficit ? { deficit: newDef, deltaCal: curDeficit - newDef, dir: 'up', newCeiling: ct.ceiling + (curDeficit - newDef) } : null }
  }
  if (gap > TOL) {
    const newDef = clampDef(curDeficit + Math.min(200, r25(gap * 1100)))
    const cut = newDef - curDeficit
    return { ...base, status: 'behind', headline: loss <= 0.02 ? 'Trend has flattened' : 'Behind your December pace',
      detail: `${loss <= 0.02 ? 'No real loss' : `Losing ~${loss.toFixed(2)} kg/wk`} over ${sl.spanDays} days, but you need ~${needWk.toFixed(2)} kg/wk. ${cut > 0 ? `Tighten the ceiling ~${cut} cal to close it.` : 'Hold calories and add steps.'} Judge it by this trend, not the morning scale.`,
      adjust: cut > 0 ? { deficit: newDef, deltaCal: cut, dir: 'down', newCeiling: ct.ceiling - cut } : null }
  }
  return { ...base, status: 'on-track', headline: `On pace — ~${loss.toFixed(2)} kg/wk`,
    detail: `Right on the ~${needWk.toFixed(2)} kg/wk you need for December. Hold the line — don't react to the daily scale.` }
}

export function weeklyCheckin(state, today) {
  const profile = state.profile || {}
  const last = profile.lastCheckin
  const daysSince = last ? (day(today) - day(last)) / 86400000 : 999
  const findings = []
  const changes = {}
  // Fat-loss pace + calorie tuning now lives in the always-on deficitCoach card,
  // so the weekly check-in focuses on lifts and routine adherence.

  // --- lifts: PRs vs stalling -----------------------------------------------
  const sess = recentSessions(state, 3)
  if (sess.length >= 3 && sess.every((s) => s.beaten === 0)) {
    findings.push({ area: 'Lifts', tone: 'warn',
      text: `No PRs in your last 3 sessions — you're stalling. Take a lighter deload week (drop ~10%), then push again.` })
    changes.deloadFrom = today
  } else if (sess.length) {
    const prs = sess.reduce((n, s) => n + s.beaten, 0)
    if (prs > 0) findings.push({ area: 'Lifts', tone: 'good', text: `${prs} PR${prs > 1 ? 's' : ''} across recent sessions — progression's working. Keep going.` })
  }

  // --- adherence (last 14 days): skin / hair / training ----------------------
  const days = state.days || {}
  const recent = lastNDates(today, 14)
  const skinDays = recent.filter((d) => days[d]?.routines?.skincareAM && days[d]?.routines?.skincarePM).length
  const hairDays = recent.filter((d) => days[d]?.routines?.haircare).length
  if (skinDays < 7) findings.push({ area: 'Skin', tone: 'warn', text: `Only ${skinDays} full skin days in two weeks — consistency is the whole game. Don't skip the PM routine.` })
  if (hairDays < 7) findings.push({ area: 'Hair', tone: 'warn', text: `Hair routine ran ${hairDays}/14 days — minoxidil only works daily. Tighten it up.` })

  return { due: daysSince >= 7, daysSince: Math.round(daysSince), findings, changes }
}

function lastNDates(today, n) {
  const out = []
  const d = day(today)
  for (let i = 0; i < n; i++) { const x = new Date(d); x.setDate(x.getDate() - i); out.push(x.toISOString().slice(0, 10)) }
  return out
}
