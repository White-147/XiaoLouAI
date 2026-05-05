param(
  [string]$RepoRoot = "",
  [string]$EnvFile = "$PSScriptRoot\.env.windows",
  [string]$CoreApiRoot = "",
  [string]$NodeExe = "",
  [string]$DatabaseUrl = "",
  [string]$ReportPath = "",
  [string]$LegacyProjectionManifestPath = "",
  [string]$WriteLegacyProjectionManifestPath = "",
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

if ($LegacyProjectionManifestPath) {
  if (-not [System.IO.Path]::IsPathRooted($LegacyProjectionManifestPath)) {
    $LegacyProjectionManifestPath = Join-Path $RepoRoot $LegacyProjectionManifestPath
  }
  $LegacyProjectionManifestPath = [System.IO.Path]::GetFullPath($LegacyProjectionManifestPath)
}

if ($WriteLegacyProjectionManifestPath) {
  if (-not [System.IO.Path]::IsPathRooted($WriteLegacyProjectionManifestPath)) {
    $WriteLegacyProjectionManifestPath = Join-Path $RepoRoot $WriteLegacyProjectionManifestPath
  }
  $WriteLegacyProjectionManifestPath = [System.IO.Path]::GetFullPath($WriteLegacyProjectionManifestPath)
}

if ($LegacyProjectionManifestPath -and $WriteLegacyProjectionManifestPath) {
  throw "Use either -LegacyProjectionManifestPath or -WriteLegacyProjectionManifestPath, not both."
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
  $runtimeEnvFile = Join-Path $RepoRoot ".runtime\app\scripts\windows\.env.windows"
  if (Test-Path -LiteralPath $runtimeEnvFile) {
    $EnvFile = $runtimeEnvFile
  }
}

. "$PSScriptRoot\load-env.ps1" -EnvFile $EnvFile

if (-not $ReportPath) {
  $logDir = [Environment]::GetEnvironmentVariable("LOG_DIR", "Process")
  if (-not $logDir) {
    $logDir = Join-Path $RepoRoot ".runtime\xiaolou-logs"
  }
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $ReportPath = Join-Path $logDir "legacy-canonical-projection-$stamp.json"
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null

function New-List {
  return New-Object System.Collections.Generic.List[object]
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

function Get-FileEvidence {
  param([string]$Path)

  $exists = Test-Path -LiteralPath $Path
  $entry = [ordered]@{
    path = Get-DisplayPath $Path
    exists = [bool]$exists
  }
  if ($exists) {
    $item = Get-Item -LiteralPath $Path
    $entry["length"] = $item.Length
    $entry["sha256"] = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  return $entry
}

function Get-JsonArray {
  param([object]$Value)

  if ($null -eq $Value) {
    return @()
  }
  if ($Value -is [System.Array]) {
    return @($Value)
  }
  return @($Value)
}

function Write-ProjectionReport {
  param(
    [string]$Mode,
    [System.Collections.Generic.List[object]]$Checks,
    [System.Collections.Generic.List[object]]$Blockers,
    [System.Collections.Generic.List[object]]$Warnings,
    [System.Collections.Generic.List[object]]$EvidencePending,
    [object]$Extra = $null
  )

  $status = if ($Blockers.Count -gt 0) {
    "blocked"
  } elseif ($Warnings.Count -gt 0) {
    "warning"
  } else {
    "ok"
  }

  $report = [ordered]@{
    generated_at_utc = [DateTimeOffset]::UtcNow.ToString("O")
    status = $status
    mode = $Mode
    source_root = $RepoRoot
    core_api_root = $CoreApiRoot
    report_path = $ReportPath
    legacy_projection_manifest_path = $LegacyProjectionManifestPath
    write_legacy_projection_manifest_path = $WriteLegacyProjectionManifestPath
    checks = $Checks
    blockers = $Blockers
    warnings = $Warnings
    evidence_pending = $EvidencePending
  }
  if ($null -ne $Extra) {
    $report["data"] = $Extra
  }

  $report | ConvertTo-Json -Depth 14 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
  return $report
}

function Get-ProjectionManifest {
  param([string]$ManifestPath)

  $requiredFiles = @(
    (Join-Path $CoreApiRoot "package.json"),
    (Join-Path $CoreApiRoot "scripts\verify-legacy-canonical-projection.js"),
    (Join-Path $CoreApiRoot "scripts\project-legacy-to-canonical.js"),
    (Join-Path $CoreApiRoot "src\postgres-schema.js")
  )
  $fileEvidence = @($requiredFiles | ForEach-Object { Get-FileEvidence $_ })
  $packageText = if (Test-Path -LiteralPath (Join-Path $CoreApiRoot "package.json")) {
    Get-Content -LiteralPath (Join-Path $CoreApiRoot "package.json") -Raw
  } else {
    ""
  }
  $pgPackagePath = Join-Path $CoreApiRoot "node_modules\pg\package.json"
  $manifest = [ordered]@{
    schema = "xiaolou-legacy-canonical-projection-manifest-v1"
    generated_at_utc = [DateTimeOffset]::UtcNow.ToString("O")
    source_mode = "live-source-evidence"
    core_api_root = Get-DisplayPath $CoreApiRoot
    required_source_files = $fileEvidence
    dependency_evidence = [ordered]@{
      package_json_declares_pg = [bool]($packageText -match '"pg"\s*:')
      pg_package_present = [bool](Test-Path -LiteralPath $pgPackagePath)
      pg_package_path = Get-DisplayPath $pgPackagePath
      generated_dependency_material_may_be_absent = $true
    }
    boundary = [ordered]@{
      default_live_mode_remains_strict = $true
      manifest_mode_is_explicit = $true
      manifest_mode_does_not_seed_database_fixture = $true
      manifest_mode_does_not_execute_node_projection_verifier = $true
    }
  }

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ManifestPath) | Out-Null
  $manifest | ConvertTo-Json -Depth 14 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8
  return $manifest
}

$manifestSchema = "xiaolou-legacy-canonical-projection-manifest-v1"

if ($WriteLegacyProjectionManifestPath) {
  $checks = New-List
  $blockers = New-List
  $warnings = New-List
  $evidencePending = New-List
  $manifest = Get-ProjectionManifest $WriteLegacyProjectionManifestPath
  $missingFiles = @(Get-JsonArray $manifest.required_source_files | Where-Object { -not $_.exists })
  if ($missingFiles.Count -gt 0) {
    Add-Item $blockers "legacy-projection-manifest-source-files" "missing" "Projection manifest write requires current legacy projection source evidence." ([ordered]@{ missing = $missingFiles.path })
  } else {
    Add-Item $checks "legacy-projection-manifest-source-files" "ok" "Projection manifest captured current legacy projection source files."
  }
  if ($manifest.dependency_evidence.package_json_declares_pg) {
    Add-Item $checks "legacy-projection-manifest-pg-dependency" "ok" "Projection manifest records pg as a declared generated dependency."
  } else {
    Add-Item $blockers "legacy-projection-manifest-pg-dependency" "missing" "Projection manifest must prove package.json still declares pg for live projection runs."
  }
  if (-not $manifest.dependency_evidence.pg_package_present) {
    Add-Item $evidencePending "legacy-projection-generated-dependency" "manifest-only" "node_modules/pg is generated dependency material and may be absent after G11f cleanup; live DB projection verification still needs dependency restore."
  }
  Add-Item $checks "legacy-projection-manifest-write" "ok" "Wrote retained legacy projection manifest." ([ordered]@{ manifest = Get-DisplayPath $WriteLegacyProjectionManifestPath })
  $report = Write-ProjectionReport "manifest-write" $checks $blockers $warnings $evidencePending ([ordered]@{ manifest = $manifest })
  $report | ConvertTo-Json -Depth 14
  if ($blockers.Count -gt 0) {
    throw "Legacy projection manifest write failed with $($blockers.Count) blocker(s). Report: $ReportPath"
  }
  return
}

if ($LegacyProjectionManifestPath) {
  $checks = New-List
  $blockers = New-List
  $warnings = New-List
  $evidencePending = New-List
  $manifest = $null
  if (-not (Test-Path -LiteralPath $LegacyProjectionManifestPath)) {
    Add-Item $blockers "legacy-projection-manifest-load" "missing" "Legacy projection manifest is required when -LegacyProjectionManifestPath is used."
  } else {
    try {
      $manifest = Get-Content -LiteralPath $LegacyProjectionManifestPath -Raw | ConvertFrom-Json
      if ([string]$manifest.schema -eq $manifestSchema) {
        Add-Item $checks "legacy-projection-manifest-load" "ok" "Loaded retained legacy projection manifest." ([ordered]@{ manifest = Get-DisplayPath $LegacyProjectionManifestPath })
      } else {
        Add-Item $blockers "legacy-projection-manifest-schema" "failed" "Legacy projection manifest schema must be '$manifestSchema'." ([ordered]@{ actual = [string]$manifest.schema })
      }
    } catch {
      Add-Item $blockers "legacy-projection-manifest-load" "failed" "Legacy projection manifest is not valid JSON." ([ordered]@{ error = $_.Exception.Message })
    }
  }

  if ($manifest) {
    $requiredFiles = @(Get-JsonArray $manifest.required_source_files)
    $missingFiles = @($requiredFiles | Where-Object { -not $_.exists })
    if ($requiredFiles.Count -gt 0 -and $missingFiles.Count -eq 0) {
      Add-Item $checks "legacy-projection-source-evidence" "ok" "Manifest proves retained legacy projection source files existed when captured."
    } else {
      Add-Item $blockers "legacy-projection-source-evidence" "failed" "Manifest must include existing projection verifier, projector, postgres schema, and package.json evidence." ([ordered]@{ missing = $missingFiles.path })
    }
    if ($manifest.dependency_evidence -and [bool]$manifest.dependency_evidence.package_json_declares_pg) {
      Add-Item $checks "legacy-projection-pg-declaration" "ok" "Manifest records pg as a declared generated dependency."
    } else {
      Add-Item $blockers "legacy-projection-pg-declaration" "failed" "Manifest must prove pg remained declared for live projection runs."
    }
    if ($manifest.boundary -and [bool]$manifest.boundary.manifest_mode_is_explicit) {
      Add-Item $checks "legacy-projection-manifest-boundary" "ok" "Manifest records explicit non-live projection verifier boundary."
    } else {
      Add-Item $blockers "legacy-projection-manifest-boundary" "failed" "Manifest must record that non-live projection mode is explicit."
    }
    Add-Item $evidencePending "legacy-projection-live-execution" "manifest-only" "Manifest mode does not seed fixture data or execute the Node projection verifier; restore live dependencies and run default mode for live DB evidence."
  }

  $report = Write-ProjectionReport "manifest" $checks $blockers $warnings $evidencePending ([ordered]@{ manifest = $manifest })
  $report | ConvertTo-Json -Depth 14
  if ($blockers.Count -gt 0) {
    throw "Legacy projection manifest verification failed with $($blockers.Count) blocker(s). Report: $ReportPath"
  }
  return
}

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
