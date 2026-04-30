@echo off
REM Start or recreate the Open WebUI container for XiaoLou Playground.
REM Requires Docker. Port 8080 is optional — skip this if you don't need Playground.

setlocal

set "SCRIPT_DIR=%~dp0"
set "ENV_FILE=%SCRIPT_DIR%openwebui.env.local"

REM ------------------------------------------------------------------
REM Load config from scripts/openwebui.env.local
REM Copy scripts/openwebui.env.example → scripts/openwebui.env.local
REM and fill in your values before running this script.
REM ------------------------------------------------------------------
if not exist "%ENV_FILE%" (
    echo [ERROR] Missing config: %ENV_FILE%
    echo.
    echo  Please copy scripts\openwebui.env.example to scripts\openwebui.env.local
    echo  and fill in your OPENAI_API_KEY and WEBUI_PUBLIC_URL.
    echo.
    exit /b 1
)

REM Parse key=value pairs from the env file (skip comment lines)
for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
    set "LINE=%%A"
    if not "!LINE:~0,1!"=="#" (
        set "%%A=%%B"
    )
)

REM Re-parse without delayed expansion to avoid issues
setlocal enabledelayedexpansion
for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
    set "FIRSTCHAR=%%A"
    set "FIRSTCHAR=!FIRSTCHAR:~0,1!"
    if not "!FIRSTCHAR!"=="#" (
        set "%%A=%%B"
    )
)

REM Validate required variables
if not defined OPENAI_API_KEY (
    echo [ERROR] OPENAI_API_KEY is not set in %ENV_FILE%
    exit /b 1
)
if not defined WEBUI_PUBLIC_URL (
    echo [WARN] WEBUI_PUBLIC_URL not set, defaulting to http://127.0.0.1:8080
    set "WEBUI_PUBLIC_URL=http://127.0.0.1:8080"
)

set "OPEN_WEBUI_LOCAL_URL=http://127.0.0.1:8080"
set "OPENAI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3"
if defined CUSTOM_OPENAI_BASE_URL set "OPENAI_BASE_URL=%CUSTOM_OPENAI_BASE_URL%"

set CONTAINER_RUNNING=
for /f %%i in ('docker ps --filter "name=open-webui" --filter "status=running" -q 2^>nul') do (
    set CONTAINER_RUNNING=1
)

if defined CONTAINER_RUNNING (
    docker inspect open-webui --format "{{range .Config.Env}}{{println .}}{{end}}" 2>nul | findstr /B /C:"WEBUI_URL=%WEBUI_PUBLIC_URL%" > nul 2>&1
    if errorlevel 1 (
        echo Detected existing open-webui container with different WEBUI_URL. Recreating ...
        docker rm -f open-webui > nul 2>&1
        set CONTAINER_RUNNING=
    )
)

if defined CONTAINER_RUNNING (
    echo Open WebUI is already running (%OPEN_WEBUI_LOCAL_URL%)
    docker update --restart unless-stopped open-webui > nul 2>&1
    goto :inject_assets
)

echo Starting Open WebUI ...
docker rm open-webui > nul 2>&1

docker run -d ^
  --name open-webui ^
  --restart unless-stopped ^
  --network open-webui-main_default ^
  -p 8080:8080 ^
  -e OLLAMA_BASE_URL=http://ollama:11434 ^
  -e "OPENAI_API_BASE_URL=%OPENAI_BASE_URL%" ^
  -e "OPENAI_API_KEY=%OPENAI_API_KEY%" ^
  -e WEBUI_AUTH=false ^
  -e ENABLE_SIGNUP=false ^
  -e WEBUI_SECRET_KEY=xiaolou-playground ^
  -e "WEBUI_URL=%WEBUI_PUBLIC_URL%" ^
  -v open-webui-data:/app/backend/data ^
  ghcr.io/open-webui/open-webui:main

echo Open WebUI started. Wait about 30 seconds, then visit %OPEN_WEBUI_LOCAL_URL%.

:inject_assets
echo Injecting XiaoLou Open WebUI assets ...
timeout /t 5 /nobreak > nul
docker cp "%SCRIPT_DIR%openwebui-custom.css" open-webui:/app/backend/open_webui/static/custom.css
docker cp "%SCRIPT_DIR%openwebui-custom.css" open-webui:/app/build/static/custom.css
docker cp "%SCRIPT_DIR%openwebui-theme-sync.js" open-webui:/app/backend/open_webui/static/xiaolou-theme-sync.js
docker cp "%SCRIPT_DIR%openwebui-theme-sync.js" open-webui:/app/build/static/xiaolou-theme-sync.js
docker cp "%SCRIPT_DIR%openwebui-api-rewrite.js" open-webui:/app/backend/open_webui/static/api-rewrite.js
docker cp "%SCRIPT_DIR%openwebui-api-rewrite.js" open-webui:/app/build/static/api-rewrite.js
docker exec open-webui sh -lc "grep -q 'api-rewrite.js' /app/build/index.html || sed -i '/<meta charset/a\    <script src=./static/api-rewrite.js></script>' /app/build/index.html"
docker exec open-webui sh -lc "grep -q 'custom.css' /app/build/index.html || sed -i '/<\/head>/i\\		<link rel=\"stylesheet\" href=\"./static/custom.css\" crossorigin=\"use-credentials\" />' /app/build/index.html"
docker exec open-webui sh -lc "grep -q 'xiaolou-theme-sync.js' /app/build/index.html || sed -i '/<\/head>/i\\		<script src=\"./static/xiaolou-theme-sync.js\" defer crossorigin=\"use-credentials\"></script>' /app/build/index.html"
echo Open WebUI custom assets injected.

:end
endlocal
