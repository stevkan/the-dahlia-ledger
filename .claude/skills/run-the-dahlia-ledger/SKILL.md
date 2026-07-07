---
name: run-the-dahlia-ledger
description: Build, run, start, screenshot, or interact with The Dahlia Ledger app. Use when asked to run the app, start the dev server, take a screenshot of the UI, verify a frontend or backend change, or run the tests.
---

The Dahlia Ledger is a Vite + React PWA (frontend, port 5173) backed by an Express + Firebase API (backend, port 8787). The agent path is `.claude/skills/run-the-dahlia-ledger/driver.ps1`, which starts both dev servers if needed and takes a Chrome headless screenshot. All paths below are relative to the repo root.

## Prerequisites

- Node 22+ (`node --version`)
- Google Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe` (verified present)
- `frontend/.env` populated (copy from `frontend/.env.example`) — Firebase keys required for auth
- `backend/.env` populated (copy from `backend/.env.example`) — needs `GOOGLE_APPLICATION_CREDENTIALS` pointing to a Firebase service account JSON for Firestore access

## Setup

Dependencies are installed in `frontend/node_modules/` and `backend/node_modules/`. Reinstall if the lockfiles change:

```powershell
npm --prefix frontend ci
npm --prefix backend ci
```

## Build

Type-check and build the frontend bundle:

```powershell
npm run build --prefix frontend
```

Full production build (installs deps with `--ignore-scripts`, then builds frontend):

```powershell
npm run build
```

The build succeeds with chunk-size warnings (heic-to is ~3 MB uncompressed) — these are expected.

## Run (agent path)

Use the driver to start both servers and take a screenshot:

```powershell
pwsh .claude/skills/run-the-dahlia-ledger/driver.ps1 -Screenshot C:\path\to\out.png
```

If both servers are already running, skip startup:

```powershell
pwsh .claude/skills/run-the-dahlia-ledger/driver.ps1 -Screenshot C:\path\to\out.png -SkipServers
```

Screenshots land wherever `-Screenshot` points. The driver also prints the backend health response (`{"ok":true}`) to confirm the API is reachable.

**What you'll see:** the login screen ("Track your dahlias from one secure workspace." + "Continue with Microsoft"). The full app requires Microsoft OAuth — it can't be automated headlessly. To verify authenticated UI changes, the user needs to sign in manually in a real browser and confirm the feature there.

## Run (human path)

Two terminals:

```powershell
npm run dev --prefix backend   # → http://localhost:8787
npm run dev --prefix frontend  # → http://localhost:5173
```

Open `http://localhost:5173` in Chrome and sign in with a Microsoft account configured in `backend/.env` (`GLOBAL_ADMIN_EMAILS` or `GLOBAL_ADMIN_UIDS`).

Frontend uses `strictPort: true` — if port 5173 is taken, it errors instead of picking another port. Kill the occupying process first.

## Tests

```powershell
npm run test --prefix frontend   # 49 tests via Vitest (unit: recordUtils, gardenOptions)
npm run test --prefix backend    # 106 tests via Vitest (unit: users, httpHelpers, gardenAuth, schema)
```

All tests run without any live Firebase connection — they're pure unit tests.

## Gotchas

- **Chrome profile lock.** Chrome's `--headless=new --screenshot` fails silently when the default user profile is locked by a running Chrome window. The driver uses `--user-data-dir=$env:TEMP\chrome-dahlia-driver` to avoid this. If you call Chrome directly, add that flag.
- **`strictPort: true` on 5173.** The frontend Vite config won't auto-pick an alternate port. If the dev server errors with "Port 5173 is already in use", there's already a Vite process running — either reuse it or kill it.
- **Backend needs `GOOGLE_APPLICATION_CREDENTIALS`.** Without a valid Firebase service account, all `/api/*` routes beyond `/api/health` return 401. The health endpoint always works.
- **`REQUIRE_FIREBASE_APP_CHECK=true` in production.** The development `.env` sets this to `true` with a debug token (`VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN=true`) registered in Firebase Console. If you see 403s on API calls, the App Check debug token may not be registered — set `REQUIRE_FIREBASE_APP_CHECK=false` locally.
- **heic-to chunk warning.** The build always warns about chunk sizes exceeding 500 kB due to the `heic-to` WASM library. This is expected and not an error.
- **Backend start command requires `./src/appinsights.cjs`.** The `npm start` script uses `--require ./src/appinsights.cjs`. In dev, `npm run dev --prefix backend` via nodemon does the same. If `applicationinsights` throws on startup (rare), unset `APPLICATIONINSIGHTS_CONNECTION_STRING`.
