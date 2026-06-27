# SPDX-FileCopyrightText: 2026 AutoCensor Project Owner and contributors
# SPDX-License-Identifier: MIT

param(
  [string]$HostAddress = "127.0.0.1",
  [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend\autocensor_server.py"
$StaticDir = Join-Path $Root "dist"

$Python = Get-Command python -ErrorAction SilentlyContinue
if ($Python) {
  & $Python.Source $Backend --host $HostAddress --port $Port --static-dir $StaticDir
  exit $LASTEXITCODE
}

$PyLauncher = Get-Command py -ErrorAction SilentlyContinue
if ($PyLauncher) {
  & $PyLauncher.Source -3 $Backend --host $HostAddress --port $Port --static-dir $StaticDir
  exit $LASTEXITCODE
}

throw "Python 3 was not found. Install Python 3.10+ and enable PATH, or install the Windows py launcher."
