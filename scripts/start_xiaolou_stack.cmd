@echo off
setlocal

echo.
echo ============================================================
echo XiaoLou AI local stack
echo ============================================================
echo Ports:
echo   3000   XIAOLOU-main Vite frontend
echo   4100   legacy-only core-api backend + video replace routes
echo   5174   Jaaz UI
echo   57988  Jaaz API
echo.
echo Legacy core-api archive root defaults to legacy\core-api and can be overridden with LEGACY_CORE_API_ROOT.
echo Legacy Jaaz archive root defaults to legacy\jaaz and can be overridden with LEGACY_JAAZ_ROOT.
echo Legacy-only launchers skip missing archive roots or generated dependencies by default.
echo.
echo Access:
echo   http://127.0.0.1:3000
echo.

call "%~dp0start_background.cmd"
exit /b %ERRORLEVEL%
