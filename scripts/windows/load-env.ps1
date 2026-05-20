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

function Get-NormalizedPathForCompare {
  param([string]$Path)

  if (-not $Path) {
    return ""
  }

  return [System.IO.Path]::GetFullPath($Path).TrimEnd([char[]]@("\", "/"))
}

function Test-DDrivePath {
  param([string]$Path)

  if (-not $Path -or -not [System.IO.Path]::IsPathRooted($Path)) {
    return $false
  }

  return [System.IO.Path]::GetFullPath($Path).StartsWith("D:\", [System.StringComparison]::OrdinalIgnoreCase)
}

function Ensure-DDriveDirectoryEnv {
  param(
    [string]$Name,
    [string]$DefaultValue
  )

  $currentValue = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not (Test-DDrivePath $currentValue)) {
    [Environment]::SetEnvironmentVariable($Name, $DefaultValue, "Process")
  }

  $path = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ($path) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
  }
}

function Ensure-ExactDirectoryEnv {
  param(
    [string]$Name,
    [string]$RequiredValue
  )

  $currentValue = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ((Get-NormalizedPathForCompare $currentValue) -ine (Get-NormalizedPathForCompare $RequiredValue)) {
    [Environment]::SetEnvironmentVariable($Name, $RequiredValue, "Process")
  }

  New-Item -ItemType Directory -Force -Path $RequiredValue | Out-Null
}

function Ensure-WorkspaceDirectoryEnv {
  param(
    [string]$Name,
    [string]$DefaultValue,
    [string]$RepoRoot
  )

  $currentValue = [Environment]::GetEnvironmentVariable($Name, "Process")
  $repoFull = Get-NormalizedPathForCompare $RepoRoot
  $repoPrefix = "$repoFull\"
  $shouldSet = -not (Test-DDrivePath $currentValue)

  if (-not $shouldSet) {
    $currentFull = Get-NormalizedPathForCompare $currentValue
    if ($currentFull -ine $repoFull -and -not $currentFull.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      $shouldSet = $true
    }
  }

  if ($shouldSet) {
    [Environment]::SetEnvironmentVariable($Name, $DefaultValue, "Process")
  }

  $path = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ($path) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
  }
}

function Ensure-SharedCacheDirectoryEnv {
  param(
    [string]$Name,
    [string]$DefaultValue,
    [string]$SharedCacheRoot
  )

  $currentValue = [Environment]::GetEnvironmentVariable($Name, "Process")
  $sharedFull = Get-NormalizedPathForCompare $SharedCacheRoot
  $sharedPrefix = "$sharedFull\"
  $shouldSet = -not (Test-DDrivePath $currentValue)

  if (-not $shouldSet) {
    $currentFull = Get-NormalizedPathForCompare $currentValue
    if ($currentFull -ine $sharedFull -and -not $currentFull.StartsWith($sharedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      $shouldSet = $true
    }
  }

  if ($shouldSet) {
    [Environment]::SetEnvironmentVariable($Name, $DefaultValue, "Process")
  }

  $path = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ($path) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
  }
}

function Ensure-SharedProgramDirectoryEnv {
  param(
    [string]$Name,
    [string]$DefaultValue,
    [string]$SharedProgramRoot
  )

  $currentValue = [Environment]::GetEnvironmentVariable($Name, "Process")
  $sharedFull = Get-NormalizedPathForCompare $SharedProgramRoot
  $sharedPrefix = "$sharedFull\"
  $shouldSet = -not (Test-DDrivePath $currentValue)

  if (-not $shouldSet) {
    $currentFull = Get-NormalizedPathForCompare $currentValue
    if ($currentFull -ine $sharedFull -and -not $currentFull.StartsWith($sharedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      $shouldSet = $true
    }
  }

  if ($shouldSet) {
    [Environment]::SetEnvironmentVariable($Name, $DefaultValue, "Process")
  }

  $path = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ($path) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
  }
}

function Ensure-XdgCacheHome {
  param(
    [string]$RepoRoot,
    [string]$CacheRoot
  )

  $defaultValue = Join-Path $CacheRoot "tooling-cache"
  $currentValue = [Environment]::GetEnvironmentVariable("XDG_CACHE_HOME", "Process")
  $repoRootCache = Join-Path $RepoRoot ".cache"
  $shouldSet = -not $currentValue

  if ($currentValue) {
    $currentFull = Get-NormalizedPathForCompare $currentValue
    $repoRootCacheFull = Get-NormalizedPathForCompare $repoRootCache
    $repoFull = Get-NormalizedPathForCompare $RepoRoot
    if ($currentFull.Equals($repoRootCacheFull, [System.StringComparison]::OrdinalIgnoreCase) -or
        $currentFull.StartsWith("$repoRootCacheFull\", [System.StringComparison]::OrdinalIgnoreCase) -or
        $currentFull.Equals($repoFull, [System.StringComparison]::OrdinalIgnoreCase) -or
        $currentFull.StartsWith("$repoFull\", [System.StringComparison]::OrdinalIgnoreCase)) {
      $shouldSet = $true
    }
  }

  if ($shouldSet) {
    [Environment]::SetEnvironmentVariable("XDG_CACHE_HOME", $defaultValue, "Process")
  }

  $path = [Environment]::GetEnvironmentVariable("XDG_CACHE_HOME", "Process")
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
Ensure-WorkspaceDirectoryEnv "XIAOLOU_REPO_ROOT" $defaultRepoRoot $defaultRepoRoot
Ensure-WorkspaceDirectoryEnv "XIAOLOU_RUNTIME_ROOT" $layout.RuntimeRoot $defaultRepoRoot
Ensure-WorkspaceDirectoryEnv "XIAOLOU_ROOT" $layout.AppRoot $defaultRepoRoot
Ensure-ExactDirectoryEnv "XIAOLOU_SHARED_CACHE_ROOT" "D:\soft\cache"
Ensure-ExactDirectoryEnv "XIAOLOU_SHARED_PROGRAM_ROOT" "D:\soft\program"
if (-not (Test-DDrivePath ([Environment]::GetEnvironmentVariable("DOTNET_ROOT", "Process")))) {
  [Environment]::SetEnvironmentVariable("DOTNET_ROOT", "D:\soft\program\dotnet", "Process")
}
if (-not (Test-DDrivePath ([Environment]::GetEnvironmentVariable("DOTNET_EXE", "Process")))) {
  [Environment]::SetEnvironmentVariable("DOTNET_EXE", "D:\soft\program\dotnet\dotnet.exe", "Process")
}
if (-not (Test-DDrivePath ([Environment]::GetEnvironmentVariable("PYTHON_EXE", "Process")))) {
  [Environment]::SetEnvironmentVariable("PYTHON_EXE", "D:\soft\program\Python\Python312\python.exe", "Process")
}
if (-not (Test-DDrivePath ([Environment]::GetEnvironmentVariable("NODE_EXE", "Process")))) {
  [Environment]::SetEnvironmentVariable("NODE_EXE", "D:\soft\program\nodejs\node.exe", "Process")
}
if (-not (Test-DDrivePath ([Environment]::GetEnvironmentVariable("NPM_CMD", "Process")))) {
  [Environment]::SetEnvironmentVariable("NPM_CMD", "D:\soft\program\nodejs\npm.cmd", "Process")
}

$runtimeRoot = [Environment]::GetEnvironmentVariable("XIAOLOU_RUNTIME_ROOT", "Process")
$appRoot = [Environment]::GetEnvironmentVariable("XIAOLOU_ROOT", "Process")
$sharedCacheRoot = [Environment]::GetEnvironmentVariable("XIAOLOU_SHARED_CACHE_ROOT", "Process")
$sharedProgramRoot = [Environment]::GetEnvironmentVariable("XIAOLOU_SHARED_PROGRAM_ROOT", "Process")

Ensure-WorkspaceDirectoryEnv "XIAOLOU_DATA_ROOT" (Join-Path $appRoot "data") $defaultRepoRoot
Ensure-WorkspaceDirectoryEnv "LOCAL_CACHE_DIR" (Join-Path $runtimeRoot "xiaolou-cache") $defaultRepoRoot
Ensure-WorkspaceDirectoryEnv "LOCAL_TEMP_DIR" (Join-Path $runtimeRoot "xiaolou-temp") $defaultRepoRoot
Ensure-WorkspaceDirectoryEnv "LOG_DIR" (Join-Path $runtimeRoot "xiaolou-logs") $defaultRepoRoot
Ensure-WorkspaceDirectoryEnv "BACKUP_DIR" (Join-Path $runtimeRoot "xiaolou-backups") $defaultRepoRoot

$cacheRoot = [Environment]::GetEnvironmentVariable("LOCAL_CACHE_DIR", "Process")
$tempRoot = [Environment]::GetEnvironmentVariable("LOCAL_TEMP_DIR", "Process")

Ensure-XdgCacheHome $defaultRepoRoot $sharedCacheRoot
Ensure-WorkspaceDirectoryEnv "TMP" $tempRoot $defaultRepoRoot
Ensure-WorkspaceDirectoryEnv "TEMP" $tempRoot $defaultRepoRoot
Ensure-SharedProgramDirectoryEnv "DOTNET_CLI_HOME" (Join-Path $sharedProgramRoot "dotnet-userhome") $sharedProgramRoot
Ensure-SharedCacheDirectoryEnv "DOTNET_BUNDLE_EXTRACT_BASE_DIR" (Join-Path $sharedCacheRoot "dotnet-bundle") $sharedCacheRoot
Ensure-SharedCacheDirectoryEnv "NUGET_PACKAGES" (Join-Path $sharedCacheRoot "nuget\packages") $sharedCacheRoot
Ensure-SharedCacheDirectoryEnv "NUGET_HTTP_CACHE_PATH" (Join-Path $sharedCacheRoot "nuget\v3-cache") $sharedCacheRoot
Ensure-SharedCacheDirectoryEnv "NUGET_PLUGINS_CACHE_PATH" (Join-Path $sharedCacheRoot "nuget\plugins-cache") $sharedCacheRoot
Ensure-WorkspaceDirectoryEnv "NUGET_SCRATCH" (Join-Path $tempRoot "NuGetScratch") $defaultRepoRoot
Ensure-SharedCacheDirectoryEnv "NPM_CONFIG_CACHE" (Join-Path $sharedCacheRoot "npm") $sharedCacheRoot
Ensure-SharedProgramDirectoryEnv "NPM_CONFIG_PREFIX" (Join-Path $sharedProgramRoot "nodejs\node_global") $sharedProgramRoot
Ensure-SharedCacheDirectoryEnv "PIP_CACHE_DIR" (Join-Path $sharedCacheRoot "pip") $sharedCacheRoot
Set-ProcessEnvDefault "PIP_CONFIG_FILE" (Join-Path $sharedCacheRoot "pip\pip.ini")
$pipConfigCurrent = [Environment]::GetEnvironmentVariable("PIP_CONFIG_FILE", "Process")
$pipConfigFull = if ($pipConfigCurrent) { Get-NormalizedPathForCompare $pipConfigCurrent } else { "" }
$sharedCacheFull = Get-NormalizedPathForCompare $sharedCacheRoot
if (-not (Test-DDrivePath $pipConfigCurrent) -or
    ($pipConfigFull -ne $sharedCacheFull -and -not $pipConfigFull.StartsWith("$sharedCacheFull\", [System.StringComparison]::OrdinalIgnoreCase))) {
  [Environment]::SetEnvironmentVariable("PIP_CONFIG_FILE", (Join-Path $sharedCacheRoot "pip\pip.ini"), "Process")
}
Ensure-SharedCacheDirectoryEnv "PYTHONPYCACHEPREFIX" (Join-Path $sharedCacheRoot "python-pycache") $sharedCacheRoot
Ensure-SharedProgramDirectoryEnv "PYTHONUSERBASE" (Join-Path $sharedProgramRoot "Python\UserBase") $sharedProgramRoot
Ensure-SharedCacheDirectoryEnv "UV_CACHE_DIR" (Join-Path $sharedCacheRoot "uv") $sharedCacheRoot
Ensure-SharedCacheDirectoryEnv "POETRY_CACHE_DIR" (Join-Path $sharedCacheRoot "poetry") $sharedCacheRoot
Ensure-SharedCacheDirectoryEnv "PIPENV_CACHE_DIR" (Join-Path $sharedCacheRoot "pipenv") $sharedCacheRoot
Ensure-SharedProgramDirectoryEnv "PLAYWRIGHT_BROWSERS_PATH" (Join-Path $sharedProgramRoot "ms-playwright") $sharedProgramRoot
Ensure-SharedCacheDirectoryEnv "HF_HOME" (Join-Path $sharedCacheRoot "huggingface") $sharedCacheRoot
Ensure-SharedCacheDirectoryEnv "HF_HUB_CACHE" (Join-Path $sharedCacheRoot "huggingface\hub") $sharedCacheRoot
Ensure-SharedCacheDirectoryEnv "HUGGINGFACE_HUB_CACHE" (Join-Path $sharedCacheRoot "huggingface\hub") $sharedCacheRoot
Ensure-SharedCacheDirectoryEnv "TRANSFORMERS_CACHE" (Join-Path $sharedCacheRoot "huggingface\transformers") $sharedCacheRoot
Ensure-SharedCacheDirectoryEnv "TORCH_HOME" (Join-Path $sharedCacheRoot "torch") $sharedCacheRoot
Ensure-SharedCacheDirectoryEnv "MODELSCOPE_CACHE" (Join-Path $sharedCacheRoot "modelscope") $sharedCacheRoot
Ensure-SharedCacheDirectoryEnv "MAVEN_USER_HOME" (Join-Path $sharedCacheRoot "maven\.m2") $sharedCacheRoot
Ensure-SharedCacheDirectoryEnv "GRADLE_USER_HOME" (Join-Path $sharedCacheRoot "gradle-user-home") $sharedCacheRoot
Ensure-SharedCacheDirectoryEnv "COURSIER_CACHE" (Join-Path $sharedCacheRoot "coursier-cache") $sharedCacheRoot
Ensure-SharedCacheDirectoryEnv "CUDA_CACHE_PATH" (Join-Path $sharedCacheRoot "cuda\compute-cache") $sharedCacheRoot
Ensure-SharedCacheDirectoryEnv "VR_WEIGHTS_ROOT" (Join-Path $sharedCacheRoot "xiaolou-video-replace-weights") $sharedCacheRoot
[Environment]::SetEnvironmentVariable("SBT_OPTS", "-Dsbt.boot.directory=$(Join-Path $sharedCacheRoot 'scala\sbt-boot') -Dsbt.global.base=$(Join-Path $sharedCacheRoot 'scala\sbt-global') -Dsbt.ivy.home=$(Join-Path $sharedCacheRoot 'scala\ivy2')", "Process")

New-Item -ItemType Directory -Force -Path @(
  (Join-Path ([Environment]::GetEnvironmentVariable("DOTNET_CLI_HOME", "Process")) "tools"),
  (Join-Path ([Environment]::GetEnvironmentVariable("PYTHONUSERBASE", "Process")) "Scripts")
) | Out-Null

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

$pathPrefixes = New-Object System.Collections.Generic.List[string]
foreach ($candidate in @(
  [Environment]::GetEnvironmentVariable("DOTNET_ROOT", "Process"),
  (Split-Path -Parent ([Environment]::GetEnvironmentVariable("NODE_EXE", "Process"))),
  (Split-Path -Parent ([Environment]::GetEnvironmentVariable("NPM_CMD", "Process"))),
  (Split-Path -Parent ([Environment]::GetEnvironmentVariable("PYTHON_EXE", "Process"))),
  (Join-Path ([Environment]::GetEnvironmentVariable("DOTNET_CLI_HOME", "Process")) "tools"),
  [Environment]::GetEnvironmentVariable("NPM_CONFIG_PREFIX", "Process"),
  (Join-Path ([Environment]::GetEnvironmentVariable("PYTHONUSERBASE", "Process")) "Scripts")
)) {
  if ($candidate -and (Test-Path -LiteralPath $candidate) -and -not $pathPrefixes.Contains($candidate)) {
    $pathPrefixes.Add($candidate) | Out-Null
  }
}

if ($pathPrefixes.Count -gt 0) {
  $env:PATH = ($pathPrefixes -join ";") + ";" + $env:PATH
}
