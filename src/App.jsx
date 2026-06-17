import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import SkincareFlow from './SkincareFlow'
import TrainFlow from './TrainFlow'
import { buildSession, estimateSessionMinutes } from './train'
import { PRODUCTS, DEFAULT_OWNED, dueSummary } from './skincare'
import { inferSleep, lastNightSleep, sleepScore, fmtDuration, fmtClock } from './sleep'
import { API_BASE } from './config'

/* ---------- data layer: localStorage-first, best-effort backend mirror ---------- */
const LS_KEY = 'localfit-state'
const isoToday = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
const DEFAULT_STATE = {
  profile: { name: 'Aniruddha', stepTarget: 10000, gymTargetPerWeek: 3, waterTarget: 8, bodyFatTarget: 12, bodyFatDeadline: '2026-12-31', sleepTargetHours: 7, bedGoal: '23:30', wakeGoal: '07:30', skincare: { ownedProducts: [...DEFAULT_OWNED], startedDate: isoToday() } },
  days: {},
  weightLog: [],
  bodyFatLog: [],
  activity: [],
}
const ensureProfile = (p = {}) => {
  p.waterTarget ??= 8; p.bodyFatTarget ??= 12; p.bodyFatDeadline ??= '2026-12-31'
  p.sleepTargetHours ??= 7; p.bedGoal ??= '23:30'; p.wakeGoal ??= '07:30'
  p.skincare ??= {}
  p.skincare.ownedProducts ??= [...DEFAULT_OWNED]
  p.skincare.startedDate ??= isoToday()
  return p
}
const loadLocal = () => { try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : null } catch { return null } }
const saveLocal = (s) => { try { localStorage.setItem(LS_KEY, JSON.stringify(s)) } catch { /* quota */ } }

// Record that the app is active right now. Appends/extends the current activity
// interval and prunes anything older than 48h. Persists straight to localStorage
// (no setState / no `pending`) so background pings never raise the "not backed up"
// banner — the next heartbeat doSync mirrors it to the backend for free.
const ACTIVITY_GAP = 6 * 60 * 1000
const ACTIVITY_KEEP = 48 * 60 * 60 * 1000
function recordActivity() {
  const s = loadLocal(); if (!s) return
  const now = Date.now()
  const act = Array.isArray(s.activity) ? s.activity : []
  const last = act[act.length - 1]
  if (last && now - last.e <= ACTIVITY_GAP) last.e = now
  else act.push({ s: now, e: now })
  s.activity = act.filter((iv) => iv.e >= now - ACTIVITY_KEEP)
  saveLocal(s)
}
const clone = (o) => JSON.parse(JSON.stringify(o))
const defaultDay = () => ({
  steps: 0, workout: { did: false, type: '' }, weight: null,
  routines: { skincareAM: false, skincarePM: false, haircare: false },
  water: 0, meals: { breakfast: null, lunch: null, dinner: null }, mealNote: '',
  skincare: { am: null, pm: null },
})
function deepMerge(t, p) {
  for (const [k, v] of Object.entries(p || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) t[k] = deepMerge(t[k] && typeof t[k] === 'object' ? t[k] : {}, v)
    else t[k] = v
  }
  return t
}
let _syncTimer = null

export default function App() {
  const [state, setState] = useState(null)
  const today = isoToday()
  const now = new Date(); const hour = now.getHours(); const minute = now.getMinutes()
  const [override, setOverride] = useState(null)
  const [view, setView] = useState('home') // 'home' | 'rewards'
  const [flow, setFlow] = useState(null) // 'am' | 'pm' | null — guided skincare takeover
  const [training, setTraining] = useState(false) // guided gym session takeover
  const [manageProducts, setManageProducts] = useState(false)
  const [booting, setBooting] = useState(true) // opening splash
  const [bootLeaving, setBootLeaving] = useState(false)

  // Opening splash: hold the wordmark briefly, fade out, then reveal the app.
  useEffect(() => {
    const fade = setTimeout(() => setBootLeaving(true), 1150)
    const done = setTimeout(() => setBooting(false), 1650)
    return () => { clearTimeout(fade); clearTimeout(done) }
  }, [])

  // Lock page scroll while a full-screen overlay is open, so a swipe can't drag
  // the dashboard out from behind the card.
  const overlayOpen = !!flow || training || manageProducts || booting
  useEffect(() => {
    if (!overlayOpen) return
    const { overflow, position, width } = document.body.style
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      document.body.style.position = position
      document.body.style.width = width
      document.documentElement.style.overflow = ''
    }
  }, [overlayOpen])
  const [syncing, setSyncing] = useState(false)
  const [pending, setPending] = useState(false) // unsynced local changes

  // Push the local copy to the backend and adopt the merged truth. No-op offline.
  const doSync = useCallback(async () => {
    const local = loadLocal(); if (!local) return
    ensureProfile(local.profile ||= {}) // never sync away the skincare/profile defaults
    setSyncing(true)
    try {
      const res = await fetch(`${API_BASE}/api/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(local) })
      if (!res.ok) throw new Error('sync')
      const merged = await res.json()
      saveLocal(merged); setState(merged)
      setPending(false) // backend now has the latest
    } catch {
      // stay pending; auto-retry (heartbeat / reconnect / focus) covers it
    } finally {
      setSyncing(false)
    }
  }, [])
  const scheduleSync = useCallback(() => { clearTimeout(_syncTimer); _syncTimer = setTimeout(doSync, 1500) }, [doSync])

  useEffect(() => {
    const local = loadLocal()
    if (local) {
      ensureProfile(local.profile ||= {})
      saveLocal(local) // persist the ensured defaults before any sync reads storage
      setState(local)
      doSync() // push offline changes, pull merged truth
    } else {
      // No local copy (first run, or it was lost/cleared) → restore from the backend.
      fetch(`${API_BASE}/api/state`).then((r) => (r.ok ? r.json() : null)).then((b) => {
        const init = b || DEFAULT_STATE; ensureProfile(init.profile ||= {})
        setState(init); saveLocal(init)
      }).catch(() => { setState(DEFAULT_STATE); saveLocal(DEFAULT_STATE) })
    }
    // Record this session's foreground activity (feeds sleep inference — the long
    // overnight quiet gap ≈ sleep). Rides the existing heartbeat/visibility flow.
    recordActivity()
    // Automatic resync: when the network returns, when the app regains focus,
    // and on a periodic heartbeat — so the backend always has the latest.
    const onOnline = () => doSync()
    const onVisible = () => { if (document.visibilityState === 'visible') { recordActivity(); doSync() } }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    const heartbeat = setInterval(() => { recordActivity(); if (navigator.onLine !== false) doSync() }, 60000)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(heartbeat)
    }
  }, [doSync])

  // Warn before leaving / reloading if changes haven't been backed up to the server.
  useEffect(() => {
    if (!pending) return
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [pending])

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
    setPending(true)
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
    setPending(true)
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
    setPending(true)
    scheduleSync()
  }
  function updateProfile(p) {
    setState((prev) => {
      const next = clone(prev)
      next.profile = { ...next.profile, ...p }
      saveLocal(next)
      return next
    })
    setPending(true)
    scheduleSync()
  }
  // Manual sleep correction — writes today's sleep object (override wins over inference).
  function saveSleep(sleep) { patch({ sleep }) }
  function claimReward(days) {
    setState((prev) => {
      const next = clone(prev)
      next.rewardsClaimed = next.rewardsClaimed || {}
      next.rewardsClaimed[days] = today
      saveLocal(next)
      return next
    })
    setPending(true)
    scheduleSync()
  }

  // Guided skincare routine finished — log the steps and flip the streak boolean.
  function completeRoutine(slot, log) {
    const routineKey = slot === 'am' ? 'skincareAM' : 'skincarePM'
    patch({ skincare: { [slot]: log }, routines: { [routineKey]: true } })
    setFlow(null)
  }

  // Persist the whole training session into today's workout (wholesale, so set
  // edits and cursor survive a reload). `did` flips true only on completion.
  function writeSession(session) {
    setState((prev) => {
      const next = clone(prev)
      next.days[today] = next.days[today] || defaultDay()
      const w = next.days[today].workout || { did: false, type: '' }
      w.session = session
      w.did = session.status === 'done'
      if (session.label) w.type = session.label
      next.days[today].workout = w
      next.days[today]._ts = Date.now()
      saveLocal(next)
      return next
    })
    setPending(true)
    scheduleSync()
  }

  // Resume a locked-in session: if today's workout is still 'active' on load,
  // drop straight back into the takeover instead of the dashboard.
  const resumedRef = useRef(false)
  useEffect(() => {
    if (!state || resumedRef.current) return
    resumedRef.current = true
    if (state.days?.[today]?.workout?.session?.status === 'active') setTraining(true)
  }, [state, today])

  const day = useMemo(() => (state ? { ...defaultDay(), ...(state.days?.[today] || {}) } : null), [state, today])
  if (!state || !day) return <Centered>…</Centered>

  const { profile } = state

  if (view === 'rewards') {
    return (
      <div className="mx-auto max-w-xl px-5 pb-16 pt-7 fade-in">
        <button onClick={() => setView('home')} className="mb-5 inline-flex items-center gap-1 text-sm font-medium text-[#6f6a5d]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          Back
        </button>
        <RewardsSection state={state} profile={profile} today={today} onClaim={claimReward} />
      </div>
    )
  }

  const r = day.routines, w = day.workout, meals = day.meals || {}
  // Today's training call, for the Train tile + movement focus card.
  const trainSession = buildSession(state, today)
  const trainCall = {
    active: w.session?.status === 'active',
    done: w.session?.status === 'done',
    rest: trainSession.dayType === 'rest',
    label: trainSession.label || 'Rest',
    estMin: trainSession.dayType !== 'rest' ? estimateSessionMinutes(trainSession) : null,
  }
  const skinDue = dueSummary(today, state)
  const lastSleep = lastNightSleep(state, today)
  const coach = buildCoach({ hour, minute, day, profile, skinDue, lastSleep })
  const focus = override || coach.action?.target || null
  // Routines are only loggable in their window: morning 6 AM–12 PM, evening 6 PM–12 AM.
  const inAmWindow = hour >= 6 && hour < 12
  const inPmWindow = hour >= 18
  const skinLocked = !inAmWindow && !inPmWindow
  const skinSlot = inPmWindow ? 'pm' : 'am' // which routine the skin tap target opens
  const skinHint = hour < 6 ? 'Opens 6 AM' : 'Opens 6 PM' // shown only when locked
  // Time-aware emphasis (only while unlocked): 'urgent' (near bedtime, PM undone) >
  // 'attention' (it's the routine's window) > 'idle'.
  const skinSlotDone = skinSlot === 'am' ? r.skincareAM : r.skincarePM
  const skinSlotPending = skinSlot === 'am' ? skinDue.amPending : skinDue.pmPending
  let skinAttn = 'idle'
  if (!skinLocked && !skinSlotDone && skinSlotPending) {
    skinAttn = skinSlot === 'pm' && hour >= 22 ? 'urgent' : 'attention'
  }

  const areas = [
    { id: 'skin', label: 'Skin', done: r.skincareAM && (hour < 17 || r.skincarePM), attn: skinAttn, locked: skinLocked && !skinSlotDone, hint: skinHint },
    { id: 'movement', label: 'Train', done: w.did, attn: w.session?.status === 'active' ? 'urgent' : 'idle' },
    { id: 'diet', label: 'Diet', done: dietDone(hour, meals) },
    { id: 'water', label: 'Water', done: (day.water || 0) >= profile.waterTarget },
    { id: 'hair', label: 'Hair', done: r.haircare },
  ]

  const setWater = (delta) => patch({ water: Math.max(0, (day.water || 0) + delta) })

  return (
    <>
    {booting && <Splash leaving={bootLeaving} />}
    <div className="mx-auto max-w-xl px-5 pb-16 pt-7 fade-in">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="font-display text-lg font-semibold tracking-tight text-[#20201d]">localfit</span>
        <div className="flex items-center gap-2">
          <SyncIndicator status={syncing ? 'syncing' : pending ? 'unsynced' : 'synced'} />
          <span className="text-[11px] uppercase tracking-[0.18em] text-[#a39c8d]">{prettyToday(today)}</span>
        </div>
      </div>
      {pending && !syncing && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-[#e7d4b6] bg-[#f7ecd6] px-3 py-2 text-[12px] text-[#8a5a1e]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" />
          </svg>
          <span>Not backed up yet — these changes live only on this device. Keep the app open or reconnect to sync.</span>
        </div>
      )}

      {/* The coach speaks — directive, one thing at a time */}
      <section className="rounded-[28px] bg-[#23291f] px-6 py-7 shadow-[0_18px_40px_-24px_rgba(35,41,31,0.7)]">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#9aa581]">{coach.eyebrow}</p>
        <h1 className="font-display mt-3 text-[26px] font-semibold leading-[1.16] text-[#f4f1e8]">{coach.headline}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[#cfccba]">{coach.support}</p>
      </section>

      {focus ? (
        <FocusCard
          focus={focus} day={day} profile={profile} hour={hour} weightLog={state.weightLog || []}
          onStartSkin={setFlow} onManageProducts={() => setManageProducts(true)}
          onSteps={(v) => patch({ steps: v })}
          onStartTrain={() => setTraining(true)} train={trainCall}
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
          {areas.map((a) => {
            const urgent = a.attn === 'urgent', attention = a.attn === 'attention'
            if (a.locked) {
              return (
                <div key={a.id} aria-disabled="true"
                  className="relative rounded-2xl border border-[#e6dfd0] bg-[#f1ede4] px-1 py-3 text-center opacity-70">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#b3ac9c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-1">
                    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <span className="block text-[12px] font-medium text-[#9c968a]">{a.label}</span>
                  <span className="mt-0.5 block text-[9px] leading-none text-[#b3ac9c]">{a.hint}</span>
                </div>
              )
            }
            const tile = focus === a.id
              ? 'border-[#3d4a32] bg-[#eef0e6]'
              : urgent ? 'border-[#3d4a32] bg-[#e8ede0] pulse-attention'
              : attention ? 'border-[#aebb8f] bg-[#eef0e6]'
              : 'border-[#e6dfd0] bg-[#fbf9f3] hover:bg-[#f3efe6]'
            return (
              <button key={a.id} onClick={() => (a.id === 'skin' ? setFlow(skinSlot) : setOverride(a.id))}
                className={`relative rounded-2xl border px-1 py-3 text-center transition ${tile}`}>
                {(urgent || attention) && (
                  <span className={`absolute -top-2 left-1/2 -translate-x-1/2 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${urgent ? 'bg-[#3d4a32] text-[#f4f1e8]' : 'bg-[#dfe6cf] text-[#3d4a32]'}`}>Now</span>
                )}
                <span className={`mx-auto mb-1.5 block h-2 w-2 rounded-full ${a.done ? 'bg-[#3d4a32]' : urgent || attention ? 'bg-[#7d8a5f]' : 'bg-[#d8d1c2]'}`} />
                <span className="text-[12px] font-medium text-[#4a463c]">{a.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <GoalsSection state={state} profile={profile} today={today} onBodyFat={saveBodyFat} onProfile={updateProfile} onSleep={saveSleep} />

      <RewardsSummary state={state} profile={profile} today={today} onOpen={() => setView('rewards')} />

      <p className="mt-9 text-center text-[12px] text-[#a39c8d]">Consistency over intensity. One step at a time.</p>

      {flow && (
        <SkincareFlow
          slot={flow} dateIso={today} state={state}
          onComplete={completeRoutine}
          onClose={() => setFlow(null)}
          onManage={() => { setFlow(null); setManageProducts(true) }} />
      )}
      {training && (
        <TrainFlow
          dateIso={today} state={state} hour={hour} minute={minute}
          onPersist={writeSession}
          onClose={() => setTraining(false)} />
      )}
      {manageProducts && (
        <ProductsModal profile={profile} onClose={() => setManageProducts(false)}
          onSave={(owned) => { updateProfile({ skincare: { ...profile.skincare, ownedProducts: owned } }); setManageProducts(false) }} />
      )}
    </div>
    </>
  )
}

function Splash({ leaving }) {
  return (
    <div className={`fixed inset-0 z-[60] flex flex-col items-center justify-center bg-[#f1ede4] ${leaving ? 'splash-out' : ''}`}>
      <span className="font-display text-[40px] font-semibold tracking-tight text-[#23291f] splash-word">localfit</span>
      <span className="splash-rule mt-3 h-px w-16 bg-[#c2b9a3]" />
    </div>
  )
}

/* ---------- the focused step ---------- */
const FOCUS_TITLE = { skin: 'Skin care', movement: 'Training', hair: 'Hair care', diet: 'Today’s food', water: 'Hydration' }
const MEAL_AFTER = { breakfast: 5, lunch: 11, dinner: 16 }

function FocusCard({ focus, day, profile, hour, weightLog, onStartSkin, onManageProducts, onSteps, onStartTrain, train, onHair, onMeal, onNote, onWater, onWeight }) {
  const r = day.routines, w = day.workout, meals = day.meals || {}
  return (
    <section className="mt-5 rounded-3xl border border-[#e6dfd0] bg-[#fbf9f3] p-5 shadow-[0_2px_10px_-6px_rgba(60,55,40,0.25)]">
      <h2 className="font-display mb-3 text-xl font-semibold text-[#23211c]">{FOCUS_TITLE[focus]}</h2>

      {focus === 'skin' && (
        <div>
          <div className="space-y-2">
            <SkinStart label="Start morning routine" done={r.skincareAM} primary={hour < 17} locked={!(hour >= 6 && hour < 12)} hint="Opens 6 AM" onClick={() => onStartSkin('am')} />
            <SkinStart label="Start evening routine" done={r.skincarePM} primary={hour >= 17} locked={hour < 18} hint="Opens 6 PM" onClick={() => onStartSkin('pm')} />
          </div>
          <button onClick={onManageProducts} className="mt-3 text-[13px] font-medium text-[#6f6a5d] underline-offset-2 hover:underline">Manage products</button>
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
          <TrainStart train={train} onStart={onStartTrain} />
          <Field label="Steps today">
            <NumInput value={day.steps || ''} placeholder={String(profile.stepTarget)} onCommit={onSteps} />
            <span className="text-[13px] text-[#8a8474]">of {profile.stepTarget.toLocaleString()}</span>
          </Field>
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

// The trainer's call as a single CTA: start / resume / done / rest. The brains
// already picked the day — this just opens the guided session.
function TrainStart({ train, onStart }) {
  const { active, done, rest, label, estMin } = train || {}
  const title = active ? 'Resume session' : done ? `${label} — logged` : rest ? 'Rest recommended' : `${label} day`
  const sub = active ? "You're mid-session — pick up where you left off"
    : done ? "Today's training is in the books"
    : rest ? 'You can open it to train anyway'
    : `Guided session · about ${estMin} min. The plan's ready.`
  return (
    <button onClick={onStart}
      className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition active:scale-[0.99] ${
        done ? 'border border-[#e0d9c9] bg-[#f3efe6] text-[#4a463c]'
        : rest ? 'border border-[#e0d9c9] bg-[#f3efe6] text-[#4a463c] hover:bg-[#ebe6da]'
        : `bg-[#3d4a32] text-[#f4f1e8] ${active ? 'pulse-attention' : ''}`
      }`}>
      <span>
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className={`mt-0.5 block text-[12px] ${done || rest ? 'text-[#8a8474]' : 'text-[#cfd6bd]'}`}>{sub}</span>
      </span>
      {done
        ? <span className="text-[12px] font-medium text-[#5b6745]">Done</span>
        : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>}
    </button>
  )
}

// A clear primary/secondary CTA for opening a guided skincare routine.
function SkinStart({ label, done, primary, locked, hint, onClick }) {
  // Locked outside its window — not startable, with a hint for when it opens.
  if (locked && !done) {
    return (
      <div aria-disabled="true" className="flex w-full items-center justify-between rounded-2xl border border-[#e0d9c9] bg-[#f1ede4] px-4 py-3 text-left opacity-75">
        <span className="text-[15px] font-semibold text-[#a39c8d]">{label}</span>
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#a39c8d]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          {hint}
        </span>
      </div>
    )
  }
  return (
    <button onClick={onClick}
      className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition active:scale-[0.99] ${
        primary ? 'bg-[#3d4a32] text-[#f4f1e8]' : 'border border-[#e0d9c9] bg-[#f3efe6] text-[#4a463c] hover:bg-[#ebe6da]'
      }`}>
      <span className="text-[15px] font-semibold">{label}</span>
      {done
        ? <span className={`text-[12px] font-medium ${primary ? 'text-[#cfd6bd]' : 'text-[#5b6745]'}`}>Done today</span>
        : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>}
    </button>
  )
}

// Manage which products are in the routine vs the shopping list.
function ProductsModal({ profile, onClose, onSave }) {
  const [owned, setOwned] = useState(() => [...(profile.skincare?.ownedProducts || [])])
  const toggle = (id) => setOwned((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]))
  // Shave is always owned and not user-managed here.
  const list = PRODUCTS.filter((p) => p.id !== 'shave')
  const inRoutine = list.filter((p) => owned.includes(p.id))
  const shopping = list.filter((p) => !owned.includes(p.id))

  const Row = ({ p }) => {
    const on = owned.includes(p.id)
    return (
      <button onClick={() => toggle(p.id)} className="flex w-full items-center justify-between gap-3 py-3 text-left">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-[#23211c]">{p.name}</p>
          {p.why && <p className="text-[12px] text-[#8a8474]">{p.why}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium ${on ? 'bg-[#3d4a32] text-[#f4f1e8]' : 'border border-[#d8d1c2] bg-white text-[#4a463c]'}`}>
          {on ? 'Owned' : 'Add'}
        </span>
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center fade-in" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-3xl bg-[#f4f1ea] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-display text-2xl font-semibold text-[#23211c]">Your products</h3>
            <p className="mt-1 text-[13px] text-[#8a8474]">Only what you own appears in your routine. Actives unlock gradually.</p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none text-[#a39c8d]">×</button>
        </div>

        <p className="mt-5 text-[11px] uppercase tracking-[0.18em] text-[#a39c8d]">In your routine</p>
        <div className="divide-y divide-[#ece6da]">
          {inRoutine.length ? inRoutine.map((p) => <Row key={p.id} p={p} />) : <p className="py-3 text-[13px] text-[#8a8474]">Nothing yet — add from the list below.</p>}
        </div>

        <p className="mt-5 text-[11px] uppercase tracking-[0.18em] text-[#a39c8d]">Shopping list</p>
        <div className="divide-y divide-[#ece6da]">
          {shopping.length ? shopping.map((p) => <Row key={p.id} p={p} />) : <p className="py-3 text-[13px] text-[#8a8474]">You own everything on the catalog.</p>}
        </div>

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-full border border-[#d8d1c2] bg-white py-2.5 text-sm font-medium text-[#4a463c]">Cancel</button>
          <button onClick={() => onSave(owned)} className="flex-1 rounded-full bg-[#3d4a32] py-2.5 text-sm font-semibold text-[#f4f1e8] active:scale-95">Save</button>
        </div>
      </div>
    </div>
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
// Friendly name for tonight's active, for the coach's support line.
function activeName(id) {
  if (id === 'retinoid') return 'Retinoid tonight'
  if (id === 'bha') return 'Exfoliate tonight'
  if (id === 'azelaic') return 'Azelaic acid tonight'
  return null
}
function buildCoach({ hour, minute, day, profile, skinDue, lastSleep }) {
  const r = day.routines, w = day.workout, meals = day.meals || {}
  skinDue = skinDue || { amPending: !r.skincareAM, pmPending: !r.skincarePM, tonightActive: null, shaveDue: false }
  const steps = day.steps || 0, target = profile.stepTarget, water = day.water || 0, wTarget = profile.waterTarget
  const trained = w.did && w.type !== 'Rest'
  const t = fmtTime(hour, minute)
  const eyebrow = `Today — ${t}`
  const phase = hour < 5 ? 'latenight' : hour < 12 ? 'morning' : hour < 17 ? 'midday' : hour < 21 ? 'evening' : 'night'

  if (phase === 'latenight')
    return { eyebrow, headline: `It’s ${t}. Go to bed.`, support: `Nothing good for your goals happens past midnight. Sleep is when fat burns and muscle repairs — get to it.`, action: null }

  if (phase === 'morning') {
    if (water < 1) return { eyebrow, headline: `Drink a glass of water. Now.`, support: `Hydrate before anything else — it’s the easiest win of the day, and it wakes you up.`, action: { target: 'water' } }
    if (!r.skincareAM && skinDue.amPending) {
      const support = skinDue.shaveDue
        ? (skinDue.shaveOverdue ? `You're past due to shave — do it, then SPF before you leave.` : `Shave today, then SPF before you leave.`)
        : `A few quiet minutes. SPF is the one that protects your progress.`
      return { eyebrow, headline: `Start your morning routine.`, support, action: { target: 'skin' } }
    }
    if (meals.breakfast == null) return { eyebrow, headline: `Log your breakfast.`, support: `On plan or not — be honest. The first meal sets the tone for the whole day.`, action: { target: 'diet' } }
    if (!trained) return { eyebrow, headline: `Decide when you’re training today.`, support: `Three sessions a week is the floor for holding muscle while you cut. Commit to a time.`, action: { target: 'movement' } }
    // Quietly acknowledge a short night if we're confident about it.
    const sleepTargetMin = (profile.sleepTargetHours || 7) * 60
    if (lastSleep && lastSleep.confident && lastSleep.minutes < sleepTargetMin)
      return { eyebrow, headline: `Good start. Keep moving.`, support: `You ran short on sleep last night (${fmtDuration(lastSleep.minutes)}) — no guilt, just aim for an earlier night tonight. Steps and water are going; keep at it.`, action: { target: 'movement' } }
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
    if (!r.skincarePM && skinDue.pmPending) {
      if (trained) {
        const an = activeName(skinDue.tonightActive)
        const support = an ? `${an}. Otherwise keep it gentle.` : `Recovery night — keep it gentle and let your skin repair.`
        return { eyebrow, headline: `Trained and showered? Now your evening routine.`, support, action: { target: 'skin' } }
      }
      return { eyebrow, headline: `After your workout and shower, do your evening routine.`, support: `No rush — train first, then close out the day with your skin.`, action: { target: 'skin' } }
    }
    return { eyebrow, headline: `You’ve handled today.`, support: `Skin, training, food, water — all tended. This is what consistency looks like.`, action: null }
  }
  // night 21–24
  if (!r.skincarePM && skinDue.pmPending) {
    const an = activeName(skinDue.tonightActive)
    const headline = hour >= 22 ? `It’s ${t} — do your evening routine before bed.` : `Evening routine, then start winding down.`
    return { eyebrow, headline, support: an ? `${an}. Last thing for the day — after this, sleep.` : `Last thing for the day. After this, the priority is sleep.`, action: { target: 'skin' } }
  }
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

// Diet adherence over the last 14 days: per logged day, share of meals on plan.
// Only days with at least one logged meal count. null if nothing logged.
function dietScore(state, today) {
  const days = state.days || {}
  let sum = 0, n = 0
  for (let i = 0; i < 14; i++) {
    const d = days[shiftIso(today, -i)]
    const meals = d?.meals
    if (!meals) continue
    const logged = ['breakfast', 'lunch', 'dinner'].filter((m) => meals[m] === 'on' || meals[m] === 'off')
    if (!logged.length) continue
    const onPlan = logged.filter((m) => meals[m] === 'on').length
    sum += (onPlan / logged.length) * 10
    n++
  }
  if (!n) return null
  return Math.round(sum / n)
}

// Movement over the last 14 days: a real (non-Rest) workout scores full; else
// steps prorated against the daily target. Averaged over days present. null if none.
function moveScore(state, today, profile) {
  const days = state.days || {}
  const stepTarget = profile.stepTarget || 10000
  let sum = 0, n = 0
  for (let i = 0; i < 14; i++) {
    const d = days[shiftIso(today, -i)]
    if (!d) continue
    const trained = d.workout?.did && d.workout.type !== 'Rest'
    sum += trained ? 10 : Math.min(10, Math.round((d.steps || 0) / stepTarget * 10))
    n++
  }
  if (!n) return null
  return Math.round(sum / n)
}

// A circular /10 progress ring with the value + label stacked in the center.
// The arc starts empty and fills to its value on mount (CSS transition).
function ScoreRing({ score, label }) {
  const size = 60, stroke = 5, r = (size - stroke) / 2, c = 2 * Math.PI * r
  const has = score != null
  const frac = has ? Math.max(0, Math.min(1, score / 10)) : 0
  const [mounted, setMounted] = useState(false)
  useEffect(() => { const id = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(id) }, [])
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#3a4230" strokeWidth={stroke} />
          {has && (
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#aebb8f" strokeWidth={stroke}
              strokeLinecap="round" strokeDasharray={c} strokeDashoffset={mounted ? c * (1 - frac) : c} className="score-ring-arc" />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-display text-[17px] font-semibold leading-none ${has ? 'text-[#f4f1e8]' : 'text-[#7d8666]'}`}>{has ? score : '–'}</span>
          <span className="mt-0.5 text-[9px] uppercase tracking-wide leading-none text-[#9aa581]">{label}</span>
        </div>
      </div>
    </div>
  )
}

function GoalsSection({ state, profile, today, onBodyFat, onProfile, onSleep }) {
  const [estimating, setEstimating] = useState(false)
  const [editingSleep, setEditingSleep] = useState(false)
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
  const slpScore = sleepScore(state, today, profile) // null until there's data
  const dietSc = dietScore(state, today) // null until meals are logged
  const moveSc = moveScore(state, today, profile) // null until a day is present
  const lastSleep = lastNightSleep(state, today)

  // The five pillars shown as rings. Each carries a directive weakest-link nudge.
  const rings = [
    { key: 'sleep', label: 'Sleep', score: slpScore, msg: `Sleep is your weak spot — aim for ${profile.sleepTargetHours || 7}h, lights out by ${clockGoal(profile.bedGoal || '23:30')}.` },
    { key: 'skin', label: 'Skin', score: skinScore, msg: 'Skin is slipping — run the full AM and PM routine, every day.' },
    { key: 'hair', label: 'Hair', score: hairScore, msg: 'Hair is falling behind — stay on your care schedule.' },
    { key: 'diet', label: 'Diet', score: dietSc, msg: 'Diet is dragging — log honestly and keep more meals on plan.' },
    { key: 'move', label: 'Move', score: moveSc, msg: 'Movement is light — hit your steps and train three times a week.' },
  ]

  // Top-level: the rounded average of the pillars that actually have data.
  const scored = rings.filter((p) => p.score != null)
  const hasData = scored.length > 0
  const overall = hasData ? Math.round(scored.reduce((s, p) => s + p.score, 0) / scored.length) : null
  const word = !hasData ? 'Getting started' : overall >= 8 ? 'Dialed in' : overall >= 6 ? 'On track' : overall >= 4 ? 'Slipping' : 'Off track'
  const weakest = hasData ? [...scored].sort((a, b) => a.score - b.score)[0] : null
  const note = !hasData
    ? 'Start logging and your scores will fill in.'
    : overall >= 8 ? 'You’re doing the work. Keep it up.' : weakest.msg

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
            <p className="font-display text-3xl font-semibold leading-none text-[#f4f1e8]">{overall != null ? overall : '–'}<span className="text-lg text-[#9aa581]">/10</span></p>
          </div>
          <span className="text-[13px] font-medium text-[#cfccba]">{word}</span>
        </div>
        <p className="mt-2 text-[13px] text-[#cfccba]">{note}</p>

        {/* The five pillars, as progress rings */}
        <div className="mt-3 grid grid-cols-5 gap-2 border-t border-[#39402f] pt-3.5">
          {rings.map((p) => <ScoreRing key={p.key} score={p.score} label={p.label} />)}
        </div>

        {/* Sleep detail — a small value the owner can correct */}
        <div className="mt-3 flex items-start justify-between gap-3 border-t border-[#39402f] pt-2.5">
          <div className="min-w-0">
            {lastSleep ? (
              <p className="text-[11px] leading-snug text-[#9aa581]">
                Last night · {fmtDuration(lastSleep.minutes)} · in bed {fmtClock(lastSleep.start)}
                {lastSleep.interruptions?.length ? ` · ${lastSleep.interruptions.length} wake-up${lastSleep.interruptions.length > 1 ? 's' : ''}` : ''}
                {lastSleep.confident === false ? ' · estimated' : ''}
              </p>
            ) : (
              <p className="text-[11px] leading-snug text-[#9aa581]">No sleep read yet — tap edit to log last night.</p>
            )}
          </div>
          <button onClick={() => setEditingSleep(true)} className="shrink-0 text-[11px] font-medium text-[#9aa581] underline-offset-2 hover:underline">Edit</button>
        </div>
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

      {estimating && (
        <BodyFatModal profile={profile} onClose={() => setEstimating(false)}
          onSave={(pct, patch) => { onBodyFat(pct); onProfile(patch); setEstimating(false) }} />
      )}
      {editingSleep && (
        <SleepModal current={lastSleep} onClose={() => setEditingSleep(false)}
          onSave={(sleep) => { onSleep(sleep); setEditingSleep(false) }} />
      )}
    </section>
  )
}

// "23:30" → "11:30 PM" for the coach nudge copy.
function clockGoal(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '23:30')
  if (!m) return hhmm
  let h = Number(m[1]); const ap = h < 12 ? 'AM' : 'PM'; h = ((h + 11) % 12) + 1
  return `${h}:${m[2]} ${ap}`
}

// Compact corrector for last night's sleep. Two time inputs + an interruptions
// stepper. Computes minutes from the bed/wake times, handling the overnight
// crossover (bed 23:40 + wake 07:30 ≈ 7h50m). Writes a manual override.
function SleepModal({ current, onClose, onSave }) {
  const toHHMM = (ms) => { if (ms == null) return ''; const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}` }
  const [bed, setBed] = useState(() => toHHMM(current?.start) || '23:30')
  const [wake, setWake] = useState(() => toHHMM(current?.end) || '07:30')
  const [wakeups, setWakeups] = useState(() => current?.interruptions?.length || 0)

  // Build epoch ms for bed (last night) and wake (this morning), handling crossover.
  const buildTimes = () => {
    const [bh, bm] = bed.split(':').map(Number)
    const [wh, wm] = wake.split(':').map(Number)
    const now = new Date()
    const wakeD = new Date(now.getFullYear(), now.getMonth(), now.getDate(), wh, wm, 0, 0)
    // Bedtime is the same calendar day as wake unless it's a later clock time
    // (e.g. bed 23:30, wake 07:30) → bedtime belongs to the previous day.
    const bedSameDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), bh, bm, 0, 0)
    const start = bh * 60 + bm > wh * 60 + wm ? bedSameDay.getTime() - 86400000 : bedSameDay.getTime()
    return { start, end: wakeD.getTime() }
  }
  const { start, end } = buildTimes()
  const minutes = Math.max(0, Math.min(720, Math.round((end - start) / 60000)))

  const save = () => {
    const interruptions = Array.from({ length: wakeups }, () => ({ at: null, minutes: 0 }))
    onSave({ start, end, minutes, interruptions, source: 'manual', confident: true })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center fade-in" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-3xl bg-[#f4f1ea] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-display text-2xl font-semibold text-[#23211c]">Last night’s sleep</h3>
            <p className="mt-1 text-[13px] text-[#8a8474]">We estimate this from when you put the app down. Correct it if it’s off.</p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none text-[#a39c8d]">×</button>
        </div>

        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-[#23211c]">Went to bed</label>
            <input type="time" value={bed} onChange={(e) => setBed(e.target.value)}
              className="rounded-xl border border-[#ddd5c5] bg-white px-3 py-2 text-[#23211c] outline-none focus:border-[#3d4a32]" />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-[#23211c]">Woke up</label>
            <input type="time" value={wake} onChange={(e) => setWake(e.target.value)}
              className="rounded-xl border border-[#ddd5c5] bg-white px-3 py-2 text-[#23211c] outline-none focus:border-[#3d4a32]" />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-[#23211c]">Wake-ups</label>
            <div className="flex items-center gap-3">
              <button onClick={() => setWakeups((n) => Math.max(0, n - 1))} className="flex h-8 w-8 items-center justify-center rounded-full border border-[#d8d1c2] bg-white text-lg text-[#3d4a32]">−</button>
              <span className="w-4 text-center font-display text-lg font-semibold text-[#23211c]">{wakeups}</span>
              <button onClick={() => setWakeups((n) => n + 1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-[#d8d1c2] bg-white text-lg text-[#3d4a32]">+</button>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-2xl bg-[#23291f] px-5 py-4 text-center">
          <p className="text-[11px] uppercase tracking-[0.2em] text-[#9aa581]">That’s</p>
          <p className="font-display text-3xl font-semibold text-[#f4f1e8]">{fmtDuration(minutes)}</p>
        </div>

        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-full border border-[#d8d1c2] bg-white py-2.5 text-sm font-medium text-[#4a463c]">Cancel</button>
          <button onClick={save} className="flex-1 rounded-full bg-[#3d4a32] py-2.5 text-sm font-semibold text-[#f4f1e8] active:scale-95">Save</button>
        </div>
      </div>
    </div>
  )
}

/* ---------- body-fat estimator (US Navy method) ---------- */
const round1 = (n) => Math.round(n * 10) / 10
const clampBf = (b) => Math.max(3, Math.min(60, round1(b)))
// Blend three tape-measure-validated methods so no single bias dominates.
// All circumferences in cm. Returns { best, breakdown } or null.
function estimateBF({ sex, height, neck, waist, hip }) {
  const female = sex === 'female'
  const parts = {}
  // US Navy (Hodgdon–Beckett)
  if (height > 0 && neck > 0 && waist > 0) {
    if (female) { if (hip > 0 && waist + hip - neck > 0) parts.navy = 495 / (1.29579 - 0.35004 * Math.log10(waist + hip - neck) + 0.22100 * Math.log10(height)) - 450 }
    else if (waist - neck > 0) parts.navy = 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(height)) - 450
  }
  // Relative Fat Mass (Woolcott–Bergman 2018, validated vs DXA)
  if (height > 0 && waist > 0) parts.rfm = (female ? 76 : 64) - 20 * (height / waist)
  // Body Adiposity Index (Bergman 2011) — brings in hip
  if (hip > 0 && height > 0) parts.bai = hip / Math.pow(height / 100, 1.5) - 18

  const w = { navy: 0.45, rfm: 0.45, bai: 0.1 }
  let sum = 0, wsum = 0
  const breakdown = {}
  for (const k of ['navy', 'rfm', 'bai']) {
    if (parts[k] != null && isFinite(parts[k])) { const v = clampBf(parts[k]); breakdown[k] = v; sum += v * w[k]; wsum += w[k] }
  }
  if (!wsum) return null
  return { best: round1(sum / wsum), breakdown }
}
function bfCategory(pct, sex) {
  const m = [[6, 'Essential'], [14, 'Athletic'], [18, 'Fitness'], [25, 'Average']]
  const f = [[14, 'Essential'], [21, 'Athletic'], [25, 'Fitness'], [32, 'Average']]
  for (const [lim, name] of (sex === 'female' ? f : m)) if (pct < lim) return name
  return 'High'
}

function BodyFatModal({ profile, onClose, onSave }) {
  const m0 = profile.measurements || {}
  const [sex, setSex] = useState(profile.sex || 'male')
  const [unit, setUnit] = useState('cm')
  const [height, setHeight] = useState(profile.height ? String(round1(profile.height)) : '')
  const [neck, setNeck] = useState(m0.neck ? String(round1(m0.neck)) : '')
  const [waist, setWaist] = useState(m0.waist ? String(round1(m0.waist)) : '')
  const [hip, setHip] = useState(m0.hip ? String(round1(m0.hip)) : '')

  const toCm = (v) => (unit === 'in' ? Number(v) * 2.54 : Number(v))
  const switchUnit = (u) => {
    if (u === unit) return
    const conv = (x) => (x === '' ? '' : String(round1(u === 'in' ? Number(x) / 2.54 : Number(x) * 2.54)))
    setHeight(conv(height)); setNeck(conv(neck)); setWaist(conv(waist)); setHip(conv(hip))
    setUnit(u)
  }
  const result = estimateBF({ sex, height: toCm(height), neck: toCm(neck), waist: toCm(waist), hip: toCm(hip) })
  const breakdown = result ? Object.entries(result.breakdown).map(([k, v]) => `${k.toUpperCase()} ${v}%`).join('  ·  ') : ''

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center fade-in" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-3xl bg-[#f4f1ea] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-display text-2xl font-semibold text-[#23211c]">Estimate body fat</h3>
            <p className="mt-1 text-[13px] text-[#8a8474]">Four tape measurements, blended across three validated methods.</p>
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
        <MeasureInput label="Hip" unit={unit} value={hip} onChange={setHip} hint="Around the widest part of the hips/glutes, feet together." />

        <div className="mt-5 rounded-2xl bg-[#23291f] px-5 py-4 text-center">
          {result ? (
            <>
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#9aa581]">Estimated body fat</p>
              <p className="font-display text-4xl font-semibold text-[#f4f1e8]">{result.best}%</p>
              <p className="mt-0.5 text-[13px] text-[#cfccba]">{bfCategory(result.best, sex)}</p>
              {breakdown && <p className="mt-2 text-[11px] tracking-wide text-[#9aa581]">{breakdown}</p>}
            </>
          ) : (
            <p className="text-[13px] text-[#9aa581]">Enter your measurements to see the estimate.</p>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-full border border-[#d8d1c2] bg-white py-2.5 text-sm font-medium text-[#4a463c]">Cancel</button>
          <button disabled={!result} onClick={() => onSave(result.best, { height: Math.round(toCm(height)), sex, measurements: { neck: Math.round(toCm(neck)), waist: Math.round(toCm(waist)), hip: Math.round(toCm(hip)) } })}
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

/* ---------- rewards: streak-based, leisure/time-off, non-food ---------- */
const REWARDS = [
  { days: 3, title: 'An episode, guilt-free', detail: 'Watch your show tonight — earned.' },
  { days: 7, title: 'A movie night', detail: 'A proper movie, zero guilt.' },
  { days: 14, title: 'Sleep in', detail: 'A slow morning, no alarm.' },
  { days: 21, title: 'A gaming evening', detail: 'A full evening off the clock.' },
  { days: 30, title: 'A complete rest day', detail: 'A whole day off. You earned every bit.' },
]
function strongDay(d, profile) {
  if (!d) return false
  const r = d.routines || {}, w = d.workout || {}, meals = d.meals || {}
  const skin = r.skincareAM && r.skincarePM
  const water = (d.water || 0) >= (profile.waterTarget || 8)
  const move = (w.type && w.type !== '') || (d.steps || 0) >= (profile.stepTarget || 10000)
  const dietLogged = ['breakfast', 'lunch', 'dinner'].filter((m) => meals[m] != null).length >= 2
  return skin && water && move && dietLogged
}
function currentStreak(days, today, profile) {
  let n = 0
  for (let i = strongDay(days[today], profile) ? 0 : 1; ; i++) {
    if (strongDay(days[shiftIso(today, -i)], profile)) n++; else break
  }
  return n
}
function dayGaps(d, profile) {
  const r = (d && d.routines) || {}, w = (d && d.workout) || {}, meals = (d && d.meals) || {}
  const gaps = []
  if (!(r.skincareAM && r.skincarePM)) gaps.push('skincare')
  if (!((d?.water || 0) >= (profile.waterTarget || 8))) gaps.push('water')
  if (!((w.type && w.type !== '') || (d?.steps || 0) >= (profile.stepTarget || 10000))) gaps.push('movement')
  if (['breakfast', 'lunch', 'dinner'].filter((m) => meals[m] != null).length < 2) gaps.push('log your meals')
  return gaps
}

function RewardsSummary({ state, profile, today, onOpen }) {
  const days = state.days || {}
  const streak = currentStreak(days, today, profile)
  const claimed = state.rewardsClaimed || {}
  const claimable = REWARDS.filter((rw) => streak >= rw.days && !claimed[rw.days])
  const next = REWARDS.find((rw) => streak < rw.days)
  const sub = claimable.length
    ? `${claimable.length} reward${claimable.length > 1 ? 's' : ''} ready to claim`
    : next ? `Next: ${next.title} in ${next.days - streak} day${next.days - streak === 1 ? '' : 's'}`
      : 'All rewards claimed'
  return (
    <button onClick={onOpen} className="mt-4 flex w-full items-center justify-between gap-3 rounded-3xl border border-[#e6dfd0] bg-[#fbf9f3] p-5 text-left shadow-[0_2px_10px_-6px_rgba(60,55,40,0.25)] active:scale-[0.99]">
      <div className="min-w-0">
        <h2 className="font-display text-xl font-semibold text-[#23211c]">Rewards</h2>
        <p className="mt-0.5 text-[13px] text-[#8a8474]">{streak > 0 ? `${streak}-day streak · ` : ''}{sub}</p>
      </div>
      <span className={`shrink-0 ${claimable.length ? 'text-[#3d4a32]' : 'text-[#a39c8d]'}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
      </span>
    </button>
  )
}

function RewardsSection({ state, profile, today, onClaim }) {
  const days = state.days || {}
  const streak = currentStreak(days, today, profile)
  const todayD = days[today]
  const todayStrong = strongDay(todayD, profile)
  const gaps = dayGaps(todayD, profile)
  const claimed = state.rewardsClaimed || {}

  return (
    <section className="mt-4 rounded-3xl border border-[#e6dfd0] bg-[#fbf9f3] p-5 shadow-[0_2px_10px_-6px_rgba(60,55,40,0.25)]">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl font-semibold text-[#23211c]">Rewards</h2>
        <span className="text-[14px] font-semibold text-[#3d4a32]">{streak > 0 ? `${streak}-day streak` : 'No streak yet'}</span>
      </div>
      <p className="mt-0.5 text-[12px] text-[#8a8474]">Strong days in a row unlock these. One off-day resets the streak — that’s the deal.</p>

      <div className="mt-3 rounded-2xl bg-[#23291f] px-4 py-3 text-[13px] text-[#cfccba]">
        {todayStrong
          ? <p><span className="font-semibold text-[#f4f1e8]">Today’s locked in.</span> Your streak lives another day.</p>
          : <p>To keep the streak alive today: <span className="font-semibold text-[#f4f1e8]">{gaps.join(', ') || 'finish your day'}</span>.</p>}
      </div>

      <ul className="mt-4">
        {REWARDS.map((rw, i) => {
          const unlocked = streak >= rw.days
          const when = claimed[rw.days]
          return (
            <li key={rw.days} className={`flex items-center justify-between gap-3 py-3 ${i ? 'border-t border-[#ece6da]' : ''}`}>
              <div className="min-w-0">
                <p className={`text-[14px] font-semibold ${unlocked ? 'text-[#23211c]' : 'text-[#a39c8d]'}`}>{rw.title}</p>
                <p className="text-[12px] text-[#8a8474]">{rw.detail} · {rw.days}-day streak</p>
              </div>
              <div className="shrink-0">
                {when ? (
                  <span className="text-[12px] text-[#5b6745]">Claimed {fmtMD(when)}</span>
                ) : unlocked ? (
                  <button onClick={() => onClaim(rw.days)} className="rounded-full bg-[#3d4a32] px-4 py-1.5 text-[13px] font-medium text-[#f4f1e8] active:scale-95">Claim</button>
                ) : (
                  <span className="text-[12px] text-[#a39c8d]">{rw.days - streak} day{rw.days - streak === 1 ? '' : 's'} to go</span>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function SyncIndicator({ status }) {
  // Syncing → spinning arrows. Unsynced → amber alert. Synced → constant check.
  if (status === 'syncing') {
    return (
      <span title="Syncing…" style={{ color: '#3d4a32' }}>
        <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
      </span>
    )
  }
  if (status === 'unsynced') {
    return (
      <span title="Not synced — changes are saved on this device only" style={{ color: '#b9742f' }} className="flex items-center gap-1">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
        <span className="text-[10px] font-medium uppercase tracking-wider">Unsynced</span>
      </span>
    )
  }
  return (
    <span title="All changes synced" style={{ color: '#3d4a32' }} className="flex items-center gap-1">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="m8.5 12.3 2.3 2.3 4.7-5" /></svg>
      <span className="text-[10px] font-medium uppercase tracking-wider">Synced</span>
    </span>
  )
}
function Centered({ children }) { return <div className="flex min-h-screen items-center justify-center px-6 text-center text-[#8a8474]">{children}</div> }
function prettyToday(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[m - 1]} ${d} · ${y}`
}
