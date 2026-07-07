import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { SESSIONS, sessionSteps, yogaStage } from './yoga'
import { BREATH_DEFAULT, BREATH_PATTERNS } from './yogaPoses'
import { PoseFigure, BreathOrb } from './YogaAnim'

/* ---------- guided yoga flow: full-screen takeover, one pose per card --------
 * Pick a session length, then move through each pose with its cue and a hold-
 * timer countdown; breathe through it, Done/Skip to advance. Completion logs
 * the session to today's `yoga`. Modeled on the skincare/training flows.
 *   state (read-only) · defaultSession ('mobility10'|'full30')
 *   onComplete({ done, session, poses, minutes, ts }) · onClose()
 */
export default function YogaFlow({ state, defaultSession = 'mobility10', onComplete, onClose }) {
  const [sessionId, setSessionId] = useState(null)
  const [i, setI] = useState(0)                 // 0 = picker; 1..N = poses; N+1 = done
  const [marks, setMarks] = useState({})        // { [poseId]: 'done' | 'skipped' }
  const [anim, setAnim] = useState('in')
  const [closing, setClosing] = useState(null)
  const stage = yogaStage(state)

  const steps = sessionId ? sessionSteps(sessionId) : []
  const total = steps.length
  const cardAnim = anim === 'back' ? 'sk-back' : 'sk-advance'
  const go = (next, dir) => { setAnim(dir < 0 ? 'back' : 'done'); setI(next) }

  const requestClose = () => { if (closing) return; setClosing('close'); setTimeout(onClose, 240) }
  const requestFinish = () => {
    if (closing) return
    setClosing('finish')
    const done = Object.values(marks).filter((v) => v === 'done').length
    const frac = total ? done / total : 0
    const minutes = Math.max(1, Math.round((SESSIONS[sessionId]?.minutes || 10) * (0.5 + 0.5 * frac)))
    setTimeout(() => onComplete({ done: true, session: sessionId, poses: marks, minutes, ts: Date.now() }), 240)
  }

  const advance = (mark) => { setMarks((m) => ({ ...m, [steps[i - 1].id]: mark })); setAnim(mark === 'done' ? 'done' : 'skip'); setI((n) => n + 1) }

  // --- session picker --------------------------------------------------------
  if (i === 0) {
    return (
      <Takeover onClose={requestClose} closing={closing}>
        <div className="flex min-h-0 flex-1 flex-col justify-center px-8 fade-in">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#9aa581]">Mobility · {stage.week}</p>
          <h2 className="font-display mt-3 text-[32px] font-semibold leading-[1.1] text-[#f4f1e8]">Roll out the tight spots</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-[#cfccba]">{stage.note}</p>
          <div className="mt-6 space-y-3">
            {['mobility10', 'full30'].map((id) => (
              <button key={id} onClick={() => { setSessionId(id); go(1, 1) }}
                className="w-full rounded-2xl border border-[#3a4230] bg-[#2b3324] px-5 py-4 text-left active:scale-[0.99]">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-[19px] font-semibold text-[#f4f1e8]">{SESSIONS[id].label}</h3>
                  <span className="rounded-full bg-[#3d4a32] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#dfe4cf]">{sessionSteps(id).length} poses</span>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[#cfccba]">{SESSIONS[id].blurb}</p>
              </button>
            ))}
          </div>
          <p className="mt-5 text-[12px] leading-relaxed text-[#7f8a68]">Ease into every shape. Sharp or joint pain means back off — muscle-belly tension is what you want.</p>
        </div>
      </Takeover>
    )
  }

  // --- completion ------------------------------------------------------------
  if (i > total) {
    const done = Object.values(marks).filter((v) => v === 'done').length
    return (
      <Takeover onClose={requestClose} closing={closing}>
        <ProgressBar total={total} i={total} label={SESSIONS[sessionId].label} />
        <div key="done" className={`relative flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center ${cardAnim}`}>
          <EdgeTap side="left" onTap={() => go(total, -1)} />
          <div className="relative z-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#9aa581]">Session complete</p>
            <h2 className="font-display mt-3 text-[30px] font-semibold leading-tight text-[#f4f1e8]">Nervous system down-shifted</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-[#cfccba]">{done} of {total} poses held. That's recovery banked — mobility for your lifts and a calmer night's sleep.</p>
          </div>
        </div>
        <div className="shrink-0 px-6 pb-8">
          <button onClick={requestFinish} className="w-full rounded-full bg-[#3d4a32] px-6 py-3.5 text-[15px] font-semibold text-[#f4f1e8]">Log the session</button>
        </div>
      </Takeover>
    )
  }

  // --- a pose card -----------------------------------------------------------
  const pose = steps[i - 1]
  const breath = BREATH_PATTERNS[pose.id] || BREATH_DEFAULT
  const cyc = breath.reduce((a, b) => a + b, 0)
  const nBreaths = Math.max(3, Math.round((pose.holdSec || 30) / cyc))
  const holdHint = pose.kind === 'breath'
    ? `Follow the orb for ${nBreaths} rounds.`
    : `Hold for about ${nBreaths} breaths${pose.side ? ' each side' : ''}.`
  return (
    <Takeover onClose={requestClose} closing={closing}>
      <ProgressBar total={total} i={i - 1} label={SESSIONS[sessionId].label} />
      <div key={i} className={`relative flex min-h-0 flex-1 flex-col justify-center px-8 ${cardAnim}`}>
        {i > 1 && <EdgeTap side="left" onTap={() => go(i - 1, -1)} />}
        <EdgeTap side="right" onTap={() => go(i + 1, 1)} />
        <div className="relative z-0 mx-auto w-full max-w-md overflow-y-auto py-2">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full bg-[#3d4a32] px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-[#dfe4cf]">{PHASE_LABEL[pose.phase] || 'Pose'}</span>
            {pose.side && <span className="inline-flex rounded-full border border-[#3d4a32] px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-[#9aa581]">Both sides</span>}
            {pose.kind === 'breath' && <span className="inline-flex rounded-full border border-[#3d4a32] px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-[#9aa581]">Breath</span>}
          </div>
          <h2 className="font-display text-[26px] font-semibold leading-[1.1] text-[#f4f1e8]">{pose.name}</h2>
          <p className="mt-1 text-[12px] leading-snug text-[#7f8a68]">{pose.targets.join(' · ')}</p>
          {pose.kind !== 'breath' && <div className="mt-2"><PoseFigure id={pose.id} /></div>}
          <p className="mt-2 text-[14px] leading-relaxed text-[#cfccba]">{pose.cue}</p>
          <div className="mt-3"><BreathOrb pattern={breath} /></div>
          <p className="mt-2 text-center text-[12px] text-[#7f8a68]">{holdHint}</p>
        </div>
      </div>
      <div className="shrink-0 px-6 pb-8">
        <button onClick={() => advance('done')} className="w-full rounded-full bg-[#3d4a32] px-6 py-3.5 text-[15px] font-semibold text-[#f4f1e8]">{i >= total ? 'Done · finish' : 'Done'}</button>
        <button onClick={() => advance('skipped')} className="mt-2 w-full rounded-full px-6 py-3 text-[14px] font-medium text-[#9aa581]">Skip this one</button>
      </div>
    </Takeover>
  )
}

const PHASE_LABEL = { warmup: 'Warm-up', flow: 'Flow', deep: 'Deep stretch', relax: 'Relax' }

function EdgeTap({ side, onTap }) {
  return <div onClick={onTap} aria-label={side === 'left' ? 'Previous' : 'Next'} className={`absolute inset-y-0 z-10 w-[20%] ${side === 'left' ? 'left-0' : 'right-0'}`} />
}
function ProgressBar({ total, i, label }) {
  return (
    <div className="shrink-0 px-6 pt-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.22em] text-[#9aa581]">{label}</span>
        <span className="text-[11px] tracking-wide text-[#9aa581]">{i >= total ? `${total} of ${total}` : `Pose ${i + 1} of ${total}`}</span>
      </div>
      <div className="mt-3 flex gap-1">
        {Array.from({ length: total }).map((_, n) => (
          <span key={n} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${n < i ? 'bg-[#9aa581]' : n === i ? 'bg-[#f4f1e8]' : 'bg-[#3a4230]'}`} />
        ))}
      </div>
    </div>
  )
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
