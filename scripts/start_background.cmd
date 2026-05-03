@echo off
setlocal

set "SCRIPTS_DIR=%~dp0"
set "PS1=%SCRIPTS_DIR%start_background.ps1"

if not exist "%PS1%" (
    echo [error] start_background.ps1 not found: %PS1%
    exit /b 1
)

powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%PS1%"
exit /b %ERRORLEVEL%
