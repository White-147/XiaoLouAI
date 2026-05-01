param(
  [string]$InputFile = "",
  [string]$BaseUrl = "",
  [string]$Provider = "",
  [switch]$Execute,
  [switch]$SkipAudit,
  [switch]$StopOnFailure,
  [string]$ReportDir = ""
)

$ErrorActionPreference = "Stop"

if (-not $InputFile) {
  throw "Pass -InputFile with the real provider callback JSONL capture file."
}

if (-not (Test-Path -LiteralPath $InputFile)) {
  throw "Input file not found: $InputFile"
}

$repoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
if (-not $BaseUrl) {
  $BaseUrl = if ($env:CONTROL_API_BASE_URL) { $env:CONTROL_API_BASE_URL } else { "http://127.0.0.1:4100" }
}

if (-not $ReportDir) {
  $ReportDir = Join-Path $repoRoot ".runtime\xiaolou-logs"
}

New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$summaryPath = Join-Path $ReportDir "payment-provider-staging-replay-$stamp.json"
$dryRunReport = Join-Path $ReportDir "payment-provider-replay-dryrun-$stamp.json"
$firstReplayReport = Join-Path $ReportDir "payment-provider-replay-execute-1-$stamp.json"
$secondReplayReport = Join-Path $ReportDir "payment-provider-replay-execute-2-$stamp.json"

function Invoke-Step {
  param(
    [string]$Name,
    [scriptblock]$Action
  )

  Write-Host "==> $Name"
  & $Action
}

$steps = New-Object System.Collections.Generic.List[object]

if (-not $SkipAudit) {
  Invoke-Step "Running pre-replay wallet ledger audit" {
    & "$PSScriptRoot\audit-wallet-ledger.ps1" -FailOnMismatch | Tee-Object -Variable auditOutput | Out-Null
    $steps.Add([ordered]@{
      name = "pre_audit"
      status = "ok"
      output = ($auditOutput -join "`n")
    }) | Out-Null
  }
}

Invoke-Step "Dry-run parsing provider callback capture" {
  $replayParams = @{
    InputFile = $InputFile
    BaseUrl = $BaseUrl
    ReportPath = $dryRunReport
  }
  if ($Provider) { $replayParams.Provider = $Provider }
  & "$PSScriptRoot\replay-payment-callbacks.ps1" @replayParams | Out-Null
  $steps.Add([ordered]@{
    name = "dry_run"
    status = "ok"
    report = $dryRunReport
  }) | Out-Null
}

if ($Execute) {
  Invoke-Step "Executing first provider callback replay" {
    $replayParams = @{
      InputFile = $InputFile
      BaseUrl = $BaseUrl
      ReportPath = $firstReplayReport
      Execute = $true
    }
    if ($Provider) { $replayParams.Provider = $Provider }
    if ($StopOnFailure) { $replayParams.StopOnFailure = $true }
    & "$PSScriptRoot\replay-payment-callbacks.ps1" @replayParams | Out-Null
    $steps.Add([ordered]@{
      name = "execute_1"
      status = "ok"
      report = $firstReplayReport
    }) | Out-Null
  }

  Invoke-Step "Executing second provider callback replay for idempotency" {
    $replayParams = @{
      InputFile = $InputFile
      BaseUrl = $BaseUrl
      ReportPath = $secondReplayReport
      Execute = $true
    }
    if ($Provider) { $replayParams.Provider = $Provider }
    if ($StopOnFailure) { $replayParams.StopOnFailure = $true }
    & "$PSScriptRoot\replay-payment-callbacks.ps1" @replayParams | Out-Null
    $steps.Add([ordered]@{
      name = "execute_2_idempotency"
      status = "ok"
      report = $secondReplayReport
    }) | Out-Null
  }

  if (-not $SkipAudit) {
    Invoke-Step "Running post-replay wallet ledger audit" {
      & "$PSScriptRoot\audit-wallet-ledger.ps1" -FailOnMismatch | Tee-Object -Variable auditOutput | Out-Null
      $steps.Add([ordered]@{
        name = "post_audit"
        status = "ok"
        output = ($auditOutput -join "`n")
      }) | Out-Null
    }

    Invoke-Step "Running wallet balance rebuild dry-run" {
      & "$PSScriptRoot\rebuild-wallet-balances-from-ledger.ps1" | Tee-Object -Variable rebuildOutput | Out-Null
      $steps.Add([ordered]@{
        name = "rebuild_dry_run"
        status = "ok"
        output = ($rebuildOutput -join "`n")
      }) | Out-Null
    }
  }
}

$summary = [ordered]@{
  generated_at_utc = [DateTimeOffset]::UtcNow.ToString("O")
  base_url = $BaseUrl
  input_file = (Resolve-Path -LiteralPath $InputFile).Path
  provider_override = $Provider
  execute = [bool]$Execute
  skip_audit = [bool]$SkipAudit
  steps = $steps
}

$summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
$summary | ConvertTo-Json -Depth 8
