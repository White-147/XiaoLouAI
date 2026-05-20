# ============================================================
# XiaoLou AI -- Background Silent Startup
# Usage: powershell -ExecutionPolicy Bypass -File start_background.ps1
#        or double-click start_background.cmd (auto-elevates)
# ============================================================

$ErrorActionPreference = "Continue"

$ROOT = (Split-Path $PSScriptRoot -Parent)
$runtimeStateRoot = if ($env:XIAOLOU_RUNTIME_ROOT) { $env:XIAOLOU_RUNTIME_ROOT } else { Join-Path $ROOT ".runtime" }
$CACHE_ROOT = "D:\soft\cache"
$PROGRAM_ROOT = "D:\soft\program"
$TEMP_ROOT = "D:\soft\temp"
$HF_ROOT = Join-Path $CACHE_ROOT "huggingface"

New-Item -ItemType Directory -Force -Path $CACHE_ROOT, $PROGRAM_ROOT, $TEMP_ROOT, (Join-Path $CACHE_ROOT "npm"), (Join-Path $PROGRAM_ROOT "nodejs\node_global") | Out-Null
$env:XIAOLOU_SHARED_CACHE_ROOT = $CACHE_ROOT
$env:XIAOLOU_SHARED_PROGRAM_ROOT = $PROGRAM_ROOT
$env:XIAOLOU_SHARED_TEMP_ROOT = $TEMP_ROOT
$env:TMP = $TEMP_ROOT
$env:TEMP = $TEMP_ROOT
$env:XDG_CACHE_HOME = Join-Path $CACHE_ROOT "tooling-cache"
$env:NPM_CONFIG_CACHE = Join-Path $CACHE_ROOT "npm"
$env:NPM_CONFIG_PREFIX = Join-Path $PROGRAM_ROOT "nodejs\node_global"
$env:PIP_CACHE_DIR = Join-Path $CACHE_ROOT "pip"
$env:UV_CACHE_DIR = Join-Path $CACHE_ROOT "uv"
$env:POETRY_CACHE_DIR = Join-Path $CACHE_ROOT "poetry"
$env:PIPENV_CACHE_DIR = Join-Path $CACHE_ROOT "pipenv"
$env:HF_HOME = $HF_ROOT
$env:HUGGINGFACE_HUB_CACHE = Join-Path $HF_ROOT "hub"
$env:TRANSFORMERS_CACHE = Join-Path $HF_ROOT "transformers"
$env:TORCH_HOME = Join-Path $CACHE_ROOT "torch"
$env:MODELSCOPE_CACHE = Join-Path $CACHE_ROOT "modelscope"
$env:CUDA_CACHE_PATH = Join-Path $CACHE_ROOT "cuda\compute-cache"
$env:VR_WEIGHTS_ROOT = Join-Path $CACHE_ROOT "xiaolou-video-replace-weights"

function Resolve-WorkspacePath($path, $fallback) {
    $value = if ($path) { $path } else { $fallback }
    if ([System.IO.Path]::IsPathRooted($value)) {
        return [System.IO.Path]::GetFullPath($value)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $ROOT $value))
}

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
$legacyCoreApiRoot = Resolve-WorkspacePath $env:LEGACY_CORE_API_ROOT "legacy\core-api"
$legacyJaazRoot = Resolve-WorkspacePath $env:LEGACY_JAAZ_ROOT "legacy\jaaz"
$coreLog = Join-Path $legacyCoreApiRoot "core-api.log"
$coreErr = Join-Path $legacyCoreApiRoot "core-api.err.log"
$coreServer = Join-Path $legacyCoreApiRoot "src\server.js"
$corePgPackage = Join-Path $legacyCoreApiRoot "node_modules\pg\package.json"
$legacyCoreApiLaunchSkipped = $false

if (Test-Port 4100) {
    Write-Host "[legacy-only core-api] Already running on :4100, skipping." -ForegroundColor Yellow
} elseif (-not (Test-Path $coreServer)) {
    $legacyCoreApiLaunchSkipped = $true
    Write-Host "[legacy-only core-api] Source not found, skipping: $legacyCoreApiRoot" -ForegroundColor Yellow
} elseif (-not (Test-Path $corePgPackage)) {
    $legacyCoreApiLaunchSkipped = $true
    Write-Host "[legacy-only core-api] Generated node dependency material is missing, skipping: $corePgPackage" -ForegroundColor Yellow
} else {
    Rotate-Log $coreLog
    Rotate-Log $coreErr
    $proc = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c node src/server.js >> `"$coreLog`" 2>> `"$coreErr`"" `
        -WorkingDirectory $legacyCoreApiRoot `
        -WindowStyle Hidden `
        -PassThru
    Write-Host "[legacy-only core-api] Started  PID=$($proc.Id)" -ForegroundColor Green
    Write-Host "                  Root: $legacyCoreApiRoot" -ForegroundColor DarkGray
    Write-Host "                  Log:  $coreLog" -ForegroundColor DarkGray
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
$jaazServerLog = Join-Path $legacyJaazRoot "jaaz-server-57988.out.log"
$jaazServerErr = Join-Path $legacyJaazRoot "jaaz-server-57988.err.log"
$jaazPython = Join-Path $legacyJaazRoot ".venv\Scripts\python.exe"
$jaazServerRoot = Join-Path $legacyJaazRoot "server"

if (Test-Port 57988) {
    Write-Host "[jaaz-api] Already running on :57988, skipping." -ForegroundColor Yellow
} elseif (-not (Test-Path $jaazServerRoot)) {
    Write-Host "[jaaz-api] Legacy server source not found, skipping: $jaazServerRoot" -ForegroundColor Yellow
} elseif (-not (Test-Path $jaazPython)) {
    Write-Host "[jaaz-api] Python venv not found, skipping: $jaazPython" -ForegroundColor Yellow
} else {
    Rotate-Log $jaazServerLog
    Rotate-Log $jaazServerErr
    $proc3 = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c `"$jaazPython`" main.py --port 57988 >> `"$jaazServerLog`" 2>> `"$jaazServerErr`"" `
        -WorkingDirectory $jaazServerRoot `
        -WindowStyle Hidden `
        -PassThru
    Write-Host "[jaaz-api] Started  PID=$($proc3.Id)" -ForegroundColor Green
    Write-Host "           Root: $legacyJaazRoot" -ForegroundColor DarkGray
    Write-Host "           Log:  $jaazServerLog" -ForegroundColor DarkGray
}

# ===========================================================
# 4. Jaaz frontend  (port 5174)
# ===========================================================
$jaazReactRoot = Join-Path $legacyJaazRoot "react"
$jaazViteLog = Join-Path $jaazReactRoot "vite-dev.log"
$jaazViteErr = Join-Path $jaazReactRoot "vite-dev.err.log"
$jaazReactPackage = Join-Path $jaazReactRoot "package.json"
$jaazReactNodeModules = Join-Path $jaazReactRoot "node_modules"

if (Test-Port 5174) {
    Write-Host "[jaaz-ui]  Already running on :5174, skipping." -ForegroundColor Yellow
} elseif (-not (Test-Path $jaazReactPackage)) {
    Write-Host "[jaaz-ui]  Legacy React source not found, skipping: $jaazReactRoot" -ForegroundColor Yellow
} elseif (-not (Test-Path $jaazReactNodeModules)) {
    Write-Host "[jaaz-ui]  Generated node dependency material is missing, skipping: $jaazReactNodeModules" -ForegroundColor Yellow
} else {
    Rotate-Log $jaazViteLog
    Rotate-Log $jaazViteErr
    $proc4 = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c npm run dev >> `"$jaazViteLog`" 2>> `"$jaazViteErr`"" `
        -WorkingDirectory $jaazReactRoot `
        -WindowStyle Hidden `
        -PassThru
    Write-Host "[jaaz-ui]  Started  PID=$($proc4.Id)" -ForegroundColor Green
    Write-Host "           Root: $legacyJaazRoot" -ForegroundColor DarkGray
    Write-Host "           Log:  $jaazViteLog" -ForegroundColor DarkGray
}

# ===========================================================
# Wait for legacy core-api to be ready (up to 20s)
# ===========================================================
Write-Host ""
if ($legacyCoreApiLaunchSkipped) {
    Write-Host "Legacy-only core-api launch skipped; not waiting for :4100."
} else {
    Write-Host "Waiting for legacy core-api..." -NoNewline
    $waited = 0
    while (-not (Test-Port 4100) -and $waited -lt 20) {
        Start-Sleep -Seconds 1
        $waited++
        Write-Host "." -NoNewline
    }
}
Write-Host ""

# ===========================================================
# Summary
# ===========================================================
Write-Host ""
Write-Host "--- Port status ---" -ForegroundColor DarkGray

if (Test-Port 4100) { Write-Host "  legacy-only core-api :4100  OK" -ForegroundColor Green } `
elseif ($legacyCoreApiLaunchSkipped) { Write-Host "  legacy-only core-api :4100  skipped (legacy deps/source absent)" -ForegroundColor Yellow } `
else                 { Write-Host "  legacy-only core-api :4100  TIMEOUT (check $coreLog)" -ForegroundColor Red }

if (Test-Port 3000) { Write-Host "  Vite      :3000  OK" -ForegroundColor Green } `
else                 { Write-Host "  Vite      :3000  starting... (check vite-dev.log)" -ForegroundColor Yellow }

if (Test-Port 57988) { Write-Host "  Jaaz API  :57988 OK" -ForegroundColor Green } `
else                 { Write-Host "  Jaaz API  :57988 not listening (check $jaazServerErr)" -ForegroundColor Yellow }

if (Test-Port 5174) { Write-Host "  Jaaz UI   :5174  OK" -ForegroundColor Green } `
else                { Write-Host "  Jaaz UI   :5174  starting... (check $jaazViteLog)" -ForegroundColor Yellow }

Write-Host ""
Write-Host "Access:" -ForegroundColor Cyan
Write-Host "  http://127.0.0.1:3000             local"
Write-Host ""
Write-Host "Commands:" -ForegroundColor DarkGray
Write-Host "  Status:  powershell -ExecutionPolicy Bypass -File scripts\status.ps1"
Write-Host "  Stop:    powershell -ExecutionPolicy Bypass -File scripts\stop_all.ps1"
Write-Host ""
