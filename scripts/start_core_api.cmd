@echo off
setlocal
for %%I in ("%~dp0..") do set "ROOT=%%~fI"

set "XDG_CACHE_HOME=%ROOT%\.cache"
set "PIP_CACHE_DIR=%ROOT%\.cache\pip"
set "HF_HOME=%ROOT%\.cache\huggingface"
set "HUGGINGFACE_HUB_CACHE=%ROOT%\.cache\huggingface\hub"
set "TRANSFORMERS_CACHE=%ROOT%\.cache\huggingface\transformers"
set "TORCH_HOME=%ROOT%\.cache\torch"

set "NODE_BIN="
for /f "delims=" %%I in ('where node 2^>nul') do (
    if not defined NODE_BIN set "NODE_BIN=%%I"
)
if not defined NODE_BIN if exist "C:\Program Files\nodejs\node.exe" set "NODE_BIN=C:\Program Files\nodejs\node.exe"
if not defined NODE_BIN (
    echo [ERROR] node.exe not found. Please install Node.js and add it to PATH.
    exit /b 1
)

REM video-replace Python venv is used by core-api subprocesses. No sidecar is required.
set "VR_SERVICE_DIR=%ROOT%\core-api\video-replace-service"
if not exist "%VR_SERVICE_DIR%\vr_probe_cli.py" (
    if exist "%ROOT%\video-replace-service\vr_probe_cli.py" set "VR_SERVICE_DIR=%ROOT%\video-replace-service"
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
    echo [backend] core-api already listening on 4100, skipping restart.
    goto :eof
)

set "CORE_DIR=%ROOT%\core-api"
set "CORE_LOG=%CORE_DIR%\core-api.log"
set "CORE_ERR=%CORE_DIR%\core-api.err.log"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Start-Process -FilePath $env:NODE_BIN -ArgumentList 'src/server.js' -WorkingDirectory $env:CORE_DIR -RedirectStandardOutput $env:CORE_LOG -RedirectStandardError $env:CORE_ERR -WindowStyle Hidden -PassThru; Write-Host ('[backend] hidden core-api PID=' + $p.Id)"
if errorlevel 1 exit /b 1

echo [backend] core-api started on port 4100.
echo [backend] All video-replace routes (/api/video-replace, /vr-*) are handled natively by core-api.
echo [backend] No separate sidecar process is required.
