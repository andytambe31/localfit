import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { FOOD_LOCS, GROUP_ORDER, groupOf } from './diet'

/* ---------- recipe builder: compose a food from existing foods ---------------
 * Pick foods you already have (snapshotting their per-serving macros), dial each
 * one's servings, and optionally add custom parts. Saves as a customizable
 * composite — every ingredient becomes an adjustable part (drop it, add servings)
 * in the quantity editor at log time. Reuses the same component/mods pipeline.
 *   initial: { name, loc, group, components[] } · editId · pantry[] (effective)
 *   onSave({ name, loc, group, components }) · onCancel()
 * -------------------------------------------------------------------------- */
let _rk = 0
const num = (v) => (v === '' || v == null ? 0 : Number(v) || 0)
const r1 = (n) => Math.round(n * 10) / 10

// An existing item's reconstructed components (per-default-amount macros) → parts
// holding per-serving macros + a servings multiplier.
const partFromComponent = (c) => {
  const s = Number(c.default) > 0 ? Number(c.default) : 1
  return {
    key: `r${_rk++}`, id: c.id, name: c.name || '', portion: c.unit || 'serving', servings: s, custom: true,
    kcal: r1((Number(c.kcal) || 0) / s), protein: r1((Number(c.protein) || 0) / s), carbs: r1((Number(c.carbs) || 0) / s),
    fat: r1((Number(c.fat) || 0) / s), fiber: r1((Number(c.fiber) || 0) / s), sugar: r1((Number(c.sugar) || 0) / s),
  }
}
const partFromFood = (f) => ({
  key: `r${_rk++}`, name: f.name, portion: f.portion || '1 serving', servings: 1, custom: false,
  kcal: f.kcal || 0, protein: f.protein || 0, carbs: f.carbs || 0, fat: f.fat || 0, fiber: f.fiber || 0, sugar: f.sugar || 0,
})
const blankPart = () => ({ key: `r${_rk++}`, name: '', portion: 'serving', servings: 1, custom: true, kcal: '', protein: '', carbs: '', fat: '', fiber: '', sugar: '' })

export default function RecipeBuilder({ initial = {}, editId = null, pantry = [], onSave, onCancel }) {
  const [name, setName] = useState(initial.name || '')
  const [loc, setLoc] = useState(initial.loc || 'home')
  const [group, setGroup] = useState(initial.group && initial.group !== 'Other' ? initial.group : 'Meals')
  const [parts, setParts] = useState(() => (initial.components || []).map(partFromComponent))
  const [picking, setPicking] = useState(false)

  const setPart = (key, patch) => setParts((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)))
  const removePart = (key) => setParts((ps) => ps.filter((p) => p.key !== key))
  const addFood = (f) => { setParts((ps) => [...ps, partFromFood(f)]); setPicking(false) }
  const bumpServings = (key, d) => setParts((ps) => ps.map((p) => (p.key === key ? { ...p, servings: Math.max(0.5, Math.round((Number(p.servings || 1) + d) * 2) / 2) } : p)))

  const total = useMemo(() => parts.reduce((a, p) => {
    const s = Number(p.servings) || 1
    return { kcal: a.kcal + num(p.kcal) * s, protein: a.protein + num(p.protein) * s, carbs: a.carbs + num(p.carbs) * s, fat: a.fat + num(p.fat) * s }
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0 }), [parts])

  const named = parts.filter((p) => p.name.trim())
  const canSave = name.trim() && named.length > 0
  const save = () => {
    if (!canSave) return
    const components = named.map((p) => {
      const s = Math.max(0.5, Number(p.servings) || 1)
      return {
        id: p.id, name: p.name.trim(), unit: p.portion || 'serving', default: s,
        kcal: num(p.kcal) * s, protein: num(p.protein) * s, carbs: num(p.carbs) * s, fat: num(p.fat) * s, fiber: num(p.fiber) * s, sugar: num(p.sugar) * s,
      }
    })
    onSave({ name: name.trim(), loc, group, components })
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#f1ede4] fade-in">
      <div className="flex shrink-0 items-center justify-between border-b border-[#e2dccd] px-5 py-4">
        <button onClick={onCancel} className="text-[14px] font-medium text-[#8a8474]">Cancel</button>
        <span className="font-display text-[16px] font-semibold text-[#23211c]">{editId ? 'Edit food' : 'New recipe'}</span>
        <button onClick={save} disabled={!canSave} className={`text-[14px] font-semibold ${canSave ? 'text-[#3d4a32]' : 'text-[#c4bdac]'}`}>Save</button>
      </div>

      <div className="mx-auto w-full max-w-xl flex-1 space-y-5 overflow-y-auto px-5 py-5 pb-40">
        <div>
          <Label>Name</Label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Berries + Greek Yogurt" autoFocus={!editId}
            className="w-full rounded-xl border border-[#ddd5c5] bg-white px-3 py-2.5 text-[15px] outline-none focus:border-[#3d4a32]" />
        </div>
        <div>
          <Label>Where</Label>
          <div className="flex flex-wrap gap-1.5">{FOOD_LOCS.map(([v, lbl]) => <Pill key={v} on={loc === v} onClick={() => setLoc(v)}>{lbl}</Pill>)}</div>
        </div>
        <div>
          <Label>Category</Label>
          <div className="flex flex-wrap gap-1.5">{GROUP_ORDER.filter((g) => g !== 'Other').map((g) => <Pill key={g} on={group === g} onClick={() => setGroup(g)}>{g}</Pill>)}</div>
        </div>

        <div>
          <Label>Ingredients — each one is adjustable when you log it</Label>
          <div className="space-y-2.5">
            {parts.map((p) => (
              <div key={p.key} className="rounded-2xl border border-[#e2dccd] bg-[#fbf9f3] p-3">
                {p.custom ? (
                  <div className="flex items-center gap-2">
                    <input value={p.name} onChange={(e) => setPart(p.key, { name: e.target.value })} placeholder="Part name"
                      className="min-w-0 flex-1 rounded-lg border border-[#ddd5c5] bg-white px-2.5 py-1.5 text-[14px] outline-none focus:border-[#3d4a32]" />
                    <button onClick={() => removePart(p.key)} aria-label="Remove" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#ece6d8] text-[#8a8474]">×</button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold text-[#23211c]">{p.name}</p>
                      <p className="text-[12px] text-[#8a8474]">{p.portion} · {Math.round(num(p.kcal) * (Number(p.servings) || 1))} cal · {r1(num(p.protein) * (Number(p.servings) || 1))}g P</p>
                    </div>
                    <button onClick={() => removePart(p.key)} aria-label="Remove" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#ece6d8] text-[#8a8474]">×</button>
                  </div>
                )}
                {p.custom && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Macro label="cal/serv" value={p.kcal} onChange={(v) => setPart(p.key, { kcal: v })} />
                    <Macro label="protein" value={p.protein} onChange={(v) => setPart(p.key, { protein: v })} />
                    <Macro label="carbs" value={p.carbs} onChange={(v) => setPart(p.key, { carbs: v })} />
                    <Macro label="fat" value={p.fat} onChange={(v) => setPart(p.key, { fat: v })} />
                    <Macro label="fiber" value={p.fiber} onChange={(v) => setPart(p.key, { fiber: v })} />
                    <Macro label="sugar" value={p.sugar} onChange={(v) => setPart(p.key, { sugar: v })} />
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[12px] text-[#8a8474]">Servings</span>
                  <button onClick={() => bumpServings(p.key, -0.5)} className="grid h-7 w-7 place-items-center rounded-full bg-[#e3ddcd] text-[#3d4a32]">−</button>
                  <span className="w-8 text-center text-[14px] font-semibold tabular-nums text-[#23211c]">{Number(p.servings) || 1}</span>
                  <button onClick={() => bumpServings(p.key, 0.5)} className="grid h-7 w-7 place-items-center rounded-full bg-[#e3ddcd] text-[#3d4a32]">+</button>
                  <div className="ml-auto flex gap-1">{[0.5, 1, 2].map((m) => <Pill key={m} small on={(Number(p.servings) || 1) === m} onClick={() => setPart(p.key, { servings: m })}>×{m}</Pill>)}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            <button onClick={() => setPicking(true)} className="text-[13px] font-medium text-[#3d4a32]">+ Add from my foods</button>
            <button onClick={() => setParts((ps) => [...ps, blankPart()])} className="text-[13px] font-medium text-[#8a8474]">+ Add a custom part</button>
          </div>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 border-t border-[#e2dccd] bg-[#f1ede4]/95 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center justify-between">
          <div className="text-[13px] text-[#6f6a5d]">
            <span className="font-semibold text-[#23211c]">{Math.round(total.kcal)} cal</span> · {r1(total.protein)}g P · {r1(total.carbs)}g C · {r1(total.fat)}g F
          </div>
          <button onClick={save} disabled={!canSave} className={`rounded-full px-5 py-2.5 text-[14px] font-semibold ${canSave ? 'bg-[#3d4a32] text-[#f4f1e8]' : 'bg-[#d8d1c2] text-[#fbf9f3]'}`}>Save food</button>
        </div>
      </div>

      {picking && <FoodPicker pantry={pantry} onPick={addFood} onClose={() => setPicking(false)} />}
    </div>,
    document.body
  )
}

// Searchable pantry picker — tap a food to drop it into the recipe at 1 serving.
function FoodPicker({ pantry, onPick, onClose }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const filtered = (pantry || []).filter((f) => !ql || f.name.toLowerCase().includes(ql))
    const groups = {}
    for (const f of filtered) (groups[groupOf(f)] ||= []).push(f)
    return GROUP_ORDER.map((g) => [g, groups[g] || []]).filter(([, fs]) => fs.length)
  }, [pantry, q])

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#f1ede4] fade-in">
      <div className="flex shrink-0 items-center gap-2 border-b border-[#e2dccd] px-4 py-3">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your foods"
          className="min-w-0 flex-1 rounded-xl border border-[#ddd5c5] bg-white px-3 py-2 text-[15px] outline-none focus:border-[#3d4a32]" />
        <button onClick={onClose} className="shrink-0 text-[14px] font-medium text-[#8a8474]">Done</button>
      </div>
      <div className="mx-auto w-full max-w-xl flex-1 overflow-y-auto px-5 py-4 pb-16">
        {list.length === 0 ? (
          <p className="mt-6 text-center text-[14px] text-[#8a8474]">No matching foods.</p>
        ) : list.map(([g, fs]) => (
          <div key={g} className="mb-4">
            <p className="mb-1.5 text-[11px] uppercase tracking-wider text-[#a39c8d]">{g}</p>
            <div className="space-y-1.5">
              {fs.map((f) => (
                <button key={f.id} onClick={() => onPick(f)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-[#e6dfd0] bg-[#fbf9f3] px-3 py-2 text-left active:scale-[0.99]">
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-medium text-[#23211c]">{f.name}</span>
                    <span className="block text-[12px] text-[#8a8474]">{f.portion} · {Math.round(f.kcal || 0)} cal · {r1(f.protein || 0)}g P</span>
                  </span>
                  <span className="shrink-0 text-[18px] leading-none text-[#3d4a32]">+</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body
  )
}

function Label({ children }) { return <p className="mb-1.5 text-[11px] uppercase tracking-wider text-[#a39c8d]">{children}</p> }
function Pill({ on, onClick, small, children }) {
  return (
    <button onClick={onClick}
      className={`rounded-full border ${small ? 'px-2.5 py-0.5 text-[12px]' : 'px-3 py-1 text-[13px]'} transition active:scale-[0.97] ${on ? 'border-[#3d4a32] bg-[#3d4a32] text-[#f4f1e8]' : 'border-[#d8d1c2] bg-[#fbf9f3] text-[#5b574c]'}`}>
      {children}
    </button>
  )
}
function Macro({ label, value, onChange }) {
  return (
    <label className="flex flex-col">
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" placeholder="0"
        className="w-full rounded-lg border border-[#ddd5c5] bg-white px-2 py-1.5 text-center text-[14px] outline-none focus:border-[#3d4a32]" />
      <span className="mt-1 text-center text-[10px] uppercase tracking-wide text-[#a39c8d]">{label}</span>
    </label>
  )
}
