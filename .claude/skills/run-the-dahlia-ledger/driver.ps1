#!/usr/bin/env pwsh
# Driver for The Dahlia Ledger — starts dev servers and takes a screenshot.
# Usage: pwsh driver.ps1 [-Screenshot path\to\out.png] [-SkipServers] [-AuthBypass]
#
# Requires:
#   - Node 22+  (node --version)
#   - Chrome at C:\Program Files\Google\Chrome\Application\chrome.exe
#   - frontend/.env and backend/.env populated (copies of .env.example)
#
# -AuthBypass (dev/test only): starts a local Firebase Auth Emulator and signs a
# throwaway user in automatically, so the screenshot shows the authenticated app
# instead of the "Continue with Microsoft" login screen. Requires `npm install`
# at the repo root once (pulls in firebase-tools). See SKILL.md for details.

param(
  [string]$Screenshot = "$env:TEMP\dahlia-screenshot.png",
  [switch]$SkipServers,
  [switch]$AuthBypass
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"

if (-not (Test-Path $chrome)) {
  Write-Error "Chrome not found at $chrome"
  exit 1
}

# --- Auth emulator bypass (dev/test only) ---
if ($AuthBypass) {
  $backendEnvPath = Join-Path $root "backend\.env"
  $projectId = $null
  if (Test-Path $backendEnvPath) {
    $line = Get-Content $backendEnvPath | Where-Object { $_ -match '^FIREBASE_PROJECT_ID=' } | Select-Object -First 1
    if ($line) { $projectId = ($line -split '=', 2)[1].Trim() }
  }
  if (-not $projectId) {
    Write-Error "-AuthBypass requires FIREBASE_PROJECT_ID to be set in backend\.env"
    exit 1
  }

  $emulatorUp = $false
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:9099/" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    $emulatorUp = $true
  } catch {}

  if (-not $emulatorUp) {
    Write-Host "Starting Firebase Auth emulator on :9099 for project $projectId …"
    $firebaseCli = Join-Path $root "node_modules\.bin\firebase.cmd"
    if (-not (Test-Path $firebaseCli)) {
      Write-Error "firebase-tools not installed — run 'npm install' at the repo root first."
      exit 1
    }
    Start-Process -NoNewWindow -FilePath $firebaseCli -ArgumentList "emulators:start", "--only", "auth", "--project", $projectId -WorkingDirectory $root
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 1
      try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:9099/" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
        Write-Host "Auth emulator ready."
        break
      } catch {}
    }
  } else {
    Write-Host "Auth emulator already running."
  }

  $env:FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099"
  $env:VITE_USE_AUTH_EMULATOR = "true"

  if ($SkipServers) {
    Write-Host "Warning: -SkipServers with -AuthBypass assumes backend/frontend were already started with emulator env vars set — otherwise the bypass will not take effect."
  }
}

# --- Start servers if not already up ---
if (-not $SkipServers) {
  $backendUp = $false
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:8787/api/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    $backendUp = ($r.StatusCode -eq 200)
  } catch {}

  if (-not $backendUp) {
    Write-Host "Starting backend on :8787 …"
    Start-Process -NoNewWindow -FilePath "npm.cmd" -ArgumentList "run", "dev", "--prefix", "backend" -WorkingDirectory $root
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 1
      try {
        $r = Invoke-WebRequest -Uri "http://localhost:8787/api/health" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { Write-Host "Backend ready."; break }
      } catch {}
    }
  } else {
    if ($AuthBypass) { Write-Host "Warning: backend was already running before -AuthBypass env vars were set — restart it to pick them up." }
    Write-Host "Backend already running."
  }

  $frontendUp = $false
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    $frontendUp = ($r.StatusCode -eq 200)
  } catch {}

  if (-not $frontendUp) {
    Write-Host "Starting frontend on :5173 …"
    Start-Process -NoNewWindow -FilePath "npm.cmd" -ArgumentList "run", "dev", "--prefix", "frontend" -WorkingDirectory $root
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 1
      try {
        $r = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { Write-Host "Frontend ready."; break }
      } catch {}
    }
  } else {
    if ($AuthBypass) { Write-Host "Warning: frontend was already running before -AuthBypass env vars were set — restart it to pick them up." }
    Write-Host "Frontend already running."
  }
}

# --- Screenshot ---
Write-Host "Taking screenshot → $Screenshot"
$outDir = Split-Path -Parent $Screenshot
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

$tmpProfile = if ($AuthBypass) { "$env:TEMP\chrome-dahlia-driver-authbypass" } else { "$env:TEMP\chrome-dahlia-driver" }

if ($AuthBypass) {
  # Uses a dedicated profile directory, separate from the default (non-bypass)
  # profile — reusing the same profile would let a persisted emulator session
  # leak into normal runs and vice versa.
  #
  # Warm up the profile with a plain navigation first, so the emulator
  # sign-in round-trip completes and browserLocalPersistence caches the session
  # to disk. The real single-shot --screenshot capture below then rehydrates
  # from that cached session (a local disk read) instead of racing a live
  # network sign-in against the page's first render.
  Write-Host "Warming up auth bypass session…"
  $warmup = Start-Process -PassThru -NoNewWindow -FilePath $chrome -ArgumentList @(
    "--headless=new", "--disable-gpu", "--no-sandbox",
    "--user-data-dir=$tmpProfile", "--window-size=1400,900",
    "http://localhost:5173"
  )
  Start-Sleep -Seconds 6
  Stop-Process -Id $warmup.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  Get-ChildItem -Path $tmpProfile -Filter "Singleton*" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
}

& $chrome `
  --headless=new `
  --disable-gpu `
  --no-sandbox `
  "--user-data-dir=$tmpProfile" `
  "--screenshot=$Screenshot" `
  --window-size=1400,900 `
  --hide-scrollbars `
  "http://localhost:5173" 2>$null

Start-Sleep -Seconds 3
if (Test-Path $Screenshot) {
  $bytes = (Get-Item $Screenshot).Length
  Write-Host "Screenshot saved ($bytes bytes): $Screenshot"
} else {
  Write-Error "Screenshot was not created."
  exit 1
}

# --- Backend health ---
Write-Host "Backend health:"
Invoke-WebRequest -Uri "http://localhost:8787/api/health" -UseBasicParsing | Select-Object -ExpandProperty Content
