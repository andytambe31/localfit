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
import { sleepScore, lastNightSleep, scoreNight } from './sleep'
import { dayTotals, calorieTarget, PROTEIN_TARGET_DEFAULT, proteinRange, proteinStatus } from './diet'

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
