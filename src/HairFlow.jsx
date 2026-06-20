import { useEffect, useMemo, useRef, useState } from 'react'
import { hairPlanForDay, HAIR_PRODUCTS } from './hair'

/* ---------- guided hair routine: full-screen, story-style ---------------------
 * One step per card; tap edges to browse; Done/Skip log the step and advance.
 * Steps with a `hold` (scalp massages, treatments) get a countdown timer.
 *   slot: 'am' | 'pm'; dateIso: today's ISO; state: full app state (read-only)
 *   onComplete(slot, log) · onClose() · onManage()
 * --------------------------------------------------------------------------- */
export default function HairFlow({ slot, dateIso, state, onComplete, onClose, onManage }) {
  const steps = useMemo(() => hairPlanForDay(dateIso, state)[slot], [dateIso, state, slot])
  const [i, setI] = useState(0)
  const [marks, setMarks] = useState({})
  const [anim, setAnim] = useState('in')
  const [closing, setClosing] = useState(null)
  const title = slot === 'am' ? 'Morning hair' : 'Evening hair'
  const total = steps.length

  const requestClose = () => { if (closing) return; setClosing('close'); setTimeout(onClose, 240) }
  const requestFinish = () => {
    if (closing) return
    setClosing('finish')
    setTimeout(() => onComplete(slot, { steps: marks, ts: Date.now() }), 240)
  }

  const cardAnim = anim === 'skip' ? 'sk-skip' : anim === 'back' ? 'sk-back' : 'sk-advance'
  const nav = (dir) => {
    const next = Math.min(total, Math.max(0, i + dir))
    if (next === i) return
    setAnim(dir > 0 ? 'done' : 'back'); setI(next)
  }
  const advance = (mark) => {
    setMarks((m) => ({ ...m, [steps[i].id]: mark }))
    setAnim(mark === 'done' ? 'done' : 'skip'); setI((n) => n + 1)
  }

  if (!steps.length) {
    return (
      <Takeover onClose={requestClose} closing={closing}>
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center fade-in">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#9aa581]">{title}</p>
          <h2 className="font-display mt-3 text-[28px] font-semibold leading-tight text-[#f4f1e8]">Nothing scheduled now</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-[#cfccba]">Your {slot === 'am' ? 'morning' : 'evening'} hair routine is clear for today.</p>
          {onManage && <button onClick={onManage} className="mt-7 rounded-full bg-[#3d4a32] px-6 py-3 text-sm font-semibold text-[#f4f1e8]">What I'll need</button>}
        </div>
      </Takeover>
    )
  }

  const onLast = i >= total
  if (onLast) {
    return (
      <Takeover onClose={requestClose} closing={closing}>
        <ProgressBar steps={steps} i={i} title={title} total={total} />
        <div key="done" className={`relative flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center ${cardAnim}`}>
          <EdgeTap side="left" onTap={() => nav(-1)} />
          <div className="relative z-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#9aa581]">{title}</p>
            <h2 className="font-display mt-3 text-[28px] font-semibold leading-tight text-[#f4f1e8]">{slot === 'am' ? 'Morning hair done' : 'Evening hair done'}</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[#cfccba]">{slot === 'am' ? 'Minoxidil in, scalp fed. Hands washed?' : 'Scalp tended. Consistency is what regrows hair — every single day.'}</p>
          </div>
        </div>
        <div className="shrink-0 px-6 pb-8">
          <button onClick={requestFinish} className="w-full rounded-full bg-[#3d4a32] px-6 py-3.5 text-[15px] font-semibold text-[#f4f1e8]">Done</button>
        </div>
      </Takeover>
    )
  }

  const s = steps[i]
  return (
    <Takeover onClose={requestClose} closing={closing}>
      <ProgressBar steps={steps} i={i} title={title} total={total} />
      <div key={i} className={`relative flex min-h-0 flex-1 flex-col justify-center px-8 ${cardAnim}`}>
        {i > 0 && <EdgeTap side="left" onTap={() => nav(-1)} />}
        <EdgeTap side="right" onTap={() => nav(1)} />
        <div className="relative z-0">
          {s.tag && <span className="mb-3 inline-flex w-fit rounded-full bg-[#3d4a32] px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-[#dfe4cf]">{s.tag}</span>}
          <h2 className="font-display text-[34px] font-semibold leading-[1.1] text-[#f4f1e8]">{s.title}</h2>
          <p className="mt-4 text-[16px] leading-relaxed text-[#cfccba]">{s.instruction}</p>
          {s.hold ? <HoldTimer key={s.id} seconds={s.hold} /> : null}
        </div>
      </div>
      <div className="shrink-0 px-6 pb-8">
        <button onClick={() => advance('done')} className="w-full rounded-full bg-[#3d4a32] px-6 py-3.5 text-[15px] font-semibold text-[#f4f1e8]">Done</button>
        <button onClick={() => advance('skipped')} className="mt-2 w-full rounded-full px-6 py-3 text-[14px] font-medium text-[#9aa581]">Skip</button>
      </div>
    </Takeover>
  )
}

// Countdown for timed steps (massages, treatments). Start it, it counts down.
function HoldTimer({ seconds }) {
  const [left, setLeft] = useState(seconds)
  const [running, setRunning] = useState(false)
  const ref = useRef(null)
  useEffect(() => () => clearInterval(ref.current), [])
  const start = () => {
    if (running) return
    setRunning(true); setLeft(seconds)
    ref.current = setInterval(() => setLeft((l) => { if (l <= 1) { clearInterval(ref.current); setRunning(false); return 0 } return l - 1 }), 1000)
  }
  const mm = String(Math.floor(left / 60)), ss = String(left % 60).padStart(2, '0')
  return (
    <div className="mt-6 flex flex-col items-center">
      <div className="font-mono text-[40px] font-semibold tabular-nums text-[#f4f1e8]">{mm}:{ss}</div>
      <button onClick={start} disabled={running}
        className={`mt-3 rounded-full px-5 py-2 text-[13px] font-semibold ${running ? 'bg-[#2c3522] text-[#6f7857]' : 'bg-[#34402a] text-[#dfe6cf]'}`}>
        {running ? 'Keep massaging…' : left === 0 ? 'Restart' : 'Start timer'}
      </button>
    </div>
  )
}

function EdgeTap({ side, onTap }) {
  return <div onClick={onTap} aria-label={side === 'left' ? 'Previous step' : 'Next step'} className={`absolute inset-y-0 z-10 w-[26%] ${side === 'left' ? 'left-0' : 'right-0'}`} />
}
function ProgressBar({ steps, i, title, total }) {
  return (
    <div className="shrink-0 px-6 pt-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.22em] text-[#9aa581]">{title}</span>
        <span className="text-[11px] tracking-wide text-[#9aa581]">{i >= total ? `${total} of ${total}` : `Step ${i + 1} of ${total}`}</span>
      </div>
      <div className="mt-3 flex gap-1.5">
        {steps.map((s, n) => <span key={s.id} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${n < i ? 'bg-[#9aa581]' : n === i ? 'bg-[#f4f1e8]' : 'bg-[#3a4230]'}`} />)}
      </div>
    </div>
  )
}
function Takeover({ children, onClose, closing }) {
  return (
    <div className={`fixed inset-x-0 top-0 z-50 flex h-[100dvh] flex-col overflow-hidden overscroll-none bg-[#23291f] ${closing ? 'sk-takeover-out' : 'sk-takeover-in'}`}>
      <div className="flex shrink-0 justify-end px-5 pt-5">
        <button onClick={onClose} className="rounded-full px-3 py-1.5 text-[13px] font-medium text-[#9aa581]">Not now</button>
      </div>
      <div className="mx-auto flex w-full min-h-0 max-w-xl flex-1 flex-col">{children}</div>
    </div>
  )
}
