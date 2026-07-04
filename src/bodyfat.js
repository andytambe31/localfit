/* ---------- body-fat estimation (pure) --------------------------------------
 * Two ways to read body fat, both feeding the same log:
 *   · TAPE — no equipment. Blends three tape-measure-validated methods (US Navy,
 *     Relative Fat Mass, Body Adiposity Index) so no single bias dominates.
 *   · SKINFOLD — a cheap caliper and the Jackson–Pollock 3-site method + Siri
 *     equation. Pinch a few sites, read the fold in mm; more precise when you
 *     have the caliper and a steady hand.
 * Both return { best } as a percentage; the guided flow (BodyFatFlow) drives the
 * step-by-step measuring. Voice stays directive; no emojis.
 * -------------------------------------------------------------------------- */

export const round1 = (n) => Math.round(n * 10) / 10
export const clampBf = (b) => Math.max(3, Math.min(60, round1(b)))

/* ---------- tape: US Navy + RFM + BAI consensus (all circumferences in cm) --- */
export function estimateBF({ sex, height, neck, waist, hip }) {
  const female = sex === 'female'
  const parts = {}
  // US Navy (Hodgdon–Beckett)
  if (height > 0 && neck > 0 && waist > 0) {
    if (female) { if (hip > 0 && waist + hip - neck > 0) parts.navy = 495 / (1.29579 - 0.35004 * Math.log10(waist + hip - neck) + 0.22100 * Math.log10(height)) - 450 }
    else if (waist - neck > 0) parts.navy = 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(height)) - 450
  }
  // Relative Fat Mass (Woolcott–Bergman 2018, validated vs DXA)
  if (height > 0 && waist > 0) parts.rfm = (female ? 76 : 64) - 20 * (height / waist)
  // Body Adiposity Index (Bergman 2011) — brings in hip
  if (hip > 0 && height > 0) parts.bai = hip / Math.pow(height / 100, 1.5) - 18

  const w = { navy: 0.45, rfm: 0.45, bai: 0.1 }
  let sum = 0, wsum = 0
  const breakdown = {}
  for (const k of ['navy', 'rfm', 'bai']) {
    if (parts[k] != null && isFinite(parts[k])) { const v = clampBf(parts[k]); breakdown[k] = v; sum += v * w[k]; wsum += w[k] }
  }
  if (!wsum) return null
  return { best: round1(sum / wsum), breakdown, method: 'tape' }
}

/* ---------- skinfold: Jackson–Pollock 3-site → body density → Siri ----------
 * Men:   chest, abdomen, thigh.   Women: triceps, suprailiac, thigh.
 * `sites` is keyed by site id, values in millimetres; `age` in years.
 */
export function estimateSkinfold({ sex, age, sites }) {
  const female = sex === 'female'
  const keys = female ? ['triceps', 'suprailiac', 'thigh'] : ['chest', 'abdomen', 'thigh']
  const vals = keys.map((k) => Number(sites?.[k]))
  if (!(Number(age) > 0) || vals.some((v) => !(v > 0))) return null
  const s = vals.reduce((a, b) => a + b, 0)
  const density = female
    ? 1.0994921 - 0.0009929 * s + 0.0000023 * s * s - 0.0001392 * age
    : 1.10938 - 0.0008267 * s + 0.0000016 * s * s - 0.0002574 * age
  const bf = 495 / density - 450
  return { best: clampBf(bf), sum: Math.round(s), density: Math.round(density * 1e4) / 1e4, method: 'skinfold' }
}

export function bfCategory(pct, sex) {
  const m = [[6, 'Essential'], [14, 'Athletic'], [18, 'Fitness'], [25, 'Average']]
  const f = [[14, 'Essential'], [21, 'Athletic'], [25, 'Fitness'], [32, 'Average']]
  for (const [lim, name] of (sex === 'female' ? f : m)) if (pct < lim) return name
  return 'High'
}

/* ---------- measurement scripts that drive the guided flow ------------------
 * Each site is one card: what it is, exactly how and where to measure, and a
 * short "why". `unitField` is the numeric input unit shown on the card.
 */
export const TAPE_SITES = [
  {
    id: 'height', title: 'Height', unitField: 'len',
    how: 'Stand tall against a wall, heels down and chin level. Measure from the floor to the crown of your head.',
    why: 'Anchors every estimate — everything else is read relative to it.',
  },
  {
    id: 'neck', title: 'Neck', unitField: 'len',
    how: "Wrap the tape just below your larynx (Adam's apple), letting it slope slightly down toward the front. Shoulders relaxed, don't flex.",
    why: 'Neck stands in for lean mass in the Navy formula.',
  },
  {
    id: 'waist', title: 'Waist', unitField: 'len', sex: 'male',
    how: 'At navel level, tape parallel to the floor. Breathe out and relax — do not suck in or push your belly out.',
    why: 'The single biggest signal of fat mass. Measure it honestly.',
  },
  {
    id: 'waist', title: 'Waist', unitField: 'len', sex: 'female',
    how: 'At the narrowest point of your torso, usually just above the navel. Tape level, relaxed — do not suck in.',
    why: 'The single biggest signal of fat mass. Measure it honestly.',
  },
  {
    id: 'hip', title: 'Hip', unitField: 'len',
    how: 'Around the widest part of your glutes, feet together and tape level all the way around.',
    why: 'Balances the estimate through the adiposity index.',
  },
]

const THIGH_SITE = {
  id: 'thigh', title: 'Thigh', unitField: 'mm',
  how: 'Vertical fold on the front of the thigh, midway between the hip crease and the top of the kneecap. Relax the leg, take the weight off it.',
  why: 'Lower-body fat both sexes carry differently — needed for the 3-site read.',
}

export const SKINFOLD_SITES = {
  male: [
    {
      id: 'chest', title: 'Chest', unitField: 'mm',
      how: 'Diagonal fold, halfway between the front of the armpit and the nipple. Pinch, pull it off the muscle, place the caliper 1 cm below your fingers.',
      why: 'Upper-body site in the male 3-site formula.',
    },
    {
      id: 'abdomen', title: 'Abdomen', unitField: 'mm',
      how: 'Vertical fold about 2 cm to the right of your navel. Pinch firmly, hold, and read the caliper after two seconds.',
      why: 'Where men store fat first and lose it last.',
    },
    THIGH_SITE,
  ],
  female: [
    {
      id: 'triceps', title: 'Triceps', unitField: 'mm',
      how: 'Vertical fold on the back of the upper arm, midway between shoulder and elbow. Arm relaxed and hanging at your side.',
      why: 'Upper-body site in the female 3-site formula.',
    },
    {
      id: 'suprailiac', title: 'Suprailiac', unitField: 'mm',
      how: 'Diagonal fold just above the hip bone at the front, following the natural angle of the crease.',
      why: 'Reads fat over the hip — key female storage site.',
    },
    THIGH_SITE,
  ],
}

// The pinch coaching line shared by every caliper site.
export const PINCH_TIP = 'Pinch and lift the fold away from the muscle, place the caliper jaws 1 cm from your fingers, and read it after two seconds. Take it twice and use the average.'
