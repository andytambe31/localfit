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
import { cardioMinutesInWindow, restingHrTrend } from './cardio'
import { sleepScore } from './sleep'
import { dayTotals, calorieTarget, PROTEIN_TARGET_DEFAULT } from './diet'

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

export function buildStatsExport(state, today, generatedAt) {
  const profile = state.profile || {}
  const R = buildReview(state, today)
  const bf = R.bodyFat, pace = R.pacing
  const lifts = bestLifts(state).filter((l) => l.best).map((l) => ({
    lift: l.name, weightLb: l.best.weight, reps: l.best.reps, e1rmLb: Math.round(l.best.e1rm), gainedLb: l.trend, sessions: l.sessions,
  }))
  const goals = strengthGoalsFor(state, today).map((g) => ({
    name: g.name, current: g.current, target: g.target, unit: g.unit, onPace: g.achieved ? true : g.onPace, deadline: g.deadline,
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
      paceVerdict: pace.verdict,
    },
    training: {
      sessionsPerWeekTarget: profile.gymTargetPerWeek || 3,
      bestLifts: lifts,
      strengthGoals: goals,
      recentSessions: recentSessions(state, 6),
    },
    cardio: {
      weeklyZone2Min: cardioMinutesInWindow(state.days || {}, today, 7),
      weeklyTargetMin: profile.cardioTargetPerWeek || 150,
      restingHrBpm: hr?.latest ?? null,
      restingHrDeltaVsMonth: hr?.delta ?? null,
    },
    sleep: { score10: sleepScore(state, today, profile) },
    diet: {
      proteinTargetG: profile.proteinTarget || PROTEIN_TARGET_DEFAULT,
      avgProteinG14d: diet.avgProteinG,
      avgCalories14d: diet.avgCalories,
      daysLogged14d: diet.daysLogged,
      calorieCeiling: ct?.ceiling ?? null,
    },
    consistency: {
      currentStreakDays: R.momentum.streak,
      strongDaysLast14: R.momentum.strong14,
      strongDaysLast30: R.momentum.strong30,
      pillarScores10: pillars,
      overallScore10: R.overall,
    },
    projections: (R.milestones?.rows || []).map((m) => ({
      label: m.label, date: m.dateIso,
      weightKg: m.weightLow === m.weightHigh ? m.weightLow : [m.weightLow, m.weightHigh],
      bodyFatPct: m.bfLow == null ? null : (m.bfLow === m.bfHigh ? m.bfLow : [m.bfLow, m.bfHigh]),
    })),
    coachAssessment: { standing: R.verdictWord, summary: R.topline, wins: R.wins, gaps: R.gaps, plan: R.pacePlan },
  }
}
