# ============================================================
# XiaoLou AI -- Background Silent Startup
# Usage: powershell -ExecutionPolicy Bypass -File start_background.ps1
#        or double-click start_background.cmd (auto-elevates)
# ============================================================

$ErrorActionPreference = "Continue"

$ROOT = (Split-Path $PSScriptRoot -Parent)

function Test-Port($port) {
    $out = netstat -ano 2>$null | Select-String ":$port\s+\S+\s+LISTENING"
    return ($null -ne $out -and ($out | Measure-Object).Count -gt 0)
}

function Rotate-Log($path) {
    if (Test-Path $path) {
        if ((Get-Item $path).Length -gt 5MB) {
            $ts = Get-Date -Format "yyyyMMdd_HHmmss"
            Rename-Item $path ($path -replace '\.log$', "_$ts.log") -Force
        }
    }
}

Write-Host ""
Write-Host "=== XiaoLou AI -- Background Service Launcher ===" -ForegroundColor Cyan
Write-Host ""

# ===========================================================
# 1. core-api  (port 4100)
# ===========================================================
$coreLog = "$ROOT\core-api\core-api.log"
$coreErr = "$ROOT\core-api\core-api.err.log"

if (Test-Port 4100) {
    Write-Host "[core-api] Already running on :4100, skipping." -ForegroundColor Yellow
} else {
    Rotate-Log $coreLog
    Rotate-Log $coreErr
    $proc = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c node src/server.js >> `"$coreLog`" 2>> `"$coreErr`"" `
        -WorkingDirectory "$ROOT\core-api" `
        -WindowStyle Hidden `
        -PassThru
    Write-Host "[core-api] Started  PID=$($proc.Id)" -ForegroundColor Green
    Write-Host "           Log: core-api\core-api.log" -ForegroundColor DarkGray
}

# ===========================================================
# 2. Vite frontend  (port 3000)
# ===========================================================
$viteLog = "$ROOT\XIAOLOU-main\vite-dev.log"
$viteErr = "$ROOT\XIAOLOU-main\vite-dev.err.log"

if (Test-Port 3000) {
    Write-Host "[vite]     Already running on :3000, skipping." -ForegroundColor Yellow
} else {
    Rotate-Log $viteLog
    Rotate-Log $viteErr
    $proc2 = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c npm run dev >> `"$viteLog`" 2>> `"$viteErr`"" `
        -WorkingDirectory "$ROOT\XIAOLOU-main" `
        -WindowStyle Hidden `
        -PassThru
    Write-Host "[vite]     Started  PID=$($proc2.Id)" -ForegroundColor Green
    Write-Host "           Log: XIAOLOU-main\vite-dev.log" -ForegroundColor DarkGray
}

# ===========================================================
# 3. Jaaz server  (port 57988)
# ===========================================================
$jaazServerLog = "$ROOT\jaaz\jaaz-server-57988.out.log"
$jaazServerErr = "$ROOT\jaaz\jaaz-server-57988.err.log"
$jaazPython = "$ROOT\jaaz\.venv\Scripts\python.exe"

if (Test-Port 57988) {
    Write-Host "[jaaz-api] Already running on :57988, skipping." -ForegroundColor Yellow
} elseif (-not (Test-Path $jaazPython)) {
    Write-Host "[jaaz-api] Python venv not found, skipping: $jaazPython" -ForegroundColor Red
} else {
    Rotate-Log $jaazServerLog
    Rotate-Log $jaazServerErr
    $proc3 = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c `"$jaazPython`" main.py --port 57988 >> `"$jaazServerLog`" 2>> `"$jaazServerErr`"" `
        -WorkingDirectory "$ROOT\jaaz\server" `
        -WindowStyle Hidden `
        -PassThru
    Write-Host "[jaaz-api] Started  PID=$($proc3.Id)" -ForegroundColor Green
    Write-Host "           Log: jaaz\jaaz-server-57988.out.log" -ForegroundColor DarkGray
}

# ===========================================================
# 4. Jaaz frontend  (port 5174)
# ===========================================================
$jaazViteLog = "$ROOT\jaaz\react\vite-dev.log"
$jaazViteErr = "$ROOT\jaaz\react\vite-dev.err.log"

if (Test-Port 5174) {
    Write-Host "[jaaz-ui]  Already running on :5174, skipping." -ForegroundColor Yellow
} else {
    Rotate-Log $jaazViteLog
    Rotate-Log $jaazViteErr
    $proc4 = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c npm run dev >> `"$jaazViteLog`" 2>> `"$jaazViteErr`"" `
        -WorkingDirectory "$ROOT\jaaz\react" `
        -WindowStyle Hidden `
        -PassThru
    Write-Host "[jaaz-ui]  Started  PID=$($proc4.Id)" -ForegroundColor Green
    Write-Host "           Log: jaaz\react\vite-dev.log" -ForegroundColor DarkGray
}

# ===========================================================
# Wait for core-api to be ready (up to 20s)
# ===========================================================
Write-Host ""
Write-Host "Waiting for core-api..." -NoNewline
$waited = 0
while (-not (Test-Port 4100) -and $waited -lt 20) {
    Start-Sleep -Seconds 1
    $waited++
    Write-Host "." -NoNewline
}
Write-Host ""

# ===========================================================
# Summary
# ===========================================================
Write-Host ""
Write-Host "--- Port status ---" -ForegroundColor DarkGray

if (Test-Port 4100) { Write-Host "  core-api  :4100  OK" -ForegroundColor Green } `
else                 { Write-Host "  core-api  :4100  TIMEOUT (check core-api.log)" -ForegroundColor Red }

if (Test-Port 3000) { Write-Host "  Vite      :3000  OK" -ForegroundColor Green } `
else                 { Write-Host "  Vite      :3000  starting... (check vite-dev.log)" -ForegroundColor Yellow }

if (Test-Port 57988) { Write-Host "  Jaaz API  :57988 OK" -ForegroundColor Green } `
else                 { Write-Host "  Jaaz API  :57988 not listening (check jaaz-server-57988.err.log)" -ForegroundColor Yellow }

if (Test-Port 5174) { Write-Host "  Jaaz UI   :5174  OK" -ForegroundColor Green } `
else                { Write-Host "  Jaaz UI   :5174  starting... (check jaaz\react\vite-dev.log)" -ForegroundColor Yellow }

Write-Host ""
Write-Host "Access:" -ForegroundColor Cyan
Write-Host "  http://127.0.0.1:3000             local"
Write-Host ""
Write-Host "Commands:" -ForegroundColor DarkGray
Write-Host "  Status:  powershell -ExecutionPolicy Bypass -File scripts\status.ps1"
Write-Host "  Stop:    powershell -ExecutionPolicy Bypass -File scripts\stop_all.ps1"
Write-Host ""
