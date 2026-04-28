@echo off
:: ============================================================
:: 小楼 AI — 后台静默启动（双击运行）
:: 以管理员身份运行可同时启动 Caddy（80/443 端口需要管理员权限）
:: ============================================================

:: 检测管理员权限，若无则请求提权
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [启动器] 正在请求管理员权限...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

set "SCRIPTS_DIR=%~dp0"
set "PS1=%SCRIPTS_DIR%start_background.ps1"

if not exist "%PS1%" (
    echo [错误] 找不到 start_background.ps1: %PS1%
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
pause
