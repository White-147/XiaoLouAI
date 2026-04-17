@echo off
setlocal
set "ROOT=%~dp0.."

where npm >nul 2>&1
if %errorlevel%==0 (
    set "NPM_CMD=npm"
) else if exist "C:\Program Files\nodejs\npm.cmd" (
    set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
) else (
    echo [ERROR] npm not found. Please install Node.js and add it to PATH.
    exit /b 1
)

pushd "%ROOT%\XIAOLOU-main"
start "XIAOLOU preview [3000]" /min "%ComSpec%" /c ""%NPM_CMD%" run build && "%NPM_CMD%" run preview > vite-preview.log 2> vite-preview.err.log"
popd
