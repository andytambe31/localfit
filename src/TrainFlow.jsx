import { useEffect, useMemo, useRef, useState } from 'react'
import { buildSession, estimateSessionMinutes } from './train'

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
export default function TrainFlow({ dateIso, state, hour = 0, minute = 0, onPersist, onClose }) {
  // Resume an in-flight session, else build a fresh plan for today.
  const existing = state.days?.[dateIso]?.workout?.session
  const resuming = existing?.status === 'active'

  const [session, setSession] = useState(() => {
    if (resuming) return existing
    return buildSession(state, dateIso) // may be a rest recommendation
  })
  const [stage, setStage] = useState(resuming ? 'session' : 'gate')
  const [closing, setClosing] = useState(false)
  const [confirmFinish, setConfirmFinish] = useState(false)

  // Mutate + persist in one shot so a crash never loses more than the last tap.
  // Persist runs alongside (not inside) the state updater to avoid cross-component
  // updates during render.
  const commit = (mut) => {
    const next = mut(JSON.parse(JSON.stringify(session)))
    setSession(next)
    onPersist?.(next)
  }

  const leave = (after) => { if (closing) return; setClosing(true); setTimeout(after, 240) }

  // The session is an ordered list of cards: warm-up → working sets → cooldown.
  const items = useMemo(() => buildItems(session), [session])
  const cursor = session.cursor || 0
  const onDone = stage === 'session' && cursor >= items.length

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
          <p className="mt-4 text-[16px] leading-relaxed text-[#cfccba]">{session.reason}</p>
          {!rest && session.emphasisReason && (
            <p className="mt-2 text-[14px] leading-relaxed text-[#9aa581]">{session.emphasisReason}</p>
          )}
          {!rest && (
            <p className="mt-5 text-[13px] text-[#8c9472]">
              {session.exercises.length} exercises · about {estimateSessionMinutes(session)} min. Once you start, you're in until you finish.
            </p>
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
              <button onClick={() => { commit((s) => { s.status = 'active'; s.startedTs = Date.now(); s.cursor = 0; return s }); setStage('session') }}
                className="w-full rounded-full bg-[#3d4a32] px-6 py-3.5 text-[15px] font-semibold text-[#f4f1e8]">Start session</button>
              <button onClick={() => leave(onClose)} className="mt-2 w-full rounded-full px-6 py-3 text-[14px] font-medium text-[#9aa581]">Not now</button>
            </>
          )}
        </div>
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
          <h2 className="font-display mt-3 text-[30px] font-semibold leading-tight text-[#f4f1e8]">Logged. Well done.</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-[#cfccba]">
            {totalSets} working sets{mins != null ? ` · ${mins} min` : ''}.{beaten > 0 ? ` You beat last time on ${beaten} lift${beaten > 1 ? 's' : ''}.` : ''}
          </p>
          <p className="mt-3 text-[13px] text-[#8c9472]">It's all saved — your numbers carry to next session.</p>
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
        <ExerciseCard ex={item.data}
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
function ExerciseCard({ ex, onPrev, onNext, onSet, onToggle, onRIR }) {
  const t = ex.target || {}
  // Reinforcement: did a completed set meet/beat the target (weight & reps)?
  const beaten = !t.first && ex.sets.some((s) => s.done && s.reps && s.reps >= (t.reps || 0) && (s.weight || 0) >= (t.weight || 0))
  const RIR = [0, 1, 2, 3, '4+']
  return (
    <Card onPrev={onPrev} onNext={onNext}>
      <div className="flex items-center gap-2">
        <Tag>{ex.muscle}</Tag>
        {ex.emphasized && <span className="rounded-full bg-[#4a5836] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#dfe6cf]">Lagging focus</span>}
        {beaten && <span className="rounded-full bg-[#3d6a32] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#e7f3df]">Beat last time</span>}
      </div>
      <h2 className="mt-2 font-display text-[28px] font-semibold leading-[1.12] text-[#f4f1e8]">{ex.name}</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-[#9aa581]">{t.note}</p>
      {ex.cue && <p className="mt-3 rounded-xl border border-[#3a4230] bg-[#272d20] px-3 py-2 text-[13px] leading-snug text-[#cfccba]"><span className="font-semibold text-[#9aa581]">Cue · </span>{ex.cue}</p>}

      <div className="mt-4 space-y-2">
        {ex.sets.map((set, i) => (
          <div key={i} className={`flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 ${set.done ? 'border-[#5b6a44] bg-[#2c3522]' : 'border-[#3a4230] bg-[#272d20]'}`}>
            <span className="w-10 shrink-0 text-[12px] uppercase tracking-wider text-[#8c9472]">Set {i + 1}</span>
            <SetInput value={set.weight} placeholder={t.weight != null ? String(t.weight) : 'lb'} unit="lb" onChange={(v) => onSet(i, 'weight', v)} />
            <SetInput value={set.reps} placeholder={t.reps != null ? String(t.reps) : 'reps'} unit="reps" onChange={(v) => onSet(i, 'reps', v)} />
            <button onClick={() => onToggle(i)} aria-label="Mark set done"
              className={`ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-full border ${set.done ? 'border-[#7d8a5f] bg-[#3d4a32]' : 'border-[#4a5238]'}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={set.done ? '#f4f1e8' : '#6f7857'} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </button>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-[#8c9472]">Type your weight and reps — the set logs itself once reps are in.</p>

      <div className="mt-3 flex items-center justify-between rounded-2xl border border-[#3a4230] bg-[#272d20] px-3 py-2">
        <span className="text-[12px] text-[#8c9472]">Reps left in the tank?</span>
        <div className="flex gap-1.5">
          {RIR.map((v, idx) => (
            <button key={idx} onClick={() => onRIR(idx)}
              className={`grid h-7 w-7 place-items-center rounded-full text-[12px] font-semibold ${ex.rir === idx ? 'bg-[#3d4a32] text-[#f4f1e8]' : 'bg-[#333b28] text-[#9aa581]'}`}>{v}</button>
          ))}
        </div>
      </div>

      <Advance onClick={onNext} label="Next exercise" />
    </Card>
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
