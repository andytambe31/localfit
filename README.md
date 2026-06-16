# localfit

A personal wellness coach — not a diary. localfit tracks the things that actually
move the needle (body fat, skin, hair, sleep, diet, movement) and proactively tells
you the one thing to do next, in an authoritative coaching voice. Built for a single
user, offline-first, with data that never leaves your own devices.

## What it does

- **Coach hero** — reads the time of day and what you've logged, then surfaces the
  single next action ("It's 6:14 PM, you're at 2,000 of 10,000 steps — take a walk").
- **Guided skincare routines** — full-screen, one step per card, Done/Skip, story-style
  edge navigation. Frequency-aware scheduling (daily vs weekly actives like BHA and
  retinoid), carry-over for missed nights, product-ownership gating, and a gradual
  ramp-up that unlocks one active per week so your skin adjusts. Morning/evening
  routines lock to their time windows.
- **Sleep tracking** — inferred behind the scenes from app-activity gaps (your evening
  routine ≈ bedtime, morning routine ≈ wake), including mid-night interruptions. Fully
  editable when the estimate is off.
- **Goals / On-track** — five circular score rings (sleep, skin, hair, diet, movement),
  each out of ten, plus a body-fat target with an in-app tape-measurement estimator
  (US Navy + RFM + BAI consensus).
- **Rewards** — streak-based, leisure-only (non-food) reward ladder.

## Architecture

- **localStorage-first.** Every write saves to the browser instantly, then best-effort
  mirrors to the backend. The app is fully usable offline.
- **Two-way sync.** The client pushes its full state to `/api/sync`; the server merges
  day-level last-write-wins (by per-day `_ts`) and unions logs, then returns the merged
  truth. The backend is the durable source of truth; if localStorage is lost it restores
  from the server.
- **PWA.** A service worker caches the app shell so it loads offline once installed to
  the home screen.
- **No cloud for your data.** Only the app *code* is hosted. Your wellness data lives in
  your phone's localStorage and on your own Mac — never in a third-party service.

## Tech stack

React 18 + Vite 6 + Tailwind CSS v4 + Recharts on the frontend; a small Express 4
backend with a JSON store. Fonts: Fraunces (display) + Hanken Grotesk (body).

## Develop

```bash
npm install
npm run dev      # Express backend (:8788) + Vite dev server, proxying /api
```

## Build

```bash
npm run build    # local build (base /, same-origin API)
npm run start    # serve the build from the Express backend
```

## Hosting: GitHub Pages + a local HTTPS backend

The frontend is hosted on GitHub Pages (HTTPS, so the PWA installs and works offline
anywhere). The backend runs on your Mac over HTTPS and is reachable only at home; away
from home the app relies on localStorage and reconciles when you're back.

- **Frontend** deploys automatically via `.github/workflows/deploy.yml` on push to
  `main` (set repo Pages source to "GitHub Actions"). It builds with a `/localfit/`
  base path and points the API at the Mac's `.local` hostname.
- **Backend over HTTPS** (required because an HTTPS page can't call a plain-HTTP
  address — mixed-content is blocked):

  ```bash
  ./scripts/make-cert.sh      # local CA + cert for the Mac's .local name, LAN IP, localhost
  npm run start:https         # serves the backend over HTTPS on :8788
  ```

  Then trust the generated root CA on your devices (the script prints the steps): on the
  Mac via the keychain, and on iPhone by AirDropping `certs/rootCA.pem`, installing the
  profile, and enabling it under Settings → General → About → Certificate Trust Settings.

CORS and Private Network Access headers on the backend allow the hosted Pages origin to
reach the local HTTPS server.

## Data & privacy

`data/state.json` (your real data) and `certs/` are gitignored and never committed.
The deployed bundle contains no personal data — only application code.

## Layout

```
src/             React app (App.jsx + skincare.js, sleep.js, SkincareFlow.jsx, …)
server/          Express backend (index.mjs)
scripts/         make-cert.sh, data sync helper
public/          PWA shell (sw.js, manifest, icon)
.github/         Pages deploy workflow
```
