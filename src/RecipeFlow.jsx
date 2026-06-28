import { useMemo, useState } from 'react'
import { RECIPES, OFFICE_LUNCH, recipeMacros, timeBucket, TIME_BUCKET_LABEL } from './recipes'
import { effectivePantry, defaultLocation } from './diet'

/* ---------- guided recipe flow: browse → cook/order → log -------------------
 * Full-screen takeover (same pattern as SkincareFlow / TrainFlow). The browse
 * list prescribes recipes for where you are; picking one opens a step-by-step
 * cook flow (or, for an office spot, a single order card). "Log this meal"
 * denormalizes the macros into the day's food log via onLog(item).
 *   state · dateIso · onLog(item) · onClose()
 * -------------------------------------------------------------------------- */
export default function RecipeFlow({ state, dateIso, onLog, onClose }) {
  const pantry = useMemo(() => effectivePantry(state), [state])
  const loc = state?.days?.[dateIso]?.foodLoc || defaultLocation(dateIso) // home | office | outside
  const [picked, setPicked] = useState(null)
  const [i, setI] = useState(0)
  const [anim, setAnim] = useState('in')
  const [closing, setClosing] = useState(null)

  // Recipes worth showing: office order-spots first on an office day, then every
  // cookable recipe — current location sorted to the top, each tagged with macros.
  const list = useMemo(() => {
    const order = loc === 'office' ? OFFICE_LUNCH : []
    const rank = (r) => (r.loc === loc ? 0 : r.loc === 'both' ? 1 : 2)
    const cook = [...RECIPES].sort((a, b) => rank(a) - rank(b))
    return [...order, ...cook].map((r) => ({ r, m: recipeMacros(r, pantry) }))
  }, [loc, pantry])

  const requestClose = () => { if (closing) return; setClosing('close'); setTimeout(onClose, 240) }

  const open = (r) => { setPicked(r); setI(0); setAnim('in') }
  const back = () => { setPicked(null); setI(0) }

  const logMeal = (r) => {
    const m = recipeMacros(r, pantry)
    onLog({ id: `recipe_${r.id}`, name: r.name, portion: r.restaurant ? r.restaurant : '1 serving', ...m })
    requestClose()
  }

  // ---- browse list --------------------------------------------------------
  if (!picked) {
    const locLabel = loc === 'office' ? 'Office' : loc === 'outside' ? 'Out' : 'Home'
    return (
      <Takeover onClose={requestClose} closing={closing} closeLabel="Close">
        <div className="shrink-0 px-6 pt-2">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#9aa581]">Recipes · {locLabel}</p>
          <h2 className="font-display mt-1 text-[26px] font-semibold leading-tight text-[#f4f1e8]">What to make</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-4 fade-in">
          <div className="flex flex-col gap-2.5">
            {list.map(({ r, m }) => (
              <button key={r.id} onClick={() => open(r)}
                className="rounded-2xl border border-[#36402c] bg-[#2a3122] px-4 py-3 text-left active:scale-[0.99]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-display text-[17px] font-semibold leading-tight text-[#f4f1e8]">{r.name}</span>
                  <span className="shrink-0 text-[13px] font-semibold text-[#dfe4cf]">{m.protein}g P</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-[#9aa581]">
                  <span>{m.kcal} cal</span><span>·</span>
                  <span>{r.restaurant ? r.restaurant : `${r.timeMin} min`}</span><span>·</span>
                  <span>{r.restaurant ? 'order' : `${TIME_BUCKET_LABEL[timeBucket(r.timeMin)].toLowerCase()} · ${r.complexity}`}</span>
                  {(r.meals || []).length ? <><span>·</span><span>{r.meals.join('/')}</span></> : null}
                </div>
              </button>
            ))}
          </div>
        </div>
      </Takeover>
    )
  }

  // ---- order card (restaurant — no cooking) -------------------------------
  if (picked.restaurant) {
    const m = recipeMacros(picked, pantry)
    return (
      <Takeover onClose={requestClose} closing={closing} onBack={back}>
        <div className="relative flex min-h-0 flex-1 flex-col justify-center px-8 fade-in">
          <span className="mb-3 inline-flex w-fit rounded-full bg-[#3d4a32] px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-[#dfe4cf]">{picked.restaurant} · {picked.address}</span>
          <h2 className="font-display text-[30px] font-semibold leading-[1.1] text-[#f4f1e8]">{picked.name.replace(/^.*— /, '')}</h2>
          <p className="mt-4 text-[16px] leading-relaxed text-[#cfccba]">{picked.order}</p>
          <p className="mt-5 text-[13px] text-[#9aa581]">{m.kcal} cal · {m.protein}g protein · {m.fiber}g fiber</p>
        </div>
        <div className="shrink-0 px-6 pb-8">
          <button onClick={() => logMeal(picked)} className="w-full rounded-full bg-[#3d4a32] px-6 py-3.5 text-[15px] font-semibold text-[#f4f1e8]">Log it</button>
        </div>
      </Takeover>
    )
  }

  // ---- cook flow: ingredients card, then one step per card ----------------
  const m = recipeMacros(picked, pantry)
  const ingNames = (picked.ingredients || []).map((ing) => {
    const it = pantry.find((p) => p.id === ing.id)
    return { name: it?.name || ing.id, qty: ing.qty }
  })
  const panels = picked.steps.length + 1 // 0 = ingredients, 1..n = steps
  const last = i >= panels - 1
  const cardAnim = anim === 'back' ? 'sk-back' : 'sk-advance'
  const nav = (d) => { const n = Math.min(panels - 1, Math.max(0, i + d)); if (n === i) return; setAnim(d > 0 ? 'fwd' : 'back'); setI(n) }

  return (
    <Takeover onClose={requestClose} closing={closing} onBack={back}>
      <ProgressBar n={panels} i={i} title={picked.name} />
      <div key={i} className={`relative flex min-h-0 flex-1 flex-col justify-center px-8 ${cardAnim}`}>
        {i > 0 && <EdgeTap side="left" onTap={() => nav(-1)} />}
        {!last && <EdgeTap side="right" onTap={() => nav(1)} />}
        <div className="relative z-0">
          {i === 0 ? (
            <>
              <span className="mb-3 inline-flex w-fit rounded-full bg-[#3d4a32] px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-[#dfe4cf]">{picked.timeMin} min · {picked.complexity}</span>
              <h2 className="font-display text-[30px] font-semibold leading-[1.1] text-[#f4f1e8]">{picked.name}</h2>
              <p className="mt-4 text-[13px] uppercase tracking-[0.18em] text-[#9aa581]">Ingredients</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {ingNames.map((g, n) => (
                  <li key={n} className="flex items-baseline justify-between text-[16px] text-[#cfccba]">
                    <span>{g.name}</span><span className="text-[#9aa581]">×{g.qty}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-[13px] text-[#9aa581]">{m.kcal} cal · {m.protein}g protein · {m.fiber}g fiber</p>
            </>
          ) : (
            <>
              <span className="mb-3 inline-flex w-fit rounded-full bg-[#3d4a32] px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-[#dfe4cf]">Step {i} of {picked.steps.length}</span>
              <h2 className="font-display text-[30px] font-semibold leading-[1.15] text-[#f4f1e8]">{picked.steps[i - 1]}</h2>
            </>
          )}
        </div>
      </div>
      <div className="shrink-0 px-6 pb-8">
        {last
          ? <button onClick={() => logMeal(picked)} className="w-full rounded-full bg-[#3d4a32] px-6 py-3.5 text-[15px] font-semibold text-[#f4f1e8]">Log this meal</button>
          : <button onClick={() => nav(1)} className="w-full rounded-full bg-[#3d4a32] px-6 py-3.5 text-[15px] font-semibold text-[#f4f1e8]">{i === 0 ? 'Start cooking' : 'Next step'}</button>}
      </div>
    </Takeover>
  )
}

function EdgeTap({ side, onTap }) {
  return <div onClick={onTap} aria-label={side === 'left' ? 'Previous' : 'Next'} className={`absolute inset-y-0 z-10 w-[26%] ${side === 'left' ? 'left-0' : 'right-0'}`} />
}

function ProgressBar({ n, i, title }) {
  return (
    <div className="shrink-0 px-6 pt-2">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-[11px] uppercase tracking-[0.22em] text-[#9aa581]">{title}</span>
        <span className="shrink-0 text-[11px] tracking-wide text-[#9aa581]">{i + 1} of {n}</span>
      </div>
      <div className="mt-3 flex gap-1.5">
        {Array.from({ length: n }).map((_, k) => (
          <span key={k} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${k < i ? 'bg-[#9aa581]' : k === i ? 'bg-[#f4f1e8]' : 'bg-[#3a4230]'}`} />
        ))}
      </div>
    </div>
  )
}

function Takeover({ children, onClose, onBack, closing, closeLabel = 'Not today' }) {
  return (
    <div className={`fixed inset-x-0 top-0 z-50 flex h-[100dvh] flex-col overflow-hidden overscroll-none bg-[#23291f] ${closing ? 'sk-takeover-out' : 'sk-takeover-in'}`}>
      <div className="flex shrink-0 items-center justify-between px-5 pt-5">
        {onBack ? <button onClick={onBack} className="rounded-full px-3 py-1.5 text-[13px] font-medium text-[#9aa581]">Back</button> : <span />}
        <button onClick={onClose} className="rounded-full px-3 py-1.5 text-[13px] font-medium text-[#9aa581]">{closeLabel}</button>
      </div>
      <div className="mx-auto flex w-full min-h-0 max-w-xl flex-1 flex-col">{children}</div>
    </div>
  )
}
