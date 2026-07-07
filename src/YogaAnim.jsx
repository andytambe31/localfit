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
// Dwell easing: holds briefly on each end so the full pose is readable before
// it morphs back — reads as a deliberate demonstration, not a constant wobble.
const dwell = (tri) => smooth(Math.min(1, Math.max(0, (tri - 0.14) / 0.72)))

const JOINT_DOTS = ['sh', 'hip', 'E', 'Ha', 'E2', 'Ha2', 'K', 'F', 'KB', 'FB']
const CONTACT = new Set(['Ha', 'Ha2', 'F', 'FB']) // hands/feet read a touch larger

// Animated side-profile figure demonstrating the pose's movement: articulated
// joints, a weightier torso, and a soft ground shadow that shifts with it.
export function PoseFigure({ id }) {
  const fig = FIGURES[id]
  const refs = { torso: useRef(), arm1: useRef(), arm2: useRef(), legF: useRef(), legB: useRef(), neck: useRef(), head: useRef(), shadow: useRef() }
  const jointRefs = useRef({})
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
        if (J.H) { refs.head.current.setAttribute('cx', J.H[0]); refs.head.current.setAttribute('cy', J.H[1]); refs.head.current.setAttribute('r', 9) }
        else refs.head.current.setAttribute('r', 0)
      }
      for (const k of JOINT_DOTS) {
        const el = jointRefs.current[k]; if (!el) continue
        if (J[k]) { el.setAttribute('cx', J[k][0]); el.setAttribute('cy', J[k][1]); el.setAttribute('r', CONTACT.has(k) ? 3.8 : 2.9) }
        else el.setAttribute('r', 0)
      }
      // Ground shadow tracks the figure's horizontal centre and shrinks as it
      // lifts (down dog, bridge) for a hint of depth.
      if (refs.shadow.current && J.hip && J.sh) {
        const cx = (J.hip[0] + J.sh[0]) / 2
        const low = Math.max(J.hip[1], J.sh[1])
        refs.shadow.current.setAttribute('cx', cx)
        refs.shadow.current.setAttribute('rx', 44 + (low - 90) * 0.25)
      }
    }
    if (prefersReduced()) { paint(1); return }
    const dur = fig.loopMs || 3000
    let start
    const tick = (now) => {
      if (start == null) start = now
      const phase = ((now - start) % (dur * 2)) / dur // 0..2 triangle
      paint(dwell(phase <= 1 ? phase : 2 - phase))
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [id])
  if (!fig) return null
  const S = { fill: 'none', stroke: '#cfd6bd', strokeLinecap: 'round', strokeLinejoin: 'round' }
  return (
    <svg viewBox="0 0 200 160" className="mx-auto block h-[144px] w-full max-w-[300px]" role="img" aria-label="Pose demonstration">
      <ellipse ref={refs.shadow} cx="100" cy="150" rx="46" ry="4.5" fill="#171c12" opacity="0.55" />
      <line x1="16" y1="147" x2="184" y2="147" stroke="#39402f" strokeWidth="2.5" strokeLinecap="round" />
      <path ref={refs.legB} {...S} strokeWidth="5" />
      <path ref={refs.arm2} {...S} strokeWidth="5" />
      <path ref={refs.torso} {...S} strokeWidth="7.5" />
      <path ref={refs.legF} {...S} strokeWidth="5" />
      <path ref={refs.arm1} {...S} strokeWidth="5" />
      <path ref={refs.neck} {...S} strokeWidth="5" />
      {JOINT_DOTS.map((k) => <circle key={k} ref={(el) => { jointRefs.current[k] = el }} r="0" fill="#e7ecd8" />)}
      <circle ref={refs.head} {...S} strokeWidth="5" fill="#2b3324" />
    </svg>
  )
}

// Expanding-orb breath pacer. pattern = [inhale, holdFull, exhale, holdEmpty] sec.
// Grows on the inhale, holds full, shrinks on the exhale — with a live label and
// per-phase countdown so a beginner knows exactly when to breathe.
export function BreathOrb({ pattern }) {
  const [inh, hf, exh, he] = pattern
  const cycle = inh + hf + exh + he
  const orb = useRef(), halo = useRef(), label = useRef(), count = useRef()
  const raf = useRef()
  useEffect(() => {
    const MIN = 0.5, MAX = 1
    const apply = (scale, text, n) => {
      if (orb.current) orb.current.style.transform = `scale(${scale})`
      if (halo.current) { halo.current.style.transform = `scale(${scale + 0.14})`; halo.current.style.opacity = String(0.15 + 0.35 * ((scale - MIN) / (MAX - MIN))) }
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
    <div className="relative mx-auto grid h-[124px] w-[124px] place-items-center">
      <div ref={halo} className="absolute h-[124px] w-[124px] rounded-full bg-[#7d8a5f]" style={{ transform: 'scale(0.5)', transformOrigin: 'center', opacity: 0.2, willChange: 'transform, opacity' }} />
      <div ref={orb} className="absolute h-[116px] w-[116px] rounded-full border-2 border-[#7d8a5f] bg-[#2f3826]" style={{ transform: 'scale(0.5)', transformOrigin: 'center', willChange: 'transform' }} />
      <div className="relative text-center">
        <div ref={label} className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#dfe6cf]">Inhale</div>
        <div ref={count} className="font-mono text-[22px] font-semibold tabular-nums text-[#f4f1e8]">4</div>
      </div>
    </div>
  )
}
