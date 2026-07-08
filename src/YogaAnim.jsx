import { useEffect, useRef, useState } from 'react'
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

// Hand-drawn pose illustrations. Each is a set of filled body parts (gradient),
// wrapped by IllusFrame which adds the outline, shadow and ground. Built one at
// a time; poses not yet hand-drawn fall back to the procedural silhouette.
const HAND_POSES = {
  // Warrior II — front-facing: oval head, neck, a trunk that tapers to the
  // waist, two arms reaching level with hands, front knee bent, back leg long.
  warrior2: (
    <>
      <path d="M100 18 C107 18 111 24 111 31 C111 39 106 44 100 44 C94 44 89 39 89 31 C89 24 93 18 100 18 Z" />
      <path d="M94 41 L106 41 L105 53 L95 53 Z" />
      <path d="M77 55 C86 49 114 49 123 55 C121 72 120 90 116 101 C108 108 92 108 84 101 C80 90 79 72 77 55 Z" />
      <path d="M82 60 C60 60 40 63 21 68 C16 69 15 74 20 75 C40 73 62 72 83 72 Z" />
      <ellipse cx="19" cy="71" rx="5.5" ry="5" />
      <path d="M118 60 C140 60 160 63 179 68 C184 69 185 74 180 75 C160 73 138 72 117 72 Z" />
      <ellipse cx="181" cy="71" rx="5.5" ry="5" />
      <path d="M88 99 C70 104 55 112 46 121 C41 126 48 131 54 127 C66 118 80 111 94 106 Z" />
      <path d="M45 119 C43 131 43 141 44 149 C45 154 54 154 55 149 C57 139 58 128 60 118 Z" />
      <ellipse cx="49" cy="150" rx="12" ry="4.5" />
      <path d="M112 99 C130 108 146 124 158 143 C162 150 170 146 167 139 C154 117 136 106 118 100 Z" />
      <ellipse cx="163" cy="150" rx="12.5" ry="4.5" />
    </>
  ),
}

// Frame + defs shared by hand-drawn poses: soft body gradient, a dilate-based
// dark outline around the whole figure, a ground shadow and floor line.
function IllusFrame({ children }) {
  return (
    <svg viewBox="0 0 200 160" className="mx-auto block h-[150px] w-full max-w-[300px]" role="img" aria-label="Pose illustration">
      <defs>
        <linearGradient id="yogaBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#eef1e3" />
          <stop offset="1" stopColor="#bcc6a2" />
        </linearGradient>
        <filter id="poseOutline" x="-15%" y="-15%" width="130%" height="130%">
          <feMorphology in="SourceAlpha" operator="dilate" radius="2.3" result="d" />
          <feFlood floodColor="#2b3324" result="c" />
          <feComposite in="c" in2="d" operator="in" result="o" />
          <feMerge><feMergeNode in="o" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <ellipse cx="100" cy="151" rx="58" ry="4.5" fill="#171c12" opacity="0.5" />
      <line x1="16" y1="148" x2="184" y2="148" stroke="#39402f" strokeWidth="2.5" strokeLinecap="round" />
      <g filter="url(#poseOutline)" fill="url(#yogaBody)">{children}</g>
    </svg>
  )
}

// Procedural silhouette fallback for poses not yet hand-drawn.
function bodyShapes(J) {
  const seg = (a, b) => (a && b ? line(a, b) : null)
  const torso = J.hip && J.sh ? (J.S ? `M ${J.hip[0]} ${J.hip[1]} Q ${J.S[0]} ${J.S[1]} ${J.sh[0]} ${J.sh[1]}` : line(J.hip, J.sh)) : null
  const neckTo = J.sh && J.H ? [lerp(J.sh[0], J.H[0], 0.55), lerp(J.sh[1], J.H[1], 0.55)] : null
  const segs = [
    [seg(J.hip, J.K), 17], [seg(J.hip, J.KB), 17],
    [seg(J.K, J.F), 10], [seg(J.KB, J.FB), 10],
    [torso, 25],
    [seg(J.sh, J.E), 13], [seg(J.sh, J.E2), 13],
    [seg(J.E, J.Ha), 8], [seg(J.E2, J.Ha2), 8],
    [J.sh && neckTo ? line(J.sh, neckTo) : null, 12],
  ].filter(([d]) => d)
  return { segs, head: J.H || null }
}

export function PoseIllustration({ id }) {
  if (HAND_POSES[id]) return <IllusFrame>{HAND_POSES[id]}</IllusFrame>
  const fig = FIGURES[id]
  if (!fig) return null
  const J = { ...fig.base, ...fig.b }
  const { segs, head } = bodyShapes(J)
  const cx = J.hip && J.sh ? (J.hip[0] + J.sh[0]) / 2 : 100
  const low = J.hip && J.sh ? Math.max(J.hip[1], J.sh[1]) : 120
  const cap = { strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }
  const Pass = ({ paint, grow }) => (
    <g stroke={paint} {...cap}>
      {segs.map(([d, w], i) => <path key={i} d={d} strokeWidth={w + grow} />)}
      {head && <ellipse cx={head[0]} cy={head[1]} rx={9 + grow / 2} ry={10.5 + grow / 2} fill={paint} stroke="none" />}
    </g>
  )
  return (
    <svg viewBox="0 0 200 160" className="mx-auto block h-[150px] w-full max-w-[300px]" role="img" aria-label="Pose illustration">
      <defs>
        <linearGradient id="yogaBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#eef1e3" />
          <stop offset="1" stopColor="#bcc6a2" />
        </linearGradient>
      </defs>
      <ellipse cx={cx} cy={150} rx={44 + (low - 90) * 0.25} ry={4.5} fill="#171c12" opacity="0.5" />
      <line x1="16" y1="147" x2="184" y2="147" stroke="#39402f" strokeWidth="2.5" strokeLinecap="round" />
      <Pass paint="#2b3324" grow={4} />
      <Pass paint="url(#yogaBody)" grow={0} />
    </svg>
  )
}

// Pose visual with a still-illustration / motion toggle. The detailed still is
// the default reference; flip to Motion to watch the movement demonstrated.
export function PoseVisual({ id }) {
  const [mode, setMode] = useState('still')
  return (
    <div>
      <div className="min-h-[150px]">{mode === 'still' ? <PoseIllustration id={id} /> : <PoseFigure id={id} />}</div>
      <div className="mt-1 flex justify-center gap-1.5">
        {[['still', 'Illustration'], ['motion', 'Motion']].map(([m, label]) => (
          <button key={m} onClick={() => setMode(m)}
            className={`rounded-full px-3 py-1 text-[11px] font-medium ${mode === m ? 'bg-[#3d4a32] text-[#f4f1e8]' : 'border border-[#3a4230] text-[#9aa581]'}`}>{label}</button>
        ))}
      </div>
    </div>
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
