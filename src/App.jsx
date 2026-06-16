import { useEffect, useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

/* ---------- data layer: localStorage-first, best-effort backend mirror ---------- */
const LS_KEY = 'localfit-state'
const DEFAULT_STATE = {
  profile: { name: 'Aniruddha', goals: ['Fat loss', 'Muscle growth'], stepTarget: 10000, gymTargetPerWeek: 3 },
  days: {},
  weightLog: [],
}
const loadLocal = () => { try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : null } catch { return null } }
const saveLocal = (s) => { try { localStorage.setItem(LS_KEY, JSON.stringify(s)) } catch { /* quota */ } }
const clone = (o) => JSON.parse(JSON.stringify(o))
const defaultDay = () => ({ steps: 0, workout: { did: false, type: '' }, weight: null, routines: { skincareAM: false, skincarePM: false, haircare: false }, diet: { quality: null } })
function deepMerge(t, p) {
  for (const [k, v] of Object.entries(p || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) t[k] = deepMerge(t[k] && typeof t[k] === 'object' ? t[k] : {}, v)
    else t[k] = v
  }
  return t
}

const isoToday = () => {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export default function App() {
  const [state, setState] = useState(null)
  const today = isoToday()
  const now = new Date(); const hour = now.getHours(); const minute = now.getMinutes()
  const [override, setOverride] = useState(null) // user-chosen focus, else follow the coach

  // Load: localStorage first (works offline), else seed from backend, else defaults.
  useEffect(() => {
    const local = loadLocal()
    if (local) { setState(local); return }
    fetch('/api/state').then((r) => (r.ok ? r.json() : null)).then((b) => {
      const init = b || DEFAULT_STATE; setState(init); saveLocal(init)
    }).catch(() => { setState(DEFAULT_STATE); saveLocal(DEFAULT_STATE) })
  }, [])

  function patch(p) {
    setState((prev) => {
      const next = clone(prev)
      next.days[today] = next.days[today] || defaultDay()
      deepMerge(next.days[today], p)
      saveLocal(next)
      fetch('/api/day', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: today, patch: p }) }).catch(() => {})
      return next
    })
    setOverride(null)
  }
  function saveWeight(kg) {
    setState((prev) => {
      const next = clone(prev)
      next.days[today] = next.days[today] || defaultDay()
      next.days[today].weight = kg
      next.weightLog = next.weightLog || []
      const e = next.weightLog.find((w) => w.date === today)
      if (e) e.kg = kg; else next.weightLog.push({ date: today, kg })
      next.weightLog.sort((a, b) => a.date.localeCompare(b.date))
      saveLocal(next)
      fetch('/api/weight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: today, kg }) }).catch(() => {})
      return next
    })
    setOverride(null)
  }

  const day = useMemo(() => (state ? { ...defaultDay(), ...(state.days?.[today] || {}) } : null), [state, today])
  if (!state || !day) return <Centered>…</Centered>

  const { profile } = state
  const r = day.routines, w = day.workout, diet = day.diet || {}
  const coach = buildCoach({ hour, minute, day, profile })
  const focus = override || coach.action?.target || null

  const areas = [
    { id: 'skin', label: 'Skin', done: r.skincareAM && r.skincarePM },
    { id: 'movement', label: 'Movement', done: w.did },
    { id: 'hair', label: 'Hair', done: r.haircare },
    { id: 'diet', label: 'Diet', done: !!diet.quality },
  ]

  return (
    <div className="mx-auto max-w-xl px-5 pb-16 pt-7">
      <div className="mb-5 flex items-baseline justify-between">
        <span className="font-display text-lg font-semibold tracking-tight text-[#20201d]">localfit</span>
        <span className="text-[11px] uppercase tracking-[0.18em] text-[#a39c8d]">{prettyToday(today)}</span>
      </div>

      {/* The coach speaks — one thing at a time */}
      <section className="rounded-[28px] bg-[#23291f] px-6 py-7 shadow-[0_18px_40px_-24px_rgba(35,41,31,0.7)]">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#9aa581]">{coach.eyebrow}</p>
        <h1 className="font-display mt-3 text-[26px] font-semibold leading-[1.16] text-[#f4f1e8]">{coach.headline}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[#cfccba]">{coach.support}</p>
      </section>

      {/* The single focused step */}
      {focus ? (
        <FocusCard focus={focus} day={day} profile={profile} weightLog={state.weightLog || []}
          onSkin={(k) => patch({ routines: { [k]: !r[k] } })}
          onSteps={(v) => patch({ steps: v })}
          onTrain={(opt) => patch({ workout: { did: opt !== 'Rest', type: opt } })}
          onHair={() => patch({ routines: { haircare: !r.haircare } })}
          onDiet={(q) => patch({ diet: { quality: q } })}
          onWeight={saveWeight} />
      ) : (
        <div className="mt-5 rounded-3xl border border-[#e6dfd0] bg-[#fbf9f3] p-6 text-center">
          <p className="font-display text-lg text-[#23211c]">Nothing needed right now.</p>
          <p className="mt-1 text-sm text-[#8a8474]">You’re on top of things. Come back when it’s time for the next step.</p>
        </div>
      )}

      {/* Quiet progress — tap to jump anywhere, no pressure */}
      <div className="mt-6">
        <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-[#a39c8d]">Today</p>
        <div className="grid grid-cols-4 gap-2">
          {areas.map((a) => (
            <button key={a.id} onClick={() => setOverride(a.id)}
              className={`rounded-2xl border px-2 py-3 text-center transition ${
                focus === a.id ? 'border-[#3d4a32] bg-[#eef0e6]' : 'border-[#e6dfd0] bg-[#fbf9f3] hover:bg-[#f3efe6]'
              }`}>
              <span className={`mx-auto mb-1.5 block h-2 w-2 rounded-full ${a.done ? 'bg-[#3d4a32]' : 'bg-[#d8d1c2]'}`} />
              <span className="text-[12px] font-medium text-[#4a463c]">{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="mt-9 text-center text-[12px] text-[#a39c8d]">Consistency over intensity. One step at a time.</p>
    </div>
  )
}

/* ---------- the focused step ---------- */
const FOCUS_TITLE = { skin: 'Skin care', movement: 'Movement', hair: 'Hair care', diet: 'Today’s food' }
function FocusCard({ focus, day, profile, weightLog, onSkin, onSteps, onTrain, onHair, onDiet, onWeight }) {
  const r = day.routines, w = day.workout, diet = day.diet || {}
  return (
    <section className="mt-5 rounded-3xl border border-[#e6dfd0] bg-[#fbf9f3] p-5 shadow-[0_2px_10px_-6px_rgba(60,55,40,0.25)]">
      <h2 className="font-display mb-3 text-xl font-semibold text-[#23211c]">{FOCUS_TITLE[focus]}</h2>

      {focus === 'skin' && (
        <Segmented multi options={['Morning', 'Evening']}
          value={[r.skincareAM && 'Morning', r.skincarePM && 'Evening'].filter(Boolean)}
          onPick={(opt) => onSkin(opt === 'Morning' ? 'skincareAM' : 'skincarePM')} />
      )}

      {focus === 'hair' && (
        <Segmented options={['Done today']} value={r.haircare ? 'Done today' : ''} onPick={onHair} />
      )}

      {focus === 'diet' && (
        <>
          <p className="mb-2 text-[13px] text-[#6f6a5d]">How did you eat today?</p>
          <Segmented options={['On point', 'Okay', 'Off']}
            value={diet.quality === 'on' ? 'On point' : diet.quality === 'ok' ? 'Okay' : diet.quality === 'off' ? 'Off' : ''}
            onPick={(opt) => onDiet(opt === 'On point' ? 'on' : opt === 'Okay' ? 'ok' : 'off')} />
        </>
      )}

      {focus === 'movement' && (
        <div className="space-y-3">
          <Field label="Steps today">
            <NumInput value={day.steps || ''} placeholder={String(profile.stepTarget)} onCommit={onSteps} />
            <span className="text-[13px] text-[#8a8474]">of {profile.stepTarget.toLocaleString()}</span>
          </Field>
          <div>
            <p className="mb-2 text-[13px] text-[#6f6a5d]">Today’s training</p>
            <Segmented options={['Weights', 'Cardio', 'Walk', 'Rest']} value={w.type} onPick={onTrain} />
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

/* ---------- coach: time + state aware ---------- */
function buildCoach({ hour, minute, day, profile }) {
  const r = day.routines, w = day.workout, diet = day.diet || {}
  const steps = day.steps || 0, target = profile.stepTarget
  const trained = w.did && w.type !== 'Rest'
  const t = fmtTime(hour, minute)
  const eyebrow = `Today — ${t}`
  const phase = hour < 5 ? 'latenight' : hour < 12 ? 'morning' : hour < 17 ? 'midday' : hour < 21 ? 'evening' : 'night'
  const blank = !r.skincareAM && !r.skincarePM && !r.haircare && !w.did && day.weight == null && !diet.quality

  if (phase === 'latenight') {
    return { eyebrow, headline: `It’s late — time to wind down.`, support: `It’s the middle of the night. The best thing you can do for fat loss and muscle right now is sleep. Rest up; we’ll set the day up when you’re back on your feet.`, action: null }
  }
  if (phase === 'morning') {
    if (blank) return { eyebrow, headline: `Good morning. Let’s ease into the day.`, support: `Start with your morning skincare — small and easy. We’ll line up movement and food after.`, action: { label: '', target: 'skin' } }
    if (!r.skincareAM) return { eyebrow, headline: `First, your morning routine.`, support: `Two minutes of skincare to start clean. Then we move.`, action: { target: 'skin' } }
    if (!trained) return { eyebrow, headline: `When are you training today?`, support: `Three sessions a week is the floor for holding muscle while you lean out. Set the intention now.`, action: { target: 'movement' } }
    return { eyebrow, headline: `You’re set up well.`, support: `Keep the steps ticking, and make your next meal an easy win.`, action: { target: 'movement' } }
  }
  if (phase === 'midday') {
    if (steps < target * 0.4) return { eyebrow, headline: `You’re at ${steps.toLocaleString()} steps.`, support: `A little behind for midday. Ten minutes on your feet now beats cramming it after dark.`, action: { target: 'movement' } }
    if (!trained) return { eyebrow, headline: `Have you trained yet?`, support: `Don’t let the afternoon drift — a session protects your muscle and your deficit.`, action: { target: 'movement' } }
    if (!diet.quality) return { eyebrow, headline: `How’s the eating going?`, support: `Check in on lunch. Holding the line through the afternoon is half the work.`, action: { target: 'diet' } }
    return { eyebrow, headline: `Good momentum.`, support: `You’re on track. Water up and stay steady into the evening.`, action: null }
  }
  if (phase === 'evening') {
    if (steps < target * 0.6) return { eyebrow, headline: `It’s ${t}, and you’re at ${steps.toLocaleString()} of ${target.toLocaleString()} steps.`, support: `A 30–40 minute walk closes most of that gap. This is exactly where steady fat loss is won — don’t let it slide.`, action: { target: 'movement' } }
    if (!trained) return { eyebrow, headline: `The day’s closing, and you haven’t trained.`, support: `Even thirty minutes of lifting protects muscle while you’re cutting. Worth showing up for.`, action: { target: 'movement' } }
    if (!diet.quality) return { eyebrow, headline: `How did eating go today?`, support: `Be honest with it — that’s how we keep the trend pointed the right way.`, action: { target: 'diet' } }
    if (!r.skincarePM) return { eyebrow, headline: `Wind down with your evening skincare.`, support: `Close the loop on the day. Your skin does its repair work overnight.`, action: { target: 'skin' } }
    return { eyebrow, headline: `You’ve handled today.`, support: `Skin, training, food — all tended. This is the consistency that gets you to your goal.`, action: null }
  }
  // night (21:00–23:59)
  if (!r.skincarePM) return { eyebrow, headline: `Evening skincare before bed.`, support: `Last thing for the day, then rest — recovery is when muscle is actually built.`, action: { target: 'skin' } }
  if (!diet.quality) return { eyebrow, headline: `Quick check: how did you eat?`, support: `One tap and you’re done. It keeps tomorrow’s plan honest.`, action: { target: 'diet' } }
  return { eyebrow, headline: `That’s a full day. Rest up.`, support: `Weigh in first thing tomorrow — we track the trend, not the daily noise.`, action: null }
}
function fmtTime(h, m) {
  const ap = h < 12 ? 'AM' : 'PM'; const hr = ((h + 11) % 12) + 1
  return `${hr}:${String(m).padStart(2, '0')} ${ap}`
}

/* ---------- UI atoms ---------- */
function Segmented({ options, value, onPick, multi }) {
  const isOn = (opt) => (multi ? value.includes(opt) : value === opt)
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button key={opt} onClick={() => onPick(opt)}
          className={`rounded-full px-4 py-2.5 text-sm font-medium transition active:scale-95 ${
            isOn(opt) ? 'bg-[#3d4a32] text-[#f4f1e8]' : 'border border-[#e0d9c9] bg-[#f3efe6] text-[#4a463c] hover:bg-[#ebe6da]'
          }`}>{opt}</button>
      ))}
    </div>
  )
}
function Field({ label, children }) {
  return <div className="flex items-center gap-3"><span className="w-28 text-[13px] text-[#6f6a5d]">{label}</span>{children}</div>
}
function NumInput({ value, placeholder, step, onCommit }) {
  return (
    <input type="number" step={step} placeholder={placeholder} defaultValue={value} key={value === '' ? 'e' : value}
      onBlur={(e) => e.target.value !== '' && onCommit(Number(e.target.value))}
      className="w-24 rounded-xl border border-[#ddd5c5] bg-white px-3 py-1.5 text-sm text-[#23211c] outline-none focus:border-[#3d4a32]" />
  )
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
function Centered({ children }) {
  return <div className="flex min-h-screen items-center justify-center px-6 text-center text-[#8a8474]">{children}</div>
}
function prettyToday(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[m - 1]} ${d} · ${y}`
}
