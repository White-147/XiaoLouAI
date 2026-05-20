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
  $sourceLinkTarget = if ($sourceIsLink -and $sourceItem.Target) { [string]($sourceItem.Target -join ";") } else { "" }
  $sizeMb = if ($sourceExists -and -not $sourceIsLink) { Get-DirectorySizeMb $sourceFull } else { 0 }

  Write-Host "[$Name]"
  Write-Host "  Source: $sourceFull"
  Write-Host "  Target: $targetFull"
  Write-Host "  Exists: $sourceExists  Link: $sourceIsLink  LinkTarget: $sourceLinkTarget  SizeMB: $sizeMb"

  if (-not $Execute) {
    return
  }

  New-Item -ItemType Directory -Force -Path $targetFull | Out-Null

  if ($sourceExists -and -not $sourceIsLink) {
    Invoke-RobocopyChecked $sourceFull $targetFull
    Remove-Item -LiteralPath $sourceFull -Recurse -Force
  } elseif ($sourceIsLink) {
    foreach ($linkTarget in @($sourceItem.Target)) {
      if (-not $linkTarget) {
        continue
      }

      $linkTargetFull = [System.IO.Path]::GetFullPath($linkTarget)
      if ((Test-Path -LiteralPath $linkTargetFull) -and
          -not $linkTargetFull.TrimEnd("\").Equals($targetFull.TrimEnd("\"), [StringComparison]::OrdinalIgnoreCase)) {
        Invoke-RobocopyChecked $linkTargetFull $targetFull
      }
    }

    [System.IO.Directory]::Delete($sourceFull)
  }

  New-Item -ItemType Junction -Path $sourceFull -Target $targetFull | Out-Null
}

function Consolidate-LegacyDirectory {
  param(
    [string]$Name,
    [string]$Source,
    [string]$Target
  )

  $sourceFull = Assert-TargetPath $Source
  $targetFull = Assert-TargetPath $Target
  $sourceExists = Test-Path -LiteralPath $sourceFull
  $sourceItem = if ($sourceExists) { Get-Item -LiteralPath $sourceFull -Force } else { $null }
  $sourceIsLink = $sourceItem -and (($sourceItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
  $sizeMb = if ($sourceExists -and -not $sourceIsLink) { Get-DirectorySizeMb $sourceFull } else { 0 }

  Write-Host "[$Name]"
  Write-Host "  Legacy: $sourceFull"
  Write-Host "  Target: $targetFull"
  Write-Host "  Exists: $sourceExists  Link: $sourceIsLink  SizeMB: $sizeMb"

  if (-not $Execute -or -not $sourceExists) {
    return
  }

  if ($sourceFull.TrimEnd("\").Equals($targetFull.TrimEnd("\"), [StringComparison]::OrdinalIgnoreCase)) {
    return
  }

  New-Item -ItemType Directory -Force -Path $targetFull | Out-Null
  if ($sourceIsLink) {
    foreach ($linkTarget in @($sourceItem.Target)) {
      if (-not $linkTarget) {
        continue
      }

      $linkTargetFull = [System.IO.Path]::GetFullPath($linkTarget)
      if (Test-Path -LiteralPath $linkTargetFull) {
        Invoke-RobocopyChecked $linkTargetFull $targetFull
      }
    }

    [System.IO.Directory]::Delete($sourceFull)
  } else {
    Invoke-RobocopyChecked $sourceFull $targetFull
    Remove-Item -LiteralPath $sourceFull -Recurse -Force
  }
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

function Add-UserPathEntries {
  param([string[]]$Entries)

  foreach ($entry in $Entries) {
    Write-Host "PATH += $entry"
  }

  if (-not $Execute) {
    return
  }

  $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $items = New-Object System.Collections.Generic.List[string]
  foreach ($item in ($currentPath -split ";")) {
    $trimmed = $item.Trim()
    if ($trimmed -and -not $items.Contains($trimmed)) {
      $items.Add($trimmed) | Out-Null
    }
  }

  foreach ($entry in $Entries) {
    $fullEntry = [System.IO.Path]::GetFullPath($entry).TrimEnd("\")
    if (-not $fullEntry.StartsWith("D:\soft\program\", [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to add non-program PATH entry: $fullEntry"
    }

    $alreadyPresent = $false
    foreach ($item in $items) {
      if ($item.TrimEnd("\").Equals($fullEntry, [StringComparison]::OrdinalIgnoreCase)) {
        $alreadyPresent = $true
        break
      }
    }

    if (-not $alreadyPresent) {
      $items.Add($fullEntry) | Out-Null
    }
  }

  $newPath = ($items.ToArray() -join ";")
  [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
  [Environment]::SetEnvironmentVariable("Path", $newPath, "Process")
}

function Ensure-Directory {
  param([string]$Path)

  if ($Execute) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
  }
}

$repoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
$runtimeRoot = Join-Path $repoRoot ".runtime"
$localCacheRoot = Join-Path $runtimeRoot "xiaolou-cache"
$localTempRoot = Join-Path $runtimeRoot "xiaolou-temp"
$cacheRoot = "D:\soft\cache"
$programRoot = "D:\soft\program"
$tempRoot = if ($env:XIAOLOU_SHARED_TEMP_ROOT) { $env:XIAOLOU_SHARED_TEMP_ROOT } else { "D:\soft\temp" }

$migrations = @(
  @{ Name = "dotnet user home"; Source = "$env:USERPROFILE\.dotnet"; Target = "$programRoot\dotnet-userhome" },
  @{ Name = "NuGet user home"; Source = "$env:USERPROFILE\.nuget"; Target = "$cacheRoot\nuget\userhome" },
  @{ Name = "NuGet local appdata"; Source = "$env:LOCALAPPDATA\NuGet"; Target = "$cacheRoot\nuget\localappdata" },
  @{ Name = "Maven user home"; Source = "$env:USERPROFILE\.m2"; Target = "$cacheRoot\maven\.m2" },
  @{ Name = "pip local appdata"; Source = "$env:LOCALAPPDATA\pip"; Target = "$cacheRoot\pip\localappdata" },
  @{ Name = "npm local cache"; Source = "$env:LOCALAPPDATA\npm-cache"; Target = "$cacheRoot\npm" },
  @{ Name = "Playwright browsers"; Source = "$env:LOCALAPPDATA\ms-playwright"; Target = "$programRoot\ms-playwright" },
  @{ Name = "Hugging Face cache"; Source = "$env:USERPROFILE\.cache\huggingface"; Target = "$cacheRoot\huggingface" },
  @{ Name = "Torch cache"; Source = "$env:USERPROFILE\.cache\torch"; Target = "$cacheRoot\torch" },
  @{ Name = "ModelScope cache"; Source = "$env:USERPROFILE\.cache\modelscope"; Target = "$cacheRoot\modelscope" },
  @{ Name = "uv cache"; Source = "$env:LOCALAPPDATA\uv"; Target = "$cacheRoot\uv" },
  @{ Name = "Poetry cache"; Source = "$env:LOCALAPPDATA\pypoetry"; Target = "$cacheRoot\poetry" },
  @{ Name = "Pipenv cache"; Source = "$env:USERPROFILE\.cache\pipenv"; Target = "$cacheRoot\pipenv" }
)

if (-not $SkipAppUserData) {
  $migrations += @(
    @{ Name = "VS Code extensions"; Source = "$env:USERPROFILE\.vscode"; Target = "$programRoot\Microsoft VS Code\UserData\dot-vscode" },
    @{ Name = "VS Code roaming user data"; Source = "$env:APPDATA\Code"; Target = "$programRoot\Microsoft VS Code\UserData\Code" },
    @{ Name = "Unity roaming data"; Source = "$env:APPDATA\Unity"; Target = "$programRoot\Unity\UserData\Roaming-Unity" },
    @{ Name = "UnityHub roaming data"; Source = "$env:APPDATA\UnityHub"; Target = "$programRoot\Unity\UserData\Roaming-UnityHub" },
    @{ Name = "Unity LocalLow data"; Source = "$env:USERPROFILE\AppData\LocalLow\Unity"; Target = "$programRoot\Unity\UserData\LocalLow-Unity" },
    @{ Name = "Navicat documents"; Source = "$env:USERPROFILE\Documents\Navicat"; Target = "$programRoot\Navicat Premium 17\UserData\Documents-Navicat" }
  )
}

Write-Host "Migrating user tool data to D: using directory junctions."
Write-Host "Execute mode: $Execute"
Write-Host "Skip app user data: $SkipAppUserData"
Write-Host "Project runtime root: $runtimeRoot"
Write-Host "Project local cache root: $localCacheRoot"
Write-Host "Shared D: cache root: $cacheRoot"
Write-Host "Shared D: program root: $programRoot"

if ($Execute) {
  $runningApps = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -match '^(Code|Unity|Unity Hub|UnityHub|Navicat|devenv)$' }
  if ($runningApps) {
    $runningApps | Select-Object ProcessName, Id, Path | Format-Table -AutoSize | Out-Host
    throw "Close VS Code, Unity, UnityHub, Navicat, and Visual Studio before migrating app user data."
  }

  New-Item -ItemType Directory -Force -Path $localCacheRoot, $localTempRoot, $cacheRoot, $programRoot, $tempRoot | Out-Null
}

foreach ($migration in $migrations) {
  Move-DirectoryToD -Name $migration.Name -Source $migration.Source -Target $migration.Target
}

$legacyConsolidations = @(
  @{ Name = "legacy dotnet cli home cache"; Source = "$cacheRoot\dotnet-cli-home"; Target = "$programRoot\dotnet-userhome" },
  @{ Name = "legacy Playwright cache path"; Source = "$cacheRoot\ms-playwright"; Target = "$programRoot\ms-playwright" },
  @{ Name = "legacy npm global prefix in cache"; Source = "$cacheRoot\node-global"; Target = "$programRoot\nodejs\node_global" },
  @{ Name = "legacy Python userbase in cache"; Source = "$cacheRoot\python-userbase"; Target = "$programRoot\Python\UserBase" },
  @{ Name = "legacy npm cache in program"; Source = "$programRoot\nodejs\node_cache"; Target = "$cacheRoot\npm" },
  @{ Name = "legacy Maven repository in program"; Source = "$programRoot\Maven\.m2"; Target = "$cacheRoot\maven\.m2" }
)

foreach ($legacy in $legacyConsolidations) {
  Consolidate-LegacyDirectory -Name $legacy.Name -Source $legacy.Source -Target $legacy.Target
}

Set-UserEnv "TMP" $tempRoot
Set-UserEnv "TEMP" $tempRoot
Set-UserEnv "XDG_CACHE_HOME" "$cacheRoot\tooling-cache"
Set-UserEnv "XIAOLOU_SHARED_CACHE_ROOT" $cacheRoot
Set-UserEnv "XIAOLOU_SHARED_PROGRAM_ROOT" $programRoot
Set-UserEnv "DOTNET_CLI_HOME" "$programRoot\dotnet-userhome"
Set-UserEnv "DOTNET_BUNDLE_EXTRACT_BASE_DIR" "$cacheRoot\dotnet-bundle"
Set-UserEnv "NUGET_PACKAGES" "$cacheRoot\nuget\packages"
Set-UserEnv "NUGET_HTTP_CACHE_PATH" "$cacheRoot\nuget\v3-cache"
Set-UserEnv "NUGET_PLUGINS_CACHE_PATH" "$cacheRoot\nuget\plugins-cache"
Set-UserEnv "NUGET_SCRATCH" "$tempRoot\NuGetScratch"
Set-UserEnv "NPM_CONFIG_CACHE" "$cacheRoot\npm"
Set-UserEnv "NPM_CONFIG_PREFIX" "$programRoot\nodejs\node_global"
Set-UserEnv "PIP_CACHE_DIR" "$cacheRoot\pip"
Set-UserEnv "PIP_CONFIG_FILE" "$cacheRoot\pip\pip.ini"
Set-UserEnv "PYTHONPYCACHEPREFIX" "$cacheRoot\python-pycache"
Set-UserEnv "PYTHONUSERBASE" "$programRoot\Python\UserBase"
Set-UserEnv "UV_CACHE_DIR" "$cacheRoot\uv"
Set-UserEnv "POETRY_CACHE_DIR" "$cacheRoot\poetry"
Set-UserEnv "PIPENV_CACHE_DIR" "$cacheRoot\pipenv"
Set-UserEnv "MAVEN_USER_HOME" "$cacheRoot\maven\.m2"
Set-UserEnv "GRADLE_USER_HOME" "$cacheRoot\gradle-user-home"
Set-UserEnv "COURSIER_CACHE" "$cacheRoot\coursier-cache"
Set-UserEnv "SBT_OPTS" "-Dsbt.boot.directory=$cacheRoot\scala\sbt-boot -Dsbt.global.base=$cacheRoot\scala\sbt-global -Dsbt.ivy.home=$cacheRoot\scala\ivy2"
Set-UserEnv "PLAYWRIGHT_BROWSERS_PATH" "$programRoot\ms-playwright"
Set-UserEnv "HF_HOME" "$cacheRoot\huggingface"
Set-UserEnv "HF_HUB_CACHE" "$cacheRoot\huggingface\hub"
Set-UserEnv "HUGGINGFACE_HUB_CACHE" "$cacheRoot\huggingface\hub"
Set-UserEnv "TRANSFORMERS_CACHE" "$cacheRoot\huggingface\transformers"
Set-UserEnv "TORCH_HOME" "$cacheRoot\torch"
Set-UserEnv "MODELSCOPE_CACHE" "$cacheRoot\modelscope"
Set-UserEnv "CUDA_CACHE_PATH" "$cacheRoot\cuda\compute-cache"
Set-UserEnv "VR_WEIGHTS_ROOT" "$cacheRoot\xiaolou-video-replace-weights"
Add-UserPathEntries @(
  "$programRoot\dotnet-userhome\tools",
  "$programRoot\nodejs\node_global",
  "$programRoot\Python\UserBase\Scripts"
)

if ($Execute) {
  foreach ($path in @(
    "$programRoot\dotnet-userhome",
    "$programRoot\dotnet-userhome\tools",
    "$programRoot\nodejs\node_global",
    "$programRoot\Python\UserBase",
    "$programRoot\Python\UserBase\Scripts",
    "$programRoot\ms-playwright",
    "$cacheRoot\dotnet-bundle",
    "$cacheRoot\nuget\userhome",
    "$cacheRoot\nuget\localappdata",
    "$cacheRoot\nuget\packages",
    "$cacheRoot\nuget\v3-cache",
    "$cacheRoot\nuget\plugins-cache",
    "$cacheRoot\tooling-cache",
    "$tempRoot\NuGetScratch",
    "$cacheRoot\npm",
    "$cacheRoot\pip",
    "$cacheRoot\pip\localappdata",
    "$cacheRoot\python-pycache",
    "$cacheRoot\uv",
    "$cacheRoot\poetry",
    "$cacheRoot\pipenv",
    "$cacheRoot\huggingface",
    "$cacheRoot\huggingface\hub",
    "$cacheRoot\huggingface\transformers",
    "$cacheRoot\torch",
    "$cacheRoot\modelscope",
    "$cacheRoot\cuda\compute-cache",
    "$cacheRoot\xiaolou-video-replace-weights",
    "$cacheRoot\maven\.m2",
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
