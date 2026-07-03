/* ---------- weight timeline (pure) -----------------------------------------
 * Builds the series behind the weight graph: the raw weigh-ins, a smoothed
 * trend (EMA, so daily water noise doesn't drive the read), and two reference
 * trajectories anchored at your first weigh-in —
 *   · needed:    the glide path to your target weight by the deadline (holds
 *                lean mass), so below it = ahead of the goal, above = behind.
 *   · predicted: the loss your current calorie deficit implies, so you can see
 *                whether reality is matching the plan's math.
 * Returns rows keyed by date (ready for a recharts LineChart) plus a status
 * read (ahead / behind / on) against each reference line at the latest weigh-in.
 * -------------------------------------------------------------------------- */
import { calorieBreakdown } from './diet'

const MS_DAY = 86400000
const dayD = (iso) => new Date(iso + 'T00:00:00')
const daysBetween = (a, b) => Math.round((dayD(b) - dayD(a)) / MS_DAY)
const r1 = (n) => Math.round(n * 10) / 10
const sortLog = (log) => [...(log || [])].sort((a, b) => a.date.localeCompare(b.date))

// EMA over the weigh-in sequence — smooths the scale's daily water swings into
// a trend you can actually steer by. Index-based (not time-weighted); good
// enough for a visual trend at typical weigh-in cadence.
function emaTrend(kgs, alpha = 0.3) {
  const out = []
  let prev = null
  for (const k of kgs) { prev = prev == null ? k : alpha * k + (1 - alpha) * prev; out.push(r1(prev)) }
  return out
}

// Least-squares kg/day over the weigh-ins (for the single smoothed rate number).
function regressionRate(pts) {
  if (pts.length < 2) return null
  const t0 = dayD(pts[0].date).getTime()
  const xs = pts.map((p) => (dayD(p.date).getTime() - t0) / MS_DAY)
  const ys = pts.map((p) => p.kg)
  const n = xs.length, sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0)
  const sxx = xs.reduce((a, b) => a + b * b, 0), sxy = xs.reduce((a, b, i) => a + b * ys[i], 0)
  const denom = n * sxx - sx * sx
  if (!denom) return null
  return (n * sxy - sx * sy) / denom // kg/day (negative = losing)
}

const verdictFor = (aheadKg) => aheadKg > 0.2 ? 'ahead' : aheadKg < -0.2 ? 'behind' : 'on'

export function buildWeightTimeline(state, today) {
  const profile = state.profile || {}
  const log = sortLog(state.weightLog)
  if (log.length < 2) return { ok: false, rows: [], series: {}, status: {} }

  const startDate = log[0].date, startKg = log[0].kg
  const lastDate = log.at(-1).date, lastKg = log.at(-1).kg
  const trend = emaTrend(log.map((e) => e.kg))

  // Target weight = current lean mass held, fat trimmed to the target %.
  const bfLog = sortLog(state.bodyFatLog)
  const bfNow = bfLog.at(-1)?.pct ?? null
  const target = profile.bodyFatTarget || 12
  const deadline = profile.bodyFatDeadline || '2026-12-31'
  let targetKg = null, neededSlope = null
  if (bfNow != null) {
    const leanNow = lastKg * (1 - bfNow / 100)
    targetKg = leanNow / (1 - target / 100)
    const span = daysBetween(startDate, deadline)
    if (span > 0 && targetKg < startKg) neededSlope = (targetKg - startKg) / span // kg/day, negative
  }

  // Deficit-implied daily rate (kg/day), anchored at the same start.
  const cal = calorieBreakdown(state)
  const predSlope = cal && cal.weeklyLoss > 0 ? -cal.weeklyLoss / 7 : null

  const needed = (iso) => neededSlope == null ? null : r1(startKg + neededSlope * daysBetween(startDate, iso))
  const predicted = (iso) => predSlope == null ? null : r1(startKg + predSlope * daysBetween(startDate, iso))

  const rows = log.map((e, i) => ({
    date: e.date,
    actual: e.kg,
    trend: trend[i],
    needed: needed(e.date),
    predicted: predicted(e.date),
  }))
  // Extend the reference lines to today so "where you should be" is visible even
  // on a day you haven't weighed in.
  if (today > lastDate) rows.push({ date: today, actual: null, trend: null, needed: needed(today), predicted: predicted(today) })

  const rate = regressionRate(log) // kg/day smoothed
  const atDate = today > lastDate ? today : lastDate
  const refKg = today > lastDate ? r1(trend.at(-1)) : lastKg // compare trend-to-today vs the line
  const neededHere = needed(atDate), predictedHere = predicted(atDate)

  const status = {}
  if (neededHere != null) {
    const aheadKg = r1(neededHere - refKg) // + = below the needed line = ahead of goal
    status.needed = { aheadKg, verdict: verdictFor(aheadKg), ratePerWk: r1(neededSlope * 7), targetKg: r1(targetKg), deadline }
  }
  if (predictedHere != null) {
    const aheadKg = r1(predictedHere - refKg)
    status.predicted = { aheadKg, verdict: verdictFor(aheadKg), ratePerWk: r1(predSlope * 7) }
  }

  return {
    ok: true,
    rows,
    series: { needed: neededSlope != null, predicted: predSlope != null },
    status,
    startKg, lastKg, targetKg: targetKg != null ? r1(targetKg) : null,
    actualRatePerWk: rate != null ? r1(rate * 7) : null,
    spanDays: daysBetween(startDate, lastDate),
  }
}
