import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CARDIO_TYPES, zone2, TALK_TEST } from './cardio'

/* ---------- guided Zone-2 cardio: pick a modality, hold the zone, log it ------
 * Dual-gauge intensity: a heart-rate target when you know your age, plus the
 * talk test as the always-available fallback. A stopwatch fills the minutes;
 * you can also type them if you did the work elsewhere. Logs to today's cardio.
 *   profile · onComplete({type,minutes,avgHr,rpe,done,ts}) · onSetAge(age) · onClose()
 */
export default function CardioFlow({ profile, onComplete, onSetAge, onClose }) {
  const [step, setStep] = useState(0)       // 0 = pick, 1 = session
  const [type, setType] = useState(null)
  const [age, setAge] = useState(profile.age ? String(profile.age) : '')
  const [secs, setSecs] = useState(0)
  const [running, setRunning] = useState(false)
  const [manualMin, setManualMin] = useState('')
  const [rpe, setRpe] = useState(null)       // 'easy' | 'zone2' | 'hard'
  const [avgHr, setAvgHr] = useState('')
  const [closing, setClosing] = useState(false)
  const tick = useRef(null)
  useEffect(() => () => clearInterval(tick.current), [])

  const z = zone2(age)
  const requestClose = () => { if (closing) return; setClosing(true); setTimeout(onClose, 240) }

  const startStop = () => {
    if (running) { clearInterval(tick.current); setRunning(false) }
    else { setRunning(true); tick.current = setInterval(() => setSecs((s) => s + 1), 1000) }
  }
  const minutes = manualMin !== '' ? Number(manualMin) : Math.round(secs / 60)
  const canLog = minutes > 0

  const log = () => {
    if (!canLog || closing) return
    if (age && Number(age) !== profile.age) onSetAge?.(Number(age))
    setClosing(true)
    setTimeout(() => onComplete({ type, minutes, avgHr: avgHr ? Number(avgHr) : null, rpe, done: true, ts: Date.now() }), 240)
  }

  // --- pick modality ---------------------------------------------------------
  if (step === 0) {
    return (
      <Takeover onClose={requestClose} closing={closing}>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-4 fade-in">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#9aa581]">Zone 2 · heart</p>
          <h2 className="font-display mt-3 text-[30px] font-semibold leading-[1.1] text-[#f4f1e8]">Build the engine</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-[#cfccba]">Steady, easy cardio — the base that makes your heart stronger and your recovery faster. Pick how you'll move.</p>

          <div className="mt-5 rounded-2xl border border-[#3a4230] bg-[#2b3324] px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#9aa581]">Your Zone-2 target</p>
            {z ? (
              <p className="mt-1 text-[15px] leading-snug text-[#dfe6cf]"><span className="font-display text-[22px] font-semibold text-[#f4f1e8]">{z.low}–{z.high}</span> bpm <span className="text-[#9aa581]">(cap ~{z.maf})</span></p>
            ) : (
              <div className="mt-1 flex items-center gap-2">
                <span className="text-[13px] text-[#cfccba]">Add your age for a heart-rate zone:</span>
                <input value={age} onChange={(e) => setAge(e.target.value)} inputMode="numeric" placeholder="age"
                  className="w-16 rounded-lg border border-[#3a4230] bg-[#23291f] px-2 py-1 text-center text-[14px] font-semibold text-[#f4f1e8] outline-none focus:border-[#9aa581]" />
              </div>
            )}
            <p className="mt-2 text-[12px] leading-snug text-[#9aa581]">{TALK_TEST}</p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {CARDIO_TYPES.map((t) => (
              <button key={t.id} onClick={() => { setType(t.id); setStep(1) }}
                className={`rounded-2xl border px-3.5 py-3 text-left active:scale-[0.99] ${type === t.id ? 'border-[#9aa581] bg-[#2f3826]' : 'border-[#3a4230] bg-[#2b3324]'}`}>
                <p className="font-display text-[16px] font-semibold text-[#f4f1e8]">{t.name}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-[#9aa581]">{t.note}</p>
              </button>
            ))}
          </div>
        </div>
      </Takeover>
    )
  }

  // --- session + log ---------------------------------------------------------
  const typeMeta = CARDIO_TYPES.find((t) => t.id === type)
  return (
    <Takeover onClose={requestClose} closing={closing}>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-4">
        <button onClick={() => { clearInterval(tick.current); setRunning(false); setStep(0) }} className="w-fit text-[12px] font-medium text-[#9aa581]">← change</button>
        <p className="mt-2 text-[11px] uppercase tracking-[0.22em] text-[#9aa581]">Zone 2 · {typeMeta?.name}</p>
        {z && <p className="mt-1 text-[13px] text-[#cfccba]">Hold <span className="font-semibold text-[#f4f1e8]">{z.low}–{z.high} bpm</span> — talk, don't gasp.</p>}

        <div className="mt-5 flex flex-col items-center">
          <div className="font-mono text-[58px] font-semibold tabular-nums leading-none text-[#f4f1e8]">{fmt(secs)}</div>
          <div className="mt-4 flex gap-2">
            <button onClick={startStop} className="rounded-full bg-[#3d4a32] px-6 py-2.5 text-[14px] font-semibold text-[#f4f1e8]">{running ? 'Pause' : secs ? 'Resume' : 'Start'}</button>
            {secs > 0 && !running && <button onClick={() => setSecs(0)} className="rounded-full border border-[#3a4230] px-4 py-2.5 text-[13px] font-medium text-[#9aa581]">Reset</button>}
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <Row label="Minutes">
            <input value={manualMin} onChange={(e) => setManualMin(e.target.value)} inputMode="numeric" placeholder={String(Math.round(secs / 60) || 0)}
              className="w-20 rounded-lg border border-[#3a4230] bg-[#23291f] px-2 py-1.5 text-center text-[15px] font-semibold text-[#f4f1e8] outline-none focus:border-[#9aa581]" />
          </Row>
          <Row label="Avg HR (optional)">
            <input value={avgHr} onChange={(e) => setAvgHr(e.target.value)} inputMode="numeric" placeholder="bpm"
              className="w-20 rounded-lg border border-[#3a4230] bg-[#23291f] px-2 py-1.5 text-center text-[15px] font-semibold text-[#f4f1e8] outline-none focus:border-[#9aa581]" />
          </Row>
          <div>
            <p className="mb-1.5 text-[12px] text-[#9aa581]">How did it feel?</p>
            <div className="flex gap-2">
              {[['easy', 'Too easy'], ['zone2', 'Just right'], ['hard', 'Too hard']].map(([v, label]) => (
                <button key={v} onClick={() => setRpe(v)}
                  className={`flex-1 rounded-full px-2 py-2 text-[12px] font-medium ${rpe === v ? 'bg-[#3d4a32] text-[#f4f1e8]' : 'border border-[#3a4230] text-[#9aa581]'}`}>{label}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="shrink-0 px-6 pb-8">
        <button disabled={!canLog} onClick={log} className="w-full rounded-full bg-[#3d4a32] px-6 py-3.5 text-[15px] font-semibold text-[#f4f1e8] disabled:opacity-40">Log {minutes || 0} min</button>
      </div>
    </Takeover>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-[#3a4230] bg-[#2b3324] px-4 py-2.5">
      <span className="text-[13px] text-[#cfccba]">{label}</span>
      {children}
    </div>
  )
}
function fmt(s) {
  const m = Math.floor(s / 60), ss = s % 60
  return `${m}:${String(ss).padStart(2, '0')}`
}
function Takeover({ children, onClose, closing }) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])
  return createPortal(
    <div className={`fixed inset-x-0 top-0 z-50 flex h-[100dvh] flex-col overflow-hidden overscroll-none bg-[#23291f] ${closing ? 'sk-takeover-out' : 'sk-takeover-in'}`}>
      <div className="flex shrink-0 justify-end px-5 pt-5">
        <button onClick={onClose} className="rounded-full px-3 py-1.5 text-[13px] font-medium text-[#9aa581]">Not now</button>
      </div>
      <div className="mx-auto flex w-full min-h-0 max-w-xl flex-1 flex-col">{children}</div>
    </div>,
    document.body,
  )
}
