@echo off
setlocal
for %%I in ("%~dp0..") do set "ROOT=%%~fI"

set "NPM_CMD="
for /f "delims=" %%I in ('where npm.cmd 2^>nul') do (
    if not defined NPM_CMD set "NPM_CMD=%%I"
)
if not defined NPM_CMD if exist "C:\Program Files\nodejs\npm.cmd" set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
if not defined NPM_CMD (
    echo [ERROR] npm.cmd not found. Please install Node.js and add it to PATH.
    exit /b 1
)

set "FRONTEND_DIR=%ROOT%\XIAOLOU-main"
set "PREVIEW_LOG=%FRONTEND_DIR%\vite-preview.log"
set "PREVIEW_ERR=%FRONTEND_DIR%\vite-preview.err.log"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$cmd=('/d /s /c ""{0}"" run build >> ""{1}"" 2>> ""{2}"" && ""{0}"" run preview >> ""{1}"" 2>> ""{2}""' -f $env:NPM_CMD,$env:PREVIEW_LOG,$env:PREVIEW_ERR); $p=Start-Process -FilePath $env:ComSpec -ArgumentList $cmd -WorkingDirectory $env:FRONTEND_DIR -WindowStyle Hidden -PassThru; Write-Host ('[frontend] hidden preview PID=' + $p.Id)"
if errorlevel 1 exit /b 1
