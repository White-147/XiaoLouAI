param(
  [string]$SourceRoot = "",
  [string]$RuntimeRoot = "",
  [string]$DotnetExe = "",
  [string]$NpmCmd = "",
  [string]$PythonExe = "",
  [switch]$SkipFrontend,
  [switch]$SkipDotnetPublish
)

$ErrorActionPreference = "Stop"

if (-not $SourceRoot) {
  $SourceRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
}

if (-not $RuntimeRoot) {
  $RuntimeRoot = Join-Path $SourceRoot ".runtime\app"
}

& "$SourceRoot\scripts\windows\load-env.ps1" -EnvFile "$SourceRoot\scripts\windows\.env.windows"

if (-not $DotnetExe) {
  if (Test-Path -LiteralPath "D:\soft\program\dotnet\dotnet.exe") {
    $DotnetExe = "D:\soft\program\dotnet\dotnet.exe"
  } else {
    throw "D:\soft\program\dotnet\dotnet.exe not found. Install .NET 8 to D: or pass -DotnetExe with an explicit D: path."
  }
}

if (-not $NpmCmd) {
  if (Test-Path -LiteralPath "D:\soft\program\nodejs\npm.cmd") {
    $NpmCmd = "D:\soft\program\nodejs\npm.cmd"
  } else {
    throw "D:\soft\program\nodejs\npm.cmd not found. Install Node.js to D: or pass -NpmCmd with an explicit D: path."
  }
}

if (-not $PythonExe) {
  if (Test-Path -LiteralPath "D:\soft\program\Python\Python312\python.exe") {
    $PythonExe = "D:\soft\program\Python\Python312\python.exe"
  } else {
    throw "D:\soft\program\Python\Python312\python.exe not found. Install Python to D: or pass -PythonExe with an explicit D: path."
  }
}

foreach ($toolPath in @($DotnetExe, $NpmCmd, $PythonExe)) {
  $fullToolPath = [System.IO.Path]::GetFullPath($toolPath)
  if (-not $fullToolPath.StartsWith("D:\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use non-D: project tool path: $fullToolPath"
  }
}

[Environment]::SetEnvironmentVariable("DOTNET_EXE", $DotnetExe, "Process")
[Environment]::SetEnvironmentVariable("PYTHON_EXE", $PythonExe, "Process")
[Environment]::SetEnvironmentVariable("NPM_CMD", $NpmCmd, "Process")

$runtimeStateRoot = Split-Path -Parent $RuntimeRoot

$paths = @(
  $RuntimeRoot,
  "$RuntimeRoot\publish\control-api",
  "$RuntimeRoot\publish\closed-api-worker",
  "$RuntimeRoot\scripts\windows",
  "$RuntimeRoot\services\local-model-worker",
  "$RuntimeRoot\XIAOLOU-main\dist",
  "$runtimeStateRoot\xiaolou-cache",
  "$runtimeStateRoot\xiaolou-temp",
  "$runtimeStateRoot\xiaolou-logs",
  "$runtimeStateRoot\xiaolou-backups",
  "$runtimeStateRoot\xiaolou-inputs",
  "$runtimeStateRoot\xiaolou-replay"
)

foreach ($path in $paths) {
  New-Item -ItemType Directory -Force -Path $path | Out-Null
}

if (-not $SkipDotnetPublish) {
  Push-Location "$SourceRoot\control-plane-dotnet"
  try {
    & $DotnetExe restore ".\XiaoLou.ControlPlane.sln"
    if ($LASTEXITCODE -ne 0) { throw "dotnet restore failed with exit code $LASTEXITCODE" }

    & $DotnetExe publish ".\src\XiaoLou.ControlApi\XiaoLou.ControlApi.csproj" -c Release -o "$RuntimeRoot\publish\control-api"
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish ControlApi failed with exit code $LASTEXITCODE" }

    & $DotnetExe publish ".\src\XiaoLou.ClosedApiWorker\XiaoLou.ClosedApiWorker.csproj" -c Release -o "$RuntimeRoot\publish\closed-api-worker"
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish ClosedApiWorker failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
}

if (-not $SkipFrontend) {
  Push-Location "$SourceRoot\XIAOLOU-main"
  try {
    & $NpmCmd ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }

    & $NpmCmd run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }

  Copy-Item -Path "$SourceRoot\XIAOLOU-main\dist\*" -Destination "$RuntimeRoot\XIAOLOU-main\dist" -Recurse -Force
}

Copy-Item -Path "$SourceRoot\scripts\windows\*" -Destination "$RuntimeRoot\scripts\windows" -Recurse -Force
Copy-Item -Path "$SourceRoot\deploy" -Destination "$RuntimeRoot" -Recurse -Force
Copy-Item -Path "$SourceRoot\services\local-model-worker\*" -Destination "$RuntimeRoot\services\local-model-worker" -Recurse -Force

if (-not (Test-Path -LiteralPath "$RuntimeRoot\scripts\windows\.env.windows")) {
  Copy-Item -LiteralPath "$RuntimeRoot\scripts\windows\.env.windows.example" -Destination "$RuntimeRoot\scripts\windows\.env.windows"
}

$envFile = "$RuntimeRoot\scripts\windows\.env.windows"
$envText = Get-Content -LiteralPath $envFile -Raw
function Set-EnvFileValue {
  param(
    [string]$Text,
    [string]$Name,
    [string]$Value
  )

  $pattern = "(?m)^$([regex]::Escape($Name))=.*$"
  $line = "$Name=$Value"
  if ([regex]::IsMatch($Text, $pattern)) {
    return [regex]::Replace($Text, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $line })
  }

  return $Text.TrimEnd() + "`r`n$line`r`n"
}

$cacheRoot = "$runtimeStateRoot\xiaolou-cache"
$tempRoot = "$runtimeStateRoot\xiaolou-temp"
$clientApiToken = if ($env:CLIENT_API_TOKEN) { $env:CLIENT_API_TOKEN } else { "change-me-client-token" }
$clientApiTokenHeader = if ($env:CLIENT_API_TOKEN_HEADER) { $env:CLIENT_API_TOKEN_HEADER } else { "X-XiaoLou-Client-Token" }
$clientApiRequireAccountScope = if ($env:CLIENT_API_REQUIRE_ACCOUNT_SCOPE) { $env:CLIENT_API_REQUIRE_ACCOUNT_SCOPE } else { "true" }
$clientApiRequireConfiguredAccountGrant = if ($env:CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT) { $env:CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT } else { "false" }
$clientApiAllowedAccountIds = if ($env:CLIENT_API_ALLOWED_ACCOUNT_IDS) { $env:CLIENT_API_ALLOWED_ACCOUNT_IDS } else { "" }
$clientApiAllowedAccountOwnerIds = if ($env:CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS) { $env:CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS } else { "" }
$clientApiAllowedPermissions = if ($env:CLIENT_API_ALLOWED_PERMISSIONS) { $env:CLIENT_API_ALLOWED_PERMISSIONS } else { "accounts:ensure,jobs:create,jobs:read,jobs:cancel,media:read,media:write" }
$coreApiCompatReadOnly = if ($env:CORE_API_COMPAT_READ_ONLY) { $env:CORE_API_COMPAT_READ_ONLY } else { "1" }
$coreApiCompatPublicRouteAllowlist = if ($env:CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST) { $env:CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST } else { "GET /healthz;GET /api/windows-native/status" }
$envValues = [ordered]@{
  XIAOLOU_RUNTIME_ROOT = $runtimeStateRoot
  XIAOLOU_REPO_ROOT = $SourceRoot
  XIAOLOU_ROOT = $RuntimeRoot
  XIAOLOU_DATA_ROOT = "$RuntimeRoot\data"
  DOTNET_EXE = $DotnetExe
  PYTHON_EXE = $PythonExe
  CONTROL_API_DLL = "$RuntimeRoot\publish\control-api\XiaoLou.ControlApi.dll"
  CLOSED_API_WORKER_DLL = "$RuntimeRoot\publish\closed-api-worker\XiaoLou.ClosedApiWorker.dll"
  LOCAL_CACHE_DIR = $cacheRoot
  LOCAL_TEMP_DIR = $tempRoot
  LOG_DIR = "$runtimeStateRoot\xiaolou-logs"
  BACKUP_DIR = "$runtimeStateRoot\xiaolou-backups"
  TMP = $tempRoot
  TEMP = $tempRoot
  DOTNET_CLI_HOME = "$cacheRoot\dotnet-cli-home"
  DOTNET_BUNDLE_EXTRACT_BASE_DIR = "$cacheRoot\dotnet-bundle"
  NUGET_PACKAGES = "$cacheRoot\nuget\packages"
  NUGET_HTTP_CACHE_PATH = "$cacheRoot\nuget\v3-cache"
  NUGET_PLUGINS_CACHE_PATH = "$cacheRoot\nuget\plugins-cache"
  NUGET_SCRATCH = "$tempRoot\NuGetScratch"
  NPM_CONFIG_CACHE = "$cacheRoot\npm"
  NPM_CONFIG_PREFIX = "$cacheRoot\node-global"
  PIP_CACHE_DIR = "$cacheRoot\pip"
  PIP_CONFIG_FILE = "$cacheRoot\pip\pip.ini"
  PYTHONPYCACHEPREFIX = "$cacheRoot\python-pycache"
  PYTHONUSERBASE = "$cacheRoot\python-userbase"
  UV_CACHE_DIR = "$cacheRoot\uv"
  POETRY_CACHE_DIR = "$cacheRoot\poetry"
  PIPENV_CACHE_DIR = "$cacheRoot\pipenv"
  PLAYWRIGHT_BROWSERS_PATH = "$cacheRoot\playwright-browsers"
  MAVEN_USER_HOME = "$cacheRoot\maven\.m2"
  GRADLE_USER_HOME = "$cacheRoot\gradle-user-home"
  COURSIER_CACHE = "$cacheRoot\coursier-cache"
  SBT_OPTS = "-Dsbt.boot.directory=$cacheRoot\scala\sbt-boot -Dsbt.global.base=$cacheRoot\scala\sbt-global -Dsbt.ivy.home=$cacheRoot\scala\ivy2"
  HF_HOME = "$cacheRoot\huggingface"
  HF_HUB_CACHE = "$cacheRoot\huggingface\hub"
  HUGGINGFACE_HUB_CACHE = "$cacheRoot\huggingface\hub"
  TRANSFORMERS_CACHE = "$cacheRoot\huggingface\transformers"
  TORCH_HOME = "$cacheRoot\torch"
  MODELSCOPE_CACHE = "$cacheRoot\modelscope"
  CLIENT_API_TOKEN = $clientApiToken
  CLIENT_API_TOKEN_HEADER = $clientApiTokenHeader
  CLIENT_API_REQUIRE_ACCOUNT_SCOPE = $clientApiRequireAccountScope
  CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT = $clientApiRequireConfiguredAccountGrant
  CLIENT_API_ALLOWED_ACCOUNT_IDS = $clientApiAllowedAccountIds
  CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS = $clientApiAllowedAccountOwnerIds
  CLIENT_API_ALLOWED_PERMISSIONS = $clientApiAllowedPermissions
  CORE_API_COMPAT_READ_ONLY = $coreApiCompatReadOnly
  CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST = $coreApiCompatPublicRouteAllowlist
}

foreach ($entry in $envValues.GetEnumerator()) {
  $envText = Set-EnvFileValue -Text $envText -Name $entry.Key -Value $entry.Value
}

foreach ($name in @(
  "DATABASE_URL",
  "PAYMENT_WEBHOOK_SECRET",
  "INTERNAL_API_TOKEN",
  "OBJECT_STORAGE_PROVIDER",
  "OBJECT_STORAGE_BUCKET",
  "OBJECT_STORAGE_PUBLIC_BASE_URL",
  "OBJECT_STORAGE_TEMP_PREFIX",
  "OBJECT_STORAGE_PERMANENT_PREFIX"
)) {
  $value = [Environment]::GetEnvironmentVariable($name, "Process")
  if ($value) {
    $envText = Set-EnvFileValue -Text $envText -Name $name -Value $value
  }
}
Set-Content -LiteralPath $envFile -Value $envText -Encoding UTF8

Write-Host "Published XiaoLouAI runtime to $RuntimeRoot"
Write-Host "Review $envFile, then register/update Windows services:"
Write-Host "$RuntimeRoot\scripts\windows\register-services.ps1 -Root $RuntimeRoot -DotnetExe $DotnetExe -PythonExe $PythonExe -UpdateExisting"
