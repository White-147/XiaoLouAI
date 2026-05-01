param(
  [switch]$Execute,
  [switch]$SkipAppUserData
)

$ErrorActionPreference = "Stop"

function Get-DirectorySizeMb {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return 0
  }

  $sum = (Get-ChildItem -LiteralPath $Path -Force -Recurse -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum
  return [math]::Round(($sum / 1MB), 2)
}

function Assert-SourcePath {
  param([string]$Path)

  $full = [System.IO.Path]::GetFullPath($Path)
  $allowedRoots = @(
    [System.IO.Path]::GetFullPath($env:USERPROFILE),
    [System.IO.Path]::GetFullPath($env:APPDATA),
    [System.IO.Path]::GetFullPath($env:LOCALAPPDATA),
    [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE "AppData\LocalLow")),
    [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE "Documents"))
  )

  foreach ($root in $allowedRoots) {
    if ($full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
      return $full
    }
  }

  throw "Refusing to migrate source outside the current user profile: $full"
}

function Assert-TargetPath {
  param([string]$Path)

  $full = [System.IO.Path]::GetFullPath($Path)
  if (-not $full.StartsWith("D:\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing non-D: migration target: $full"
  }

  return $full
}

function Invoke-RobocopyChecked {
  param(
    [string]$From,
    [string]$To
  )

  robocopy $From $To /E /COPY:DAT /DCOPY:DAT /R:2 /W:2 /XJ | Out-Host
  $exitCode = $LASTEXITCODE
  if ($exitCode -ge 8) {
    throw "robocopy failed with exit code $exitCode"
  }
}

function Move-DirectoryToD {
  param(
    [string]$Name,
    [string]$Source,
    [string]$Target
  )

  $sourceFull = Assert-SourcePath $Source
  $targetFull = Assert-TargetPath $Target
  $sourceExists = Test-Path -LiteralPath $sourceFull
  $sourceItem = if ($sourceExists) { Get-Item -LiteralPath $sourceFull -Force } else { $null }
  $sourceIsLink = $sourceItem -and (($sourceItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
  $sizeMb = if ($sourceExists -and -not $sourceIsLink) { Get-DirectorySizeMb $sourceFull } else { 0 }

  Write-Host "[$Name]"
  Write-Host "  Source: $sourceFull"
  Write-Host "  Target: $targetFull"
  Write-Host "  Exists: $sourceExists  Link: $sourceIsLink  SizeMB: $sizeMb"

  if (-not $Execute) {
    return
  }

  New-Item -ItemType Directory -Force -Path $targetFull | Out-Null

  if ($sourceExists -and -not $sourceIsLink) {
    Invoke-RobocopyChecked $sourceFull $targetFull
    Remove-Item -LiteralPath $sourceFull -Recurse -Force
  } elseif ($sourceIsLink) {
    [System.IO.Directory]::Delete($sourceFull)
  }

  New-Item -ItemType Junction -Path $sourceFull -Target $targetFull | Out-Null
}

function Set-UserEnv {
  param(
    [string]$Name,
    [string]$Value
  )

  Write-Host "ENV $Name=$Value"
  if ($Execute) {
    [Environment]::SetEnvironmentVariable($Name, $Value, "User")
    [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
  }
}

function Ensure-Directory {
  param([string]$Path)

  if ($Execute) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
  }
}

$repoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
$runtimeRoot = Join-Path $repoRoot ".runtime"
$cacheRoot = Join-Path $runtimeRoot "xiaolou-cache"
$tempRoot = Join-Path $runtimeRoot "xiaolou-temp"

$migrations = @(
  @{ Name = "dotnet user home"; Source = "$env:USERPROFILE\.dotnet"; Target = "$cacheRoot\dotnet-userhome" },
  @{ Name = "NuGet user home"; Source = "$env:USERPROFILE\.nuget"; Target = "$cacheRoot\nuget-userhome" },
  @{ Name = "NuGet local appdata"; Source = "$env:LOCALAPPDATA\NuGet"; Target = "$cacheRoot\nuget-localappdata" },
  @{ Name = "Maven user home"; Source = "$env:USERPROFILE\.m2"; Target = "$cacheRoot\maven\.m2" },
  @{ Name = "pip local appdata"; Source = "$env:LOCALAPPDATA\pip"; Target = "$cacheRoot\pip-localappdata" },
  @{ Name = "npm local cache"; Source = "$env:LOCALAPPDATA\npm-cache"; Target = "$cacheRoot\npm" }
)

if (-not $SkipAppUserData) {
  $migrations += @(
    @{ Name = "VS Code extensions"; Source = "$env:USERPROFILE\.vscode"; Target = "D:\soft\program\Microsoft VS Code\UserData\dot-vscode" },
    @{ Name = "VS Code roaming user data"; Source = "$env:APPDATA\Code"; Target = "D:\soft\program\Microsoft VS Code\UserData\Code" },
    @{ Name = "Unity roaming data"; Source = "$env:APPDATA\Unity"; Target = "D:\soft\program\Unity\UserData\Roaming-Unity" },
    @{ Name = "UnityHub roaming data"; Source = "$env:APPDATA\UnityHub"; Target = "D:\soft\program\Unity\UserData\Roaming-UnityHub" },
    @{ Name = "Unity LocalLow data"; Source = "$env:USERPROFILE\AppData\LocalLow\Unity"; Target = "D:\soft\program\Unity\UserData\LocalLow-Unity" },
    @{ Name = "Navicat documents"; Source = "$env:USERPROFILE\Documents\Navicat"; Target = "D:\soft\program\Navicat Premium 17\UserData\Documents-Navicat" }
  )
}

Write-Host "Migrating user tool data to D: using directory junctions."
Write-Host "Execute mode: $Execute"
Write-Host "Skip app user data: $SkipAppUserData"

if ($Execute) {
  $runningApps = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -match '^(Code|Unity|Unity Hub|UnityHub|Navicat|devenv)$' }
  if ($runningApps) {
    $runningApps | Select-Object ProcessName, Id, Path | Format-Table -AutoSize | Out-Host
    throw "Close VS Code, Unity, UnityHub, Navicat, and Visual Studio before migrating app user data."
  }

  New-Item -ItemType Directory -Force -Path $cacheRoot, $tempRoot | Out-Null
}

foreach ($migration in $migrations) {
  Move-DirectoryToD -Name $migration.Name -Source $migration.Source -Target $migration.Target
}

Set-UserEnv "TMP" $tempRoot
Set-UserEnv "TEMP" $tempRoot
Set-UserEnv "DOTNET_CLI_HOME" "$cacheRoot\dotnet-cli-home"
Set-UserEnv "DOTNET_BUNDLE_EXTRACT_BASE_DIR" "$cacheRoot\dotnet-bundle"
Set-UserEnv "NUGET_PACKAGES" "$cacheRoot\nuget\packages"
Set-UserEnv "NUGET_HTTP_CACHE_PATH" "$cacheRoot\nuget\v3-cache"
Set-UserEnv "NUGET_PLUGINS_CACHE_PATH" "$cacheRoot\nuget\plugins-cache"
Set-UserEnv "NUGET_SCRATCH" "$tempRoot\NuGetScratch"
Set-UserEnv "NPM_CONFIG_CACHE" "$cacheRoot\npm"
Set-UserEnv "NPM_CONFIG_PREFIX" "$cacheRoot\node-global"
Set-UserEnv "PIP_CACHE_DIR" "$cacheRoot\pip"
Set-UserEnv "PIP_CONFIG_FILE" "$cacheRoot\pip\pip.ini"
Set-UserEnv "PYTHONPYCACHEPREFIX" "$cacheRoot\python-pycache"
Set-UserEnv "PYTHONUSERBASE" "$cacheRoot\python-userbase"
Set-UserEnv "MAVEN_USER_HOME" "$cacheRoot\maven\.m2"
Set-UserEnv "GRADLE_USER_HOME" "$cacheRoot\gradle-user-home"
Set-UserEnv "COURSIER_CACHE" "$cacheRoot\coursier-cache"
Set-UserEnv "SBT_OPTS" "-Dsbt.boot.directory=$cacheRoot\scala\sbt-boot -Dsbt.global.base=$cacheRoot\scala\sbt-global -Dsbt.ivy.home=$cacheRoot\scala\ivy2"
Set-UserEnv "PLAYWRIGHT_BROWSERS_PATH" "$cacheRoot\playwright-browsers"
Set-UserEnv "HF_HOME" "$cacheRoot\huggingface"
Set-UserEnv "HF_HUB_CACHE" "$cacheRoot\huggingface\hub"
Set-UserEnv "HUGGINGFACE_HUB_CACHE" "$cacheRoot\huggingface\hub"
Set-UserEnv "TRANSFORMERS_CACHE" "$cacheRoot\huggingface\transformers"
Set-UserEnv "TORCH_HOME" "$cacheRoot\torch"
Set-UserEnv "MODELSCOPE_CACHE" "$cacheRoot\modelscope"

if ($Execute) {
  foreach ($path in @(
    "$cacheRoot\nuget\packages",
    "$cacheRoot\nuget\v3-cache",
    "$cacheRoot\nuget\plugins-cache",
    "$tempRoot\NuGetScratch",
    "$cacheRoot\pip",
    "$cacheRoot\python-pycache",
    "$cacheRoot\python-userbase",
    "$cacheRoot\gradle-user-home",
    "$cacheRoot\coursier-cache",
    "$cacheRoot\scala\sbt-boot",
    "$cacheRoot\scala\sbt-global",
    "$cacheRoot\scala\ivy2"
  )) {
    Ensure-Directory $path
  }

  $pipConfigFile = "$cacheRoot\pip\pip.ini"
  if (-not (Test-Path -LiteralPath $pipConfigFile)) {
    Set-Content -LiteralPath $pipConfigFile -Encoding ASCII -Value @(
      "[global]",
      "cache-dir = $cacheRoot\pip"
    )
  }

  Write-Host "Migration complete. Open a new terminal to pick up User environment variable changes."
} else {
  Write-Host "Dry run only. Re-run with -Execute to migrate."
}
