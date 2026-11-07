# CLAUDE.md — localfit resume/context doc

This file is for Claude Code (and the owner) to pick the project up instantly. It
captures architecture, decisions, data model, what's built, and what's pending. Keep it
updated as the project evolves.

## What localfit is

A **personal wellness coach** (not a diary) for one user — Aniruddha. Primary goals: fat
loss (**body fat %, never weight**), muscle, plus skincare, haircare, sleep, diet,
movement. It must feel welcoming and guided (he dislikes logging), speak in an
**authoritative, directive coaching voice**, work **offline**, and never lose data.
Part of an app ecosystem (sibling: `faang-prep`/localcode; a budgeting app later).

## Run it

```bash
npm install
npm run dev          # Express backend (:8788) + Vite dev (proxies /api) — local dev
npm run build        # local build (base '/', same-origin relative API)
npm run start        # serve the local build from Express (http)
npm run build:pages  # GitHub Pages build (base '/localfit/', API -> Mac .local HTTPS)
npm run start:https  # backend over HTTPS on :8788 (needs ./scripts/make-cert.sh first)
```

Owner's Mac: **`Aniruddhas-Mac-mini.local`**, LAN IP **10.0.0.105**, backend port **8788**,
Vite dev typically 5173/5174. GitHub: **andytambe31/localfit**, Pages URL
**https://andytambe31.github.io/localfit/**.

## Architecture

- **localStorage-first.** `LS_KEY='localfit-state'`. Every write saves to localStorage
  instantly (`saveLocal`), sets `pending=true`, and debounce-syncs. The app is fully
  usable offline; the office use case depends on this.
- **Two-way sync.** `doSync()` POSTs full state to `${API_BASE}/api/sync`; server
  `mergeStates()` does **day-level last-write-wins by each day's `_ts`**, unions
  `weightLog`/`bodyFatLog` by date, merges `rewardsClaimed`, and coalesces `activity`
  intervals. Returns merged truth → client adopts it. Backend is the durable source of
  truth; if localStorage is lost, restore from `/api/state`.
- **Resync triggers:** on load, `online` event, `visibilitychange`→visible, and a 60s
  heartbeat; plus a 1.5s debounce after writes. `beforeunload` warns if `pending`.
- **API base is configurable:** `src/config.js` → `API_BASE = import.meta.env.VITE_API_BASE || ''`.
  Empty = same-origin relative (local dev/Express). Pages build injects the Mac's HTTPS
  `.local` URL. Only two fetch sites in App.jsx (`/api/sync`, `/api/state`).
- **PWA:** `public/sw.js` (network-first, cache `localfit-v2`, subpath-safe via
  `self.registration.scope`); registered in `main.jsx` at `${import.meta.env.BASE_URL}sw.js`.
  Vite `base` from `VITE_BASE` (default '/'); manifest/index.html use `%BASE_URL%` /
  relative paths so it works under `/localfit/`.
- **No cloud for data.** Only app *code* is hosted (GitHub Pages). Wellness data lives in
  the phone's localStorage and on the Mac. `data/state.json` and `certs/` are gitignored
  and scrubbed from git history — never commit personal data.

## Hosting model (why it's shaped this way)

iOS only runs service workers / installable PWAs on **HTTPS** (secure context); a plain
`http://10.0.0.105` LAN URL is insecure → no offline PWA. And an **HTTPS page cannot call
an HTTP backend** (mixed-content blocked). So: **frontend on GitHub Pages (HTTPS)** +
**backend on the Mac over HTTPS** (local cert trusted on the devices). Away from home the
app runs on localStorage and reconciles when back home (Mac must be on/online to sync).
Backend has CORS + `Access-Control-Allow-Private-Network: true` for the Pages origin.

## Design system (match exactly; the owner is particular)

- Light editorial theme: bg `#f1ede4` (warm bone), ink `#20201d`, olive `#3d4a32`, dark
  panel `#23291f`. Cream text on dark: `#f4f1e8`; muted olive text `#9aa581`.
- Fonts: **Fraunces** display via `.font-display`; **Hanken Grotesk** body.
- **NO emojis, anywhere.** Authoritative, concise, directive copy.
- Subtle motion only, all gated by `prefers-reduced-motion` (see index.css): button
  press scale, view/modal `fade-in`, opening **splash** (`localfit` wordmark), skincare
  card transitions (`sk-advance`/`sk-back`/`sk-skip`), attention `pulse-attention`, goal
  ring fill (`score-ring-arc`).

## Data model

`state = { profile, days{}, weightLog[], bodyFatLog[], activity[], rewardsClaimed{} }`

- `profile`: `name, stepTarget(10000), gymTargetPerWeek(3), waterTarget(8),
  bodyFatTarget(12), bodyFatDeadline('2026-12-31'), sleepTargetHours(7), bedGoal('23:30'),
  wakeGoal('07:30'), skincare:{ ownedProducts[], startedDate }, measurements{neck,waist,hip}, height, sex`.
- `days[YYYY-MM-DD]`: `{ steps, workout:{did,type}, weight, routines:{skincareAM,skincarePM,haircare},
  water, meals:{breakfast,lunch,dinner: 'on'|'off'|null}, mealNote,
  skincare:{am,pm: {steps:{[id]:'done'|'skipped'}, ts}|null},
  sleep:{start,end,minutes,interruptions:[{at,minutes}],source:'auto'|'manual',confident},
  _ts }`.
- `activity[]`: `{ s, e }` epoch-ms foreground intervals (merge gap 6 min), pruned to 48h.
  Written localStorage-only by `recordActivity()` (no setState, no `pending`) so background
  pings don't trip the "not backed up" banner; the heartbeat sync mirrors them.

## Features (all built)

- **6-month transformation program** (Nov 8 2026 – Apr 30 2027). The calendar spine
  over everything (supersedes the old Phase 1/2 tiers):
  - `src/program.js` (pure): dated `PROGRAM_PHASES` 0–6 (`programPhase`/`programProgress`/
    `phaseProgress`) — the current phase is whichever dated window contains today;
    transitions carry focus but NEVER change a target. `DEFAULT_TARGETS`.
  - **Editable targets**: `profile.targets` (kcal/protein/fat/fiber/water; carbs =
    computed remainder). `diet.js calorieTarget` prefers the manual target (TDEE
    demoted to advisory); `macroTargets()` resolves them. `TargetsModal` edits them.
  - **Fixed editable weekly schedule**: `src/schedule.js` — `SESSION_TEMPLATES`
    (Upper A/B, Lower A/B with explicit exercise lists + core + morning cardio;
    cardio/mobility/recovery days). `profile.weeklySchedule` (weekday→session, editable
    via `ScheduleModal`). `train.js decideDayType`/`buildSession` build from the
    template on the program; **periodization waves still drive set/rep/load**;
    conservative lower-body ramp for the first 2 weeks. Rolling rotation is the
    non-program fallback.
  - **Meal library + plan**: `src/meals.js` — Meals A–G (estimated macros + ingredients;
    Sweetgreen = customizable restaurant template), `WEEKLY_MEAL_PLAN_DEFAULT`,
    `planDayTotals` (computed, only states "meets" from the math). `ProgramMealPlan`
    card (log a meal → diary entry) + `MealPlanModal` (swap slots, editable
    `profile.mealPlan`).
  - **Command center**: `ProgramCenter` (App.jsx) — dated phase header + progress bar,
    editable macro targets vs logged + remaining, today's scheduled lift/cardio + core/
    mobility + steps + water + sleep (the consolidated "Today's Overview").
  - PENDING for this program: grocery quantities auto-computed from the meal plan,
    meal-prep checklists (Sun/Wed), office/WFH daily routines, weekly-review additions
    (sessions/cardio-min/core/mobility/waist), 2-week photo cadence + front-flexed pose,
    configurable non-punitive habits.
- **ChatGPT daily import** (`src/dailyImport.js`, pure; `ImportModal` in App.jsx): paste
  a versioned JSON object (schema "1.0") describing a day → validate (size cap, safe
  parse, prototype-pollution guard, range/date checks) → preview the diff (add/update/
  skip/planned/unsupported) → merge into the EXISTING models (cardio/steps/water/weight/
  sleep/nutrition→diary/skincare/haircare/supps/workout/notes). Smart merge is
  idempotent + partial-day-safe; planned≠completed, estimates flagged; "Copy ChatGPT
  instructions" generates the prompt from the schema; last import is undoable. Tests in
  `test/dailyImport.test.mjs` (`npm test`, bundles via esbuild).
- **Grooming** (skincare.js/hair.js): built around the owner's actual products with a
  gradual introduction — skincare wk1-2 gentle (cleanse+cream+SPF), wk3+ niacinamide
  serum ~3×/wk, wk5+ optional weekly resurfacing toner; optional weekly Tree Hut body
  scrub. Haircare: flexible washing, Rogaine on its existing cadence (AM daily, PM
  except weekend rests — unchanged), optional Moroccanoil/curl-cream (curl off by
  default). Progress-photo poses add Face + Hairline. Skincare completion takes a note.
- **Coach** (`buildCoach`): time-phase aware (latenight<5 rest / morning<12 / midday<17 /
  evening<21 / night). Surfaces ONE next action. Skincare sequencing: training is
  EVENING-only, so mornings prompt skincare directly; evenings prompt PM skincare after
  the workout and name the night's active. Bedtime (>=22) nudges the evening routine.
- **Skincare engine** (`src/skincare.js`, pure): `planForDay(dateIso, state)` → AM/PM
  step lists derived from day logs. Shave = rolling every-2-days (overdue flag). Weekly
  actives: **BHA Mon/Thu, retinoid Tue/Fri/Sun**; never two actives/night; carry-over of
  one missed active; weekly caps (retinoid <=3, BHA <=2). Ownership gating + gradual
  ramp-up (one active/week: niacinamide wk1, BHA+vitC wk2, retinoid wk3). `dueSummary()`
  feeds the coach. Products in `PRODUCTS`; owned defaults in `DEFAULT_OWNED`.
- **Guided skincare flow** (`src/SkincareFlow.jsx`): full-screen takeover, one step/card,
  Done/Skip, story-style edge taps to browse, "Not today" backout (no streak penalty),
  completion logs the routine. `100dvh` + pinned footer; overlay scroll-locked.
- **Skin tile states** (dashboard status strip): time-windowed — morning loggable
  **6 AM–12 PM**, evening **6 PM–12 AM**; **locked** (padlock + "Opens 6 AM/PM") outside.
  In-window 'attention'; after 10 PM undone PM = 'urgent' pulsing "Now".
- **Sleep** (`src/sleep.js`, pure): `inferSleep` from the overnight activity gap (bedtime
  = last evening activity, wake = first morning activity), interruptions = blips inside.
  Guards: plausible bedtime/wake hours, clamp to [2h,11h], else `confident:false`.
  `sleepScore` /10 over last 7 nights: duration vs 7h target, late-bedtime penalty
  (grace = bedGoal+30min), interruption penalty. `SleepModal` to correct (manual wins).
- **Goals / On-track** (`GoalsSection`): five circular `ScoreRing`s — sleep, skin, hair,
  diet, move — each /10; overall = rounded avg of non-null rings; weakest-link nudge.
  `dietScore`/`moveScore` are last-14-day helpers. Body-fat target is its own section with
  `BodyFatModal` (US Navy + RFM + BAI tape-measure consensus, `estimateBF`).
- **Rewards** (`RewardsSection`, separate `view==='rewards'` page; `RewardsSummary` card
  on dashboard): streak-based, leisure/non-food ladder (3/7/14/21/30 days). `strongDay()`.

## Key files

```
src/App.jsx          everything wired (data layer, App, FocusCard, GoalsSection, modals, coach, atoms)
src/skincare.js      skincare planning engine (pure)
src/SkincareFlow.jsx guided full-screen routine flow
src/sleep.js         sleep inference + scoring (pure)
src/config.js        API_BASE
src/index.css        theme, fonts, all animations + reduced-motion guard
server/index.mjs     Express backend: /api/state, /api/sync, /api/day, /api/weight, /api/health; mergeStates; CORS/PNA; optional HTTPS
scripts/make-cert.sh local CA + cert (mkcert or openssl fallback) for the HTTPS backend
.github/workflows/deploy.yml  Pages deploy (npx vite build with VITE_BASE + VITE_API_BASE)
public/sw.js, manifest.webmanifest, icon.svg  PWA shell
```

## PENDING — manual steps the owner must do (Claude can't: no gh/mkcert installed)

1. **Enable GitHub Pages:** repo Settings → Pages → Source = "GitHub Actions", then
   re-run the workflow. (Build already succeeds; only the publish step 404s until this.)
2. **If repo is private on a free plan**, Pages won't publish → make the repo public
   (safe: no data/secrets in it) or use GitHub Pro.
3. **HTTPS backend:** `./scripts/make-cert.sh` → trust `certs/rootCA.pem` on the Mac
   (keychain) and iPhone (AirDrop → install profile → Settings → General → About →
   Certificate Trust Settings) → `npm run start:https`.
4. Then on the phone: open the Pages URL → Add to Home Screen.

## Gotchas / notes

- The working tree's `data/state.json` is the owner's REAL data (height 170, sex male,
  measurements neck38/waist94/hip110, bodyFatLog 26.6%). It's gitignored and scrubbed from
  history — never re-add it. A stray `rewardsClaimed:{"7":...}` from old testing exists in
  his localStorage (cosmetic; union-merge can't delete it — a "reset rewards" action was
  offered).
- `npm run build` runs a `sync` step that copies `data/state.json` → `public/state.json`
  locally; CI uses `npx vite build` directly to avoid bundling any data.
- Sleep scores need a few days of evening/morning app opens before they're meaningful;
  early reads show `estimated` and are correctable.
- Body-fat skinfold precision (thigh/back) needs a ~$10 caliper → can add Jackson-Pollock
  mode later. Currently tape-only consensus.

## Likely next items

- Confirm Pages is live; wire/verify HTTPS sync from the hosted app at home.
- Offered-but-not-built: repeatable/editable rewards, body-fat milestone rewards, "reset
  rewards" action, progress photos, Jackson-Pollock caliper mode.
- Tailscale option for private HTTPS (alternative to the .local cert route) if desired.
