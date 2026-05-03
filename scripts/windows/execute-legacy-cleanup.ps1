param(
  [string]$RepoRoot = "",
  [string]$EnvFile = "$PSScriptRoot\.env.windows",
  [string]$PgBin = "",
  [string]$DatabaseUrl = "",
  [string]$BaseUrl = "",
  [string]$NodeExe = "",
  [string]$ReportPath = "",
  [string]$RestoreUsername = "postgres",
  [string]$RestorePassword = "",
  [int]$CoreApiPort = 4135,
  [switch]$Execute,
  [switch]$AllowNonEmptyLegacyTables
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
}
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path

if (-not (Test-Path -LiteralPath $EnvFile)) {
  $runtimeEnvFile = Join-Path $RepoRoot ".runtime\app\scripts\windows\.env.windows"
  if (Test-Path -LiteralPath $runtimeEnvFile) {
    $EnvFile = $runtimeEnvFile
  }
}

. "$PSScriptRoot\load-env.ps1" -EnvFile $EnvFile

if (-not $DatabaseUrl) {
  $DatabaseUrl = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
}
if (-not $DatabaseUrl -or $DatabaseUrl.Contains("change-me")) {
  throw "DATABASE_URL is required before executing legacy cleanup."
}

if (-not $BaseUrl) {
  $BaseUrl = if ($env:CONTROL_API_BASE_URL) { $env:CONTROL_API_BASE_URL } else { "http://127.0.0.1:4100" }
}
$BaseUrl = $BaseUrl.TrimEnd("/")

if (-not $NodeExe) {
  $NodeExe = [Environment]::GetEnvironmentVariable("NODE_EXE", "Process")
}
if (-not $NodeExe) {
  $NodeExe = "D:\soft\program\nodejs\node.exe"
}

$logDir = [Environment]::GetEnvironmentVariable("LOG_DIR", "Process")
if (-not $logDir) {
  $logDir = Join-Path $RepoRoot ".runtime\xiaolou-logs"
}
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if (-not $ReportPath) {
  $ReportPath = Join-Path $logDir ("legacy-cleanup-execute-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null

function New-List {
  return New-Object System.Collections.Generic.List[object]
}

function Add-Item {
  param(
    [System.Collections.Generic.List[object]]$List,
    [string]$Name,
    [string]$Status,
    [string]$Detail,
    [object]$Data = $null
  )

  $entry = [ordered]@{
    name = $Name
    status = $Status
    detail = $Detail
  }
  if ($null -ne $Data) {
    $entry["data"] = $Data
  }

  $List.Add($entry) | Out-Null
}

function Get-ItemsCount {
  param([object]$Value)

  if ($null -eq $Value) {
    return 0
  }

  return @($Value).Count
}

function Resolve-PostgresBin {
  param([string]$Configured)

  foreach ($candidate in @(
    $Configured,
    [Environment]::GetEnvironmentVariable("PG_BIN", "Process"),
    "D:\soft\program\PostgreSQL\18\bin",
    "D:\soft\program\PostgreSQL\17\bin",
    "D:\soft\program\PostgreSQL\16\bin"
  )) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  throw "PostgreSQL bin directory was not found. Pass -PgBin with a D: path that contains psql.exe."
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

function ConvertTo-LibpqDatabaseUrl {
  param([string]$Value)

  if (-not $Value) {
    return $Value
  }

  $uri = $null
  if (-not [System.Uri]::TryCreate($Value, [System.UriKind]::Absolute, [ref]$uri)) {
    return $Value
  }
  if ($uri.Scheme -ne "postgres" -and $uri.Scheme -ne "postgresql") {
    return $Value
  }

  $allowed = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($name in @(
    "application_name",
    "channel_binding",
    "client_encoding",
    "connect_timeout",
    "gssencmode",
    "keepalives",
    "keepalives_count",
    "keepalives_idle",
    "keepalives_interval",
    "options",
    "sslcert",
    "sslcrl",
    "sslkey",
    "sslmode",
    "sslpassword",
    "sslrootcert",
    "target_session_attrs",
    "tcp_user_timeout"
  )) {
    $allowed.Add($name) | Out-Null
  }

  $kept = New-Object System.Collections.Generic.List[string]
  foreach ($part in $uri.Query.TrimStart("?").Split("&", [System.StringSplitOptions]::RemoveEmptyEntries)) {
    $keyValue = $part.Split("=", 2)
    $key = [System.Uri]::UnescapeDataString($keyValue[0]).Trim()
    if (-not $allowed.Contains($key)) {
      continue
    }

    $queryValue = if ($keyValue.Count -gt 1) { [System.Uri]::UnescapeDataString($keyValue[1]) } else { "" }
    $kept.Add("$([System.Uri]::EscapeDataString($key))=$([System.Uri]::EscapeDataString($queryValue))") | Out-Null
  }

  $builder = [System.UriBuilder]::new($uri)
  $builder.Query = if ($kept.Count -gt 0) { $kept -join "&" } else { "" }
  return $builder.Uri.AbsoluteUri
}

function Redact-DatabaseUrl {
  param([string]$Value)

  try {
    $builder = [System.UriBuilder]::new([System.Uri]$Value)
    if ($builder.Password) {
      $builder.Password = "***"
    }
    return $builder.Uri.AbsoluteUri
  } catch {
    return ($Value -replace "://([^:\s]+):([^@\s]+)@", '://$1:***@')
  }
}

function Get-DatabaseUserInfo {
  param([string]$Value)

  $uri = [System.Uri]$Value
  $userInfo = $uri.UserInfo.Split(":", 2)
  return [ordered]@{
    username = [System.Uri]::UnescapeDataString($userInfo[0])
    password = if ($userInfo.Count -gt 1) { [System.Uri]::UnescapeDataString($userInfo[1]) } else { "" }
    host = $uri.Host
    port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
  }
}

function Read-JsonReport {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return [ordered]@{ status = "missing"; blockers = 1; warnings = 0; evidence_pending = 0; review_items = 0; json = $null }
  }

  try {
    $json = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    $blockerCount = Get-ItemsCount $json.blockers
    $warningCount = Get-ItemsCount $json.warnings
    if ($json.PSObject.Properties["findings"] -and $null -ne $json.findings) {
      $blockerCount += @($json.findings | Where-Object { $_.severity -match "^(blocker|error|failed)$" }).Count
      $warningCount += @($json.findings | Where-Object { $_.severity -eq "warning" }).Count
    }

    return [ordered]@{
      status = $json.status
      ok = $json.ok
      blockers = $blockerCount
      warnings = $warningCount
      evidence_pending = Get-ItemsCount $json.evidence_pending
      review_items = Get-ItemsCount $json.review_items
      json = $json
    }
  } catch {
    return [ordered]@{ status = "parse-error"; blockers = 1; warnings = 0; evidence_pending = 0; review_items = 0; json = $null; parse_error = $_.Exception.Message }
  }
}

function Invoke-ReportStep {
  param(
    [string]$Name,
    [string]$Path,
    [scriptblock]$Script,
    [switch]$AllowWarnings
  )

  $started = [DateTimeOffset]::Now.ToString("O")
  try {
    & $Script | Out-Null
    $summary = Read-JsonReport $Path
    $step = [ordered]@{
      name = $Name
      status = "ok"
      started_at = $started
      ended_at = [DateTimeOffset]::Now.ToString("O")
      report = $Path
      summary = [ordered]@{
        status = $summary.status
        blockers = $summary.blockers
        warnings = $summary.warnings
        evidence_pending = $summary.evidence_pending
        review_items = $summary.review_items
      }
    }
    $script:steps.Add($step) | Out-Null

    if ([int]$summary.blockers -gt 0) {
      Add-Item $script:blockers $Name "blocked" "$Name report contains $($summary.blockers) blocker(s)." $step
    }
    if (-not $AllowWarnings -and [int]$summary.warnings -gt 0) {
      Add-Item $script:warnings $Name "warning" "$Name report contains $($summary.warnings) warning(s)." $step
    }

    return $summary
  } catch {
    $step = [ordered]@{
      name = $Name
      status = "failed"
      started_at = $started
      ended_at = [DateTimeOffset]::Now.ToString("O")
      report = $Path
      error = $_.Exception.Message
    }
    $script:steps.Add($step) | Out-Null
    Add-Item $script:blockers $Name "failed" $_.Exception.Message $step
    return [ordered]@{ status = "failed"; blockers = 1; warnings = 0; evidence_pending = 0; review_items = 0; json = $null }
  }
}

function Invoke-P0Step {
  param(
    [string]$Name,
    [string]$Path
  )

  $started = [DateTimeOffset]::Now.ToString("O")
  try {
    $output = & "$PSScriptRoot\verify-control-plane-p0.ps1" -RepoRoot $RepoRoot -BaseUrl $BaseUrl
    $text = ($output | Out-String).Trim()
    $text | Set-Content -LiteralPath $Path -Encoding UTF8
    $lines = @($text -split "`r?`n" | Where-Object { $_.Trim() })
    $jsonStart = -1
    for ($i = $lines.Count - 1; $i -ge 0; $i--) {
      if ($lines[$i].TrimStart().StartsWith("{")) {
        $jsonStart = $i
        break
      }
    }
    if ($jsonStart -lt 0) {
      throw "P0 output did not contain a trailing JSON object. See $Path"
    }

    $json = ($lines[$jsonStart..($lines.Count - 1)] -join "`n") | ConvertFrom-Json
    $step = [ordered]@{
      name = $Name
      status = "ok"
      started_at = $started
      ended_at = [DateTimeOffset]::Now.ToString("O")
      report = $Path
      p0_run_id = $json.runId
      workers_verified = $json.workersVerified
    }
    $script:steps.Add($step) | Out-Null
    Add-Item $script:checks $Name "ok" "P0 run $($json.runId) completed." ([ordered]@{ report = $Path; workers_verified = $json.workersVerified })
  } catch {
    $step = [ordered]@{
      name = $Name
      status = "failed"
      started_at = $started
      ended_at = [DateTimeOffset]::Now.ToString("O")
      report = $Path
      error = $_.Exception.Message
    }
    $script:steps.Add($step) | Out-Null
    Add-Item $script:blockers $Name "failed" $_.Exception.Message $step
  }
}

function Invoke-BackupStep {
  param(
    [string]$Name,
    [string]$BackupDir
  )

  $started = Get-Date
  try {
    & "$PSScriptRoot\backup-postgres.ps1" -BackupDir $BackupDir | Out-Null
    $backup = Get-ChildItem -LiteralPath $BackupDir -Filter "xiaolou-*.dump" |
      Where-Object { $_.LastWriteTime -ge $started.AddSeconds(-5) } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if (-not $backup) {
      throw "backup-postgres.ps1 completed but no fresh dump was found in $BackupDir."
    }

    $script:backupFile = $backup.FullName
    Add-Item $script:checks $Name "ok" "Fresh PostgreSQL backup completed." ([ordered]@{ dump_file = $backup.FullName; bytes = $backup.Length })
    $script:steps.Add([ordered]@{
      name = $Name
      status = "ok"
      started_at = [DateTimeOffset]$started
      ended_at = [DateTimeOffset]::Now.ToString("O")
      dump_file = $backup.FullName
      bytes = $backup.Length
    }) | Out-Null
  } catch {
    Add-Item $script:blockers $Name "failed" $_.Exception.Message
    $script:steps.Add([ordered]@{
      name = $Name
      status = "failed"
      started_at = [DateTimeOffset]$started
      ended_at = [DateTimeOffset]::Now.ToString("O")
      error = $_.Exception.Message
    }) | Out-Null
  }
}

function Invoke-PsqlScalar {
  param(
    [string]$Sql
  )

  $output = & $script:psql $script:libpqUrl "--tuples-only" "--no-align" "--quiet" "--set=ON_ERROR_STOP=1" "--command=$Sql"
  if ($LASTEXITCODE -ne 0) {
    throw "psql query failed with exit code $LASTEXITCODE"
  }

  return ($output | Where-Object { $_ -and $_.Trim() } | Select-Object -First 1).Trim()
}

function Invoke-PsqlFile {
  param([string]$Path)

  & $script:psql $script:libpqUrl "--set=ON_ERROR_STOP=1" "--file=$Path" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "psql file failed with exit code ${LASTEXITCODE}: $Path"
  }
}

function Get-CleanupInventory {
  param([object[]]$Candidates)

  $items = New-List
  foreach ($candidate in $Candidates) {
    $table = [string]$candidate.table
    $existsValue = Invoke-PsqlScalar "SELECT CASE WHEN to_regclass('public.$table') IS NULL THEN 'false' ELSE 'true' END;"
    $exists = $existsValue -eq "true"
    $rowCount = $null
    if ($exists) {
      $rowCount = [int64](Invoke-PsqlScalar "SELECT count(*)::text FROM public.$table;")
    }
    $items.Add([ordered]@{
      table = $table
      exists = $exists
      row_count = $rowCount
      canonical_targets = $candidate.canonicalTargets
      cleanup_action = $candidate.cleanupAction
      reason = $candidate.reason
    }) | Out-Null
  }

  return $items
}

function Write-CleanupSql {
  param(
    [object[]]$Inventory,
    [string]$SqlPath,
    [string]$RollbackPath,
    [string]$Stamp
  )

  $sqlLines = New-Object System.Collections.Generic.List[string]
  $rollbackLines = New-Object System.Collections.Generic.List[string]
  $sqlLines.Add("-- Generated by scripts/windows/execute-legacy-cleanup.ps1") | Out-Null
  $sqlLines.Add("-- Executes approved legacy table quarantine and DROP after hard gates.") | Out-Null
  $sqlLines.Add("BEGIN;") | Out-Null
  $sqlLines.Add("CREATE SCHEMA IF NOT EXISTS legacy_quarantine;") | Out-Null

  $rollbackLines.Add("-- Generated by scripts/windows/execute-legacy-cleanup.ps1") | Out-Null
  $rollbackLines.Add("-- Rollback script for the approved legacy cleanup run.") | Out-Null
  $rollbackLines.Add("BEGIN;") | Out-Null

  foreach ($item in @($Inventory | Where-Object { $_.exists })) {
    $table = [string]$item.table
    $archive = "$($table)_$Stamp"
    $sqlLines.Add("-- Quarantine and drop public.$table") | Out-Null
    $sqlLines.Add("CREATE TABLE IF NOT EXISTS legacy_quarantine.$archive (LIKE public.$table INCLUDING ALL);") | Out-Null
    $sqlLines.Add("INSERT INTO legacy_quarantine.$archive SELECT * FROM public.$table;") | Out-Null
    $sqlLines.Add("DROP TABLE IF EXISTS public.$table;") | Out-Null

    $rollbackLines.Add("-- Restore public.$table from legacy_quarantine.$archive") | Out-Null
    $rollbackLines.Add("CREATE TABLE IF NOT EXISTS public.$table (LIKE legacy_quarantine.$archive INCLUDING ALL);") | Out-Null
    $rollbackLines.Add("INSERT INTO public.$table SELECT * FROM legacy_quarantine.$archive;") | Out-Null
  }

  $sqlLines.Add("COMMIT;") | Out-Null
  $rollbackLines.Add("COMMIT;") | Out-Null

  $sqlLines | Set-Content -LiteralPath $SqlPath -Encoding ASCII
  $rollbackLines | Set-Content -LiteralPath $RollbackPath -Encoding ASCII
}

function Assert-CanonicalTablesPresent {
  foreach ($table in @("jobs", "job_attempts", "payment_orders", "payment_callbacks", "wallet_ledger", "wallet_balances", "project_storyboards", "project_videos", "project_dubbings")) {
    $exists = Invoke-PsqlScalar "SELECT CASE WHEN to_regclass('public.$table') IS NULL THEN 'false' ELSE 'true' END;"
    if ($exists -ne "true") {
      Add-Item $script:blockers "canonical-table-present" "failed" "Canonical table public.$table is missing after cleanup."
    } else {
      Add-Item $script:checks "canonical-table-present" "ok" "Canonical table public.$table is present."
    }
  }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$sqlStamp = Get-Date -Format "yyyyMMdd_HHmmss"
$runDir = Join-Path $logDir "legacy-cleanup-execute-$stamp"
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

$steps = New-List
$checks = New-List
$blockers = New-List
$warnings = New-List
$evidencePending = New-List
$reviewItems = New-List
$backupFile = $null

$pgBinPath = Resolve-PostgresBin $PgBin
$psql = Resolve-PostgresTool $pgBinPath "psql.exe"
$libpqUrl = ConvertTo-LibpqDatabaseUrl $DatabaseUrl
$dbInfo = Get-DatabaseUserInfo $DatabaseUrl
if ($dbInfo.password) {
  [Environment]::SetEnvironmentVariable("PGPASSWORD", $dbInfo.password, "Process")
}
if (-not $RestorePassword) {
  $RestorePassword = $dbInfo.password
}

if (-not $Execute) {
  Add-Item $blockers "execute-switch-required" "blocked" "Re-run with -Execute to perform physical legacy cleanup."
}

$backupDir = [Environment]::GetEnvironmentVariable("BACKUP_DIR", "Process")
if (-not $backupDir) {
  $backupDir = Join-Path $RepoRoot ".runtime\xiaolou-backups"
}
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

Invoke-BackupStep -Name "fresh-postgres-backup" -BackupDir $backupDir

if ($backupFile) {
  $verifyBackupReport = Join-Path $runDir "postgres-backup-verify.json"
  Invoke-ReportStep "restore-drill" $verifyBackupReport {
    $previousPgPassword = [Environment]::GetEnvironmentVariable("PGPASSWORD", "Process")
    try {
      if ($RestorePassword) {
        [Environment]::SetEnvironmentVariable("PGPASSWORD", $RestorePassword, "Process")
      }
      & "$PSScriptRoot\verify-postgres-backup.ps1" `
        -DumpFile $backupFile `
        -PgBin $pgBinPath `
        -HostName $dbInfo.host `
        -Port $dbInfo.port `
        -Username $RestoreUsername `
        -Database ("xiaolou_verify_cleanup_" + (Get-Date -Format "yyyyMMdd_HHmmss")) `
        -ReportPath $verifyBackupReport | Out-Null
    } finally {
      [Environment]::SetEnvironmentVariable("PGPASSWORD", $previousPgPassword, "Process")
    }
  } | Out-Null
}

Invoke-P0Step "pre-cleanup-p0" (Join-Path $runDir "pre-cleanup-p0.json")

$frontendReport = Join-Path $runDir "frontend-legacy-dependencies.json"
Invoke-ReportStep "pre-cleanup-frontend-hard-gate" $frontendReport {
  & "$PSScriptRoot\verify-frontend-legacy-dependencies.ps1" `
    -RepoRoot $RepoRoot `
    -ReportPath $frontendReport `
    -FailOnLegacyWriteDependency | Out-Null
} | Out-Null

$p2Report = Join-Path $runDir "p2-cutover-audit.json"
Invoke-ReportStep "pre-cleanup-p2-audit" $p2Report {
  & "$PSScriptRoot\verify-p2-cutover-audit.ps1" `
    -RepoRoot $RepoRoot `
    -EnvFile $EnvFile `
    -NodeExe $NodeExe `
    -ReportPath $p2Report `
    -CoreApiPort $CoreApiPort `
    -LegacyWritesFrozen `
    -FailOnFrontendLegacyWriteDependency | Out-Null
} | Out-Null

$walletReport = Join-Path $runDir "wallet-ledger-audit.json"
try {
  & "$PSScriptRoot\audit-wallet-ledger.ps1" -OutputPath $walletReport -FailOnMismatch | Out-Null
  $steps.Add([ordered]@{ name = "pre-cleanup-wallet-ledger-audit"; status = "ok"; report = $walletReport }) | Out-Null
  Add-Item $checks "pre-cleanup-wallet-ledger-audit" "ok" "wallet ledger audit completed." ([ordered]@{ report = $walletReport })
} catch {
  Add-Item $blockers "pre-cleanup-wallet-ledger-audit" "failed" $_.Exception.Message ([ordered]@{ report = $walletReport })
}

$projectionReport = Join-Path $runDir "legacy-canonical-projection.json"
Invoke-ReportStep "pre-cleanup-projection-verifier" $projectionReport {
  & "$PSScriptRoot\verify-legacy-canonical-projection.ps1" `
    -RepoRoot $RepoRoot `
    -EnvFile $EnvFile `
    -DatabaseUrl $DatabaseUrl `
    -ReportPath $projectionReport `
    -AllowMissingLegacy `
    -LegacyWritesFrozen | Out-Null
} -AllowWarnings | Out-Null

$opsReport = Join-Path $runDir "windows-service-ops-drill.json"
Invoke-ReportStep "pre-cleanup-service-ops-drill" $opsReport {
  & "$PSScriptRoot\verify-windows-service-ops-drill.ps1" `
    -SourceRoot $RepoRoot `
    -BaseUrl $BaseUrl `
    -ReportPath $opsReport | Out-Null
} | Out-Null

$dryRunReport = Join-Path $runDir "legacy-cleanup-dry-run.json"
$dryRunSummary = Invoke-ReportStep "pre-cleanup-s4-dry-run" $dryRunReport {
  & "$PSScriptRoot\verify-legacy-cleanup-dry-run.ps1" `
    -RepoRoot $RepoRoot `
    -EnvFile $EnvFile `
    -DatabaseUrl $DatabaseUrl `
    -ReportPath $dryRunReport | Out-Null
} | Out-Null

if ($blockers.Count -eq 0) {
  $dryRunJson = (Read-JsonReport $dryRunReport).json
  $cleanupCandidates = @($dryRunJson.cleanup_candidates)
  $beforeInventory = @(Get-CleanupInventory $cleanupCandidates)
  $nonEmpty = @($beforeInventory | Where-Object { $_.exists -and $_.row_count -gt 0 })
  if ($nonEmpty.Count -gt 0 -and -not $AllowNonEmptyLegacyTables) {
    Add-Item $blockers "legacy-cleanup-candidates-have-rows" "blocked" "Legacy cleanup candidates contain rows. Re-run with -AllowNonEmptyLegacyTables only after reviewing projection evidence." $nonEmpty
  }
}

$cleanupSqlPath = Join-Path $runDir "legacy-cleanup-execute.sql"
$rollbackSqlPath = Join-Path $runDir "legacy-cleanup-rollback.sql"
$beforeInventory = @()
$afterInventory = @()

if ($blockers.Count -eq 0 -and $Execute) {
  try {
    if (-not $cleanupCandidates -or $cleanupCandidates.Count -eq 0) {
      throw "No cleanup candidates were available from the S4 dry-run report."
    }

    $beforeInventory = @(Get-CleanupInventory $cleanupCandidates)
    Write-CleanupSql -Inventory $beforeInventory -SqlPath $cleanupSqlPath -RollbackPath $rollbackSqlPath -Stamp $sqlStamp
    Invoke-PsqlFile $cleanupSqlPath
    Add-Item $checks "legacy-cleanup-execute" "ok" "Legacy cleanup SQL executed." ([ordered]@{ cleanup_sql = $cleanupSqlPath; rollback_sql = $rollbackSqlPath })
    $steps.Add([ordered]@{ name = "legacy-cleanup-execute"; status = "ok"; cleanup_sql = $cleanupSqlPath; rollback_sql = $rollbackSqlPath }) | Out-Null

    $afterInventory = @(Get-CleanupInventory $cleanupCandidates)
    foreach ($item in @($beforeInventory | Where-Object { $_.exists })) {
      $after = @($afterInventory | Where-Object { $_.table -eq $item.table } | Select-Object -First 1)
      if ($after -and $after.exists) {
        Add-Item $blockers "legacy-table-still-present" "failed" "public.$($item.table) still exists after cleanup." $after
      } else {
        Add-Item $checks "legacy-table-dropped" "ok" "public.$($item.table) was dropped after quarantine."
      }
    }

    Assert-CanonicalTablesPresent
  } catch {
    Add-Item $blockers "legacy-cleanup-execute" "failed" $_.Exception.Message ([ordered]@{ cleanup_sql = $cleanupSqlPath; rollback_sql = $rollbackSqlPath })
  }
}

if ($blockers.Count -eq 0 -and $Execute) {
  Invoke-P0Step "post-cleanup-p0" (Join-Path $runDir "post-cleanup-p0.json")

  $postProjectionReport = Join-Path $runDir "post-cleanup-legacy-canonical-projection.json"
  Invoke-ReportStep "post-cleanup-projection-verifier" $postProjectionReport {
    & "$PSScriptRoot\verify-legacy-canonical-projection.ps1" `
      -RepoRoot $RepoRoot `
      -EnvFile $EnvFile `
      -DatabaseUrl $DatabaseUrl `
      -ReportPath $postProjectionReport `
      -AllowMissingLegacy `
      -LegacyWritesFrozen | Out-Null
  } -AllowWarnings | Out-Null

  $postWalletReport = Join-Path $runDir "post-cleanup-wallet-ledger-audit.json"
  try {
    & "$PSScriptRoot\audit-wallet-ledger.ps1" -OutputPath $postWalletReport -FailOnMismatch | Out-Null
    $steps.Add([ordered]@{ name = "post-cleanup-wallet-ledger-audit"; status = "ok"; report = $postWalletReport }) | Out-Null
    Add-Item $checks "post-cleanup-wallet-ledger-audit" "ok" "wallet ledger audit completed after cleanup." ([ordered]@{ report = $postWalletReport })
  } catch {
    Add-Item $blockers "post-cleanup-wallet-ledger-audit" "failed" $_.Exception.Message ([ordered]@{ report = $postWalletReport })
  }
}

Add-Item $evidencePending "operator-final-acceptance-evidence" "pending-evidence" "Real provider health, production legacy dump/source, real payment material, and real restore drill remain tracked only in the README final acceptance module."

$status = if ($blockers.Count -gt 0) {
  "blocked"
} elseif ($warnings.Count -gt 0) {
  "warning"
} else {
  "ok"
}

$report = [ordered]@{
  generated_at_utc = [DateTimeOffset]::UtcNow.ToString("O")
  status = $status
  phase = "legacy-cleanup-physical-execution"
  source_root = $RepoRoot
  env_file = $EnvFile
  database_url = Redact-DatabaseUrl $DatabaseUrl
  base_url = $BaseUrl
  execute = [bool]$Execute
  allow_non_empty_legacy_tables = [bool]$AllowNonEmptyLegacyTables
  physical_cleanup_executed = [bool]($Execute -and ($steps | Where-Object { $_.name -eq "legacy-cleanup-execute" -and $_.status -eq "ok" }))
  backup_file = $backupFile
  run_dir = $runDir
  cleanup_sql = $cleanupSqlPath
  rollback_sql = $rollbackSqlPath
  before_inventory = $beforeInventory
  after_inventory = $afterInventory
  steps = $steps
  checks = $checks
  blockers = $blockers
  warnings = $warnings
  evidence_pending = $evidencePending
  review_items = $reviewItems
}

$report | ConvertTo-Json -Depth 14 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 14

if ($blockers.Count -gt 0) {
  throw "Legacy cleanup execution found $($blockers.Count) blocker(s). See $ReportPath"
}
