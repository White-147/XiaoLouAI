@echo off
setlocal

echo ============================================================
echo  XiaoLou Full Stack (dev mode)
echo ============================================================
echo.
echo  Starting core-api    (port 4100) ...
echo  Starting XIAOLOU-main (port 3000) ...
echo.

set "ROOT=%~dp0.."

REM Locate npm: prefer system PATH, fall back to common Windows install location
where npm >nul 2>&1
if %errorlevel%==0 (
    set "NPM_CMD=npm"
) else if exist "C:\Program Files\nodejs\npm.cmd" (
    set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
) else (
    echo [ERROR] npm not found. Please install Node.js (https://nodejs.org/) and add it to PATH.
    pause
    exit /b 1
)

pushd "%ROOT%\core-api"
start "core-api [4100]" /min "%ComSpec%" /c ""%NPM_CMD%" run dev"
popd

pushd "%ROOT%\XIAOLOU-main"
start "XIAOLOU-main [3000]" /min "%ComSpec%" /c ""%NPM_CMD%" run dev"
popd

echo.
echo  core-api:      http://127.0.0.1:4100
echo  XIAOLOU-main:  http://127.0.0.1:3000
echo.
echo  Open WebUI (optional): run scripts\start_openwebui.cmd separately
echo  Public tunnel should forward to http://127.0.0.1:3000
echo.
echo  Press any key to close this launcher window (servers keep running).
pause > nul
