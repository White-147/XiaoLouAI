param(
  [string]$RepoRoot = "",
  [string]$EnvFile = "$PSScriptRoot\.env.windows",
  [string]$CoreApiRoot = "",
  [string]$NodeExe = "",
  [string]$DatabaseUrl = "",
  [string]$ReportPath = "",
  [string]$SnapshotKey = "snapshot",
  [switch]$AllowMissingLegacy,
  [switch]$LegacyWritesFrozen,
  [switch]$NoStrict
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
}
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path

if (-not $CoreApiRoot) {
  $CoreApiRoot = Join-Path $RepoRoot "legacy\core-api"
} elseif (-not [System.IO.Path]::IsPathRooted($CoreApiRoot)) {
  $CoreApiRoot = Join-Path $RepoRoot $CoreApiRoot
}
$CoreApiRoot = [System.IO.Path]::GetFullPath($CoreApiRoot)

if (-not (Test-Path -LiteralPath $EnvFile)) {
  $runtimeEnvFile = Join-Path $RepoRoot ".runtime\app\scripts\windows\.env.windows"
  if (Test-Path -LiteralPath $runtimeEnvFile) {
    $EnvFile = $runtimeEnvFile
  }
}

. "$PSScriptRoot\load-env.ps1" -EnvFile $EnvFile

function Resolve-DTool {
  param(
    [string]$Provided,
    [string]$EnvName,
    [string]$DefaultPath,
    [string]$Name
  )

  $value = $Provided
  if (-not $value) {
    $value = [Environment]::GetEnvironmentVariable($EnvName, "Process")
  }
  if (-not $value) {
    $value = $DefaultPath
  }

  if (-not (Test-Path -LiteralPath $value)) {
    throw "$Name not found at $value"
  }

  $full = [System.IO.Path]::GetFullPath($value)
  if (-not $full.StartsWith("D:\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "$Name must use the D: runtime path. Refusing $full"
  }

  return $full
}

$NodeExe = Resolve-DTool $NodeExe "NODE_EXE" "D:\soft\program\nodejs\node.exe" "Node.js"
$Verifier = Join-Path $CoreApiRoot "scripts\verify-legacy-canonical-projection.js"
$PgModule = Join-Path $CoreApiRoot "node_modules\pg\package.json"

if (-not (Test-Path -LiteralPath $Verifier)) {
  throw "Legacy canonical projection verifier not found at $Verifier"
}
if (-not (Test-Path -LiteralPath $PgModule)) {
  throw "core-api dependency pg is missing. Run npm install in $CoreApiRoot with D: npm before projection verification."
}

if (-not $DatabaseUrl) {
  $DatabaseUrl = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
}
if (-not $DatabaseUrl -or $DatabaseUrl.Contains("change-me")) {
  $DatabaseUrl = "postgres://root:root@127.0.0.1:5432/xiaolou_windows_native_test"
}

if (-not $ReportPath) {
  $logDir = [Environment]::GetEnvironmentVariable("LOG_DIR", "Process")
  if (-not $logDir) {
    $logDir = Join-Path $RepoRoot ".runtime\xiaolou-logs"
  }
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $ReportPath = Join-Path $logDir "legacy-canonical-projection-$stamp.json"
}

$nodeArgs = @(
  $Verifier,
  "--database-url", $DatabaseUrl,
  "--snapshot-key", $SnapshotKey,
  "--report-path", $ReportPath
)

if (-not $NoStrict) {
  $nodeArgs += "--strict"
}
if ($AllowMissingLegacy) {
  $nodeArgs += "--allow-missing-legacy"
}
if ($LegacyWritesFrozen) {
  $nodeArgs += "--legacy-writes-frozen"
}

& $NodeExe @nodeArgs
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  throw "Legacy canonical projection verification failed with exit code $exitCode. Report: $ReportPath"
}

Write-Host "Legacy canonical projection report: $ReportPath"
