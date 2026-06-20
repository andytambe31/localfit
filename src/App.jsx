import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import SkincareFlow from './SkincareFlow'
import TrainFlow from './TrainFlow'
import { buildSession, estimateSessionMinutes, decideEveningPriority, recentSessions } from './train'
import { weeklyCheckin } from './adapt'
import { hairDue } from './hair'
import HairFlow from './HairFlow'
import { LOCATIONS, defaultLocation, pantryFor, effectivePantry, calorieTarget, calorieBreakdown, calorieZone, dayTotals, entryFromItem, mealForTime, MEAL_ORDER, MEAL_LABEL, groupOf, GROUP_ORDER, dayCritique, isUnhealthy, applyMods, buildFromComponents, componentsFromItem, isSeedFood, FOOD_UNITS, FOOD_LOCS, dietScore as foodScore, PROTEIN_TARGET_DEFAULT } from './diet'
import ComponentBuilder from './ComponentBuilder'
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
  routines: { skincareAM: false, skincarePM: false, haircare: false, haircareAM: false, haircarePM: false },
  water: 0, meals: { breakfast: null, lunch: null, dinner: null }, mealNote: '',
  food: [], // running protein-first food log (diet feature)
  skincare: { am: null, pm: null },
  hair: { am: null, pm: null },
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
  const [hairFlow, setHairFlow] = useState(null) // 'am' | 'pm' | null — guided hair takeover
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
  const overlayOpen = !!flow || !!hairFlow || training || manageProducts || booting
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
  // Data is localStorage-first — every change is saved to the device instantly.
  // There's no backend; durability comes from a manual Export to Files (iCloud
  // Drive). `pending` = changes made since the last export; lastBackup tracks it.
  const [pending, setPending] = useState(false)
  const [lastBackup, setLastBackup] = useState(() => Number(localStorage.getItem('localfit-last-backup')) || null)
  const [backupOpen, setBackupOpen] = useState(false)
  const scheduleSync = () => {} // sync retired; kept as a no-op so write paths stay clean

  // Export the whole local state as a JSON file → the iOS share sheet ("Save to
  // Files"), or a download elsewhere. Marks the data as backed up.
  async function exportData() {
    const data = loadLocal() || state
    const json = JSON.stringify(data)
    const name = `localfit-backup-${isoToday()}.json`
    try {
      const file = new File([json], name, { type: 'application/json' })
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'localfit backup' })
      } else {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
        const a = document.createElement('a'); a.href = url; a.download = name
        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
      }
      const now = Date.now()
      localStorage.setItem('localfit-last-backup', String(now))
      setLastBackup(now); setPending(false)
    } catch { /* user cancelled the share sheet — leave state as-is */ }
  }
  // Restore from a backup file's text (replaces this device's data, with a confirm).
  function importData(text) {
    let data
    try { data = JSON.parse(text) } catch { window.alert("That file isn't valid JSON."); return }
    if (!data || typeof data !== 'object' || !data.days) { window.alert("That doesn't look like a localfit backup."); return }
    if (!window.confirm("Replace this device's data with the backup? Anything not exported will be overwritten.")) return
    ensureProfile(data.profile ||= {})
    saveLocal(data); setState(data); setBackupOpen(false)
  }

  useEffect(() => {
    const local = loadLocal()
    if (local) {
      ensureProfile(local.profile ||= {})
      if (Array.isArray(local.pantry)) local.pantry = local.pantry.filter((it) => !it.seed) // drop legacy seed items
      saveLocal(local)
      setState(local)
    } else {
      // First run / storage cleared → start fresh. Restore a prior backup via Import.
      const init = DEFAULT_STATE; ensureProfile(init.profile ||= {})
      setState(init); saveLocal(init)
    }
    // Record foreground activity (feeds sleep inference from the overnight gap).
    recordActivity()
    const onVisible = () => { if (document.visibilityState === 'visible') recordActivity() }
    document.addEventListener('visibilitychange', onVisible)
    const heartbeat = setInterval(recordActivity, 60000)
    return () => { document.removeEventListener('visibilitychange', onVisible); clearInterval(heartbeat) }
  }, [])

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
    // Weight is logged from the always-on top card now, so don't reset the focus
    // override (that would close whatever card the user is currently in).
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
  // Guided hair routine finished — log the steps; haircare stays true for scoring.
  function completeHairRoutine(slot, log) {
    const routineKey = slot === 'am' ? 'haircareAM' : 'haircarePM'
    patch({ hair: { [slot]: log }, routines: { [routineKey]: true, haircare: true } })
    setHairFlow(null)
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

  // --- diet: one running food log per day ---
  function logFood(item, qty = 1) {
    setState((prev) => {
      const next = clone(prev)
      next.days[today] = next.days[today] || defaultDay()
      next.days[today].food = [...(next.days[today].food || []), entryFromItem(item, Date.now(), qty)]
      next.days[today]._ts = Date.now()
      saveLocal(next); return next
    })
    setPending(true); scheduleSync()
  }
  function removeFood(idx) {
    setState((prev) => {
      const next = clone(prev)
      const food = [...(next.days[today]?.food || [])]
      food.splice(idx, 1)
      next.days[today].food = food
      next.days[today]._ts = Date.now()
      saveLocal(next); return next
    })
    setPending(true); scheduleSync()
  }
  // Persist the day's food location WITHOUT clearing the focus override (patch
  // resets override → focus would jump back to the coach's pick, e.g. skin).
  function setFoodLoc(loc) {
    setState((prev) => {
      const next = clone(prev)
      next.days[today] = next.days[today] || defaultDay()
      next.days[today].foodLoc = loc
      next.days[today]._ts = Date.now()
      saveLocal(next); return next
    })
    setPending(true); scheduleSync()
  }
  // Quick-add a brand-new food: creates a pantry item (provisional if no macros
  // yet — backfilled later) and logs it in one go.
  function addFood({ name, portion, kcal, protein, carbs, fat, group, loc }) {
    const useLoc = loc || day.foodLoc || defaultLocation(today)
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + Date.now().toString(36)
    const item = { id, name, portion: portion || '1 serving', loc: useLoc, group: group || undefined,
      kcal: kcal || 0, protein: protein || 0, carbs: carbs || 0, fat: fat || 0, fiber: 0,
      provisional: !((kcal || 0) > 0 || (protein || 0) > 0), custom: true }
    setState((prev) => {
      const next = clone(prev)
      next.pantry = [...(next.pantry || []), item]
      next.days[today] = next.days[today] || defaultDay()
      next.days[today].food = [...(next.days[today].food || []), entryFromItem(item, Date.now())]
      next.days[today]._ts = Date.now()
      saveLocal(next); return next
    })
    setPending(true); scheduleSync()
  }
  // Create or edit a customizable food built from parts (Hummus + Baguette). The
  // parts become adjustable mods; baseline macros = the sum at default amounts.
  // Pantry setup only — no auto-log (tap the chip to log it, adjusting parts then).
  // Editing a seed food stores an `edited` override that wins over the baked seed.
  function saveCustomFood({ name, group, loc, components }, editId = null) {
    const built = buildFromComponents(components || [])
    const b = built.base
    const fields = {
      name, loc: loc || day.foodLoc || defaultLocation(today), group: group || undefined,
      portion: (components || []).map((c) => c.name).filter(Boolean).join(' + ') || '1 serving',
      kcal: b.kcal, protein: b.protein, carbs: b.carbs, fat: b.fat, fiber: 0,
      mods: built.mods, custom: true,
      provisional: !(b.kcal > 0 || b.protein > 0),
    }
    setState((prev) => {
      const next = clone(prev)
      next.pantry = next.pantry || []
      if (editId) {
        const i = next.pantry.findIndex((p) => p.id === editId)
        const merged = { ...(i >= 0 ? next.pantry[i] : {}), id: editId, ...fields, ...(isSeedFood(editId) ? { edited: true } : {}) }
        if (i >= 0) next.pantry[i] = merged
        else next.pantry.push(merged)
      } else {
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + Date.now().toString(36)
        next.pantry.push({ id, ...fields })
      }
      next.days[today] = next.days[today] || defaultDay()
      next.days[today]._ts = Date.now()
      saveLocal(next); return next
    })
    setPending(true); scheduleSync()
  }
  // Wipe today's food log. Clears localStorage immediately; the bumped _ts means
  // the next sync overwrites the backend's day (day-level last-write-wins), so the
  // entries are gone from the Mac too once you're home/reachable.
  function resetFood() {
    setState((prev) => {
      const next = clone(prev)
      if (next.days[today]) { next.days[today].food = []; next.days[today]._ts = Date.now() }
      saveLocal(next); return next
    })
    setPending(true); scheduleSync()
  }
  // Reassign a logged item to a different meal (overrides the time-based auto-tag).
  function moveFood(idx, meal) {
    setState((prev) => {
      const next = clone(prev)
      const food = [...(next.days[today]?.food || [])]
      if (food[idx]) food[idx] = { ...food[idx], meal }
      next.days[today].food = food
      next.days[today]._ts = Date.now()
      saveLocal(next); return next
    })
    setPending(true); scheduleSync()
  }

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
  const coach = buildCoach({ hour, minute, day, profile, skinDue, lastSleep, state, today })
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

  // Hair mirrors skin: AM/PM slots, window-gated, launches its own story flow.
  const hairSlot = inPmWindow ? 'pm' : 'am'
  const hairSlotDone = hairSlot === 'am' ? r.haircareAM : r.haircarePM
  const hairDueInfo = hairDue(today, state)
  let hairAttn = 'idle'
  if (!skinLocked && !hairSlotDone && (hairSlot === 'am' ? hairDueInfo.amPending : hairDueInfo.pmPending)) {
    hairAttn = hairSlot === 'pm' && hour >= 22 ? 'urgent' : 'attention'
  }

  // Movement goal depends on the day. Rest day → steps ARE the goal, so the ring
  // fills with steps. Training day → the lift is the goal (the ring is mostly
  // empty until trained); steps are only a small secondary contribution (≤30%),
  // so hitting steps alone never makes it look close to done.
  const trainedToday = w.did || w.session?.status === 'done'
  const stepTarget = profile.stepTarget || 10000
  const stepFrac = Math.min(1, (day.steps || 0) / stepTarget)
  const moveDone = trainCall.rest ? (day.steps || 0) >= stepTarget : trainedToday
  const moveProgress = trainCall.rest ? stepFrac : 0.3 * stepFrac
  const waterTarget = profile.waterTarget || 8

  const areas = [
    { id: 'skin', label: 'Skin', done: skinSlotDone, attn: skinAttn, locked: skinLocked && !skinSlotDone, hint: skinHint },
    { id: 'movement', label: 'Train', done: moveDone, progress: moveProgress, attn: w.session?.status === 'active' ? 'urgent' : 'idle' },
    { id: 'diet', label: 'Diet', progress: Math.min(1, dayTotals(day).protein / (profile.proteinTarget || PROTEIN_TARGET_DEFAULT)) },
    { id: 'water', label: 'Water', done: (day.water || 0) >= waterTarget, progress: Math.min(1, (day.water || 0) / waterTarget) },
    { id: 'hair', label: 'Hair', done: hairSlotDone, attn: hairAttn, locked: skinLocked && !hairSlotDone, hint: skinHint },
  ]

  const setWater = (delta) => patch({ water: Math.max(0, (day.water || 0) + delta) })

  return (
    <>
    {booting && <Splash leaving={bootLeaving} />}
    <div className="mx-auto max-w-xl px-5 pb-16 pt-7 fade-in">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="font-display text-lg font-semibold tracking-tight text-[#20201d]">localfit</span>
        <div className="flex items-center gap-2">
          <BackupButton pending={pending} lastBackup={lastBackup} onOpen={() => setBackupOpen(true)} />
          <span className="text-[11px] uppercase tracking-[0.18em] text-[#a39c8d]">{prettyToday(today)}</span>
        </div>
      </div>
      {(!lastBackup || Date.now() - lastBackup > 7 * 86400000) && (
        <button onClick={() => setBackupOpen(true)} className="mb-4 flex w-full items-center gap-2 rounded-xl border border-[#e7d4b6] bg-[#f7ecd6] px-3 py-2 text-left text-[12px] text-[#8a5a1e]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" />
          </svg>
          <span>{lastBackup ? "It's been a while — back up your data to Files so you don't lose it." : 'Your data lives only on this device. Tap to export a backup to Files.'}</span>
        </button>
      )}

      {/* The coach speaks — directive, one thing at a time */}
      <section className="rounded-[28px] bg-[#23291f] px-6 py-7 shadow-[0_18px_40px_-24px_rgba(35,41,31,0.7)]">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#9aa581]">{coach.eyebrow}</p>
        <h1 className="font-display mt-3 text-[26px] font-semibold leading-[1.16] text-[#f4f1e8]">{coach.headline}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[#cfccba]">{coach.support}</p>
      </section>

      <WeightCard weightLog={state.weightLog || []} today={today} day={day} onSave={saveWeight} cal={calorieBreakdown(state)} />

      {(() => {
        const checkin = weeklyCheckin(state, today)
        return checkin.due && checkin.findings.length > 0 ? (
          <CheckinCard checkin={checkin}
            onApply={(changes) => updateProfile({ ...changes, lastCheckin: today })}
            onDismiss={() => updateProfile({ lastCheckin: today })} />
        ) : null
      })()}

      {focus ? (
        <FocusCard
          focus={focus} day={day} profile={profile} hour={hour} weightLog={state.weightLog || []}
          state={state} dateIso={today}
          onStartSkin={setFlow} onManageProducts={() => setManageProducts(true)}
          onSkinSensitive={(v) => updateProfile({ skincare: { ...profile.skincare, sensitive: v } })}
          onSteps={(v) => patch({ steps: v })}
          onStartTrain={() => setTraining(true)} train={trainCall}
          onStartHair={(slot) => setHairFlow(slot)}
          onLogFood={logFood} onRemoveFood={removeFood} onAddFood={addFood} onSaveCustom={saveCustomFood} onSetLoc={setFoodLoc} onResetFood={resetFood} onMoveFood={moveFood}
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
              <button key={a.id} onClick={() => (a.id === 'skin' ? setFlow(skinSlot) : a.id === 'hair' ? setHairFlow(hairSlot) : setOverride(a.id))}
                className={`relative rounded-2xl border px-1 py-3 text-center transition ${tile}`}>
                {(urgent || attention) && (
                  <span className={`absolute -top-2 left-1/2 -translate-x-1/2 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${urgent ? 'bg-[#3d4a32] text-[#f4f1e8]' : 'bg-[#dfe6cf] text-[#3d4a32]'}`}>Now</span>
                )}
                {a.done ? (
                  <span className="mx-auto mb-1.5 grid h-4 w-4 place-items-center rounded-full bg-[#3d4a32]">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#f4f1e8" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  </span>
                ) : a.progress != null ? (
                  <ProgressRing value={a.progress} />
                ) : (
                  <span className={`mx-auto mb-1.5 block h-4 w-4 rounded-full border-2 ${urgent || attention ? 'border-[#7d8a5f]' : 'border-[#d8d1c2]'}`} />
                )}
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
      {hairFlow && (
        <HairFlow
          slot={hairFlow} dateIso={today} state={state}
          onComplete={completeHairRoutine}
          onClose={() => setHairFlow(null)} />
      )}
      {backupOpen && (
        <BackupSheet lastBackup={lastBackup} pending={pending} onExport={exportData} onImport={importData} onClose={() => setBackupOpen(false)} />
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

function FocusCard({ focus, day, profile, hour, weightLog, state, dateIso, onStartSkin, onManageProducts, onSkinSensitive, onSteps, onStartTrain, train, onStartHair, onLogFood, onRemoveFood, onAddFood, onSaveCustom, onSetLoc, onResetFood, onMoveFood, onWater, onWeight }) {
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
          <div className="mt-3 flex items-center justify-between">
            <button onClick={onManageProducts} className="text-[13px] font-medium text-[#6f6a5d] underline-offset-2 hover:underline">Manage products</button>
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] text-[#a39c8d]">Skin:</span>
              <Chip small on={!profile.skincare?.sensitive} onClick={() => onSkinSensitive(false)}>Calm</Chip>
              <Chip small on={!!profile.skincare?.sensitive} onClick={() => onSkinSensitive(true)}>Reacting</Chip>
            </div>
          </div>
          {profile.skincare?.sensitive && <p className="mt-2 text-[12px] text-[#b08a3a]">Easing your actives — spacing them out until your skin settles.</p>}
        </div>
      )}

      {focus === 'hair' && (
        <div className="space-y-2">
          <SkinStart label="Start morning hair" done={r.haircareAM} primary={hour < 17} locked={!(hour >= 6 && hour < 12)} hint="Opens 6 AM" onClick={() => onStartHair('am')} />
          <SkinStart label="Start evening hair" done={r.haircarePM} primary={hour >= 17} locked={hour < 18} hint="Opens 6 PM" onClick={() => onStartHair('pm')} />
        </div>
      )}

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
        <DietCard state={state} dateIso={dateIso} day={day}
          onLog={onLogFood} onRemove={onRemoveFood} onAdd={onAddFood} onSaveCustom={onSaveCustom} onLoc={onSetLoc} onReset={onResetFood} onMove={onMoveFood} />
      )}

      {focus === 'movement' && (
        <div className="space-y-3">
          <TrainStart train={train} onStart={onStartTrain} />
          <Field label="Steps today">
            <NumInput value={day.steps || ''} placeholder={String(profile.stepTarget)} onCommit={onSteps} />
            <span className="text-[13px] text-[#8a8474]">of {profile.stepTarget.toLocaleString()}</span>
          </Field>
          <TrainingProgress state={state} />
        </div>
      )}
    </section>
  )
}

// Weekly check-in: outcome-driven findings + one-tap plan adjustments.
function CheckinCard({ checkin, onApply, onDismiss }) {
  const hasChanges = Object.keys(checkin.changes).length > 0
  return (
    <section className="mt-4 rounded-2xl border border-[#cdd6b8] bg-[#eef0e6] px-4 py-3.5">
      <p className="text-[11px] uppercase tracking-[0.18em] text-[#7d8a5f]">Weekly check-in</p>
      <ul className="mt-2 space-y-1.5">
        {checkin.findings.map((f, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-snug text-[#3a4230]">
            <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${f.tone === 'warn' ? 'bg-[#c9742e]' : 'bg-[#5b6a44]'}`} />
            <span><span className="font-semibold">{f.area}.</span> {f.text}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        {hasChanges && <button onClick={() => onApply(checkin.changes)} className="rounded-full bg-[#3d4a32] px-4 py-1.5 text-[13px] font-semibold text-[#f4f1e8]">Apply changes</button>}
        <button onClick={onDismiss} className="rounded-full px-3 py-1.5 text-[13px] font-medium text-[#6f6a5d]">{hasChanges ? 'Not now' : 'Got it'}</button>
      </div>
    </section>
  )
}

// A compact "you're getting stronger" recap: recent sessions with sets, volume, PRs.
function TrainingProgress({ state }) {
  const sessions = recentSessions(state, 4)
  if (!sessions.length) return null
  return (
    <div className="rounded-2xl border border-[#e6dfd0] bg-[#fbf9f3] p-3">
      <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-[#a39c8d]">Recent sessions</p>
      <div className="space-y-1.5">
        {sessions.map((s) => (
          <div key={s.date} className="flex items-center justify-between text-[13px]">
            <span className="text-[#3a382f]">{s.label} <span className="text-[#a39c8d]">· {fmtMD(s.date)}</span></span>
            <span className="text-[12px] text-[#8a8474]">{s.sets} sets · {s.volume.toLocaleString()} lb{s.beaten > 0 ? ` · ${s.beaten} PR` : ''}</span>
          </div>
        ))}
      </div>
    </div>
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

// Protein-first pantry card: ring + location toggle + next-grab recommendation +
// tap-to-log pantry + running log. Calorie line appears once weight is known.
function DietCard({ state, dateIso, day, onLog, onRemove, onAdd, onSaveCustom, onLoc, onReset, onMove }) {
  const [adding, setAdding] = useState(false)
  const [builder, setBuilder] = useState(null) // { initial, editId } → ComponentBuilder
  const [qtyItem, setQtyItem] = useState(null) // long-pressed item → quantity editor
  const [confirmReset, setConfirmReset] = useState(false)
  const [reviewing, setReviewing] = useState(false) // full-screen day review
  const [foodGroup, setFoodGroup] = useState(null)  // selected pantry category
  const proteinTarget = state.profile?.proteinTarget || PROTEIN_TARGET_DEFAULT
  const loc = day.foodLoc || defaultLocation(dateIso)
  const totals = dayTotals(day)
  const ct = calorieTarget(state)
  const items = pantryFor(effectivePantry(state), loc)
  const log = day.food || []
  const pPct = Math.min(100, Math.round((totals.protein / proteinTarget) * 100))
  const zone = ct && totals.count ? calorieZone(totals.kcal, ct.ceiling) : null
  const zoneCls = { green: 'text-[#5b6745]', yellow: 'text-[#866a1c]', red: 'text-[#b0552a]' }
  // Group the log by auto-assigned meal (older entries may lack `meal` → derive).
  // Pantry grouped by category so we show one group at a time (not a long list).
  const groups = [...new Set(items.map(groupOf))].sort((a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b))
  const tabs = ['All', ...groups]
  const activeGroup = (foodGroup === 'All' || groups.includes(foodGroup)) ? foodGroup : groups[0]
  const shownItems = activeGroup === 'All' ? items : items.filter((it) => groupOf(it) === activeGroup)

  return (
    <div className="space-y-4">
      {/* reset today's entries — top layer */}
      {log.length > 0 && (
        <div className="-mb-1 flex justify-end">
          {confirmReset ? (
            <span className="text-[12px] text-[#8a8474]">Clear today's food?{' '}
              <button onClick={() => { onReset(); setConfirmReset(false) }} className="font-semibold text-[#b0552a]">Reset</button>{' · '}
              <button onClick={() => setConfirmReset(false)} className="text-[#8a8474]">Cancel</button>
            </span>
          ) : (
            <button onClick={() => setConfirmReset(true)} className="text-[12px] text-[#b3ac9c] hover:text-[#8a5a1e]">Reset day</button>
          )}
        </div>
      )}

      {/* protein ring (bar) + calorie guardrail */}
      <div>
        <div className="flex items-baseline justify-between">
          <span className="font-display text-[26px] font-semibold text-[#23211c]">
            {Math.round(totals.protein)}<span className="text-[15px] font-normal text-[#8a8474]"> / {proteinTarget}g protein</span>
          </span>
          {ct
            ? <span className={`text-[13px] ${zone ? zoneCls[zone] : 'text-[#8a8474]'}`}>{totals.kcal} / {ct.ceiling} cal</span>
            : <span className="text-[12px] text-[#b08a3a]">log weight for a calorie target</span>}
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#e6dfd0]">
          <div className="h-full rounded-full bg-[#3d4a32] transition-all" style={{ width: `${pPct}%` }} />
        </div>
        {zone === 'yellow' && <p className="mt-1 text-[12px] text-[#866a1c]">A touch over target — still a deficit. Just don't drift higher.</p>}
        {zone === 'red' && <p className="mt-1 text-[12px] text-[#b0552a]">Well over target — today's deficit is mostly gone. Rein it in.</p>}
      </div>

      {/* location toggle */}
      <div className="flex gap-2">
        {LOCATIONS.map((l) => <Chip key={l} small on={loc === l} onClick={() => onLoc(l)}>{l[0].toUpperCase() + l.slice(1)}</Chip>)}
      </div>

      {/* pantry — category filter, then tap to log */}
      <div>
        {items.length > 0 ? (
          <>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {tabs.map((g) => <Chip key={g} small on={g === activeGroup} onClick={() => setFoodGroup(g)}>{g}</Chip>)}
            </div>
            <div className="flex flex-wrap gap-2">
              {shownItems.map((it) => (
                <PantryButton key={it.id} item={it} onTap={() => onLog(it, 1)} onLongPress={() => setQtyItem(it)} />
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-[#b3ac9c]">Tap to log one · press &amp; hold to set a quantity</p>
          </>
        ) : (
          <p className="text-[13px] text-[#8a8474]">Nothing here yet — add what you ate below.</p>
        )}
      </div>

      {/* quick-add */}
      {adding
        ? <AddFoodForm defaultLoc={loc} onAdd={(f) => { onAdd(f); setAdding(false) }}
            onBuild={(seed) => { setAdding(false); setBuilder({ initial: { ...seed, components: [] }, editId: null }) }}
            onCancel={() => setAdding(false)} />
        : <button onClick={() => setAdding(true)} className="text-[13px] font-medium text-[#3d4a32]">+ Add food</button>}

      {/* today's food → its own screen (keeps the dashboard light) */}
      {log.length > 0 && (
        <button onClick={() => setReviewing(true)}
          className="flex w-full items-center justify-between border-t border-[#e6dfd0] pt-3 text-left">
          <span className="text-[13px] text-[#6f6a5d]">Today · {Math.round(totals.protein)}g protein{ct ? `, ${totals.kcal} cal` : ''} · {log.length} item{log.length > 1 ? 's' : ''}</span>
          <span className="flex items-center gap-1 text-[13px] font-medium text-[#3d4a32]">See today's food
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </span>
        </button>
      )}

      {qtyItem && (
        <QtyEditor item={qtyItem}
          onLog={(loggedItem, q) => { onLog(loggedItem, q); setQtyItem(null) }}
          onEdit={(it) => { setQtyItem(null); setBuilder({ initial: { name: it.name, loc: it.loc, group: groupOf(it), components: componentsFromItem(it) }, editId: it.id }) }}
          onClose={() => setQtyItem(null)} />
      )}
      {builder && (
        <ComponentBuilder initial={builder.initial} editId={builder.editId}
          onSave={(payload) => { onSaveCustom(payload, builder.editId); setBuilder(null) }}
          onCancel={() => setBuilder(null)} />
      )}
      {reviewing && (
        <FoodReview state={state} dateIso={dateIso} day={day} proteinTarget={proteinTarget}
          onRemove={onRemove} onReset={onReset} onMove={onMove} onClose={() => setReviewing(false)} />
      )}
    </div>
  )
}

// A pantry chip: single tap logs one serving; press-and-hold opens the quantity
// editor. Pointer events unify touch + mouse; contextmenu is suppressed so the
// iOS long-press callout doesn't fire.
function PantryButton({ item, onTap, onLongPress }) {
  const longRef = useRef(false)
  const timer = useRef(null)
  const bad = isUnhealthy(item)
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  const down = () => { longRef.current = false; timer.current = setTimeout(() => { longRef.current = true; onLongPress() }, 450) }
  const up = () => { clear(); if (!longRef.current) onTap() }
  return (
    <button onPointerDown={down} onPointerUp={up} onPointerLeave={clear} onPointerCancel={clear}
      onContextMenu={(e) => e.preventDefault()} style={{ WebkitTouchCallout: 'none' }}
      className={`select-none rounded-full border px-3 py-1.5 text-[13px] text-[#3a382f] transition active:scale-[0.97] ${
        bad ? 'border-[#dcae73] bg-[#fbf1e1] hover:bg-[#f6e9d3]' : 'border-[#d8d1c2] bg-[#fbf9f3] hover:bg-[#f3efe6]'}`}>
      {bad && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[#c9742e] align-middle" title="Treat" />}
      {item.name} <span className="text-[#a39c8d]">· {item.portion}</span>
    </button>
  )
}

// Quantity editor (bottom sheet): set how many servings of an item to log in one
// go, with a live macro preview. The serving label is the item's own unit.
function QtyEditor({ item, onLog, onEdit, onClose }) {
  const [qty, setQty] = useState(1)
  const [mods, setMods] = useState(() => Object.fromEntries((item.mods || []).map((m) => [m.id, m.default])))
  const q = qty > 0 ? Math.round(qty * 100) / 100 : 1
  const bump = (d) => setQty((v) => Math.max(0.25, Math.round((v + d) * 100) / 100))
  const adj = applyMods(item, mods)
  const setMod = (m, v) => setMods((s) => ({ ...s, [m.id]: Math.max(m.min ?? 0, Math.min(m.max ?? 99, v)) }))
  const log = () => {
    const changed = (item.mods || []).filter((m) => mods[m.id] !== m.default)
      .map((m) => `${m.label.replace(/\s*\(.*\)/, '')}: ${mods[m.id]}${m.unit ? ` ${m.unit}` : ''}`).join(', ')
    onLog({ ...item, ...adj, portion: changed ? `${item.portion} · ${changed}` : item.portion }, q)
  }
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4 fade-in" onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl bg-[#fbf9f3] p-5 shadow-[0_24px_60px_-20px_rgba(35,41,31,0.6)]" onClick={(e) => e.stopPropagation()}>
        <p className="font-display text-[19px] font-semibold text-[#23211c]">{item.name}</p>
        <p className="text-[13px] text-[#8a8474]">{item.portion} · {adj.protein}g protein · {adj.kcal} cal each</p>

        {(item.mods || []).length > 0 && (
          <div className="mt-3 space-y-1.5 rounded-2xl border border-[#e6dfd0] bg-[#f6f2e9] p-3">
            {item.mods.map((m) => (
              <div key={m.id} className="flex items-center justify-between">
                <span className="text-[13px] text-[#4a463c]">{m.label}{m.unit ? <span className="text-[#a39c8d]"> · {m.unit}</span> : null}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setMod(m, mods[m.id] - 1)} className="grid h-7 w-7 place-items-center rounded-full bg-[#e3ddcd] text-[#3d4a32]">−</button>
                  <span className="min-w-[1.5rem] text-center text-[15px] font-semibold tabular-nums text-[#23211c]">{mods[m.id]}</span>
                  <button onClick={() => setMod(m, mods[m.id] + 1)} className="grid h-7 w-7 place-items-center rounded-full bg-[#e3ddcd] text-[#3d4a32]">+</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center justify-center gap-5">
          <RoundBtn onClick={() => bump(-1)}>−</RoundBtn>
          <div className="text-center">
            <input value={q} onChange={(e) => setQty(Number(e.target.value) || 0)} inputMode="decimal"
              className="w-24 rounded-xl border border-[#ddd5c5] bg-white px-2 py-2 text-center font-display text-[26px] font-semibold text-[#23211c] outline-none focus:border-[#3d4a32]" />
            <div className="mt-1 text-[11px] text-[#a39c8d]">× {item.portion}</div>
          </div>
          <RoundBtn onClick={() => bump(1)}>+</RoundBtn>
        </div>

        <div className="mt-3 flex justify-center gap-2">
          {[0.5, 1, 2, 3, 5].map((n) => <Chip key={n} small on={q === n} onClick={() => setQty(n)}>×{n}</Chip>)}
        </div>

        <p className="mt-4 text-center text-[14px] text-[#3d4a32]">
          {q} × {item.portion} → <span className="font-semibold">{Math.round(adj.protein * q * 10) / 10}g protein</span>, {Math.round(adj.kcal * q)} cal
        </p>

        <button onClick={log} className="mt-4 w-full rounded-full bg-[#3d4a32] px-6 py-3 text-[15px] font-semibold text-[#f4f1e8]">Log it</button>
        <div className="mt-2 flex items-center justify-between">
          <button onClick={onClose} className="py-2 text-[13px] text-[#8a8474]">Cancel</button>
          {onEdit && <button onClick={() => onEdit(item)} className="py-2 text-[13px] font-medium text-[#3d4a32]">Customize parts →</button>}
        </div>
      </div>
    </div>,
    document.body
  )
}

// Full-screen day review: protein/calorie totals, an honest critique, and the
// food grouped by auto-assigned meal. Keeps the dashboard card light.
function FoodReview({ state, dateIso, day, proteinTarget, onRemove, onReset, onMove, onClose }) {
  const [confirmReset, setConfirmReset] = useState(false)
  const [movingIdx, setMovingIdx] = useState(null) // entry being reassigned to a meal
  const totals = dayTotals(day)
  const ct = calorieTarget(state)
  const crit = dayCritique(state, dateIso, proteinTarget)
  const log = day.food || []
  const byMeal = MEAL_ORDER
    .map((m) => ({ meal: m, rows: log.map((e, i) => ({ e, i })).filter(({ e }) => (e.meal || mealForTime(new Date(e.ts))) === m) }))
    .filter((g) => g.rows.length)
  const critBg = crit.tone === 'good' ? 'bg-[#eef0e6] text-[#3d4a32]'
    : crit.tone === 'bad' ? 'bg-[#f6e3d8] text-[#9a4a22]'
    : crit.tone === 'warn' ? 'bg-[#f6eed8] text-[#866a1c]'
    : 'bg-[#f3efe6] text-[#6f6a5d]'
  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-none bg-[#f1ede4] sk-takeover-in">
      <div className="mx-auto max-w-xl px-5 pb-16 pt-6">
        <button onClick={onClose} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-[#6f6a5d]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>Back
        </button>
        <h1 className="font-display text-[24px] font-semibold text-[#23211c]">Today's food</h1>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-[#e6dfd0] bg-[#fbf9f3] px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#a39c8d]">Protein</p>
            <p className="font-display text-[22px] font-semibold text-[#23211c]">{Math.round(totals.protein)}<span className="text-[13px] font-normal text-[#8a8474]"> / {proteinTarget}g</span></p>
          </div>
          <div className="rounded-2xl border border-[#e6dfd0] bg-[#fbf9f3] px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#a39c8d]">Calories</p>
            <p className="font-display text-[22px] font-semibold text-[#23211c]">{totals.kcal}{ct && <span className="text-[13px] font-normal text-[#8a8474]"> / {ct.ceiling}</span>}</p>
          </div>
        </div>

        <div className={`mt-3 rounded-2xl px-4 py-3 ${critBg}`}>
          <p className="text-[14px] font-medium leading-snug">{crit.headline}</p>
          {crit.points?.length > 0 && (
            <ul className="mt-2 space-y-1.5 border-t border-current/10 pt-2">
              {crit.points.map((p, i) => (
                <li key={i} className="flex gap-1.5 text-[13px] leading-snug"><span className="opacity-60">—</span><span>{p}</span></li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 space-y-6">
          {byMeal.length === 0 && <p className="text-[14px] text-[#8a8474]">Nothing logged yet.</p>}
          {byMeal.map(({ meal, rows }) => {
            const mp = Math.round(rows.reduce((n, { e }) => n + (e.protein || 0), 0) * 10) / 10
            const mc = rows.reduce((n, { e }) => n + (e.kcal || 0), 0)
            return (
              <div key={meal}>
                <div className="flex items-baseline justify-between">
                  <h2 className="font-display text-[17px] font-semibold text-[#23211c]">{MEAL_LABEL[meal]}</h2>
                  <span className="text-[12px] text-[#8a8474]">{mp}g protein · {mc} cal</span>
                </div>
                <div className="mt-2 space-y-1.5">
                  {rows.map(({ e, i }) => (
                    <div key={i} className={`rounded-xl border px-3 py-2.5 ${e.unhealthy ? 'border-[#e8cfa3] bg-[#fbf3e6]' : 'border-[#e6dfd0] bg-[#fbf9f3]'}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-[14px] text-[#3a382f]">
                          {e.unhealthy && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#c9742e] align-middle" />}
                          {e.name}{e.qty > 1 && <span className="text-[#8a8474]"> ×{e.qty}</span>}
                          <span className="ml-2 text-[12px] text-[#a39c8d]">{e.provisional ? '~' : ''}{e.protein}g · {e.kcal} cal</span>
                        </span>
                        <div className="flex items-center gap-3">
                          <button onClick={() => setMovingIdx(movingIdx === i ? null : i)} className="text-[12px] font-medium text-[#9aa581]">Move</button>
                          <button onClick={() => onRemove(i)} aria-label="Remove" className="text-[16px] leading-none text-[#bdb6a5] hover:text-[#8a5a1e]">×</button>
                        </div>
                      </div>
                      {movingIdx === i && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {MEAL_ORDER.map((m) => (
                            <Chip key={m} small on={meal === m} onClick={() => { onMove(i, m); setMovingIdx(null) }}>{MEAL_LABEL[m]}</Chip>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {log.length > 0 && (
          <div className="mt-8 text-center">
            {confirmReset ? (
              <span className="text-[13px] text-[#8a8474]">Clear all of today's food?{' '}
                <button onClick={() => { onReset(); setConfirmReset(false); onClose() }} className="font-semibold text-[#b0552a]">Reset</button>{' · '}
                <button onClick={() => setConfirmReset(false)} className="text-[#8a8474]">Cancel</button>
              </span>
            ) : (
              <button onClick={() => setConfirmReset(true)} className="text-[13px] text-[#b3ac9c] hover:text-[#8a5a1e]">Reset today's food</button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

// Quick-add a new food. Protein optional — without it, the item logs provisional
// and gets its numbers filled later (matches the offline "name only" decision).
// A single macro number field. Defined at module scope (NOT inside AddFoodForm)
// so it isn't recreated every render — recreating it remounts the input and drops
// focus after each keystroke.
function MacroField({ label, value, onChange }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-[#a39c8d]">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" placeholder="—"
        className="w-full rounded-lg border border-[#ddd5c5] bg-white px-2 py-1.5 text-center text-sm outline-none focus:border-[#3d4a32]" />
    </label>
  )
}
function AddFoodForm({ defaultLoc, onAdd, onBuild, onCancel }) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('1')
  const [unit, setUnit] = useState('serving')
  const [kcal, setKcal] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [group, setGroup] = useState('Snacks')
  const [foodLoc, setFoodLoc] = useState(defaultLoc || 'home')
  const num = (v) => (v === '' ? undefined : Number(v))
  return (
    <div className="space-y-2 rounded-2xl border border-[#e0d9c9] bg-[#fbf9f3] p-3">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Food name"
        className="w-full rounded-lg border border-[#ddd5c5] bg-white px-2.5 py-1.5 text-sm outline-none focus:border-[#3d4a32]" />
      <div className="flex gap-2">
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="1" aria-label="Portion amount"
          className="w-16 shrink-0 rounded-lg border border-[#ddd5c5] bg-white px-2 py-1.5 text-center text-sm outline-none focus:border-[#3d4a32]" />
        <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Portion unit"
          className="min-w-0 flex-1 rounded-lg border border-[#ddd5c5] bg-white px-2.5 py-1.5 text-sm text-[#23211c] outline-none focus:border-[#3d4a32]">
          {FOOD_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <MacroField label="cal" value={kcal} onChange={setKcal} />
        <MacroField label="protein" value={protein} onChange={setProtein} />
        <MacroField label="carbs" value={carbs} onChange={setCarbs} />
        <MacroField label="fat" value={fat} onChange={setFat} />
      </div>
      <div>
        <p className="mb-1 text-[10px] uppercase tracking-wider text-[#a39c8d]">Where</p>
        <div className="flex flex-wrap gap-1.5">
          {FOOD_LOCS.map(([v, lbl]) => <Chip key={v} small on={foodLoc === v} onClick={() => setFoodLoc(v)}>{lbl}</Chip>)}
        </div>
      </div>
      <div>
        <p className="mb-1 text-[10px] uppercase tracking-wider text-[#a39c8d]">Category</p>
        <div className="flex flex-wrap gap-1.5">
          {GROUP_ORDER.filter((g) => g !== 'Other').map((g) => <Chip key={g} small on={group === g} onClick={() => setGroup(g)}>{g}</Chip>)}
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button disabled={!name.trim()} onClick={() => onAdd({ name: name.trim(), portion: `${(amount || '1').trim()} ${unit}`, kcal: num(kcal), protein: num(protein), carbs: num(carbs), fat: num(fat), group, loc: foodLoc })}
          className="rounded-full bg-[#3d4a32] px-4 py-1.5 text-[13px] font-semibold text-[#f4f1e8] disabled:opacity-40">Add &amp; log</button>
        <button onClick={onCancel} className="px-2 py-1.5 text-[13px] text-[#8a8474]">Cancel</button>
      </div>
      {onBuild && (
        <button onClick={() => onBuild({ name: name.trim(), loc: foodLoc, group })} className="text-[12px] font-medium text-[#3d4a32]">
          Multiple parts (e.g. hummus + baguette)? Build it →
        </button>
      )}
      <p className="text-[11px] leading-snug text-[#a39c8d]">Leave numbers blank to log provisionally and fill them in later.</p>
    </div>
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
function buildCoach({ hour, minute, day, profile, skinDue, lastSleep, state, today }) {
  const r = day.routines, w = day.workout
  skinDue = skinDue || { amPending: !r.skincareAM, pmPending: !r.skincarePM, tonightActive: null, shaveDue: false }
  const steps = day.steps || 0, target = profile.stepTarget, water = day.water || 0, wTarget = profile.waterTarget
  const t = fmtTime(hour, minute)
  const eyebrow = `Today — ${t}`
  const phase = hour < 5 ? 'latenight' : hour < 12 ? 'morning' : hour < 17 ? 'midday' : hour < 21 ? 'evening' : 'night'

  // Diet (protein-first) + training, pulled from the engines so the hero reflects
  // what you've actually logged today.
  const proteinTarget = profile.proteinTarget || PROTEIN_TARGET_DEFAULT
  const dt = dayTotals(day)
  const ct = state ? calorieTarget(state) : null
  const over = ct && dt.kcal > ct.ceiling
  const trainedToday = w.session?.status === 'done'
  const session0 = state ? buildSession(state, today) : null
  const tcall = state ? decideEveningPriority(state, today, hour, minute) : null
  const move = (c) => ({ eyebrow, headline: c.headline, support: c.support, action: { target: 'movement' } })

  // Protein nudge when meaningfully behind pace for the time of day (no nag in the
  // morning when protein is naturally low).
  const proteinNudge = () => {
    const frac = Math.max(0, Math.min(1, (hour - 8) / 13))
    if (dt.count && dt.protein < proteinTarget * frac - 25)
      return { eyebrow, headline: `Protein's lagging — ${Math.round(dt.protein)}g of ${proteinTarget}.`,
        support: over ? `You're over calories, so keep it lean — whey or egg whites, nothing heavy.` : `Grab a lean source (whey, chicken, Greek yogurt) to get back on pace.`,
        action: { target: 'diet' } }
    return null
  }
  const skincareAM = () => {
    const support = skinDue.shaveDue ? (skinDue.shaveOverdue ? `You're past due to shave — do it, then SPF before you leave.` : `Shave today, then SPF before you leave.`)
      : `A few quiet minutes. SPF is the one that protects your progress.`
    return { eyebrow, headline: `Start your morning routine.`, support, action: { target: 'skin' } }
  }
  const skincarePM = () => {
    const an = activeName(skinDue.tonightActive)
    const headline = hour >= 22 ? `It's ${t} — do your evening routine before bed.` : `Your evening skincare routine.`
    return { eyebrow, headline, support: an ? `${an}. After this, the priority is sleep.` : `Keep it gentle and let your skin repair. After this, sleep.`, action: { target: 'skin' } }
  }

  if (phase === 'latenight')
    return { eyebrow, headline: `It's ${t}. Go to bed.`, support: `Nothing good for your goals happens past midnight. Sleep is when fat burns and muscle repairs.`, action: null }

  if (phase === 'morning') {
    if (water < 1) return { eyebrow, headline: `Drink a glass of water. Now.`, support: `Hydrate before anything else — the easiest win of the day.`, action: { target: 'water' } }
    if (!r.skincareAM && skinDue.amPending) return skincareAM()
    if (session0 && session0.dayType !== 'rest' && !trainedToday)
      return { eyebrow, headline: `Today's a ${session0.label.toLowerCase()} day.`, support: `${session0.emphasisReason || `${session0.reason}`} Save it for this evening — get your steps and protein in first.`, action: { target: 'movement' } }
    const pn = proteinNudge(); if (pn) return pn
    const sleepTargetMin = (profile.sleepTargetHours || 7) * 60
    if (lastSleep && lastSleep.confident && lastSleep.minutes < sleepTargetMin)
      return { eyebrow, headline: `Good start. Keep moving.`, support: `Short night (${fmtDuration(lastSleep.minutes)}) — aim earlier tonight. Steps and water are going; keep at it.`, action: { target: 'movement' } }
    return { eyebrow, headline: `Good start. Keep moving.`, support: `Steps ticking, water going. The day is yours to win.`, action: null }
  }

  if (phase === 'midday') {
    const pn = proteinNudge(); if (pn) return pn
    if (water < expectedWater(hour, wTarget)) return { eyebrow, headline: `You're at ${water} of ${wTarget} glasses. Drink up.`, support: `Behind on water for midday. Get a glass in before you forget.`, action: { target: 'water' } }
    if (tcall && (tcall.focus === 'train' || tcall.focus === 'both')) return move(tcall)
    if (steps < target * 0.4) return { eyebrow, headline: `Only ${steps.toLocaleString()} steps so far. Get on your feet.`, support: `Ten minutes of walking now beats cramming it after dark.`, action: { target: 'movement' } }
    return { eyebrow, headline: `Strong midday. Hold the line.`, support: `On track. Stay sharp through the afternoon.`, action: null }
  }

  // evening + night (17–24): movement decision comes from the engine.
  if (tcall && (tcall.focus === 'train' || tcall.focus === 'both')) return move(tcall)
  const pn = proteinNudge(); if (pn) return pn
  if (tcall && tcall.focus === 'walk') return move(tcall)
  if (over) return { eyebrow, headline: `You're over your calorie ceiling.`, support: `Stop eating for tonight — no treats, no "just one more". The deficit is the whole game.`, action: { target: 'diet' } }
  if (water < wTarget && hour < 22) return { eyebrow, headline: `Finish your water — ${water} of ${wTarget}.`, support: `Don't go to bed short on hydration. Knock out the rest now.`, action: { target: 'water' } }
  if (!r.skincarePM && skinDue.pmPending) return skincarePM()
  if (hour >= 21) return { eyebrow, headline: `That's a full day. Be in bed soon.`, support: `Recovery is non-negotiable. Weigh in first thing tomorrow — we track the trend, not the noise.`, action: null }
  return { eyebrow, headline: `You've handled today.`, support: `Training, food, water, skin — all tended. This is what consistency looks like.`, action: null }
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
// A small circular progress ring (0–1) — used for the Diet tile's protein fill,
// which never flips to a binary "done", just fills as the day goes.
function ProgressRing({ value }) {
  const r = 7, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(1, value || 0))
  return (
    <span className="mb-1.5 flex justify-center">
      <svg width="16" height="16" viewBox="0 0 18 18" className="-rotate-90">
        <circle cx="9" cy="9" r={r} fill="none" stroke="#e0d9c9" strokeWidth="2.5" />
        <circle cx="9" cy="9" r={r} fill="none" stroke="#3d4a32" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
    </span>
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
// Dedicated bodyweight focal card near the top of the dashboard: latest weight,
// trend vs last entry, one-tap log/update, and the trend chart once there's data.
function WeightCard({ weightLog, today, day, onSave, cal }) {
  const [editing, setEditing] = useState(false)
  const tdeeLabel = { low: 'estimated', medium: 'calibrating', high: 'calibrated' }
  const tdeeCls = { low: 'bg-[#f3efe6] text-[#8a8474]', medium: 'bg-[#f6eed8] text-[#866a1c]', high: 'bg-[#eef0e6] text-[#3d4a32]' }
  const sorted = [...(weightLog || [])].sort((a, b) => a.date.localeCompare(b.date))
  const latest = sorted.at(-1)
  const prev = sorted.length >= 2 ? sorted.at(-2) : null
  const loggedToday = latest?.date === today
  const delta = latest && prev ? Math.round((latest.kg - prev.kg) * 10) / 10 : null
  return (
    <section className="mt-4 rounded-2xl border border-[#e6dfd0] bg-[#fbf9f3] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#a39c8d]">Bodyweight</p>
          <p className="font-display leading-tight text-[#23211c]">
            {latest
              ? <span className="text-[24px] font-semibold">{latest.kg}<span className="text-[14px] font-normal text-[#8a8474]"> kg</span></span>
              : <span className="text-[16px] text-[#8a8474]">Not logged yet</span>}
            {delta != null && (
              <span className={`ml-2 text-[12px] font-medium ${delta < 0 ? 'text-[#5b6745]' : delta > 0 ? 'text-[#b0552a]' : 'text-[#8a8474]'}`}>
                {delta > 0 ? '+' : ''}{delta} kg
              </span>
            )}
          </p>
        </div>
        {!editing && (
          <button onClick={() => setEditing(true)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition active:scale-[0.97] ${
              loggedToday ? 'border border-[#d8d1c2] text-[#4a463c] hover:bg-[#f3efe6]' : 'bg-[#3d4a32] text-[#f4f1e8] pulse-attention'}`}>
            {loggedToday ? 'Update' : 'Log today'}
          </button>
        )}
      </div>
      {editing && (
        <div className="mt-3 flex items-center gap-2">
          <NumInput value={day.weight ?? latest?.kg ?? ''} placeholder="kg" step="0.1"
            onCommit={(v) => { onSave(v); setEditing(false) }} />
          <span className="text-[13px] text-[#8a8474]">kg</span>
          <button onClick={() => setEditing(false)} className="ml-auto text-[13px] text-[#8a8474]">Cancel</button>
        </div>
      )}
      {cal && (
        <div className="mt-2.5 border-t border-[#ede7d9] pt-2.5">
          <p className="flex items-center gap-1.5 text-[12px] text-[#6f6a5d]">
            <span>Maintenance <span className="font-semibold text-[#3a382f]">~{cal.maintenance.toLocaleString()}</span> cal/day</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tdeeCls[cal.confidence]}`}>{tdeeLabel[cal.confidence]}</span>
          </p>
          <p className="mt-1 text-[12px] text-[#6f6a5d]">
            Target <span className="font-semibold text-[#3d4a32]">{cal.target.toLocaleString()}</span> · deficit {cal.deficit}/day · ~{cal.weeklyLoss} kg/week
          </p>
        </div>
      )}
      {sorted.length >= 2 && <div className="mt-2"><WeightChart log={sorted} /></div>}
    </section>
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

// ---- consistent pillar scoring: rolling 7-day adherence (incl. today) --------
// Each pillar is a per-day quality in [0,1], averaged over the last 7 days that
// actually have data — so partial app history doesn't tank the score, and all
// pillars share the same window. null until there's a logged day.
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
// Diet pillar: daily protein/calorie score averaged over food-logged days (7d).
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

function GoalsSection({ state, profile, today, onBodyFat, onProfile, onSleep }) {
  const [estimating, setEstimating] = useState(false)
  const [editingSleep, setEditingSleep] = useState(false)
  const days = state.days || {}
  const log = state.bodyFatLog || []
  const latest = log[log.length - 1]
  const target = profile.bodyFatTarget || 12
  const deadline = profile.bodyFatDeadline || '2026-12-31'
  const daysLeft = Math.max(0, Math.ceil((Date.parse(deadline) - Date.parse(today)) / 86400000))

  // All five pillars on the same rolling-7-day footing.
  const skinScore = pillar(days, today, skinQ)
  const hairScore = pillar(days, today, hairQ)
  const moveSc = pillar(days, today, (d) => moveQ(d, profile))
  const dietSc = dietPillar(state, today, profile.proteinTarget || PROTEIN_TARGET_DEFAULT)
  const slpScore = sleepScore(state, today, profile) // null until there's data
  const lastSleep = lastNightSleep(state, today)

  // The five pillars shown as rings. Each carries a directive weakest-link nudge.
  const rings = [
    { key: 'sleep', label: 'Sleep', score: slpScore, msg: `Sleep is your weak spot — aim for ${profile.sleepTargetHours || 7}h, lights out by ${clockGoal(profile.bedGoal || '23:30')}.` },
    { key: 'skin', label: 'Skin', score: skinScore, msg: 'Skin is slipping — run the full AM and PM routine, every day.' },
    { key: 'hair', label: 'Hair', score: hairScore, msg: 'Hair is falling behind — stay on your care schedule.' },
    { key: 'diet', label: 'Diet', score: dietSc, msg: 'Diet is dragging — hit your protein and stay under your calorie ceiling.' },
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

  const latestWeight = [...(state.weightLog || [])].sort((a, b) => a.date.localeCompare(b.date)).at(-1)
  let bfStatus = null
  if (latest) {
    const toGo = +(latest.pct - target).toFixed(1)
    if (toGo <= 0) {
      bfStatus = `Now ${latest.pct}% (${fmtMD(latest.date)}) — target reached. Hold it.`
    } else if (latestWeight) {
      // Translate the body-fat gap into kg to lose: hold lean mass, shed fat until
      // body fat hits the target. targetWeight = leanMass / (1 - target%).
      const lbm = latestWeight.kg * (1 - latest.pct / 100)
      const targetWeight = lbm / (1 - target / 100)
      const lose = Math.max(0, Math.round((latestWeight.kg - targetWeight) * 10) / 10)
      const perWeek = daysLeft > 0 ? Math.round((lose / (daysLeft / 7)) * 100) / 100 : null
      bfStatus = `Now ${latest.pct}% at ${latestWeight.kg}kg — about ${lose}kg to lose to reach ${target}% by ${fmtMD(deadline)}, ${daysLeft} days left${perWeek ? ` (~${perWeek}kg/week)` : ''}.`
    } else {
      bfStatus = `Now ${latest.pct}% (${fmtMD(latest.date)}) — ${toGo} to go. Log your weight to see the kilos and your runway to ${fmtMD(deadline)}.`
    }
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
  const r = d.routines || {}, w = d.workout || {}
  const skin = r.skincareAM && r.skincarePM
  const water = (d.water || 0) >= (profile.waterTarget || 8)
  const trained = (w.did && w.type !== 'Rest') || w.session?.status === 'done'
  const move = trained || (d.steps || 0) >= (profile.stepTarget || 10000)
  const diet = (d.food?.length || 0) > 0 // logged your food today (new model)
  return skin && water && move && diet
}
function currentStreak(days, today, profile) {
  let n = 0
  for (let i = strongDay(days[today], profile) ? 0 : 1; ; i++) {
    if (strongDay(days[shiftIso(today, -i)], profile)) n++; else break
  }
  return n
}
function dayGaps(d, profile) {
  const r = (d && d.routines) || {}, w = (d && d.workout) || {}
  const gaps = []
  if (!(r.skincareAM && r.skincarePM)) gaps.push('skincare')
  if (!((d?.water || 0) >= (profile.waterTarget || 8))) gaps.push('water')
  const trained = (w.did && w.type !== 'Rest') || w.session?.status === 'done'
  if (!(trained || (d?.steps || 0) >= (profile.stepTarget || 10000))) gaps.push('movement')
  if (!((d?.food?.length || 0) > 0)) gaps.push('log your food')
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

// Header button → opens the backup sheet. Warns (amber) when a backup is overdue.
function BackupButton({ pending, lastBackup, onOpen }) {
  const warn = pending || !lastBackup || Date.now() - lastBackup > 7 * 86400000
  return (
    <button onClick={onOpen}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider transition active:scale-95 ${warn ? 'border-[#e7c4a6] bg-[#f7ecd6] text-[#a85b1e]' : 'border-[#cfd6bd] bg-[#eef0e6] text-[#3d4a32]'}`}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
      <span>Backup</span>
    </button>
  )
}

// Backup sheet: export the whole state to Files, or import a backup to restore.
function BackupSheet({ lastBackup, pending, onExport, onImport, onClose }) {
  const fileRef = useRef(null)
  const ago = (t) => {
    if (!t) return 'never'
    const s = Math.round((Date.now() - t) / 1000)
    if (s < 60) return 'just now'
    if (s < 3600) return `${Math.floor(s / 60)}m ago`
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`
    return `${Math.floor(s / 86400)}d ago`
  }
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 px-4 pb-4 fade-in" onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl bg-[#fbf9f3] p-5 shadow-[0_24px_60px_-20px_rgba(35,41,31,0.6)]" onClick={(e) => e.stopPropagation()}>
        <p className="font-display text-[19px] font-semibold text-[#23211c]">Back up your data</p>
        <p className="mt-1 text-[13px] leading-snug text-[#6f6a5d]">Everything lives on this device. Export a copy to <span className="font-medium">Files (iCloud Drive)</span> so a lost or wiped phone never costs you your progress.</p>
        <p className="mt-2 text-[12px] text-[#8a8474]">Last backup: <span className={!lastBackup || pending ? 'font-medium text-[#a85b1e]' : ''}>{ago(lastBackup)}</span>{pending && lastBackup ? ' · changes since' : ''}</p>

        <button onClick={onExport} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-[#3d4a32] px-6 py-3 text-[15px] font-semibold text-[#f4f1e8] active:scale-[0.99]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
          Export — Save to Files
        </button>
        <button onClick={() => fileRef.current?.click()} className="mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-[#d8d1c2] bg-[#f3efe6] px-6 py-3 text-[15px] font-semibold text-[#4a463c] active:scale-[0.99]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21V9" /><path d="m7 14 5-5 5 5" /><path d="M5 3h14" /></svg>
          Import — Restore from a file
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
          onChange={async (e) => { const f = e.target.files?.[0]; if (f) onImport(await f.text()); e.target.value = '' }} />
        <button onClick={onClose} className="mt-2 w-full py-2 text-[13px] text-[#8a8474]">Close</button>
      </div>
    </div>,
    document.body
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
