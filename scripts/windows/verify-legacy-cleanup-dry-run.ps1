param(
  [string]$RepoRoot = "",
  [string]$EnvFile = "$PSScriptRoot\.env.windows",
  [string]$CoreApiRoot = "",
  [string]$ServicesApiRoot = "",
  [string]$JaazRoot = "",
  [string]$PgBin = "",
  [string]$DatabaseUrl = "",
  [string]$ReportPath = "",
  [string]$LegacySurfaceManifestPath = "",
  [string]$LegacyProjectionManifestPath = "",
  [switch]$AssessPhysicalSourceRemovalReadiness,
  [switch]$PreserveProtectedLocalMaterialInPlace,
  [switch]$AssessTrackedSourceDeletionTargets,
  [string]$RetainedEvidenceRoot = "",
  [switch]$SkipDatabaseInventory,
  [switch]$SkipRuntimeDependencyGate,
  [switch]$SkipProjectionGate,
  [switch]$SkipQuarantineSqlValidation
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

if (-not $ServicesApiRoot) {
  $ServicesApiRoot = Join-Path $RepoRoot "legacy\services-api"
} elseif (-not [System.IO.Path]::IsPathRooted($ServicesApiRoot)) {
  $ServicesApiRoot = Join-Path $RepoRoot $ServicesApiRoot
}
$ServicesApiRoot = [System.IO.Path]::GetFullPath($ServicesApiRoot)

if (-not $JaazRoot) {
  $JaazRoot = Join-Path $RepoRoot "legacy\jaaz"
} elseif (-not [System.IO.Path]::IsPathRooted($JaazRoot)) {
  $JaazRoot = Join-Path $RepoRoot $JaazRoot
}
$JaazRoot = [System.IO.Path]::GetFullPath($JaazRoot)

if ($LegacySurfaceManifestPath) {
  if (-not [System.IO.Path]::IsPathRooted($LegacySurfaceManifestPath)) {
    $LegacySurfaceManifestPath = Join-Path $RepoRoot $LegacySurfaceManifestPath
  }
  $LegacySurfaceManifestPath = [System.IO.Path]::GetFullPath($LegacySurfaceManifestPath)
}

if ($LegacyProjectionManifestPath) {
  if (-not [System.IO.Path]::IsPathRooted($LegacyProjectionManifestPath)) {
    $LegacyProjectionManifestPath = Join-Path $RepoRoot $LegacyProjectionManifestPath
  }
  $LegacyProjectionManifestPath = [System.IO.Path]::GetFullPath($LegacyProjectionManifestPath)
}

if ($RetainedEvidenceRoot) {
  if (-not [System.IO.Path]::IsPathRooted($RetainedEvidenceRoot)) {
    $RetainedEvidenceRoot = Join-Path $RepoRoot $RetainedEvidenceRoot
  }
  $RetainedEvidenceRoot = [System.IO.Path]::GetFullPath($RetainedEvidenceRoot)
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
  $runtimeEnvFile = Join-Path $RepoRoot ".runtime\app\scripts\windows\.env.windows"
  if (Test-Path -LiteralPath $runtimeEnvFile) {
    $EnvFile = $runtimeEnvFile
  }
}

. "$PSScriptRoot\load-env.ps1" -EnvFile $EnvFile

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

  if (-not $Value) {
    return $null
  }

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

function Invoke-PsqlScalar {
  param(
    [string]$Psql,
    [string]$Url,
    [string]$Sql
  )

  $output = & $Psql $Url "--tuples-only" "--no-align" "--quiet" "--set=ON_ERROR_STOP=1" "--command=$Sql"
  if ($LASTEXITCODE -ne 0) {
    throw "psql query failed with exit code $LASTEXITCODE"
  }

  return ($output | Where-Object { $_ -and $_.Trim() } | Select-Object -First 1).Trim()
}

function Quote-SqlLiteral {
  param([string]$Value)
  return "'" + $Value.Replace("'", "''") + "'"
}

function Get-DisplayPath {
  param([string]$Path)

  $fullRoot = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd("\", "/")
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if ($fullPath.StartsWith($fullRoot, [StringComparison]::OrdinalIgnoreCase)) {
    return $fullPath.Substring($fullRoot.Length).TrimStart("\", "/")
  }
  return $fullPath
}

function Test-IsUnderPath {
  param(
    [string]$Path,
    [string]$Parent
  )

  if (-not $Path -or -not $Parent) {
    return $false
  }

  $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd("\", "/")
  $fullParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd("\", "/")
  return $fullPath.Equals($fullParent, [StringComparison]::OrdinalIgnoreCase) -or
    $fullPath.StartsWith($fullParent + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    $fullPath.StartsWith($fullParent + [System.IO.Path]::AltDirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

function ConvertTo-GitPath {
  param([string]$Path)

  $displayPath = Get-DisplayPath $Path
  return $displayPath.Replace("\", "/")
}

function Test-GitPathMatchesPrefix {
  param(
    [string]$Path,
    [string]$Prefix
  )

  $normalizedPath = $Path.TrimStart("/").Replace("\", "/")
  $normalizedPrefix = $Prefix.TrimStart("/").TrimEnd("/").Replace("\", "/")
  return $normalizedPath.Equals($normalizedPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    $normalizedPath.StartsWith($normalizedPrefix + "/", [StringComparison]::OrdinalIgnoreCase)
}

function Get-GitTrackedFiles {
  param([string[]]$Paths)

  $gitPaths = @($Paths | ForEach-Object { ConvertTo-GitPath $_ })
  $output = & git -C $RepoRoot ls-files -- $gitPaths 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "git ls-files failed with exit code $LASTEXITCODE"
  }

  return @($output | Where-Object { $_ })
}

function Get-PathInventory {
  param(
    [string]$Path,
    [string]$Kind,
    [string]$Reason
  )

  $exists = Test-Path -LiteralPath $Path
  $entry = [ordered]@{
    path = Get-DisplayPath $Path
    kind = $Kind
    exists = [bool]$exists
    reason = $Reason
  }
  if ($exists) {
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.PSIsContainer) {
      $children = @(Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue)
      $files = @($children | Where-Object { -not $_.PSIsContainer })
      $entry["item_count"] = $children.Count
      $entry["file_count"] = $files.Count
      $entry["total_bytes"] = [int64](($files | Measure-Object -Property Length -Sum).Sum)
    } else {
      $entry["item_count"] = 1
      $entry["file_count"] = 1
      $entry["total_bytes"] = [int64]$item.Length
    }
  }
  return $entry
}

function Add-ManifestEvidence {
  param(
    [string]$Name,
    [string]$Path,
    [string]$ExpectedSchema,
    [System.Collections.Generic.List[object]]$Checks,
    [System.Collections.Generic.List[object]]$Blockers
  )

  if (-not $Path) {
    Add-Item $Blockers $Name "missing" "$Name is required before tracked legacy source deletion readiness can be claimed."
    return
  }
  if (-not (Test-Path -LiteralPath $Path)) {
    Add-Item $Blockers $Name "missing" "$Name path does not exist." ([ordered]@{ path = Get-DisplayPath $Path })
    return
  }

  try {
    $json = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    if ([string]$json.schema -eq $ExpectedSchema) {
      Add-Item $Checks $Name "ok" "$Name exists and has the expected schema." ([ordered]@{ path = Get-DisplayPath $Path; schema = [string]$json.schema })
    } else {
      Add-Item $Blockers $Name "failed" "$Name must have schema '$ExpectedSchema'." ([ordered]@{ path = Get-DisplayPath $Path; actual = [string]$json.schema })
    }
  } catch {
    Add-Item $Blockers $Name "failed" "$Name is not valid JSON." ([ordered]@{ path = Get-DisplayPath $Path; error = $_.Exception.Message })
  }
}

function Get-TableInventory {
  param(
    [string]$Psql,
    [string]$Url,
    [object[]]$Candidates
  )

  $items = New-List
  foreach ($candidate in $Candidates) {
    $tableName = [string]$candidate.table
    $literal = Quote-SqlLiteral $tableName
    $existsValue = Invoke-PsqlScalar $Psql $Url "SELECT CASE WHEN to_regclass('public.$tableName') IS NULL THEN 'false' ELSE 'true' END;"
    $exists = $existsValue -eq "true"
    $rowCount = $null
    $columns = @()
    if ($exists) {
      $rowCountValue = Invoke-PsqlScalar $Psql $Url "SELECT count(*)::text FROM public.$tableName;"
      $rowCount = [int64]$rowCountValue
      $columnsJson = Invoke-PsqlScalar $Psql $Url "SELECT COALESCE(json_agg(json_build_object('name', column_name, 'type', data_type, 'nullable', is_nullable) ORDER BY ordinal_position), '[]'::json)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $literal;"
      $parsedColumns = $columnsJson | ConvertFrom-Json
      $columns = if ($null -eq $parsedColumns) { @() } else { $parsedColumns }
    }

    $items.Add([ordered]@{
      table = $tableName
      exists = $exists
      row_count = $rowCount
      canonical_targets = $candidate.canonicalTargets
      cleanup_action = $candidate.cleanupAction
      reason = $candidate.reason
      columns = $columns
    }) | Out-Null
  }

  return $items
}

function Assert-NoActiveDestructiveSql {
  param(
    [string]$Path,
    [System.Collections.Generic.List[object]]$Blockers
  )

  $active = @(Get-Content -LiteralPath $Path | Where-Object {
    $line = $_.Trim()
    $line -and -not $line.StartsWith("--") -and ($line -match "(?i)\b(drop\s+table|drop\s+column|alter\s+table\s+.*\s+drop)\b")
  })
  if ($active.Count -gt 0) {
    Add-Item $Blockers "dry-run-sql-active-destructive-statement" "blocked" "Generated dry-run SQL must not contain active DROP/ALTER DROP statements." ([ordered]@{ path = $Path; lines = $active })
  }
}

function Assert-HasRollbackGuard {
  param(
    [string]$Path,
    [System.Collections.Generic.List[object]]$Blockers
  )

  $text = Get-Content -LiteralPath $Path -Raw
  if ($text -notmatch "(?im)^\s*ROLLBACK\s*;") {
    Add-Item $Blockers "dry-run-sql-missing-rollback" "blocked" "Generated dry-run SQL must end in an explicit ROLLBACK guard." ([ordered]@{ path = $Path })
  }
}

function Invoke-QuarantineSqlValidation {
  param(
    [string]$Psql,
    [string]$Url,
    [string]$SqlPath,
    [string]$ArchiveStamp,
    [System.Collections.Generic.List[object]]$Checks,
    [System.Collections.Generic.List[object]]$Blockers
  )

  try {
    & $Psql $Url "--set=ON_ERROR_STOP=1" "--file" $SqlPath | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "psql returned exit code $LASTEXITCODE"
    }

    $leakedArchiveTables = Invoke-PsqlScalar $Psql $Url "SELECT count(*)::text FROM information_schema.tables WHERE table_schema = 'legacy_quarantine' AND table_name LIKE '%_$ArchiveStamp';"
    if ([int64]$leakedArchiveTables -ne 0) {
      Add-Item $Blockers "quarantine-dry-run-left-archive-tables" "blocked" "Quarantine dry-run left archive tables after ROLLBACK." ([ordered]@{ leaked_archive_tables = [int64]$leakedArchiveTables; archive_stamp = $ArchiveStamp })
      return
    }

    Add-Item $Checks "quarantine-dry-run-sql-validation" "ok" "Quarantine dry-run SQL executed under ROLLBACK and left no archive tables." ([ordered]@{ path = $SqlPath; archive_stamp = $ArchiveStamp })
  } catch {
    Add-Item $Blockers "quarantine-dry-run-sql-validation" "blocked" $_.Exception.Message ([ordered]@{ path = $SqlPath; archive_stamp = $ArchiveStamp })
  }
}

function Invoke-GuardScript {
  param(
    [string]$Name,
    [string]$ScriptPath,
    [hashtable]$ScriptArgs,
    [System.Collections.Generic.List[object]]$Checks,
    [System.Collections.Generic.List[object]]$Blockers
  )

  try {
    & $ScriptPath @ScriptArgs | Out-Null
    Add-Item $Checks $Name "ok" "$Name completed." ([ordered]@{ report = $ScriptArgs.ReportPath })
  } catch {
    Add-Item $Blockers $Name "blocked" $_.Exception.Message ([ordered]@{ report = $ScriptArgs.ReportPath })
  }
}

if (-not $ReportPath) {
  $logDir = [Environment]::GetEnvironmentVariable("LOG_DIR", "Process")
  if (-not $logDir) {
    $logDir = Join-Path $RepoRoot ".runtime\xiaolou-logs"
  }
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $ReportPath = Join-Path $logDir ("legacy-cleanup-dry-run-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null

if (-not $DatabaseUrl) {
  $DatabaseUrl = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
}
if (-not $DatabaseUrl -or $DatabaseUrl.Contains("change-me")) {
  $DatabaseUrl = "postgres://root:root@127.0.0.1:5432/xiaolou_windows_native_test"
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$sqlStamp = Get-Date -Format "yyyyMMdd_HHmmss"
$planDir = Join-Path (Split-Path -Parent $ReportPath) "legacy-cleanup-dry-run-$stamp"
New-Item -ItemType Directory -Force -Path $planDir | Out-Null

$checks = New-List
$blockers = New-List
$warnings = New-List
$reviewItems = New-List
$evidencePending = New-List
$protectedLocalMaterial = @()
$trackedSourceRollbackPlan = $null
$fixtureArchivePlan = $null
$trackedSourceDeletionPlan = $null

$requiredScripts = @(
  "backup-postgres.ps1",
  "verify-postgres-backup.ps1",
  "restore-postgres.ps1",
  "verify-control-plane-p0.ps1",
  "verify-p2-cutover-audit.ps1",
  "verify-legacy-runtime-dependencies.ps1",
  "verify-legacy-canonical-projection.ps1",
  "audit-wallet-ledger.ps1",
  "verify-windows-service-ops-drill.ps1",
  "complete-control-api-publish-restart-p0.ps1"
)
foreach ($scriptName in $requiredScripts) {
  $scriptPath = Join-Path $PSScriptRoot $scriptName
  if (Test-Path -LiteralPath $scriptPath) {
    Add-Item $checks "required-script-$scriptName" "ok" "$scriptName is present."
  } else {
    Add-Item $blockers "required-script-$scriptName" "missing" "$scriptName is required before legacy cleanup can be executed."
  }
}

$cleanupCandidates = @(
  [ordered]@{ table = "tasks"; canonicalTargets = @("jobs", "job_attempts"); cleanupAction = "quarantine-then-drop"; reason = "Legacy Node task queue; Windows-native runtime uses canonical jobs." },
  [ordered]@{ table = "provider_jobs"; canonicalTargets = @("jobs", "job_attempts", "provider_health"); cleanupAction = "quarantine-then-drop"; reason = "Legacy provider job staging; canonical provider execution is job-backed." },
  [ordered]@{ table = "video_replace_jobs"; canonicalTargets = @("jobs", "media_objects", "project_videos"); cleanupAction = "quarantine-then-drop"; reason = "Retired video-replace job staging; runtime route is closed/read-only." },
  [ordered]@{ table = "wallet_recharge_orders"; canonicalTargets = @("payment_orders", "payment_callbacks", "wallet_ledger", "wallet_balances"); cleanupAction = "quarantine-then-drop"; reason = "Legacy recharge order table; canonical payment/wallet route is ledger-backed." },
  [ordered]@{ table = "payment_events"; canonicalTargets = @("payment_callbacks", "wallet_ledger", "outbox_events"); cleanupAction = "quarantine-then-drop"; reason = "Legacy payment event log; canonical callbacks and ledger are authoritative." },
  [ordered]@{ table = "wallets"; canonicalTargets = @("wallet_balances", "wallet_ledger"); cleanupAction = "quarantine-then-drop"; reason = "Legacy wallet balance table; immutable ledger and balance snapshots are authoritative." },
  [ordered]@{ table = "storyboards"; canonicalTargets = @("project_storyboards"); cleanupAction = "quarantine-then-drop"; reason = "Legacy project-adjacent table projected into project_storyboards." },
  [ordered]@{ table = "videos"; canonicalTargets = @("project_videos"); cleanupAction = "quarantine-then-drop"; reason = "Legacy project-adjacent table projected into project_videos." },
  [ordered]@{ table = "dubbings"; canonicalTargets = @("project_dubbings"); cleanupAction = "quarantine-then-drop"; reason = "Legacy project-adjacent table projected into project_dubbings." }
)

$retainedObjects = @(
  [ordered]@{ name = "wallet_ledger"; kind = "table"; reason = "Canonical immutable accounting ledger; never a cleanup candidate." },
  [ordered]@{ name = "wallet_balances"; kind = "table"; reason = "Canonical wallet balance snapshot; never a cleanup candidate." },
  [ordered]@{ name = "payment_orders"; kind = "table"; reason = "Canonical payment order table." },
  [ordered]@{ name = "payment_callbacks"; kind = "table"; reason = "Canonical payment callback table." },
  [ordered]@{ name = "jobs"; kind = "table"; reason = "Canonical PostgreSQL job queue." },
  [ordered]@{ name = "job_attempts"; kind = "table"; reason = "Canonical job attempt history." },
  [ordered]@{ name = "project_assets"; kind = "table"; reason = "Canonical project asset table even though it appears in legacy import checks." },
  [ordered]@{ name = "project_storyboards"; kind = "table"; reason = "Canonical storyboard table." },
  [ordered]@{ name = "project_videos"; kind = "table"; reason = "Canonical project video table." },
  [ordered]@{ name = "project_dubbings"; kind = "table"; reason = "Canonical project dubbing table." },
  [ordered]@{ name = "create_studio_images"; kind = "table"; reason = "Canonical create studio image table." },
  [ordered]@{ name = "create_studio_videos"; kind = "table"; reason = "Canonical create studio video table." },
  [ordered]@{ name = "*.data"; kind = "jsonb-column"; reason = "Canonical extension/backfill payload; not a legacy cleanup target until a separate column-level migration exists." },
  [ordered]@{ name = "*.*_id pointing at jobs/media/projects"; kind = "reference-column"; reason = "Canonical linkage field; do not drop as an old field solely due legacy naming." }
)

$inventory = @()
$pgBinPath = $null
$psql = $null
if (-not $SkipDatabaseInventory) {
  try {
    $pgBinPath = Resolve-PostgresBin $PgBin
    $psql = Resolve-PostgresTool $pgBinPath "psql.exe"
    $inventory = @(Get-TableInventory $psql (ConvertTo-LibpqDatabaseUrl $DatabaseUrl) $cleanupCandidates)
    Add-Item $checks "database-legacy-inventory" "ok" "Current database legacy cleanup inventory was collected." ([ordered]@{ table_count = $inventory.Count })
  } catch {
    Add-Item $blockers "database-legacy-inventory" "blocked" $_.Exception.Message
  }
} else {
  Add-Item $warnings "database-legacy-inventory-skipped" "skipped" "Database inventory was skipped; generated SQL remains conditional but current DB evidence is absent."
}

if (-not $SkipRuntimeDependencyGate) {
  $runtimeReport = Join-Path $planDir "legacy-runtime-dependencies.json"
  $runtimeArgs = @{
    RepoRoot = $RepoRoot
    CoreApiRoot = $CoreApiRoot
    ReportPath = $runtimeReport
  }
  if ($LegacySurfaceManifestPath) {
    $runtimeArgs.LegacySurfaceManifestPath = $LegacySurfaceManifestPath
  }
  if ($LegacyProjectionManifestPath) {
    $runtimeArgs.LegacyProjectionManifestPath = $LegacyProjectionManifestPath
  }
  Invoke-GuardScript `
    -Name "legacy-runtime-dependency-isolation" `
    -ScriptPath (Join-Path $PSScriptRoot "verify-legacy-runtime-dependencies.ps1") `
    -ScriptArgs $runtimeArgs `
    -Checks $checks `
    -Blockers $blockers
}

if (-not $SkipProjectionGate) {
  $projectionReport = Join-Path $planDir "legacy-canonical-projection.json"
  $projectionArgs = @{
    RepoRoot = $RepoRoot
    EnvFile = $EnvFile
    DatabaseUrl = $DatabaseUrl
    ReportPath = $projectionReport
    AllowMissingLegacy = $true
    LegacyWritesFrozen = $true
  }
  if ($LegacyProjectionManifestPath) {
    $projectionArgs.LegacyProjectionManifestPath = $LegacyProjectionManifestPath
  }
  Invoke-GuardScript `
    -Name "legacy-canonical-projection-gate" `
    -ScriptPath (Join-Path $PSScriptRoot "verify-legacy-canonical-projection.ps1") `
    -ScriptArgs $projectionArgs `
    -Checks $checks `
    -Blockers $blockers
}

$existingWithRows = @($inventory | Where-Object { $_.exists -and $_.row_count -gt 0 })
if ($existingWithRows.Count -gt 0) {
  Add-Item $warnings "legacy-cleanup-candidates-have-rows" "review" "One or more legacy cleanup candidate tables currently contain rows; physical cleanup must wait for strict projection evidence and verified quarantine." $existingWithRows
} elseif ($inventory.Count -gt 0) {
  Add-Item $reviewItems "legacy-cleanup-candidates-empty-or-absent" "review" "No legacy cleanup candidate rows were found in the current runtime database; generated SQL remains conditional for future restored legacy sources."
}

Add-Item $evidencePending "operator-final-acceptance-evidence" "pending-evidence" "Real provider health, production legacy dump/source, real payment material, and real restore drill remain tracked only in the README final acceptance module."

if ($AssessPhysicalSourceRemovalReadiness) {
  $protectedLocalMaterial = @(
    (Get-PathInventory -Path (Join-Path $CoreApiRoot "uploads") -Kind "local-user-data" -Reason "Legacy upload material; preserve/archive/approval required before any source tree deletion.")
    (Get-PathInventory -Path (Join-Path $CoreApiRoot "data") -Kind "local-runtime-data" -Reason "Legacy SQLite/canvas-library data; preserve/archive/approval required before any source tree deletion.")
    (Get-PathInventory -Path (Join-Path $CoreApiRoot "backup") -Kind "local-backup-data" -Reason "Legacy backup material; preserve/archive/approval required before any source tree deletion.")
    (Get-PathInventory -Path (Join-Path $JaazRoot "server\user_data") -Kind "local-user-data" -Reason "Jaaz local user data; preserve/archive/approval required before any source tree deletion.")
    (Get-PathInventory -Path (Join-Path $CoreApiRoot ".env.local") -Kind "local-secret-or-env" -Reason "Local env file; do not read or move without explicit approval.")
    (Get-PathInventory -Path (Join-Path $CoreApiRoot "vertex-sa.json") -Kind "local-secret" -Reason "Local service-account material; do not read or move without explicit approval.")
  )
  $presentProtected = @($protectedLocalMaterial | Where-Object { $_.exists })
  if ($presentProtected.Count -gt 0) {
    if ($PreserveProtectedLocalMaterialInPlace) {
      Add-Item $checks "protected-local-data-secrets-preserve-in-place" "ok" "Protected local data/secrets are present and explicitly preserved in place; any source deletion target must be git-tracked-files-only and must not recurse over live legacy roots." $presentProtected
      Add-Item $reviewItems "protected-local-data-secrets-present" "review" "Protected local data/secrets remain on disk by design. They are not deletion targets and their contents were not read." $presentProtected
    } else {
      Add-Item $blockers "protected-local-data-secrets-present" "blocked" "Tracked legacy source deletion cannot be proposed while protected local data/secrets remain in place without an explicit preserve/archive/approval path." $presentProtected
    }
  } else {
    Add-Item $checks "protected-local-data-secrets-present" "ok" "No protected local data/secrets were found under the configured legacy roots."
  }

  Add-ManifestEvidence "retained-final-legacy-surface-manifest" $LegacySurfaceManifestPath "xiaolou-final-legacy-surface-manifest-v1" $checks $blockers
  Add-ManifestEvidence "retained-legacy-projection-manifest" $LegacyProjectionManifestPath "xiaolou-legacy-canonical-projection-manifest-v1" $checks $blockers

  if ($AssessTrackedSourceDeletionTargets) {
    try {
      $trackedFiles = @(Get-GitTrackedFiles @($CoreApiRoot, $ServicesApiRoot, $JaazRoot))
      $protectedTrackedPrefixes = @(
        "legacy/core-api/uploads",
        "legacy/core-api/data",
        "legacy/core-api/backup",
        "legacy/jaaz/server/user_data",
        "legacy/core-api/.env.local",
        "legacy/core-api/vertex-sa.json"
      )
      $protectedTrackedFiles = @($trackedFiles | Where-Object {
        $path = $_
        @($protectedTrackedPrefixes | Where-Object { Test-GitPathMatchesPrefix $path $_ }).Count -gt 0
      })
      $trackedGitIgnoreFiles = @($trackedFiles | Where-Object {
        [System.IO.Path]::GetFileName($_) -eq ".gitignore"
      })
      $candidateTrackedSourceFiles = @($trackedFiles | Where-Object {
        $path = $_
        -not ($protectedTrackedFiles -contains $path) -and -not ($trackedGitIgnoreFiles -contains $path)
      })
      $trackedSourceDeletionPlan = [ordered]@{
        mode = "git-tracked-files-only"
        tracked_file_count = $trackedFiles.Count
        protected_tracked_file_count = $protectedTrackedFiles.Count
        protected_tracked_files = $protectedTrackedFiles
        preserved_gitignore_files = $trackedGitIgnoreFiles
        candidate_tracked_source_file_count = $candidateTrackedSourceFiles.Count
        candidate_tracked_source_files = $candidateTrackedSourceFiles
        forbidden_commands = @(
          "Remove-Item -Recurse legacy",
          "Remove-Item -Recurse legacy\core-api",
          "Remove-Item -Recurse legacy\services-api",
          "Remove-Item -Recurse legacy\jaaz",
          "rmdir /s legacy"
        )
        deletion_policy = "Use git rm only against the reviewed tracked file list. Preserve .gitignore files or add equivalent higher-level ignore coverage before removing them."
      }

      if ($protectedTrackedFiles.Count -gt 0) {
        Add-Item $blockers "tracked-source-targets-include-protected-material" "blocked" "Tracked deletion candidates include protected local material paths." $trackedSourceDeletionPlan
      } else {
        Add-Item $checks "tracked-source-targets-exclude-protected-material" "ok" "Git tracked legacy source inventory excludes protected local data/secret paths." $trackedSourceDeletionPlan
      }

      if ($trackedGitIgnoreFiles.Count -gt 0) {
        Add-Item $reviewItems "tracked-source-gitignore-preserve" "review" "Tracked .gitignore files under legacy roots protect future local data/secrets; keep them until equivalent ignore coverage exists." ([ordered]@{ files = $trackedGitIgnoreFiles })
      }
    } catch {
      Add-Item $blockers "tracked-source-target-inventory" "blocked" $_.Exception.Message
    }
  } else {
    Add-Item $reviewItems "tracked-source-target-inventory" "review" "Pass -AssessTrackedSourceDeletionTargets to produce the git-tracked-files-only deletion target inventory before proposing source deletion."
  }

  $fixtureArchivePlan = [ordered]@{
    required = $true
    retained_evidence_root = if ($RetainedEvidenceRoot) { Get-DisplayPath $RetainedEvidenceRoot } else { "" }
    current_final_surface_manifest = if ($LegacySurfaceManifestPath) { Get-DisplayPath $LegacySurfaceManifestPath } else { "" }
    current_projection_manifest = if ($LegacyProjectionManifestPath) { Get-DisplayPath $LegacyProjectionManifestPath } else { "" }
    required_retention = @(
      "final legacy surface manifest generated from live source",
      "legacy projection manifest generated from live source",
      "projection fixture boundary report or explicit fixtureSeeded=false manifest report",
      "P2 and RC reports that name skipped/reduced gates when full live evidence is unavailable"
    )
    decision = "Retain these artifacts as operator evidence before any tracked source deletion; .runtime evidence alone is local and should be copied to the chosen operator archive if deletion is approved."
  }
  $runtimeRoot = Join-Path $RepoRoot ".runtime"
  $retainedEvidenceRootOk = $false
  if ($RetainedEvidenceRoot -and
      -not (Test-IsUnderPath $RetainedEvidenceRoot $runtimeRoot) -and
      $LegacySurfaceManifestPath -and
      $LegacyProjectionManifestPath -and
      (Test-IsUnderPath $LegacySurfaceManifestPath $RetainedEvidenceRoot) -and
      (Test-IsUnderPath $LegacyProjectionManifestPath $RetainedEvidenceRoot)) {
    $retainedEvidenceRootOk = $true
  }

  if ($retainedEvidenceRootOk) {
    Add-Item $checks "fixture-archive-retention-path" "ok" "Retained final/projection manifests are under an explicit non-runtime evidence root." $fixtureArchivePlan
  } else {
    Add-Item $blockers "fixture-archive-retention-path" "blocked" "A committed or operator-approved fixture/archive retention path is still required before tracked legacy source deletion." $fixtureArchivePlan
  }

  $trackedSourceRollbackPlan = [ordered]@{
    tracked_source_restore = "git restore --source HEAD -- legacy\core-api legacy\services-api legacy\jaaz"
    dependency_restore = @(
      "npm --prefix legacy\core-api install",
      "npm --prefix legacy\jaaz\react install",
      "create legacy\services-api .venv only if a legacy reference run is explicitly required",
      "create legacy\jaaz .venv only if a legacy reference run is explicitly required"
    )
    retained_manifest_verification = @(
      ".\scripts\windows\verify-final-legacy-surface.ps1 -CoreApiRoot .\legacy\__missing-core-api -ServicesApiRoot .\legacy\__missing-services-api -LegacySurfaceManifestPath <retained-final-surface-manifest>",
      ".\scripts\windows\verify-legacy-canonical-projection.ps1 -CoreApiRoot .\legacy\__missing-core-api -LegacyProjectionManifestPath <retained-projection-manifest>"
    )
    post_restore_gates = @(
      ".\scripts\windows\verify-final-legacy-surface.ps1 -CoreApiRoot .\legacy\core-api -ServicesApiRoot .\legacy\services-api",
      ".\scripts\windows\verify-frontend-legacy-dependencies.ps1 -FailOnLegacyWriteDependency",
      "projection/P2/RC parser checks",
      "full P2/RC only after generated dependencies and required runtime evidence are restored"
    )
  }
  Add-Item $reviewItems "tracked-source-rollback-plan" "review" "Rollback path is documented for planning, but it is not yet an approval to delete tracked legacy source." $trackedSourceRollbackPlan
}

$quarantineSqlPath = Join-Path $planDir "legacy-cleanup-quarantine-dry-run.sql"
$cleanupSqlPath = Join-Path $planDir "legacy-cleanup-candidate.sql"
$rollbackSqlPath = Join-Path $planDir "legacy-cleanup-rollback-template.sql"

$quarantineLines = New-Object System.Collections.Generic.List[string]
$quarantineLines.Add("-- Generated by scripts/windows/verify-legacy-cleanup-dry-run.ps1") | Out-Null
$quarantineLines.Add("-- Dry-run only: this transaction intentionally rolls back.") | Out-Null
$quarantineLines.Add("BEGIN;") | Out-Null
$quarantineLines.Add("CREATE SCHEMA IF NOT EXISTS legacy_quarantine;") | Out-Null
$quarantineLines.Add("DO `$`$") | Out-Null
$quarantineLines.Add("BEGIN") | Out-Null
foreach ($candidate in $cleanupCandidates) {
  $tableName = $candidate.table
  $archiveName = "$($tableName)_$sqlStamp"
  $quarantineLines.Add("  IF to_regclass('public.$tableName') IS NOT NULL THEN") | Out-Null
  $quarantineLines.Add("    EXECUTE 'CREATE TABLE IF NOT EXISTS legacy_quarantine.$archiveName (LIKE public.$tableName INCLUDING ALL)';") | Out-Null
  $quarantineLines.Add("    EXECUTE 'INSERT INTO legacy_quarantine.$archiveName SELECT * FROM public.$tableName';") | Out-Null
  $quarantineLines.Add("    RAISE NOTICE 'Would quarantine public.$tableName into legacy_quarantine.$archiveName';") | Out-Null
  $quarantineLines.Add("  END IF;") | Out-Null
}
$quarantineLines.Add("END `$`$;") | Out-Null
$quarantineLines.Add("ROLLBACK;") | Out-Null

$cleanupLines = New-Object System.Collections.Generic.List[string]
$cleanupLines.Add("-- Generated by scripts/windows/verify-legacy-cleanup-dry-run.ps1") | Out-Null
$cleanupLines.Add("-- Candidate only: destructive statements are intentionally commented.") | Out-Null
$cleanupLines.Add("-- Required before uncommenting anything: fresh backup, verified restore drill, fixed publish/restart/P0, P2 audit, wallet audit, projection verifier, service ops drill, and README final acceptance evidence.") | Out-Null
$cleanupLines.Add("BEGIN;") | Out-Null
foreach ($candidate in $cleanupCandidates) {
  $tableName = $candidate.table
  $cleanupLines.Add("-- Candidate: public.$tableName -> $($candidate.canonicalTargets -join ', ')") | Out-Null
  $cleanupLines.Add("-- DROP TABLE IF EXISTS public.$tableName;") | Out-Null
}
$cleanupLines.Add("ROLLBACK;") | Out-Null

$rollbackLines = New-Object System.Collections.Generic.List[string]
$rollbackLines.Add("-- Generated by scripts/windows/verify-legacy-cleanup-dry-run.ps1") | Out-Null
$rollbackLines.Add("-- Rollback template only. Replace archive table names after a real quarantine run.") | Out-Null
$rollbackLines.Add("BEGIN;") | Out-Null
foreach ($candidate in $cleanupCandidates) {
  $tableName = $candidate.table
  $archiveName = "$($tableName)_$sqlStamp"
  $rollbackLines.Add("-- Restore public.$tableName from legacy_quarantine.$archiveName if an approved cleanup must be reverted.") | Out-Null
  $rollbackLines.Add("-- CREATE TABLE IF NOT EXISTS public.$tableName (LIKE legacy_quarantine.$archiveName INCLUDING ALL);") | Out-Null
  $rollbackLines.Add("-- INSERT INTO public.$tableName SELECT * FROM legacy_quarantine.$archiveName;") | Out-Null
}
$rollbackLines.Add("ROLLBACK;") | Out-Null

$quarantineLines | Set-Content -LiteralPath $quarantineSqlPath -Encoding ASCII
$cleanupLines | Set-Content -LiteralPath $cleanupSqlPath -Encoding ASCII
$rollbackLines | Set-Content -LiteralPath $rollbackSqlPath -Encoding ASCII

foreach ($sqlPath in @($quarantineSqlPath, $cleanupSqlPath, $rollbackSqlPath)) {
  Assert-HasRollbackGuard $sqlPath $blockers
  Assert-NoActiveDestructiveSql $sqlPath $blockers
}

if (-not $SkipQuarantineSqlValidation -and -not $SkipDatabaseInventory -and $psql) {
  Invoke-QuarantineSqlValidation `
    -Psql $psql `
    -Url (ConvertTo-LibpqDatabaseUrl $DatabaseUrl) `
    -SqlPath $quarantineSqlPath `
    -ArchiveStamp $sqlStamp `
    -Checks $checks `
    -Blockers $blockers
}

$executionGates = @(
  [ordered]@{ gate = "fresh-backup"; command = ".\scripts\windows\backup-postgres.ps1"; required = $true },
  [ordered]@{ gate = "restore-drill"; command = ".\scripts\windows\verify-postgres-backup.ps1 -DumpFile <dump>"; required = $true },
  [ordered]@{ gate = "fixed-publish-restart-p0"; command = ".\scripts\windows\complete-control-api-publish-restart-p0.ps1"; required = $true },
  [ordered]@{ gate = "frontend-hard-gate"; command = ".\scripts\windows\verify-frontend-legacy-dependencies.ps1 -FailOnLegacyWriteDependency"; required = $true },
  [ordered]@{ gate = "p2-audit"; command = ".\scripts\windows\verify-p2-cutover-audit.ps1 -LegacyWritesFrozen -FailOnFrontendLegacyWriteDependency"; required = $true },
  [ordered]@{ gate = "wallet-ledger-audit"; command = ".\scripts\windows\audit-wallet-ledger.ps1 -FailOnMismatch"; required = $true },
  [ordered]@{ gate = "projection-verifier"; command = ".\scripts\windows\verify-legacy-canonical-projection.ps1 -LegacyWritesFrozen"; required = $true },
  [ordered]@{ gate = "service-ops-drill"; command = ".\scripts\windows\verify-windows-service-ops-drill.ps1"; required = $true },
  [ordered]@{ gate = "operator-final-acceptance-evidence"; command = "README Operator-Supplied Final Acceptance Evidence module"; required = $true }
)

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
  phase = "S4-legacy-cleanup-dry-run"
  source_root = $RepoRoot
  env_file = $EnvFile
  core_api_root = $CoreApiRoot
  services_api_root = $ServicesApiRoot
  jaaz_root = $JaazRoot
  database_url = Redact-DatabaseUrl $DatabaseUrl
  assess_physical_source_removal_readiness = [bool]$AssessPhysicalSourceRemovalReadiness
  preserve_protected_local_material_in_place = [bool]$PreserveProtectedLocalMaterialInPlace
  assess_tracked_source_deletion_targets = [bool]$AssessTrackedSourceDeletionTargets
  legacy_surface_manifest_path = $LegacySurfaceManifestPath
  legacy_projection_manifest_path = $LegacyProjectionManifestPath
  retained_evidence_root = $RetainedEvidenceRoot
  policy = [ordered]@{
    physical_cleanup_executed = $false
    tracked_source_cleanup_executed = $false
    local_data_cleanup_executed = $false
    canonical_runtime = ".NET 8 Control API + Windows Service workers + PostgreSQL canonical"
    source_deletion_mode = "not authorized by default; explicit readiness mode may produce git-tracked-files-only candidates"
    cleanup_allowed_only_after = @("fresh backup", "restore drill", "fixed publish/restart/P0", "frontend hard gate", "P2 audit", "projection verifier", "wallet audit", "service ops drill", "README final acceptance evidence")
  }
  generated_sql = [ordered]@{
    quarantine_dry_run = $quarantineSqlPath
    cleanup_candidate = $cleanupSqlPath
    rollback_template = $rollbackSqlPath
  }
  cleanup_candidates = $cleanupCandidates
  retained_objects = $retainedObjects
  protected_local_material = $protectedLocalMaterial
  fixture_archive_plan = $fixtureArchivePlan
  tracked_source_deletion_plan = $trackedSourceDeletionPlan
  tracked_source_rollback_plan = $trackedSourceRollbackPlan
  database_inventory = $inventory
  execution_gates = $executionGates
  checks = $checks
  blockers = $blockers
  warnings = $warnings
  evidence_pending = $evidencePending
  review_items = $reviewItems
}

$report | ConvertTo-Json -Depth 14 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 14

if ($blockers.Count -gt 0) {
  throw "Legacy cleanup dry-run plan found $($blockers.Count) blocker(s). See $ReportPath"
}
