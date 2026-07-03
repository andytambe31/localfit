/* ---------- coach's review (pure) ------------------------------------------
 * Reads the whole local state and produces a single coaching assessment:
 * where the body-fat goal stands, whether the pace is right (rate-based AND
 * health-aware — too fast is as wrong as too slow), what's been earned, where
 * it's slipping, and how to pace from here. All derived on-device from the
 * same signals the dashboard already trusts (deficitCoach, sleepScore, the
 * pillar scores). No narrative is invented that the numbers don't support.
 * Returns a structured object; the ReviewView renders it. Voice: directive,
 * concise, no emojis — the same coach that speaks on the dashboard.
 * -------------------------------------------------------------------------- */
import { deficitCoach, weightTrend } from './adapt'
import { sleepScore } from './sleep'
import { dietScore as foodScore, PROTEIN_TARGET_DEFAULT } from './diet'
import { bestLifts } from './train'

const MS_DAY = 86400000
const dayD = (iso) => new Date(iso + 'T00:00:00')
const shiftIso = (iso, delta) => {
  const [y, m, d] = iso.split('-').map(Number)
  const nd = new Date(new Date(y, m - 1, d).getTime() + delta * MS_DAY)
  const p = (n) => String(n).padStart(2, '0')
  return `${nd.getFullYear()}-${p(nd.getMonth() + 1)}-${p(nd.getDate())}`
}
const sortedLog = (log) => [...(log || [])].sort((a, b) => a.date.localeCompare(b.date))
const monthYear = (d) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

// --- pillar scoring: mirrors the dashboard GoalsSection so the review and the
// rings never disagree. Rolling 7-day, only over days with real activity.
const skinQ = (d) => ((d.routines?.skincareAM ? 1 : 0) + (d.routines?.skincarePM ? 1 : 0)) / 2
const hairQ = (d) => ((d.routines?.haircareAM ? 1 : 0) + (d.routines?.haircarePM ? 1 : 0)) / 2
const moveQ = (d, profile) => {
  const trained = (d.workout?.did && d.workout.type !== 'Rest') || d.workout?.session?.status === 'done'
  return trained ? 1 : Math.min(1, (d.steps || 0) / (profile.stepTarget || 10000))
}
const dayLogged = (d) => !!(d && (d.routines?.skincareAM || d.routines?.skincarePM || d.routines?.haircareAM || d.routines?.haircarePM || d.workout?.did || (d.food && d.food.length) || d.steps || d.water))
function pillar(days, today, quality) {
  let sum = 0, cnt = 0
  for (let i = 0; i < 7; i++) {
    const d = days[shiftIso(today, -i)]
    if (!dayLogged(d)) continue
    sum += quality(d); cnt++
  }
  return cnt ? Math.round((sum / cnt) * 10) : null
}
function dietPillar(state, today, proteinTarget) {
  const days = state.days || {}
  let sum = 0, cnt = 0
  for (let i = 0; i < 7; i++) {
    const iso = shiftIso(today, -i)
    if (!(days[iso]?.food?.length)) continue
    const s = foodScore(state, iso, proteinTarget)
    if (s != null) { sum += s; cnt++ }
  }
  return cnt ? Math.round(sum / cnt) : null
}

// --- streaks: a "strong day" is every core habit met (mirrors RewardsSummary).
function strongDay(d, profile) {
  if (!d) return false
  const r = d.routines || {}, w = d.workout || {}
  const skin = r.skincareAM && r.skincarePM
  const water = (d.water || 0) >= (profile.waterTarget || 8)
  const trained = (w.did && w.type !== 'Rest') || w.session?.status === 'done'
  const move = trained || (d.steps || 0) >= (profile.stepTarget || 10000)
  const diet = (d.food?.length || 0) > 0
  return skin && water && move && diet
}
function currentStreak(days, today, profile) {
  let n = 0
  for (let i = strongDay(days[today], profile) ? 0 : 1; ; i++) {
    if (strongDay(days[shiftIso(today, -i)], profile)) n++; else break
  }
  return n
}
// Longest run of strong days anywhere in the logged history.
function longestStreak(days, profile) {
  const dates = Object.keys(days).sort()
  let best = 0, run = 0, prev = null
  for (const iso of dates) {
    if (!strongDay(days[iso], profile)) { run = 0; prev = iso; continue }
    run = prev && shiftIso(prev, 1) === iso ? run + 1 : 1
    if (run > best) best = run
    prev = iso
  }
  return best
}
function countLastN(days, today, n, pred) {
  let c = 0
  for (let i = 0; i < n; i++) { const d = days[shiftIso(today, -i)]; if (d && pred(d)) c++ }
  return c
}

// Earliest date this person has any footprint — the true "since you started".
function startDate(state) {
  const cands = [
    ...Object.keys(state.days || {}),
    ...sortedLog(state.weightLog).map((e) => e.date),
    ...sortedLog(state.bodyFatLog).map((e) => e.date),
    state.profile?.skincare?.startedDate,
    state.profile?.trainStart,
  ].filter(Boolean).sort()
  return cands[0] || null
}

export function buildReview(state, today) {
  const profile = state.profile || {}
  const days = state.days || {}
  const bfLog = sortedLog(state.bodyFatLog)
  const wLog = sortedLog(state.weightLog)
  const start = startDate(state)
  const daysTracked = start ? Math.max(1, Math.round((dayD(today) - dayD(start)) / MS_DAY) + 1) : 0
  const hasData = daysTracked > 0 && (bfLog.length > 0 || wLog.length > 0 || Object.keys(days).length > 0)

  // ---- body-fat goal: the primary objective --------------------------------
  const target = profile.bodyFatTarget || 12
  const deadline = profile.bodyFatDeadline || '2026-12-31'
  const weeksLeft = Math.max(0, (dayD(deadline) - dayD(today)) / (7 * MS_DAY))
  const bfStart = bfLog[0]?.pct ?? null
  const bfNow = bfLog.at(-1)?.pct ?? null
  const bfStale = bfLog.length ? Math.round((dayD(today) - dayD(bfLog.at(-1).date)) / MS_DAY) : null
  const wStart = wLog[0]?.kg ?? null
  const wNow = wLog.at(-1)?.kg ?? null
  const bodyFat = {
    has: bfNow != null,
    start: bfStart, now: bfNow, target,
    pointsLost: bfStart != null && bfNow != null ? Math.round((bfStart - bfNow) * 10) / 10 : null,
    pointsOff: bfNow != null ? Math.round((bfNow - target) * 10) / 10 : null,
    weightStart: wStart, weightNow: wNow,
    weightLost: wStart != null && wNow != null ? Math.round((wStart - wNow) * 10) / 10 : null,
    staleDays: bfStale, deadline, weeksLeft: Math.round(weeksLeft),
  }

  // ---- pacing: rate-based AND health-aware ---------------------------------
  const dc = deficitCoach(state, today)
  const wt = weightTrend(state, 28)
  // Smoothed weekly loss (kg/wk, + = losing). Prefer the regression the deficit
  // coach already computed; fall back to the coarser first-vs-last trend.
  const loss = dc.loss != null ? dc.loss : (wt ? Math.round(-wt.perWeek * 100) / 100 : null)
  const safeCeiling = wNow ? Math.round(wNow * 0.01 * 100) / 100 : null // ~1% bodyweight/wk
  let verdict, headline, detail, prescription
  const behindOrStalled = () => {
    if (loss != null && loss <= 0.02) { verdict = 'stalled'; headline = 'Your trend has gone flat'; detail = 'No real fat loss over the last few weeks. Short scale bounces are water — this is the smoothed line.'; prescription = 'Drop the calorie ceiling ~150–200 and hold it two full weeks before you judge it again.' }
    else { verdict = 'behind'; headline = 'Behind your December pace'; detail = dc.detail || `Losing ~${loss?.toFixed(2)} kg/wk, but the deadline needs more.`; prescription = 'Tighten the ceiling a little and add steps. A small, steady deficit closes the gap — no crash needed.' }
  }
  if (loss != null && safeCeiling != null && loss > safeCeiling + 0.05) {
    verdict = 'aggressive'
    headline = 'You are cutting too hard'
    detail = `You're dropping ~${loss.toFixed(2)} kg/wk — past the ~${safeCeiling.toFixed(2)} kg/wk that's safe for your bodyweight. That fast, the scale is coming off muscle and water, not just fat.`
    prescription = 'Add roughly 150–250 calories a day and slow it down. You protect the muscle you train for, and you still hit the goal.'
  } else if (dc.status === 'too-fast') {
    verdict = 'fast'; headline = 'Ahead of the pace you need'
    detail = dc.detail || `Trend ~${loss?.toFixed(2)} kg/wk vs ~${dc.needWk?.toFixed(2)} needed.`
    prescription = 'You can ease up and still make December comfortably. Faster is not better on a cut — eat a touch more.'
  } else if (dc.status === 'on-track') {
    verdict = 'on-track'; headline = `On pace — ~${loss?.toFixed(2)} kg/wk`
    detail = `Right on the ~${dc.needWk?.toFixed(2)} kg/wk you need for ${target}% by December.`
    prescription = "Hold the line. Don't react to the morning scale — the trend is doing exactly what it should."
  } else if (dc.status === 'at-goal') {
    verdict = 'at-goal'; headline = 'You are at your target'
    detail = "You're at or past your body-fat goal. This is the part most people never reach."
    prescription = 'Ease toward maintenance when you\'re ready — a small surplus to build, or hold here and keep the lifts moving.'
  } else if (dc.status === 'behind') {
    behindOrStalled()
  } else if (dc.status === 'building') {
    verdict = 'building'; headline = 'Still reading your real rate'
    detail = 'Not enough weigh-ins yet to separate fat loss from daily water swings.'
    prescription = 'Weigh in every morning for two weeks. Then the pace verdict is real, not noise.'
  } else {
    verdict = 'no-data'; headline = 'Set your baseline'
    detail = dc.status === 'no-bf' ? 'Log a body-fat estimate so the pace has a target to aim at.' : 'Log your weight so I can read a real trend.'
    prescription = dc.status === 'no-bf' ? 'Open the body-fat estimator — tape measurements are enough to start.' : 'Add a weigh-in. Daily from here is what makes the coaching sharp.'
  }

  // Projection: at the current smoothed rate, when does target land?
  let projection = null
  if (loss != null && loss > 0.03 && bfNow != null && wNow != null && bfNow > target) {
    const leanNow = wNow * (1 - bfNow / 100)
    const targetWeight = leanNow / (1 - target / 100) // hold lean mass, lose fat
    const loseKg = wNow - targetWeight
    if (loseKg > 0) {
      const weeks = loseKg / loss
      const hit = new Date(dayD(today).getTime() + weeks * 7 * MS_DAY)
      const vsWeeks = Math.round((dayD(deadline) - hit) / (7 * MS_DAY))
      projection = {
        weeks: Math.round(weeks),
        hitLabel: monthYear(hit),
        vsWeeks, // + = ahead of deadline, - = past it
        loseKg: Math.round(loseKg * 10) / 10,
      }
    }
  }

  const pacing = {
    verdict, headline, detail, prescription,
    lossPerWk: loss, neededPerWk: dc.needWk ?? null, safeCeiling, projection,
    weighIns: dc.weighIns ?? null, spanDays: dc.spanDays ?? null,
  }

  // ---- momentum / consistency ----------------------------------------------
  const streak = currentStreak(days, today, profile)
  const best = longestStreak(days, profile)
  const strong14 = countLastN(days, today, 14, (d) => strongDay(d, profile))
  const strong30 = countLastN(days, today, 30, (d) => strongDay(d, profile))
  const momentum = { streak, longest: best, strong14, strong30 }

  // ---- five pillars ---------------------------------------------------------
  const pillars = [
    { key: 'sleep', label: 'Sleep', score: sleepScore(state, today, profile), msg: `Sleep is your soft spot — aim for ${profile.sleepTargetHours || 7}h, lights out on schedule.` },
    { key: 'diet', label: 'Diet', score: dietPillar(state, today, profile.proteinTarget || PROTEIN_TARGET_DEFAULT), msg: 'Diet is the lever on body fat — hit protein, stay under the ceiling.' },
    { key: 'move', label: 'Move', score: pillar(days, today, (d) => moveQ(d, profile)), msg: 'Movement is light — train three times a week and hit your steps.' },
    { key: 'skin', label: 'Skin', score: pillar(days, today, skinQ), msg: 'Skin is slipping — run the full AM and PM routine daily.' },
    { key: 'hair', label: 'Hair', score: pillar(days, today, hairQ), msg: 'Hair is falling behind — the treatment only works applied daily.' },
  ]
  const scored = pillars.filter((p) => p.score != null)
  const overall = scored.length ? Math.round(scored.reduce((s, p) => s + p.score, 0) / scored.length) : null
  const strongest = scored.length ? [...scored].sort((a, b) => b.score - a.score)[0] : null
  const weakest = scored.length ? [...scored].sort((a, b) => a.score - b.score)[0] : null

  // ---- wins: only what the data actually supports --------------------------
  const wins = []
  if (bodyFat.pointsLost != null && bodyFat.pointsLost >= 0.5) wins.push(`Body fat ${bfStart}% down to ${bfNow}% — ${bodyFat.pointsLost} points gone since you started.`)
  if (bodyFat.weightLost != null && bodyFat.weightLost >= 0.5) wins.push(`Down ${bodyFat.weightLost} kg on the scale over ${daysTracked} days.`)
  if (streak >= 3) wins.push(`${streak} strong days in a row right now — every core habit met.`)
  else if (best >= 5) wins.push(`Your best run reached ${best} straight strong days.`)
  const lifts = bestLifts(state)
  const stronger = lifts.filter((l) => l.best && l.trend > 0).length
  if (stronger >= 2) wins.push(`${stronger} of your main lifts are heavier than day one — you're holding muscle while you cut.`)
  const claimedCount = Object.values(state.rewardsClaimed || {}).filter(Boolean).length
  if (claimedCount > 0) wins.push(`${claimedCount} reward${claimedCount > 1 ? 's' : ''} earned and banked.`)
  const dialed = scored.filter((p) => p.score >= 8).map((p) => p.label.toLowerCase())
  if (dialed.length) wins.push(`${cap(list(dialed))} ${dialed.length > 1 ? 'are' : 'is'} dialed in.`)
  if (verdict === 'on-track' || verdict === 'at-goal') wins.push(pacing.headline + '.')

  // ---- gaps: where it's slipping -------------------------------------------
  const gaps = []
  if (verdict === 'aggressive') gaps.push('Your cut is too aggressive — losing this fast costs muscle.')
  if (verdict === 'behind' || verdict === 'stalled') gaps.push(pacing.headline + '.')
  const soft = scored.filter((p) => p.score <= 5)
  for (const p of soft.slice(0, 2)) gaps.push(p.msg)
  const skin14 = countLastN(days, today, 14, (d) => d.routines?.skincareAM && d.routines?.skincarePM)
  if (Object.keys(days).length >= 5 && skin14 < 7) gaps.push(`Only ${skin14} full skin days in the last two weeks — consistency is the whole game.`)
  const hair14 = countLastN(days, today, 14, (d) => d.routines?.haircareAM || d.routines?.haircarePM)
  if (Object.keys(days).length >= 5 && hair14 < 7) gaps.push(`Hair care ran ${hair14}/14 days — daily is the only thing that works.`)
  if (bfStale != null && bfStale > 28) gaps.push(`Your last body-fat reading is ${bfStale} days old — re-measure so the pace stays honest.`)
  if (pacing.weighIns != null && pacing.weighIns < 10 && pacing.spanDays != null) gaps.push('Weigh-ins are sparse — daily is what makes the trend trustworthy.')

  // ---- how to pace from here -----------------------------------------------
  const pacePlan = [pacing.prescription]
  if (weakest && weakest.score < 8 && verdict !== 'no-data' && verdict !== 'building') pacePlan.push(weakest.msg)
  if (streak === 0 && Object.keys(days).length >= 3) pacePlan.push('Start a fresh streak today — one strong day is the whole trick, repeated.')
  else if (streak >= 1) pacePlan.push("Protect the streak. Momentum is the asset you're actually building.")

  // ---- top-line standing ----------------------------------------------------
  let standing, verdictWord, topline
  if (!hasData) { standing = 'starting'; verdictWord = 'Just getting started'; topline = 'Log a few days and this becomes a real read on where you stand.' }
  else if (verdict === 'aggressive') { standing = 'aggressive'; verdictWord = 'Strong effort, too hard'; topline = "You're clearly committed — but you're cutting faster than is safe. Ease off and you keep the muscle." }
  else if (verdict === 'at-goal') { standing = 'excellent'; verdictWord = 'Goal reached'; topline = "You've hit the target most people quit before. Now it's about holding it." }
  else if ((overall ?? 0) >= 8 && (verdict === 'on-track' || verdict === 'fast')) { standing = 'excellent'; verdictWord = 'Dialed in'; topline = 'Pace is right and the habits are sharp. This is exactly what winning looks like — keep it boring.' }
  else if (verdict === 'on-track' || verdict === 'fast') { standing = 'good'; verdictWord = 'On track'; topline = 'The fat-loss pace is right. Tighten the weak habits and this is a clean run to December.' }
  else if (verdict === 'behind' || verdict === 'stalled') { standing = 'behind'; verdictWord = 'Needs a nudge'; topline = 'The plan is sound but the pace has drifted. A small correction now beats a scramble in December.' }
  else { standing = 'building'; verdictWord = 'Building the read'; topline = 'A little more data and the coaching gets precise. Weigh in daily and log the basics.' }

  return {
    hasData, daysTracked, generatedFor: today,
    standing, verdictWord, topline,
    bodyFat, pacing, momentum,
    pillars, overall, strongest, weakest,
    wins, gaps, pacePlan,
  }
}

// Oxford-comma join, e.g. ['a','b','c'] -> 'a, b, and c'.
function list(xs) {
  if (xs.length <= 1) return xs.join('')
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`
  return `${xs.slice(0, -1).join(', ')}, and ${xs.at(-1)}`
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
