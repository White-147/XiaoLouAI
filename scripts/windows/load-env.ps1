param(
  [string]$EnvFile = "$PSScriptRoot\.env.windows"
)

function Set-ProcessEnvDefault {
  param(
    [string]$Name,
    [string]$Value
  )

  if (-not [Environment]::GetEnvironmentVariable($Name, "Process")) {
    [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
  }
}

function Ensure-DirectoryEnv {
  param(
    [string]$Name,
    [string]$DefaultValue
  )

  Set-ProcessEnvDefault $Name $DefaultValue
  $path = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ($path) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
  }
}

function Get-DefaultRuntimeLayout {
  $candidateRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
  $candidateParent = Split-Path -Parent $candidateRoot
  if ((Split-Path -Leaf $candidateRoot) -eq "app" -and (Split-Path -Leaf $candidateParent) -eq ".runtime") {
    return @{
      RuntimeRoot = $candidateParent
      AppRoot = $candidateRoot
    }
  }

  $runtimeRoot = Join-Path $candidateRoot ".runtime"
  return @{
    RuntimeRoot = $runtimeRoot
    AppRoot = Join-Path $runtimeRoot "app"
  }
}

if (Test-Path -LiteralPath $EnvFile) {
  Get-Content -LiteralPath $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      return
    }

    $parts = $line.Split("=", 2)
    if ($parts.Count -ne 2) {
      return
    }

    [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
  }
}

$layout = Get-DefaultRuntimeLayout
$defaultRepoRoot = if ((Split-Path -Leaf $layout.RuntimeRoot) -eq ".runtime") {
  Split-Path -Parent $layout.RuntimeRoot
} else {
  Split-Path -Parent $layout.AppRoot
}
Ensure-DirectoryEnv "XIAOLOU_REPO_ROOT" $defaultRepoRoot
Ensure-DirectoryEnv "XIAOLOU_RUNTIME_ROOT" $layout.RuntimeRoot
Ensure-DirectoryEnv "XIAOLOU_ROOT" $layout.AppRoot
Set-ProcessEnvDefault "DOTNET_ROOT" "D:\soft\program\dotnet"
Set-ProcessEnvDefault "DOTNET_EXE" "D:\soft\program\dotnet\dotnet.exe"
Set-ProcessEnvDefault "PYTHON_EXE" "D:\soft\program\Python\Python312\python.exe"
Set-ProcessEnvDefault "NODE_EXE" "D:\soft\program\nodejs\node.exe"
Set-ProcessEnvDefault "NPM_CMD" "D:\soft\program\nodejs\npm.cmd"

$runtimeRoot = [Environment]::GetEnvironmentVariable("XIAOLOU_RUNTIME_ROOT", "Process")
$appRoot = [Environment]::GetEnvironmentVariable("XIAOLOU_ROOT", "Process")

Ensure-DirectoryEnv "XIAOLOU_DATA_ROOT" (Join-Path $appRoot "data")
Ensure-DirectoryEnv "LOCAL_CACHE_DIR" (Join-Path $runtimeRoot "xiaolou-cache")
Ensure-DirectoryEnv "LOCAL_TEMP_DIR" (Join-Path $runtimeRoot "xiaolou-temp")
Ensure-DirectoryEnv "LOG_DIR" (Join-Path $runtimeRoot "xiaolou-logs")
Ensure-DirectoryEnv "BACKUP_DIR" (Join-Path $runtimeRoot "xiaolou-backups")

$cacheRoot = [Environment]::GetEnvironmentVariable("LOCAL_CACHE_DIR", "Process")
$tempRoot = [Environment]::GetEnvironmentVariable("LOCAL_TEMP_DIR", "Process")

Ensure-DirectoryEnv "TMP" $tempRoot
Ensure-DirectoryEnv "TEMP" $tempRoot
Ensure-DirectoryEnv "DOTNET_CLI_HOME" (Join-Path $cacheRoot "dotnet-cli-home")
Ensure-DirectoryEnv "DOTNET_BUNDLE_EXTRACT_BASE_DIR" (Join-Path $cacheRoot "dotnet-bundle")
Ensure-DirectoryEnv "NUGET_PACKAGES" (Join-Path $cacheRoot "nuget\packages")
Ensure-DirectoryEnv "NUGET_HTTP_CACHE_PATH" (Join-Path $cacheRoot "nuget\v3-cache")
Ensure-DirectoryEnv "NUGET_PLUGINS_CACHE_PATH" (Join-Path $cacheRoot "nuget\plugins-cache")
Ensure-DirectoryEnv "NUGET_SCRATCH" (Join-Path $tempRoot "NuGetScratch")
Ensure-DirectoryEnv "NPM_CONFIG_CACHE" (Join-Path $cacheRoot "npm")
Ensure-DirectoryEnv "NPM_CONFIG_PREFIX" (Join-Path $cacheRoot "node-global")
Ensure-DirectoryEnv "PIP_CACHE_DIR" (Join-Path $cacheRoot "pip")
Set-ProcessEnvDefault "PIP_CONFIG_FILE" (Join-Path $cacheRoot "pip\pip.ini")
Ensure-DirectoryEnv "PYTHONPYCACHEPREFIX" (Join-Path $cacheRoot "python-pycache")
Ensure-DirectoryEnv "PYTHONUSERBASE" (Join-Path $cacheRoot "python-userbase")
Ensure-DirectoryEnv "UV_CACHE_DIR" (Join-Path $cacheRoot "uv")
Ensure-DirectoryEnv "POETRY_CACHE_DIR" (Join-Path $cacheRoot "poetry")
Ensure-DirectoryEnv "PIPENV_CACHE_DIR" (Join-Path $cacheRoot "pipenv")
Ensure-DirectoryEnv "PLAYWRIGHT_BROWSERS_PATH" (Join-Path $cacheRoot "playwright-browsers")
Ensure-DirectoryEnv "HF_HOME" (Join-Path $cacheRoot "huggingface")
Ensure-DirectoryEnv "HF_HUB_CACHE" (Join-Path $cacheRoot "huggingface\hub")
Ensure-DirectoryEnv "HUGGINGFACE_HUB_CACHE" (Join-Path $cacheRoot "huggingface\hub")
Ensure-DirectoryEnv "TRANSFORMERS_CACHE" (Join-Path $cacheRoot "huggingface\transformers")
Ensure-DirectoryEnv "TORCH_HOME" (Join-Path $cacheRoot "torch")
Ensure-DirectoryEnv "MODELSCOPE_CACHE" (Join-Path $cacheRoot "modelscope")
Ensure-DirectoryEnv "MAVEN_USER_HOME" (Join-Path $cacheRoot "maven\.m2")
Ensure-DirectoryEnv "GRADLE_USER_HOME" (Join-Path $cacheRoot "gradle-user-home")
Ensure-DirectoryEnv "COURSIER_CACHE" (Join-Path $cacheRoot "coursier-cache")
Set-ProcessEnvDefault "SBT_OPTS" "-Dsbt.boot.directory=$(Join-Path $cacheRoot 'scala\sbt-boot') -Dsbt.global.base=$(Join-Path $cacheRoot 'scala\sbt-global') -Dsbt.ivy.home=$(Join-Path $cacheRoot 'scala\ivy2')"

$pipConfigFile = [Environment]::GetEnvironmentVariable("PIP_CONFIG_FILE", "Process")
if ($pipConfigFile) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $pipConfigFile) | Out-Null
  if (-not (Test-Path -LiteralPath $pipConfigFile)) {
    Set-Content -LiteralPath $pipConfigFile -Encoding ASCII -Value @(
      "[global]",
      "cache-dir = $([Environment]::GetEnvironmentVariable('PIP_CACHE_DIR', 'Process'))"
    )
  }
}

$env:PATH = "$env:DOTNET_ROOT;D:\soft\program\nodejs;D:\soft\program\Python\Python312;" + $env:PATH
