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

pushd "%ROOT%\core-api"
start "core-api [4100]" /min "%ComSpec%" /c ""%NPM_CMD%" run dev > core-api.log 2> core-api.err.log"
popd
