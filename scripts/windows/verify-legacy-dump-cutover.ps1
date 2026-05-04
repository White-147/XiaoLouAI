param(
  [Parameter(Mandatory = $true)]
  [string]$DumpFile,
  [string]$RepoRoot = "",
  [string]$EnvFile = "$PSScriptRoot\.env.windows",
  [string]$CoreApiRoot = "",
  [string]$PgBin = "",
  [string]$NodeExe = "",
  [string]$HostName = "127.0.0.1",
  [int]$Port = 5432,
  [string]$Username = "postgres",
  [string]$Password = "",
  [string]$Database = "",
  [int]$Jobs = 4,
  [string]$SearchPath = "public",
  [string]$ReportPath = "",
  [switch]$ExecuteProjection,
  [switch]$SkipProjectionDryRun,
  [switch]$SkipWalletAudit,
  [switch]$KeepDatabase
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

function Resolve-PostgresBin {
  param([string]$Configured)

  foreach ($candidate in @(
    $Configured,
    $env:PG_BIN,
    "D:\soft\program\PostgreSQL\18\bin",
    "D:\soft\program\PostgreSQL\17\bin",
    "D:\soft\program\PostgreSQL\16\bin"
  )) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      $full = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $candidate).Path)
      if (-not $full.StartsWith("D:\", [StringComparison]::OrdinalIgnoreCase)) {
        throw "PostgreSQL bin must use the D: runtime path. Refusing $full"
      }
      return $full
    }
  }

  throw "PostgreSQL bin directory was not found. Pass -PgBin with a D: path."
}

function Resolve-PostgresTool {
  param(
    [string]$Bin,
    [string]$Name
  )

  $path = Join-Path $Bin $Name
  if (-not (Test-Path -LiteralPath $path)) {
    throw "$Name was not found in $Bin"
  }
  return $path
}

function New-List {
  return New-Object System.Collections.Generic.List[object]
}

function Add-Step {
  param(
    [System.Collections.IList]$Steps,
    [string]$Name,
    [string]$Status,
    [object]$Data = $null
  )

  $Steps.Add([ordered]@{
    name = $Name
    status = $Status
    data = $Data
  }) | Out-Null
}

function New-PostgresDatabaseUrl {
  param(
    [string]$UserName,
    [string]$Secret,
    [string]$HostName,
    [int]$Port,
    [string]$Database,
    [string]$SearchPath
  )

  $userPart = [System.Uri]::EscapeDataString($UserName)
  $authPart = if ($Secret) {
    "$userPart`:$([System.Uri]::EscapeDataString($Secret))@"
  } elseif ($UserName) {
    "$userPart@"
  } else {
    ""
  }
  $url = "postgres://$authPart${HostName}:$Port/$([System.Uri]::EscapeDataString($Database))"
  if ($SearchPath -and $SearchPath -ne "public") {
    $options = "-c search_path=$SearchPath"
    $url += "?options=$([System.Uri]::EscapeDataString($options))"
  }
  return $url
}

if (-not (Test-Path -LiteralPath $DumpFile)) {
  throw "Dump file not found: $DumpFile"
}

$dumpFullPath = (Resolve-Path -LiteralPath $DumpFile).Path
$dumpHash = Get-FileHash -LiteralPath $dumpFullPath -Algorithm SHA256
$dumpItem = Get-Item -LiteralPath $dumpFullPath

if (-not $Database) {
  $Database = "xiaolou_legacy_verify_" + (Get-Date -Format "yyyyMMdd_HHmmss")
}
if ($ExecuteProjection -and -not $Database.StartsWith("xiaolou_legacy_verify_", [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing -ExecuteProjection outside a xiaolou_legacy_verify_* temporary database. Use a generated database name for cutover evidence."
}

if (-not $ReportPath) {
  $logDir = [Environment]::GetEnvironmentVariable("LOG_DIR", "Process")
  if (-not $logDir) {
    $logDir = Join-Path $RepoRoot ".runtime\xiaolou-logs"
  }
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $ReportPath = Join-Path $logDir ("legacy-dump-cutover-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null

$pgBinPath = Resolve-PostgresBin $PgBin
$dropdb = Resolve-PostgresTool $pgBinPath "dropdb.exe"
$NodeExe = Resolve-DTool $NodeExe "NODE_EXE" "D:\soft\program\nodejs\node.exe" "Node.js"
$restoreScript = Join-Path $PSScriptRoot "restore-postgres.ps1"
$projectScript = Join-Path $PSScriptRoot "project-legacy-to-canonical.ps1"
$verifyScript = Join-Path $PSScriptRoot "verify-legacy-canonical-projection.ps1"
$walletScript = Join-Path $PSScriptRoot "audit-wallet-ledger.ps1"
foreach ($script in @($restoreScript, $projectScript, $verifyScript, $walletScript)) {
  if (-not (Test-Path -LiteralPath $script)) {
    throw "Required script is missing: $script"
  }
}

$steps = New-List
$warnings = New-List
$blockers = New-List
$status = "blocked"
$errorMessage = $null
$previousDatabaseUrl = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
$previousPgPassword = [Environment]::GetEnvironmentVariable("PGPASSWORD", "Process")

if (-not $Password) {
  $Password = $previousPgPassword
}
$stagingDatabaseUrl = New-PostgresDatabaseUrl `
  -UserName $Username `
  -Secret $Password `
  -HostName $HostName `
  -Port $Port `
  -Database $Database `
  -SearchPath $SearchPath

try {
  if ($Password) {
    [Environment]::SetEnvironmentVariable("PGPASSWORD", $Password, "Process")
  }

  $restoreOutput = (& $restoreScript `
    -DumpFile $dumpFullPath `
    -PgBin $pgBinPath `
    -HostName $HostName `
    -Port $Port `
    -Username $Username `
    -Database $Database `
    -Jobs $Jobs `
    -CreateDatabase `
    -DropExisting `
    -Execute | Out-String).Trim()
  Add-Step $steps "restore-dump" "ok" ([ordered]@{ output = $restoreOutput })

  if (-not $SkipProjectionDryRun) {
    $projectDryRunReport = Join-Path (Split-Path -Parent $ReportPath) ("legacy-dump-project-dryrun-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")
    & $projectScript `
      -RepoRoot $RepoRoot `
      -EnvFile $EnvFile `
      -CoreApiRoot $CoreApiRoot `
      -NodeExe $NodeExe `
      -DatabaseUrl $stagingDatabaseUrl `
      -ReportPath $projectDryRunReport | Out-Null
    Add-Step $steps "projection-dry-run" "ok" ([ordered]@{ report = $projectDryRunReport })
  }

  if ($ExecuteProjection) {
    $projectExecuteReport = Join-Path (Split-Path -Parent $ReportPath) ("legacy-dump-project-execute-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")
    & $projectScript `
      -RepoRoot $RepoRoot `
      -EnvFile $EnvFile `
      -CoreApiRoot $CoreApiRoot `
      -NodeExe $NodeExe `
      -DatabaseUrl $stagingDatabaseUrl `
      -ReportPath $projectExecuteReport `
      -Execute `
      -AllowNonStaging | Out-Null
    Add-Step $steps "projection-execute" "ok" ([ordered]@{ report = $projectExecuteReport })
  }

  $verifyReport = Join-Path (Split-Path -Parent $ReportPath) ("legacy-dump-strict-verify-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")
  & $verifyScript `
    -RepoRoot $RepoRoot `
    -EnvFile $EnvFile `
    -CoreApiRoot $CoreApiRoot `
    -NodeExe $NodeExe `
    -DatabaseUrl $stagingDatabaseUrl `
    -ReportPath $verifyReport `
    -LegacyWritesFrozen | Out-Null
  Add-Step $steps "strict-projection-verifier" "ok" ([ordered]@{ report = $verifyReport })

  if (-not $SkipWalletAudit) {
    $walletReport = Join-Path (Split-Path -Parent $ReportPath) ("legacy-dump-wallet-ledger-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")
    [Environment]::SetEnvironmentVariable("DATABASE_URL", $stagingDatabaseUrl, "Process")
    & $walletScript -OutputPath $walletReport -FailOnMismatch | Out-Null
    Add-Step $steps "wallet-ledger-audit" "ok" ([ordered]@{ report = $walletReport })
  }

  $status = "ok"
} catch {
  $errorMessage = $_.Exception.Message
  $blockers.Add([ordered]@{
    name = "legacy-dump-cutover"
    status = "failed"
    detail = $errorMessage
  }) | Out-Null
  throw
} finally {
  [Environment]::SetEnvironmentVariable("DATABASE_URL", $previousDatabaseUrl, "Process")
  [Environment]::SetEnvironmentVariable("PGPASSWORD", $previousPgPassword, "Process")

  if (-not $KeepDatabase) {
    try {
      if ($Password) {
        [Environment]::SetEnvironmentVariable("PGPASSWORD", $Password, "Process")
      }
      & $dropdb "--if-exists" "--host=$HostName" "--port=$Port" "--username=$Username" $Database | Out-Null
      Add-Step $steps "drop-temp-database" "ok" ([ordered]@{ database = $Database })
    } catch {
      $warnings.Add([ordered]@{
        name = "drop-temp-database"
        status = "warning"
        detail = $_.Exception.Message
        database = $Database
      }) | Out-Null
    } finally {
      [Environment]::SetEnvironmentVariable("PGPASSWORD", $previousPgPassword, "Process")
    }
  } else {
    $warnings.Add([ordered]@{
      name = "temp-database-kept"
      status = "warning"
      detail = "Temporary legacy verification database was kept for inspection."
      database = $Database
    }) | Out-Null
  }

  $report = [ordered]@{
    generated_at_utc = [DateTimeOffset]::UtcNow.ToString("O")
    status = $status
    dump = [ordered]@{
      path = $dumpFullPath
      length = $dumpItem.Length
      last_write_time_utc = $dumpItem.LastWriteTimeUtc.ToString("O")
      sha256 = $dumpHash.Hash
    }
    staging = [ordered]@{
      database = $Database
      host = $HostName
      port = $Port
      username = $Username
      search_path = $SearchPath
      kept_database = [bool]$KeepDatabase
    }
    execute_projection = [bool]$ExecuteProjection
    blockers = $blockers
    warnings = $warnings
    steps = $steps
    error = $errorMessage
  }
  $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
  $report | ConvertTo-Json -Depth 10
}

if ($status -ne "ok") {
  throw "Legacy dump cutover verification failed. Report: $ReportPath"
}
