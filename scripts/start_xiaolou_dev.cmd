@echo off
setlocal
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "XIAOLOU_SHARED_CACHE_ROOT=D:\soft\cache"
set "XIAOLOU_SHARED_PROGRAM_ROOT=D:\soft\program"
set "XIAOLOU_SHARED_TEMP_ROOT=D:\soft\temp"
set "TMP=%XIAOLOU_SHARED_TEMP_ROOT%"
set "TEMP=%XIAOLOU_SHARED_TEMP_ROOT%"
set "NPM_CONFIG_CACHE=%XIAOLOU_SHARED_CACHE_ROOT%\npm"
set "NPM_CONFIG_PREFIX=%XIAOLOU_SHARED_PROGRAM_ROOT%\nodejs\node_global"
if not exist "%NPM_CONFIG_CACHE%" mkdir "%NPM_CONFIG_CACHE%" >nul 2>&1
if not exist "%NPM_CONFIG_PREFIX%" mkdir "%NPM_CONFIG_PREFIX%" >nul 2>&1
if not exist "%TEMP%" mkdir "%TEMP%" >nul 2>&1

set "DEV_ARGS="
if not "%~1"=="" set "DEV_ARGS=-- %*"

set "NPM_CMD="
if exist "D:\soft\program\nodejs\npm.cmd" set "NPM_CMD=D:\soft\program\nodejs\npm.cmd"
if not defined NPM_CMD (
    echo [ERROR] D:\soft\program\nodejs\npm.cmd not found. Install Node.js to D: or set NPM_CMD explicitly in a D: runtime shell.
    exit /b 1
)

set "FRONTEND_DIR=%ROOT%\XIAOLOU-main"
set "VITE_LOG=%FRONTEND_DIR%\vite-dev.log"
set "VITE_ERR=%FRONTEND_DIR%\vite-dev.err.log"
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$argsList=@('run','dev'); if ($env:DEV_ARGS) { $argsList += ($env:DEV_ARGS -split ' ') }; $p=Start-Process -FilePath $env:NPM_CMD -ArgumentList $argsList -WorkingDirectory $env:FRONTEND_DIR -RedirectStandardOutput $env:VITE_LOG -RedirectStandardError $env:VITE_ERR -WindowStyle Hidden -PassThru; Write-Host ('[frontend] hidden Vite PID=' + $p.Id)"
if errorlevel 1 exit /b 1
exit /b 0
