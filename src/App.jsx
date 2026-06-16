import { useCallback, useEffect, useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

/* ---------- data layer: localStorage-first, best-effort backend mirror ---------- */
const LS_KEY = 'localfit-state'
const DEFAULT_STATE = {
  profile: { name: 'Aniruddha', stepTarget: 10000, gymTargetPerWeek: 3, waterTarget: 8, bodyFatTarget: 12, bodyFatDeadline: '2026-12-31' },
  days: {},
  weightLog: [],
  bodyFatLog: [],
}
const ensureProfile = (p = {}) => { p.waterTarget ??= 8; p.bodyFatTarget ??= 12; p.bodyFatDeadline ??= '2026-12-31'; return p }
const loadLocal = () => { try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : null } catch { return null } }
const saveLocal = (s) => { try { localStorage.setItem(LS_KEY, JSON.stringify(s)) } catch { /* quota */ } }
const clone = (o) => JSON.parse(JSON.stringify(o))
const defaultDay = () => ({
  steps: 0, workout: { did: false, type: '' }, weight: null,
  routines: { skincareAM: false, skincarePM: false, haircare: false },
  water: 0, meals: { breakfast: null, lunch: null, dinner: null }, mealNote: '',
})
function deepMerge(t, p) {
  for (const [k, v] of Object.entries(p || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) t[k] = deepMerge(t[k] && typeof t[k] === 'object' ? t[k] : {}, v)
    else t[k] = v
  }
  return t
}
const isoToday = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
let _syncTimer = null

export default function App() {
  const [state, setState] = useState(null)
  const today = isoToday()
  const now = new Date(); const hour = now.getHours(); const minute = now.getMinutes()
  const [override, setOverride] = useState(null)

  // Push the local copy to the backend and adopt the merged truth. No-op offline.
  const doSync = useCallback(async () => {
    const local = loadLocal(); if (!local) return
    try {
      const res = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(local) })
      if (!res.ok) return
      const merged = await res.json()
      saveLocal(merged); setState(merged)
    } catch { /* offline — keep working from localStorage, sync later */ }
  }, [])
  const scheduleSync = useCallback(() => { clearTimeout(_syncTimer); _syncTimer = setTimeout(doSync, 1500) }, [doSync])

  useEffect(() => {
    const local = loadLocal()
    if (local) {
      ensureProfile(local.profile ||= {})
      setState(local)
      doSync() // push offline changes, pull merged truth
    } else {
      // No local copy (first run, or it was lost/cleared) → restore from the backend.
      fetch('/api/state').then((r) => (r.ok ? r.json() : null)).then((b) => {
        const init = b || DEFAULT_STATE; ensureProfile(init.profile ||= {})
        setState(init); saveLocal(init)
      }).catch(() => { setState(DEFAULT_STATE); saveLocal(DEFAULT_STATE) })
    }
    const onOnline = () => doSync()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [doSync])

  function patch(p) {
    setState((prev) => {
      const next = clone(prev)
      next.days[today] = next.days[today] || defaultDay()
      deepMerge(next.days[today], p)
      next.days[today]._ts = Date.now()
      saveLocal(next)
      return next
    })
    setOverride(null)
    scheduleSync()
  }
  function saveWeight(kg) {
    setState((prev) => {
      const next = clone(prev)
      next.days[today] = next.days[today] || defaultDay()
      next.days[today].weight = kg
      next.days[today]._ts = Date.now()
      next.weightLog = next.weightLog || []
      const e = next.weightLog.find((w) => w.date === today)
      if (e) e.kg = kg; else next.weightLog.push({ date: today, kg })
      next.weightLog.sort((a, b) => a.date.localeCompare(b.date))
      saveLocal(next)
      return next
    })
    setOverride(null)
    scheduleSync()
  }
  function saveBodyFat(pct) {
    setState((prev) => {
      const next = clone(prev)
      next.bodyFatLog = next.bodyFatLog || []
      const e = next.bodyFatLog.find((x) => x.date === today)
      if (e) e.pct = pct; else next.bodyFatLog.push({ date: today, pct })
      next.bodyFatLog.sort((a, b) => a.date.localeCompare(b.date))
      saveLocal(next)
      return next
    })
    scheduleSync()
  }
  function updateProfile(p) {
    setState((prev) => {
      const next = clone(prev)
      next.profile = { ...next.profile, ...p }
      saveLocal(next)
      return next
    })
    scheduleSync()
  }

  const day = useMemo(() => (state ? { ...defaultDay(), ...(state.days?.[today] || {}) } : null), [state, today])
  if (!state || !day) return <Centered>…</Centered>

  const { profile } = state
  const r = day.routines, w = day.workout, meals = day.meals || {}
  const coach = buildCoach({ hour, minute, day, profile })
  const focus = override || coach.action?.target || null

  const areas = [
    { id: 'skin', label: 'Skin', done: r.skincareAM && (hour < 17 || r.skincarePM) },
    { id: 'movement', label: 'Move', done: w.did },
    { id: 'diet', label: 'Diet', done: dietDone(hour, meals) },
    { id: 'water', label: 'Water', done: (day.water || 0) >= profile.waterTarget },
    { id: 'hair', label: 'Hair', done: r.haircare },
  ]

  const setWater = (delta) => patch({ water: Math.max(0, (day.water || 0) + delta) })

  return (
    <div className="mx-auto max-w-xl px-5 pb-16 pt-7">
      <div className="mb-5 flex items-baseline justify-between">
        <span className="font-display text-lg font-semibold tracking-tight text-[#20201d]">localfit</span>
        <span className="text-[11px] uppercase tracking-[0.18em] text-[#a39c8d]">{prettyToday(today)}</span>
      </div>

      {/* The coach speaks — directive, one thing at a time */}
      <section className="rounded-[28px] bg-[#23291f] px-6 py-7 shadow-[0_18px_40px_-24px_rgba(35,41,31,0.7)]">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#9aa581]">{coach.eyebrow}</p>
        <h1 className="font-display mt-3 text-[26px] font-semibold leading-[1.16] text-[#f4f1e8]">{coach.headline}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[#cfccba]">{coach.support}</p>
      </section>

      {focus ? (
        <FocusCard
          focus={focus} day={day} profile={profile} hour={hour} weightLog={state.weightLog || []}
          onSkin={(k) => patch({ routines: { [k]: !r[k] } })}
          onSteps={(v) => patch({ steps: v })}
          onTrain={(opt) => patch({ workout: { did: opt !== 'Rest', type: opt } })}
          onHair={() => patch({ routines: { haircare: !r.haircare } })}
          onMeal={(meal, val) => patch({ meals: { [meal]: meals[meal] === val ? null : val } })}
          onNote={(text) => patch({ mealNote: text })}
          onWater={setWater}
          onWeight={saveWeight} />
      ) : (
        <div className="mt-5 rounded-3xl border border-[#e6dfd0] bg-[#fbf9f3] p-6 text-center">
          <p className="font-display text-lg text-[#23211c]">Nothing for you right now.</p>
          <p className="mt-1 text-sm text-[#8a8474]">You’re on top of it. Come back when it’s time for the next move.</p>
        </div>
      )}

      {/* Quiet progress — tap any to jump, no pressure */}
      <div className="mt-6">
        <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-[#a39c8d]">Today</p>
        <div className="grid grid-cols-5 gap-2">
          {areas.map((a) => (
            <button key={a.id} onClick={() => setOverride(a.id)}
              className={`rounded-2xl border px-1 py-3 text-center transition ${
                focus === a.id ? 'border-[#3d4a32] bg-[#eef0e6]' : 'border-[#e6dfd0] bg-[#fbf9f3] hover:bg-[#f3efe6]'
              }`}>
              <span className={`mx-auto mb-1.5 block h-2 w-2 rounded-full ${a.done ? 'bg-[#3d4a32]' : 'bg-[#d8d1c2]'}`} />
              <span className="text-[12px] font-medium text-[#4a463c]">{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      <GoalsSection state={state} profile={profile} today={today} onBodyFat={saveBodyFat} onProfile={updateProfile} />

      <p className="mt-9 text-center text-[12px] text-[#a39c8d]">Consistency over intensity. One step at a time.</p>
    </div>
  )
}

/* ---------- the focused step ---------- */
const FOCUS_TITLE = { skin: 'Skin care', movement: 'Movement', hair: 'Hair care', diet: 'Today’s food', water: 'Hydration' }
const MEAL_AFTER = { breakfast: 5, lunch: 11, dinner: 16 }

function FocusCard({ focus, day, profile, hour, weightLog, onSkin, onSteps, onTrain, onHair, onMeal, onNote, onWater, onWeight }) {
  const r = day.routines, w = day.workout, meals = day.meals || {}
  return (
    <section className="mt-5 rounded-3xl border border-[#e6dfd0] bg-[#fbf9f3] p-5 shadow-[0_2px_10px_-6px_rgba(60,55,40,0.25)]">
      <h2 className="font-display mb-3 text-xl font-semibold text-[#23211c]">{FOCUS_TITLE[focus]}</h2>

      {focus === 'skin' && (
        <div className="flex gap-2">
          <Chip on={r.skincareAM} onClick={() => onSkin('skincareAM')}>Morning</Chip>
          <Chip on={r.skincarePM} disabled={hour < 17} hint="this evening" onClick={() => onSkin('skincarePM')}>Evening</Chip>
        </div>
      )}

      {focus === 'hair' && <Chip on={r.haircare} onClick={onHair}>Done today</Chip>}

      {focus === 'water' && (
        <div>
          <div className="flex items-center justify-center gap-6">
            <RoundBtn onClick={() => onWater(-1)}>−</RoundBtn>
            <div className="text-center">
              <div className="font-display text-4xl font-semibold text-[#23211c]">{day.water || 0}</div>
              <div className="text-xs text-[#8a8474]">of {profile.waterTarget} glasses</div>
            </div>
            <RoundBtn onClick={() => onWater(1)}>+</RoundBtn>
          </div>
          <div className="mt-4 flex justify-center gap-1.5">
            {Array.from({ length: profile.waterTarget }).map((_, i) => (
              <span key={i} className={`h-2.5 w-2.5 rounded-full ${i < (day.water || 0) ? 'bg-[#3d4a32]' : 'bg-[#e0d9c9]'}`} />
            ))}
          </div>
        </div>
      )}

      {focus === 'diet' && (
        <div className="space-y-2.5">
          {['breakfast', 'lunch', 'dinner'].map((meal) => {
            const enabled = hour >= MEAL_AFTER[meal]
            const val = meals[meal]
            return (
              <div key={meal} className="flex items-center justify-between">
                <span className={`text-sm capitalize ${enabled ? 'text-[#3a382f]' : 'text-[#bdb6a5]'}`}>{meal}</span>
                <div className="flex gap-2">
                  <Chip small on={val === 'on'} disabled={!enabled} onClick={() => onMeal(meal, 'on')}>On plan</Chip>
                  <Chip small on={val === 'off'} disabled={!enabled} onClick={() => onMeal(meal, 'off')}>Off</Chip>
                </div>
              </div>
            )
          })}
          <input defaultValue={day.mealNote || ''} placeholder="Note what you ate (optional)"
            onBlur={(e) => onNote(e.target.value)}
            className="mt-2 w-full rounded-xl border border-[#ddd5c5] bg-white px-3 py-2 text-sm text-[#23211c] outline-none placeholder:text-[#b3ac9c] focus:border-[#3d4a32]" />
        </div>
      )}

      {focus === 'movement' && (
        <div className="space-y-3">
          <Field label="Steps today">
            <NumInput value={day.steps || ''} placeholder={String(profile.stepTarget)} onCommit={onSteps} />
            <span className="text-[13px] text-[#8a8474]">of {profile.stepTarget.toLocaleString()}</span>
          </Field>
          <div>
            <p className="mb-2 text-[13px] text-[#6f6a5d]">Today’s training</p>
            <div className="flex flex-wrap gap-2">
              {['Weights', 'Cardio', 'Walk', 'Rest'].map((opt) => <Chip key={opt} small on={w.type === opt} onClick={() => onTrain(opt)}>{opt}</Chip>)}
            </div>
          </div>
          <Field label="Bodyweight">
            <NumInput value={day.weight ?? ''} placeholder="kg" step="0.1" onCommit={onWeight} />
            {day.weight != null && <span className="text-[13px] text-[#5b6745]">recorded</span>}
          </Field>
          {weightLog.length >= 2 && <WeightChart log={weightLog} />}
        </div>
      )}
    </section>
  )
}

/* ---------- coach: authoritative, time + state aware ---------- */
function dietDone(hour, meals) {
  const need = hour < 11 ? ['breakfast'] : hour < 16 ? ['breakfast', 'lunch'] : ['breakfast', 'lunch', 'dinner']
  return need.every((m) => meals[m] != null)
}
function expectedWater(hour, target) {
  if (hour < 11) return Math.round(target * 0.25)
  if (hour < 16) return Math.round(target * 0.5)
  if (hour < 21) return Math.round(target * 0.8)
  return target
}
function buildCoach({ hour, minute, day, profile }) {
  const r = day.routines, w = day.workout, meals = day.meals || {}
  const steps = day.steps || 0, target = profile.stepTarget, water = day.water || 0, wTarget = profile.waterTarget
  const trained = w.did && w.type !== 'Rest'
  const t = fmtTime(hour, minute)
  const eyebrow = `Today — ${t}`
  const phase = hour < 5 ? 'latenight' : hour < 12 ? 'morning' : hour < 17 ? 'midday' : hour < 21 ? 'evening' : 'night'

  if (phase === 'latenight')
    return { eyebrow, headline: `It’s ${t}. Go to bed.`, support: `Nothing good for your goals happens past midnight. Sleep is when fat burns and muscle repairs — get to it.`, action: null }

  if (phase === 'morning') {
    if (water < 1) return { eyebrow, headline: `Drink a glass of water. Now.`, support: `Hydrate before anything else — it’s the easiest win of the day, and it wakes you up.`, action: { target: 'water' } }
    if (!r.skincareAM) return { eyebrow, headline: `Do your morning skincare.`, support: `Two minutes. Get it done and keep the streak alive.`, action: { target: 'skin' } }
    if (meals.breakfast == null) return { eyebrow, headline: `Log your breakfast.`, support: `On plan or not — be honest. The first meal sets the tone for the whole day.`, action: { target: 'diet' } }
    if (!trained) return { eyebrow, headline: `Decide when you’re training today.`, support: `Three sessions a week is the floor for holding muscle while you cut. Commit to a time.`, action: { target: 'movement' } }
    return { eyebrow, headline: `Good start. Keep moving.`, support: `Steps ticking, water going. Don’t coast — the day is yours to win.`, action: { target: 'movement' } }
  }
  if (phase === 'midday') {
    if (meals.lunch == null) return { eyebrow, headline: `Log your lunch.`, support: `Tell me straight — on plan or off. That’s how we keep the trend honest.`, action: { target: 'diet' } }
    if (water < expectedWater(hour, wTarget)) return { eyebrow, headline: `You’re at ${water} of ${wTarget} glasses. Drink up.`, support: `You’re behind on water for midday. Get a glass in before you forget.`, action: { target: 'water' } }
    if (steps < target * 0.4) return { eyebrow, headline: `Only ${steps.toLocaleString()} steps so far. Get on your feet.`, support: `Ten minutes of walking now beats cramming it after dark.`, action: { target: 'movement' } }
    if (!trained) return { eyebrow, headline: `Train this afternoon. Don’t push it to tonight.`, support: `A session now protects your muscle and your deficit. Lock it in.`, action: { target: 'movement' } }
    return { eyebrow, headline: `Strong midday. Hold the line.`, support: `You’re on track. Stay sharp through the afternoon.`, action: null }
  }
  if (phase === 'evening') {
    if (steps < target * 0.6) return { eyebrow, headline: `It’s ${t} and you’re at ${steps.toLocaleString()} of ${target.toLocaleString()} steps.`, support: `Get a 30–40 minute walk in — now, not later. This is exactly where steady fat loss is won.`, action: { target: 'movement' } }
    if (!trained) return { eyebrow, headline: `You still haven’t trained. Thirty minutes. Go.`, support: `Even a short lifting session protects muscle while you’re cutting. Show up.`, action: { target: 'movement' } }
    if (meals.dinner == null) return { eyebrow, headline: `Log your dinner.`, support: `Be honest with it. Dinner is where most days are won or lost.`, action: { target: 'diet' } }
    if (water < wTarget) return { eyebrow, headline: `Finish your water — ${water} of ${wTarget}.`, support: `Don’t go to bed short on hydration. Knock out the rest now.`, action: { target: 'water' } }
    if (!r.skincarePM) return { eyebrow, headline: `Do your evening skincare.`, support: `Close the loop on the day. Your skin repairs overnight.`, action: { target: 'skin' } }
    return { eyebrow, headline: `You’ve handled today.`, support: `Skin, training, food, water — all tended. This is what consistency looks like.`, action: null }
  }
  // night 21–24
  if (!r.skincarePM) return { eyebrow, headline: `Evening skincare, then start winding down.`, support: `Last thing for the day. After this, the priority is sleep.`, action: { target: 'skin' } }
  if (meals.dinner == null) return { eyebrow, headline: `Log dinner before you forget.`, support: `One tap. Then close out the day.`, action: { target: 'diet' } }
  return { eyebrow, headline: `That’s a full day. Be in bed soon.`, support: `Recovery is non-negotiable. Weigh in first thing tomorrow — we track the trend, not the noise.`, action: null }
}
function fmtTime(h, m) { const ap = h < 12 ? 'AM' : 'PM'; const hr = ((h + 11) % 12) + 1; return `${hr}:${String(m).padStart(2, '0')} ${ap}` }

/* ---------- UI atoms ---------- */
function Chip({ on, disabled, onClick, children, hint, small }) {
  const pad = small ? 'px-3 py-1.5 text-[13px]' : 'px-4 py-2.5 text-sm'
  if (disabled) return <span className={`rounded-full border border-[#e8e2d4] bg-[#f4f1ea] ${pad} text-[#c1baa9]`}>{children}{hint ? ` · ${hint}` : ''}</span>
  return (
    <button onClick={onClick}
      className={`rounded-full font-medium transition active:scale-95 ${pad} ${
        on ? 'bg-[#3d4a32] text-[#f4f1e8]' : 'border border-[#e0d9c9] bg-[#f3efe6] text-[#4a463c] hover:bg-[#ebe6da]'
      }`}>{children}</button>
  )
}
function RoundBtn({ onClick, children }) {
  return <button onClick={onClick} className="flex h-12 w-12 items-center justify-center rounded-full border border-[#d8d1c2] bg-white text-2xl text-[#3d4a32] active:scale-95">{children}</button>
}
function Field({ label, children }) {
  return <div className="flex items-center gap-3"><span className="w-28 text-[13px] text-[#6f6a5d]">{label}</span>{children}</div>
}
function NumInput({ value, placeholder, step, onCommit }) {
  return <input type="number" step={step} placeholder={placeholder} defaultValue={value} key={value === '' ? 'e' : value}
    onBlur={(e) => e.target.value !== '' && onCommit(Number(e.target.value))}
    className="w-24 rounded-xl border border-[#ddd5c5] bg-white px-3 py-1.5 text-sm text-[#23211c] outline-none focus:border-[#3d4a32]" />
}
function WeightChart({ log }) {
  return (
    <ResponsiveContainer width="100%" height={130}>
      <LineChart data={log} margin={{ top: 6, right: 8, bottom: 0, left: -24 }}>
        <XAxis dataKey="date" tick={{ fill: '#a39c8d', fontSize: 10 }} tickFormatter={(d) => d.slice(5)} axisLine={{ stroke: '#e0d9c9' }} tickLine={false} />
        <YAxis domain={['auto', 'auto']} tick={{ fill: '#a39c8d', fontSize: 10 }} width={32} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={{ background: '#23291f', border: 'none', borderRadius: 12, color: '#f4f1e8', fontSize: 12 }} />
        <Line type="monotone" dataKey="kg" stroke="#3d4a32" strokeWidth={2.5} dot={{ r: 3, fill: '#3d4a32' }} />
      </LineChart>
    </ResponsiveContainer>
  )
}
/* ---------- goals: your personal outcomes, quantified, in words ---------- */
const shiftIso = (iso, delta) => {
  const [y, m, d] = iso.split('-').map(Number)
  const nd = new Date(new Date(y, m - 1, d).getTime() + delta * 86400000)
  const p = (n) => String(n).padStart(2, '0')
  return `${nd.getFullYear()}-${p(nd.getMonth() + 1)}-${p(nd.getDate())}`
}
function countLastN(days, today, n, pred) {
  let c = 0
  for (let i = 0; i < n; i++) { const d = days[shiftIso(today, -i)]; if (d && pred(d)) c++ }
  return c
}

const ratio10 = (count, fullAt) => Math.max(0, Math.min(10, Math.round((count / fullAt) * 10)))
function bodyFatScore(log, today) {
  if (!log.length) return 0
  const daysSince = Math.floor((Date.parse(today) - Date.parse(log[log.length - 1].date)) / 86400000)
  if (daysSince <= 14) return 10
  if (daysSince <= 28) return 6
  return 3
}

function GoalsSection({ state, profile, today, onBodyFat, onProfile }) {
  const [estimating, setEstimating] = useState(false)
  const days = state.days || {}
  const log = state.bodyFatLog || []
  const latest = log[log.length - 1]
  const target = profile.bodyFatTarget || 12
  const deadline = profile.bodyFatDeadline || '2026-12-31'
  const daysLeft = Math.max(0, Math.ceil((Date.parse(deadline) - Date.parse(today)) / 86400000))

  const skinDays = countLastN(days, today, 14, (d) => d.routines?.skincareAM && d.routines?.skincarePM)
  const hairDays = countLastN(days, today, 14, (d) => d.routines?.haircare)
  const skinScore = ratio10(skinDays, 12)
  const hairScore = ratio10(hairDays, 4)
  const bfScore = bodyFatScore(log, today)

  // Top-level: weighted toward the primary goal (body fat).
  const overall = +(0.5 * bfScore + 0.3 * skinScore + 0.2 * hairScore).toFixed(1)
  const word = overall >= 8 ? 'Dialed in' : overall >= 6 ? 'On track' : overall >= 4 ? 'Slipping' : 'Off track'
  const weakest = [
    { s: bfScore, msg: 'Log your body fat — that’s holding your score back.' },
    { s: skinScore, msg: 'Tighten up your skincare consistency.' },
    { s: hairScore, msg: 'Stay on your hair-care schedule.' },
  ].sort((a, b) => a.s - b.s)[0]
  const note = overall >= 8 ? 'You’re doing the work. Keep it up.' : weakest.msg

  let bfStatus = null
  if (latest) {
    const toGo = +(latest.pct - target).toFixed(1)
    bfStatus = toGo > 0
      ? `Now ${latest.pct}% (${fmtMD(latest.date)}) — ${toGo} to go. Stay consistent and it keeps coming.`
      : `Now ${latest.pct}% (${fmtMD(latest.date)}) — target reached. Hold it.`
  }

  return (
    <section className="mt-6 rounded-3xl border border-[#e6dfd0] bg-[#fbf9f3] p-5 shadow-[0_2px_10px_-6px_rgba(60,55,40,0.25)]">
      <h2 className="font-display text-xl font-semibold text-[#23211c]">Your goals</h2>

      {/* Top-level on-track score */}
      <div className="mt-3 rounded-2xl bg-[#23291f] px-4 py-3.5">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-[#9aa581]">On track</p>
            <p className="font-display text-3xl font-semibold leading-none text-[#f4f1e8]">{overall}<span className="text-lg text-[#9aa581]">/10</span></p>
          </div>
          <span className="text-[13px] font-medium text-[#cfccba]">{word}</span>
        </div>
        <p className="mt-2 text-[13px] text-[#cfccba]">{note}</p>
      </div>

      {/* Body fat */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <p className="text-[15px] font-semibold text-[#23211c]">Reach {target}% body fat</p>
          {latest && <span className="text-[14px] font-semibold text-[#3d4a32]">{latest.pct}%</span>}
        </div>
        <p className="text-[13px] text-[#8a8474]">By {fmtFull(deadline)} · {daysLeft} days left</p>
        {bfStatus && <p className="mt-1.5 text-[14px] leading-relaxed text-[#3d4a32]">{bfStatus}</p>}
        <button onClick={() => setEstimating(true)} className="mt-3 rounded-full bg-[#3d4a32] px-4 py-2 text-[13px] font-medium text-[#f4f1e8] active:scale-95">
          {latest ? 'Re-estimate body fat' : 'Estimate body fat'}
        </button>
      </div>

      {/* Clear skin */}
      <div className="mt-4 border-t border-[#ece6da] pt-4">
        <div className="flex items-baseline justify-between">
          <p className="text-[15px] font-semibold text-[#23211c]">Clear skin</p>
          <span className="text-[14px] font-semibold text-[#3d4a32]">{skinScore}/10</span>
        </div>
        <p className="text-[13px] text-[#8a8474]">Full AM + PM routine — {skinDays} of the last 14 days.</p>
      </div>

      {/* Healthy hair */}
      <div className="mt-4 border-t border-[#ece6da] pt-4">
        <div className="flex items-baseline justify-between">
          <p className="text-[15px] font-semibold text-[#23211c]">Healthy hair</p>
          <span className="text-[14px] font-semibold text-[#3d4a32]">{hairScore}/10</span>
        </div>
        <p className="text-[13px] text-[#8a8474]">Care sessions — {hairDays} over the last 14 days.</p>
      </div>

      {estimating && (
        <BodyFatModal profile={profile} onClose={() => setEstimating(false)}
          onSave={(pct, patch) => { onBodyFat(pct); onProfile(patch); setEstimating(false) }} />
      )}
    </section>
  )
}

/* ---------- body-fat estimator (US Navy method) ---------- */
const round1 = (n) => Math.round(n * 10) / 10
const clampBf = (b) => Math.max(3, Math.min(60, round1(b)))
function estimateBodyFat({ sex, height, neck, waist, hip }) {
  if (!(height > 0 && neck > 0 && waist > 0)) return null
  if (sex === 'female') {
    if (!(hip > 0) || waist + hip - neck <= 0) return null
    return clampBf(495 / (1.29579 - 0.35004 * Math.log10(waist + hip - neck) + 0.22100 * Math.log10(height)) - 450)
  }
  if (waist - neck <= 0) return null
  return clampBf(495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(height)) - 450)
}
function bfCategory(pct, sex) {
  const m = [[6, 'Essential'], [14, 'Athletic'], [18, 'Fitness'], [25, 'Average']]
  const f = [[14, 'Essential'], [21, 'Athletic'], [25, 'Fitness'], [32, 'Average']]
  for (const [lim, name] of (sex === 'female' ? f : m)) if (pct < lim) return name
  return 'High'
}

function BodyFatModal({ profile, onClose, onSave }) {
  const [sex, setSex] = useState(profile.sex || 'male')
  const [unit, setUnit] = useState('cm')
  const [height, setHeight] = useState(profile.height ? String(round1(profile.height)) : '')
  const [neck, setNeck] = useState('')
  const [waist, setWaist] = useState('')
  const [hip, setHip] = useState('')

  const toCm = (v) => (unit === 'in' ? Number(v) * 2.54 : Number(v))
  const switchUnit = (u) => {
    if (u === unit) return
    const conv = (x) => (x === '' ? '' : String(round1(u === 'in' ? Number(x) / 2.54 : Number(x) * 2.54)))
    setHeight(conv(height)); setNeck(conv(neck)); setWaist(conv(waist)); setHip(conv(hip))
    setUnit(u)
  }
  const est = estimateBodyFat({ sex, height: toCm(height), neck: toCm(neck), waist: toCm(waist), hip: toCm(hip) })

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-3xl bg-[#f4f1ea] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-display text-2xl font-semibold text-[#23211c]">Estimate body fat</h3>
            <p className="mt-1 text-[13px] text-[#8a8474]">A few tape measurements — the US Navy method does the math.</p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none text-[#a39c8d]">×</button>
        </div>

        <div className="mt-4 flex gap-2">
          <Chip small on={sex === 'male'} onClick={() => setSex('male')}>Male</Chip>
          <Chip small on={sex === 'female'} onClick={() => setSex('female')}>Female</Chip>
          <span className="flex-1" />
          <Chip small on={unit === 'cm'} onClick={() => switchUnit('cm')}>cm</Chip>
          <Chip small on={unit === 'in'} onClick={() => switchUnit('in')}>in</Chip>
        </div>

        <MeasureInput label="Height" unit={unit} value={height} onChange={setHeight} />
        <MeasureInput label="Neck" unit={unit} value={neck} onChange={setNeck} hint="Just below the larynx, tape sloping slightly down to the front." />
        <MeasureInput label="Waist" unit={unit} value={waist} onChange={setWaist} hint="At navel level, relaxed — don’t suck in." />
        {sex === 'female' && <MeasureInput label="Hip" unit={unit} value={hip} onChange={setHip} hint="At the widest point." />}

        <div className="mt-5 rounded-2xl bg-[#23291f] px-5 py-4 text-center">
          {est != null ? (
            <>
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#9aa581]">Estimated body fat</p>
              <p className="font-display text-4xl font-semibold text-[#f4f1e8]">{est}%</p>
              <p className="mt-0.5 text-[13px] text-[#cfccba]">{bfCategory(est, sex)}</p>
            </>
          ) : (
            <p className="text-[13px] text-[#9aa581]">Enter your measurements to see the estimate.</p>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-full border border-[#d8d1c2] bg-white py-2.5 text-sm font-medium text-[#4a463c]">Cancel</button>
          <button disabled={est == null} onClick={() => onSave(est, { height: Math.round(toCm(height)), sex })}
            className="flex-1 rounded-full bg-[#3d4a32] py-2.5 text-sm font-semibold text-[#f4f1e8] disabled:opacity-40">Save to goal</button>
        </div>
      </div>
    </div>
  )
}
function MeasureInput({ label, unit, value, onChange, hint }) {
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between">
        <label className="text-sm font-medium text-[#23211c]">{label}</label>
        <span className="text-[11px] text-[#a39c8d]">{unit}</span>
      </div>
      <input type="number" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0"
        className="mt-1 w-full rounded-xl border border-[#ddd5c5] bg-white px-3 py-2 text-[#23211c] outline-none focus:border-[#3d4a32]" />
      {hint && <p className="mt-1 text-[11px] leading-snug text-[#a39c8d]">{hint}</p>}
    </div>
  )
}
function fmtMD(iso) {
  const [, m, d] = iso.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[m - 1]} ${d}`
}
function fmtFull(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[m - 1]} ${d}, ${y}`
}

function Centered({ children }) { return <div className="flex min-h-screen items-center justify-center px-6 text-center text-[#8a8474]">{children}</div> }
function prettyToday(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[m - 1]} ${d} · ${y}`
}
