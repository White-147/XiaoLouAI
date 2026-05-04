# ============================================================
# XiaoLou AI -- Service status & log tail
# ============================================================

$ROOT = (Split-Path $PSScriptRoot -Parent)

function Resolve-WorkspacePath($path, $fallback) {
    $value = if ($path) { $path } else { $fallback }
    if ([System.IO.Path]::IsPathRooted($value)) {
        return [System.IO.Path]::GetFullPath($value)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $ROOT $value))
}

$legacyCoreApiRoot = Resolve-WorkspacePath $env:LEGACY_CORE_API_ROOT "legacy\core-api"
$legacyJaazRoot = Resolve-WorkspacePath $env:LEGACY_JAAZ_ROOT "legacy\jaaz"

function Test-Port($port) {
    $out = netstat -ano 2>$null | Select-String ":$port\s+\S+\s+LISTENING"
    return ($null -ne $out -and ($out | Measure-Object).Count -gt 0)
}

function Get-PidForPort($port) {
    $line = (netstat -ano 2>$null | Select-String ":$port\s+\S+\s+LISTENING" | Select-Object -First 1)
    if ($line -and $line.Line -match '\s+(\d+)\s*$') { return [int]$Matches[1] }
    return $null
}

function Show-LogTail($path, $label, $lines = 15) {
    Write-Host ""
    Write-Host "--- $label ---" -ForegroundColor DarkGray
    if (Test-Path $path) {
        $content = Get-Content $path -Tail $lines -ErrorAction SilentlyContinue
        if ($content) { $content | ForEach-Object { Write-Host "  $_" } }
        else { Write-Host "  (empty)" -ForegroundColor DarkGray }
    } else {
        Write-Host "  (file not found: $path)" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "=== XiaoLou AI -- Service Status ===" -ForegroundColor Cyan
Write-Host ""

$services = @(
    @{ Port = 4100; Label = "legacy core-api" },
    @{ Port = 3000; Label = "Vite    " },
    @{ Port = 57988; Label = "Jaaz API" },
    @{ Port = 5174; Label = "Jaaz UI " }
)

foreach ($svc in $services) {
    if (Test-Port $svc.Port) {
        $procId = Get-PidForPort $svc.Port
        $procObj  = if ($procId) { Get-Process -Id $procId -ErrorAction SilentlyContinue } else { $null }
        $procName = if ($procObj) { $procObj.ProcessName } else { "?" }
        Write-Host "  [OK ] $($svc.Label)  :$($svc.Port)  PID=$procId  ($procName)" -ForegroundColor Green
    } else {
        Write-Host "  [---] $($svc.Label)  :$($svc.Port)  not listening" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Access:" -ForegroundColor Cyan
Write-Host "  http://127.0.0.1:3000        local"

# Log tails
Write-Host ""
Write-Host "Recent logs (last 15 lines):" -ForegroundColor Cyan
Show-LogTail (Join-Path $legacyCoreApiRoot "core-api.log") "legacy core-api"
Show-LogTail "$ROOT\XIAOLOU-main\vite-dev.log" "Vite"
Show-LogTail (Join-Path $legacyJaazRoot "jaaz-server-57988.out.log") "Jaaz API"
Show-LogTail (Join-Path $legacyJaazRoot "react\vite-dev.log") "Jaaz UI"

Write-Host ""
Write-Host "Commands:" -ForegroundColor DarkGray
Write-Host "  Start:  powershell -ExecutionPolicy Bypass -File scripts\start_background.ps1"
Write-Host "  Stop:   powershell -ExecutionPolicy Bypass -File scripts\stop_all.ps1"
Write-Host ""
