import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { FOOD_UNITS, FOOD_LOCS, GROUP_ORDER } from './diet'

/* ---------- component builder: full-screen ----------------------------------
 * Build a food out of named parts (Hummus 2 tbsp + Baguette 2 slices). Each part
 * carries the macros for the amount you usually have; the app derives per-unit so
 * the quantity editor can scale any part up or down later. The food's baseline =
 * the sum of all parts. Used both to create a new food and to edit an existing one.
 *   initial: { name, loc, group, components[] } · editId: string|null
 *   onSave({ name, loc, group, components, portion }) · onCancel()
 * -------------------------------------------------------------------------- */
let _k = 0
const keyed = (c) => ({ key: `c${_k++}`, name: '', unit: 'serving', default: '1', kcal: '', protein: '', carbs: '', fat: '', fiber: '', sugar: '', ...c })

export default function ComponentBuilder({ initial = {}, editId = null, onSave, onCancel }) {
  const [name, setName] = useState(initial.name || '')
  const [loc, setLoc] = useState(initial.loc || 'home')
  const [group, setGroup] = useState(initial.group && initial.group !== 'Other' ? initial.group : 'Meals')
  const [parts, setParts] = useState(() =>
    (initial.components && initial.components.length ? initial.components : [{}]).map(keyed))

  const num = (v) => (v === '' || v == null ? 0 : Number(v) || 0)
  const total = useMemo(() => parts.reduce((a, p) => ({
    kcal: a.kcal + num(p.kcal), protein: a.protein + num(p.protein), carbs: a.carbs + num(p.carbs),
    fat: a.fat + num(p.fat), fiber: a.fiber + num(p.fiber), sugar: a.sugar + num(p.sugar),
  }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0 }), [parts])
  const r1 = (n) => Math.round(n * 10) / 10

  const setPart = (key, patch) => setParts((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)))
  const addPart = () => setParts((ps) => [...ps, keyed({})])
  const removePart = (key) => setParts((ps) => (ps.length > 1 ? ps.filter((p) => p.key !== key) : ps))

  const named = parts.filter((p) => p.name.trim())
  const canSave = name.trim() && named.length > 0
  const save = () => {
    if (!canSave) return
    const components = named.map((p) => ({
      id: p.id, name: p.name.trim(), unit: p.unit,
      default: Math.max(1, Number(p.default) || 1),
      kcal: num(p.kcal), protein: num(p.protein), carbs: num(p.carbs), fat: num(p.fat), fiber: num(p.fiber), sugar: num(p.sugar),
    }))
    onSave({ name: name.trim(), loc, group, components })
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#f1ede4] fade-in">
      {/* header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#e2dccd] px-5 py-4">
        <button onClick={onCancel} className="text-[14px] font-medium text-[#8a8474]">Cancel</button>
        <span className="font-display text-[16px] font-semibold text-[#23211c]">{editId ? 'Edit food' : 'Build a food'}</span>
        <button onClick={save} disabled={!canSave}
          className={`text-[14px] font-semibold ${canSave ? 'text-[#3d4a32]' : 'text-[#c4bdac]'}`}>Save</button>
      </div>

      <div className="mx-auto w-full max-w-xl flex-1 space-y-5 overflow-y-auto px-5 py-5 pb-40">
        {/* name */}
        <div>
          <Label>Name</Label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hummus + Baguette" autoFocus={!editId}
            className="w-full rounded-xl border border-[#ddd5c5] bg-white px-3 py-2.5 text-[15px] outline-none focus:border-[#3d4a32]" />
        </div>

        {/* where + category */}
        <div>
          <Label>Where</Label>
          <div className="flex flex-wrap gap-1.5">
            {FOOD_LOCS.map(([v, lbl]) => <Pill key={v} on={loc === v} onClick={() => setLoc(v)}>{lbl}</Pill>)}
          </div>
        </div>
        <div>
          <Label>Category</Label>
          <div className="flex flex-wrap gap-1.5">
            {GROUP_ORDER.filter((g) => g !== 'Other').map((g) => <Pill key={g} on={group === g} onClick={() => setGroup(g)}>{g}</Pill>)}
          </div>
        </div>

        {/* parts */}
        <div>
          <Label>Parts — enter the macros for the amount you usually have</Label>
          <div className="space-y-3">
            {parts.map((p, i) => (
              <div key={p.key} className="rounded-2xl border border-[#e2dccd] bg-[#fbf9f3] p-3">
                <div className="flex items-center gap-2">
                  <input value={p.name} onChange={(e) => setPart(p.key, { name: e.target.value })} placeholder={`Part ${i + 1} (e.g. Hummus)`}
                    className="min-w-0 flex-1 rounded-lg border border-[#ddd5c5] bg-white px-2.5 py-1.5 text-[14px] outline-none focus:border-[#3d4a32]" />
                  {parts.length > 1 && (
                    <button onClick={() => removePart(p.key)} aria-label="Remove part"
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#ece6d8] text-[#8a8474]">×</button>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[12px] text-[#8a8474]">Amount</span>
                  <input value={p.default} onChange={(e) => setPart(p.key, { default: e.target.value })} inputMode="decimal" placeholder="1"
                    className="w-14 rounded-lg border border-[#ddd5c5] bg-white px-2 py-1.5 text-center text-[14px] outline-none focus:border-[#3d4a32]" />
                  <select value={p.unit} onChange={(e) => setPart(p.key, { unit: e.target.value })}
                    className="min-w-0 flex-1 rounded-lg border border-[#ddd5c5] bg-white px-2 py-1.5 text-[14px] text-[#23211c] outline-none focus:border-[#3d4a32]">
                    {FOOD_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Macro label="cal" value={p.kcal} onChange={(v) => setPart(p.key, { kcal: v })} />
                  <Macro label="protein" value={p.protein} onChange={(v) => setPart(p.key, { protein: v })} />
                  <Macro label="carbs" value={p.carbs} onChange={(v) => setPart(p.key, { carbs: v })} />
                  <Macro label="fat" value={p.fat} onChange={(v) => setPart(p.key, { fat: v })} />
                  <Macro label="fiber" value={p.fiber} onChange={(v) => setPart(p.key, { fiber: v })} />
                  <Macro label="sugar" value={p.sugar} onChange={(v) => setPart(p.key, { sugar: v })} />
                </div>
              </div>
            ))}
          </div>
          <button onClick={addPart} className="mt-3 text-[13px] font-medium text-[#3d4a32]">+ Add part</button>
        </div>
      </div>

      {/* total + save (sticky) */}
      <div className="absolute inset-x-0 bottom-0 border-t border-[#e2dccd] bg-[#f1ede4]/95 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center justify-between">
          <div className="text-[13px] text-[#6f6a5d]">
            Baseline · <span className="font-semibold text-[#23211c]">{Math.round(total.kcal)} cal</span> · {r1(total.protein)}g P · {r1(total.carbs)}g C · {r1(total.fat)}g F · {r1(total.fiber)}g fib · {r1(total.sugar)}g sug
          </div>
          <button onClick={save} disabled={!canSave}
            className={`rounded-full px-5 py-2.5 text-[14px] font-semibold ${canSave ? 'bg-[#3d4a32] text-[#f4f1e8]' : 'bg-[#d8d1c2] text-[#fbf9f3]'}`}>Save food</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function Label({ children }) {
  return <p className="mb-1.5 text-[11px] uppercase tracking-wider text-[#a39c8d]">{children}</p>
}
function Pill({ on, onClick, children }) {
  return (
    <button onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[13px] transition active:scale-[0.97] ${on ? 'border-[#3d4a32] bg-[#3d4a32] text-[#f4f1e8]' : 'border-[#d8d1c2] bg-[#fbf9f3] text-[#5b574c]'}`}>
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
