/* ---------- stats export (pure): a clean snapshot for an LLM ------------------
 * NOT the raw localStorage dump (full of per-step skincare logs, activity
 * intervals, etc.) — a curated, analysis-ready summary: body composition and
 * trend, lifts and strength goals, cardio, sleep, diet averages, consistency,
 * projections, and the coach's own read. Reuses the same engines the app
 * trusts, so the numbers match what's on screen.
 * -------------------------------------------------------------------------- */
import { buildReview } from './review'
import { bestLifts, recentSessions, buildSession, gymStatus } from './train'
import { stepsHit } from './makeup'
import { strengthGoalsFor } from './strengthGoals'
import { cardioMinutesInWindow, restingHrTrend, cardioRamp } from './cardio'
import { sleepScore, lastNightSleep, scoreNight, recoveryState } from './sleep'
import { dayTotals, calorieTarget, calorieBreakdown, PROTEIN_TARGET_DEFAULT, proteinRange, proteinStatus, mealProteinDistribution, intakeAverages, dayCritique, recommend, defaultLocation, sanitizeJson, effectivePantry, pantryFor } from './diet'
import { dueSummary } from './skincare'
import { recentReflections } from './reflect'

const shiftIso = (iso, delta) => {
  const [y, m, d] = iso.split('-').map(Number)
  const nd = new Date(new Date(y, m - 1, d).getTime() + delta * 86400000)
  const p = (n) => String(n).padStart(2, '0')
  return `${nd.getFullYear()}-${p(nd.getMonth() + 1)}-${p(nd.getDate())}`
}
const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100)

function dietAverages(state, today, days = 14) {
  const D = state.days || {}
  let pSum = 0, kSum = 0, n = 0
  for (let i = 0; i < days; i++) {
    const d = D[shiftIso(today, -i)]
    if (d?.food?.length) { const t = dayTotals(d); pSum += t.protein; kSum += t.kcal; n++ }
  }
  return n ? { avgProteinG: Math.round(pSum / n), avgCalories: Math.round(kSum / n), daysLogged: n } : { avgProteinG: null, avgCalories: null, daysLogged: 0 }
}

// The suggested prompt shipped alongside the JSON.
export const STATS_PROMPT = "You are an elite, evidence-based physique, strength and longevity coach. Below is my current training and body-composition data as JSON, exported from my tracking app. Read it, then: (1) tell me honestly where I stand and what's working; (2) name what's lagging or concerning; (3) give me the 3 highest-impact, specific changes to make over the next two weeks to keep losing fat while holding muscle and improving long-term health. Be direct and specific — reference my actual numbers.\n\nDATA:"

// Sleep is inferred from phone inactivity — export it WITH its source and
// confidence so an assessment can weight it honestly (never a bare 10/10).
function sleepSummary(state, today, profile) {
  const nights = []
  let confirmed = 0
  for (let i = 0; i < 7; i++) {
    const s = lastNightSleep(state, shiftIso(today, -i))
    const sc = scoreNight(s, profile)
    if (!sc) continue
    nights.push({ score: sc.finalScore, confidence: sc.confidence, source: sc.source, minutes: s?.minutes ?? null })
    if (s?.source === 'manual' || s?.source === 'mixed') confirmed++
  }
  if (!nights.length) return { avgScore10: null, note: 'no sleep data yet' }
  const durNights = nights.filter((n) => n.minutes != null)
  const confDist = {}
  nights.forEach((n) => { confDist[n.confidence] = (confDist[n.confidence] || 0) + 1 })
  return {
    avgScore10: Math.round(nights.reduce((a, b) => a + b.score, 0) / nights.length),
    lastNight: { score10: nights[0].score, source: nights[0].source, confidence: nights[0].confidence },
    avgDurationMin: durNights.length ? Math.round(durNights.reduce((a, b) => a + b.minutes, 0) / durNights.length) : null,
    confidenceDistribution: confDist,
    manuallyConfirmedNights: confirmed,
    nightsWithData: nights.length,
  }
}

export function buildStatsExport(state, today, generatedAt) {
  const profile = state.profile || {}
  const R = buildReview(state, today)
  const bf = R.bodyFat, pace = R.pacing
  const lifts = bestLifts(state).filter((l) => l.best).map((l) => ({
    lift: l.name, weightLb: l.best.weight, reps: l.best.reps, e1rmLb: Math.round(l.best.e1rm), gainedLb: l.trend, sessions: l.sessions,
  }))
  // Strength goals carry explicit load semantics so an auditor never compares a
  // per-hand dumbbell number against a total-bar-load target.
  const goals = strengthGoalsFor(state, today).map((g) => ({
    name: g.name, current: g.current, target: g.target, unit: g.unit,
    loadSemantics: g.loadSemantics, loadBasis: g.basis || null,
    onPace: g.achieved ? true : g.onPace, deadline: g.deadline,
  }))
  const ct = calorieTarget(state)
  const diet = dietAverages(state, today)
  const measurements = profile.measurements || {}
  const whr = measurements.waist && profile.height ? r2(measurements.waist / profile.height) : null
  const hr = restingHrTrend(state, today)
  const pillars = {}
  ;(R.pillars || []).forEach((p) => { pillars[p.key] = p.score })

  return {
    generatedAt,
    daysTracked: R.daysTracked,
    profile: { sex: profile.sex || null, age: profile.age || null, heightCm: profile.height || null },
    goal: { bodyFatTargetPct: bf.target, deadline: bf.deadline, weeksToDeadline: bf.weeksLeft },
    body: {
      weightKg: bf.weightNow, startWeightKg: bf.weightStart, totalLostKg: bf.weightLost,
      bodyFatPct: bf.now, startBodyFatPct: bf.start, bodyFatPointsLost: bf.pointsLost,
      waistToHeightRatio: whr,
      trendKgPerWeek: r2(pace.lossPerWk), neededKgPerWeek: r2(pace.neededPerWk),
      lossRateVerdict: pace.lossRateVerdict, deadlineVerdict: pace.deadlineVerdict,
      bodyFatMeasurementConfidence: pace.measurementConfidence, bodyFatReadingAgeDays: pace.bfStaleDays,
    },
    training: (() => {
      const rot = R.training?.rotation
      const audit = R.training?.audit
      return {
        sessionsPerWeekTarget: profile.gymTargetPerWeek || 3,
        // The primary adherence read: rolling PPL rotation, not a weekly count.
        rotation: rot ? {
          nextDayType: rot.next,
          completedRotationsLast28d: rot.completedRotations28,
          daysSinceEachType: rot.daysSince, // {push, pull, legs}
          distributionLast14d: rot.dist14,
          distributionLast28d: rot.dist28,
          overdueType: rot.overdueType,
          longestExposureGapType: rot.longestGapType,
          longestExposureGapDays: rot.longestGapDays,
          imbalanced: rot.imbalanced,
          note: R.training?.rotationCoach ? `${R.training.rotationCoach.headline} ${R.training.rotationCoach.detail}` : undefined,
        } : null,
        // Weekly effective sets per muscle (1.0 primary / 0.5 secondary).
        weeklyEffectiveSetsByMuscle: audit?.hasData
          ? Object.fromEntries(audit.rows.map((r) => [r.key, { sets: r.sets, range: [r.low, r.high], status: r.status }]))
          : null,
        underTrainedMuscles: audit?.under?.map((r) => r.label) || [],
        muscleNote: R.training?.auditCoach ? `${R.training.auditCoach.headline} ${R.training.auditCoach.detail}` : undefined,
        bestLifts: lifts,
        strengthGoals: goals,
        recentSessions: recentSessions(state, 6),
      }
    })(),
    cardio: (() => {
      const ramp = cardioRamp(state, today)
      return {
        weeklyZone2Min: cardioMinutesInWindow(state.days || {}, today, 7),
        weeklyTargetMin: profile.cardioTargetPerWeek || 150,
        // Ramp-from-zero: the fair target for THIS week (a 150 goal isn't week-1's).
        rampStep: ramp.label,
        thisWeekTargetMin: ramp.atFull ? ramp.fullTarget : [ramp.targetLow, ramp.targetHigh],
        restingHrBpm: hr?.latest ?? null,
        restingHrDeltaVsMonth: hr?.delta ?? null,
      }
    })(),
    sleep: sleepSummary(state, today, profile),
    diet: (() => {
      const pr = proteinRange(state)
      return {
        proteinFloorG: pr.floor, proteinPreferredG: pr.preferred, proteinStretchG: pr.stretch,
        legacyProteinTargetG: profile.proteinTarget || PROTEIN_TARGET_DEFAULT,
        avgProteinG14d: diet.avgProteinG,
        avgProteinStatus: diet.avgProteinG != null ? proteinStatus(diet.avgProteinG, pr) : null,
        avgCalories14d: diet.avgCalories,
        daysLogged14d: diet.daysLogged,
        calorieCeiling: ct?.ceiling ?? null,
        note: (diet.avgCalories != null && diet.avgCalories < 1600 && diet.avgProteinG != null && diet.avgProteinG < pr.floor)
          ? 'Intake is already aggressive and protein is under the floor — the app recommends raising protein, NOT cutting calories further.' : undefined,
      }
    })(),
    consistency: {
      currentStreakDays: R.momentum.streak,
      strongDaysLast14: R.momentum.strong14,
      strongDaysLast30: R.momentum.strong30,
      pillarScores10: pillars,
      overallScore10: R.overall,
    },
    projections: {
      confidence: pace.measurementConfidence === 'stale' ? 'low (body-fat reading is stale)' : 'modeled from current trend',
      milestones: (R.milestones?.rows || []).map((m) => ({
        label: m.label, date: m.dateIso,
        weightKg: m.weightLow === m.weightHigh ? m.weightLow : [m.weightLow, m.weightHigh],
        bodyFatPct: m.bfLow == null ? null : (m.bfLow === m.bfHigh ? m.bfLow : [m.bfLow, m.bfHigh]),
      })),
    },
    coachAssessment: { standing: R.verdictWord, summary: R.topline, wins: R.wins, gaps: R.gaps, plan: R.pacePlan },
    // Captured reasons for recent misses — the "why", to explain the numbers above.
    whatGotInTheWay: recentReflections(state, today, 14),
  }
}

/* ---------- purpose-specific export lenses -----------------------------------
 * The full snapshot above is a deep audit. Often you just want to ask ONE
 * question — "grade my diet today", "review my training" — and get a sharp answer
 * instead of a wall. Each lens below carries a tailored prompt AND a scoped,
 * today-aware payload, so you tap one, paste into an LLM, and go. Every payload
 * reuses the same engines as the app, so the numbers match what's on screen.
 * -------------------------------------------------------------------------- */

const r0 = (n) => (n == null ? null : Math.round(n))

// Shared goal/context block so every lens's LLM knows the targets to judge against.
function goalContext(state) {
  const p = state.profile || {}
  const pr = proteinRange(state)
  const ct = calorieTarget(state)
  const wl = [...(state.weightLog || [])].sort((a, b) => a.date.localeCompare(b.date))
  const bl = [...(state.bodyFatLog || [])].sort((a, b) => a.date.localeCompare(b.date))
  return {
    sex: p.sex || null, age: p.age || null, heightCm: p.height || null,
    weightKg: wl.at(-1)?.kg ?? null, bodyFatPct: bl.at(-1)?.pct ?? null,
    bodyFatTargetPct: p.bodyFatTarget || 12, deadline: p.bodyFatDeadline || null,
    proteinFloorG: pr.floor, proteinPreferredG: pr.preferred, proteinStretchG: pr.stretch,
    calorieCeiling: ct?.ceiling ?? null,
  }
}

// What I can actually eat TODAY: my location (office Tue/Wed/Thu, home otherwise —
// or a manual override) and the pantry available there. The sample space is small
// and fixed, so a realistic plan has to draw from exactly this list — not "add
// salmon" when there's none in the house.
function eatingContextBlock(state, today) {
  const day = state.days?.[today] || {}
  const loc = day.foodLoc || defaultLocation(today)
  const pr = proteinRange(state)
  const ct = calorieTarget(state)
  const t = dayTotals(day)
  const foods = pantryFor(effectivePantry(state), loc)
    .filter((it) => !it.provisional && !it.travel && ((it.kcal || 0) > 0 || (it.protein || 0) > 0))
    .sort((a, b) => (b.protein || 0) - (a.protein || 0)) // protein-first — the useful end for hitting target
    .slice(0, 60)
    .map((it) => ({ name: it.name, portion: it.portion, proteinG: Math.round((it.protein || 0) * 10) / 10, kcal: Math.round(it.kcal || 0) }))
  return {
    locationToday: loc,
    weeklyLocationPattern: 'Office on Tuesday/Wednesday/Thursday; home on Monday/Friday/Saturday/Sunday.',
    proteinSoFarG: Math.round(t.protein), proteinFloorG: pr.floor, proteinPreferredG: pr.preferred,
    caloriesSoFar: t.kcal, calorieCeiling: ct?.ceiling ?? null,
    availableFoods: foods,
  }
}

// TODAY's nutrition, meal distribution, and the 14-day baseline.
function todayDietBlock(state, today) {
  const day = state.days?.[today] || {}
  const t = dayTotals(day)
  const pr = proteinRange(state)
  const dist = mealProteinDistribution(day, pr)
  const intake = intakeAverages(state, today)
  const crit = dayCritique(state, today, pr.preferred)
  const loc = defaultLocation(today)
  const rec = recommend(state, today, loc, pr.preferred)
  return {
    date: today,
    itemsLogged: (day.food || []).length,
    calories: t.kcal, proteinG: r0(t.protein), carbsG: r0(t.carbs), fatG: r0(t.fat), fiberG: r0(t.fiber), sugarG: r0(t.sugar),
    proteinStatus: proteinStatus(t.protein, pr),
    proteinByMeal: dist.byMeal, proteinLopsided: dist.lopsided, idealPerMealProteinG: dist.perMealTarget,
    foods: (day.food || []).map((e) => ({ name: e.name, meal: e.meal || null, proteinG: r0(e.protein), kcal: e.kcal })),
    last14dAvgProteinG: intake.avgProtein, last14dAvgCalories: intake.avgCalories, daysLogged14d: intake.daysLogged,
    appCritique: crit.headline,
    nextProteinSuggestion: rec.done ? null : rec.text,
  }
}

// TODAY's training + the rolling rotation/muscle-volume read.
function trainingBlock(state, today) {
  const R = buildReview(state, today)
  const day = state.days?.[today] || {}
  const sess = day.workout?.session
  const rot = R.training?.rotation
  const audit = R.training?.audit
  const goals = strengthGoalsFor(state, today).map((g) => ({
    name: g.name, current: g.current, target: g.target, unit: g.unit, loadSemantics: g.loadSemantics,
    onPace: g.achieved ? true : g.onPace,
  }))
  return {
    todaySession: sess && sess.status === 'done'
      ? { dayType: sess.dayType, label: sess.label,
          workingSets: (sess.exercises || []).reduce((n, e) => n + (e.sets || []).filter((s) => s.reps > 0).length, 0),
          exercises: (sess.exercises || []).map((e) => ({ name: e.name, sets: (e.sets || []).filter((s) => s.reps > 0).map((s) => ({ weight: s.weight, reps: s.reps })) })) }
      : (sess?.status === 'active' ? { status: 'in progress' } : 'no lift logged today'),
    sessionsPerWeekTarget: state.profile?.gymTargetPerWeek || 3,
    rotation: rot ? {
      nextDayType: rot.next, completedRotationsLast28d: rot.completedRotations28,
      daysSinceEachType: rot.daysSince, distributionLast28d: rot.dist28,
      overdueType: rot.overdueType, imbalanced: rot.imbalanced,
      read: R.training.rotationCoach ? `${R.training.rotationCoach.headline} ${R.training.rotationCoach.detail}` : null,
    } : null,
    weeklyEffectiveSetsByMuscle: audit?.hasData
      ? Object.fromEntries(audit.rows.map((r) => [r.key, { sets: r.sets, range: [r.low, r.high], status: r.status }])) : null,
    underTrainedMuscles: audit?.under?.map((r) => r.label) || [],
    recentSessions: recentSessions(state, 6),
    strengthGoals: goals,
  }
}

// Body-composition trend + the honest pace/deadline read.
function physiqueBlock(state, today) {
  const R = buildReview(state, today)
  const bf = R.bodyFat, pace = R.pacing
  return {
    weightKg: bf.weightNow, startWeightKg: bf.weightStart, totalLostKg: bf.weightLost,
    bodyFatPct: bf.now, startBodyFatPct: bf.start, bodyFatTargetPct: bf.target, bodyFatPointsLost: bf.pointsLost,
    waistToHeightRatio: bf.waistToHeight,
    lossRateKgPerWk: pace.lossPerWk != null ? r2(pace.lossPerWk) : null,
    deadlineNeedsKgPerWk: pace.neededPerWk != null ? r2(pace.neededPerWk) : null,
    lossRateVerdict: pace.lossRateVerdict, deadlineVerdict: pace.deadlineVerdict,
    bodyFatMeasurementConfidence: pace.measurementConfidence, bodyFatReadingAgeDays: pace.bfStaleDays,
    weeksToDeadline: bf.weeksLeft,
    coachRead: pace.headline, coachPrescription: pace.prescription,
  }
}

// Sleep + recovery + the low-intensity movement that supports it.
function recoveryBlock(state, today) {
  const profile = state.profile || {}
  const rec = recoveryState(state, today, profile)
  const hr = restingHrTrend(state, today)
  return {
    sleep: sleepSummary(state, today, profile),
    recoveryState: { level: rec.level, poorNightsLast4: rec.poorNights, avgScoreLast4: rec.avg ?? null },
    weeklyZone2CardioMin: cardioMinutesInWindow(state.days || {}, today, 7),
    restingHrBpm: hr?.latest ?? null, restingHrDeltaVsMonth: hr?.delta ?? null,
    note: 'Sleep is inferred from phone inactivity unless source is "manual"/"mixed" — weight low-confidence nights accordingly; never treat an inferred night as a clean 10/10.',
  }
}

// Skincare routine adherence + the dermatologist's plan.
function skincareBlock(state, today) {
  const days = state.days || {}
  let am = 0, pm = 0, n = 0
  for (let i = 0; i < 14; i++) {
    const d = days[shiftIso(today, -i)]
    if (!d) continue
    n++
    if (d.routines?.skincareAM) am++
    if (d.routines?.skincarePM) pm++
  }
  const due = dueSummary(today, state)
  const owned = state.profile?.skincare?.ownedProducts || []
  return {
    daysTrackedLast14: n,
    amRoutinesDoneLast14: am, pmRoutinesDoneLast14: pm,
    amCompletionRatePct: n ? Math.round((am / 14) * 100) : null,
    pmCompletionRatePct: n ? Math.round((pm / 14) * 100) : null,
    tonightScheduledActive: due.tonightActive,
    shaveDue: due.shaveDue, shaveOverdue: due.shaveOverdue,
    ownedActives: owned.filter((id) => ['bha', 'retinoid', 'vitc', 'niacinamide', 'azelaic'].includes(id)),
    routine: 'AM: gentle cleanser, moisturizer, SPF 30-50. PM: cleanser, one active (BHA or adapalene — alternating, never both the same night), moisturizer.',
    plan: 'From a dermatologist assessment (sebaceous filaments on the nose, some closed comedones on cheeks/forehead, likely under-eye milia, combination-oily but surface-dehydrated skin): (1) 2% BHA 2-3 nights/wk for the nose — the biggest win; (2) adapalene 0.1% ramping 2x/wk for 2 weeks then every other night; (3) moisturize AM+PM; (4) daily SPF 30-50. Do not squeeze the under-eye milia; no pore strips or harsh scrubs.',
  }
}

// Last-7-days rollup for a weekly review.
function weeklyBlock(state, today) {
  const R = buildReview(state, today)
  const days = state.days || {}
  let sessions = 0
  for (let i = 0; i < 7; i++) { if (days[shiftIso(today, -i)]?.workout?.session?.status === 'done') sessions++ }
  const intake7 = intakeAverages(state, today, 7)
  const rot = R.training?.rotation
  const pillars = {}
  ;(R.pillars || []).forEach((p) => { pillars[p.key] = p.score })
  return {
    liftSessionsLast7d: sessions, sessionsPerWeekTarget: state.profile?.gymTargetPerWeek || 3,
    rotationDistributionLast28d: rot?.dist28 || null, completedRotationsLast28d: rot?.completedRotations28 ?? null,
    weeklyZone2CardioMin: cardioMinutesInWindow(days, today, 7),
    avgProtein7d: intake7.avgProtein, avgCalories7d: intake7.avgCalories, daysFoodLoggedLast7: intake7.daysLogged,
    sleepScore7d: sleepScore(state, today, state.profile),
    pillarScores10: pillars, overallScore10: R.overall,
    currentStreakDays: R.momentum.streak, strongDaysLast14: R.momentum.strong14,
    bodyFatTrend: { now: R.bodyFat.now, lossRateKgPerWk: R.pacing.lossPerWk != null ? r2(R.pacing.lossPerWk) : null, lossRateVerdict: R.pacing.lossRateVerdict, deadlineVerdict: R.pacing.deadlineVerdict },
    coachStanding: R.verdictWord, coachSummary: R.topline,
  }
}

// A 12-hour clock label from an epoch ms.
function clockOf(ms) {
  const d = new Date(ms)
  let h = d.getHours(); const ap = h < 12 ? 'AM' : 'PM'; h = ((h + 11) % 12) + 1
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`
}
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// A chronological timeline of everything logged today, drawn from each thing's own
// timestamp (food, session, skincare, reflections) plus the event log (water/steps/
// weight). Repeated water taps collapse to the latest count.
function buildDayTimeline(state, today) {
  const day = state.days?.[today] || {}
  const ev = []
  const push = (at, text) => { if (at) ev.push({ at, text }) }
  for (const f of day.food || []) push(f.ts, `Ate ${f.name}${f.portion ? ` (${f.portion})` : ''} — ${Math.round(f.protein || 0)}g protein, ${Math.round(f.kcal || 0)} cal`)
  const s = day.workout?.session
  if (s?.startedTs) push(s.startedTs, `Started the ${s.label || s.dayType} session`)
  if (s?.completedTs) push(s.completedTs, `Finished the ${s.label || s.dayType} session (${(s.exercises || []).reduce((n, e) => n + (e.sets || []).filter((x) => x.reps > 0).length, 0)} working sets)`)
  if (day.workout?.skip?.ts) push(day.workout.skip.ts, `Skipped the lift — ${day.workout.skip.label}${day.workout.skip.detail ? ` ("${day.workout.skip.detail}")` : ''}`)
  if (day.skincare?.am?.ts) push(day.skincare.am.ts, 'Did the morning skincare routine')
  if (day.skincare?.pm?.ts) push(day.skincare.pm.ts, 'Did the evening skincare routine')
  if (day.cardio?.ts) push(day.cardio.ts, `Logged ${day.cardio.minutes || ''} min Zone-2 cardio`)
  for (const r of day.reflections || []) push(r.ts, `Reflected on why ${r.domain} slipped: ${r.detail || r.category}`)
  const water = (day.events || []).filter((e) => e.kind === 'water')
  if (water.length) { const last = water[water.length - 1]; push(last.at, `Water reached ${last.count} of ${state.profile?.waterTarget || 8} glasses`) }
  for (const e of day.events || []) {
    if (e.kind === 'steps') push(e.at, 'Marked 10k steps done')
    else if (e.kind === 'weight') push(e.at, `Logged weight: ${e.kg} kg`)
  }
  return ev.sort((a, b) => a.at - b.at).map((x) => ({ time: clockOf(x.at), event: x.text }))
}

// The full "here's my day, what now?" briefing: the timeline, what's still open,
// how much day is left (and whether the gym is), plus goals.
function dayNarrativeBlock(state, today, now) {
  const day = state.days?.[today] || {}
  const profile = state.profile || {}
  const t = dayTotals(day)
  const pr = proteinRange(state)
  const ct = calorieTarget(state)
  const sess = buildSession(state, today)
  const trainedToday = day.workout?.session?.status === 'done'
  const skipped = !!day.workout?.skip
  const due = dueSummary(today, state)
  const stepTarget = profile.stepTarget || 10000
  const gym = gymStatus(today, now.getHours(), now.getMinutes())
  const p = Math.round(t.protein)
  return {
    now: clockOf(now.getTime()),
    dayOfWeek: DOW[new Date(today + 'T00:00:00').getDay()],
    timeline: buildDayTimeline(state, today),
    stillOpen: {
      training: trainedToday ? 'done' : skipped ? `skipped (${day.workout.skip.label})` : sess.dayType === 'rest' ? 'rest day — optional' : `${sess.label} day still to do`,
      steps10k: stepsHit(day, stepTarget) ? 'done' : 'not yet',
      eveningSkincare: due.pmPending ? 'pending' : 'done or not due',
      protein: { haveG: p, targetG: pr.preferred, floorG: pr.floor, gapToTargetG: Math.max(0, pr.preferred - p), status: proteinStatus(t.protein, pr) },
      water: { have: day.water || 0, target: profile.waterTarget || 8 },
      calories: ct ? { eaten: t.kcal, ceiling: ct.ceiling, remaining: ct.ceiling - t.kcal } : null,
    },
    gym: { open: gym.open, closesAt: gym.closeLabel, minutesToClose: gym.open ? gym.minsToClose : 0 },
    eating: eatingContextBlock(state, today),
  }
}

// The lenses, in priority order. `build` returns the scoped payload; `prompt` is
// the tailored coaching question that ships above it. Keep prompts directive and
// guarded (never advise cutting calories under a protein floor, etc.). Some builds
// take an optional `now` (a Date) for time-of-day awareness.
// The day-plan round-trip (its own dashboard flow, not a judge lens). The prompt
// carries the same day narrative, then asks the LLM to end with a JSON plan the
// app turns into a checklist.
export function buildDayPlanPrompt(state, today, now) {
  const payload = { goals: goalContext(state), today: dayNarrativeBlock(state, today, now || new Date()) }
  return `You are my in-the-moment coach. Below is my day so far as a timeline, what's still open, how much day and gym time is left, and my goals.

First, talk me through a short, prioritised, realistic plan for the REST of the day — what to do next and in what order, and what to let go of. Be time-aware: no full workout late at night, and never tell me to cut calories if my protein is under target.

For anything food-related, plan ONLY from "today.eating.availableFoods" — that's the small, fixed set I actually have at my location today (I'm at the office Tue/Wed/Thu and home the rest; see today.eating for where I am now). Don't suggest foods that aren't on that list. Name specific items and amounts to close my protein gap without blowing the calorie ceiling.

Then, at the very end, output ONLY this JSON (no code fences, no commentary after it) so my app can turn it into a checklist:
{"plan":[{"action":"","why":"","domain":"train|diet|steps|skin|sleep|water|other","when":"now|soon|evening|before-bed"}]}
- action: a short imperative I can tick off (e.g. "Do your Legs session now").
- why: one short reason tied to my actual numbers.
- 3 to 6 items, ordered by priority. Only include what genuinely helps given the time left.

MY DAY:
${JSON.stringify(payload, null, 2)}`
}

// Parse the LLM's plan reply into checklist items.
export function parseDayPlan(text) {
  if (!text || !text.trim()) return { ok: false, error: 'Paste the AI\'s reply first.' }
  const raw = sanitizeJson(text.trim())
  let parsed = null
  const m = raw.match(/\{[\s\S]*\}/) || raw.match(/\[[\s\S]*\]/)
  try { parsed = JSON.parse(raw) } catch { if (m) { try { parsed = JSON.parse(m[0]) } catch { /* bad */ } } }
  if (parsed == null) return { ok: false, error: "That doesn't look like valid JSON — copy the AI's full reply." }
  const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.plan) ? parsed.plan : (Array.isArray(parsed.items) ? parsed.items : null))
  if (!arr) return { ok: false, error: 'No "plan" list found in that reply.' }
  const WHEN = ['now', 'soon', 'evening', 'before-bed']
  const items = arr.map((it, i) => {
    if (!it || typeof it !== 'object') return null
    const action = String(it.action || it.task || it.text || '').trim()
    if (!action) return null
    return {
      id: `plan_${i}_${action.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24)}`,
      action, why: String(it.why || it.reason || '').trim(),
      domain: String(it.domain || 'other').trim(),
      when: WHEN.includes(it.when) ? it.when : null,
      done: false,
    }
  }).filter(Boolean)
  if (!items.length) return { ok: false, error: 'Couldn\'t read any plan items from that reply.' }
  return { ok: true, items }
}

export const EXPORT_LENSES = [
  {
    id: 'day', label: 'Grade my day', blurb: 'Today across diet, training & recovery',
    prompt: "You are my elite, evidence-based physique and health coach. Below is everything I logged TODAY, plus my goals and recent baselines. Grade my day out of 10 on each of (1) diet, (2) training & movement, (3) recovery, then give me the SINGLE highest-impact change to make tomorrow. Be direct and cite my actual numbers. Do NOT tell me to eat less if my protein is under target or my calories are already low.",
    build: (state, today) => ({
      goals: goalContext(state),
      diet: todayDietBlock(state, today),
      training: trainingBlock(state, today),
      recovery: recoveryBlock(state, today),
      // Why anything slipped recently — captured reasons, not just the misses.
      whatGotInTheWay: recentReflections(state, today, 7),
    }),
  },
  {
    id: 'week', label: 'Review my week', blurb: 'The last 7 days — the pattern that held me back',
    prompt: "You are my weekly performance coach. Below is a summary of my LAST 7 DAYS across training, nutrition, cardio, sleep, and consistency, plus my goals. Grade the week out of 10, name the SINGLE pattern that most held me back, and give me a specific plan for next week. Cite my numbers. Same guardrails: don't tell me to cut calories if my protein is under target.",
    build: (state, today) => ({ goals: goalContext(state), week: weeklyBlock(state, today), whatGotInTheWay: recentReflections(state, today, 7) }),
  },
  {
    id: 'diet', label: 'Judge my diet', blurb: "Today's food + protein spread + 14-day trend",
    prompt: "You are an evidence-based physique-nutrition coach. Below is my nutrition TODAY (with the per-meal protein split), my 14-day averages, my protein range + calorie ceiling, and — under \"eating\" — where I am today and the small fixed set of foods I actually have available (I'm at the office Tue/Wed/Thu, home otherwise). Tell me: did I hit protein without overshooting calories today? Is my protein well distributed or bunched? Then give me a specific plan drawing ONLY from eating.availableFoods — real items and amounts I can eat to hit protein while losing fat. Never recommend lowering calories if my protein is under the floor, or if my calories are already under ~1600.",
    build: (state, today) => ({ goals: goalContext(state), diet: todayDietBlock(state, today), calories: calorieBreakdown(state), eating: eatingContextBlock(state, today) }),
  },
  {
    id: 'training', label: 'Review my training', blurb: 'Rotation balance, muscle volume, progression',
    prompt: "You are an evidence-based strength & hypertrophy coach. Below is my training data: today's session (if any), my recent sessions, my Push/Pull/Legs rotation balance, my weekly EFFECTIVE sets per muscle, and my strength goals. Note that each strength goal states its load semantics (perHand = one dumbbell, totalExternalLoad = everything on the bar) — do not compare across them. Assess: is my rotation balanced, is any muscle under- or over-trained, and am I progressing? Give me the top 2 priorities for my next few sessions.",
    build: (state, today) => ({ goals: goalContext(state), training: trainingBlock(state, today) }),
  },
  {
    id: 'physique', label: 'Assess my fat loss', blurb: "Rate, deadline, and whether I'll hit target",
    prompt: "You are an evidence-based fat-loss coach. Below is my body-composition trend, my current loss rate versus the rate my deadline needs, my measurement confidence, and my goal. Tell me honestly: is my current rate SUSTAINABLE, and am I on pace to hit my body-fat target by the deadline? Separate those two questions. If my body-fat reading is stale, say so and treat the projection as low-confidence. What, if anything, should I change — without crashing my calories?",
    build: (state, today) => ({ goals: goalContext(state), physique: physiqueBlock(state, today) }),
  },
  {
    id: 'recovery', label: 'Check my recovery', blurb: 'Sleep, recovery state, resting HR, cardio',
    prompt: "You are a recovery and sleep coach. Below is my sleep (with its source and confidence — it is inferred from phone inactivity unless marked manual/mixed, so weight it honestly and never treat it as a clean 10/10), my recent recovery state, my weekly Zone-2 cardio, and my resting heart-rate trend. Assess whether my recovery currently supports my training load, and give me 2 concrete changes to improve sleep and recovery.",
    build: (state, today) => ({ goals: goalContext(state), recovery: recoveryBlock(state, today) }),
  },
  {
    id: 'skin', label: 'Judge my skincare', blurb: 'Routine adherence vs the derm plan',
    prompt: "You are an evidence-based, dermatology-minded skincare coach. Below is my routine adherence over the last two weeks, what's scheduled, and my current plan (built from a dermatologist's assessment). Assess my CONSISTENCY and whether I'm following the plan correctly, then give me the 2 highest-impact adjustments. Don't tell me to stack aggressive actives — my skin adjusts gradually, and BHA/adapalene must stay on alternating nights until fully tolerated.",
    build: (state, today) => ({ skincare: skincareBlock(state, today) }),
  },
  {
    id: 'full', label: 'Full deep-dive', blurb: 'The complete snapshot — everything',
    prompt: STATS_PROMPT,
    build: (state, today) => buildStatsExport(state, today, null),
  },
]
