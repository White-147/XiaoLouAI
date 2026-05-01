param(
  [string]$EnvFile = "$PSScriptRoot\.env.windows",
  [switch]$IncludeServices
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\load-env.ps1" -EnvFile $EnvFile

$pathVars = @(
  "XIAOLOU_REPO_ROOT",
  "XIAOLOU_RUNTIME_ROOT",
  "XIAOLOU_ROOT",
  "XIAOLOU_DATA_ROOT",
  "DOTNET_ROOT",
  "DOTNET_EXE",
  "PYTHON_EXE",
  "NODE_EXE",
  "NPM_CMD",
  "CONTROL_API_DLL",
  "CLOSED_API_WORKER_DLL",
  "LOCAL_CACHE_DIR",
  "LOCAL_TEMP_DIR",
  "LOG_DIR",
  "BACKUP_DIR",
  "TMP",
  "TEMP",
  "DOTNET_CLI_HOME",
  "DOTNET_BUNDLE_EXTRACT_BASE_DIR",
  "NUGET_PACKAGES",
  "NUGET_HTTP_CACHE_PATH",
  "NUGET_PLUGINS_CACHE_PATH",
  "NUGET_SCRATCH",
  "NPM_CONFIG_CACHE",
  "NPM_CONFIG_PREFIX",
  "PIP_CACHE_DIR",
  "PIP_CONFIG_FILE",
  "PYTHONPYCACHEPREFIX",
  "PYTHONUSERBASE",
  "UV_CACHE_DIR",
  "POETRY_CACHE_DIR",
  "PIPENV_CACHE_DIR",
  "PLAYWRIGHT_BROWSERS_PATH",
  "MAVEN_USER_HOME",
  "GRADLE_USER_HOME",
  "COURSIER_CACHE",
  "HF_HOME",
  "HF_HUB_CACHE",
  "HUGGINGFACE_HUB_CACHE",
  "TRANSFORMERS_CACHE",
  "TORCH_HOME",
  "MODELSCOPE_CACHE"
)

$violations = New-Object System.Collections.Generic.List[string]
$repoRoot = [Environment]::GetEnvironmentVariable("XIAOLOU_REPO_ROOT", "Process")
if (-not $repoRoot) {
  $repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
}

$repoFull = [System.IO.Path]::GetFullPath($repoRoot).TrimEnd("\")
$repoPrefix = "$repoFull\"
$workspaceScopedVars = @(
  "XIAOLOU_REPO_ROOT",
  "XIAOLOU_RUNTIME_ROOT",
  "XIAOLOU_ROOT",
  "XIAOLOU_DATA_ROOT",
  "CONTROL_API_DLL",
  "CLOSED_API_WORKER_DLL",
  "LOCAL_CACHE_DIR",
  "LOCAL_TEMP_DIR",
  "LOG_DIR",
  "BACKUP_DIR",
  "TMP",
  "TEMP",
  "DOTNET_CLI_HOME",
  "DOTNET_BUNDLE_EXTRACT_BASE_DIR",
  "NUGET_PACKAGES",
  "NUGET_HTTP_CACHE_PATH",
  "NUGET_PLUGINS_CACHE_PATH",
  "NUGET_SCRATCH",
  "NPM_CONFIG_CACHE",
  "NPM_CONFIG_PREFIX",
  "PIP_CACHE_DIR",
  "PIP_CONFIG_FILE",
  "PYTHONPYCACHEPREFIX",
  "PYTHONUSERBASE",
  "UV_CACHE_DIR",
  "POETRY_CACHE_DIR",
  "PIPENV_CACHE_DIR",
  "PLAYWRIGHT_BROWSERS_PATH",
  "MAVEN_USER_HOME",
  "GRADLE_USER_HOME",
  "COURSIER_CACHE",
  "HF_HOME",
  "HF_HUB_CACHE",
  "HUGGINGFACE_HUB_CACHE",
  "TRANSFORMERS_CACHE",
  "TORCH_HOME",
  "MODELSCOPE_CACHE"
)

foreach ($name in $pathVars) {
  $value = [Environment]::GetEnvironmentVariable($name, "Process")
  if (-not $value) {
    continue
  }

  if ($value -match "^[A-Za-z]:\\" -and -not $value.StartsWith("D:\", [StringComparison]::OrdinalIgnoreCase)) {
    $violations.Add("${name}=${value}")
  }

  if ($workspaceScopedVars -contains $name -and $value -match "^[A-Za-z]:\\") {
    $fullValue = [System.IO.Path]::GetFullPath($value).TrimEnd("\")
    if ($fullValue -ine $repoFull -and -not $fullValue.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
      $violations.Add("${name} must stay under ${repoFull}: ${value}")
    }
  }
}

$sbtOpts = [Environment]::GetEnvironmentVariable("SBT_OPTS", "Process")
$legacyRootPattern = "^D:[\\/]{1,2}xiaolou-|[ ;]D:[\\/]{1,2}xiaolou-"
if ($sbtOpts -and $sbtOpts -match $legacyRootPattern) {
  $violations.Add("SBT_OPTS must not point at legacy root-level xiaolou-* paths: $sbtOpts")
}

if (Test-Path -LiteralPath $EnvFile) {
  $forbiddenPatterns = @(
    "C:\Program Files\dotnet",
    "C:\Users\",
    "AppData\Local\Microsoft\WindowsApps\python.exe"
  )

  $envText = Get-Content -LiteralPath $EnvFile -Raw
  foreach ($pattern in $forbiddenPatterns) {
    if ($envText.Contains($pattern)) {
      $violations.Add("Env file contains forbidden project runtime path: $pattern")
    }
  }
}

if ($IncludeServices) {
  $serviceNames = @("XiaoLou-ControlApi", "XiaoLou-ClosedApiWorker", "XiaoLou-LocalModelWorker")
  foreach ($name in $serviceNames) {
    $service = Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$name" -ErrorAction SilentlyContinue
    if (-not $service) {
      continue
    }

    $imagePath = [string]$service.ImagePath
    if ($imagePath -match "C:\\Program Files\\dotnet|C:\\Users\\.*WindowsApps\\python.exe") {
      $violations.Add("${name} ImagePath uses forbidden project runtime path: $imagePath")
    }
  }
}

if ($violations.Count -gt 0) {
  $violations | ForEach-Object { Write-Error $_ }
  throw "D-drive runtime assertion failed."
}

Write-Host "D-drive runtime assertion passed."
