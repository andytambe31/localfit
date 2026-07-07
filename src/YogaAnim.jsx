import { useEffect, useRef } from 'react'
import { FIGURES } from './yogaPoses'

/* ---------- yoga animations: pose figure + breath orb ------------------------
 * Both draw to the DOM directly from a requestAnimationFrame loop (refs, not
 * state) so they animate at 60fps without re-rendering React. Both respect
 * prefers-reduced-motion: the figure freezes mid-pose, the orb stops pulsing
 * but keeps its written breath cue.
 * -------------------------------------------------------------------------- */

const prefersReduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (t) => t * t * (3 - 2 * t) // smoothstep ease

// Interpolate two joint sets → merged {key:[x,y]} at fraction t.
function mix(A, B, t) {
  const out = {}
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const a = A[k] || B[k], b = B[k] || A[k]
    out[k] = [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]
  }
  return out
}
const line = (...pts) => pts.filter(Boolean).map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ')

// Animated side-profile stick figure demonstrating the pose's movement.
export function PoseFigure({ id }) {
  const fig = FIGURES[id]
  const refs = { torso: useRef(), arm1: useRef(), arm2: useRef(), legF: useRef(), legB: useRef(), neck: useRef(), head: useRef() }
  const raf = useRef()
  useEffect(() => {
    if (!fig) return
    const A = { ...fig.base, ...fig.a }, B = { ...fig.base, ...fig.b }
    const paint = (t) => {
      const J = mix(A, B, t)
      const set = (ref, d) => ref.current && ref.current.setAttribute('d', d || '')
      set(refs.torso, J.hip && J.sh ? (J.S ? `M ${J.hip[0]} ${J.hip[1]} Q ${J.S[0]} ${J.S[1]} ${J.sh[0]} ${J.sh[1]}` : line(J.hip, J.sh)) : '')
      set(refs.arm1, J.sh && J.E && J.Ha ? line(J.sh, J.E, J.Ha) : '')
      set(refs.arm2, J.sh && J.E2 && J.Ha2 ? line(J.sh, J.E2, J.Ha2) : '')
      set(refs.legF, J.hip && J.K && J.F ? line(J.hip, J.K, J.F) : '')
      set(refs.legB, J.hip && J.KB && J.FB ? line(J.hip, J.KB, J.FB) : '')
      set(refs.neck, J.sh && J.H ? line(J.sh, J.H) : '')
      if (refs.head.current) {
        if (J.H) { refs.head.current.setAttribute('cx', J.H[0]); refs.head.current.setAttribute('cy', J.H[1]); refs.head.current.setAttribute('r', 8) }
        else refs.head.current.setAttribute('r', 0)
      }
    }
    if (prefersReduced()) { paint(1); return }
    const dur = fig.loopMs || 3000
    let start
    const tick = (now) => {
      if (start == null) start = now
      const phase = ((now - start) % (dur * 2)) / dur // 0..2 triangle
      paint(smooth(phase <= 1 ? phase : 2 - phase))
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [id])
  if (!fig) return null
  const S = { fill: 'none', stroke: '#cfd6bd', strokeWidth: 4.6, strokeLinecap: 'round', strokeLinejoin: 'round' }
  return (
    <svg viewBox="0 0 200 152" className="mx-auto block h-[132px] w-full max-w-[280px]" role="img" aria-label="Pose demonstration">
      <line x1="18" y1="146" x2="182" y2="146" stroke="#3a4230" strokeWidth="2.5" strokeLinecap="round" />
      <path ref={refs.legB} {...S} />
      <path ref={refs.arm2} {...S} />
      <path ref={refs.torso} {...S} />
      <path ref={refs.legF} {...S} />
      <path ref={refs.arm1} {...S} />
      <path ref={refs.neck} {...S} />
      <circle ref={refs.head} {...S} fill="#2b3324" />
    </svg>
  )
}

const PHASE = [['Inhale', 0], ['Hold', 1], ['Exhale', 2], ['Rest', 3]]

// Expanding-orb breath pacer. pattern = [inhale, holdFull, exhale, holdEmpty] sec.
// Grows on the inhale, holds full, shrinks on the exhale — with a live label and
// per-phase countdown so a beginner knows exactly when to breathe.
export function BreathOrb({ pattern }) {
  const [inh, hf, exh, he] = pattern
  const cycle = inh + hf + exh + he
  const orb = useRef(), label = useRef(), count = useRef()
  const raf = useRef()
  useEffect(() => {
    const MIN = 0.5, MAX = 1
    const apply = (scale, text, n) => {
      if (orb.current) orb.current.style.transform = `scale(${scale})`
      if (label.current && label.current.textContent !== text) label.current.textContent = text
      const c = n > 0 ? String(n) : ''
      if (count.current && count.current.textContent !== c) count.current.textContent = c
    }
    if (prefersReduced()) { apply((MIN + MAX) / 2, 'Breathe', 0); return }
    let start
    const tick = (now) => {
      if (start == null) start = now
      let tt = ((now - start) / 1000) % cycle
      let scale = MIN, text = 'Inhale', rem = 0
      if (tt < inh) { const p = tt / inh; scale = lerp(MIN, MAX, smooth(p)); text = 'Inhale'; rem = inh - tt }
      else if (tt < inh + hf) { scale = MAX; text = 'Hold'; rem = inh + hf - tt }
      else if (tt < inh + hf + exh) { const p = (tt - inh - hf) / exh; scale = lerp(MAX, MIN, smooth(p)); text = 'Exhale'; rem = inh + hf + exh - tt }
      else { scale = MIN; text = 'Rest'; rem = cycle - tt }
      apply(scale, text, Math.ceil(rem))
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [inh, hf, exh, he])
  return (
    <div className="relative mx-auto grid h-[116px] w-[116px] place-items-center">
      <div ref={orb} className="absolute h-[116px] w-[116px] rounded-full border-2 border-[#7d8a5f] bg-[#2f3826]" style={{ transform: 'scale(0.5)', transformOrigin: 'center', willChange: 'transform' }} />
      <div className="relative text-center">
        <div ref={label} className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#dfe6cf]">Inhale</div>
        <div ref={count} className="font-mono text-[22px] font-semibold tabular-nums text-[#f4f1e8]">4</div>
      </div>
    </div>
  )
}
