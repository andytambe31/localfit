import { createPortal } from 'react-dom'
import { journeysFor, JOURNEY_LADDERS } from './journeys'

/* ---------- journey detail page ---------------------------------------------
 * A full-screen page for one journey: the current level in context, the whole
 * ladder (so you can see where you're headed), and the tools that belong to
 * this journey — this is where Lifts / Recipes / Groceries live now, off the
 * home screen. It renders no modals itself; every tool button triggers a
 * home-level overlay that stacks on top, so closing it returns you here.
 * -------------------------------------------------------------------------- */
export default function JourneyView({ jkey, state, today, profile, tools, onBack }) {
  // Body-scroll lock is handled centrally by App's overlayOpen effect (journeyView
  // is in it). Locking here too would double-manage document.body.style and leave
  // the dashboard frozen after closing, so this component deliberately does not.
  const j = journeysFor(state, today, profile).find((x) => x.key === jkey)
  const ladder = JOURNEY_LADDERS[jkey] || []
  if (!j) return null

  return createPortal(
    <div className="fixed inset-0 z-40 overflow-y-auto overscroll-none bg-[#f1ede4] sk-takeover-in">
      <div className="mx-auto max-w-xl px-5 pb-20 pt-6">
        <button onClick={onBack} className="mb-5 inline-flex items-center gap-1 text-sm font-medium text-[#6f6a5d]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          Back
        </button>

        {/* Hero: name, current level, progress to next */}
        <section className="rounded-[28px] bg-[#23291f] px-6 py-7 shadow-[0_18px_40px_-24px_rgba(35,41,31,0.7)]">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-[#2b3324] text-center leading-none">
              <span className="text-[8px] uppercase tracking-[0.12em] text-[#9aa581]">Lvl</span>
              <span className="mt-1 font-display text-[19px] font-semibold text-[#f4f1e8]">{j.level}</span>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#9aa581]">Journey</p>
              <h1 className="font-display text-[24px] font-semibold leading-tight text-[#f4f1e8]">{j.name}</h1>
            </div>
          </div>
          <p className="mt-4 text-[14px] leading-relaxed text-[#cfccba]">{j.focus}</p>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#3a4230]">
            <div className="h-full rounded-full bg-[#9aa581]" style={{ width: `${j.pct}%` }} />
          </div>
          <p className="mt-2.5 text-[12px] leading-snug text-[#9aa581]">{j.nextLine}</p>
        </section>

        {/* The ladder — every level, current one marked */}
        <h2 className="mb-3 mt-7 font-display text-lg font-semibold text-[#23211c]">The path</h2>
        <ol className="flex flex-col gap-2">
          {ladder.map((lvl, i) => {
            const n = i + 1
            const stateOf = n < j.level ? 'done' : n === j.level ? 'current' : 'locked'
            return (
              <li key={n}
                className={`flex gap-3.5 rounded-2xl border px-4 py-3.5 ${stateOf === 'current' ? 'border-[#aebb8f] bg-[#eef0e6]' : 'border-[#e6dfd0] bg-[#fbf9f3]'} ${stateOf === 'locked' ? 'opacity-70' : ''}`}>
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold ${stateOf === 'done' ? 'bg-[#3d4a32] text-[#f4f1e8]' : stateOf === 'current' ? 'border-2 border-[#3d4a32] text-[#3d4a32]' : 'border border-[#d8d1c2] text-[#b3ac9c]'}`}>
                  {stateOf === 'done'
                    ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f4f1e8" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                    : n}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <p className={`text-[14px] font-semibold ${stateOf === 'locked' ? 'text-[#9c968a]' : 'text-[#23211c]'}`}>{lvl.name}</p>
                    {lvl.band && <span className="text-[11px] text-[#a39c8d]">{lvl.band}</span>}
                    {stateOf === 'current' && <span className="rounded-full bg-[#dfe6cf] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#3d4a32]">You're here</span>}
                  </div>
                  <p className="mt-1 text-[12.5px] leading-snug text-[#8a8474]">{lvl.note}</p>
                </div>
              </li>
            )
          })}
        </ol>

        {/* Tools that belong to this journey */}
        <h2 className="mb-3 mt-7 font-display text-lg font-semibold text-[#23211c]">Tools</h2>
        <div className="flex flex-col gap-2">
          {tools.map((t) => (
            <button key={t.label} onClick={t.onTap}
              className="flex items-center gap-3 rounded-2xl border border-[#e6dfd0] bg-[#fbf9f3] px-4 py-3.5 text-left transition active:scale-[0.99] hover:bg-[#f3efe6]">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#eef0e6] text-[#3d4a32]">{t.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-[#23211c]">{t.label}</span>
                {t.sub && <span className="block text-[12px] leading-snug text-[#8a8474]">{t.sub}</span>}
              </span>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#b8b2a2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
