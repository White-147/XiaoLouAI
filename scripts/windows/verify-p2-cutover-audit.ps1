param(
  [string]$RepoRoot = "",
  [string]$EnvFile = "$PSScriptRoot\.env.windows",
  [string]$NodeExe = "",
  [string]$DatabaseUrl = "",
  [string]$ReportPath = "",
  [int]$CoreApiPort = 4125,
  [switch]$StrictLegacySource,
  [switch]$LegacyWritesFrozen,
  [switch]$SkipProjectionFixture,
  [switch]$SkipCoreApiReadonly,
  [switch]$SkipWalletAudit,
  [switch]$SkipFrontendDependencyAudit,
  [switch]$FailOnFrontendLegacyWriteDependency
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
  $runtimeEnvFile = Join-Path $RepoRoot ".runtime\app\scripts\windows\.env.windows"
  if (Test-Path -LiteralPath $runtimeEnvFile) {
    $EnvFile = $runtimeEnvFile
  }
}

if (-not $ReportPath) {
  $logDir = [Environment]::GetEnvironmentVariable("LOG_DIR", "Process")
  if (-not $logDir) {
    $logDir = Join-Path $RepoRoot ".runtime\xiaolou-logs"
  }
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $ReportPath = Join-Path $logDir "p2-cutover-audit-$stamp.json"
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null

. "$PSScriptRoot\load-env.ps1" -EnvFile $EnvFile

function New-List {
  return New-Object System.Collections.Generic.List[object]
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

function Get-ReportSummary {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  try {
    $json = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    $blockerCount = 0
    $warningCount = 0
    if ($null -ne $json.blockers) {
      $blockerCount += @($json.blockers).Count
    }
    if ($null -ne $json.warnings) {
      $warningCount += @($json.warnings).Count
    }
    if ($null -ne $json.findings) {
      $blockerCount += @($json.findings | Where-Object { $_.severity -match "^(blocker|error|failed)$" }).Count
      $warningCount += @($json.findings | Where-Object { $_.severity -eq "warning" }).Count
    }
    return [ordered]@{
      status = $json.status
      ok = $json.ok
      blockers = $blockerCount
      warnings = $warningCount
    }
  } catch {
    return [ordered]@{
      parse_error = $_.Exception.Message
    }
  }
}

function Invoke-AuditStep {
  param(
    [string]$Name,
    [scriptblock]$Script
  )

  $started = [DateTimeOffset]::Now
  try {
    $data = & $Script
    $script:steps.Add([ordered]@{
      name = $Name
      status = "ok"
      started_at = $started.ToString("O")
      ended_at = [DateTimeOffset]::Now.ToString("O")
      data = $data
    }) | Out-Null
  } catch {
    $script:steps.Add([ordered]@{
      name = $Name
      status = "failed"
      started_at = $started.ToString("O")
      ended_at = [DateTimeOffset]::Now.ToString("O")
      error = $_.Exception.Message
    }) | Out-Null
    $script:blockers.Add([ordered]@{
      name = $Name
      status = "failed"
      detail = $_.Exception.Message
    }) | Out-Null
  }
}

$NodeExe = Resolve-DTool $NodeExe "NODE_EXE" "D:\soft\program\nodejs\node.exe" "Node.js"
$logDir = Split-Path -Parent $ReportPath
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$steps = New-List
$warnings = New-List
$blockers = New-List
$databaseUrlSupplied = -not [string]::IsNullOrWhiteSpace($DatabaseUrl)

if (-not $DatabaseUrl) {
  $DatabaseUrl = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
}

if (-not $SkipProjectionFixture) {
  Invoke-AuditStep "projection-fixture-gate" {
    $fixtureText = (& "$PSScriptRoot\verify-legacy-canonical-projection-gate.ps1" `
      -RepoRoot $RepoRoot `
      -EnvFile $EnvFile `
      -NodeExe $NodeExe `
      -ReportDir $logDir | Out-String).Trim()
    return [ordered]@{
      output = $fixtureText
    }
  }
}

Invoke-AuditStep "projection-verifier" {
  $verifyReport = Join-Path $logDir "p2-cutover-audit-legacy-verify-$stamp.json"
  $args = @{
    RepoRoot = $RepoRoot
    EnvFile = $EnvFile
    NodeExe = $NodeExe
    ReportPath = $verifyReport
  }
  if ($databaseUrlSupplied) {
    $args.DatabaseUrl = $DatabaseUrl
  } elseif (-not $StrictLegacySource) {
    $args.AllowMissingLegacy = $true
  }
  if ($LegacyWritesFrozen) {
    $args.LegacyWritesFrozen = $true
  }
  if (-not $StrictLegacySource -and -not $databaseUrlSupplied) {
    $args.AllowMissingLegacy = $true
  }

  & "$PSScriptRoot\verify-legacy-canonical-projection.ps1" @args | Out-Null
  return [ordered]@{
    report = $verifyReport
    summary = Get-ReportSummary $verifyReport
    strictLegacySource = [bool]$StrictLegacySource
    legacyWritesFrozen = [bool]$LegacyWritesFrozen
  }
}

if (-not $SkipWalletAudit) {
  Invoke-AuditStep "wallet-ledger-audit" {
    $walletReport = Join-Path $logDir "p2-cutover-audit-wallet-ledger-$stamp.json"
    if ($DatabaseUrl) {
      [Environment]::SetEnvironmentVariable("DATABASE_URL", $DatabaseUrl, "Process")
    }
    & "$PSScriptRoot\audit-wallet-ledger.ps1" -OutputPath $walletReport -FailOnMismatch | Out-Null
    return [ordered]@{
      report = $walletReport
      summary = Get-ReportSummary $walletReport
    }
  }
}

if (-not $SkipCoreApiReadonly) {
  Invoke-AuditStep "core-api-compat-readonly" {
    $coreApiReport = Join-Path $logDir "p2-cutover-audit-core-api-readonly-$stamp.json"
    & "$PSScriptRoot\verify-core-api-compat-readonly.ps1" `
      -RepoRoot $RepoRoot `
      -EnvFile $EnvFile `
      -NodeExe $NodeExe `
      -Port $CoreApiPort | Out-File -LiteralPath $coreApiReport -Encoding UTF8
    $json = Get-Content -LiteralPath $coreApiReport -Raw | ConvertFrom-Json
    return [ordered]@{
      report = $coreApiReport
      ok = $json.ok
      discoveredMutatingRoutes = $json.checks.mutatingWriteRouteDiscovery.discoveredCount
      checkedMutatingRoutes = $json.checks.mutatingWriteRouteDiscovery.checkedCount
      stdoutLog = $json.stdoutLog
      stderrLog = $json.stderrLog
    }
  }
}

if (-not $SkipFrontendDependencyAudit) {
  Invoke-AuditStep "frontend-reverse-proxy-legacy-dependencies" {
    $frontendReport = Join-Path $logDir "p2-cutover-audit-frontend-legacy-dependencies-$stamp.json"
    $args = @{
      RepoRoot = $RepoRoot
      ReportPath = $frontendReport
    }
    if ($FailOnFrontendLegacyWriteDependency) {
      $args.FailOnLegacyWriteDependency = $true
    }
    & "$PSScriptRoot\verify-frontend-legacy-dependencies.ps1" @args | Out-Null
    return [ordered]@{
      report = $frontendReport
      summary = Get-ReportSummary $frontendReport
    }
  }
}

foreach ($step in $steps) {
  if ($step.status -ne "ok") {
    continue
  }
  $summary = $step.data.summary
  if ($summary -and $summary.warnings -gt 0) {
    $warnings.Add([ordered]@{
      name = $step.name
      status = "warning"
      detail = "$($summary.warnings) warning(s) in nested report"
      report = $step.data.report
    }) | Out-Null
  }
}

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
  source_root = $RepoRoot
  env_file = $EnvFile
  database_url_supplied = $databaseUrlSupplied
  strict_legacy_source = [bool]$StrictLegacySource
  legacy_writes_frozen = [bool]$LegacyWritesFrozen
  blockers = $blockers
  warnings = $warnings
  steps = $steps
}

$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 12

if ($blockers.Count -gt 0) {
  throw "P2 cutover audit found $($blockers.Count) blocker(s). See $ReportPath"
}
