import { useMemo, useState } from 'react'
import { planForDay } from './skincare'
import { suppPlanForDay } from './supps'

/* ---------- guided skincare flow: full-screen takeover, one step per card ----------
 * Story-style: tap the left/right edges to move between steps; Done/Skip log the
 * step and advance. "Not today" backs out without logging (no streak penalty).
 *   slot: 'am' | 'pm'; dateIso: today's ISO; state: full app state (read-only)
 *   onComplete(slot, log) · onClose() · onManage()
 */
export default function SkincareFlow({ slot, dateIso, state, onComplete, onSupps, onClose, onManage }) {
  // Skincare steps + supplement steps folded onto the same AM/PM routine. Supps
  // are logged separately (onSupps) so they never skew the skincare score.
  const suppSteps = useMemo(() => suppPlanForDay(dateIso, state)[slot], [dateIso, state, slot])
  const suppIds = useMemo(() => new Set(suppSteps.map((s) => s.id)), [suppSteps])
  const steps = useMemo(() => [...planForDay(dateIso, state)[slot], ...suppSteps], [dateIso, state, slot, suppSteps])
  const [i, setI] = useState(0)
  const [marks, setMarks] = useState({}) // { [stepId]: 'done' | 'skipped' }
  const [anim, setAnim] = useState('in') // how the current card arrived: 'in'|'done'|'skip'|'back'
  const [closing, setClosing] = useState(null) // null | 'close' | 'finish'
  const title = slot === 'am' ? 'Morning routine' : 'Evening routine'
  const total = steps.length

  // Animate the takeover out, then run the real action.
  const requestClose = () => { if (closing) return; setClosing('close'); setTimeout(onClose, 240) }
  const requestFinish = () => {
    if (closing) return
    setClosing('finish')
    setTimeout(() => {
      const skinMarks = {}, suppMarks = {}
      for (const [id, v] of Object.entries(marks)) (suppIds.has(id) ? suppMarks : skinMarks)[id] = v
      onComplete(slot, { steps: skinMarks, ts: Date.now() })
      if (suppSteps.length) onSupps?.(slot, { steps: suppMarks, ts: Date.now() })
    }, 240)
  }

  const cardAnim = anim === 'skip' ? 'sk-skip' : anim === 'back' ? 'sk-back' : 'sk-advance'

  // Browse between steps without marking — Instagram-story edge taps.
  const nav = (dir) => {
    const next = Math.min(total, Math.max(0, i + dir))
    if (next === i) return
    setAnim(dir > 0 ? 'done' : 'back')
    setI(next)
  }
  // Log this step and advance.
  const advance = (mark) => {
    setMarks((m) => ({ ...m, [steps[i].id]: mark }))
    setAnim(mark === 'done' ? 'done' : 'skip')
    setI((n) => n + 1)
  }

  // Empty state — nothing owned/unlocked for this slot yet.
  if (!steps.length) {
    return (
      <Takeover onClose={requestClose} closing={closing}>
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center fade-in">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#9aa581]">{title}</p>
          <h2 className="font-display mt-3 text-[28px] font-semibold leading-tight text-[#f4f1e8]">Nothing scheduled yet</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-[#cfccba]">Add your products and we'll build the routine around them.</p>
          <button onClick={onManage} className="mt-7 rounded-full bg-[#3d4a32] px-6 py-3 text-sm font-semibold text-[#f4f1e8]">Manage products</button>
        </div>
      </Takeover>
    )
  }

  const onLast = i >= total

  // Completion card.
  if (onLast) {
    const active = steps.find((s) => s.due === 'active')
    const support = slot === 'am'
      ? 'SPF on, you’re set for the day.'
      : active
        ? `${tag(active)} done — keep the rest gentle while it works.`
        : 'Barrier supported. Sleep does the rest.'
    return (
      <Takeover onClose={requestClose} closing={closing}>
        <ProgressBar steps={steps} i={i} title={title} total={total} />
        <div key="done" className={`relative flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center ${cardAnim}`}>
          <EdgeTap side="left" onTap={() => nav(-1)} />
          <div className="relative z-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#9aa581]">{title}</p>
            <h2 className="font-display mt-3 text-[28px] font-semibold leading-tight text-[#f4f1e8]">{slot === 'am' ? 'Morning routine complete' : 'Evening routine complete'}</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[#cfccba]">{support}</p>
          </div>
        </div>
        <div className="shrink-0 px-6 pb-8">
          <button onClick={requestFinish} className="w-full rounded-full bg-[#3d4a32] px-6 py-3.5 text-[15px] font-semibold text-[#f4f1e8]">Done</button>
        </div>
      </Takeover>
    )
  }

  const step = steps[i]
  const label = stepTag(step)

  return (
    <Takeover onClose={requestClose} closing={closing}>
      <ProgressBar steps={steps} i={i} title={title} total={total} />

      <div key={i} className={`relative flex min-h-0 flex-1 flex-col justify-center px-8 ${cardAnim}`}>
        {i > 0 && <EdgeTap side="left" onTap={() => nav(-1)} />}
        <EdgeTap side="right" onTap={() => nav(1)} />
        <div className="relative z-0">
          {label && <span className="mb-3 inline-flex w-fit rounded-full bg-[#3d4a32] px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-[#dfe4cf]">{label}</span>}
          <h2 className="font-display text-[34px] font-semibold leading-[1.1] text-[#f4f1e8]">{step.title}</h2>
          <p className="mt-4 text-[16px] leading-relaxed text-[#cfccba]">{step.instruction}</p>
        </div>
      </div>

      <div className="shrink-0 px-6 pb-8">
        <button onClick={() => advance('done')} className="w-full rounded-full bg-[#3d4a32] px-6 py-3.5 text-[15px] font-semibold text-[#f4f1e8]">Done</button>
        <button onClick={() => advance('skipped')} className="mt-2 w-full rounded-full px-6 py-3 text-[14px] font-medium text-[#9aa581]">Skip</button>
      </div>
    </Takeover>
  )
}

// Invisible tap target on a screen edge (story-style navigation).
function EdgeTap({ side, onTap }) {
  return (
    <div
      onClick={onTap}
      aria-label={side === 'left' ? 'Previous step' : 'Next step'}
      className={`absolute inset-y-0 z-10 w-[26%] ${side === 'left' ? 'left-0' : 'right-0'}`}
    />
  )
}

function ProgressBar({ steps, i, title, total }) {
  return (
    <div className="shrink-0 px-6 pt-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.22em] text-[#9aa581]">{title}</span>
        <span className="text-[11px] tracking-wide text-[#9aa581]">{i >= total ? `${total} of ${total}` : `Step ${i + 1} of ${total}`}</span>
      </div>
      <div className="mt-3 flex gap-1.5">
        {steps.map((s, n) => (
          <span key={s.id} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${n < i ? 'bg-[#9aa581]' : n === i ? 'bg-[#f4f1e8]' : 'bg-[#3a4230]'}`} />
        ))}
      </div>
    </div>
  )
}

// Olive tag text for a step, or '' for plain daily steps.
function stepTag(step) {
  if (step.tag) return step.tag
  if (step.overdue) return 'Overdue'
  if (step.id === 'bha') return 'Exfoliation night'
  if (step.id === 'retinoid') return 'Retinoid night'
  if (step.id === 'azelaic') return 'Treatment night'
  if (step.carried) return 'Carried over'
  return ''
}
function tag(step) {
  if (step.id === 'bha') return 'Exfoliation'
  if (step.id === 'retinoid') return 'Retinoid'
  if (step.id === 'azelaic') return 'Azelaic acid'
  return 'Treatment'
}

function Takeover({ children, onClose, closing }) {
  return (
    <div className={`fixed inset-x-0 top-0 z-50 flex h-[100dvh] flex-col overflow-hidden overscroll-none bg-[#23291f] ${closing ? 'sk-takeover-out' : 'sk-takeover-in'}`}>
      <div className="flex shrink-0 justify-end px-5 pt-5">
        <button onClick={onClose} className="rounded-full px-3 py-1.5 text-[13px] font-medium text-[#9aa581]">Not today</button>
      </div>
      <div className="mx-auto flex w-full min-h-0 max-w-xl flex-1 flex-col">{children}</div>
    </div>
  )
}
