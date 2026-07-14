import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import SkincareFlow from './SkincareFlow'
import TrainFlow from './TrainFlow'
import RecipeFlow from './RecipeFlow'
import { todaysPlate } from './recipes'
import { stockLevel, cycleStock, shoppingList, lowCount, restockDue, STOCK_LABEL, PERISH_TIERS, PERISH_META, GROCERY_CATALOG } from './groceries'
import { buildSession, estimateSessionMinutes, decideEveningPriority, recentSessions, bestLifts, liftProgress, plateLabel, DB_EXERCISES, swapOptions } from './train'
import { trainingPhase } from './periodize'
import { DEFAULT_SUPPS, LOOSE_SKIN_NOTE, SUPPLEMENTS, suppsDue } from './supps'
import { weeklyCheckin, deficitCoach } from './adapt'
import { buildReview } from './review'
import { strengthGoalsFor } from './strengthGoals'
import { allPhotos, putPhoto, deletePhoto, compressImage, POSES } from './photos'
import { buildWeightTimeline } from './timeline'
import { SKIP_REASONS, skipRecord, movementAccount, stepsHit } from './makeup'
import { activeVacation, upcomingVacation, returnWindow, vacationBudget, reassurance } from './vacation'
import { lookupBarcode, parsePortion } from './barcode'
import { hairDue } from './hair'
import HairFlow from './HairFlow'
import BodyFatFlow from './BodyFatFlow'
import JourneyView from './JourneyView'
import YogaFlow from './YogaFlow'
import { yogaScore, yogaDue, yogaSessionsInWindow, yogaDone } from './yoga'
import CardioFlow from './CardioFlow'
import { cardioScore, cardioMinutesInWindow, cardioDue, restingHrTrend, cardioTypeName } from './cardio'
import { journeysFor } from './journeys'
import { LOCATIONS, defaultLocation, pantryFor, effectivePantry, calorieTarget, calorieBreakdown, calorieZone, dayTotals, entryFromItem, mealForTime, MEAL_ORDER, MEAL_LABEL, groupOf, GROUP_ORDER, dayCritique, isUnhealthy, applyMods, buildFromComponents, componentsFromItem, isSeedFood, FOOD_UNITS, FOOD_LOCS, FIBER_TARGET, SUGAR_LIMIT, dietScore as foodScore, PROTEIN_TARGET_DEFAULT } from './diet'
import RecipeBuilder from './RecipeBuilder'
import { PRODUCTS, DEFAULT_OWNED, dueSummary, PRODUCT_BY_ID } from './skincare'
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
  p.trainStart ??= isoToday() // anchors the periodization macrocycle (Monday-aligned in the engine)
  p.supps ??= { enabled: [...DEFAULT_SUPPS] } // daily supplement stack, folded into AM/PM routines
  p.skincare ??= {}
  p.skincare.ownedProducts ??= [...DEFAULT_OWNED]
  p.skincare.startedDate ??= isoToday()
  delete p.calorieCeiling // manual ceiling pin retired — the ceiling is coach-driven (TDEE − deficit)
  return p
}
const loadLocal = () => { try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : null } catch { return null } }

// This state is the ONLY copy of the user's data — a failed write must never be
// silent, or a logged meal/weight can vanish on the next reload. If a write
// throws (storage pressure / quota), shed the throwaway activity log — just
// foreground pings — and retry so the real data (days, food, weights) still
// lands. If it STILL fails, shout via onSaveFailed so the UI can warn and push
// an export before anything is lost. Returns true only when the write persisted.
let onSaveFailed = null
const writeLS = (obj) => { localStorage.setItem(LS_KEY, JSON.stringify(obj)); return true }
const saveLocal = (s) => {
  try { return writeLS(s) }
  catch {
    try {
      // Retry without activity (non-critical, re-derived from live pings).
      const ok = writeLS({ ...s, activity: [] })
      if (ok && Array.isArray(s.activity)) s.activity.length = 0
      return ok
    } catch {
      try { onSaveFailed?.() } catch { /* noop */ }
      return false
    }
  }
}

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
  const [yogaOpen, setYogaOpen] = useState(false) // guided yoga/mobility takeover
  const [cardioOpen, setCardioOpen] = useState(false) // guided Zone-2 cardio takeover
  const [pendingSwap, setPendingSwap] = useState(null) // day-type to open the trainer pre-swapped to
  const [manageProducts, setManageProducts] = useState(false)
  const [manageSupps, setManageSupps] = useState(false)
  const [liftsOpen, setLiftsOpen] = useState(false) // PRs / best-lifts view (declared before overlayOpen uses it)
  const [diaryOpen, setDiaryOpen] = useState(false) // success-heatmap diary (declared before overlayOpen uses it)
  const [recipesOpen, setRecipesOpen] = useState(false) // guided recipe flow (declared before overlayOpen uses it)
  const [groceriesOpen, setGroceriesOpen] = useState(false) // pantry stock + shopping list (declared before overlayOpen uses it)
  const [journeyView, setJourneyView] = useState(null) // 'skin'|'lean'|'sleep' — full journey detail page
  const [shareOpen, setShareOpen] = useState(false) // Instagram-ready daily summary card
  const [photosOpen, setPhotosOpen] = useState(false) // progress photos + collage (IndexedDB-backed)
  const [bfOpen, setBfOpen] = useState(false) // body-fat estimator (lifted so the journey page can open it too)
  const [sleepOpen, setSleepOpen] = useState(false) // sleep correction (lifted for the journey page)
  const [booting, setBooting] = useState(true) // opening splash
  const [bootLeaving, setBootLeaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false) // a localStorage write hard-failed → warn, don't lose data silently

  // Wire saveLocal's hard-failure signal to a visible warning. A failed write
  // means the change is only in memory — the user must export before a reload.
  useEffect(() => { onSaveFailed = () => setSaveFailed(true); return () => { onSaveFailed = null } }, [])

  // Opening splash: hold the wordmark briefly, fade out, then reveal the app.
  useEffect(() => {
    const fade = setTimeout(() => setBootLeaving(true), 1150)
    const done = setTimeout(() => setBooting(false), 1650)
    return () => { clearTimeout(fade); clearTimeout(done) }
  }, [])

  // Lock page scroll while a full-screen overlay is open, so a swipe can't drag
  // the dashboard out from behind the card.
  // NOTE: only components that DON'T lock body-scroll themselves belong here.
  // Self-locking takeovers (BodyFatFlow, CardioFlow, YogaFlow) manage their own
  // lock and must stay out, or the two effects fight and freeze the dashboard.
  const overlayOpen = !!flow || !!hairFlow || training || manageProducts || manageSupps || liftsOpen || diaryOpen || !!recipesOpen || groceriesOpen || !!journeyView || sleepOpen || booting
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
  const [foodReview, setFoodReview] = useState(false) // dashboard shortcut → today's food
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
        // Files only — passing title/text makes iOS save a stray .txt alongside the JSON.
        await navigator.share({ files: [file] })
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
      // One-time migration: diary entries are frozen snapshots, so foods logged
      // before `sugar` existed read 0. Backfill from the pantry by id (scaled by
      // the entry's qty). Idempotent — only fills entries missing the field.
      const _byId = Object.fromEntries(effectivePantry(local).map((p) => [p.id, p]))
      for (const d of Object.values(local.days || {})) {
        for (const e of d.food || []) {
          const p = _byId[e.id], q = e.qty || 1
          if (e.sugar == null) e.sugar = p && p.sugar ? Math.round(p.sugar * q * 10) / 10 : 0
          if (e.fiber == null) e.fiber = p && p.fiber ? Math.round(p.fiber * q * 10) / 10 : 0
        }
      }
      // One-time migration: dumbbell-lift weights were logged as the summed pair;
      // halve them to the per-dumbbell convention. Guarded so it runs exactly once.
      if (!local.profile.dbHalveV1) {
        for (const d of Object.values(local.days || {})) {
          for (const ex of d.workout?.session?.exercises || []) {
            if (!DB_EXERCISES.has(ex.id)) continue
            for (const s of ex.sets || []) if (s.weight > 0) s.weight = Math.round((s.weight / 2) * 2) / 2
          }
        }
        local.profile.dbHalveV1 = true
      }
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
  // Skip today's lift or steps with a reason. Owed-ness (whether a make-up is
  // due) is derived from the reason inside skipRecord. Keep the movement card
  // pinned so the acknowledgment/make-up plan shows right where they tapped.
  function skipMove(kind, reasonId) {
    const rec = skipRecord(reasonId, Date.now())
    patch(kind === 'gym' ? { workout: { skip: rec } } : { stepsSkip: rec })
    setOverride('movement')
  }
  function undoSkipMove(kind) {
    patch(kind === 'gym' ? { workout: { skip: null } } : { stepsSkip: null })
    setOverride('movement')
  }
  // Steps are binary: one tap confirms you hit your 10k (count not tracked).
  // Marking done clears any steps-skip for the day.
  function setStepsDone(done) {
    patch({ stepsDone: done, ...(done ? { stepsSkip: null } : {}) })
    setOverride('movement')
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
  // Supplements ride on the AM/PM routine but log to their own bucket so they
  // never skew the skincare score.
  function completeSupps(slot, log) {
    patch({ supps: { [slot]: log } })
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
      // Owed-day bookkeeping: a swap sets owedDay; completing that day clears it.
      if (session.status === 'done' && next.profile?.owedDay === session.dayType) next.profile.owedDay = null
      next.days[today]._ts = Date.now()
      saveLocal(next)
      return next
    })
    setPending(true)
    scheduleSync()
  }
  // Record that today's scheduled day was swapped out → it's owed next session.
  function oweDay(dayType) { if (dayType) updateProfile({ owedDay: dayType }) }

  // Guided yoga session finished — write the whole session onto today's yoga.
  function saveYoga(payload) {
    setState((prev) => {
      const next = clone(prev)
      next.days[today] = next.days[today] || defaultDay()
      next.days[today].yoga = payload
      next.days[today]._ts = Date.now()
      saveLocal(next)
      return next
    })
    setYogaOpen(false)
    setPending(true)
    scheduleSync()
  }

  // Guided Zone-2 cardio finished — write the session onto today's cardio.
  function saveCardio(payload) {
    setState((prev) => {
      const next = clone(prev)
      next.days[today] = next.days[today] || defaultDay()
      next.days[today].cardio = payload
      next.days[today]._ts = Date.now()
      saveLocal(next)
      return next
    })
    setCardioOpen(false)
    setPending(true)
    scheduleSync()
  }
  // Morning resting heart rate — the headline heart biomarker, trended over time.
  function saveRestingHr(bpm) { if (bpm > 0) patch({ restingHr: bpm }) }

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
  // --- pantry stock: per-item level lives under profile.stock so it survives the
  // server merge (only profile/days/logs/pantry are preserved). ---
  function setStock(id, level) {
    setState((prev) => {
      const next = clone(prev)
      next.profile = { ...(next.profile || {}), stock: { ...(next.profile?.stock || {}), [id]: level } }
      saveLocal(next); return next
    })
    setPending(true); scheduleSync()
  }
  // Log a grocery haul: everything Low/Out flips to Stocked, and the haul date
  // resets the restock timer.
  function logHaul() {
    setState((prev) => {
      const next = clone(prev)
      const stock = { ...(next.profile?.stock || {}) }
      for (const k of Object.keys(stock)) if (stock[k] === 'low' || stock[k] === 'out') stock[k] = 'stocked'
      next.profile = { ...(next.profile || {}), stock, lastHaulDate: today }
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
  function addFood({ name, portion, kcal, protein, carbs, fat, fiber, sugar, group, loc }) {
    const useLoc = loc || day.foodLoc || defaultLocation(today)
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + Date.now().toString(36)
    const item = { id, name, portion: portion || '1 serving', loc: useLoc, group: group || undefined,
      kcal: kcal || 0, protein: protein || 0, carbs: carbs || 0, fat: fat || 0, fiber: fiber || 0, sugar: sugar || 0,
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
      kcal: b.kcal, protein: b.protein, carbs: b.carbs, fat: b.fat, fiber: b.fiber, sugar: b.sugar,
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

  // Keystone habit on a trip: one tap logs the nightly minoxidil so the streak
  // and the hair goal don't quietly lapse while you're away.
  function markKeystone() { patch({ routines: { haircarePM: true, haircareAM: true } }) }

  const day = useMemo(() => (state ? { ...defaultDay(), ...(state.days?.[today] || {}) } : null), [state, today])
  if (!state || !day) return <Centered>…</Centered>

  const { profile } = state

  // Vacation mode: when today falls inside a trip range, the whole dashboard
  // flips to the away screen. Protect progress, enjoy deliberately, come back clean.
  const activeVac = activeVacation(state, today)
  if (activeVac) {
    return (
      <VacationView state={state} today={today} profile={profile} day={day} vac={activeVac}
        onLogFood={logFood} onRemoveFood={removeFood} onAddFood={addFood} onSaveCustom={saveCustomFood}
        onSetLoc={setFoodLoc} onResetFood={resetFood} onMoveFood={moveFood} onToggleDietDone={() => patch({ dietClosed: !day.dietClosed })}
        onWater={(d) => patch({ water: Math.max(0, (day.water || 0) + d) })}
        onKeystone={markKeystone} />
    )
  }
  const preTrip = upcomingVacation(state, today) // night-before nudge
  const ret = returnWindow(state, today)         // just-back re-entry window (hides weigh-ins)

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

  if (view === 'review') {
    return (
      <div className="mx-auto max-w-xl px-5 pb-16 pt-7 fade-in">
        <button onClick={() => setView('home')} className="mb-5 inline-flex items-center gap-1 text-sm font-medium text-[#6f6a5d]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          Back
        </button>
        <ReviewView state={state} today={today} onApply={updateProfile} />
      </div>
    )
  }

  const r = day.routines, w = day.workout, meals = day.meals || {}
  // Today's training call, for the Train tile + movement focus card.
  const trainSession = buildSession(state, today)
  const sessionDone = w.session?.status === 'done'
  // Once today's session is done, label must reflect what was ACTUALLY trained
  // (e.g. a swap legs→push), not buildSession's next-up plan — buildSession
  // excludes today, so it keeps planning the upcoming day even after you finish.
  const doneLabel = sessionDone ? (w.session?.label || w.type || trainSession.label) : null
  const trainCall = {
    active: w.session?.status === 'active',
    done: sessionDone,
    rest: !sessionDone && trainSession.dayType === 'rest',
    label: doneLabel || trainSession.label || 'Rest',
    dayType: sessionDone ? (w.session?.dayType || trainSession.dayType) : trainSession.dayType,
    estMin: trainSession.dayType !== 'rest' ? estimateSessionMinutes(trainSession) : null,
    swaps: (trainSession.dayType !== 'rest' && w.session?.status !== 'active' && !sessionDone)
      ? swapOptions(state, today, trainSession.dayType) : [],
  }
  const skinDue = dueSummary(today, state)
  const lastSleep = lastNightSleep(state, today)
  const coach = buildCoach({ hour, minute, day, profile, skinDue, lastSleep, state, today })
  // The detail card shows only when you TAP an area — the coach's own suggestion
  // rides on the hero's CTA button instead, so the big card no longer auto-opens
  // and duplicates the coach + the Today row.
  const focus = override || null
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
  const stepsIn = stepsHit(day, stepTarget) // binary: hit today's 10k or not
  const stepFrac = stepsIn ? 1 : 0
  const moveDone = trainCall.rest ? stepsIn : trainedToday
  const moveProgress = trainCall.rest ? stepFrac : 0.3 * stepFrac
  const waterTarget = profile.waterTarget || 8

  const proteinNow = Math.round(dayTotals(day).protein)
  const proteinTgt = profile.proteinTarget || PROTEIN_TARGET_DEFAULT
  const slotWord = (s) => (s === 'pm' ? 'Evening' : 'Morning')
  const areas = [
    { id: 'skin', label: 'Skin', done: skinSlotDone, attn: skinAttn, locked: skinLocked && !skinSlotDone, hint: skinHint,
      sub: skinLocked ? skinHint : skinSlotDone ? 'Logged for today' : `${slotWord(skinSlot)} routine${skinDue.tonightActive && skinSlot === 'pm' ? ` · ${PRODUCT_BY_ID[skinDue.tonightActive]?.name || 'active'} tonight` : ''}` },
    { id: 'movement', label: 'Train', done: moveDone, progress: moveProgress, attn: w.session?.status === 'active' ? 'urgent' : 'idle',
      sub: w.session?.status === 'active' ? 'Session in progress' : moveDone ? (trainCall.rest ? 'Steps done — recovery day' : `${trainCall.label} logged`) : trainCall.rest ? 'Rest day — walk your 10k' : `${trainCall.label}${trainCall.estMin ? ` · ~${trainCall.estMin} min` : ''}` },
    { id: 'diet', label: 'Diet', done: !!day.dietClosed, progress: Math.min(1, proteinNow / proteinTgt),
      sub: day.dietClosed ? 'Closed for today' : `${proteinNow} of ${proteinTgt}g protein so far` },
    { id: 'water', label: 'Water', done: (day.water || 0) >= waterTarget, progress: Math.min(1, (day.water || 0) / waterTarget),
      sub: `${day.water || 0} of ${waterTarget} glasses` },
    { id: 'hair', label: 'Hair', done: hairSlotDone, attn: hairAttn, locked: skinLocked && !hairSlotDone, hint: skinHint,
      sub: skinLocked ? skinHint : hairSlotDone ? 'Logged for today' : `${slotWord(hairSlot)} haircare` },
  ]

  // Fold the two "healthy inside" pillars into the thread — but only surface them
  // when they're actually relevant today (rest day or falling behind), so the
  // list stays a short list of what's next, not a wall of cards.
  const yogaDidToday = yogaDone(day)
  const yogaWeek = yogaSessionsInWindow(state.days || {}, today, 7)
  const yogaTarget = profile.yogaTargetPerWeek || 2
  // Only on rest days (when they're the point) or once done today — otherwise a
  // training day's thread stays short and about the lift, not padded with cards.
  if (yogaDidToday || trainCall.rest) {
    areas.push({ id: 'yoga', label: 'Mobility', done: yogaDidToday, attn: trainCall.rest && !yogaDidToday ? 'attention' : 'idle',
      sub: yogaDidToday ? 'Session done — recovery banked' : trainCall.rest ? 'Rest day — the best day for a full flow' : `${yogaWeek} of ${yogaTarget} sessions this week` })
  }
  const cardioWeek = cardioMinutesInWindow(state.days || {}, today, 7)
  const cardioTarget = profile.cardioTargetPerWeek || 150
  const cardioHit = cardioWeek >= cardioTarget
  if (cardioHit || trainCall.rest) {
    areas.push({ id: 'cardio', label: 'Cardio', done: cardioHit, attn: trainCall.rest && !cardioHit ? 'attention' : 'idle',
      sub: cardioHit ? `${cardioWeek} min Zone 2 — target hit` : `${cardioWeek} of ${cardioTarget} min Zone 2 this week` })
  }

  const setWater = (delta) => patch({ water: Math.max(0, (day.water || 0) + delta) })

  // The coach hero's action button — same routing as tapping that Today row, so
  // the hero is self-sufficient (states the move AND does it) without the big
  // auto-opening detail card underneath.
  const doArea = (t) => {
    if (t === 'skin') setFlow(skinSlot)
    else if (t === 'hair') setHairFlow(hairSlot)
    else if (t === 'movement' && !trainCall.rest && !trainedToday) setTraining(true)
    else setOverride(t)
  }
  const heroCTA = coach.action?.target ? ({
    skin: `Start ${slotWord(skinSlot).toLowerCase()} skincare`,
    hair: 'Do your haircare',
    movement: trainCall.rest ? 'Mark your steps' : trainedToday ? 'Review your session' : `Start ${trainCall.label} session`,
    diet: 'Log your food',
    water: 'Log water',
  }[coach.action.target]) : null

  return (
    <>
    {booting && <Splash leaving={bootLeaving} />}
    <div className="mx-auto max-w-xl px-5 pb-16 pt-7 fade-in">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="font-display text-lg font-semibold tracking-tight text-[#20201d]">localfit</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setShareOpen(true)} aria-label="Share today" className="grid h-7 w-7 place-items-center rounded-full text-[#7d8a5f] active:opacity-70">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="M16 6l-4-4-4 4M12 2v13" /></svg>
          </button>
          <button onClick={() => setDiaryOpen(true)} aria-label="Diary" className="grid h-7 w-7 place-items-center rounded-full text-[#7d8a5f] active:opacity-70">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
          </button>
          <BackupButton pending={pending} lastBackup={lastBackup} onOpen={() => setBackupOpen(true)} />
          <span className="text-[11px] uppercase tracking-[0.18em] text-[#a39c8d]">{prettyToday(today)}</span>
        </div>
      </div>
      {saveFailed && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-[#e0b4b4] bg-[#f7dede] px-3 py-2.5 text-[12px] text-[#8a2e2e]">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
          <span className="min-w-0">
            Couldn't save your last change — this device's storage is full, so it's only in memory and will be lost if the app reloads.
            <button onClick={() => setBackupOpen(true)} className="ml-1 font-semibold underline">Export a backup now</button>, then free up space.
          </span>
        </div>
      )}
      {!saveFailed && (!lastBackup || Date.now() - lastBackup > 7 * 86400000) && (
        <button onClick={() => setBackupOpen(true)} className="mb-4 flex w-full items-center gap-2 rounded-xl border border-[#e7d4b6] bg-[#f7ecd6] px-3 py-2 text-left text-[12px] text-[#8a5a1e]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" />
          </svg>
          <span>{lastBackup ? "It's been a while — back up your data to Files so you don't lose it." : 'Your data lives only on this device. Tap to export a backup to Files.'}</span>
        </button>
      )}
      {preTrip && <PreTripBanner vac={preTrip} />}

      {/* The coach speaks — directive, one thing at a time, with a button to do it */}
      <section className="rounded-[28px] bg-[#23291f] px-6 py-7 shadow-[0_18px_40px_-24px_rgba(35,41,31,0.7)]">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#9aa581]">{coach.eyebrow}</p>
        <h1 className="font-display mt-3 text-[26px] font-semibold leading-[1.16] text-[#f4f1e8]">{coach.headline}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[#cfccba]">{coach.support}</p>
        {heroCTA && (
          <button onClick={() => doArea(coach.action.target)}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#3d4a32] px-5 py-2.5 text-[14px] font-semibold text-[#f4f1e8] active:scale-[0.98]">
            {heroCTA}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        )}
      </section>

      <button onClick={() => setView('review')}
        className="mt-3 flex w-full items-center justify-between gap-3 rounded-2xl border border-[#cdd4bb] bg-[#eef0e6] px-5 py-4 text-left transition active:scale-[0.99] hover:bg-[#e8ecdd]">
        <span className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#3d4a32]">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#f4f1e8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></svg>
          </span>
          <span className="min-w-0">
            <span className="block font-display text-[16px] font-semibold text-[#23291f]">Coach's review</span>
            <span className="block text-[12px] text-[#6b7355]">Your progress, your pace, what's next.</span>
          </span>
        </span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7d8a5f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="m9 18 6-6-6-6" /></svg>
      </button>

      {ret && <ReturnCard state={state} ret={ret} />}

      {/* Weigh-ins stay hidden through the just-back window so you judge a settled
          number, not a bloated one. */}
      {!ret && <WeightCard weightLog={state.weightLog || []} today={today} day={day} onSave={saveWeight} />}

      {/* Deficit coach + the full weight trajectory now live in Coach's Review
          (Your pace / Trajectory) — kept off the dashboard to reduce density. */}

      {(() => {
        const checkin = weeklyCheckin(state, today)
        return checkin.due && checkin.findings.length > 0 ? (
          <CheckinCard checkin={checkin}
            onApply={(changes) => updateProfile({ ...changes, lastCheckin: today })}
            onDismiss={() => updateProfile({ lastCheckin: today })} />
        ) : null
      })()}

      {/* Today's thread — one tappable line per area, in the order they matter.
          Tapping routes to the right place: skin/hair to their flows, yoga/cardio
          to theirs, everything else focuses the card below. */}
      <div className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#a39c8d]">Today</p>
          <button onClick={() => setFoodReview(true)} className="flex items-center gap-1 text-[12px] font-medium text-[#3d4a32]">
            {dayTotals(day).count > 0 ? `See today's food · ${Math.round(dayTotals(day).protein)}g P, ${dayTotals(day).kcal} cal` : "See today's food"}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {areas.map((a) => (
            <TodayRow key={a.id} a={a} active={focus === a.id}
              onTap={() => (a.id === 'skin' ? setFlow(skinSlot)
                : a.id === 'hair' ? setHairFlow(hairSlot)
                : a.id === 'yoga' ? setYogaOpen(true)
                : a.id === 'cardio' ? setCardioOpen(true)
                : setOverride(a.id))} />
          ))}
        </div>
      </div>

      {/* Quick access to the tools that live off the home — one tap each */}
      <div className="mt-3 grid grid-cols-4 gap-2">
        {[
          { label: 'Lifts', on: () => setLiftsOpen(true), icon: <path d="M6 9V6a2 2 0 0 1 2-2 2 2 0 0 1 2 2v12a2 2 0 0 0 2 2 2 2 0 0 0 2-2V6a2 2 0 0 1 2-2 2 2 0 0 1 2 2v3M3 10v4M21 10v4" /> },
          { label: 'Recipes', on: () => setRecipesOpen(true), icon: <path d="M3 2h13l5 5v15H3zM16 2v5h5M8 13h8M8 17h8M8 9h2" /> },
          { label: 'Groceries', on: () => setGroceriesOpen(true), icon: <><path d="M3 3h2l2.4 12.3a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L22 7H6" /><circle cx="9" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></> },
          { label: 'Diary', on: () => setDiaryOpen(true), icon: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></> },
        ].map((q) => (
          <button key={q.label} onClick={q.on}
            className="flex flex-col items-center gap-1 rounded-2xl border border-[#e6dfd0] bg-[#fbf9f3] px-1 py-2.5 text-[11px] font-medium text-[#4a463c] active:scale-[0.98]">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#3d4a32" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{q.icon}</svg>
            {q.label}{q.label === 'Groceries' && lowCount(state) ? <span className="text-[#a3894a]"> · {lowCount(state)}</span> : ''}
          </button>
        ))}
      </div>

      {/* The detail card only when you tap an area — otherwise the home stays short */}
      {focus && (
        <div key={focus} className="focus-swap mt-5">
          <FocusCard
            focus={focus} day={day} profile={profile} hour={hour} weightLog={state.weightLog || []}
            state={state} dateIso={today}
            onStartSkin={setFlow} onManageProducts={() => setManageProducts(true)}
            onSkinSensitive={(v) => updateProfile({ skincare: { ...profile.skincare, sensitive: v } })}
            onStepsDone={setStepsDone}
            onStartTrain={() => setTraining(true)} train={trainCall}
            onSwapDay={(dt) => { setPendingSwap(dt); setTraining(true) }}
            onSkipMove={skipMove} onUndoSkipMove={undoSkipMove}
            onStartHair={(slot) => setHairFlow(slot)}
            onLogFood={logFood} onRemoveFood={removeFood} onAddFood={addFood} onSaveCustom={saveCustomFood} onSetLoc={setFoodLoc} onResetFood={resetFood} onMoveFood={moveFood} onToggleDietDone={() => patch({ dietClosed: !day.dietClosed })}
            onWater={setWater}
            onWeight={saveWeight} />
        </div>
      )}

      <GoalsSection state={state} profile={profile} today={today} onOpenJourney={setJourneyView} onEstimate={() => setBfOpen(true)} onManageSupps={() => setManageSupps(true)} />

      <RewardsSummary state={state} profile={profile} today={today} onOpen={() => setView('rewards')} />

      <p className="mt-9 text-center text-[12px] text-[#a39c8d]">Consistency over intensity. One step at a time.</p>

      {flow && (
        <SkincareFlow
          slot={flow} dateIso={today} state={state}
          onComplete={completeRoutine} onSupps={completeSupps}
          onClose={() => setFlow(null)}
          onManage={() => { setFlow(null); setManageProducts(true) }} />
      )}
      {training && (
        <TrainFlow
          dateIso={today} state={state} hour={hour} minute={minute}
          onPersist={writeSession} onSwap={oweDay} swapTo={pendingSwap}
          onClose={() => { setTraining(false); setPendingSwap(null) }} />
      )}
      {hairFlow && (
        <HairFlow
          slot={hairFlow} dateIso={today} state={state}
          onComplete={completeHairRoutine}
          onClose={() => setHairFlow(null)} />
      )}
      {yogaOpen && (
        <YogaFlow
          state={state} defaultSession={trainCall.rest ? 'full30' : 'mobility10'}
          onComplete={saveYoga} onClose={() => setYogaOpen(false)} />
      )}
      {cardioOpen && (
        <CardioFlow profile={profile} trend={restingHrTrend(state, today)} onComplete={saveCardio}
          onSetAge={(age) => updateProfile({ age })} onLogHr={saveRestingHr} onClose={() => setCardioOpen(false)} />
      )}
      {backupOpen && (
        <BackupSheet lastBackup={lastBackup} pending={pending} onExport={exportData} onImport={importData} onClose={() => setBackupOpen(false)} />
      )}
      {manageSupps && (
        <SuppsModal profile={profile} onClose={() => setManageSupps(false)}
          onSave={({ enabled, custom }) => { updateProfile({ supps: { enabled, custom } }); setManageSupps(false) }} />
      )}
      {manageProducts && (
        <ProductsModal profile={profile} onClose={() => setManageProducts(false)}
          onSave={(owned) => { updateProfile({ skincare: { ...profile.skincare, ownedProducts: owned } }); setManageProducts(false) }} />
      )}
      {foodReview && (
        <FoodReview state={state} dateIso={today} day={day} proteinTarget={profile.proteinTarget || PROTEIN_TARGET_DEFAULT}
          onRemove={removeFood} onReset={resetFood} onMove={moveFood} onClose={() => setFoodReview(false)} />
      )}
      {liftsOpen && <LiftsView state={state} today={today} onClose={() => setLiftsOpen(false)} />}
      {diaryOpen && <DiaryView state={state} profile={profile} today={today} onClose={() => setDiaryOpen(false)} />}
      {recipesOpen && <RecipeFlow state={state} dateIso={today} initialRecipeId={typeof recipesOpen === 'string' ? recipesOpen : null} onLog={logFood} onClose={() => setRecipesOpen(false)} />}
      {groceriesOpen && <GroceriesView state={state} today={today} onStock={setStock} onHaul={logHaul} onClose={() => setGroceriesOpen(false)} />}

      {journeyView && (
        <JourneyView jkey={journeyView} state={state} today={today} profile={profile}
          onBack={() => setJourneyView(null)}
          tools={journeyTools(journeyView, { skinSlot, low: lowCount(state), latestBf: (state.bodyFatLog || []).length,
            onStartSkin: () => setFlow(skinSlot), onProducts: () => setManageProducts(true), onSupps: () => setManageSupps(true),
            onEstimate: () => setBfOpen(true), onLifts: () => setLiftsOpen(true), onRecipes: () => setRecipesOpen(true),
            onGroceries: () => setGroceriesOpen(true), onSleep: () => setSleepOpen(true), onPhotos: () => setPhotosOpen(true) })} />
      )}
      {bfOpen && (
        <BodyFatFlow profile={profile} onClose={() => setBfOpen(false)}
          onSave={(pct, patch) => { saveBodyFat(pct); updateProfile(patch); setBfOpen(false) }} />
      )}
      {shareOpen && <ShareCard state={state} today={today} profile={profile} onClose={() => setShareOpen(false)} />}
      {photosOpen && <ProgressPhotos state={state} today={today} onClose={() => setPhotosOpen(false)} />}
      {sleepOpen && (
        <SleepModal current={lastSleep} onClose={() => setSleepOpen(false)}
          onSave={(sleep) => { saveSleep(sleep); setSleepOpen(false) }} />
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

// The make-up reminder: what you owe and how you'll pay it back. Only shows
// when there's an outstanding movement debt (from an owed skip or short days).
function MoveMakeupCard({ acc }) {
  if (!acc?.hasDebt) return null
  return (
    <div className="rounded-2xl border border-[#e7d4b6] bg-[#f7ecd6] p-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8a5a1e]">Make-up owed</p>
      <ul className="mt-1.5 space-y-1.5">
        {acc.items.map((it, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-snug text-[#6b5326]">
            <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#c9742e]" />
            <span>{it.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Skip today's lift or walk with a reason. The reason decides whether a make-up
// is owed (handled downstream); here it just records the skip or shows the
// resulting state with an undo.
function MoveSkip({ kind, skip, onSkip, onUndo }) {
  const [picking, setPicking] = useState(false)
  const what = kind === 'gym' ? "today's lift" : "today's walk"
  if (skip) {
    return (
      <div className="rounded-xl border border-[#e6dfd0] bg-[#f3efe6] px-3 py-2 text-[12px] leading-snug text-[#6f6a5d]">
        <span className="font-semibold text-[#4a463c]">{kind === 'gym' ? 'Lift' : 'Walk'} skipped</span> · {skip.label}. {skip.owed
          ? (kind === 'gym' ? 'Make-up queued — your next session runs harder.' : "Added to this week's step balance.")
          : 'No make-up owed — recovery counts.'}
        <button onClick={() => onUndo(kind)} className="ml-1.5 font-medium text-[#7d8a5f] underline underline-offset-2 active:opacity-70">Undo</button>
      </div>
    )
  }
  if (!picking) {
    return (
      <button onClick={() => setPicking(true)} className="text-[12px] font-medium text-[#8a8474] underline underline-offset-2 active:opacity-70">
        Can't do {what}?
      </button>
    )
  }
  return (
    <div className="rounded-xl border border-[#e6dfd0] bg-[#fbf9f3] p-3">
      <p className="text-[12px] text-[#6f6a5d]">Why skip {what}?</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {SKIP_REASONS.map((r) => (
          <button key={r.id} onClick={() => { onSkip(kind, r.id); setPicking(false) }}
            className="rounded-full border border-[#d8d1c2] bg-white px-3 py-1.5 text-[12px] font-medium text-[#4a463c] active:scale-95">
            {r.label}
          </button>
        ))}
      </div>
      <button onClick={() => setPicking(false)} className="mt-2 text-[12px] text-[#8a8474] active:opacity-70">Cancel</button>
    </div>
  )
}

// --- vacation mode ----------------------------------------------------------
// The away screen: warm permission, a banked trip budget that burns down, the
// same search-first logger (NYC picks first), the one keystone habit, hydration,
// and a frozen-streak assurance. Strict targets/scores/weigh-ins are suspended.
function VacationView({ state, today, profile, day, vac, onLogFood, onRemoveFood, onAddFood, onSaveCustom, onSetLoc, onResetFood, onMoveFood, onToggleDietDone, onWater, onKeystone }) {
  const b = vacationBudget(state, today, vac)
  const streak = currentStreak(state.days || {}, today, profile)
  const hairDone = day.routines?.haircarePM || day.routines?.haircareAM
  const water = day.water || 0, wTarget = profile.waterTarget || 8
  const pct = b?.budget ? Math.min(100, Math.round((b.spent / b.budget) * 100)) : 0
  return (
    <div className="mx-auto max-w-xl px-5 pb-16 pt-7 fade-in">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="font-display text-lg font-semibold tracking-tight text-[#20201d]">localfit</span>
        <span className="flex items-center gap-1.5 rounded-full border border-[#cdd4bb] bg-[#eef0e6] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#3d4a32]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5A2.12 2.12 0 0 0 16.5 4.5L13 8 4.8 6.2a1 1 0 0 0-.9 1.7l6.1 4-1.6 3.4-2.4-.5a1 1 0 0 0-.9 1.6l2 2 2 2a1 1 0 0 0 1.6-.9l-.5-2.4 3.4-1.6 4 6.1a1 1 0 0 0 1.7-.9Z" /></svg>
          On vacation
        </span>
      </div>

      <section className="rounded-[28px] bg-[#23291f] px-6 py-7 shadow-[0_18px_40px_-24px_rgba(35,41,31,0.7)]">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#9aa581]">{vac.label} · day {b?.dayIndex} of {b?.tripDays}</p>
        <h1 className="font-display mt-3 text-[26px] font-semibold leading-[1.16] text-[#f4f1e8]">Enjoy it. You earned this.</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[#cfccba]">Protein first, one indulgence per meal, water between drinks. The strict targets are paused and your streak is safe — stay inside your budget and this trip can't cost you a thing.</p>
      </section>

      {b?.budget != null ? (
        <section className="mt-4 rounded-3xl border border-[#cdd4bb] bg-[#eef0e6] p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-[18px] font-semibold text-[#23291f]">Trip budget</h2>
            <span className="text-[12px] text-[#6b7355]">{b.daysLeft} day{b.daysLeft === 1 ? '' : 's'} left</span>
          </div>
          <p className="mt-2 font-display text-[28px] font-semibold text-[#23291f]">{Math.max(0, b.remaining).toLocaleString()}<span className="text-[15px] font-normal text-[#6b7355]"> cal left of {b.budget.toLocaleString()}</span></p>
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-[#dbe0cd]">
            <div className={`h-full rounded-full transition-all ${b.remaining < 0 ? 'bg-[#b0552a]' : 'bg-[#3d4a32]'}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-3 text-[13px] leading-snug text-[#4a5238]">
            {b.remaining >= 0
              ? `You banked ${b.banked.toLocaleString()} cal from this week's deficit. Stay inside this and the week nets even — you don't lose an ounce of progress.`
              : `You're ${(-b.remaining).toLocaleString()} past the buffer — from here it's a small real gain. Ease off, hydrate, and we reset clean when you're home.`}
          </p>
          {b.bigDay && <p className="mt-2 rounded-xl bg-[#f7ecd6] px-3 py-2 text-[12px] leading-snug text-[#8a5a1e]">Big day — you can't productively spend a whole weekend's buffer in one night. Slow down and drink water.</p>}
        </section>
      ) : (
        <section className="mt-4 rounded-2xl border border-[#e6dfd0] bg-[#fbf9f3] p-4 text-[13px] leading-relaxed text-[#6b6857]">Log a weigh-in to unlock a calorie budget. For now: protein at each meal, one indulgence at a time, and plenty of water.</section>
      )}

      <section className="mt-4 grid grid-cols-2 gap-2">
        <button onClick={hairDone ? undefined : onKeystone}
          className={`rounded-2xl border px-3.5 py-3 text-left transition ${hairDone ? 'border-[#cdd6b8] bg-[#eef0e6]' : 'border-[#d8d1c2] bg-[#fbf9f3] active:scale-[0.99]'}`}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7d8a5f]">Keystone</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[14px] font-medium text-[#23211c]">
            {hairDone && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3d4a32" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
            {hairDone ? 'Minoxidil done' : 'Minoxidil tonight'}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-[#8a8474]">{hairDone ? 'The one you never skip.' : 'Tap when applied — hair only works daily.'}</p>
        </button>
        <div className="rounded-2xl border border-[#d8d1c2] bg-[#fbf9f3] px-3.5 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7d8a5f]">Hydrate</p>
          <p className="mt-0.5 text-[14px] font-medium text-[#23211c]">{water} / {wTarget} glasses</p>
          <div className="mt-1.5 flex gap-1.5">
            <button onClick={() => onWater(-1)} className="grid h-7 w-7 place-items-center rounded-full bg-[#e3ddcd] text-[16px] text-[#3d4a32] active:scale-90">−</button>
            <button onClick={() => onWater(1)} className="grid h-7 w-7 place-items-center rounded-full bg-[#3d4a32] text-[16px] text-[#f4f1e8] active:scale-90">+</button>
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-3xl border border-[#e6dfd0] bg-[#fbf9f3] p-5">
        <h2 className="font-display text-[18px] font-semibold text-[#23211c]">Log what you ate</h2>
        <p className="mb-3 mt-0.5 text-[12px] text-[#8a8474]">Tap a NYC pick or search. Calories are padded a little on purpose — restaurants under-count.</p>
        <DietCard state={state} dateIso={today} day={day} budget={b}
          onLog={onLogFood} onRemove={onRemoveFood} onAdd={onAddFood} onSaveCustom={onSaveCustom} onLoc={onSetLoc} onReset={onResetFood} onMove={onMoveFood} onToggleDone={onToggleDietDone} />
      </section>

      <div className="mt-4 flex items-center gap-2 rounded-2xl bg-[#eef0e6] px-4 py-3 text-[13px] leading-snug text-[#3d4a32]">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /></svg>
        <span>{streak > 0 ? `Your ${streak}-day streak is frozen and safe` : 'Streak paused — vacation days are auto-forgiven'} — it resumes the day you're home.</span>
      </div>

      <p className="mt-6 text-center text-[12px] text-[#a39c8d]">Vacation ends {fmtMD(vac.end)}. Consistency over intensity — even on the road.</p>
    </div>
  )
}

// The night-before nudge on the normal dashboard (informational).
function PreTripBanner({ vac }) {
  return (
    <div className="mb-4 flex w-full items-center gap-2 rounded-xl border border-[#cdd4bb] bg-[#eef0e6] px-3 py-2.5 text-[12px] leading-snug text-[#3d4a32]">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M17.8 19.2 16 11l3.5-3.5A2.12 2.12 0 0 0 16.5 4.5L13 8 4.8 6.2a1 1 0 0 0-.9 1.7l6.1 4-1.6 3.4-2.4-.5a1 1 0 0 0-.9 1.6l4 4a1 1 0 0 0 1.6-.9l-.5-2.4 3.4-1.6 4 6.1a1 1 0 0 0 1.7-.9Z" /></svg>
      <span><span className="font-semibold">{vac.label} starts tomorrow.</span> Pack minoxidil + travel skincare, plan to walk. Vacation mode switches on automatically.</span>
    </div>
  )
}

// Welcome-back card during the return window: reassurance + scale amnesty.
function ReturnCard({ state, ret }) {
  return (
    <section className="mt-4 rounded-3xl border border-[#cdd4bb] bg-[#eef0e6] p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8a5f]">Welcome back</p>
      <h2 className="mt-1 font-display text-[18px] font-semibold text-[#23291f]">Ease back in — don't panic at the scale.</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-[#4a5238]">{reassurance(state, ret.vac)}</p>
      <p className="mt-2 text-[12px] text-[#6b7355]">Weigh-ins unlock in {ret.weighUnlockIn} day{ret.weighUnlockIn === 1 ? '' : 's'}. Today: a long walk, protein, water — and resume your routines.</p>
    </section>
  )
}

// Steps are a single yes/no: did you hit your 10k? The exact count isn't
// tracked — anything past target is just bonus. One tap marks it done.
function StepsToggle({ done, target, onDone }) {
  const label = (target || 10000).toLocaleString()
  if (done) {
    return (
      <div className="flex items-center justify-between rounded-2xl border border-[#cdd6b8] bg-[#eef0e6] px-4 py-3">
        <span className="flex items-center gap-2.5">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-[#3d4a32]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f4f1e8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </span>
          <span className="text-[14px] font-medium text-[#23291f]">{label} steps — done</span>
        </span>
        <button onClick={() => onDone(false)} className="text-[12px] font-medium text-[#7d8a5f] active:opacity-70">Undo</button>
      </div>
    )
  }
  return (
    <button onClick={() => onDone(true)}
      className="flex w-full items-center justify-between rounded-2xl border border-[#d8d1c2] bg-[#fbf9f3] px-4 py-3 active:scale-[0.99]">
      <span className="flex items-center gap-2.5">
        <span className="h-6 w-6 rounded-full border-2 border-[#cfc7b5]" />
        <span className="text-[14px] font-medium text-[#4a463c]">Hit your {label} steps?</span>
      </span>
      <span className="text-[12px] font-semibold text-[#3d4a32]">Mark done</span>
    </button>
  )
}

function FocusCard({ focus, day, profile, hour, weightLog, state, dateIso, onStartSkin, onManageProducts, onSkinSensitive, onStepsDone, onStartTrain, train, onSwapDay, onSkipMove, onUndoSkipMove, onStartHair, onLogFood, onRemoveFood, onAddFood, onSaveCustom, onSetLoc, onResetFood, onMoveFood, onToggleDietDone, onWater, onWeight }) {
  const r = day.routines, w = day.workout, meals = day.meals || {}
  return (
    <section className="rounded-3xl border border-[#e6dfd0] bg-[#fbf9f3] p-5 shadow-[0_2px_10px_-6px_rgba(60,55,40,0.25)]">
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
          onLog={onLogFood} onRemove={onRemoveFood} onAdd={onAddFood} onSaveCustom={onSaveCustom} onLoc={onSetLoc} onReset={onResetFood} onMove={onMoveFood} onToggleDone={onToggleDietDone} />
      )}

      {focus === 'movement' && (
        <div className="space-y-3">
          <MoveMakeupCard acc={movementAccount(state, dateIso)} />
          {/* Lift skipped today → hide the session + strategy entirely and show
              only the skipped state (with undo) below. Either/or, never both. */}
          {!(day.workout?.skip && !train?.rest) && (
            <>
              <TrainStrategy state={state} dateIso={dateIso} />
              <TrainStart train={train} onStart={onStartTrain} />
            </>
          )}
          {onSwapDay && train?.swaps?.length > 0 && !train.active && !train.done && !day.workout?.skip && (
            <div>
              <p className="text-[12px] text-[#8a8474]">Less time? Swap today's {train.label} day:</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {train.swaps.map((o) => (
                  <button key={o.dayType} onClick={() => onSwapDay(o.dayType)}
                    className="rounded-full border border-[#d8d1c2] bg-[#fbf9f3] px-3 py-1.5 text-[13px] font-medium text-[#4a463c] active:scale-95">
                    {o.label} · ~{o.estMin} min
                  </button>
                ))}
              </div>
            </div>
          )}
          {onSkipMove && !train?.rest && (!train?.active && !train?.done || day.workout?.skip) && (
            <MoveSkip kind="gym" skip={day.workout?.skip} onSkip={onSkipMove} onUndo={onUndoSkipMove} />
          )}
          <StepsToggle done={stepsHit(day, profile.stepTarget)} target={profile.stepTarget} skipped={day.stepsSkip} onDone={onStepsDone} />
          {onSkipMove && !stepsHit(day, profile.stepTarget) && <MoveSkip kind="steps" skip={day.stepsSkip} onSkip={onSkipMove} onUndo={onUndoSkipMove} />}
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
// The macrocycle banner: where you are in the journey to the body-fat deadline
// and this week's strategic intent, with a 4-week block progress bar.
function TrainStrategy({ state, dateIso }) {
  const ph = trainingPhase(state, dateIso)
  const tone = ph.deload
    ? { border: 'border-[#dcc49a]', bg: 'bg-[#f7efe0]', dot: 'bg-[#c9742e]', tag: 'bg-[#e7d3b2] text-[#8a5a1e]' }
    : ph.heavy
      ? { border: 'border-[#9fae82]', bg: 'bg-[#eef0e6]', dot: 'bg-[#3d4a32]', tag: 'bg-[#3d4a32] text-[#f4f1e8]' }
      : { border: 'border-[#e6dfd0]', bg: 'bg-[#fbf9f3]', dot: 'bg-[#3d4a32]', tag: 'bg-[#e3e7d6] text-[#4a553a]' }
  return (
    <div className={`rounded-2xl border ${tone.border} ${tone.bg} px-4 py-3`}>
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[#7d8a5f]">Strategy</p>
        <p className="text-[11px] text-[#a39c8d]">
          {ph.totalWeeks ? `Week ${ph.weekNumber} of ${ph.totalWeeks}` : `Week ${ph.weekNumber}`}
          {ph.daysLeft != null ? ` · ${ph.daysLeft}d to goal` : ''}
        </p>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <p className="font-display text-[17px] font-semibold text-[#23211c]">
          Block {ph.blockNumber}{ph.totalBlocks ? ` of ${ph.totalBlocks}` : ''} · {ph.label}
        </p>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone.tag}`}>{ph.short}</span>
      </div>
      <p className="mt-1 text-[13px] leading-snug text-[#5b574c]">{ph.line}</p>
      <div className="mt-2.5 flex gap-1" aria-label={`Week ${ph.weekInBlock} of ${ph.blockLen} in this block`}>
        {Array.from({ length: ph.blockLen }).map((_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${
            i + 1 < ph.weekInBlock ? 'bg-[#9aa581]' : i + 1 === ph.weekInBlock ? tone.dot : 'bg-[#e0d9c9]'}`} />
        ))}
      </div>
    </div>
  )
}

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
function DietCard({ state, dateIso, day, onLog, onRemove, onAdd, onSaveCustom, onLoc, onReset, onMove, onToggleDone, budget }) {
  const [adding, setAdding] = useState(false)
  const [autoScan, setAutoScan] = useState(false) // open the barcode scanner on form mount
  const [builder, setBuilder] = useState(null) // { initial, editId } → ComponentBuilder
  const [qtyItem, setQtyItem] = useState(null) // long-pressed item → quantity editor
  const [confirmReset, setConfirmReset] = useState(false)
  const [reviewing, setReviewing] = useState(false) // full-screen day review
  const [foodGroup, setFoodGroup] = useState(null)  // selected pantry category (browse)
  const [query, setQuery] = useState('')            // live search across ALL foods
  const [browsing, setBrowsing] = useState(false)   // expand the full location/category browse
  const [justLogged, setJustLogged] = useState(null) // { name } → inline confirm + undo
  const proteinTarget = state.profile?.proteinTarget || PROTEIN_TARGET_DEFAULT
  const loc = day.foodLoc || defaultLocation(dateIso)
  const totals = dayTotals(day)
  const ct = calorieTarget(state)
  const allItems = effectivePantry(state)
  const items = pantryFor(allItems, loc)
  const log = day.food || []
  const logOne = (it) => { onLog(it, 1); setJustLogged({ name: it.name }) }
  // Most-logged foods, recency-weighted over the last ~60 tracked days — the fast
  // path for the ~20 things you actually eat.
  const freq = {}
  const dks = Object.keys(state.days || {}).sort().slice(-60)
  dks.forEach((k, i) => { const w = 1 + i / Math.max(1, dks.length); for (const e of state.days[k].food || []) if (e.id) freq[e.id] = (freq[e.id] || 0) + w })
  const byFreq = (a, b) => (freq[b.id] || 0) - (freq[a.id] || 0) || a.name.localeCompare(b.name)
  const qn = query.trim().toLowerCase()
  const results = qn ? allItems.filter((it) => it.name.toLowerCase().includes(qn)).sort(byFreq).slice(0, 40) : null
  const recent = [...allItems].filter((it) => freq[it.id]).sort(byFreq).slice(0, 8)
  const travel = budget ? allItems.filter((it) => it.travel).sort(byFreq) : null // NYC quick-picks
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

      {/* protein ring (bar) + calorie guardrail (trip budget in vacation mode) */}
      <div>
        <div className="flex items-baseline justify-between">
          <span className="font-display text-[26px] font-semibold text-[#23211c]">
            {Math.round(totals.protein)}<span className="text-[15px] font-normal text-[#8a8474]"> / {proteinTarget}g protein</span>
          </span>
          {budget && budget.remaining != null
            ? <span className={`text-[13px] font-medium ${budget.remaining >= 0 ? 'text-[#5b6745]' : 'text-[#b0552a]'}`}>{Math.abs(budget.remaining).toLocaleString()} {budget.remaining >= 0 ? 'left' : 'over'}</span>
            : ct
              ? <span className={`text-[13px] ${zone ? zoneCls[zone] : 'text-[#8a8474]'}`}>{totals.kcal} / {ct.ceiling} cal</span>
              : <span className="text-[12px] text-[#b08a3a]">log weight for a calorie target</span>}
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#e6dfd0]">
          <div className="h-full rounded-full bg-[#3d4a32] transition-all" style={{ width: `${pPct}%` }} />
        </div>
        {!budget && zone === 'yellow' && <p className="mt-1 text-[12px] text-[#866a1c]">A touch over target — still a deficit. Just don't drift higher.</p>}
        {!budget && zone === 'red' && <p className="mt-1 text-[12px] text-[#b0552a]">Well over target — today's deficit is mostly gone. Rein it in.</p>}
        {totals.count > 0 && (
          <p className="mt-1.5 text-[12px] text-[#8a8474]">
            {Math.round(totals.carbs)}g carbs · {Math.round(totals.fat)}g fat ·{' '}
            <span className={totals.fiber >= FIBER_TARGET ? 'text-[#5b6745]' : ''}>{Math.round(totals.fiber)}g fiber</span> ·{' '}
            <span className={totals.sugar > SUGAR_LIMIT ? 'text-[#b0552a]' : ''}>{Math.round(totals.sugar)} / {SUGAR_LIMIT}g sugar</span>
          </p>
        )}
      </div>

      {/* search-first food logger: type to find any food, or tap a recent one */}
      <div className="space-y-2.5">
        <div className="relative">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a39c8d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your foods…"
            className="w-full rounded-xl border border-[#ddd5c5] bg-white py-2.5 pl-9 pr-9 text-[14px] text-[#23211c] outline-none focus:border-[#3d4a32]" />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-[#8a8474] hover:bg-[#f1ede4]">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          )}
        </div>

        {results ? (
          results.length > 0 ? (
            <div className="space-y-1.5">{results.map((it) => <FoodRow key={it.id} item={it} onLogOne={() => logOne(it)} onQty={() => setQtyItem(it)} />)}</div>
          ) : (
            <p className="text-[13px] text-[#8a8474]">No match for “{query.trim()}”. Add it with “+ Add food” below.</p>
          )
        ) : (
          <>
            {travel && travel.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#a39c8d]">On the trip</p>
                {travel.map((it) => <FoodRow key={it.id} item={it} onLogOne={() => logOne(it)} onQty={() => setQtyItem(it)} />)}
              </div>
            )}
            {recent.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#a39c8d]">Recent</p>
                {recent.map((it) => <FoodRow key={it.id} item={it} onLogOne={() => logOne(it)} onQty={() => setQtyItem(it)} />)}
              </div>
            )}
            <button onClick={() => setBrowsing((b) => !b)} className="flex items-center gap-1 text-[12px] font-medium text-[#3d4a32]">
              {browsing ? 'Hide all foods' : 'Browse all foods'}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${browsing ? 'rotate-90' : ''}`}><path d="m9 18 6-6-6-6" /></svg>
            </button>
            {browsing && (
              <div className="space-y-2.5 rounded-2xl border border-[#e6dfd0] bg-[#faf7f0] p-3">
                <div className="flex gap-2">
                  {LOCATIONS.map((l) => <Chip key={l} small on={loc === l} onClick={() => onLoc(l)}>{l[0].toUpperCase() + l.slice(1)}</Chip>)}
                </div>
                {items.length > 0 ? (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {tabs.map((g) => <Chip key={g} small on={g === activeGroup} onClick={() => setFoodGroup(g)}>{g}</Chip>)}
                    </div>
                    <div className="space-y-1.5">
                      {shownItems.map((it) => <FoodRow key={it.id} item={it} onLogOne={() => logOne(it)} onQty={() => setQtyItem(it)} />)}
                    </div>
                  </>
                ) : (
                  <p className="text-[13px] text-[#8a8474]">Nothing here yet — add what you ate below.</p>
                )}
              </div>
            )}
          </>
        )}

        {justLogged && (
          <div className="flex items-center justify-between rounded-xl bg-[#eef0e6] px-3 py-2 text-[12px] text-[#3d4a32] fade-in">
            <span className="flex items-center gap-1.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              Logged {justLogged.name}.
            </span>
            <button onClick={() => { onRemove(log.length - 1); setJustLogged(null) }} className="font-semibold text-[#7d8a5f] active:opacity-70">Undo</button>
          </div>
        )}

        <p className="text-[11px] text-[#b3ac9c]">Tap ＋ to log one · tap a food to set a quantity.</p>
      </div>

      {/* quick-add — add by hand, or scan a packaged item's barcode */}
      {adding
        ? <AddFoodForm defaultLoc={loc} autoScan={autoScan} onAdd={(f) => { onAdd(f); setAdding(false) }}
            onBuild={(seed) => { setAdding(false); setBuilder({ initial: { ...seed, components: [] }, editId: null }) }}
            onCancel={() => setAdding(false)} />
        : (
          <div className="flex items-center gap-4">
            <button onClick={() => { setAutoScan(false); setAdding(true) }} className="text-[13px] font-medium text-[#3d4a32]">+ Add food</button>
            <button onClick={() => { setAutoScan(true); setAdding(true) }} className="flex items-center gap-1.5 text-[13px] font-medium text-[#3d4a32]">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14M22 5v14" /></svg>
              Scan barcode
            </button>
          </div>
        )}

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

      {/* done-for-the-day: stops the food nudges + marks the diet tile complete */}
      {onToggleDone && (
        day.dietClosed ? (
          <div className="flex items-center justify-between rounded-2xl bg-[#eef0e6] px-4 py-2.5">
            <span className="flex items-center gap-2 text-[13px] font-medium text-[#3d4a32]">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              Done eating for today
            </span>
            <button onClick={onToggleDone} className="text-[12px] font-medium text-[#8a8474]">Reopen</button>
          </div>
        ) : (
          <button onClick={onToggleDone} className="w-full rounded-2xl border border-[#d8d1c2] bg-[#fbf9f3] px-4 py-2.5 text-[13px] font-medium text-[#4a463c] active:scale-[0.99]">
            Mark done for the day
          </button>
        )
      )}

      {qtyItem && (
        <QtyEditor item={qtyItem}
          onLog={(loggedItem, q) => { onLog(loggedItem, q); setJustLogged({ name: loggedItem.name }); setQtyItem(null) }}
          onEdit={(it) => { setQtyItem(null); setBuilder({ initial: { name: it.name, loc: it.loc, group: groupOf(it), components: componentsFromItem(it) }, editId: it.id }) }}
          onDuplicate={(it) => { setQtyItem(null); setBuilder({ initial: { name: `${it.name} copy`, loc: it.loc, group: groupOf(it), components: componentsFromItem(it) }, editId: null }) }}
          onClose={() => setQtyItem(null)} />
      )}
      {builder && (
        <RecipeBuilder initial={builder.initial} editId={builder.editId} pantry={effectivePantry(state)}
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

// A scannable food row: macros visible at a glance, a ＋ to log one instantly,
// and a tap on the food itself to set a quantity. Replaces the old chip + hidden
// long-press so nothing about quantity is a secret gesture.
function FoodRow({ item, onLogOne, onQty }) {
  const bad = isUnhealthy(item)
  const macros = [item.protein != null ? `${item.protein}g P` : null, item.kcal != null ? `${item.kcal} cal` : null].filter(Boolean).join(' · ')
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${bad ? 'border-[#e7d4b6] bg-[#fbf4e8]' : 'border-[#e6dfd0] bg-[#fbf9f3]'}`}>
      <button onClick={onQty} className="min-w-0 flex-1 text-left active:opacity-70">
        <p className="truncate text-[14px] font-medium text-[#23211c]">
          {bad && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#c9742e] align-middle" title="Treat" />}
          {item.name}
        </p>
        <p className="truncate text-[12px] text-[#8a8474]">{item.portion}{macros ? ` · ${macros}` : ''}</p>
      </button>
      <button onClick={onLogOne} aria-label={`Log one ${item.name}`}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#3d4a32] text-[#f4f1e8] transition active:scale-90">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </div>
  )
}

// Quantity editor (bottom sheet): set how many servings of an item to log in one
// go, with a live macro preview. The serving label is the item's own unit.
function QtyEditor({ item, onLog, onEdit, onDuplicate, onClose }) {
  const [qty, setQty] = useState('1') // raw text so decimals like 0.75 can be typed
  const [mods, setMods] = useState(() => Object.fromEntries((item.mods || []).map((m) => [m.id, m.default])))
  const q = (() => { const n = Number(qty); return n > 0 ? Math.round(n * 100) / 100 : 1 })()
  const bump = (d) => setQty((v) => String(Math.max(0.25, Math.round(((Number(v) || 0) + d) * 100) / 100)))
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
            <input value={qty} onChange={(e) => setQty(e.target.value)} onBlur={() => setQty(String(q))} inputMode="decimal"
              className="w-24 rounded-xl border border-[#ddd5c5] bg-white px-2 py-2 text-center font-display text-[26px] font-semibold text-[#23211c] outline-none focus:border-[#3d4a32]" />
            <div className="mt-1 text-[11px] text-[#a39c8d]">× {item.portion}</div>
          </div>
          <RoundBtn onClick={() => bump(1)}>+</RoundBtn>
        </div>

        <div className="mt-3 flex justify-center gap-2">
          {[0.5, 1, 2, 3, 5].map((n) => <Chip key={n} small on={q === n} onClick={() => setQty(String(n))}>×{n}</Chip>)}
        </div>

        <p className="mt-4 text-center text-[14px] text-[#3d4a32]">
          {q} × {item.portion} → <span className="font-semibold">{Math.round(adj.protein * q * 10) / 10}g protein</span>, {Math.round(adj.kcal * q)} cal
        </p>

        <button onClick={log} className="mt-4 w-full rounded-full bg-[#3d4a32] px-6 py-3 text-[15px] font-semibold text-[#f4f1e8]">Log it</button>
        <div className="mt-2 flex items-center justify-between">
          <button onClick={onClose} className="py-2 text-[13px] text-[#8a8474]">Cancel</button>
          <div className="flex items-center gap-4">
            {onDuplicate && <button onClick={() => onDuplicate(item)} className="py-2 text-[13px] font-medium text-[#8a8474]">Duplicate</button>}
            {onEdit && <button onClick={() => onEdit(item)} className="py-2 text-[13px] font-medium text-[#3d4a32]">Customize →</button>}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// The trip-day critique: no cut nagging, just protein-first, budget-aware,
// no-guilt guidance that matches the vacation dashboard's voice.
function vacationCritique(vb, totals, proteinTarget) {
  const gotP = Math.round(totals.protein)
  const shortP = Math.max(0, proteinTarget - gotP)
  const points = [`${gotP}g protein in — anchor each meal with a lean protein${shortP ? `, about ${shortP}g to go` : ''}.`]
  if (vb?.budget != null) {
    points.push(vb.remaining >= 0
      ? `${vb.remaining.toLocaleString()} cal left of your ${vb.budget.toLocaleString()} trip budget — pace it across the days left.`
      : `${(-vb.remaining).toLocaleString()} cal past your banked buffer — ease back to protein and water, no guilt.`)
  }
  if (vb?.bigDay) points.push('Big day — slow down and hydrate; you can’t productively spend a weekend’s buffer in one sitting.')
  const ok = !vb || vb.remaining == null || vb.remaining >= 0
  return {
    tone: ok ? 'good' : 'warn',
    headline: ok
      ? 'On the trip — enjoy it deliberately. Protein first, one indulgence at a time, water between.'
      : 'Past the buffer — no guilt. Ease off, hydrate, and we reset clean when you’re home.',
    points,
  }
}

// Full-screen day review: protein/calorie totals, an honest critique, and the
// food grouped by auto-assigned meal. Keeps the dashboard card light.
function FoodReview({ state, dateIso, day, proteinTarget, onRemove, onReset, onMove, onClose }) {
  const [confirmReset, setConfirmReset] = useState(false)
  const [movingIdx, setMovingIdx] = useState(null) // entry being reassigned to a meal
  const totals = dayTotals(day)
  const ct = calorieTarget(state)
  // On a trip the strict cut target doesn't apply — mirror the dashboard's
  // banked-budget, no-guilt framing instead of nagging against the ceiling.
  const vac = activeVacation(state, dateIso)
  const vb = vac ? vacationBudget(state, dateIso, vac) : null
  const crit = vac ? vacationCritique(vb, totals, proteinTarget) : dayCritique(state, dateIso, proteinTarget)
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
            <p className="font-display text-[22px] font-semibold text-[#23211c]">{totals.kcal}{vac
              ? (vb?.maintenance ? <span className="text-[13px] font-normal text-[#8a8474]"> / {vb.maintenance} to maintain</span> : null)
              : (ct && <span className="text-[13px] font-normal text-[#8a8474]"> / {ct.ceiling}</span>)}</p>
          </div>
        </div>

        {vb?.budget != null && (
          <div className="mt-2 rounded-2xl border border-[#cdd4bb] bg-[#eef0e6] px-4 py-2.5">
            <p className="text-[12px] leading-snug text-[#4a5238]">
              <span className="font-semibold">{Math.max(0, vb.remaining).toLocaleString()}</span> cal left of your {vb.budget.toLocaleString()} trip budget · {vb.daysLeft} day{vb.daysLeft === 1 ? '' : 's'} left
            </p>
          </div>
        )}

        <div className="mt-2 grid grid-cols-4 gap-2 rounded-2xl border border-[#e6dfd0] bg-[#fbf9f3] px-4 py-2.5 text-center">
          {[
            { lbl: 'Carbs', v: totals.carbs, target: null, tone: '' },
            { lbl: 'Fat', v: totals.fat, target: null, tone: '' },
            { lbl: 'Fiber', v: totals.fiber, target: FIBER_TARGET, tone: totals.fiber >= FIBER_TARGET ? 'text-[#5b6745]' : '' },
            { lbl: 'Sugar', v: totals.sugar, target: SUGAR_LIMIT, tone: totals.sugar > SUGAR_LIMIT ? 'text-[#b0552a]' : '' },
          ].map(({ lbl, v, target, tone }) => (
            <div key={lbl}>
              <p className="text-[10px] uppercase tracking-wider text-[#a39c8d]">{lbl}</p>
              <p className={`text-[15px] font-semibold ${tone || 'text-[#23211c]'}`}>{Math.round(v)}<span className="text-[11px] font-normal text-[#8a8474]">{target ? ` / ${target}g` : 'g'}</span></p>
            </div>
          ))}
        </div>
        {totals.count > 0 && totals.fiber < FIBER_TARGET && (
          <p className="mt-1.5 px-1 text-[12px] text-[#8a7a4a]">
            Fiber's at {Math.round(totals.fiber)}g — aim for ~{FIBER_TARGET}g. Add berries, oats, beans, or veg to close the gap; it blunts hunger and steadies blood sugar.
          </p>
        )}
        {!vac && totals.sugar > SUGAR_LIMIT && (
          <p className="mt-1.5 px-1 text-[12px] text-[#b0552a]">
            Sugar's at {Math.round(totals.sugar)}g — over the {SUGAR_LIMIT}g cap. Fruit is fine; it's the desserts and sweetened drinks to rein in.
          </p>
        )}

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
// Full-screen camera barcode scanner. ZXing is dynamically imported so the ~big
// decoder only loads when you actually scan (keeps the initial bundle lean).
// Prefers the rear camera; degrades to a clear message on permission/hardware.
function BarcodeScanner({ onDetected, onClose }) {
  const videoRef = useRef(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let stopped = false, controls = null
    ;(async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const reader = new BrowserMultiFormatReader()
        controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, videoRef.current, (result, _err, ctrls) => {
          if (stopped || !result) return
          stopped = true; ctrls.stop(); onDetected(result.getText())
        })
      } catch (e) {
        setError(e?.name === 'NotAllowedError' || e?.name === 'NotFoundError' ? 'denied' : 'error')
      }
    })()
    return () => { stopped = true; try { controls?.stop() } catch { /* noop */ } }
  }, [onDetected])
  return createPortal(
    <div className="fixed inset-0 z-[70] bg-black">
      <video ref={videoRef} className="h-full w-full object-cover" playsInline muted autoPlay />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-36 w-72 rounded-2xl border-2 border-white/85 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
      </div>
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
        <span className="rounded-full bg-black/40 px-3 py-1.5 text-[13px] font-medium text-white backdrop-blur">Point at a barcode</span>
        <button onClick={onClose} className="rounded-full bg-white/20 px-3.5 py-1.5 text-[13px] font-semibold text-white backdrop-blur active:scale-95">Cancel</button>
      </div>
      {error && (
        <div className="absolute inset-x-0 bottom-0 bg-black/80 px-5 py-6 text-center">
          <p className="text-[14px] leading-relaxed text-white">
            {error === 'denied' ? 'No camera access. Allow the camera in your browser/site settings, or just enter the food by hand.' : "Couldn't start the camera. Enter the food by hand instead."}
          </p>
          <button onClick={onClose} className="mt-4 w-full rounded-full bg-white px-4 py-2.5 text-[14px] font-semibold text-black">Enter by hand</button>
        </div>
      )}
    </div>,
    document.body
  )
}

function AddFoodForm({ defaultLoc, onAdd, onBuild, onCancel, autoScan }) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('1')
  const [unit, setUnit] = useState('serving')
  const [kcal, setKcal] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [fiber, setFiber] = useState('')
  const [sugar, setSugar] = useState('')
  const [group, setGroup] = useState('Snacks')
  const [foodLoc, setFoodLoc] = useState(defaultLoc || 'home')
  const [scanning, setScanning] = useState(!!autoScan) // opened straight into scan mode?
  const [scanStatus, setScanStatus] = useState(null) // 'loading' | 'ok' | 'sparse' | 'notfound' | 'error'
  const num = (v) => (v === '' ? undefined : Number(v))
  const set = (v, fn) => fn(v == null ? '' : String(v))
  // A scanned barcode → Open Food Facts → prefill the fields, then you review + Add.
  async function onScanned(code) {
    setScanning(false); setScanStatus('loading')
    try {
      const f = await lookupBarcode(code)
      if (!f) { setScanStatus('notfound'); return }
      if (f.name) setName(f.name)
      const pp = parsePortion(f.portion); setAmount(pp.amount); if (FOOD_UNITS.includes(pp.unit)) setUnit(pp.unit)
      if (f.sparse) { setScanStatus('sparse'); return }
      set(f.kcal, setKcal); set(f.protein, setProtein); set(f.carbs, setCarbs)
      set(f.fat, setFat); set(f.fiber, setFiber); set(f.sugar, setSugar)
      setScanStatus('ok')
    } catch { setScanStatus('error') }
  }
  return (
    <div className="space-y-2 rounded-2xl border border-[#e0d9c9] bg-[#fbf9f3] p-3">
      <button onClick={() => { setScanStatus(null); setScanning(true) }}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#cdd4bb] bg-[#eef0e6] px-3 py-2 text-[13px] font-semibold text-[#3d4a32] active:scale-[0.99]">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14M22 5v14" /></svg>
        Scan a barcode
      </button>
      {scanStatus && (
        <p className={`text-[12px] leading-snug ${scanStatus === 'error' || scanStatus === 'notfound' ? 'text-[#b0552a]' : scanStatus === 'loading' ? 'text-[#8a8474]' : 'text-[#5b6745]'}`}>
          {scanStatus === 'loading' ? 'Looking it up…'
            : scanStatus === 'ok' ? 'Found it — review the numbers and Add.'
            : scanStatus === 'sparse' ? 'Found the product, but it has no macros — fill them in.'
            : scanStatus === 'notfound' ? "Not in the food database. Enter it by hand — it'll be saved for next time."
            : "Couldn't reach the database (offline?). Enter it by hand."}
        </p>
      )}
      {scanning && <BarcodeScanner onDetected={onScanned} onClose={() => setScanning(false)} />}
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
      <div className="grid grid-cols-3 gap-2">
        <MacroField label="cal" value={kcal} onChange={setKcal} />
        <MacroField label="protein" value={protein} onChange={setProtein} />
        <MacroField label="carbs" value={carbs} onChange={setCarbs} />
        <MacroField label="fat" value={fat} onChange={setFat} />
        <MacroField label="fiber" value={fiber} onChange={setFiber} />
        <MacroField label="sugar" value={sugar} onChange={setSugar} />
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
        <button disabled={!name.trim()} onClick={() => onAdd({ name: name.trim(), portion: `${(amount || '1').trim()} ${unit}`, kcal: num(kcal), protein: num(protein), carbs: num(carbs), fat: num(fat), fiber: num(fiber), sugar: num(sugar), group, loc: foodLoc })}
          className="rounded-full bg-[#3d4a32] px-4 py-1.5 text-[13px] font-semibold text-[#f4f1e8] disabled:opacity-40">Add &amp; log</button>
        <button onClick={onCancel} className="px-2 py-1.5 text-[13px] text-[#8a8474]">Cancel</button>
      </div>
      {onBuild && (
        <button onClick={() => onBuild({ name: name.trim(), loc: foodLoc, group })} className="text-[12px] font-medium text-[#3d4a32]">
          Build a recipe from your foods (e.g. berries + yogurt) →
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

// Manage the daily supplement stack: toggle which are in the routine, add custom
// ones, set each to morning/evening + with-food. Saves to profile.supps.
function SuppsModal({ profile, onClose, onSave }) {
  const [enabled, setEnabled] = useState(() => new Set(profile.supps?.enabled || DEFAULT_SUPPS))
  const [custom, setCustom] = useState(() => [...(profile.supps?.custom || [])])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [slot, setSlot] = useState('am')
  const [withFood, setWithFood] = useState(true)

  const list = [...SUPPLEMENTS, ...custom]
  const toggle = (id) => setEnabled((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const removeCustom = (id) => { setCustom((c) => c.filter((x) => x.id !== id)); setEnabled((s) => { const n = new Set(s); n.delete(id); return n }) }
  const addCustom = () => {
    const nm = name.trim()
    if (!nm) return
    const id = 'supp_' + nm.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + Date.now().toString(36)
    const supp = { id, name: nm, slot, withFood, custom: true,
      instruction: `${nm} — ${slot === 'am' ? 'morning' : 'evening'}${withFood ? ', with food' : ''}.` }
    setCustom((c) => [...c, supp]); setEnabled((s) => new Set(s).add(id))
    setName(''); setSlot('am'); setWithFood(true); setAdding(false)
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-3 sm:items-center fade-in" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-3xl bg-[#f4f1ea] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-display text-2xl font-semibold text-[#23211c]">Your supplements</h3>
            <p className="mt-1 text-[13px] text-[#8a8474]">What's in your stack rides on your morning &amp; evening routine.</p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none text-[#a39c8d]">×</button>
        </div>

        <p className="mt-5 text-[11px] uppercase tracking-[0.18em] text-[#a39c8d]">Morning</p>
        <div className="divide-y divide-[#ece6da]">
          {list.filter((s) => s.slot !== 'pm').map((s) => <SuppRow key={s.id} s={s} on={enabled.has(s.id)} onToggle={toggle} onRemove={removeCustom} />)}
        </div>
        <p className="mt-5 text-[11px] uppercase tracking-[0.18em] text-[#a39c8d]">Evening</p>
        <div className="divide-y divide-[#ece6da]">
          {list.filter((s) => s.slot === 'pm').length
            ? list.filter((s) => s.slot === 'pm').map((s) => <SuppRow key={s.id} s={s} on={enabled.has(s.id)} onToggle={toggle} onRemove={removeCustom} />)
            : <p className="py-2.5 text-[13px] text-[#8a8474]">Nothing in the evening yet.</p>}
        </div>

        {adding ? (
          <div className="mt-4 space-y-2 rounded-2xl border border-[#e0d9c9] bg-[#fbf9f3] p-3">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Supplement name"
              className="w-full rounded-lg border border-[#ddd5c5] bg-white px-2.5 py-1.5 text-sm outline-none focus:border-[#3d4a32]" />
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip small on={slot === 'am'} onClick={() => setSlot('am')}>Morning</Chip>
              <Chip small on={slot === 'pm'} onClick={() => setSlot('pm')}>Evening</Chip>
              <Chip small on={withFood} onClick={() => setWithFood((v) => !v)}>With food</Chip>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button disabled={!name.trim()} onClick={addCustom} className="rounded-full bg-[#3d4a32] px-4 py-1.5 text-[13px] font-semibold text-[#f4f1e8] disabled:opacity-40">Add</button>
              <button onClick={() => { setAdding(false); setName('') }} className="px-2 py-1.5 text-[13px] text-[#8a8474]">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="mt-4 text-[13px] font-medium text-[#3d4a32]">+ Add a supplement</button>
        )}

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-full border border-[#d8d1c2] bg-white py-2.5 text-sm font-medium text-[#4a463c]">Cancel</button>
          <button onClick={() => onSave({ enabled: [...enabled], custom })} className="flex-1 rounded-full bg-[#3d4a32] py-2.5 text-sm font-semibold text-[#f4f1e8] active:scale-95">Save</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// Coach's review — a full-screen standing report built from all local data:
// where the body-fat goal is, whether the pace is right (health-aware), what's
// been earned, where it's slipping, and how to pace from here. Pure read; every
// number comes from buildReview so the review never disagrees with the rings.
/* ---------- daily share card: an Instagram-ready summary of the day ----------
 * Two full-screen "slides" you screenshot: a plain-language story anyone gets,
 * and a stats slide for the fitness crowd. Dark + branded so a series looks
 * consistent. All derived from data already on the device — nothing uploaded.
 * -------------------------------------------------------------------------- */
function ShareCard({ state, today, profile, onClose }) {
  const [slide, setSlide] = useState(0)
  const [closing, setClosing] = useState(false)
  const leave = () => { if (closing) return; setClosing(true); setTimeout(onClose, 220) }
  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const R = buildReview(state, today)
  const bf = R.bodyFat, day = state.days?.[today] || {}
  const totals = dayTotals(day)
  const trained = day.workout?.session?.status === 'done'
  const trainLabel = day.workout?.type || day.workout?.session?.label
  const stepsDone = stepsHit(day, profile.stepTarget || 10000) || day.stepsDone
  const sleep = sleepScore(state, today, profile)
  const goals = strengthGoalsFor(state, today)
  const pull = goals.find((g) => g.id === 'pull_up')
  const wl = [...(state.weightLog || [])].sort((a, b) => a.date.localeCompare(b.date))

  // Plain-language "what I did today"
  const did = []
  if (trained) did.push(trainLabel ? `Trained · ${trainLabel}` : 'Trained')
  if (stepsDone) did.push('Walked my 10k')
  if (day.dietClosed) did.push('Ate on plan')
  else if (totals.protein >= (profile.proteinTarget || PROTEIN_TARGET_DEFAULT) * 0.7) did.push(`${Math.round(totals.protein)}g protein`)
  if (sleep != null && sleep >= 7) did.push('Slept well')
  if (day.routines?.skincareAM || day.routines?.skincarePM) did.push('Skin dialled')

  return createPortal(
    <div className={`fixed inset-0 z-50 flex flex-col overflow-hidden overscroll-none bg-[#1a2016] ${closing ? 'sk-takeover-out' : 'sk-takeover-in'}`}>
      <div className="flex shrink-0 items-center justify-between px-5 pt-5">
        <div className="flex gap-1.5">
          {[0, 1].map((n) => (
            <button key={n} onClick={() => setSlide(n)} aria-label={`Slide ${n + 1}`}
              className={`h-1.5 rounded-full transition-all ${slide === n ? 'w-6 bg-[#f4f1e8]' : 'w-1.5 bg-[#4a5238]'}`} />
          ))}
        </div>
        <button onClick={leave} className="rounded-full px-3 py-1.5 text-[13px] font-medium text-[#9aa581]">Close</button>
      </div>

      <div className="relative mx-auto flex w-full min-h-0 max-w-md flex-1 flex-col">
        {slide === 0 ? <ShareStory bf={bf} R={R} wl={wl} did={did} /> : <ShareStats bf={bf} R={R} totals={totals} sleep={sleep} pull={pull} profile={profile} day={day} stepsDone={stepsDone} />}
        {/* edge taps to flip slides */}
        <div onClick={() => setSlide(0)} className="absolute inset-y-0 left-0 z-10 w-[22%]" aria-label="Story" />
        <div onClick={() => setSlide(1)} className="absolute inset-y-0 right-0 z-10 w-[22%]" aria-label="Stats" />
      </div>

      <div className="shrink-0 px-6 pb-7 pt-2 text-center">
        <p className="text-[11px] text-[#6f7857]">Screenshot to post{slide === 0 ? ' · tap right for the stats slide' : ' · tap left for the story'}</p>
      </div>
    </div>,
    document.body,
  )
}

// Slide 1 — the human story: big weight, the drop, a trend line, plain wins.
function ShareStory({ bf, R, wl, did }) {
  const lost = bf.weightLost
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center px-8 fade-in">
      <div className="flex items-baseline justify-between">
        <span className="font-display text-[18px] font-semibold tracking-tight text-[#f4f1e8]">localfit</span>
        <span className="text-[11px] uppercase tracking-[0.2em] text-[#9aa581]">Day {R.daysTracked}</span>
      </div>

      {bf.weightNow != null ? (
        <div className="mt-8">
          <p className="text-[12px] uppercase tracking-[0.22em] text-[#9aa581]">Where I'm at</p>
          <p className="font-display mt-2 text-[64px] font-semibold leading-none text-[#f4f1e8]">{bf.weightNow}<span className="text-[26px] text-[#9aa581]"> kg</span></p>
          {lost != null && lost > 0 && (
            <p className="mt-3 text-[17px] text-[#dfe6cf]">Down <span className="font-semibold text-[#f4f1e8]">{lost} kg</span> since I started.</p>
          )}
          {wl.length >= 3 && <MiniSpark values={wl.map((e) => e.kg)} />}
        </div>
      ) : (
        <div className="mt-8">
          <p className="font-display text-[40px] font-semibold leading-tight text-[#f4f1e8]">Day {R.daysTracked} of the work.</p>
        </div>
      )}

      {did.length > 0 && (
        <div className="mt-9">
          <p className="text-[12px] uppercase tracking-[0.22em] text-[#9aa581]">Today I</p>
          <div className="mt-3 flex flex-col gap-2">
            {did.map((d, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#3d4a32]">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#f4f1e8" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                </span>
                <span className="text-[16px] text-[#eef0e6]">{d}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {R.momentum.streak >= 2 && (
        <p className="mt-9 text-[15px] leading-relaxed text-[#9aa581]">
          <span className="font-semibold text-[#dfe6cf]">{R.momentum.streak} days</span> in a row of doing the little things right.
        </p>
      )}
    </div>
  )
}

// Slide 2 — the stats slide for the fitness crowd.
function ShareStats({ bf, R, totals, sleep, pull, profile, day, stepsDone }) {
  const loss = R.pacing.lossPerWk
  const tiles = [
    bf.has && { k: 'Body fat', v: `${bf.now}%`, s: `${bf.target}% goal` },
    loss != null && { k: 'Weekly rate', v: `${loss.toFixed(2)}`, s: 'kg / week' },
    { k: 'Protein', v: `${Math.round(totals.protein)}g`, s: `${profile.proteinTarget || PROTEIN_TARGET_DEFAULT}g target` },
    totals.kcal > 0 && { k: 'Calories', v: `${totals.kcal}`, s: 'today' },
    sleep != null && { k: 'Sleep', v: `${sleep}/10`, s: 'last night' },
    { k: 'Steps', v: stepsDone ? '10k+' : '—', s: 'daily floor' },
    pull && pull.current > 0 && { k: 'Pull-ups', v: `${pull.current}`, s: `${pull.target} goal` },
    bf.weightLost != null && bf.weightLost !== 0 && { k: 'Total lost', v: `${bf.weightLost}kg`, s: `${R.daysTracked} days` },
  ].filter(Boolean).slice(0, 6)
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center px-8 fade-in">
      <div className="flex items-baseline justify-between">
        <span className="font-display text-[18px] font-semibold tracking-tight text-[#f4f1e8]">localfit</span>
        <span className="text-[11px] uppercase tracking-[0.2em] text-[#9aa581]">The numbers</span>
      </div>
      <div className="mt-7 grid grid-cols-2 gap-3">
        {tiles.map((t) => (
          <div key={t.k} className="rounded-2xl border border-[#3a4230] bg-[#232a1c] px-4 py-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[#9aa581]">{t.k}</p>
            <p className="font-display mt-1.5 text-[30px] font-semibold leading-none text-[#f4f1e8]">{t.v}</p>
            <p className="mt-1 text-[11px] text-[#7d8a5f]">{t.s}</p>
          </div>
        ))}
      </div>
      <p className="mt-6 text-[12px] leading-relaxed text-[#7d8a5f]">Cutting body fat while holding strength — tracked on localfit, no wearable.</p>
    </div>
  )
}

// A tiny inline weight sparkline for the story slide.
function MiniSpark({ values }) {
  const n = values.length
  const min = Math.min(...values), max = Math.max(...values)
  const span = max - min || 1
  const w = 260, h = 44
  const pts = values.map((v, i) => `${(i / (n - 1)) * w},${h - ((v - min) / span) * h}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="44" className="mt-5 overflow-visible" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="#9aa581" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={w} cy={h - ((values[n - 1] - min) / span) * h} r="3.5" fill="#f4f1e8" />
    </svg>
  )
}

/* ---------- progress photos + before/after collage --------------------------
 * You shoot in the native camera; here you SELECT today's shot and the app keeps
 * a compressed copy in IndexedDB (never localStorage, never uploaded). Your
 * originals stay in Photos — these are working copies for the timeline and the
 * before/after the app stitches for the reveal.
 * -------------------------------------------------------------------------- */
// One labelled rule in the photo guide.
function PhotoRule({ label, children }) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#3d4a32]" />
      <p><span className="font-semibold text-[#23211c]">{label}.</span> {children}</p>
    </div>
  )
}

function ProgressPhotos({ state, today, onClose }) {
  const [photos, setPhotos] = useState(null) // null = loading; [] = none
  const [pose, setPose] = useState('front')
  const [showGuide, setShowGuide] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [viewing, setViewing] = useState(null) // {id,date,pose,url}
  const [collage, setCollage] = useState(null) // dataURL
  const [making, setMaking] = useState(false)
  const fileRef = useRef(null)
  const urls = useRef([]) // object URLs to revoke on unmount

  const load = useCallback(async () => {
    try {
      const rows = await allPhotos()
      urls.current.forEach((u) => URL.revokeObjectURL(u))
      urls.current = []
      const withUrls = rows.map((r) => { const url = URL.createObjectURL(r.blob); urls.current.push(url); return { ...r, url } })
      setPhotos(withUrls)
    } catch (e) { setErr('Photos need on-device storage, which this browser is blocking. Try the installed app.'); setPhotos([]) }
  }, [])
  useEffect(() => { load(); return () => urls.current.forEach((u) => URL.revokeObjectURL(u)) }, [load])

  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const onPick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    setBusy(true); setErr(null)
    try {
      const { blob, w, h } = await compressImage(file)
      await putPhoto(today, pose, blob, { w, h })
      await load()
    } catch (e2) { setErr("Couldn't save that photo — try a different one.") }
    setBusy(false)
  }

  const removeOne = async (id) => { await deletePhoto(id); setViewing(null); await load() }

  const byPose = {}
  POSES.forEach((p) => { byPose[p.id] = [] })
  ;(photos || []).forEach((ph) => { (byPose[ph.pose] || (byPose[ph.pose] = [])).push(ph) })
  const poseShots = byPose[pose] || []
  const poseLabel = POSES.find((p) => p.id === pose)?.label || 'Front'
  const todayHasPose = poseShots.some((s) => s.date === today)

  const makeCollage = async () => {
    if (poseShots.length < 2) return
    setMaking(true)
    try {
      const url = await buildProgressCollage(poseShots[0], poseShots[poseShots.length - 1], state, poseLabel)
      setCollage(url)
    } catch (e) { setErr("Couldn't build the collage.") }
    setMaking(false)
  }

  const lastDate = photos && photos.length ? photos[photos.length - 1].date : null
  const daysSince = lastDate ? Math.round((new Date(today + 'T00:00:00') - new Date(lastDate + 'T00:00:00')) / 86400000) : null
  const due = photos && (photos.length === 0 || daysSince >= 7)

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-none bg-[#f1ede4] sk-takeover-in">
      <input ref={fileRef} type="file" accept="image/*" onChange={onPick} className="hidden" />
      <div className="mx-auto max-w-xl px-5 pb-16 pt-6">
        <button onClick={onClose} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-[#6f6a5d]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>Back
        </button>
        <h1 className="font-display text-[24px] font-semibold text-[#23211c]">Progress photos</h1>
        <p className="mt-1 text-[13px] leading-snug text-[#8a8474]">Three angles a week — front, side, back — shot the same way each time. Kept only on this phone; your originals stay in Photos.</p>

        {err && <p className="mt-4 rounded-xl border border-[#e0b4b4] bg-[#f7dede] px-3 py-2 text-[12px] text-[#8a2e2e]">{err}</p>}

        {/* How to take them — the whole game is consistency */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-[#e6dfd0] bg-[#fbf9f3]">
          <button onClick={() => setShowGuide((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left">
            <span className="text-[13px] font-semibold text-[#23211c]">How to take them</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9a9482" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition ${showGuide ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
          </button>
          {showGuide && (
            <div className="space-y-3 px-4 pb-4 pt-0.5 text-[13px] leading-snug text-[#4a463c]">
              <PhotoRule label="Same everything">Same spot and wall, same natural light, same time — morning, before eating or drinking, is the most consistent. Consistency is what makes the change obvious.</PhotoRule>
              <PhotoRule label="Full body in frame">Phone upright, propped at hip-to-chest height about 2 metres away. Frame from just above your head to below your knees so your thighs are in shot. Use the 3-second timer.</PhotoRule>
              <PhotoRule label="Shorts, relaxed">Topless, same shorts each time. Stand relaxed and natural — don't flex or suck in. The honest, relaxed shot is where the real change shows.</PhotoRule>
              <PhotoRule label="Three angles, every time">
                <span className="font-semibold text-[#3d4a32]">Front</span> — arms slightly off your sides so waist and arms show (chest, belly, arms). <span className="font-semibold text-[#3d4a32]">Side</span> — turn 90°, arms relaxed; this profile is where belly fat reads most dramatically. <span className="font-semibold text-[#3d4a32]">Back</span> — lower back and overall leanness.
              </PhotoRule>
              <PhotoRule label="Lock the pose">Mark your feet on the floor (or line up with a tile) so you stand in the exact same place and pose each week.</PhotoRule>
            </div>
          )}
        </div>

        {due && !err && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#cdd4bb] bg-[#eef0e6] px-3 py-2.5 text-[12px] text-[#3d4a32]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
            <span>{photos.length === 0 ? 'No photos yet — add your day-one set (front, side, back) to start.' : `It's been ${daysSince} days — time for this week's set.`}</span>
          </div>
        )}

        {/* angle selector */}
        <div className="mt-4 flex gap-1.5 rounded-full bg-[#e7e1d4] p-1">
          {POSES.map((p) => {
            const has = (byPose[p.id] || []).length
            return (
              <button key={p.id} onClick={() => setPose(p.id)}
                className={`flex-1 rounded-full px-3 py-2 text-[13px] font-semibold transition ${pose === p.id ? 'bg-[#3d4a32] text-[#f4f1e8]' : 'text-[#6b6857]'}`}>
                {p.label}{has ? <span className={`ml-1 text-[11px] ${pose === p.id ? 'text-[#9aa581]' : 'text-[#a39c8d]'}`}>{has}</span> : ''}
              </button>
            )
          })}
        </div>

        <button onClick={() => fileRef.current?.click()} disabled={busy}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-[#3d4a32] px-6 py-3.5 text-[15px] font-semibold text-[#f4f1e8] active:scale-[0.99] disabled:opacity-50">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></svg>
          {busy ? 'Saving…' : `${todayHasPose ? 'Replace' : 'Add'} today's ${poseLabel.toLowerCase()} photo`}
        </button>

        {poseShots.length >= 2 && (
          <button onClick={makeCollage} disabled={making}
            className="mt-2.5 w-full rounded-full border border-[#cdd4bb] bg-[#fbf9f3] px-6 py-3 text-[14px] font-semibold text-[#3d4a32] active:scale-[0.99] disabled:opacity-50">
            {making ? 'Building…' : `${poseLabel} before / after`}
          </button>
        )}

        {photos === null ? (
          <p className="mt-8 text-center text-[13px] text-[#a39c8d]">Loading…</p>
        ) : photos.length > 0 ? (
          <div className="mt-6 space-y-5">
            {POSES.map((p) => {
              const shots = byPose[p.id] || []
              if (!shots.length) return null
              return (
                <div key={p.id}>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9a9482]">{p.label} · {shots.length}</p>
                  <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                    {[...shots].reverse().map((ph) => (
                      <button key={ph.id} onClick={() => setViewing(ph)} className="relative aspect-[3/4] w-[30%] shrink-0 overflow-hidden rounded-xl border border-[#e6dfd0] bg-[#e8e2d5] active:scale-[0.98]">
                        <img src={ph.url} alt={ph.date} className="h-full w-full object-cover" />
                        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-1.5 pb-1 pt-4 text-left text-[10px] font-medium text-white">{fmtMD(ph.date)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>

      {/* enlarge + delete */}
      {viewing && (
        <div className="fixed inset-0 z-20 flex flex-col bg-black/85 fade-in" onClick={() => setViewing(null)}>
          <div className="flex shrink-0 items-center justify-between px-5 pt-5">
            <span className="text-[13px] font-medium text-white/80">{POSES.find((p) => p.id === viewing.pose)?.label} · {fmtMD(viewing.date)}</span>
            <button onClick={() => setViewing(null)} className="rounded-full px-3 py-1.5 text-[13px] font-medium text-white/80">Close</button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-4"><img src={viewing.url} alt="" className="max-h-full max-w-full rounded-xl object-contain" /></div>
          <div className="shrink-0 px-6 pb-8" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => removeOne(viewing.id)} className="w-full rounded-full border border-[#e0b4b4]/60 px-6 py-3 text-[14px] font-medium text-[#f0c0c0]">Delete this photo</button>
          </div>
        </div>
      )}

      {/* collage result — long-press to save on iOS, or screenshot */}
      {collage && (
        <div className="fixed inset-0 z-20 flex flex-col bg-[#1a2016] fade-in">
          <div className="flex shrink-0 justify-end px-5 pt-5">
            <button onClick={() => setCollage(null)} className="rounded-full px-3 py-1.5 text-[13px] font-medium text-[#9aa581]">Close</button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-5"><img src={collage} alt="Before and after" className="max-h-full max-w-full rounded-2xl object-contain shadow-[0_20px_50px_-20px_rgba(0,0,0,0.7)]" /></div>
          <div className="shrink-0 px-6 pb-8 text-center">
            <button onClick={() => shareImage(collage)} className="w-full rounded-full bg-[#3d4a32] px-6 py-3.5 text-[15px] font-semibold text-[#f4f1e8] active:scale-[0.99]">Share / Save</button>
            <p className="mt-2 text-[11px] text-[#6f7857]">Or press and hold the image to save it to Photos.</p>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

// Nearest logged weight to a date (kg), or null.
function weightNear(state, date) {
  const wl = state.weightLog || []
  if (!wl.length) return null
  const t = new Date(date + 'T00:00:00').getTime()
  let best = wl[0]
  for (const e of wl) if (Math.abs(new Date(e.date + 'T00:00:00') - t) < Math.abs(new Date(best.date + 'T00:00:00') - t)) best = e
  return best.kg
}

// Stitch two photos into a portrait before/after with dates + weights.
async function buildProgressCollage(before, after, state, poseLabel = '') {
  const load = (blob) => new Promise((res, rej) => { const i = new Image(); const u = URL.createObjectURL(blob); i.onload = () => res({ i, u }); i.onerror = () => rej(new Error('img')); i.src = u })
  const [B, A] = await Promise.all([load(before.blob), load(after.blob)])
  const W = 1080, H = 1350, gap = 20
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const x = c.getContext('2d')
  x.fillStyle = '#1a2016'; x.fillRect(0, 0, W, H)
  x.fillStyle = '#f4f1e8'; x.font = '600 46px Georgia, "Times New Roman", serif'; x.textAlign = 'left'; x.textBaseline = 'alphabetic'; x.fillText('localfit', 46, 86)
  x.fillStyle = '#9aa581'; x.font = '600 24px system-ui, sans-serif'; x.textAlign = 'right'; x.fillText(`PROGRESS${poseLabel ? ` · ${poseLabel.toUpperCase()}` : ''}`, W - 46, 82)
  const top = 122, footH = 180, imgH = H - top - footH, colW = (W - gap * 3) / 2
  drawCover(x, B.i, gap, top, colW, imgH)
  drawCover(x, A.i, gap * 2 + colW, top, colW, imgH)
  const wb = weightNear(state, before.date), wa = weightNear(state, after.date)
  const fy = top + imgH + 54
  x.textAlign = 'left'; x.fillStyle = '#9aa581'; x.font = '600 24px system-ui'; x.fillText(fmtMD(before.date), gap + 8, fy)
  x.fillStyle = '#f4f1e8'; x.font = '600 36px system-ui'; if (wb != null) x.fillText(`${wb} kg`, gap + 8, fy + 44)
  x.textAlign = 'right'; x.fillStyle = '#9aa581'; x.font = '600 24px system-ui'; x.fillText(fmtMD(after.date), W - gap - 8, fy)
  x.fillStyle = '#f4f1e8'; x.font = '600 36px system-ui'; if (wa != null) x.fillText(`${wa} kg`, W - gap - 8, fy + 44)
  if (wb != null && wa != null) {
    const d = Math.round((wa - wb) * 10) / 10
    x.textAlign = 'center'; x.fillStyle = '#dfe6cf'; x.font = '600 32px system-ui'; x.fillText(`${d < 0 ? '−' : '+'}${Math.abs(d)} kg`, W / 2, fy + 44)
  }
  URL.revokeObjectURL(B.u); URL.revokeObjectURL(A.u)
  return c.toDataURL('image/jpeg', 0.92)
}
function drawCover(x, img, dx, dy, dw, dh) {
  const s = Math.max(dw / img.width, dh / img.height)
  const iw = img.width * s, ih = img.height * s
  x.save(); x.beginPath(); x.rect(dx, dy, dw, dh); x.clip()
  x.drawImage(img, dx + (dw - iw) / 2, dy + (dh - ih) / 2, iw, ih); x.restore()
}
// iOS-friendly save: Web Share with the image file if available, else download.
async function shareImage(dataUrl) {
  try {
    const blob = await (await fetch(dataUrl)).blob()
    const file = new File([blob], 'localfit-progress.jpg', { type: 'image/jpeg' })
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return }
  } catch { /* fall through */ }
  const a = document.createElement('a'); a.href = dataUrl; a.download = 'localfit-progress.jpg'; a.click()
}

// Format a low–high range to a step (0.5 kg, 1%). Collapses to a single number
// when the rounded bounds match — near-term projections where the band is tight.
function fmtRange(low, high, step) {
  const r = (n) => Math.round(n / step) * step
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
  const a = r(low), b = r(high)
  return a === b ? fmt(a) : `${fmt(a)}–${fmt(b)}`
}

function ReviewView({ state, today, onApply }) {
  const R = buildReview(state, today)
  const [applied, setApplied] = useState(false)
  const tone = {
    excellent: { chip: 'bg-[#dfe6cf] text-[#3d4a32]', word: 'Excellent' },
    good: { chip: 'bg-[#dfe6cf] text-[#3d4a32]', word: 'On track' },
    aggressive: { chip: 'bg-[#f0dcc9] text-[#8a5a1e]', word: 'Too hard' },
    behind: { chip: 'bg-[#f0dcc9] text-[#8a5a1e]', word: 'Drifting' },
    building: { chip: 'bg-[#e6e2d6] text-[#6f6a5d]', word: 'Building' },
    starting: { chip: 'bg-[#e6e2d6] text-[#6f6a5d]', word: 'New' },
  }[R.standing] || { chip: 'bg-[#e6e2d6] text-[#6f6a5d]', word: '—' }
  const bf = R.bodyFat, p = R.pacing
  const paceAccent = p.verdict === 'aggressive' || p.verdict === 'behind' || p.verdict === 'stalled'
    ? 'border-[#e7d4b6] bg-[#f7ecd6]' : p.verdict === 'no-data' || p.verdict === 'building'
    ? 'border-[#e6dfd0] bg-[#fbf9f3]' : 'border-[#cdd4bb] bg-[#eef0e6]'
  const Item = ({ children, good }) => (
    <li className="flex items-start gap-2.5 py-1.5">
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${good ? 'bg-[#3d4a32]' : 'bg-[#c08a4a]'}`} />
      <span className="text-[14px] leading-snug text-[#33322c]">{children}</span>
    </li>
  )

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#9a9482]">Coach's review</p>
        <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${tone.chip}`}>{tone.word}</span>
      </div>

      {/* Top-line standing — the coach's one-sentence verdict */}
      <section className="mt-3 rounded-[28px] bg-[#23291f] px-6 py-7 shadow-[0_18px_40px_-24px_rgba(35,41,31,0.7)]">
        <h1 className="font-display text-[26px] font-semibold leading-[1.16] text-[#f4f1e8]">{R.verdictWord}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[#cfccba]">{R.topline}</p>
        {R.hasData && (
          <p className="mt-4 text-[12px] uppercase tracking-[0.16em] text-[#9aa581]">{R.daysTracked} days in{R.overall != null ? ` · overall ${R.overall}/10` : ''}</p>
        )}
      </section>

      {/* Body fat — the primary goal, led first */}
      <section className="mt-4 rounded-3xl border border-[#e6dfd0] bg-[#fbf9f3] p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[18px] font-semibold text-[#23211c]">Body fat</h2>
          <span className="text-[11px] uppercase tracking-[0.18em] text-[#9a9482]">the goal</span>
        </div>
        {bf.has ? (
          <>
            <div className="mt-3 flex items-end gap-4">
              <div>
                <p className="font-display text-[34px] font-semibold leading-none text-[#23211c]">{bf.now}<span className="text-[18px] text-[#9a9482]">%</span></p>
                <p className="mt-1 text-[12px] text-[#8a8474]">now</p>
              </div>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#b3ac9c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mb-2.5"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              <div>
                <p className="font-display text-[34px] font-semibold leading-none text-[#3d4a32]">{bf.target}<span className="text-[18px] text-[#9aa581]">%</span></p>
                <p className="mt-1 text-[12px] text-[#8a8474]">target</p>
              </div>
              {bf.pointsOff != null && bf.pointsOff > 0 && (
                <p className="mb-1 ml-auto text-right text-[13px] text-[#8a8474]">{bf.pointsOff} pts to go</p>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-[#ece5d7] pt-3 text-[13px]">
              {bf.start != null && <span className="text-[#8a8474]">Start <span className="font-medium text-[#33322c]">{bf.start}%</span></span>}
              {bf.pointsLost != null && bf.pointsLost !== 0 && <span className="text-[#8a8474]">{bf.pointsLost > 0 ? 'Lost' : 'Up'} <span className="font-medium text-[#33322c]">{Math.abs(bf.pointsLost)} pts</span></span>}
              {bf.weightLost != null && bf.weightLost !== 0 && <span className="text-[#8a8474]">Scale <span className="font-medium text-[#33322c]">{bf.weightLost > 0 ? '−' : '+'}{Math.abs(bf.weightLost)} kg</span></span>}
              {bf.weeksLeft != null && <span className="text-[#8a8474]">Deadline <span className="font-medium text-[#33322c]">{bf.weeksLeft} wk</span></span>}
            </div>
          </>
        ) : (
          <p className="mt-2 text-[14px] text-[#8a8474]">No body-fat estimate yet. Log one from the dashboard and this fills in with your real trend.</p>
        )}
      </section>

      {/* Trajectory — actual + trend vs the pace you should be on */}
      {(state.weightLog || []).length >= 2 && (
        <section className="mt-4 rounded-3xl border border-[#e6dfd0] bg-[#fbf9f3] p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-[18px] font-semibold text-[#23211c]">Trajectory</h2>
            <span className="text-[11px] uppercase tracking-[0.18em] text-[#9a9482]">actual vs plan</span>
          </div>
          <p className="mt-1 mb-3 text-[13px] text-[#8a8474]">Your trend against the pace you need for the goal and what your deficit predicts.</p>
          <WeightTimeline state={state} today={today} variant="full" />
        </section>
      )}

      {/* Milestones — at the current trend, where he lands on the dates he cares about */}
      {R.milestones?.rows?.length > 0 && (
        <section className="mt-4 rounded-3xl border border-[#e6dfd0] bg-[#fbf9f3] p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-[18px] font-semibold text-[#23211c]">Where you're headed</h2>
            <span className="text-[11px] uppercase tracking-[0.18em] text-[#9a9482]">at this trend</span>
          </div>
          {R.milestones.canProject ? (
            <p className="mt-1 mb-3 text-[13px] text-[#8a8474]">
              A range from {R.milestones.wNow} kg{R.milestones.bfNow != null ? ` · ${R.milestones.bfNow}%` : ''} today: the low end holds your ~{R.milestones.perWeek?.toFixed(2)} kg/wk, the high end assumes it slows as you lean out.
            </p>
          ) : (
            <p className="mt-1 mb-3 text-[13px] text-[#8a8474]">Your trend is flat right now — these hold near today's {R.milestones.wNow} kg until the scale moves. Log a few more weigh-ins to project forward.</p>
          )}
          <ul className="divide-y divide-[#ece5d7]">
            {R.milestones.rows.map((m) => (
              <li key={m.dateIso} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-[#23211c]">{m.label}</p>
                  <p className="mt-0.5 text-[12px] text-[#8a8474]">{m.dateLabel} · in {m.daysAhead} day{m.daysAhead === 1 ? '' : 's'}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-display text-[21px] font-semibold leading-none text-[#23211c]">
                    {fmtRange(m.weightLow, m.weightHigh, 0.5)}<span className="text-[13px] font-normal text-[#9a9482]"> kg</span>
                  </p>
                  {m.bfLow != null && (
                    <p className="mt-1 text-[12px] font-medium text-[#3d4a32]">{fmtRange(m.bfLow, m.bfHigh, 1)}% bf</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-[#f3efe6] px-3 py-2 text-[12px] leading-snug text-[#7a7568]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a39877" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
            <span>The band widens further out because loss slows as you lean — and recent drops still carry some water. Near dates are tight; the far ones are a spread, not a promise.</span>
          </p>
        </section>
      )}

      {/* Pacing — rate-based and health-aware */}
      <section className={`mt-4 rounded-3xl border p-5 ${paceAccent}`}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[18px] font-semibold text-[#23211c]">Your pace</h2>
          {p.lossPerWk != null && (
            <span className="text-[12px] text-[#6b6857]">~{p.lossPerWk.toFixed(2)} kg/wk{p.neededPerWk != null ? ` · need ${p.neededPerWk.toFixed(2)}` : ''}</span>
          )}
        </div>
        <p className="mt-2 text-[15px] font-medium text-[#23211c]">{p.headline}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-[#6b6857]">{p.detail}</p>
        {p.projection && (
          <p className="mt-3 rounded-xl bg-[#ffffff88] px-3 py-2 text-[13px] text-[#33322c]">
            At this rate you reach {bf.target}% around <span className="font-semibold">{p.projection.hitLabel}</span>
            {p.projection.vsWeeks >= 0
              ? ` — about ${p.projection.vsWeeks} week${p.projection.vsWeeks === 1 ? '' : 's'} ahead of your deadline.`
              : ` — about ${Math.abs(p.projection.vsWeeks)} week${Math.abs(p.projection.vsWeeks) === 1 ? '' : 's'} past your deadline.`}
          </p>
        )}
        <p className="mt-3 flex items-start gap-2 text-[14px] leading-snug text-[#23291f]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3d4a32" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          <span className="font-medium">{p.prescription}</span>
        </p>
      </section>

      {/* Pillars — the five habit scores */}
      {R.overall != null && (
        <section className="mt-4 rounded-3xl bg-[#23291f] px-5 py-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-[18px] font-semibold text-[#f4f1e8]">The pillars</h2>
            {R.weakest && R.strongest && R.weakest.key !== R.strongest.key && (
              <span className="text-[12px] text-[#9aa581]">{R.strongest.label} leads · {R.weakest.label} lags</span>
            )}
          </div>
          <div className="mt-4 flex justify-between gap-1">
            {R.pillars.map((pl) => <ScoreRing key={pl.key} score={pl.score} label={pl.label} />)}
          </div>
        </section>
      )}

      {/* Wins */}
      {R.wins.length > 0 && (
        <section className="mt-4 rounded-3xl border border-[#e6dfd0] bg-[#fbf9f3] p-5">
          <h2 className="font-display text-[18px] font-semibold text-[#23211c]">What you've earned</h2>
          <ul className="mt-1">{R.wins.map((t, i) => <Item key={i} good>{t}</Item>)}</ul>
        </section>
      )}

      {/* Gaps */}
      {R.gaps.length > 0 && (
        <section className="mt-4 rounded-3xl border border-[#e6dfd0] bg-[#fbf9f3] p-5">
          <h2 className="font-display text-[18px] font-semibold text-[#23211c]">Where you're slipping</h2>
          <ul className="mt-1">{R.gaps.map((t, i) => <Item key={i}>{t}</Item>)}</ul>
        </section>
      )}

      {/* How to pace from here */}
      <section className="mt-4 rounded-3xl border border-[#cdd4bb] bg-[#eef0e6] p-5">
        <h2 className="font-display text-[18px] font-semibold text-[#23291f]">How to pace yourself</h2>
        <ol className="mt-2 flex flex-col gap-2.5">
          {R.pacePlan.map((t, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#3d4a32] text-[12px] font-semibold text-[#f4f1e8]">{i + 1}</span>
              <span className="text-[14px] leading-snug text-[#23291f]">{t}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Apply the plan — turn the verdict into concrete, reversible targets */}
      {applied ? (
        <section className="mt-4 rounded-3xl border border-[#cdd4bb] bg-[#eef0e6] p-5 text-center fade-in">
          <span className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-[#3d4a32]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f4f1e8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </span>
          <p className="font-display text-[17px] font-semibold text-[#23291f]">Plan applied</p>
          <p className="mt-1 text-[13px] text-[#6b7355]">Your targets are updated across the app. Change any of them anytime from your profile.</p>
        </section>
      ) : R.suggestions.length > 0 ? (
        <section className="mt-4 rounded-3xl border border-[#cdd4bb] bg-[#eef0e6] p-5">
          <h2 className="font-display text-[18px] font-semibold text-[#23291f]">Apply the coach's plan</h2>
          <p className="mt-1 text-[13px] text-[#6b7355]">One tap sets these targets. All reversible.</p>
          <ul className="mt-3 flex flex-col divide-y divide-[#dbe0cd]">
            {R.suggestions.map((s) => (
              <li key={s.id} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[14px] font-medium text-[#23291f]">{s.title}</span>
                  <span className="shrink-0 text-[13px] tabular-nums text-[#4a5238]">
                    <span className="text-[#9a9482] line-through">{s.from}</span>
                    <span className="mx-1.5 text-[#7d8a5f]">→</span>
                    <span className="font-semibold text-[#3d4a32]">{s.to}</span>
                    <span className="ml-2 rounded-full bg-[#dfe6cf] px-2 py-0.5 text-[11px] font-semibold text-[#3d4a32]">{s.delta}</span>
                  </span>
                </div>
                <p className="mt-1 text-[12px] leading-snug text-[#6b7355]">{s.why}</p>
              </li>
            ))}
          </ul>
          <button onClick={() => { onApply?.(R.applyPatch); setApplied(true) }}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#3d4a32] px-5 py-3.5 text-[15px] font-semibold text-[#f4f1e8] transition active:scale-[0.99]">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            Apply the coach's plan
          </button>
        </section>
      ) : R.hasData ? (
        <section className="mt-4 rounded-3xl border border-[#e6dfd0] bg-[#fbf9f3] p-5 text-center">
          <p className="text-[14px] text-[#6b6857]">Your targets already match the plan — nothing to change. Keep executing.</p>
        </section>
      ) : null}

      <p className="mt-8 text-center text-[12px] text-[#a39c8d]">Consistency over intensity. One step at a time.</p>
    </div>
  )
}

// Full-screen PR board: the best set on each main lift, with date + how far it's
// come. Best set is picked by estimated 1RM but shown literally as weight × reps.
// Today's Plate — the prescribed day: defined meals at defined times, each a tap
// into the guided RecipeFlow (lunch on office days opens the restaurant rotation).
function PlateCard({ state, today, onOpen, onBrowse }) {
  const plate = todaysPlate(state, today)
  if (!plate.length) return null
  return (
    <div className="mt-3 rounded-3xl border border-[#e6dfd0] bg-[#fbf9f3] p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-[17px] font-semibold text-[#23211c]">Today's Plate</h3>
        <span className="text-[11px] uppercase tracking-[0.18em] text-[#9a9482]">prescribed</span>
      </div>
      <div className="mt-2 flex flex-col divide-y divide-[#ece5d7]">
        {plate.map((meal, n) => (
          <button key={n} onClick={() => (meal.pick ? onBrowse() : onOpen(meal.recipeId))}
            className="flex items-center gap-3 py-2.5 text-left active:opacity-70">
            <span className="w-11 shrink-0 text-[12px] font-medium tabular-nums text-[#9a9482]">{meal.time}</span>
            <span className={`h-4 w-4 shrink-0 rounded-full border ${meal.done ? 'border-[#3d4a32] bg-[#3d4a32]' : 'border-[#cfc7b5]'}`} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-[#23211c]">{meal.pick ? 'Pick your lunch' : (meal.recipe?.name || meal.label)}</span>
              <span className="block truncate text-[12px] text-[#9a9482]">
                {meal.label}{meal.macros ? ` · ${meal.macros.kcal} cal · ${meal.macros.protein}g P` : meal.pick ? ' · office rotation' : ''}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// Pantry stock + shopping list. Tap a stock chip to cycle Stocked → Low → Out;
// the shopping list is everything Low/Out, and "Log haul" flips it all back.
function GroceriesView({ state, today, onStock, onHaul, onClose }) {
  const [open, setOpen] = useState({}) // which pantry tiers are expanded (default collapsed)
  const list = shoppingList(state)
  const due = restockDue(state, today)
  const byTier = {}
  for (const g of GROCERY_CATALOG) { (byTier[g.perishability] ||= []).push(g) }
  const chip = (lvl) => lvl === 'out' ? 'border-[#b5503f] text-[#b5503f]' : lvl === 'low' ? 'border-[#a8842a] text-[#a8842a]' : 'border-[#cfc7b5] text-[#8a8474]'
  const Row = ({ it, lvl }) => (
    <button onClick={() => onStock(it.id, cycleStock(lvl))} className="flex w-full items-center justify-between gap-3 py-2 text-left active:opacity-70">
      <span className="truncate text-[14px] text-[#23211c]">{it.name}</span>
      <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${chip(lvl)}`}>{STOCK_LABEL[lvl]}</span>
    </button>
  )
  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-none bg-[#f1ede4] sk-takeover-in">
      <div className="mx-auto max-w-xl px-5 pb-16 pt-6">
        <button onClick={onClose} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-[#6f6a5d]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>Back
        </button>
        <h1 className="font-display text-[24px] font-semibold text-[#23211c]">Groceries</h1>
        <p className="mt-1 text-[13px] text-[#8a8474]">Tap a chip to cycle Stocked → Low → Out. The shopping list builds itself.</p>

        {due.due && (
          <div className="mt-4 rounded-2xl border border-[#e6dfd0] bg-[#fbf9f3] p-4">
            <p className="text-[14px] font-medium text-[#23211c]">Grocery day — {due.low} item{due.low > 1 ? 's' : ''} to restock{due.out ? ", something's out" : ''}.</p>
            <p className="mt-0.5 text-[12px] text-[#8a8474]">{due.daysSince >= 900 ? 'No haul logged yet.' : `${due.daysSince} day${due.daysSince === 1 ? '' : 's'} since your last haul (every ${due.cadence}).`}</p>
          </div>
        )}

        {list.length > 0 && (
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#9a9482]">Shopping list</h2>
              <button onClick={onHaul} className="rounded-full bg-[#3d4a32] px-3.5 py-1.5 text-[12px] font-semibold text-[#f4f1e8]">Log haul</button>
            </div>
            <div className="mt-2 space-y-3">
              {list.map(({ group, items }) => (
                <div key={group} className="rounded-2xl border border-[#e6dfd0] bg-[#fbf9f3] p-3">
                  <p className="px-1 text-[11px] font-medium uppercase tracking-wider text-[#a39c8d]">{group}</p>
                  <div className="mt-1 divide-y divide-[#ece5d7]">{items.map(({ item, level }) => <Row key={item.id} it={item} lvl={level} />)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <h2 className="mt-6 text-[12px] font-semibold uppercase tracking-[0.18em] text-[#9a9482]">Your pantry</h2>
        <p className="mt-0.5 text-[12px] text-[#a39c8d]">Grouped by how long it lasts — stockpile the stable stuff, buy fresh often.</p>
        <div className="mt-2 space-y-3">
          {PERISH_TIERS.filter((t) => byTier[t]).map((t) => (
            <div key={t} className="rounded-2xl border border-[#e6dfd0] bg-[#fbf9f3] p-3">
              <button onClick={() => setOpen((o) => ({ ...o, [t]: !o[t] }))}
                className="flex w-full items-center justify-between px-1 py-0.5 text-left active:opacity-70">
                <span className="min-w-0">
                  <span className="text-[12px] font-semibold text-[#23211c]">{PERISH_META[t].label}</span>
                  <span className="text-[11px] text-[#a39c8d]"> · {byTier[t].length} · {PERISH_META[t].hint}</span>
                </span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a39c8d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform duration-200 ${open[t] ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
              </button>
              {open[t] && <div className="mt-1 divide-y divide-[#ece5d7]">{byTier[t].map((it) => <Row key={it.id} it={it} lvl={stockLevel(state, it.id)} />)}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function LiftsView({ state, today, onClose }) {
  const lifts = bestLifts(state)
  const hasAny = lifts.some((l) => l.best)
  const goals = strengthGoalsFor(state, today)
  const dayLabel = { push: 'Push', pull: 'Pull', legs: 'Legs' }
  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-none bg-[#f1ede4] sk-takeover-in">
      <div className="mx-auto max-w-xl px-5 pb-16 pt-6">
        <button onClick={onClose} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-[#6f6a5d]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>Back
        </button>
        <h1 className="font-display text-[24px] font-semibold text-[#23211c]">Your lifts</h1>
        <p className="mt-1 text-[13px] text-[#8a8474]">Your strength goals, then the best set on every main lift.</p>

        {/* Strength goals — concrete targets with a deadline and a pace read */}
        <section className="mt-5">
          <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-[#9a9482]">Goals by year-end</h2>
          <div className="space-y-2.5">
            {goals.map((g) => <StrengthGoalCard key={g.id} g={g} />)}
          </div>
        </section>

        <h2 className="mb-2 mt-7 text-[12px] font-semibold uppercase tracking-[0.18em] text-[#9a9482]">Personal records</h2>

        {!hasAny ? (
          <p className="mt-6 text-[14px] leading-relaxed text-[#8a8474]">No working sets logged yet. Once you finish a session, your bench, squat, RDL, press, row and pulldown records will show here.</p>
        ) : (
          <div className="mt-5 space-y-3">
            {lifts.map((l) => (
              <div key={l.id} className="rounded-2xl border border-[#e6dfd0] bg-[#fbf9f3] p-4">
                <div className="flex items-baseline justify-between">
                  <p className="font-display text-[17px] font-semibold text-[#23211c]">{l.name}{l.db && <span className="ml-1.5 text-[11px] font-normal text-[#a39c8d]">· per dumbbell</span>}</p>
                  <span className="text-[10px] uppercase tracking-wider text-[#a39c8d]">{dayLabel[l.day] || l.day}</span>
                </div>
                {l.best ? (
                  <>
                    <div className="mt-1.5 flex items-baseline gap-2">
                      <span className="font-display text-[26px] font-semibold text-[#3d4a32]">{l.best.weight}<span className="text-[15px] font-normal text-[#8a8474]"> lb × {l.best.reps}</span></span>
                      <span className="text-[12px] text-[#a39c8d]">≈ {Math.round(l.best.e1rm)} lb 1RM</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-[#8a8474]">
                      <span>PR on {fmtMD(l.best.date)}</span>
                      {l.sessions > 1 && l.trend > 0 && <span className="font-medium text-[#5b6745]">▲ +{l.trend} lb since {fmtMD(l.first.date)}</span>}
                      {l.sessions > 1 && l.trend <= 0 && <span>{l.sessions} sessions logged</span>}
                      {l.sessions === 1 && <span>first session on record</span>}
                    </div>
                  </>
                ) : (
                  <p className="mt-1.5 text-[13px] text-[#a39c8d]">No sets logged yet</p>
                )}
                <LiftMilestones id={l.id} topWeight={l.topWeight || 0} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

// One strength goal: current vs target, a pace-coloured progress bar, and the
// coach's read on whether the recent trend gets there by the deadline.
function StrengthGoalCard({ g }) {
  const unit = g.unit === 'lb' ? (g.perDumbbell ? 'lb/DB' : 'lb') : g.unit
  const tone = g.achieved ? 'bg-[#3d6a32]' : g.onPace === false ? 'bg-[#c08a4a]' : 'bg-[#3d4a32]'
  const daysChip = g.achieved ? 'Hit' : g.daysLeft > 0 ? `${g.daysLeft}d left` : 'Due'
  return (
    <div className="rounded-2xl border border-[#e6dfd0] bg-[#fbf9f3] p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-[16px] font-semibold text-[#23211c]">{g.name}</p>
          <p className="text-[11px] text-[#a39c8d]">{g.basis}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${g.achieved ? 'bg-[#dfe6cf] text-[#3d4a32]' : g.onPace === false ? 'bg-[#f0dcc9] text-[#8a5a1e]' : 'bg-[#eef0e6] text-[#6b7355]'}`}>{daysChip}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-display text-[24px] font-semibold text-[#3d4a32]">{g.current}</span>
        <span className="text-[13px] text-[#8a8474]">/ {g.target} {unit}</span>
        {!g.achieved && g.remaining > 0 && <span className="ml-auto text-[12px] text-[#8a8474]">{g.remaining} to go</span>}
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#e6dfd0]">
        <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${g.pct}%` }} />
      </div>
      <p className="mt-2 text-[12px] leading-snug text-[#6b6857]">{g.line}</p>
    </div>
  )
}

// Plate-milestone progress for one lift: a bar to the next landmark + the full
// ladder as pips (cleared = filled olive, next = outlined, future = faint).
function LiftMilestones({ id, topWeight }) {
  const p = liftProgress(id, topWeight)
  if (!p.ladder.length) return null
  const label = (w) => `${w} lb${plateLabel(id, w) ? ` · ${plateLabel(id, w)}` : ''}`
  return (
    <div className="mt-3 border-t border-[#efe9dc] pt-3">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[#8a8474]">
          {p.maxed ? 'Every milestone cleared.' : topWeight > 0 ? `Next: ${label(p.next)}` : `First target: ${label(p.next)}`}
        </span>
        {!p.maxed && topWeight > 0 && <span className="font-medium text-[#3d4a32]">{p.next - topWeight} lb to go</span>}
      </div>
      {!p.maxed && (
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#e6dfd0]">
          <div className="h-full rounded-full bg-[#3d4a32] transition-all" style={{ width: `${Math.round(p.frac * 100)}%` }} />
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {p.ladder.map((w) => {
          const hit = topWeight >= w, isNext = w === p.next
          return (
            <span key={w} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              hit ? 'bg-[#3d4a32] text-[#f4f1e8]' : isNext ? 'border border-[#9aa581] text-[#5b6745]' : 'border border-[#e0d9c9] text-[#b3ac9c]'}`}>
              {plateLabel(id, w) || `${w}`}
            </span>
          )
        })}
      </div>
    </div>
  )
}

// Diary: a continuous, scroll-back heatmap of how successful each day was. One
// cell per day, shaded pale→deep olive by diaryScore; weeks stacked newest-first.
const DIARY_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const diaryDow = (iso) => (new Date(iso + 'T00:00:00').getDay() + 6) % 7 // Mon=0..Sun=6
const diaryShade = (s) => s == null ? 'bg-[#eceadd]'
  : s >= 0.85 ? 'bg-[#3d4a32]' : s >= 0.65 ? 'bg-[#6b7a4c]' : s >= 0.45 ? 'bg-[#94a36f]' : s >= 0.25 ? 'bg-[#c2c8a4]' : 'bg-[#e3e1d0]'

function DiaryView({ state, profile, today, onClose }) {
  const [lens, setLens] = useState('overall') // overall | diet | workouts
  const logged = Object.keys(state.days || {}).filter((k) => dayLogged(state.days[k])).sort()
  const firstIso = logged[0] || shiftIso(today, -27)
  const startMon = shiftIso(firstIso, -diaryDow(firstIso)) // back to that week's Monday

  // Every day from startMon → today, then pad the last week out to Sunday.
  const days = []
  for (let cur = startMon; cur <= today; cur = shiftIso(cur, 1)) {
    days.push({ iso: cur, score: diaryScore(state, cur, profile), today: cur === today })
  }
  while (days.length % 7 !== 0) days.push({ iso: shiftIso(startMon, days.length), future: true })
  const weeks = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))
  weeks.reverse() // newest week on top

  const monthOf = (iso) => { const [y, m] = iso.split('-'); return DIARY_MON[+m - 1] + (y !== today.slice(0, 4) ? ` '${y.slice(2)}` : '') }
  const scored = days.filter((d) => d.score != null)
  const avg = scored.length ? Math.round((scored.reduce((a, d) => a + d.score, 0) / scored.length) * 100) : null

  let lastMonth = null
  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-none bg-[#f1ede4] sk-takeover-in">
      <div className="mx-auto max-w-xl px-5 pb-16 pt-6">
        <button onClick={onClose} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-[#6f6a5d]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>Back
        </button>
        <h1 className="font-display text-[24px] font-semibold text-[#23211c]">Diary</h1>
        <p className="mt-1 text-[13px] text-[#8a8474]">How complete each day was — diet, movement and sleep count most.{avg != null ? ` Averaging ${avg}% over ${scored.length} days.` : ''}</p>

        <div className="mt-4 flex gap-1 rounded-full border border-[#e0d9c9] bg-[#fbf9f3] p-1">
          {[['overall', 'Overall'], ['diet', 'Diet'], ['workouts', 'Workouts']].map(([v, l]) => (
            <button key={v} onClick={() => setLens(v)} className={`flex-1 rounded-full px-3 py-1.5 text-[13px] font-medium transition ${lens === v ? 'bg-[#3d4a32] text-[#f4f1e8]' : 'text-[#6f6a5d]'}`}>{l}</button>
          ))}
        </div>

        {scored.length === 0 ? (
          <p className="mt-6 text-[14px] leading-relaxed text-[#8a8474]">No days logged yet. As you complete routines, meals, steps and lifts, each day fills in here.</p>
        ) : (
          <>
            {/* column headers */}
            <div className="mt-5 flex items-center gap-1.5">
              <span className="w-7 shrink-0" />
              <div className="grid flex-1 grid-cols-7 gap-1">
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="text-center text-[10px] text-[#b3ac9c]">{d}</span>)}
              </div>
            </div>
            <div className="mt-1 space-y-1">
              {weeks.map((wk) => {
                const mlabel = monthOf(wk[0].iso)
                const show = mlabel !== lastMonth ? (lastMonth = mlabel) : ''
                return (
                  <div key={wk[0].iso} className="flex items-center gap-1.5">
                    <span className="w-7 shrink-0 text-right text-[10px] leading-none text-[#a39c8d]">{show}</span>
                    <div className="grid flex-1 grid-cols-7 gap-1">
                      {wk.map((c) => (
                        <div key={c.iso}
                          title={c.future ? '' : `${c.iso}${c.score != null ? ` · ${Math.round(c.score * 100)}%` : ' · no data'}`}
                          className={`aspect-square rounded-[4px] ${c.future ? 'opacity-0' : diaryShade(c.score)} ${c.today ? 'ring-2 ring-[#23211c] ring-offset-1 ring-offset-[#f1ede4]' : ''}`} />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
            {/* legend */}
            <div className="mt-5 flex items-center justify-end gap-1.5 text-[11px] text-[#a39c8d]">
              <span>Less</span>
              {['bg-[#e3e1d0]', 'bg-[#c2c8a4]', 'bg-[#94a36f]', 'bg-[#6b7a4c]', 'bg-[#3d4a32]'].map((c) => <span key={c} className={`h-3 w-3 rounded-[3px] ${c}`} />)}
              <span>More</span>
            </div>

            {lens === 'diet' && <DietTrends state={state} profile={profile} />}
            {lens === 'workouts' && <WorkoutTrends state={state} />}
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

// ---- diary trend panels (zoomed-in lenses) ----------------------------------
function ChartCard({ title, sub, now, children }) {
  return (
    <div className="mt-6 border-t border-[#e6dfd0] pt-5">
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-[14px] font-semibold text-[#23211c]">{title}{sub ? <span className="ml-1.5 text-[11px] font-normal text-[#a39c8d]">{sub}</span> : null}</p>
        {now && <span className="text-[12px] text-[#6f6a5d]">latest {now}</span>}
      </div>
      {children}
    </div>
  )
}
// Flexbox bar chart with an optional dashed target line.
function Bars({ data, target, unit }) {
  if (!data.length) return <p className="text-[12px] text-[#8a8474]">No data yet.</p>
  const peak = (Math.max(target || 0, ...data.map((d) => d.value)) || 1) * 1.12
  return (
    <>
      <div className="relative flex h-28 items-end gap-[3px]">
        {target != null && <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[#b08a3a]" style={{ bottom: `${(target / peak) * 100}%` }} />}
        {data.map((d, i) => (
          <div key={i} title={`${d.label}: ${d.value}${unit || ''}`} className={`min-w-[4px] flex-1 rounded-t ${d.tone || 'bg-[#3d4a32]'}`} style={{ height: `${Math.max(3, (d.value / peak) * 100)}%` }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-[#a39c8d]">
        <span>{data[0].label}</span>{data.length > 1 && <span>{data.at(-1).label}</span>}
      </div>
    </>
  )
}
// SVG line for a continuous series (bodyweight).
function Sparkline({ points, unit }) {
  if (points.length < 2) return <p className="text-[12px] text-[#8a8474]">Two or more entries needed for a trend.</p>
  const vals = points.map((p) => p.value), min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1
  const W = 320, H = 90, pad = 8
  const xs = points.map((_, i) => pad + (i / (points.length - 1)) * (W - 2 * pad))
  const ys = points.map((p) => pad + (1 - (p.value - min) / range) * (H - 2 * pad))
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(1)} ${ys[i].toFixed(1)}`).join(' ')
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 90 }} preserveAspectRatio="none">
        <path d={path} fill="none" stroke="#3d4a32" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => <circle key={i} cx={xs[i]} cy={ys[i]} r="2.5" fill="#3d4a32" />)}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-[#a39c8d]">
        <span>{points[0].label} · {points[0].value}{unit}</span><span>{points.at(-1).label} · {points.at(-1).value}{unit}</span>
      </div>
    </>
  )
}
function DietTrends({ state, profile }) {
  const days = Object.keys(state.days || {}).sort()
  const series = []
  for (const d of days) { const day = state.days[d]; if (day?.food?.length) { const t = dayTotals(day); series.push({ date: d, kcal: t.kcal, protein: Math.round(t.protein) }) } }
  const ceiling = calorieTarget(state)?.ceiling || null
  const pT = profile.proteinTarget || PROTEIN_TARGET_DEFAULT
  const weights = (state.weightLog || []).slice().sort((a, b) => a.date.localeCompare(b.date))
  if (!series.length && weights.length < 2) return <p className="mt-6 border-t border-[#e6dfd0] pt-5 text-[13px] text-[#8a8474]">Log meals and weigh-ins to see diet trends.</p>
  const zoneTone = { green: 'bg-[#6b7a4c]', yellow: 'bg-[#c9a227]', red: 'bg-[#b0552a]' }
  const calBars = series.map((s) => ({ label: fmtMD(s.date), value: s.kcal, tone: ceiling ? zoneTone[calorieZone(s.kcal, ceiling)] : 'bg-[#6b7a4c]' }))
  const proBars = series.map((s) => ({ label: fmtMD(s.date), value: s.protein, tone: s.protein >= pT ? 'bg-[#3d4a32]' : 'bg-[#aab884]' }))
  return (
    <div>
      <ChartCard title="Calories" sub={ceiling ? `ceiling ${ceiling}` : ''} now={series.at(-1) ? `${series.at(-1).kcal} cal` : ''}>
        <Bars data={calBars} target={ceiling} unit=" cal" />
      </ChartCard>
      <ChartCard title="Protein" sub={`target ${pT}g`} now={series.at(-1) ? `${series.at(-1).protein}g` : ''}>
        <Bars data={proBars} target={pT} unit="g" />
      </ChartCard>
      <ChartCard title="Bodyweight" now={weights.at(-1) ? `${weights.at(-1).kg} kg` : ''}>
        <Sparkline points={weights.map((w) => ({ label: fmtMD(w.date), value: w.kg }))} unit=" kg" />
      </ChartCard>
    </div>
  )
}
function WorkoutTrends({ state }) {
  const days = Object.keys(state.days || {}).sort()
  const byWeek = {}
  for (const d of days) {
    const s = state.days[d].workout?.session
    if (!s || s.status !== 'done') continue
    let vol = 0
    for (const e of s.exercises || []) for (const st of e.sets || []) if (st.reps) vol += (st.weight || 0) * st.reps
    const wk = shiftIso(d, -diaryDow(d))
    byWeek[wk] = byWeek[wk] || { week: wk, volume: 0, sessions: 0 }
    byWeek[wk].volume += Math.round(vol); byWeek[wk].sessions++
  }
  const weeks = Object.values(byWeek).sort((a, b) => a.week.localeCompare(b.week))
  if (!weeks.length) return <p className="mt-6 border-t border-[#e6dfd0] pt-5 text-[13px] text-[#8a8474]">Complete a session to see workout trends.</p>
  const volBars = weeks.map((w) => ({ label: fmtMD(w.week), value: w.volume }))
  const totalSessions = weeks.reduce((a, w) => a + w.sessions, 0)
  return (
    <div>
      <ChartCard title="Weekly volume" sub="total weight moved" now={`${weeks.at(-1).volume.toLocaleString()} lb`}>
        <Bars data={volBars} unit=" lb" />
      </ChartCard>
      <div className="mt-6 border-t border-[#e6dfd0] pt-5">
        <p className="mb-2 text-[14px] font-semibold text-[#23211c]">Sessions per week</p>
        <div className="flex flex-wrap gap-1.5">
          {weeks.map((w) => <span key={w.week} className="rounded-lg border border-[#e6dfd0] bg-[#fbf9f3] px-2.5 py-1 text-[12px] text-[#4a463c]">{fmtMD(w.week)}: <span className="font-semibold text-[#3d4a32]">{w.sessions}</span></span>)}
        </div>
        <p className="mt-2 text-[12px] text-[#8a8474]">{totalSessions} session{totalSessions > 1 ? 's' : ''} across {weeks.length} week{weeks.length > 1 ? 's' : ''}.</p>
      </div>
    </div>
  )
}

function SuppRow({ s, on, onToggle, onRemove }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[14px] font-semibold text-[#23211c]">{s.name}</p>
        <p className="text-[12px] text-[#8a8474]">{s.slot === 'pm' ? 'Evening' : 'Morning'}{s.withFood ? ' · with food' : ''}{s.custom ? ' · custom' : ''}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {s.custom && <button onClick={() => onRemove(s.id)} aria-label="Remove" className="text-[18px] leading-none text-[#b3ac9c]">×</button>}
        <button onClick={() => onToggle(s.id)} className={`rounded-full px-3 py-1.5 text-[12px] font-medium ${on ? 'bg-[#3d4a32] text-[#f4f1e8]' : 'border border-[#d8d1c2] bg-white text-[#4a463c]'}`}>
          {on ? 'In stack' : 'Add'}
        </button>
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
// When nothing is urgent, the coach shouldn't just say "on track" or nag protein
// — it rotates a real optimization tip across the levers that actually move the
// needle (strength, cardio/longevity, sleep, diet quality, protein timing),
// varied by the day so it isn't one-note.
function coachTip(state, today, profile) {
  const tips = []
  try {
    const pull = strengthGoalsFor(state, today).find((g) => g.id === 'pull_up')
    if (pull && !pull.achieved && pull.current > 0)
      tips.push({ headline: `${pull.current} of ${pull.target} pull-ups.`, support: 'Add two sets of slow negatives when you train — reps climb fast, and it beats another isolation for your back.' })
  } catch { /* no goals yet */ }
  const cw = cardioMinutesInWindow(state.days || {}, today, 7)
  if (cw < (profile.cardioTargetPerWeek || 150))
    tips.push({ headline: 'Build the engine today.', support: 'Twenty to thirty easy minutes — a Zone-2 walk or ride. Cardio fitness is one of the strongest predictors of a long life, and it keeps the fat coming off.' })
  tips.push({ headline: 'Protect tonight’s sleep.', support: `Lights out by ${clockGoal(profile.bedGoal)} — sleep is when the fat you're chasing actually burns and the muscle repairs. Miss it and hunger spikes tomorrow.` })
  tips.push({ headline: 'Eat the rainbow today.', support: 'A vegetable or fruit at every meal — the fibre keeps you full on fewer calories and does more for your health than any supplement.' })
  tips.push({ headline: 'Spread your protein.', support: 'Aim for ~30g at each meal instead of loading it all at dinner — even distribution is what actually holds muscle while you cut.' })
  const idx = Math.floor(new Date(today + 'T00:00:00').getTime() / 86400000) % tips.length
  return tips[idx]
}

function buildCoach({ hour, minute, day, profile, skinDue, lastSleep, state, today }) {
  const r = day.routines, w = day.workout
  skinDue = skinDue || { amPending: !r.skincareAM, pmPending: !r.skincarePM, tonightActive: null, shaveDue: false }
  const stepsIn = stepsHit(day, profile.stepTarget), water = day.water || 0, wTarget = profile.waterTarget
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
    { const tip = coachTip(state, today, profile); return { eyebrow, headline: tip.headline, support: tip.support, action: null } }
  }

  if (phase === 'midday') {
    const pn = proteinNudge(); if (pn) return pn
    if (water < expectedWater(hour, wTarget)) return { eyebrow, headline: `You're at ${water} of ${wTarget} glasses. Drink up.`, support: `Behind on water for midday. Get a glass in before you forget.`, action: { target: 'water' } }
    if (tcall && (tcall.focus === 'train' || tcall.focus === 'both')) return move(tcall)
    if (!stepsIn) return { eyebrow, headline: `Your 10k isn't in yet. Get on your feet.`, support: `Ten minutes of walking now beats cramming it after dark. Mark it done once you've hit it.`, action: { target: 'movement' } }
    { const tip = coachTip(state, today, profile); return { eyebrow, headline: tip.headline, support: tip.support, action: null } }
  }

  // evening + night (17–24): movement decision comes from the engine.
  if (tcall && (tcall.focus === 'train' || tcall.focus === 'both')) return move(tcall)
  const pn = proteinNudge(); if (pn) return pn
  if (tcall && tcall.focus === 'walk') return move(tcall)
  if (over) return { eyebrow, headline: `You're over your calorie ceiling.`, support: `Stop eating for tonight — no treats, no "just one more". The deficit is the whole game.`, action: { target: 'diet' } }
  if (water < wTarget && hour < 22) return { eyebrow, headline: `Finish your water — ${water} of ${wTarget}.`, support: `Don't go to bed short on hydration. Knock out the rest now.`, action: { target: 'water' } }
  if (!r.skincarePM && skinDue.pmPending) return skincarePM()
  if (hour >= 21) return { eyebrow, headline: `That's a full day. Be in bed soon.`, support: `Recovery is non-negotiable. Weigh in first thing tomorrow — we track the trend, not the noise.`, action: null }
  { const tip = coachTip(state, today, profile); return { eyebrow, headline: tip.headline, support: tip.support, action: null } }
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
    <span className="grid h-8 w-8 place-items-center">
      <svg width="20" height="20" viewBox="0 0 18 18" className="-rotate-90">
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
// Adaptive deficit coach: reads the smoothed fat-loss trend vs the pace needed for
// December, stays noise-aware (won't react to water/creatine), and offers a one-tap
// calorie adjustment when the trend genuinely drifts.
function DeficitCard({ state, today, onApply }) {
  const c = deficitCoach(state, today)
  if (!c || c.status === 'no-weight') return null // WeightCard already prompts for weight
  const tone = c.status === 'behind' ? 'border-[#e7d4b6] bg-[#f7ecd6]'
    : c.status === 'too-fast' ? 'border-[#dcae73] bg-[#fbf1e1]'
    : c.status === 'on-track' || c.status === 'at-goal' ? 'border-[#cdd6b8] bg-[#eef0e6]'
    : 'border-[#e6dfd0] bg-[#fbf9f3]'
  const sign = (kgWk) => `${kgWk >= 0 ? '−' : '+'}${Math.abs(kgWk).toFixed(2)}` // weight change: losing shows −
  return (
    <section className={`mt-4 rounded-2xl border ${tone} px-4 py-3.5`}>
      <p className="text-[11px] uppercase tracking-[0.18em] text-[#7d8a5f]">Deficit coach</p>
      <p className="mt-1 text-[15px] font-semibold text-[#23211c]">{c.headline}</p>
      <p className="mt-1 text-[13px] leading-snug text-[#5b574c]">{c.detail}</p>
      {c.loss != null && c.needWk != null && (
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-[#6f6a5d]">
          <span>Trend <span className="font-semibold text-[#23211c]">{sign(c.loss)} kg/wk</span>{c.spanDays ? <span className="text-[#a39c8d]"> · {c.spanDays}d</span> : null}</span>
          <span>Need <span className="font-semibold text-[#23211c]">−{c.needWk.toFixed(2)} kg/wk</span></span>
          {c.ceiling ? <span>Ceiling <span className="font-semibold text-[#23211c]">{c.ceiling}</span></span> : null}
        </div>
      )}
      {c.adjust && (
        <button onClick={() => onApply({ deficit: c.adjust.deficit })}
          className="mt-3 rounded-full bg-[#3d4a32] px-4 py-1.5 text-[13px] font-semibold text-[#f4f1e8] active:scale-95">
          {c.adjust.dir === 'down' ? `Tighten ${c.adjust.deltaCal} cal → ${c.adjust.newCeiling} ceiling` : `Add ${c.adjust.deltaCal} cal → ${c.adjust.newCeiling} ceiling`}
        </button>
      )}
    </section>
  )
}

function WeightCard({ weightLog, today, day, onSave }) {
  const [editing, setEditing] = useState(false)
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
    </section>
  )
}

// The weight graph: raw weigh-ins + a smoothed trend, overlaid with two
// reference trajectories (needed-for-goal and deficit-predicted) so you can see
// at a glance whether you're ahead of, on, or behind the pace you should be at.
// variant 'compact' (dashboard) is terse; 'full' (Coach's Review) adds the
// legend, axis, and an ahead/behind status read.
const TL_COLORS = { actual: '#b3ac9c', trend: '#3d4a32', needed: '#b0552a', predicted: '#7d8a5f' }
function WeightTimeline({ state, today, variant = 'compact' }) {
  const tl = buildWeightTimeline(state, today)
  if (!tl.ok) return null
  const full = variant === 'full'
  const st = tl.status || {}
  const verdictCopy = (v, aheadKg) => {
    const mag = Math.abs(aheadKg)
    if (v === 'ahead') return `${mag} kg ahead`
    if (v === 'behind') return `${mag} kg behind`
    return 'right on it'
  }
  const verdictCls = (v) => v === 'ahead' ? 'text-[#3d4a32]' : v === 'behind' ? 'text-[#b0552a]' : 'text-[#6f6a5d]'

  return (
    <div>
      {full && (st.needed || st.predicted) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {st.needed && (
            <span className="rounded-xl border border-[#e6dfd0] bg-[#fbf9f3] px-3 py-1.5 text-[12px]">
              <span className="text-[#8a8474]">Goal pace </span>
              <span className={`font-semibold ${verdictCls(st.needed.verdict)}`}>{verdictCopy(st.needed.verdict, st.needed.aheadKg)}</span>
            </span>
          )}
          {st.predicted && (
            <span className="rounded-xl border border-[#e6dfd0] bg-[#fbf9f3] px-3 py-1.5 text-[12px]">
              <span className="text-[#8a8474]">Deficit plan </span>
              <span className={`font-semibold ${verdictCls(st.predicted.verdict)}`}>{verdictCopy(st.predicted.verdict, st.predicted.aheadKg)}</span>
            </span>
          )}
        </div>
      )}
      <ResponsiveContainer width="100%" height={full ? 230 : 140}>
        <LineChart data={tl.rows} margin={{ top: 6, right: 10, bottom: 0, left: full ? -16 : -24 }}>
          <XAxis dataKey="date" tick={{ fill: '#a39c8d', fontSize: 10 }} tickFormatter={(d) => d.slice(5)} axisLine={{ stroke: '#e0d9c9' }} tickLine={false} minTickGap={full ? 24 : 16} />
          <YAxis domain={['auto', 'auto']} tick={{ fill: '#a39c8d', fontSize: 10 }} width={full ? 34 : 32} axisLine={false} tickLine={false} tickFormatter={(v) => Math.round(v)} />
          <Tooltip contentStyle={{ background: '#23291f', border: 'none', borderRadius: 12, color: '#f4f1e8', fontSize: 12 }}
            formatter={(v, name) => [v != null ? `${v} kg` : '—', TL_LABELS[name] || name]} labelFormatter={(d) => d} />
          {tl.series.needed && <Line type="monotone" dataKey="needed" stroke={TL_COLORS.needed} strokeWidth={1.75} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />}
          {tl.series.predicted && <Line type="monotone" dataKey="predicted" stroke={TL_COLORS.predicted} strokeWidth={1.5} strokeDasharray="2 3" dot={false} connectNulls isAnimationActive={false} />}
          <Line type="monotone" dataKey="actual" stroke={TL_COLORS.actual} strokeWidth={1.25} dot={{ r: 2.5, fill: TL_COLORS.actual }} connectNulls={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="trend" stroke={TL_COLORS.trend} strokeWidth={2.75} dot={false} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[10px] text-[#8a8474]">
        <LegendDot color={TL_COLORS.trend} label="Trend" solid />
        <LegendDot color={TL_COLORS.actual} label="Actual" solid />
        {tl.series.needed && <LegendDot color={TL_COLORS.needed} label="Needed for goal" />}
        {tl.series.predicted && <LegendDot color={TL_COLORS.predicted} label="Deficit plan" />}
      </div>
    </div>
  )
}
const TL_LABELS = { actual: 'Actual', trend: 'Trend', needed: 'Needed for goal', predicted: 'Deficit plan' }
function LegendDot({ color, label, solid }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-0 w-4 border-t-2" style={{ borderColor: color, borderStyle: solid ? 'solid' : 'dashed' }} />
      {label}
    </span>
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
    sum += trained ? 10 : (stepsHit(d, stepTarget) ? 10 : 0)
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
  return trained ? 1 : (stepsHit(d, profile.stepTarget || 10000) ? 1 : 0)
}
const dayLogged = (d) => !!(d && (d.routines?.skincareAM || d.routines?.skincarePM || d.routines?.haircareAM || d.routines?.haircarePM || d.workout?.did || (d.food && d.food.length) || d.steps || d.stepsDone || d.stepsSkip || d.water))
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

// A single day's overall "success" 0..1 across everything tracked — skin, hair,
// movement (steps/lifts), diet, water, supplements, and sleep when recorded.
// Returns null when the day has no activity at all, so the diary shows a blank
// cell (no data) rather than a zero (tracked but nothing done).
function diaryScore(state, iso, profile) {
  const d = state.days?.[iso]
  if (!dayLogged(d)) return null
  // Diet, movement and sleep are the body-composition drivers → weighted 3×;
  // skin, hair, water and supplements are supporting habits → weighted 1×.
  const parts = [
    { v: skinQ(d), w: 1 },
    { v: hairQ(d), w: 1 },
    { v: moveQ(d, profile), w: 3 },
    { v: d.food?.length ? (foodScore(state, iso, profile.proteinTarget || PROTEIN_TARGET_DEFAULT) ?? 0) / 10 : 0, w: 3 },
    { v: Math.min(1, (d.water || 0) / (profile.waterTarget || 8)), w: 1 },
  ]
  const due = suppsDue(iso, state)
  const supTotal = due.amCount + due.pmCount
  if (supTotal > 0) parts.push({ v: (due.amTaken + due.pmTaken) / supTotal, w: 1 })
  const mins = d.sleep?.minutes
  if (mins) parts.push({ v: Math.min(1, mins / ((profile.sleepTargetHours || 7) * 60)), w: 3 })
  const wsum = parts.reduce((a, p) => a + p.w, 0)
  const avg = parts.reduce((a, p) => a + p.v * p.w, 0) / wsum
  return Math.max(0, Math.min(1, avg))
}

// One line in today's thread: a status glyph, the label + a one-line sub, and a
// chevron. Locked areas (skin/hair outside their window) render disabled with a
// padlock. Everything else is a button that routes on tap.
function TodayRow({ a, active, onTap }) {
  const urgent = a.attn === 'urgent', attention = a.attn === 'attention'
  if (a.locked) {
    return (
      <div aria-disabled="true" className="flex items-center gap-3 rounded-2xl border border-[#e6dfd0] bg-[#f1ede4] px-4 py-3 opacity-70">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#e0d9c9] bg-[#efece3]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#b3ac9c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-[#9c968a]">{a.label}</span>
          <span className="block text-[12px] leading-snug text-[#b3ac9c]">{a.sub}</span>
        </span>
      </div>
    )
  }
  const shell = active
    ? 'border-[#3d4a32] bg-[#eef0e6]'
    : urgent ? 'border-[#3d4a32] bg-[#e8ede0] pulse-attention'
    : attention ? 'border-[#aebb8f] bg-[#eef0e6]'
    : 'border-[#e6dfd0] bg-[#fbf9f3] hover:bg-[#f3efe6]'
  return (
    <button onClick={onTap} className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition active:scale-[0.99] ${shell}`}>
      <span className="shrink-0">
        {a.done ? (
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[#3d4a32]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f4f1e8" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </span>
        ) : a.progress != null ? (
          <ProgressRing value={a.progress} />
        ) : (
          <span className={`grid h-8 w-8 place-items-center rounded-full border-2 ${urgent || attention ? 'border-[#7d8a5f]' : 'border-[#d8d1c2]'}`} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-[#23211c]">{a.label}</span>
          {(urgent || attention) && (
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${urgent ? 'bg-[#3d4a32] text-[#f4f1e8]' : 'bg-[#dfe6cf] text-[#3d4a32]'}`}>Now</span>
          )}
        </span>
        <span className="mt-0.5 block text-[12px] leading-snug text-[#8a8474]">{a.sub}</span>
      </span>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#b8b2a2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="m9 18 6-6-6-6" /></svg>
    </button>
  )
}

// One journey row: a level badge, focus line, progress bar and the next unlock.
function JourneyRow({ j, onOpen }) {
  return (
    <button onClick={onOpen} className="flex items-center gap-3.5 rounded-2xl border border-[#e6dfd0] bg-[#fbf9f3] px-4 py-3.5 text-left shadow-[0_2px_10px_-8px_rgba(60,55,40,0.35)] active:scale-[0.99]">
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-[#23291f] text-center leading-none">
        <span className="text-[8px] uppercase tracking-[0.12em] text-[#9aa581]">Lvl</span>
        <span className="mt-1 font-display text-[19px] font-semibold text-[#f4f1e8]">{j.level}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[15px] font-semibold text-[#23211c]">{j.name}</p>
          {j.locked && <span className="rounded-full bg-[#eef0e6] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#7d8a5f]">Build the habit</span>}
        </div>
        <p className="mt-0.5 text-[12px] leading-snug text-[#8a8474]">{j.focus}</p>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#e5e0d2]">
          <div className="h-full rounded-full bg-[#3d4a32]" style={{ width: `${j.pct}%` }} />
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-[#9aa581]">{j.nextLine}</p>
      </div>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#b8b2a2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="m9 18 6-6-6-6" /></svg>
    </button>
  )
}

// Small inline glyphs for the journey-page tool rows.
const TI = {
  skin: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2s6 6 6 11a6 6 0 0 1-12 0c0-5 6-11 6-11z" /></svg>,
  products: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="9" width="12" height="12" rx="2" /><path d="M9 9V5a3 3 0 0 1 6 0v4" /></svg>,
  supps: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7z" /><path d="m8.5 8.5 7 7" /></svg>,
  bodyfat: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></svg>,
  lifts: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V6a2 2 0 0 1 2-2 2 2 0 0 1 2 2v12a2 2 0 0 0 2 2 2 2 0 0 0 2-2V6a2 2 0 0 1 2-2 2 2 0 0 1 2 2v3" /><path d="M3 10v4M21 10v4" /></svg>,
  recipes: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2h13l5 5v15H3z" /><path d="M16 2v5h5M8 13h8M8 17h8M8 9h2" /></svg>,
  groceries: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h2l2.4 12.3a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L22 7H6" /><circle cx="9" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></svg>,
  photos: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></svg>,
  sleep: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>,
}

// Build the tool list a journey page shows. Each entry triggers a home-level
// overlay (they stack above the page), so this is where the moved-off tools live.
function journeyTools(key, h) {
  if (key === 'skin') return [
    { label: 'Start today’s routine', sub: h.skinSlot === 'pm' ? 'Evening steps' : 'Morning steps', icon: TI.skin, onTap: h.onStartSkin },
    { label: 'Manage products', sub: 'What you own drives the plan', icon: TI.products, onTap: h.onProducts },
    { label: 'Supplements', sub: 'Need-based, not just spend', icon: TI.supps, onTap: h.onSupps },
  ]
  if (key === 'lean') return [
    { label: h.latestBf ? 'Re-estimate body fat' : 'Estimate body fat', sub: 'Tape-measure consensus', icon: TI.bodyfat, onTap: h.onEstimate },
    { label: 'Your lifts', sub: 'Goals and personal records', icon: TI.lifts, onTap: h.onLifts },
    { label: 'Progress photos', sub: 'Track the change · make a before/after', icon: TI.photos, onTap: h.onPhotos },
    { label: 'Recipes', sub: 'High-protein, built for you', icon: TI.recipes, onTap: h.onRecipes },
    { label: 'Groceries', sub: h.low ? `${h.low} running low` : 'Pantry and shopping list', icon: TI.groceries, onTap: h.onGroceries },
  ]
  if (key === 'sleep') return [
    { label: 'Correct last night', sub: 'Fix bed and wake times', icon: TI.sleep, onTap: h.onSleep },
  ]
  return []
}

function GoalsSection({ state, profile, today, onOpenJourney, onEstimate, onManageSupps }) {
  const log = state.bodyFatLog || []
  const latest = log[log.length - 1]
  const target = profile.bodyFatTarget || 12
  const journeys = journeysFor(state, today, profile)
  const suppsLeft = (() => { const due = suppsDue(today, state); return (due.amCount - due.amTaken) + (due.pmCount - due.pmTaken) })()

  return (
    <section className="mt-6">
      <h2 className="mb-3 font-display text-xl font-semibold text-[#23211c]">Your journeys</h2>
      <div className="flex flex-col gap-2.5">
        {journeys.map((j) => <JourneyRow key={j.key} j={j} onOpen={() => onOpenJourney(j.key)} />)}
      </div>

      {/* Body fat + supplements — quick log actions */}
      <div className="mt-3 flex items-center justify-between gap-3 rounded-3xl border border-[#e6dfd0] bg-[#fbf9f3] p-4">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-[#23211c]">Body fat {latest ? `${latest.pct}%` : '—'}<span className="font-normal text-[#8a8474]"> · {target}% goal</span></p>
          <p className="text-[12px] text-[#8a8474]">{suppsLeft > 0 ? `${suppsLeft} supplement${suppsLeft > 1 ? 's' : ''} left today` : 'Supplements taken'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {onManageSupps && <button onClick={onManageSupps} className="text-[12px] font-medium text-[#3d4a32] active:opacity-70">Supplements</button>}
          <button onClick={onEstimate} className="rounded-full bg-[#3d4a32] px-3.5 py-1.5 text-[12px] font-semibold text-[#f4f1e8] active:scale-95">
            {latest ? 'Re-estimate' : 'Estimate BF'}
          </button>
        </div>
      </div>
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
  const move = trained || stepsHit(d, profile.stepTarget || 10000)
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
  if (!(trained || stepsHit(d, profile.stepTarget || 10000))) gaps.push('movement')
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
