/* ---------- adaptive weekly check-in (pure) ---------------------------------
 * Reads real outcomes — weight trend, lifting PRs, routine adherence — and
 * proposes concrete plan changes to keep December on track. Runs at most weekly.
 * Returns { due, findings[], changes } where `changes` is a profile patch the
 * user applies with one tap (auto-computed, visible, reversible).
 * -------------------------------------------------------------------------- */
import { recentSessions } from './train'

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

export function weeklyCheckin(state, today) {
  const profile = state.profile || {}
  const last = profile.lastCheckin
  const daysSince = last ? (day(today) - day(last)) / 86400000 : 999
  const findings = []
  const changes = {}

  // --- fat loss: trend vs the pace you need ---------------------------------
  const trend = weightTrend(state)
  const need = neededRate(state, today)
  if (trend && need != null && need > 0) {
    const losing = -trend.perWeek // positive when dropping
    if (losing < need * 0.6) {
      const stepTarget = (profile.stepTarget || 10000) + 1500
      const deficit = Math.min(750, (profile.deficit || 500) + 100)
      findings.push({ area: 'Fat loss', tone: 'warn',
        text: `Losing ~${Math.max(0, losing).toFixed(2)} kg/wk but you need ~${need.toFixed(2)} for December. I'll raise your step goal to ${stepTarget.toLocaleString()} and tighten calories (~${deficit} deficit).` })
      changes.stepTarget = stepTarget
      changes.deficit = deficit
    } else {
      findings.push({ area: 'Fat loss', tone: 'good',
        text: `On pace — losing ~${Math.max(0, losing).toFixed(2)} kg/wk against ~${need.toFixed(2)} needed. Hold steady.` })
    }
  }

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
