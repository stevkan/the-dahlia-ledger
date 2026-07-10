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
- For `-AuthBypass` (see below) only: `npm install` at the repo root once, to pull in `firebase-tools`

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

**What you'll see by default:** the login screen ("Track your dahlias from one secure workspace." + "Continue with Microsoft"), since the only production auth path is a real Microsoft OAuth popup.

**To verify authenticated UI (dev/test only):** add `-AuthBypass`:

```powershell
pwsh .claude/skills/run-the-dahlia-ledger/driver.ps1 -Screenshot C:\path\to\out.png -AuthBypass
```

This starts a local Firebase Auth Emulator (port 9099) and silently signs in a fixed throwaway user (`dev-bypass@dahlialedger.local`), so the screenshot shows the authenticated app shell instead of the login card. It requires `FIREBASE_PROJECT_ID` to be set in `backend/.env` and `npm install` at the repo root (for `firebase-tools`). It is gated behind `import.meta.env.DEV` and an opt-in env var, so it's dead-code-eliminated from production builds and never active unless explicitly requested — real Microsoft sign-in is completely untouched.

By default the bypass user has **no access to real data** — Firestore/Storage stay pointed at the real project, and access is still gated by the backend's `GLOBAL_ADMIN_EMAILS`/garden-ownership checks. To see real records during a bypass session, manually add `dev-bypass@dahlialedger.local` to `GLOBAL_ADMIN_EMAILS` in your local `backend/.env` (not committed, opt-in only).

If backend/frontend were already running from a *previous* driver invocation without `-AuthBypass`, they won't have the emulator env vars — stop them and let the driver restart them, or the bypass won't take effect.

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
- **`-AuthBypass` env vars only apply to freshly-started servers.** `FIREBASE_AUTH_EMULATOR_HOST` and `VITE_USE_AUTH_EMULATOR` are set on the driver's own process before spawning backend/frontend; if either was already running from an earlier non-bypass invocation, kill it first so the restart picks up the vars.
- **`-AuthBypass` uses a separate Chrome profile** (`$env:TEMP\chrome-dahlia-driver-authbypass`) from the default one, so a persisted emulator session can never leak into a normal (non-bypass) screenshot or vice versa.
- **`npm` via `Start-Process` needs the `.cmd` suffix on this machine.** `Start-Process -FilePath "npm"` can resolve to `npm.ps1` and fail with "%1 is not a valid Win32 application" instead of `npm.cmd`. The driver calls `npm.cmd` explicitly for this reason.
- **A cold/never-used Chrome profile can miss the single-shot `--screenshot` capture.** The very first load on a brand-new `--user-data-dir` (IndexedDB setup, Firebase persistence init) can occasionally run past the capture window, showing "Checking your session" instead of the real page. If a screenshot looks stuck mid-load, delete the relevant profile dir under `$env:TEMP` and re-run once to let it warm up, then run again.
