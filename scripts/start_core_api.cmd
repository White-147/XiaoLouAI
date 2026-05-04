@echo off
setlocal
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
if not defined XIAOLOU_RUNTIME_ROOT set "XIAOLOU_RUNTIME_ROOT=%ROOT%\.runtime"

set "CACHE_ROOT=%XIAOLOU_RUNTIME_ROOT%\xiaolou-cache\legacy-cache"
set "XDG_CACHE_HOME=%CACHE_ROOT%"
set "PIP_CACHE_DIR=%CACHE_ROOT%\pip"
set "HF_HOME=%CACHE_ROOT%\huggingface"
set "HUGGINGFACE_HUB_CACHE=%CACHE_ROOT%\huggingface\hub"
set "TRANSFORMERS_CACHE=%CACHE_ROOT%\huggingface\transformers"
set "TORCH_HOME=%CACHE_ROOT%\torch"
if not exist "%CACHE_ROOT%" mkdir "%CACHE_ROOT%" >nul 2>&1

set "NODE_BIN="
if exist "D:\soft\program\nodejs\node.exe" set "NODE_BIN=D:\soft\program\nodejs\node.exe"
if not defined NODE_BIN (
    echo [ERROR] D:\soft\program\nodejs\node.exe not found. Install Node.js to D: or set NODE_BIN explicitly in a D: runtime shell.
    exit /b 1
)

if not defined LEGACY_CORE_API_ROOT set "LEGACY_CORE_API_ROOT=%ROOT%\legacy\core-api"

REM video-replace Python venv is used by core-api subprocesses. No sidecar is required.
set "VR_SERVICE_DIR=%ROOT%\tools\video\video-replace-service"
if not exist "%VR_SERVICE_DIR%\vr_probe_cli.py" (
    if exist "%LEGACY_CORE_API_ROOT%\video-replace-service\vr_probe_cli.py" set "VR_SERVICE_DIR=%LEGACY_CORE_API_ROOT%\video-replace-service"
)
set "VR_VENV_PY=%VR_SERVICE_DIR%\.venv\Scripts\python.exe"
if not exist "%VR_VENV_PY%" (
    echo [WARN] video-replace-service venv not found: %VR_VENV_PY%
    echo [WARN] core-api will still start, but /api/video-replace calls will fail
    echo [WARN] until the venv is ready. Run scripts\setup_video_replace.cmd manually.
)

REM core-api (4100): idempotent, skip if already listening.
set "CORE_API_RUNNING=0"
netstat -ano | findstr /r /c:":4100 .*LISTENING" >nul 2>&1 && set "CORE_API_RUNNING=1"
if "%CORE_API_RUNNING%"=="1" (
    echo [legacy backend] core-api already listening on 4100, skipping restart.
    goto :eof
)

set "CORE_DIR=%LEGACY_CORE_API_ROOT%"
set "CORE_LOG=%CORE_DIR%\core-api.log"
set "CORE_ERR=%CORE_DIR%\core-api.err.log"
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$p=Start-Process -FilePath $env:NODE_BIN -ArgumentList 'src/server.js' -WorkingDirectory $env:CORE_DIR -RedirectStandardOutput $env:CORE_LOG -RedirectStandardError $env:CORE_ERR -WindowStyle Hidden -PassThru; Write-Host ('[backend] hidden core-api PID=' + $p.Id)"
if errorlevel 1 exit /b 1

echo [legacy backend] core-api root: %CORE_DIR%
echo [legacy backend] core-api started on port 4100.
echo [legacy backend] All video-replace routes (/api/video-replace, /vr-*) are handled natively by core-api.
echo [legacy backend] No separate sidecar process is required.
exit /b 0
