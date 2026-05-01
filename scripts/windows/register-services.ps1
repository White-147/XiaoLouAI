param(
  [string]$Root = "",
  [string]$Pwsh = "",
  [string]$DotnetExe = "",
  [string]$PythonExe = "",
  [switch]$UpdateExisting
)

$ErrorActionPreference = "Stop"

if (-not $Root) {
  $candidateRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
  $candidateParent = Split-Path -Parent $candidateRoot
  if ((Split-Path -Leaf $candidateRoot) -eq "app" -and (Split-Path -Leaf $candidateParent) -eq ".runtime") {
    $Root = $candidateRoot
  } else {
    $Root = Join-Path $candidateRoot ".runtime\app"
  }
}

$runtimeStateRoot = Split-Path -Parent $Root
$repoRoot = if ((Split-Path -Leaf $runtimeStateRoot) -eq ".runtime") {
  Split-Path -Parent $runtimeStateRoot
} else {
  $Root
}

if (-not $Pwsh) {
  $Pwsh = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
}

if (-not $DotnetExe) {
  if (Test-Path -LiteralPath "D:\soft\program\dotnet\dotnet.exe") {
    $DotnetExe = "D:\soft\program\dotnet\dotnet.exe"
  } else {
    throw "D:\soft\program\dotnet\dotnet.exe not found. Install .NET 8 to D: or pass -DotnetExe with an explicit D: path."
  }
}

if (-not $PythonExe) {
  if (Test-Path -LiteralPath "D:\soft\program\Python\Python312\python.exe") {
    $PythonExe = "D:\soft\program\Python\Python312\python.exe"
  } else {
    throw "D:\soft\program\Python\Python312\python.exe not found. Install Python to D: or pass -PythonExe with an explicit D: path."
  }
}

$cacheRoot = Join-Path $runtimeStateRoot "xiaolou-cache"
$tempRoot = Join-Path $runtimeStateRoot "xiaolou-temp"
$clientApiToken = if ($env:CLIENT_API_TOKEN) { $env:CLIENT_API_TOKEN } else { "change-me-client-token" }
$clientApiTokenHeader = if ($env:CLIENT_API_TOKEN_HEADER) { $env:CLIENT_API_TOKEN_HEADER } else { "X-XiaoLou-Client-Token" }
$clientApiRequireAccountScope = if ($env:CLIENT_API_REQUIRE_ACCOUNT_SCOPE) { $env:CLIENT_API_REQUIRE_ACCOUNT_SCOPE } else { "true" }
$clientApiRequireConfiguredAccountGrant = if ($env:CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT) { $env:CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT } else { "false" }
$clientApiAllowedAccountIds = if ($env:CLIENT_API_ALLOWED_ACCOUNT_IDS) { $env:CLIENT_API_ALLOWED_ACCOUNT_IDS } else { "" }
$clientApiAllowedAccountOwnerIds = if ($env:CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS) { $env:CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS } else { "" }
$machineEnv = [ordered]@{
  XIAOLOU_ROOT = $Root
  XIAOLOU_RUNTIME_ROOT = $runtimeStateRoot
  XIAOLOU_REPO_ROOT = $repoRoot
  DOTNET_EXE = $DotnetExe
  POWERSHELL_EXE = $Pwsh
  PYTHON_EXE = $PythonExe
  DOTNET_ROOT = "D:\soft\program\dotnet"
  CONTROL_API_DLL = "$Root\publish\control-api\XiaoLou.ControlApi.dll"
  CLOSED_API_WORKER_DLL = "$Root\publish\closed-api-worker\XiaoLou.ClosedApiWorker.dll"
  XIAOLOU_DATA_ROOT = "$Root\data"
  LOCAL_CACHE_DIR = $cacheRoot
  LOCAL_TEMP_DIR = $tempRoot
  LOG_DIR = (Join-Path $runtimeStateRoot "xiaolou-logs")
  BACKUP_DIR = (Join-Path $runtimeStateRoot "xiaolou-backups")
  TMP = $tempRoot
  TEMP = $tempRoot
  DOTNET_CLI_HOME = (Join-Path $cacheRoot "dotnet-cli-home")
  DOTNET_BUNDLE_EXTRACT_BASE_DIR = (Join-Path $cacheRoot "dotnet-bundle")
  NUGET_PACKAGES = (Join-Path $cacheRoot "nuget\packages")
  NUGET_HTTP_CACHE_PATH = (Join-Path $cacheRoot "nuget\v3-cache")
  NUGET_PLUGINS_CACHE_PATH = (Join-Path $cacheRoot "nuget\plugins-cache")
  NUGET_SCRATCH = (Join-Path $tempRoot "NuGetScratch")
  NPM_CONFIG_CACHE = (Join-Path $cacheRoot "npm")
  NPM_CONFIG_PREFIX = (Join-Path $cacheRoot "node-global")
  PIP_CACHE_DIR = (Join-Path $cacheRoot "pip")
  PIP_CONFIG_FILE = (Join-Path $cacheRoot "pip\pip.ini")
  PYTHONPYCACHEPREFIX = (Join-Path $cacheRoot "python-pycache")
  PYTHONUSERBASE = (Join-Path $cacheRoot "python-userbase")
  UV_CACHE_DIR = (Join-Path $cacheRoot "uv")
  POETRY_CACHE_DIR = (Join-Path $cacheRoot "poetry")
  PIPENV_CACHE_DIR = (Join-Path $cacheRoot "pipenv")
  PLAYWRIGHT_BROWSERS_PATH = (Join-Path $cacheRoot "playwright-browsers")
  MAVEN_USER_HOME = (Join-Path $cacheRoot "maven\.m2")
  GRADLE_USER_HOME = (Join-Path $cacheRoot "gradle-user-home")
  COURSIER_CACHE = (Join-Path $cacheRoot "coursier-cache")
  SBT_OPTS = "-Dsbt.boot.directory=$(Join-Path $cacheRoot 'scala\sbt-boot') -Dsbt.global.base=$(Join-Path $cacheRoot 'scala\sbt-global') -Dsbt.ivy.home=$(Join-Path $cacheRoot 'scala\ivy2')"
  HF_HOME = (Join-Path $cacheRoot "huggingface")
  HF_HUB_CACHE = (Join-Path $cacheRoot "huggingface\hub")
  HUGGINGFACE_HUB_CACHE = (Join-Path $cacheRoot "huggingface\hub")
  TRANSFORMERS_CACHE = (Join-Path $cacheRoot "huggingface\transformers")
  TORCH_HOME = (Join-Path $cacheRoot "torch")
  MODELSCOPE_CACHE = (Join-Path $cacheRoot "modelscope")
  CLIENT_API_TOKEN = $clientApiToken
  CLIENT_API_TOKEN_HEADER = $clientApiTokenHeader
  CLIENT_API_REQUIRE_ACCOUNT_SCOPE = $clientApiRequireAccountScope
  CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT = $clientApiRequireConfiguredAccountGrant
  CLIENT_API_ALLOWED_ACCOUNT_IDS = $clientApiAllowedAccountIds
  CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS = $clientApiAllowedAccountOwnerIds
}

foreach ($entry in $machineEnv.GetEnumerator()) {
  [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Machine")
}

foreach ($path in @(
  $Root,
  "$Root\data",
  $cacheRoot,
  $tempRoot,
  (Join-Path $runtimeStateRoot "xiaolou-logs"),
  (Join-Path $runtimeStateRoot "xiaolou-backups"),
  (Join-Path $runtimeStateRoot "xiaolou-inputs"),
  (Join-Path $runtimeStateRoot "xiaolou-replay"),
  (Join-Path $cacheRoot "pip")
)) {
  New-Item -ItemType Directory -Force -Path $path | Out-Null
}

$services = @(
  @{
    Name = "XiaoLou-ControlApi"
    DisplayName = "XiaoLou Control API"
    Script = "$Root\scripts\windows\start-control-api.ps1"
  },
  @{
    Name = "XiaoLou-LocalModelWorker"
    DisplayName = "XiaoLou Local Model Worker"
    Script = "$Root\scripts\windows\start-local-model-worker.ps1"
  },
  @{
    Name = "XiaoLou-ClosedApiWorker"
    DisplayName = "XiaoLou Closed API Worker"
    Script = "$Root\scripts\windows\start-closed-api-worker.ps1"
  }
)

foreach ($svc in $services) {
  $binaryPath = "`"$Pwsh`" -NoProfile -ExecutionPolicy Bypass -File `"$($svc.Script)`""
  if (Get-Service -Name $svc.Name -ErrorAction SilentlyContinue) {
    if ($UpdateExisting) {
      sc.exe config $svc.Name binPath= $binaryPath start= auto | Out-Null
      sc.exe failure $svc.Name reset= 60 actions= restart/60000/restart/60000/""/60000 | Out-Null
      Write-Host "Updated service: $($svc.Name)"
    } else {
      Write-Host "Service already exists: $($svc.Name). Pass -UpdateExisting to update its command line."
    }

    continue
  }

  New-Service `
    -Name $svc.Name `
    -DisplayName $svc.DisplayName `
    -BinaryPathName $binaryPath `
    -StartupType Automatic

  sc.exe failure $svc.Name reset= 60 actions= restart/60000/restart/60000/""/60000 | Out-Null
  Write-Host "Created service: $($svc.Name)"
}
