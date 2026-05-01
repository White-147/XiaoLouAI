@echo off
setlocal
for %%I in ("%~dp0..") do set "ROOT=%%~fI"

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
powershell -NoProfile -ExecutionPolicy Bypass -Command "$argsList=@('run','dev'); if ($env:DEV_ARGS) { $argsList += ($env:DEV_ARGS -split ' ') }; $p=Start-Process -FilePath $env:NPM_CMD -ArgumentList $argsList -WorkingDirectory $env:FRONTEND_DIR -RedirectStandardOutput $env:VITE_LOG -RedirectStandardError $env:VITE_ERR -WindowStyle Hidden -PassThru; Write-Host ('[frontend] hidden Vite PID=' + $p.Id)"
if errorlevel 1 exit /b 1
