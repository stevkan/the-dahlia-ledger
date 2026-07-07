#!/usr/bin/env pwsh
# Driver for The Dahlia Ledger — starts dev servers and takes a screenshot.
# Usage: pwsh driver.ps1 [-Screenshot path\to\out.png] [-SkipServers]
#
# Requires:
#   - Node 22+  (node --version)
#   - Chrome at C:\Program Files\Google\Chrome\Application\chrome.exe
#   - frontend/.env and backend/.env populated (copies of .env.example)

param(
  [string]$Screenshot = "$env:TEMP\dahlia-screenshot.png",
  [switch]$SkipServers
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"

if (-not (Test-Path $chrome)) {
  Write-Error "Chrome not found at $chrome"
  exit 1
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
    Start-Process -NoNewWindow -FilePath "npm" -ArgumentList "run", "dev", "--prefix", "backend" -WorkingDirectory $root
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 1
      try {
        $r = Invoke-WebRequest -Uri "http://localhost:8787/api/health" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { Write-Host "Backend ready."; break }
      } catch {}
    }
  } else {
    Write-Host "Backend already running."
  }

  $frontendUp = $false
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    $frontendUp = ($r.StatusCode -eq 200)
  } catch {}

  if (-not $frontendUp) {
    Write-Host "Starting frontend on :5173 …"
    Start-Process -NoNewWindow -FilePath "npm" -ArgumentList "run", "dev", "--prefix", "frontend" -WorkingDirectory $root
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 1
      try {
        $r = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { Write-Host "Frontend ready."; break }
      } catch {}
    }
  } else {
    Write-Host "Frontend already running."
  }
}

# --- Screenshot ---
Write-Host "Taking screenshot → $Screenshot"
$outDir = Split-Path -Parent $Screenshot
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

$tmpProfile = "$env:TEMP\chrome-dahlia-driver"
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
