/* ---------- miss reflections (pure) -----------------------------------------
 * The app can see WHAT didn't happen (a skipped Legs day, a missed walk). It
 * can't see WHY — "I ate an hour ago and felt too full to train." That reason is
 * the most valuable data for understanding what's actually going wrong, and it's
 * exactly what an LLM is good at drawing out of a plain-language chat and handing
 * back as structure.
 *
 * `buildReflectionPrompt` produces a prompt you paste into an LLM, talk to about
 * why something slipped, and get back a small JSON object. `parseReflection`
 * reads that back into a normalized reflection the app stores on the day — and,
 * for training/steps, feeds straight into the make-up bookkeeping (owed = a
 * deferral you make up; forgiven = genuine recovery). Pure, no React, no I/O.
 * -------------------------------------------------------------------------- */

export const REFLECT_DOMAINS = {
  train: { label: 'training', thing: (planned) => (planned ? `my ${String(planned).toLowerCase()} session` : 'my workout') },
  steps: { label: 'steps', thing: () => 'my 10k steps / walk' },
  skin: { label: 'skincare', thing: () => 'my skincare routine' },
  diet: { label: 'diet', thing: () => 'eating on plan' },
  sleep: { label: 'sleep', thing: () => 'getting to bed on time' },
  other: { label: 'something', thing: () => 'something I planned' },
}

// The prompt you paste into ChatGPT/Claude, then talk to about why it slipped.
export function buildReflectionPrompt(domain, planned) {
  const d = REFLECT_DOMAINS[domain] || REFLECT_DOMAINS.other
  const thing = d.thing(planned)
  return `I'm going to tell you why I didn't do ${thing} today. Talk to me like a coach who's on my side: ask ONE brief follow-up only if my reason is vague, otherwise just capture it honestly. When you've got it, reply with ONLY this JSON — no prose, no markdown fences:
{"domain":"${domain}","happened":false,"category":"","detail":"","owed":true,"adjustment":""}

Field rules:
- category: a SHORT kebab-case tag for the core reason, e.g. "ate-too-close", "too-tired", "no-time", "busy", "sick", "injured", "low-motivation", "traveling", "poor-sleep", "work-ran-late".
- detail: one honest sentence, in my own words — the real reason.
- owed: true if this was a deferral I could reasonably make up (busy, no time, ate too close, low motivation, work ran late); false if it was genuine recovery (sick, injured, truly needed the rest).
- adjustment: one short, specific, practical thing I could do differently next time (e.g. "eat the pre-workout meal ~2h earlier on leg day"). Not a lecture.

Now ask me, or let me tell you what happened.`
}

// Tolerant JSON extraction shared with the food importers: strips code fences and
// pulls the object out of any surrounding chat prose.
function extractJson(text) {
  if (!text || !text.trim()) return null
  let raw = text.trim().replace(/^```(?:json)?/i, '').replace(/```\s*$/i, '').trim()
  try { return JSON.parse(raw) } catch { /* fall through */ }
  const m = raw.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch { /* still bad */ } }
  return null
}

// A short human label from a kebab-case category ("ate-too-close" → "Ate too close").
export function humanizeCategory(cat) {
  const s = String(cat || '').replace(/[-_]+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Unspecified'
}

// Parse the LLM reply into a normalized reflection, or an error.
export function parseReflection(text, domainHint) {
  const obj = extractJson(text)
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: "That doesn't look like valid JSON — copy the AI's full reply." }
  }
  const category = String(obj.category || '').trim()
  const detail = String(obj.detail || obj.reason || '').trim()
  const adjustment = String(obj.adjustment || obj.fix || '').trim()
  if (!detail && !category) return { ok: false, error: 'No reason found in that reply.' }
  const domain = (obj.domain && REFLECT_DOMAINS[obj.domain]) ? obj.domain : (domainHint || 'other')
  return {
    ok: true,
    reflection: {
      domain,
      category: category || 'unspecified',
      label: humanizeCategory(category),
      detail,
      owed: obj.owed === undefined ? true : !!obj.owed,
      adjustment,
    },
  }
}

// Recent misses + their captured reasons, for the "judge me" exports — this is
// what lets an LLM connect a lagging pillar to WHY it lagged. Reads the skip
// records (train/steps) and any freeform day.reflections.
const shiftIso = (iso, delta) => {
  const [y, m, d] = iso.split('-').map(Number)
  const nd = new Date(new Date(y, m - 1, d).getTime() + delta * 86400000)
  const p = (n) => String(n).padStart(2, '0')
  return `${nd.getFullYear()}-${p(nd.getMonth() + 1)}-${p(nd.getDate())}`
}
export function recentReflections(state, today, days = 14) {
  const D = state?.days || {}
  const out = []
  for (let i = 0; i < days; i++) {
    const iso = shiftIso(today, -i)
    const d = D[iso]
    if (!d) continue
    const push = (domain, r) => { if (r) out.push({ date: iso, domain, category: r.reason || r.category || null, detail: r.detail || null, owed: !!r.owed, adjustment: r.adjustment || null, source: r.source || 'quick' }) }
    push('train', d.workout?.skip)
    push('steps', d.stepsSkip)
    for (const r of d.reflections || []) out.push({ date: iso, domain: r.domain || 'other', category: r.category || null, detail: r.detail || null, owed: !!r.owed, adjustment: r.adjustment || null, source: r.source || 'ai' })
  }
  return out
}
