# SPDX-FileCopyrightText: 2026 AutoCensor Project Owner and contributors
# SPDX-License-Identifier: MIT

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
$DesktopDist = Join-Path $Root "dist_desktop\AutoCensor"
$DesktopExe = Join-Path $DesktopDist "AutoCensor.exe"

$runningPackagedApps = Get-Process -Name AutoCensor -ErrorAction SilentlyContinue | Where-Object {
  try {
    $processPath = [string]$_.Path
    $processPath.Length -gt 0 -and $processPath.StartsWith($DesktopDist, [System.StringComparison]::OrdinalIgnoreCase)
  } catch {
    $false
  }
}

foreach ($process in $runningPackagedApps) {
  Write-Host "Stopping running packaged AutoCensor before rebuild: PID $($process.Id)"
  Stop-Process -Id $process.Id -Force -ErrorAction Stop
}

foreach ($process in $runningPackagedApps) {
  try {
    Wait-Process -Id $process.Id -Timeout 10 -ErrorAction SilentlyContinue
  } catch {
    # The process may already be gone by the time Wait-Process runs.
  }
}

npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
python scripts/generate_app_icon.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
python -m PyInstaller --noconfirm --clean --distpath "$Root\dist_desktop" --workpath "$Root\build\pyinstaller" AutoCensor.spec
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Desktop build written to: $DesktopExe"
