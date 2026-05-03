param(
  [string]$Root = "",
  [string]$SourceRoot = "",
  [string]$DotnetExe = "",
  [string]$NpmCmd = "",
  [string]$PythonExe = "",
  [string]$PgBin = "",
  [string]$VerifyPostgresBackupDumpFile = "",
  [switch]$SkipFrontend,
  [switch]$SkipDotnetPublish,
  [switch]$RegisterServices,
  [switch]$UpdateExisting,
  [switch]$StartServices,
  [switch]$ApplySchema,
  [switch]$AssertDDrive,
  [switch]$AllowPlaceholderSecrets
)

$ErrorActionPreference = "Stop"

function Invoke-ControlApiSchemaApply {
  param([string]$RuntimeScripts)

  $envFile = Join-Path $RuntimeScripts ".env.windows"
  $loadEnv = Join-Path $RuntimeScripts "load-env.ps1"
  . $loadEnv -EnvFile $envFile

  $baseUrl = if ($env:CONTROL_API_BASE_URL) { $env:CONTROL_API_BASE_URL.TrimEnd("/") } else { "http://127.0.0.1:4100" }
  $healthUri = "$baseUrl/healthz"
  $schemaUri = "$baseUrl/api/schema/apply"
  $deadline = (Get-Date).AddSeconds(45)
  $healthy = $false
  while ((Get-Date) -lt $deadline) {
    try {
      Invoke-RestMethod -Method Get -Uri $healthUri -TimeoutSec 5 | Out-Null
      $healthy = $true
      break
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  if (-not $healthy) {
    throw "Control API did not become healthy at $healthUri before schema apply."
  }

  Invoke-RestMethod -Method Post -Uri $schemaUri -TimeoutSec 60 | Out-Null
  Write-Host "Applied Control API PostgreSQL schema through $schemaUri"
}

function Assert-RuntimeLayout {
  param([string]$RuntimeRoot)

  foreach ($path in @(
    $RuntimeRoot,
    (Join-Path $RuntimeRoot "scripts\windows"),
    (Join-Path (Split-Path -Parent $RuntimeRoot) "xiaolou-logs"),
    (Join-Path (Split-Path -Parent $RuntimeRoot) "xiaolou-backups"),
    (Join-Path (Split-Path -Parent $RuntimeRoot) "xiaolou-temp"),
    (Join-Path (Split-Path -Parent $RuntimeRoot) "xiaolou-cache")
  )) {
    if (-not (Test-Path -LiteralPath $path)) {
      throw "Required runtime path is missing: $path"
    }
  }
}

if (-not $SourceRoot) {
  $SourceRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
}

if (-not $Root) {
  $Root = Join-Path $SourceRoot ".runtime\app"
}

& "$PSScriptRoot\publish-runtime-to-d.ps1" `
  -SourceRoot $SourceRoot `
  -RuntimeRoot $Root `
  -DotnetExe $DotnetExe `
  -NpmCmd $NpmCmd `
  -PythonExe $PythonExe `
  -SkipFrontend:$SkipFrontend `
  -SkipDotnetPublish:$SkipDotnetPublish

$runtimeScripts = Join-Path $Root "scripts\windows"
$envFile = Join-Path $runtimeScripts ".env.windows"

if ($AssertDDrive -or $RegisterServices) {
  & (Join-Path $runtimeScripts "assert-d-drive-runtime.ps1") -EnvFile $envFile
}

if ($RegisterServices) {
  & (Join-Path $runtimeScripts "register-services.ps1") `
    -Root $Root `
    -DotnetExe $DotnetExe `
    -PythonExe $PythonExe `
    -UpdateExisting:$UpdateExisting `
    -AllowPlaceholderSecrets:$AllowPlaceholderSecrets
}

if ($StartServices) {
  & (Join-Path $runtimeScripts "start-services.ps1")
}

if ($ApplySchema -or $StartServices) {
  Invoke-ControlApiSchemaApply -RuntimeScripts $runtimeScripts
}

if ($VerifyPostgresBackupDumpFile) {
  $verifyArgs = @{
    DumpFile = $VerifyPostgresBackupDumpFile
  }
  if ($PgBin) { $verifyArgs.PgBin = $PgBin }
  & (Join-Path $runtimeScripts "verify-postgres-backup.ps1") @verifyArgs
}

Assert-RuntimeLayout -RuntimeRoot $Root
