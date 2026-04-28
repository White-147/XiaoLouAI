# ============================================================
# XiaoLou AI -- Stop all background services
# ============================================================

$ROOT  = (Split-Path $PSScriptRoot -Parent)
$CADDY = "$ROOT\caddy\caddy.exe"

Write-Host ""
Write-Host "=== XiaoLou AI -- Stop All Services ===" -ForegroundColor Cyan
Write-Host ""

function Test-Port($port) {
    $out = netstat -ano 2>$null | Select-String ":$port\s+\S+\s+LISTENING"
    return ($null -ne $out -and ($out | Measure-Object).Count -gt 0)
}

function Stop-PortProcess($port, $label) {
    $lines = netstat -ano 2>$null | Select-String ":$port\s+\S+\s+LISTENING"
    if (-not $lines) {
        Write-Host "[$label] Not running on :$port, skipped." -ForegroundColor Yellow
        return
    }
    foreach ($line in $lines) {
        if ($line.Line -match '\s+(\d+)\s*$') {
            $procId = [int]$Matches[1]
            $killed = taskkill /PID $procId /T /F 2>&1
            Write-Host "[$label] Killed PID=$procId on :$port" -ForegroundColor Green
        }
    }
}

# Stop Caddy via its own CLI (clean shutdown)
if (Test-Path $CADDY) {
    $out = & $CADDY stop 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[caddy]    Stopped cleanly." -ForegroundColor Green
    } else {
        Write-Host "[caddy]    Not running or already stopped." -ForegroundColor Yellow
    }
} else {
    Write-Host "[caddy]    caddy.exe not found, skipped." -ForegroundColor Yellow
}

Stop-PortProcess 3000 "vite    "
Stop-PortProcess 4100 "core-api"
Stop-PortProcess 5174 "jaaz-ui "
Stop-PortProcess 57988 "jaaz-api"

# Verify
Start-Sleep -Seconds 1
Write-Host ""
Write-Host "Port check after stop:" -ForegroundColor DarkGray
foreach ($p in @(80, 443, 3000, 4100, 5174, 57988)) {
    if (Test-Port $p) {
        Write-Host "  :$p  still listening (may be another process)" -ForegroundColor Yellow
    } else {
        Write-Host "  :$p  released OK" -ForegroundColor Green
    }
}
Write-Host ""
