// Seed the isolated dev state file (data/state.dev.json) the first time `npm run
// dev` is started. Copies a SNAPSHOT of prod data so dev has realistic data to
// test against — but dev writes only ever go to state.dev.json, never to prod.
// If the dev file already exists, it's left untouched (dev keeps its own state).
import { existsSync, copyFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const prod = resolve(repoRoot, 'data/state.json')
const dev = resolve(repoRoot, 'data/state.dev.json')

if (existsSync(dev)) {
  console.log('[seed-dev] data/state.dev.json exists — leaving dev data as-is')
} else if (existsSync(prod)) {
  copyFileSync(prod, dev)
  console.log('[seed-dev] snapshotted data/state.json -> data/state.dev.json')
} else {
  writeFileSync(dev, JSON.stringify({ profile: {}, days: {}, weightLog: [], bodyFatLog: [], activity: [] }, null, 2))
  console.log('[seed-dev] no prod data; wrote empty data/state.dev.json')
}
