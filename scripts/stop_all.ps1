# ============================================================
# XiaoLou AI -- Stop all background services
# ============================================================

$ROOT = (Split-Path $PSScriptRoot -Parent)

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

Stop-PortProcess 3000 "vite    "
Stop-PortProcess 4100 "legacy core-api"
Stop-PortProcess 5174 "jaaz-ui "
Stop-PortProcess 57988 "jaaz-api"

# Verify
Start-Sleep -Seconds 1
Write-Host ""
Write-Host "Port check after stop:" -ForegroundColor DarkGray
foreach ($p in @(3000, 4100, 5174, 57988)) {
    if (Test-Port $p) {
        Write-Host "  :$p  still listening (may be another process)" -ForegroundColor Yellow
    } else {
        Write-Host "  :$p  released OK" -ForegroundColor Green
    }
}
Write-Host ""
