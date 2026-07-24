/* ---------- stats export (pure): a clean snapshot for an LLM ------------------
 * NOT the raw localStorage dump (full of per-step skincare logs, activity
 * intervals, etc.) — a curated, analysis-ready summary: body composition and
 * trend, lifts and strength goals, cardio, sleep, diet averages, consistency,
 * projections, and the coach's own read. Reuses the same engines the app
 * trusts, so the numbers match what's on screen.
 * -------------------------------------------------------------------------- */
import { buildReview } from './review'
import { bestLifts, recentSessions } from './train'
import { strengthGoalsFor } from './strengthGoals'
import { cardioMinutesInWindow, restingHrTrend, cardioRamp } from './cardio'
import { sleepScore, lastNightSleep, scoreNight, recoveryState } from './sleep'
import { dayTotals, calorieTarget, calorieBreakdown, PROTEIN_TARGET_DEFAULT, proteinRange, proteinStatus, mealProteinDistribution, intakeAverages, dayCritique, recommend, defaultLocation } from './diet'

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

// The lenses, in priority order. `build` returns the scoped payload; `prompt` is
// the tailored coaching question that ships above it. Keep prompts directive and
// guarded (never advise cutting calories under a protein floor, etc.).
export const EXPORT_LENSES = [
  {
    id: 'day', label: 'Grade my day', blurb: 'Today across diet, training & recovery',
    prompt: "You are my elite, evidence-based physique and health coach. Below is everything I logged TODAY, plus my goals and recent baselines. Grade my day out of 10 on each of (1) diet, (2) training & movement, (3) recovery, then give me the SINGLE highest-impact change to make tomorrow. Be direct and cite my actual numbers. Do NOT tell me to eat less if my protein is under target or my calories are already low.",
    build: (state, today) => ({
      goals: goalContext(state),
      diet: todayDietBlock(state, today),
      training: trainingBlock(state, today),
      recovery: recoveryBlock(state, today),
    }),
  },
  {
    id: 'diet', label: 'Judge my diet', blurb: "Today's food + protein spread + 14-day trend",
    prompt: "You are an evidence-based physique-nutrition coach. Below is my nutrition TODAY (with the per-meal protein split), my 14-day averages, and my protein range + calorie ceiling. Tell me: did I hit protein without overshooting calories today? Is my protein well distributed across meals or bunched? What SPECIFICALLY should I eat differently tomorrow to keep losing fat while holding muscle? Never recommend lowering calories if my protein is under the floor, or if my calories are already under ~1600.",
    build: (state, today) => ({ goals: goalContext(state), diet: todayDietBlock(state, today), calories: calorieBreakdown(state) }),
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
    id: 'full', label: 'Full deep-dive', blurb: 'The complete snapshot — everything',
    prompt: STATS_PROMPT,
    build: (state, today) => buildStatsExport(state, today, null),
  },
]
