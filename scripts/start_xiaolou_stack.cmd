@echo off
setlocal

echo.
echo ============================================================
echo XiaoLou AI local stack
echo ============================================================
echo Ports:
echo   3000   XIAOLOU-main Vite frontend
echo   4100   core-api backend + video replace routes
echo   5174   Jaaz UI
echo   57988  Jaaz API
echo.
echo Access:
echo   http://127.0.0.1:3000
echo.

call "%~dp0start_background.cmd"
