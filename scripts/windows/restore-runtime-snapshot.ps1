param(
  [string]$SourceRoot = "",
  [string]$Root = "",
  [string]$SnapshotPath = "",
  [string]$BaseUrl = "",
  [string]$ReportPath = "",
  [switch]$Execute,
  [switch]$RunP0,
  [string]$P0AccountOwnerId = "",
  [switch]$FailOnWarning
)

$ErrorActionPreference = "Stop"

if (-not $SourceRoot) {
  $SourceRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
}

if (-not $Root) {
  $candidateRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
  $candidateParent = Split-Path -Parent $candidateRoot
  if ((Split-Path -Leaf $candidateRoot) -eq "app" -and (Split-Path -Leaf $candidateParent) -eq ".runtime") {
    $Root = $candidateRoot
  } else {
    $Root = Join-Path $candidateRoot ".runtime\app"
  }
}

if (-not $BaseUrl) {
  $BaseUrl = if ($env:CONTROL_API_BASE_URL) { $env:CONTROL_API_BASE_URL } else { "http://127.0.0.1:4100" }
}

if (-not $ReportPath) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $ReportPath = Join-Path $SourceRoot ".runtime\xiaolou-logs\runtime-rollback-drill-$stamp.json"
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

function Add-Problem {
  param(
    [string]$Name,
    [string]$Detail,
    [switch]$AlwaysBlock
  )

  if ($Execute -or $AlwaysBlock) {
    Add-Item $script:blockers $Name "failed" $Detail
  } else {
    Add-Item $script:warnings $Name "warning" $Detail
  }
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Wait-ServiceStatus {
  param(
    [string]$Name,
    [string]$ExpectedStatus,
    [int]$TimeoutSeconds = 60
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $service = Get-Service -Name $Name -ErrorAction Stop
    if ([string]$service.Status -eq $ExpectedStatus) {
      return $service
    }

    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  $latest = Get-Service -Name $Name -ErrorAction Stop
  throw "$Name did not reach $ExpectedStatus within $TimeoutSeconds seconds. Current status: $($latest.Status)"
}

function Stop-ServiceIfRunning {
  param([string]$Name)

  $service = Get-Service -Name $Name -ErrorAction Stop
  if ($service.Status -ne "Stopped") {
    Stop-Service -Name $Name -ErrorAction Stop
    Wait-ServiceStatus -Name $Name -ExpectedStatus "Stopped" | Out-Null
  }
}

function Start-ServiceIfNeeded {
  param([string]$Name)

  $service = Get-Service -Name $Name -ErrorAction Stop
  if ($service.Status -ne "Running") {
    Start-Service -Name $Name -ErrorAction Stop
  }

  Wait-ServiceStatus -Name $Name -ExpectedStatus "Running" | Out-Null
}

function Assert-PathUnderRoot {
  param(
    [string]$Path,
    [string]$RootPath
  )

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $fullRoot = [System.IO.Path]::GetFullPath($RootPath).TrimEnd("\")
  if ($fullPath -ne $fullRoot -and -not $fullPath.StartsWith($fullRoot + "\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing path outside runtime root. Path=$fullPath Root=$fullRoot"
  }

  return $fullPath
}

function Remove-TargetDirectory {
  param([string]$Target)

  if (-not (Test-Path -LiteralPath $Target)) {
    return
  }

  $fullTarget = Assert-PathUnderRoot -Path $Target -RootPath $Root
  Remove-Item -LiteralPath $fullTarget -Recurse -Force
}

function Copy-SnapshotDirectory {
  param(
    [string]$RelativePath,
    [switch]$PreserveRuntimeEnv
  )

  $source = Join-Path $SnapshotPath $RelativePath
  if (-not (Test-Path -LiteralPath $source)) {
    Add-Item $script:restoreSteps "restore-skip" "skipped" "$RelativePath is not present in snapshot"
    return
  }

  $target = Join-Path $Root $RelativePath
  $targetParent = Split-Path -Parent $target
  $runtimeEnvText = $null
  $runtimeEnvPath = Join-Path $target ".env.windows"

  if ($PreserveRuntimeEnv -and (Test-Path -LiteralPath $runtimeEnvPath)) {
    $runtimeEnvText = Get-Content -LiteralPath $runtimeEnvPath -Raw
  }

  Remove-TargetDirectory -Target $target
  New-Item -ItemType Directory -Force -Path $targetParent | Out-Null
  Copy-Item -LiteralPath $source -Destination $targetParent -Recurse -Force

  if ($PreserveRuntimeEnv -and $null -ne $runtimeEnvText) {
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Set-Content -LiteralPath $runtimeEnvPath -Value $runtimeEnvText -Encoding UTF8
  }

  Add-Item $script:restoreSteps "restore-path" "ok" "$RelativePath restored"
}

function Invoke-HealthCheck {
  try {
    $health = Invoke-RestMethod -Method Get -Uri ($BaseUrl.TrimEnd("/") + "/healthz") -TimeoutSec 10
    if ($health.status -eq "ok") {
      Add-Item $script:checks "control-api-health" "ok" $BaseUrl
    } else {
      Add-Problem "control-api-health" "Unexpected health response from ${BaseUrl}: $($health | ConvertTo-Json -Compress -Depth 5)"
    }
  } catch {
    Add-Problem "control-api-health" "Health check failed at ${BaseUrl}: $($_.Exception.Message)"
  }
}

function Invoke-P0 {
  $p0 = Join-Path $SourceRoot "scripts\windows\verify-control-plane-p0.ps1"
  if (-not (Test-Path -LiteralPath $p0)) {
    Add-Problem "p0-script" "Missing P0 verifier: $p0" -AlwaysBlock
    return
  }

  $args = @{
    RepoRoot = $SourceRoot
    BaseUrl = $BaseUrl
  }
  if ($P0AccountOwnerId) {
    $args.AccountOwnerId = $P0AccountOwnerId
  }

  & $p0 @args | Out-Null
  Add-Item $script:checks "p0-after-rollback" "ok" "verify-control-plane-p0.ps1 completed"
}

$script:checks = New-List
$script:warnings = New-List
$script:blockers = New-List
$script:restoreSteps = New-List
$planned = New-List
$isAdmin = Test-IsAdministrator

$Root = [System.IO.Path]::GetFullPath($Root)
if (-not $Root.StartsWith("D:\", [StringComparison]::OrdinalIgnoreCase)) {
  Add-Problem "runtime-root-drive" "Runtime root must be on D:. Current: $Root" -AlwaysBlock
} else {
  Add-Item $checks "runtime-root-drive" "ok" $Root
}

if (-not $SnapshotPath) {
  $defaultSnapshotRoot = Join-Path (Split-Path -Parent $Root) "xiaolou-backups\runtime-snapshots"
  $latest = Get-ChildItem -LiteralPath $defaultSnapshotRoot -Directory -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($latest) {
    $SnapshotPath = $latest.FullName
  }
}

if (-not $SnapshotPath) {
  Add-Problem "snapshot" "No rollback snapshot was provided and no runtime snapshot exists under .runtime\xiaolou-backups\runtime-snapshots." -AlwaysBlock
} else {
  $SnapshotPath = [System.IO.Path]::GetFullPath($SnapshotPath)
  if (Test-Path -LiteralPath $SnapshotPath) {
    Add-Item $checks "snapshot-present" "ok" $SnapshotPath
  } else {
    Add-Problem "snapshot-present" "Snapshot path does not exist: $SnapshotPath" -AlwaysBlock
  }
}

$restoreItems = @(
  "publish\control-api",
  "publish\closed-api-worker",
  "publish\local-model-worker-service",
  "XIAOLOU-main\dist",
  "scripts\windows",
  "deploy",
  "services\local-model-worker"
)

if ($SnapshotPath -and (Test-Path -LiteralPath $SnapshotPath)) {
  $manifestPath = Join-Path $SnapshotPath "snapshot-manifest.json"
  if (Test-Path -LiteralPath $manifestPath) {
    Add-Item $checks "snapshot-manifest" "ok" $manifestPath
  } else {
    Add-Problem "snapshot-manifest" "Snapshot manifest is missing: $manifestPath" -AlwaysBlock
  }

  $secretLeak = Get-ChildItem -LiteralPath $SnapshotPath -Force -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq ".env.windows" } |
    Select-Object -First 1
  if ($secretLeak) {
    Add-Problem "snapshot-secret-exclusion" "Snapshot contains runtime env file: $($secretLeak.FullName)" -AlwaysBlock
  } else {
    Add-Item $checks "snapshot-secret-exclusion" "ok" "No .env.windows file found inside snapshot"
  }

  foreach ($relativePath in $restoreItems) {
    $source = Join-Path $SnapshotPath $relativePath
    $target = Join-Path $Root $relativePath
    $plannedData = [ordered]@{
      source = $source
      target = $target
    }
    if (Test-Path -LiteralPath $source) {
      Add-Item $planned "restore-path" "planned" $relativePath $plannedData
    } elseif ($relativePath -match "^publish\\") {
      Add-Problem "snapshot-required-path" "Required published artifact path is missing from snapshot: $relativePath" -AlwaysBlock
    } else {
      Add-Item $warnings "snapshot-optional-path" "warning" "Optional runtime path is missing from snapshot: $relativePath"
    }
  }

  foreach ($dll in @(
    "publish\control-api\XiaoLou.ControlApi.dll",
    "publish\closed-api-worker\XiaoLou.ClosedApiWorker.dll",
    "publish\local-model-worker-service\XiaoLou.LocalModelWorkerService.dll"
  )) {
    $path = Join-Path $SnapshotPath $dll
    if (Test-Path -LiteralPath $path) {
      Add-Item $checks "snapshot-dll" "ok" $dll
    } else {
      Add-Problem "snapshot-dll" "Required rollback DLL is missing: $dll" -AlwaysBlock
    }
  }
}

Add-Item $checks "administrator" ($(if ($isAdmin) { "ok" } else { "not-admin" })) "Current PowerShell administrator=$isAdmin"

if ($Execute -and -not $isAdmin) {
  Add-Problem "execute-admin" "Executing a runtime rollback requires an elevated PowerShell session." -AlwaysBlock
}

if ($Execute -and $blockers.Count -eq 0) {
  try {
    Add-Item $restoreSteps "stop-worker" "running" "Stopping XiaoLou-ClosedApiWorker"
    Stop-ServiceIfRunning "XiaoLou-ClosedApiWorker"
    Add-Item $restoreSteps "stop-worker" "ok" "XiaoLou-ClosedApiWorker stopped"

    Add-Item $restoreSteps "stop-worker" "running" "Stopping XiaoLou-LocalModelWorker"
    Stop-ServiceIfRunning "XiaoLou-LocalModelWorker"
    Add-Item $restoreSteps "stop-worker" "ok" "XiaoLou-LocalModelWorker stopped"

    Add-Item $restoreSteps "stop-control-api" "running" "Stopping XiaoLou-ControlApi"
    Stop-ServiceIfRunning "XiaoLou-ControlApi"
    Add-Item $restoreSteps "stop-control-api" "ok" "XiaoLou-ControlApi stopped"

    foreach ($relativePath in $restoreItems) {
      Copy-SnapshotDirectory -RelativePath $relativePath -PreserveRuntimeEnv:($relativePath -eq "scripts\windows")
    }

    Add-Item $restoreSteps "start-control-api" "running" "Starting XiaoLou-ControlApi"
    Start-ServiceIfNeeded "XiaoLou-ControlApi"
    Add-Item $restoreSteps "start-control-api" "ok" "XiaoLou-ControlApi running"

    Invoke-HealthCheck

    Add-Item $restoreSteps "start-worker" "running" "Starting XiaoLou-LocalModelWorker"
    Start-ServiceIfNeeded "XiaoLou-LocalModelWorker"
    Add-Item $restoreSteps "start-worker" "ok" "XiaoLou-LocalModelWorker running"

    Add-Item $restoreSteps "start-worker" "running" "Starting XiaoLou-ClosedApiWorker"
    Start-ServiceIfNeeded "XiaoLou-ClosedApiWorker"
    Add-Item $restoreSteps "start-worker" "ok" "XiaoLou-ClosedApiWorker running"

    Add-Item $checks "execute-rollback" "ok" "Runtime snapshot restored"
  } catch {
    Add-Problem "execute-rollback" "Runtime rollback failed: $($_.Exception.Message)" -AlwaysBlock
    foreach ($name in @("XiaoLou-ControlApi", "XiaoLou-LocalModelWorker", "XiaoLou-ClosedApiWorker")) {
      try {
        Start-ServiceIfNeeded $name
        Add-Item $restoreSteps "recovery-start" "ok" "$name running"
      } catch {
        Add-Item $restoreSteps "recovery-start" "failed" "$name could not be started: $($_.Exception.Message)"
      }
    }
  }
} elseif (-not $Execute) {
  Add-Item $checks "rollback-mode" "planned" "Pass -Execute from an elevated PowerShell session to restore the snapshot."
}

if ($RunP0 -and -not $Execute) {
  Add-Item $warnings "p0-after-rollback" "warning" "Skipping -RunP0 because rollback is in read-only mode. Pass -Execute from an elevated PowerShell session to run P0 after restore."
} elseif ($RunP0 -and $blockers.Count -eq 0) {
  Invoke-P0
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
  source_root = $SourceRoot
  runtime_root = $Root
  snapshot_path = $SnapshotPath
  base_url = $BaseUrl
  execute = [bool]$Execute
  run_p0 = [bool]$RunP0
  administrator = $isAdmin
  blockers = $blockers
  warnings = $warnings
  checks = $checks
  planned_restore = $planned
  restore_steps = $restoreSteps
}

$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 10

if ($blockers.Count -gt 0) {
  throw "Runtime rollback drill found $($blockers.Count) blocker(s). See $ReportPath"
}

if ($FailOnWarning -and $warnings.Count -gt 0) {
  throw "Runtime rollback drill found $($warnings.Count) warning(s). See $ReportPath"
}
