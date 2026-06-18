// localfit local backend — serves wellness state and accepts daily logs +
// Apple Health pushes from an iOS Shortcut. Local-first; no cloud.
import express from 'express'
import https from 'node:https'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
// State file is env-driven so dev and prod stay fully separate:
//   prod  -> data/state.json        (real data, port 8788)
//   dev   -> STATE_FILE=data/state.dev.json (throwaway, port 8799)
const statePath = resolve(repoRoot, process.env.STATE_FILE || 'data/state.json')
const publicState = resolve(repoRoot, 'public/state.json')
// Only the prod backend mirrors into public/ (a PWA fallback); dev must never
// write real data there.
const mirrorPublic = !process.env.STATE_FILE
const distDir = resolve(repoRoot, 'dist')

const PORT = process.env.PORT || 8788
const app = express()

// CORS + Private Network Access: the hosted Pages build (public origin) reaches
// this backend on the home LAN. Reflect allowed origins and answer PNA preflight
// so the browser permits the public->private request.
const ALLOWED_ORIGINS = new Set([
  'https://andytambe31.github.io',
  'http://localhost:8788',                      // prod (same-origin)
  'https://Aniruddhas-Mac-mini.local:8788',     // prod over HTTPS/.local
  'http://localhost:5173',                       // dev frontend (Vite)
  'http://localhost:5174',                       // dev frontend (Vite fallback)
  'http://localhost:8799',                       // dev backend (direct)
])
app.use((req, res, next) => {
  const origin = req.headers.origin
  // Reflect an allowlisted origin; same-origin/no-origin requests need no header.
  if (origin && ALLOWED_ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.use(express.json())

const readState = async () => JSON.parse(await readFile(statePath, 'utf8'))
const localDate = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function defaultDay(state) {
  const habits = {}
  for (const h of state.habits || []) habits[h.id] = false
  return {
    steps: 0,
    workout: { did: false, type: '' },
    weight: null,
    routines: { skincareAM: false, skincarePM: false, haircare: false },
    habits,
    nutrition: { protein: null },
  }
}

function ensureDay(state, date) {
  state.days ||= {}
  if (!state.days[date]) state.days[date] = defaultDay(state)
  return state.days[date]
}

function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      target[k] = deepMerge(target[k] && typeof target[k] === 'object' ? target[k] : {}, v)
    } else {
      target[k] = v
    }
  }
  return target
}

async function persist(state) {
  const json = JSON.stringify(state, null, 2) + '\n'
  await writeFile(statePath, json)
  if (mirrorPublic && existsSync(dirname(publicState))) await writeFile(publicState, json)
}

app.get('/api/state', async (_req, res) => {
  try { res.json(await readState()) }
  catch (e) { res.status(500).json({ error: String(e) }) }
})

// Day-level last-write-wins merge (by each day's _ts), weightLog union by date.
function mergeStates(server, client) {
  const out = { profile: client.profile || server.profile || {}, days: { ...(server.days || {}) }, weightLog: [] }
  for (const [date, cd] of Object.entries(client.days || {})) {
    const sd = out.days[date]
    if (!sd || (cd._ts || 0) >= (sd._ts || 0)) out.days[date] = cd
  }
  const byDate = {}
  for (const e of server.weightLog || []) byDate[e.date] = e
  for (const e of client.weightLog || []) byDate[e.date] = e
  out.weightLog = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))
  const bf = {}
  for (const e of server.bodyFatLog || []) bf[e.date] = e
  for (const e of client.bodyFatLog || []) bf[e.date] = e
  out.bodyFatLog = Object.values(bf).sort((a, b) => a.date.localeCompare(b.date))
  out.rewardsClaimed = { ...(server.rewardsClaimed || {}), ...(client.rewardsClaimed || {}) }
  // Pantry: union by item id (add-and-keep), client wins on a collision (latest
  // edit). Seed items have stable ids; custom adds have unique ids, so nothing
  // from either device is lost.
  const pantry = {}
  for (const it of server.pantry || []) pantry[it.id] = it
  for (const it of client.pantry || []) pantry[it.id] = it
  if (Object.keys(pantry).length) out.pantry = Object.values(pantry)
  out.activity = mergeActivity(server.activity, client.activity)
  return out
}

// Union both activity arrays, sort by start, coalesce intervals that overlap or
// sit within 6 min of each other, and prune anything older than 48h relative to
// the newest timestamp seen. Keeps the sleep-inference signal compact + accurate.
function mergeActivity(a = [], b = []) {
  const all = [...(a || []), ...(b || [])]
    .filter((iv) => iv && typeof iv.s === 'number' && typeof iv.e === 'number' && iv.e >= iv.s)
    .sort((x, y) => x.s - y.s)
  if (!all.length) return []
  const GAP = 6 * 60 * 1000
  const merged = [{ s: all[0].s, e: all[0].e }]
  for (let i = 1; i < all.length; i++) {
    const last = merged[merged.length - 1]
    if (all[i].s <= last.e + GAP) last.e = Math.max(last.e, all[i].e)
    else merged.push({ s: all[i].s, e: all[i].e })
  }
  const maxTs = merged[merged.length - 1].e
  const cutoff = maxTs - 48 * 60 * 60 * 1000
  return merged.filter((iv) => iv.e >= cutoff)
}

// Two-way reconcile: client pushes its full state, gets back the merged truth.
app.post('/api/sync', async (req, res) => {
  try {
    let server
    try { server = await readState() } catch { server = { days: {}, weightLog: [] } }
    const merged = mergeStates(server, req.body || {})
    await persist(merged)
    res.json(merged)
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

// Patch today's (or any day's) log: { date?, patch }
app.post('/api/day', async (req, res) => {
  try {
    const { date = localDate(), patch = {} } = req.body || {}
    const state = await readState()
    deepMerge(ensureDay(state, date), patch)
    await persist(state)
    res.json(state)
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

// Bodyweight: upsert weightLog + set the day's weight.
app.post('/api/weight', async (req, res) => {
  try {
    const { date = localDate(), kg } = req.body || {}
    if (typeof kg !== 'number') return res.status(400).json({ error: 'kg (number) required' })
    const state = await readState()
    ensureDay(state, date).weight = kg
    state.weightLog ||= []
    const existing = state.weightLog.find((w) => w.date === date)
    if (existing) existing.kg = kg
    else state.weightLog.push({ date, kg })
    state.weightLog.sort((a, b) => a.date.localeCompare(b.date))
    await persist(state)
    res.json(state)
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

// DEBUG: catch a misconfigured Shortcut doing a GET instead of a POST.
app.get('/api/health', (req, res) => {
  console.log('[health] ⚠ GET received — your Shortcut is using GET, but it must POST.')
  res.json({ ok: false, hint: 'Use POST with a JSON body {"steps": <number>}' })
})

// Apple Health push from an iOS Shortcut: { date?, steps?, workouts? }
app.post('/api/health', async (req, res) => {
  try {
    console.log('[health] POST · content-type:', req.headers['content-type'], '· body:', JSON.stringify(req.body))
    const { date = localDate(), steps, workouts } = req.body || {}
    const state = await readState()
    const day = ensureDay(state, date)
    day._ts = Date.now()
    if (steps != null) day.steps = Number(steps) || 0
    if (Array.isArray(workouts) && workouts.length) {
      day.workout = { did: true, type: String(workouts[0].type || workouts[0] || 'workout'), source: 'health' }
    }
    await persist(state)
    res.json({ ok: true, date, steps: day.steps })
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

if (existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (_req, res) => res.sendFile(resolve(distDir, 'index.html')))
}

// Optional HTTPS: needed because the hosted Pages origin is HTTPS, so the
// backend it talks to must be HTTPS too (no mixed content). Provide certs at
// certs/localfit.pem + certs/localfit-key.pem (or TLS_CERT/TLS_KEY), else
// fall back to plain HTTP for same-origin local use.
const certPath = process.env.TLS_CERT || resolve(repoRoot, 'certs/localfit.pem')
const keyPath = process.env.TLS_KEY || resolve(repoRoot, 'certs/localfit-key.pem')
if (existsSync(certPath) && existsSync(keyPath)) {
  const cert = readFileSync(certPath)
  const key = readFileSync(keyPath)
  https.createServer({ key, cert }, app).listen(PORT, () =>
    console.log(`[localfit] https://localhost:${PORT} (TLS)`))
} else {
  app.listen(PORT, () => console.log(`[localfit] http://localhost:${PORT}`))
}
