@echo off
:: ============================================================
:: 小楼 AI — 注册开机自启动
:: 将 start_background.ps1 写入当前用户注册表 Run 键，
:: Administrator 登录后自动后台启动所有服务。
:: ============================================================

set "PS1=%~dp0start_background.ps1"
set "REG_KEY=HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
set "REG_NAME=XiaolouAI"

echo.
echo [autostart] 注册 %REG_KEY%\%REG_NAME%
reg add "%REG_KEY%" /v "%REG_NAME%" /t REG_SZ /d "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%PS1%\"" /f

if %errorlevel%==0 (
    echo [autostart] 成功：下次 Administrator 登录时将自动后台启动所有服务。
    echo.
    echo   注册位置：%REG_KEY%\%REG_NAME%
    echo   启动脚本：%PS1%
    echo.
    echo   查看状态：powershell -ExecutionPolicy Bypass -File "%~dp0status.ps1"
    echo   删除自启：reg delete "%REG_KEY%" /v "%REG_NAME%" /f
    echo.
) else (
    echo [autostart] 失败，请检查权限后重试。
)

pause
