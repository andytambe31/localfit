import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildSession, estimateSessionMinutes, targetFor, prefillSets, swapOptions, coachingFor, EXERCISES } from './train'
import { buildWorkoutPrompt, parseWorkoutPlan, buildAiSession } from './workoutAI'

// On resume, re-derive targets for exercises you haven't logged yet, so a session
// built before a data change / fix picks up the right pre-filled weights. Exercises
// with any logged reps are left exactly as-is.
function refreshTargets(session, state, dateIso) {
  if (!session?.exercises) return session
  const phase = session.deload || session.heavy ? { deload: session.deload, heavy: session.heavy } : null
  return {
    ...session,
    exercises: session.exercises.map((e) => {
      if (e.sets?.some((s) => s.reps != null)) return e // user already worked this lift
      const t = targetFor(state, e.id, dateIso, phase)
      return {
        ...e, target: t,
        repLow: t.repLow ?? e.repLow, repHigh: t.repHigh ?? e.repHigh,
        sets: prefillSets(state, e.id, dateIso, t, phase),
      }
    }),
  }
}

/* ---------- guided training session: full-screen, locked-in, resumable --------
 * A trainer that decides the day for you. Tap "Start session" and you're in until
 * you Finish — the session persists to storage on every change, so closing or
 * killing the app drops you right back here on reopen (App auto-mounts this when
 * today's workout.session is still 'active').
 *
 *   dateIso · state (read-only) · hour/minute
 *   onPersist(session)  — write the session to today (status active/done/abandoned)
 *   onClose()           — leave the takeover (pre-start, or after Finish)
 * --------------------------------------------------------------------------- */
export default function TrainFlow({ dateIso, state, hour = 0, minute = 0, onPersist, onSwap, swapTo, onClose, autoTailor }) {
  // Resume an in-flight session, else build a fresh plan for today.
  const existing = state.days?.[dateIso]?.workout?.session
  const resuming = existing?.status === 'active'

  const [session, setSession] = useState(() => {
    if (resuming) return refreshTargets(existing, state, dateIso)
    return buildSession(state, dateIso, swapTo ? { dayType: swapTo } : {}) // swapTo = opened pre-swapped from the card
  })
  // Opened with a card swap → owe the day it replaced (once).
  useEffect(() => { if (!resuming && swapTo && session.swappedFrom) onSwap?.(session.swappedFrom) }, [])
  const [stage, setStage] = useState(resuming ? 'session' : 'gate')
  const [closing, setClosing] = useState(false)
  const [confirmFinish, setConfirmFinish] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  // Handed off from the day plan (which just swapped the session) → open the
  // tailoring modal straight away, once, at the gate.
  useEffect(() => { if (autoTailor && !resuming) setAiOpen(true) }, [])
  // Sandbox: run a session (usually an AI-tailored one) to try it out WITHOUT it
  // ever persisting or counting. Resumed real sessions are never sandboxed.
  const [sandbox, setSandbox] = useState(false)

  // Mutate + persist in one shot so a crash never loses more than the last tap.
  // Persist runs alongside (not inside) the state updater to avoid cross-component
  // updates during render. A sandbox session lives only in local state — never saved.
  const commit = (mut) => {
    const next = mut(JSON.parse(JSON.stringify(session)))
    setSession(next)
    if (!sandbox) onPersist?.(next)
  }
  // Apply an AI-tailored session to the gate; `sb` runs it as a throwaway sandbox.
  const applyAiSession = (plan, sb) => {
    setSession(buildAiSession(state, dateIso, plan))
    setSandbox(!!sb)
    setAiOpen(false)
  }

  const leave = (after) => { if (closing) return; setClosing(true); setTimeout(after, 240) }

  // The session is an ordered list of cards: warm-up → working sets → cooldown.
  const items = useMemo(() => buildItems(session), [session])
  const cursor = session.cursor || 0
  const onDone = stage === 'session' && cursor >= items.length

  // Swap today's session to a shorter day-type (recovered muscles only). The old
  // scheduled day is owed next time (onSwap records it).
  const swaps = stage === 'gate' && session.dayType !== 'rest' ? swapOptions(state, dateIso, session.dayType) : []
  const doSwap = (dayType) => {
    const s = buildSession(state, dateIso, { dayType })
    setSession(s)
    if (s.swappedFrom) onSwap?.(s.swappedFrom)
  }

  // ---- gate: the trainer's authoritative call, one button in ----------------
  if (stage === 'gate') {
    const rest = session.dayType === 'rest'
    return (
      <Takeover closing={closing}>
        <div className="flex flex-1 flex-col justify-center px-8 fade-in">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#9aa581]">{rest ? 'Recovery' : "Today's session"}</p>
          <h2 className="font-display mt-3 text-[34px] font-semibold leading-[1.08] text-[#f4f1e8]">
            {rest ? 'Rest day' : `${session.label} day`}
          </h2>
          {!rest && session.phaseLine && (
            <div className="mt-4 rounded-2xl border border-[#3a4a2c] bg-[#2b3422] px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#9aa581]">
                {session.phaseShort}{session.totalWeeks ? ` · Week ${session.weekNumber} of ${session.totalWeeks}` : ''}
              </p>
              <p className="mt-1 text-[14px] leading-relaxed text-[#dfe6cf]">{session.phaseLine}</p>
            </div>
          )}
          <p className="mt-4 text-[16px] leading-relaxed text-[#cfccba]">{session.reason}</p>
          {!rest && session.recovery?.eased && (
            <div className="mt-4 rounded-2xl border border-[#5a4f2c] bg-[#322d1d] px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#e3d9b4]">Recovery mode</p>
              <p className="mt-1 text-[14px] leading-relaxed text-[#e3d9b4]">Sleep's been thin, so today auto-regulates — hold your weights, one less accessory set, and stop each set 2–3 reps short. This protects your progress; you'll push again once you're rested.</p>
            </div>
          )}
          {!rest && session.aiTailored && (
            <div className="mt-4 rounded-2xl border border-[#4a5836] bg-[#2c3522] px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#9aa581]">AI-tailored{sandbox ? ' · sandbox' : ''}</p>
              {session.aiFocus && <p className="mt-1 text-[14px] leading-relaxed text-[#dfe6cf]">{session.aiFocus}</p>}
              {sandbox && <p className="mt-1 text-[12px] leading-relaxed text-[#9aa581]">A test run — nothing here is saved or counted.</p>}
            </div>
          )}
          {!rest && session.emphasisReason && (
            <p className="mt-2 text-[14px] leading-relaxed text-[#9aa581]">{session.emphasisReason}</p>
          )}
          {!rest && session.coreLine && (
            <p className="mt-3 rounded-2xl border border-[#3a4a2c] bg-[#2b3422] px-4 py-3 text-[13px] leading-relaxed text-[#dfe6cf]">{session.coreLine}</p>
          )}
          {!rest && (
            <p className="mt-5 text-[13px] text-[#8c9472]">
              {session.exercises.length} exercises · about {estimateSessionMinutes(session)} min. Once you start, you're in until you finish.
            </p>
          )}
          {!rest && swaps.length > 0 && (
            <div className="mt-4">
              <p className="text-[12px] text-[#8c9472]">Less time? Swap today's session:</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {swaps.map((o) => (
                  <button key={o.dayType} onClick={() => doSwap(o.dayType)}
                    className="rounded-full border border-[#4a5238] bg-[#2c3522] px-3.5 py-1.5 text-[13px] font-medium text-[#dfe6cf] active:scale-95">
                    {o.label} · ~{o.estMin} min
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="shrink-0 px-6 pb-8">
          {rest ? (
            <>
              <button onClick={() => { const forced = buildSession(state, dateIso, { force: true }); setSession(forced) }}
                className="w-full rounded-full bg-[#3d4a32] px-6 py-3.5 text-[15px] font-semibold text-[#f4f1e8]">Train anyway</button>
              <button onClick={() => leave(onClose)} className="mt-2 w-full rounded-full px-6 py-3 text-[14px] font-medium text-[#9aa581]">Take the rest</button>
            </>
          ) : (
            <>
              <button onClick={() => setAiOpen(true)}
                className="mb-2 flex w-full items-center justify-center gap-2 rounded-full border border-[#4a5836] bg-[#2c3522] px-6 py-2.5 text-[13px] font-semibold text-[#dfe6cf] active:scale-[0.99]">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.6 4L18 8l-4 1.4L12 13l-1.6-3.6L6 8l4.4-1zM18 14l.9 2 2.1.9-2.1.9L18 20l-.9-2.2-2.1-.9 2.1-.9z" /></svg>
                {session.aiTailored ? 'Re-tailor with AI' : 'Tailor this session with AI'}
              </button>
              <button onClick={() => { commit((s) => { s.status = 'active'; s.startedTs = Date.now(); s.cursor = 0; return s }); setStage('session') }}
                className="w-full rounded-full bg-[#3d4a32] px-6 py-3.5 text-[15px] font-semibold text-[#f4f1e8]">{sandbox ? 'Start sandbox session' : 'Start session'}</button>
              <button onClick={() => leave(onClose)} className="mt-2 w-full rounded-full px-6 py-3 text-[14px] font-medium text-[#9aa581]">Not now</button>
            </>
          )}
        </div>
        {aiOpen && <WorkoutAIModal state={state} dateIso={dateIso} dayType={session.dayType} onApply={applyAiSession} onClose={() => setAiOpen(false)} />}
      </Takeover>
    )
  }

  // ---- completion -----------------------------------------------------------
  if (onDone || stage === 'done') {
    const totalSets = session.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0)
    const beaten = session.exercises.filter((e) => e.target && !e.target.first && e.sets.some((s) => s.done)).length
    const mins = session.completedTs && session.startedTs ? Math.round((session.completedTs - session.startedTs) / 60000) : null
    return (
      <Takeover closing={closing}>
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center fade-in">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#9aa581]">{session.label} complete</p>
          <h2 className="font-display mt-3 text-[30px] font-semibold leading-tight text-[#f4f1e8]">{sandbox ? 'Sandbox done.' : 'Logged. Well done.'}</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-[#cfccba]">
            {totalSets} working sets{mins != null ? ` · ${mins} min` : ''}.{beaten > 0 ? ` You beat last time on ${beaten} lift${beaten > 1 ? 's' : ''}.` : ''}
          </p>
          <p className="mt-3 text-[13px] text-[#8c9472]">{sandbox ? 'Sandbox run — nothing was saved or counted. Tailor again or start it for real when you\'re ready.' : "It's all saved — your numbers carry to next session."}</p>
        </div>
        <div className="shrink-0 px-6 pb-8">
          <button onClick={() => { commit((s) => { s.status = 'done'; s.completedTs = s.completedTs || Date.now(); return s }); leave(onClose) }}
            className="w-full rounded-full bg-[#3d4a32] px-6 py-3.5 text-[15px] font-semibold text-[#f4f1e8]">Done</button>
        </div>
      </Takeover>
    )
  }

  // ---- the locked-in session ------------------------------------------------
  const item = items[cursor]
  const goto = (i) => commit((s) => { s.cursor = Math.min(items.length, Math.max(0, i)); return s })

  return (
    <Takeover closing={closing} locked>
      <SessionHeader session={session} cursor={cursor} total={items.length}
        onFinish={() => setConfirmFinish(true)} />

      {item?.kind === 'warmup' && (
        <Card onPrev={cursor > 0 ? () => goto(cursor - 1) : null} onNext={() => goto(cursor + 1)}>
          <Tag>{item.data.cardio ? 'Warm-up · optional' : 'Warm-up'}</Tag>
          <h2 className="font-display text-[32px] font-semibold leading-[1.1] text-[#f4f1e8]">{item.data.name}</h2>
          <p className="mt-4 text-[16px] leading-relaxed text-[#cfccba]">{item.data.instruction}</p>
          <Advance onClick={() => goto(cursor + 1)} label={item.data.cardio ? 'Done / skip' : 'Done'} />
        </Card>
      )}

      {item?.kind === 'exercise' && (
        <ExerciseCard ex={item.data} effort={session.effort}
          onPrev={cursor > 0 ? () => goto(cursor - 1) : null}
          onNext={() => goto(cursor + 1)}
          onSet={(setIdx, field, value) => commit((s) => {
            const set = s.exercises[item.ref].sets[setIdx]
            set[field] = value
            set.done = set.reps != null // a set is logged once it has reps
            return s
          })}
          onToggle={(setIdx) => commit((s) => {
            const set = s.exercises[item.ref].sets[setIdx]
            set.done = !set.done
            if (set.done && set.reps == null) set.reps = s.exercises[item.ref].target?.reps ?? null
            if (set.done && set.weight == null) set.weight = s.exercises[item.ref].target?.weight ?? null
            return s
          })}
          onRIR={(v) => commit((s) => { s.exercises[item.ref].rir = v; return s })} />
      )}

      {item?.kind === 'stretch' && (
        <StretchCard stretch={item.data}
          onPrev={cursor > 0 ? () => goto(cursor - 1) : null}
          onNext={() => goto(cursor + 1)} />
      )}

      {confirmFinish && (
        <ConfirmFinish atExercise={cursor} total={items.length}
          onConfirm={() => { setConfirmFinish(false); commit((s) => { s.status = 'done'; s.completedTs = Date.now(); s.cursor = items.length; return s }) }}
          onCancel={() => setConfirmFinish(false)} />
      )}
    </Takeover>
  )
}

// The workout-tailoring round-trip: hand an LLM the full training context, get a
// session back, preview it, and run it for real or as a throwaway sandbox.
function WorkoutAIModal({ state, dateIso, dayType, onApply, onClose }) {
  const prompt = useMemo(() => buildWorkoutPrompt(state, dateIso, dayType) || '', [state, dateIso, dayType])
  const [copied, setCopied] = useState(false)
  const [paste, setPaste] = useState('')
  const parsed = useMemo(() => (paste.trim() ? parseWorkoutPlan(paste) : null), [paste])
  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])
  const copyPrompt = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(prompt)
      else { const ta = document.createElement('textarea'); ta.value = prompt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove() }
      setCopied(true); setTimeout(() => setCopied(false), 1600)
    } catch { /* ignore */ }
  }
  const nameOf = (e) => EXERCISES[e.id]?.name || e.name || e.id
  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col overflow-hidden overscroll-none bg-[#1a2016] sk-takeover-in">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col overflow-y-auto px-5 pt-6 pb-8">
        <button onClick={onClose} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-[#9aa581]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>Back
        </button>
        <h1 className="font-display text-[24px] font-semibold text-[#f4f1e8]">Tailor this session with AI</h1>
        <p className="mt-1 text-[13px] leading-snug text-[#9aa581]">Copy the prompt — it carries your last session of this type, your lagging muscles, best lifts, goals, and recovery. The AI builds today's session with the reps and weights pre-set; paste it back to run it.</p>

        <div className="mt-4 rounded-2xl border border-[#3a4a2c] bg-[#232b1c] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9aa581]">Step 1 · the prompt</p>
          <p className="mt-1 text-[12.5px] leading-snug text-[#cfccba]">It knows what you did last time and what's under-trained, so it prioritises the right things and progresses your loads.</p>
          <button onClick={copyPrompt} className="mt-2.5 w-full rounded-full bg-[#3d4a32] px-4 py-2.5 text-[13px] font-semibold text-[#f4f1e8] active:scale-[0.99]">{copied ? 'Copied!' : 'Copy the prompt'}</button>
        </div>

        <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7d8a5f]">Step 2 · paste the AI's reply</p>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={5} placeholder='Paste the reply — it ends with {"exercises":[ ... ]}'
          className="mt-2 w-full resize-y rounded-2xl border border-[#3a4230] bg-[#232b1c] px-3.5 py-3 text-[13px] text-[#f4f1e8] outline-none focus:border-[#7d8a5f]" />
        {parsed && !parsed.ok && <p className="mt-2 text-[12px] text-[#d98a6a]">{parsed.error}</p>}

        {parsed?.ok && (
          <div className="mt-3 rounded-2xl border border-[#3a4230] bg-[#232b1c] p-4">
            {parsed.plan.focus && <p className="text-[13px] leading-snug text-[#dfe6cf]"><span className="font-semibold text-[#9aa581]">Focus · </span>{parsed.plan.focus}</p>}
            <ol className="mt-2 flex flex-col gap-1.5">
              {parsed.plan.exercises.map((e, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 border-b border-[#2c3522] pb-1.5 last:border-0">
                  <span className="min-w-0 text-[13px] text-[#f4f1e8]"><span className="text-[#7d8a5f]">{i + 1}.</span> {nameOf(e)}</span>
                  <span className="shrink-0 text-[12px] tabular-nums text-[#9aa581]">{e.sets} × {e.targetReps || '—'}{e.targetWeight ? ` @ ${e.targetWeight}` : ''}</span>
                </li>
              ))}
            </ol>
            <div className="mt-3 flex gap-2">
              <button onClick={() => onApply(parsed.plan, false)} className="flex-1 rounded-full bg-[#3d4a32] px-4 py-3 text-[14px] font-semibold text-[#f4f1e8] active:scale-[0.99]">Use this session</button>
              <button onClick={() => onApply(parsed.plan, true)} className="rounded-full border border-[#4a5836] bg-[#2c3522] px-4 py-3 text-[13px] font-semibold text-[#dfe6cf] active:scale-[0.99]">Try in sandbox</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

// Flatten the session into an ordered card list with stable refs back to source.
function buildItems(session) {
  if (!session || session.dayType === 'rest') return []
  const items = []
  ;(session.warmup || []).forEach((w, i) => items.push({ kind: 'warmup', ref: i, data: w }))
  ;(session.exercises || []).forEach((e, i) => items.push({ kind: 'exercise', ref: i, data: e }))
  ;(session.cooldown || []).forEach((c, i) => items.push({ kind: 'stretch', ref: i, data: c }))
  return items
}

// ---- session header: live clock + progress + finish -------------------------
function SessionHeader({ session, cursor, total, onFinish }) {
  const [, setTick] = useState(0)
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id) }, []) // re-render each second
  const elapsed = session.startedTs ? Date.now() - session.startedTs : 0
  return (
    <div className="shrink-0 px-6 pt-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.22em] text-[#9aa581]">Session · {session.label}</span>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[13px] tabular-nums text-[#cfccba]">{fmtElapsed(elapsed)}</span>
          <button onClick={onFinish} className="rounded-full bg-[#34402a] px-3 py-1 text-[11px] font-semibold text-[#dfe6cf]">Finish</button>
        </div>
      </div>
      <div className="mt-3 flex gap-1">
        {Array.from({ length: total }).map((_, n) => (
          <span key={n} className={`h-1 flex-1 rounded-full ${n < cursor ? 'bg-[#9aa581]' : n === cursor ? 'bg-[#f4f1e8]' : 'bg-[#3a4230]'}`} />
        ))}
      </div>
    </div>
  )
}

// ---- exercise card: pre-filled target + per-set logging ---------------------
function ExerciseCard({ ex, effort, onPrev, onNext, onSet, onToggle, onRIR }) {
  const t = ex.target || {}
  const guide = coachingFor(ex.id)
  const [showGuide, setShowGuide] = useState(true)
  // Low-load guard: a weight well under the target is usually a mislog (15 for 150),
  // and a bad number poisons next session's progression target. Ask once per set;
  // "Deliberate" keeps it (deload / injury / back-off), "Clear" wipes the field.
  const [lowOk, setLowOk] = useState({}) // setIdx → acknowledged
  const isLowLoad = (set, i) => !t.first && !ex.bodyweight && (t.weight || 0) > 0 &&
    set.weight != null && set.weight > 0 && set.weight < t.weight * 0.6 && !lowOk[i]
  // Reinforcement: did a completed set meet/beat the target (weight & reps)?
  const beaten = !t.first && ex.sets.some((s) => s.done && s.reps && s.reps >= (t.reps || 0) && (s.weight || 0) >= (t.weight || 0))
  const RIR = [0, 1, 2, 3, '4+']
  return (
    <Card onPrev={onPrev} onNext={onNext}>
      <div className="flex items-center gap-2">
        <Tag>{ex.muscle}</Tag>
        {ex.focus && <span className="rounded-full bg-[#3d4a32] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#f4f1e8]">Core priority</span>}
        {ex.emphasized && <span className="rounded-full bg-[#4a5836] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#dfe6cf]">Lagging focus</span>}
        {beaten && <span className="rounded-full bg-[#3d6a32] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#e7f3df]">Beat last time</span>}
      </div>
      <h2 className="mt-2 font-display text-[28px] font-semibold leading-[1.12] text-[#f4f1e8]">{ex.name}</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-[#9aa581]">{t.note}</p>
      {ex.cue && <p className="mt-3 rounded-xl border border-[#3a4230] bg-[#272d20] px-3 py-2 text-[13px] leading-snug text-[#cfccba]"><span className="font-semibold text-[#9aa581]">Cue · </span>{ex.cue}</p>}

      {/* This week's intent — how hard to push, from the periodization block */}
      {effort && (
        <p className="mt-2 flex items-start gap-2 rounded-xl border border-[#3a4a2c] bg-[#2b3422] px-3 py-2 text-[13px] leading-snug text-[#dfe6cf]">
          <span className="mt-px shrink-0 rounded-full bg-[#3d4a32] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#dfe4cf]">{effort.short}</span>
          <span>{effort.line}</span>
        </p>
      )}

      {/* Full trainer walkthrough — expanded by default, collapsible once you know it */}
      {guide && (
        <div className="mt-3 overflow-hidden rounded-xl border border-[#3a4230] bg-[#242a1d]">
          <button onClick={() => setShowGuide((v) => !v)} className="flex w-full items-center justify-between px-3 py-2.5 text-left">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-[#9aa581]">How to perform this</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9aa581" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition ${showGuide ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
          </button>
          {showGuide && (
            <div className="space-y-3 px-3 pb-3.5 pt-0.5">
              <GuideBlock label="Set up">{guide.setup.map((s, i) => <li key={i} className="text-[13px] leading-snug text-[#cfccba]">{s}</li>)}</GuideBlock>
              <GuideBlock label="The rep" ordered>{guide.steps.map((s, i) => <li key={i} className="text-[13px] leading-snug text-[#cfccba]">{s}</li>)}</GuideBlock>
              <div className="rounded-lg bg-[#2b3422] px-2.5 py-2 text-[12.5px] leading-snug text-[#dfe6cf]"><span className="font-semibold text-[#9aa581]">Breathe · </span>{guide.breathe}</div>
              <GuideBlock label="Avoid" danger>{guide.avoid.map((s, i) => <li key={i} className="text-[13px] leading-snug text-[#cbb9a0]">{s}</li>)}</GuideBlock>
              <div className="text-[12.5px] leading-snug text-[#9aa581]"><span className="font-semibold">Feel it in · </span>{guide.feel}</div>
              {guide.cant && <div className="rounded-lg border border-[#3a4a2c] bg-[#2b3422] px-2.5 py-2 text-[12.5px] leading-snug text-[#dfe6cf]"><span className="font-semibold text-[#9aa581]">Building up · </span>{guide.cant}</div>}
            </div>
          )}
        </div>
      )}
      {ex.bodyweight && <p className="mt-2 rounded-xl border border-[#3a4a2c] bg-[#2b3422] px-3 py-2 text-[13px] leading-snug text-[#dfe6cf]"><span className="font-semibold text-[#9aa581]">Bodyweight · </span>log your reps; leave weight blank unless you clip on added plates.</p>}
      {ex.db && <p className="mt-2 rounded-xl border border-[#5a4f2c] bg-[#322d1d] px-3 py-2 text-[13px] leading-snug text-[#e3d9b4]"><span className="font-semibold">Log one dumbbell · </span>enter the weight of a single dumbbell, not both added together.</p>}

      <div className="mt-4 space-y-2">
        {ex.sets.map((set, i) => (
          <div key={i}>
            <div className={`flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 ${set.done ? 'border-[#5b6a44] bg-[#2c3522]' : 'border-[#3a4230] bg-[#272d20]'}`}>
              <span className="w-10 shrink-0 text-[12px] uppercase tracking-wider text-[#8c9472]">Set {i + 1}</span>
              <SetInput value={set.weight} placeholder={t.weight != null ? String(t.weight) : 'lb'} unit="lb" onChange={(v) => onSet(i, 'weight', v)} />
              <SetInput value={set.reps} placeholder={t.reps != null ? String(t.reps) : 'reps'} unit="reps" onChange={(v) => onSet(i, 'reps', v)} />
              <button onClick={() => onToggle(i)} aria-label="Mark set done"
                className={`ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-full border ${set.done ? 'border-[#7d8a5f] bg-[#3d4a32]' : 'border-[#4a5238]'}`}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={set.done ? '#f4f1e8' : '#6f7857'} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              </button>
            </div>
            {isLowLoad(set, i) && (
              <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-[#5a4f2c] bg-[#322d1d] px-3 py-2">
                <span className="min-w-0 flex-1 text-[12px] leading-snug text-[#e3d9b4]">{set.weight} lb is well under your usual {t.weight} — deliberate, or a mislog?</span>
                <button onClick={() => setLowOk((m) => ({ ...m, [i]: true }))} className="shrink-0 rounded-full bg-[#3d4a32] px-3 py-1 text-[11px] font-semibold text-[#f4f1e8]">Deliberate</button>
                <button onClick={() => onSet(i, 'weight', null)} className="shrink-0 rounded-full border border-[#5a4f2c] px-3 py-1 text-[11px] font-semibold text-[#e3d9b4]">Clear</button>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-[#8c9472]">Type your weight and reps — the set logs itself once reps are in.</p>

      <div className="mt-3 rounded-2xl border border-[#3a4230] bg-[#272d20] px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-[#8c9472]">Reps left in the tank?</span>
          <div className="flex gap-1.5">
            {RIR.map((v, idx) => (
              <button key={idx} onClick={() => onRIR(idx)}
                className={`grid h-7 w-7 place-items-center rounded-full text-[12px] font-semibold ${ex.rir === idx ? 'bg-[#3d4a32] text-[#f4f1e8]' : 'bg-[#333b28] text-[#9aa581]'}`}>{v}</button>
            ))}
          </div>
        </div>
        {effort && <p className="mt-1.5 text-[11px] leading-snug text-[#8c9472]">Aim for <span className="font-semibold text-[#9aa581]">{effort.rirTarget} in reserve</span> this week — that last rep should be tough but clean, not a grind.</p>}
      </div>

      <Advance onClick={onNext} label="Next exercise" />
    </Card>
  )
}

// One labelled block in the form guide: a heading + a tight list of lines.
function GuideBlock({ label, children, ordered, danger }) {
  const List = ordered ? 'ol' : 'ul'
  return (
    <div>
      <p className={`mb-1 text-[10px] font-semibold uppercase tracking-wider ${danger ? 'text-[#c99a6a]' : 'text-[#7d8a5f]'}`}>{label}</p>
      <List className={`space-y-1 ${ordered ? 'list-decimal' : 'list-disc'} pl-4 marker:text-[#5b6a44]`}>{children}</List>
    </div>
  )
}

// Tap-to-type number field for a set's weight/reps. Placeholder shows the target,
// so first-time lifts are enterable in one tap instead of dozens of stepper presses.
function SetInput({ value, placeholder, unit, onChange }) {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-1 rounded-xl border border-[#3a4230] bg-[#23291f] px-2.5 py-1.5">
      <input type="number" inputMode="decimal" value={value ?? ''} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="w-full min-w-0 bg-transparent text-center text-[15px] font-semibold text-[#f4f1e8] outline-none placeholder:font-normal placeholder:text-[#6f7857]" />
      <span className="shrink-0 text-[10px] text-[#8c9472]">{unit}</span>
    </label>
  )
}

// ---- stretch card: countdown only when the stretch must be held -------------
function StretchCard({ stretch, onPrev, onNext }) {
  const [left, setLeft] = useState(stretch.hold || 0)
  const [running, setRunning] = useState(false)
  const ref = useRef(null)
  useEffect(() => () => clearInterval(ref.current), [])
  const start = () => {
    if (running) return
    setRunning(true); setLeft(stretch.hold)
    ref.current = setInterval(() => setLeft((l) => { if (l <= 1) { clearInterval(ref.current); setRunning(false); return 0 } return l - 1 }), 1000)
  }
  return (
    <Card onPrev={onPrev} onNext={onNext}>
      <Tag>Cooldown</Tag>
      <h2 className="font-display text-[30px] font-semibold leading-[1.1] text-[#f4f1e8]">{stretch.name}</h2>
      <p className="mt-4 text-[16px] leading-relaxed text-[#cfccba]">{stretch.instruction}</p>
      {stretch.hold ? (
        <div className="mt-6 flex flex-col items-center">
          <div className="font-mono text-[44px] font-semibold tabular-nums text-[#f4f1e8]">{left}s</div>
          <button onClick={start} disabled={running}
            className={`mt-3 rounded-full px-5 py-2 text-[13px] font-semibold ${running ? 'bg-[#2c3522] text-[#6f7857]' : 'bg-[#34402a] text-[#dfe6cf]'}`}>
            {running ? 'Hold…' : left === 0 ? 'Restart' : 'Start hold'}
          </button>
        </div>
      ) : null}
      <Advance onClick={onNext} label="Done" />
    </Card>
  )
}

// ---- finish confirmation ----------------------------------------------------
function ConfirmFinish({ atExercise, total, onConfirm, onCancel }) {
  return (
    <div className="absolute inset-0 z-20 flex items-end bg-black/50 fade-in" onClick={onCancel}>
      <div className="w-full rounded-t-3xl bg-[#2b3122] p-6" onClick={(e) => e.stopPropagation()}>
        <p className="font-display text-[18px] font-semibold text-[#f4f1e8]">Finish the session?</p>
        <p className="mt-1.5 text-[14px] text-[#cfccba]">You're on card {Math.min(atExercise + 1, total)} of {total}. What you've logged is saved.</p>
        <button onClick={onConfirm} className="mt-4 w-full rounded-full bg-[#3d4a32] px-6 py-3 text-[15px] font-semibold text-[#f4f1e8]">Finish & log</button>
        <button onClick={onCancel} className="mt-2 w-full rounded-full px-6 py-2.5 text-[14px] font-medium text-[#9aa581]">Keep going</button>
      </div>
    </div>
  )
}

// ---- shared chrome ----------------------------------------------------------
function Card({ children, onPrev, onNext }) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col justify-center px-8 sk-advance">
      {onPrev && <EdgeTap side="left" onTap={onPrev} />}
      <EdgeTap side="right" onTap={onNext} />
      <div className="relative z-0 mx-auto w-full max-w-md overflow-y-auto py-2">{children}</div>
    </div>
  )
}
function Advance({ onClick, label }) {
  return (
    <button onClick={onClick} className="relative z-0 mt-6 w-full rounded-full bg-[#3d4a32] px-6 py-3 text-[14px] font-semibold text-[#f4f1e8]">{label}</button>
  )
}
function Tag({ children }) {
  return <span className="mb-3 inline-flex w-fit rounded-full bg-[#3d4a32] px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-[#dfe4cf]">{children}</span>
}
function EdgeTap({ side, onTap }) {
  return <div onClick={onTap} aria-label={side === 'left' ? 'Previous' : 'Next'} className={`absolute inset-y-0 z-10 w-[18%] ${side === 'left' ? 'left-0' : 'right-0'}`} />
}
function Takeover({ children, closing, locked }) {
  return (
    <div className={`fixed inset-x-0 top-0 z-50 flex h-[100dvh] flex-col overflow-hidden overscroll-none bg-[#23291f] ${closing ? 'sk-takeover-out' : 'sk-takeover-in'}`}>
      {!locked && <div className="h-4 shrink-0" />}
      <div className="mx-auto flex w-full min-h-0 max-w-xl flex-1 flex-col">{children}</div>
    </div>
  )
}

function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`
}
