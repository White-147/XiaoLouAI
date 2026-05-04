param(
  [string]$RepoRoot = "",
  [string]$EnvFile = "$PSScriptRoot\.env.windows",
  [string]$CoreApiRoot = "",
  [string]$ServicesApiRoot = "",
  [string]$NodeExe = "",
  [string]$BaseUrl = "",
  [string]$P0AccountOwnerId = "",
  [string]$ReportPath = "",
  [int]$CoreApiPort = 4135,
  [int]$P0TimeoutSeconds = 1200,
  [int]$OpsDrillTimeoutSeconds = 180,
  [switch]$PublishFrontend,
  [switch]$SkipPublishRestartP0,
  [switch]$SkipFrontendHardGate,
  [switch]$SkipP2Audit,
  [switch]$SkipWalletAudit,
  [switch]$SkipProjectionVerifier,
  [switch]$SkipServiceOpsDrill,
  [switch]$SkipFinalLegacySurface,
  [switch]$SkipCleanupDryRun
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

if (-not (Test-Path -LiteralPath $EnvFile)) {
  $runtimeEnvFile = Join-Path $RepoRoot ".runtime\app\scripts\windows\.env.windows"
  if (Test-Path -LiteralPath $runtimeEnvFile) {
    $EnvFile = $runtimeEnvFile
  }
}

. "$PSScriptRoot\load-env.ps1" -EnvFile $EnvFile

if (-not $BaseUrl) {
  $BaseUrl = if ($env:CONTROL_API_BASE_URL) { $env:CONTROL_API_BASE_URL } else { "http://127.0.0.1:4100" }
}

if (-not $NodeExe) {
  $NodeExe = [Environment]::GetEnvironmentVariable("NODE_EXE", "Process")
}
if (-not $NodeExe) {
  $NodeExe = "D:\soft\program\nodejs\node.exe"
}

if (-not $ReportPath) {
  $logDir = [Environment]::GetEnvironmentVariable("LOG_DIR", "Process")
  if (-not $logDir) {
    $logDir = Join-Path $RepoRoot ".runtime\xiaolou-logs"
  }
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $ReportPath = Join-Path $logDir ("release-candidate-s5-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")
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

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-ReportSummary {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return [ordered]@{
      missing = $true
      status = "missing"
      blockers = 1
      warnings = 0
      evidence_pending = 0
      review_items = 0
    }
  }

  try {
    $json = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    $blockerCount = 0
    $warningCount = 0
    $evidencePendingCount = 0
    $reviewItemCount = 0

    foreach ($propertyName in @("blockers", "findings")) {
      $property = $json.PSObject.Properties[$propertyName]
      if (-not $property -or $null -eq $property.Value) {
        continue
      }

      if ($propertyName -eq "findings") {
        $blockerCount += @($property.Value | Where-Object { $_.severity -match "^(blocker|error|failed)$" }).Count
        $warningCount += @($property.Value | Where-Object { $_.severity -eq "warning" }).Count
      } else {
        $blockerCount += @($property.Value).Count
      }
    }

    $warningsProperty = $json.PSObject.Properties["warnings"]
    if ($warningsProperty -and $null -ne $warningsProperty.Value) {
      $warningCount += @($warningsProperty.Value).Count
    }

    $evidencePendingProperty = $json.PSObject.Properties["evidence_pending"]
    if ($evidencePendingProperty -and $null -ne $evidencePendingProperty.Value) {
      $evidencePendingCount += @($evidencePendingProperty.Value).Count
    }

    $reviewItemsProperty = $json.PSObject.Properties["review_items"]
    if ($reviewItemsProperty -and $null -ne $reviewItemsProperty.Value) {
      $reviewItemCount += @($reviewItemsProperty.Value).Count
    }

    return [ordered]@{
      status = $json.status
      ok = $json.ok
      blockers = $blockerCount
      warnings = $warningCount
      evidence_pending = $evidencePendingCount
      review_items = $reviewItemCount
    }
  } catch {
    return [ordered]@{
      parse_error = $_.Exception.Message
      status = "parse-error"
      blockers = 1
      warnings = 0
      evidence_pending = 0
      review_items = 0
    }
  }
}

function Invoke-RcStep {
  param(
    [string]$Name,
    [scriptblock]$Script
  )

  $started = [DateTimeOffset]::Now.ToString("O")
  try {
    $data = & $Script
    $ended = [DateTimeOffset]::Now.ToString("O")
    $step = [ordered]@{
      name = $Name
      status = "ok"
      started_at = $started
      ended_at = $ended
      data = $data
    }
    $script:steps.Add($step) | Out-Null
    return $step
  } catch {
    $ended = [DateTimeOffset]::Now.ToString("O")
    $step = [ordered]@{
      name = $Name
      status = "failed"
      started_at = $started
      ended_at = $ended
      error = $_.Exception.Message
    }
    $script:steps.Add($step) | Out-Null
    Add-Item $script:blockers $Name "failed" $_.Exception.Message
    return $step
  }
}

function Invoke-ReportScript {
  param(
    [string]$Name,
    [string]$ReportPath,
    [scriptblock]$Script
  )

  $result = & $Script
  $summary = Get-ReportSummary $ReportPath
  if ([int]$summary.blockers -gt 0) {
    Add-Item $script:blockers $Name "blocked" "$Name report contains $($summary.blockers) blocker(s)." ([ordered]@{ report = $ReportPath; summary = $summary })
  }
  if ([int]$summary.warnings -gt 0) {
    Add-Item $script:warnings $Name "warning" "$Name report contains $($summary.warnings) warning(s)." ([ordered]@{ report = $ReportPath; summary = $summary })
  }

  return [ordered]@{
    report = $ReportPath
    summary = $summary
    output = $result
  }
}

function Add-SkippedRequiredGate {
  param([string]$Name)

  Add-Item $script:warnings $Name "skipped" "$Name was skipped, so this is not a complete Release Candidate run."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$reportDir = Split-Path -Parent $ReportPath
$steps = New-List
$blockers = New-List
$warnings = New-List
$evidencePending = New-List
$reviewItems = New-List
$administrator = Test-IsAdministrator

if ($SkipFinalLegacySurface) {
  Add-SkippedRequiredGate "final-legacy-surface"
} else {
  Invoke-RcStep "final-legacy-surface" {
    $finalSurfaceReport = Join-Path $reportDir "release-candidate-final-legacy-surface-$stamp.json"
    Invoke-ReportScript "final-legacy-surface" $finalSurfaceReport {
      & "$PSScriptRoot\verify-final-legacy-surface.ps1" `
        -RepoRoot $RepoRoot `
        -CoreApiRoot $CoreApiRoot `
        -ServicesApiRoot $ServicesApiRoot `
        -ReportPath $finalSurfaceReport | Out-Null
    }
  } | Out-Null
}

if ($SkipPublishRestartP0) {
  Add-SkippedRequiredGate "fixed-publish-restart-p0"
} else {
  Invoke-RcStep "fixed-publish-restart-p0" {
    $publishReport = Join-Path $reportDir "release-candidate-publish-restart-p0-$stamp.json"
    $args = @{
      SourceRoot = $RepoRoot
      BaseUrl = $BaseUrl
      ReportPath = $publishReport
      P0TimeoutSeconds = $P0TimeoutSeconds
      OpsDrillTimeoutSeconds = $OpsDrillTimeoutSeconds
    }
    if ($P0AccountOwnerId) {
      $args.P0AccountOwnerId = $P0AccountOwnerId
    }
    if ($PublishFrontend) {
      $args.PublishFrontend = $true
    }
    & "$PSScriptRoot\complete-control-api-publish-restart-p0.ps1" @args | Out-Null
    $summary = Get-ReportSummary $publishReport
    if ([string]$summary.status -ne "ok") {
      Add-Item $script:blockers "fixed-publish-restart-p0" "blocked" "Publish/restart/P0 did not report ok." ([ordered]@{ report = $publishReport; summary = $summary })
    }
    return [ordered]@{ report = $publishReport; summary = $summary; publish_frontend = [bool]$PublishFrontend }
  } | Out-Null
}

if ($SkipFrontendHardGate) {
  Add-SkippedRequiredGate "frontend-hard-gate"
} else {
  Invoke-RcStep "frontend-hard-gate" {
    $frontendReport = Join-Path $reportDir "release-candidate-frontend-legacy-dependencies-$stamp.json"
    Invoke-ReportScript "frontend-hard-gate" $frontendReport {
      & "$PSScriptRoot\verify-frontend-legacy-dependencies.ps1" `
        -RepoRoot $RepoRoot `
        -ReportPath $frontendReport `
        -FailOnLegacyWriteDependency | Out-Null
    }
  } | Out-Null
}

if ($SkipP2Audit) {
  Add-SkippedRequiredGate "p2-audit"
} else {
  Invoke-RcStep "p2-audit" {
    $p2Report = Join-Path $reportDir "release-candidate-p2-cutover-audit-$stamp.json"
    Invoke-ReportScript "p2-audit" $p2Report {
      & "$PSScriptRoot\verify-p2-cutover-audit.ps1" `
        -RepoRoot $RepoRoot `
        -EnvFile $EnvFile `
        -CoreApiRoot $CoreApiRoot `
        -NodeExe $NodeExe `
        -ReportPath $p2Report `
        -CoreApiPort $CoreApiPort `
        -LegacyWritesFrozen `
        -FailOnFrontendLegacyWriteDependency | Out-Null
    }
  } | Out-Null
}

if ($SkipWalletAudit) {
  Add-SkippedRequiredGate "wallet-ledger-audit"
} else {
  Invoke-RcStep "wallet-ledger-audit" {
    $walletReport = Join-Path $reportDir "release-candidate-wallet-ledger-$stamp.json"
    & "$PSScriptRoot\audit-wallet-ledger.ps1" -OutputPath $walletReport -FailOnMismatch | Out-Null
    return [ordered]@{ report = $walletReport; summary = Get-ReportSummary $walletReport }
  } | Out-Null
}

if ($SkipProjectionVerifier) {
  Add-SkippedRequiredGate "projection-verifier"
} else {
  Invoke-RcStep "projection-verifier" {
    $projectionReport = Join-Path $reportDir "release-candidate-legacy-canonical-projection-$stamp.json"
    Invoke-ReportScript "projection-verifier" $projectionReport {
      & "$PSScriptRoot\verify-legacy-canonical-projection.ps1" `
        -RepoRoot $RepoRoot `
        -EnvFile $EnvFile `
        -CoreApiRoot $CoreApiRoot `
        -NodeExe $NodeExe `
        -ReportPath $projectionReport `
        -AllowMissingLegacy `
        -LegacyWritesFrozen | Out-Null
    }
  } | Out-Null
}

if ($SkipServiceOpsDrill) {
  Add-SkippedRequiredGate "service-ops-drill"
} else {
  Invoke-RcStep "service-ops-drill" {
    $opsReport = Join-Path $reportDir "release-candidate-service-ops-drill-$stamp.json"
    Invoke-ReportScript "service-ops-drill" $opsReport {
      & "$PSScriptRoot\verify-windows-service-ops-drill.ps1" `
        -SourceRoot $RepoRoot `
        -BaseUrl $BaseUrl `
        -ReportPath $opsReport | Out-Null
    }
  } | Out-Null
}

if ($SkipCleanupDryRun) {
  Add-SkippedRequiredGate "cleanup-dry-run"
} else {
  Invoke-RcStep "cleanup-dry-run" {
    $cleanupReport = Join-Path $reportDir "release-candidate-legacy-cleanup-dry-run-$stamp.json"
    Invoke-ReportScript "cleanup-dry-run" $cleanupReport {
      & "$PSScriptRoot\verify-legacy-cleanup-dry-run.ps1" `
        -RepoRoot $RepoRoot `
        -EnvFile $EnvFile `
        -ReportPath $cleanupReport | Out-Null
    }
  } | Out-Null
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
  phase = "S5-release-candidate"
  source_root = $RepoRoot
  core_api_root = $CoreApiRoot
  services_api_root = $ServicesApiRoot
  env_file = $EnvFile
  base_url = $BaseUrl
  administrator = $administrator
  publish_frontend = [bool]$PublishFrontend
  physical_cleanup_executed = $false
  skips = [ordered]@{
    publish_restart_p0 = [bool]$SkipPublishRestartP0
    frontend_hard_gate = [bool]$SkipFrontendHardGate
    p2_audit = [bool]$SkipP2Audit
    wallet_audit = [bool]$SkipWalletAudit
    projection_verifier = [bool]$SkipProjectionVerifier
    service_ops_drill = [bool]$SkipServiceOpsDrill
    final_legacy_surface = [bool]$SkipFinalLegacySurface
    cleanup_dry_run = [bool]$SkipCleanupDryRun
  }
  required_gates = @(
    "final-legacy-surface",
    "fixed-publish-restart-p0",
    "frontend-hard-gate",
    "p2-audit",
    "wallet-ledger-audit",
    "projection-verifier",
    "service-ops-drill",
    "cleanup-dry-run"
  )
  blockers = $blockers
  warnings = $warnings
  evidence_pending = $evidencePending
  review_items = $reviewItems
  steps = $steps
}

$report | ConvertTo-Json -Depth 14 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 14

if ($blockers.Count -gt 0) {
  throw "Release Candidate verification found $($blockers.Count) blocker(s). See $ReportPath"
}
