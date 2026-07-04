import { useMemo, useState } from 'react'
import { estimateBF, estimateSkinfold, bfCategory, round1, TAPE_SITES, SKINFOLD_SITES, PINCH_TIP } from './bodyfat'

/* ---------- guided body-fat flow: full-screen takeover, one site per card ----
 * Modeled on the skincare flow. Pick a method, then step through each site with
 * exact instructions on how and where to measure; the last card computes the
 * estimate and saves it to the goal.
 *   profile: read-only, for prefills   onSave(pct, patch)   onClose()
 */
export default function BodyFatFlow({ profile, onClose, onSave }) {
  const m0 = profile.measurements || {}
  const [method, setMethod] = useState(null)          // null | 'tape' | 'skinfold'
  const [sex, setSex] = useState(profile.sex || 'male')
  const [unit, setUnit] = useState('cm')              // tape length inputs
  const [vals, setVals] = useState(() => ({
    height: profile.height ? String(round1(profile.height)) : '',
    neck: m0.neck ? String(round1(m0.neck)) : '',
    waist: m0.waist ? String(round1(m0.waist)) : '',
    hip: m0.hip ? String(round1(m0.hip)) : '',
    age: profile.age ? String(profile.age) : '',
  }))
  const [i, setI] = useState(0)                        // 0 = setup; 1..N = sites; N+1 = result
  const [anim, setAnim] = useState('in')
  const [closing, setClosing] = useState(null)

  const toCm = (v) => (unit === 'in' ? Number(v) * 2.54 : Number(v))

  // The measurement cards for the chosen method.
  const sites = useMemo(() => {
    if (method === 'tape') return TAPE_SITES.filter((s) => !s.sex || s.sex === sex)
    if (method === 'skinfold') return [
      { id: 'age', title: 'Your age', unitField: 'yr', how: 'The 3-site equation adjusts for age — it shifts the read by a point or two.', why: '' },
      ...SKINFOLD_SITES[sex],
    ]
    return []
  }, [method, sex])
  const total = sites.length

  const result = useMemo(() => {
    if (method === 'tape') return estimateBF({ sex, height: toCm(vals.height), neck: toCm(vals.neck), waist: toCm(vals.waist), hip: toCm(vals.hip) })
    if (method === 'skinfold') return estimateSkinfold({ sex, age: Number(vals.age), sites: vals })
    return null
  }, [method, sex, unit, vals])

  const requestClose = () => { if (closing) return; setClosing('close'); setTimeout(onClose, 240) }
  const requestSave = () => {
    if (closing || !result) return
    const patch = method === 'tape'
      ? { height: Math.round(toCm(vals.height)), sex, measurements: { neck: Math.round(toCm(vals.neck)), waist: Math.round(toCm(vals.waist)), hip: Math.round(toCm(vals.hip)) } }
      : { sex, age: Number(vals.age), skinfold: Object.fromEntries(SKINFOLD_SITES[sex].map((s) => [s.id, Number(vals[s.id])])) }
    setClosing('finish')
    setTimeout(() => onSave(result.best, patch), 240)
  }

  const cardAnim = anim === 'back' ? 'sk-back' : 'sk-advance'
  const go = (next, dir) => { setAnim(dir < 0 ? 'back' : 'done'); setI(next) }

  // --- setup card: method + sex ----------------------------------------------
  if (i === 0) {
    return (
      <Takeover onClose={requestClose} closing={closing}>
        <div className="flex min-h-0 flex-1 flex-col justify-center px-8 fade-in">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#9aa581]">Body fat</p>
          <h2 className="font-display mt-3 text-[32px] font-semibold leading-[1.1] text-[#f4f1e8]">Let's measure it properly</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-[#cfccba]">A few careful measurements beat a bathroom scale. Pick how you'll measure — I'll walk you through each site.</p>

          <div className="mt-6">
            <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-[#9aa581]">You are</p>
            <div className="flex gap-2">
              <SegBtn on={sex === 'male'} onClick={() => setSex('male')}>Male</SegBtn>
              <SegBtn on={sex === 'female'} onClick={() => setSex('female')}>Female</SegBtn>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <MethodCard title="Tape measure" tag="No equipment"
              body="Four measurements — height, neck, waist, hip — blended across three validated formulas. Nothing to buy."
              onClick={() => { setMethod('tape'); go(1, 1) }} />
            <MethodCard title="Skinfold caliper" tag="More precise"
              body="Pinch three sites with a cheap caliper. The gold-standard field method when you have one and a steady hand."
              onClick={() => { setMethod('skinfold'); go(1, 1) }} />
          </div>
        </div>
      </Takeover>
    )
  }

  // --- result card -----------------------------------------------------------
  if (i > total) {
    return (
      <Takeover onClose={requestClose} closing={closing}>
        <ProgressBar total={total} i={total} />
        <div key="result" className={`relative flex min-h-0 flex-1 flex-col justify-center px-8 ${cardAnim}`}>
          <EdgeTap side="left" onTap={() => go(total, -1)} />
          <div className="relative z-0 text-center">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#9aa581]">Your estimate</p>
            {result ? (
              <>
                <p className="font-display mt-4 text-[64px] font-semibold leading-none text-[#f4f1e8]">{result.best}%</p>
                <p className="mt-2 text-[15px] text-[#cfccba]">{bfCategory(result.best, sex)}{profile.bodyFatTarget ? ` · ${profile.bodyFatTarget}% goal` : ''}</p>
                <p className="mt-5 text-[13px] leading-relaxed text-[#9aa581]">
                  {method === 'tape'
                    ? `Blended read: ${Object.entries(result.breakdown).map(([k, v]) => `${k.toUpperCase()} ${v}%`).join('  ·  ')}. Re-measure monthly, same time of day.`
                    : `Sum of folds ${result.sum} mm via Jackson–Pollock. Re-measure monthly, same time of day and same sites.`}
                </p>
              </>
            ) : (
              <p className="mt-6 text-[15px] leading-relaxed text-[#cfccba]">Something's off in the numbers — tap back and check your entries.</p>
            )}
          </div>
        </div>
        <div className="shrink-0 px-6 pb-8">
          <button disabled={!result} onClick={requestSave} className="w-full rounded-full bg-[#3d4a32] px-6 py-3.5 text-[15px] font-semibold text-[#f4f1e8] disabled:opacity-40">Save to goal</button>
          <button onClick={() => go(total, -1)} className="mt-2 w-full rounded-full px-6 py-3 text-[14px] font-medium text-[#9aa581]">Adjust a measurement</button>
        </div>
      </Takeover>
    )
  }

  // --- a measurement card ----------------------------------------------------
  const site = sites[i - 1]
  const isLen = site.unitField === 'len'
  const unitLabel = isLen ? unit : site.unitField
  const raw = vals[site.id] ?? ''
  const valid = Number(raw) > 0
  const isPinch = method === 'skinfold' && site.id !== 'age'
  const setVal = (v) => setVals((s) => ({ ...s, [site.id]: v }))
  const next = () => { if (valid) go(i + 1, 1) }

  return (
    <Takeover onClose={requestClose} closing={closing}>
      <ProgressBar total={total} i={i - 1} />
      <div key={i} className={`relative flex min-h-0 flex-1 flex-col justify-center px-8 ${cardAnim}`}>
        <EdgeTap side="left" onTap={() => go(i - 1, -1)} />
        <div className="relative z-0">
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-flex w-fit rounded-full bg-[#3d4a32] px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-[#dfe4cf]">Site {i} of {total}</span>
            {isPinch && <span className="inline-flex w-fit rounded-full border border-[#3d4a32] px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-[#9aa581]">Pinch</span>}
          </div>
          <h2 className="font-display text-[34px] font-semibold leading-[1.1] text-[#f4f1e8]">{site.title}</h2>
          <p className="mt-4 text-[16px] leading-relaxed text-[#cfccba]">{site.how}</p>
          {isPinch && <p className="mt-3 text-[13px] leading-relaxed text-[#9aa581]">{PINCH_TIP}</p>}
          {site.why && <p className="mt-3 text-[12px] leading-relaxed text-[#7f8a68]">{site.why}</p>}

          <div className="mt-6 flex items-end gap-3">
            <input
              autoFocus type="number" inputMode="decimal" value={raw}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') next() }}
              placeholder="0"
              className="w-40 border-b-2 border-[#3d4a32] bg-transparent pb-1 font-display text-[44px] font-semibold text-[#f4f1e8] outline-none placeholder:text-[#3a4230] focus:border-[#9aa581]" />
            <span className="pb-3 text-[15px] text-[#9aa581]">{unitLabel}</span>
            {isLen && (
              <div className="ml-auto flex gap-1.5 pb-2">
                <UnitBtn on={unit === 'cm'} onClick={() => switchUnit('cm')}>cm</UnitBtn>
                <UnitBtn on={unit === 'in'} onClick={() => switchUnit('in')}>in</UnitBtn>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="shrink-0 px-6 pb-8">
        <button disabled={!valid} onClick={next} className="w-full rounded-full bg-[#3d4a32] px-6 py-3.5 text-[15px] font-semibold text-[#f4f1e8] disabled:opacity-40">
          {i >= total ? 'See estimate' : 'Continue'}
        </button>
      </div>
    </Takeover>
  )

  // Convert every entered length between cm/in when the unit is toggled.
  function switchUnit(u) {
    if (u === unit) return
    const conv = (x) => (x === '' ? '' : String(round1(u === 'in' ? Number(x) / 2.54 : Number(x) * 2.54)))
    setVals((s) => ({ ...s, height: conv(s.height), neck: conv(s.neck), waist: conv(s.waist), hip: conv(s.hip) }))
    setUnit(u)
  }
}

function MethodCard({ title, tag, body, onClick }) {
  return (
    <button onClick={onClick} className="w-full rounded-2xl border border-[#3a4230] bg-[#2b3324] px-5 py-4 text-left active:scale-[0.99]">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-[19px] font-semibold text-[#f4f1e8]">{title}</h3>
        <span className="rounded-full bg-[#3d4a32] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#dfe4cf]">{tag}</span>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-[#cfccba]">{body}</p>
    </button>
  )
}
function SegBtn({ on, onClick, children }) {
  return (
    <button onClick={onClick} className={`flex-1 rounded-full px-4 py-2 text-sm font-medium active:scale-95 ${on ? 'bg-[#3d4a32] text-[#f4f1e8]' : 'border border-[#3a4230] text-[#9aa581]'}`}>{children}</button>
  )
}
function UnitBtn({ on, onClick, children }) {
  return (
    <button onClick={onClick} className={`rounded-full px-3 py-1 text-[12px] font-medium ${on ? 'bg-[#3d4a32] text-[#f4f1e8]' : 'text-[#9aa581]'}`}>{children}</button>
  )
}

function EdgeTap({ side, onTap }) {
  return <div onClick={onTap} aria-label={side === 'left' ? 'Previous' : 'Next'} className={`absolute inset-y-0 z-10 w-[22%] ${side === 'left' ? 'left-0' : 'right-0'}`} />
}
function ProgressBar({ total, i }) {
  return (
    <div className="shrink-0 px-6 pt-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.22em] text-[#9aa581]">Body fat</span>
        <span className="text-[11px] tracking-wide text-[#9aa581]">{i >= total ? `${total} of ${total}` : `Step ${i + 1} of ${total}`}</span>
      </div>
      <div className="mt-3 flex gap-1.5">
        {Array.from({ length: total }).map((_, n) => (
          <span key={n} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${n < i ? 'bg-[#9aa581]' : n === i ? 'bg-[#f4f1e8]' : 'bg-[#3a4230]'}`} />
        ))}
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
