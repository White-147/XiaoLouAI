param(
  [string]$SourceRoot = "",
  [string]$Root = "",
  [string]$BaseUrl = "",
  [string]$ReportPath = "",
  [int]$EventLogMinutes = 10,
  [switch]$Strict,
  [switch]$ExecuteRestart,
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
  $ReportPath = Join-Path $SourceRoot ".runtime\xiaolou-logs\windows-service-ops-drill-$stamp.json"
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

  if ($Strict -or $AlwaysBlock) {
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

function Get-ServiceCim {
  param([string]$Name)

  $escaped = $Name.Replace("'", "''")
  return Get-CimInstance Win32_Service -Filter "Name='$escaped'" -ErrorAction SilentlyContinue
}

function Get-ServiceScSnapshot {
  param([string]$Name)

  $configText = (& sc.exe qc $Name 2>&1 | Out-String)
  $pathName = ""
  $startMode = ""

  if ($configText -match "(?m)^\s*BINARY_PATH_NAME\s*:\s*(.+?)\s*$") {
    $pathName = $Matches[1].Trim()
  }
  if ($configText -match "(?m)^\s*START_TYPE\s*:\s*\d+\s+([A-Z_]+)\s*$") {
    $startType = $Matches[1].Trim()
    $startMode = switch ($startType) {
      "AUTO_START" { "Auto" }
      "DEMAND_START" { "Manual" }
      "DISABLED" { "Disabled" }
      default { $startType }
    }
  }

  return [ordered]@{
    path_name = $pathName
    start_mode = $startMode
    raw_config = $configText.Trim()
  }
}

function Get-ServiceFailureActions {
  param([string]$Name)

  try {
    $output = (& sc.exe qfailure $Name 2>&1 | Out-String).Trim()
    $hasRestartAction = $output -match "(?is)RESTART|FAILURE_ACTIONS\s*.*--"
    return [ordered]@{
      raw = $output
      restart_configured = [bool]$hasRestartAction
    }
  } catch {
    return [ordered]@{
      raw = $_.Exception.Message
      restart_configured = $false
    }
  }
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
  Add-Item $script:checks "p0-after-service-drill" "ok" "verify-control-plane-p0.ps1 completed"
}

$script:checks = New-List
$script:warnings = New-List
$script:blockers = New-List
$serviceReports = New-List
$plannedCommands = New-List
$restartSteps = New-List
$isAdmin = Test-IsAdministrator

$services = @(
  [ordered]@{
    name = "XiaoLou-ControlApi"
    expected_dll = Join-Path $Root "publish\control-api\XiaoLou.ControlApi.dll"
    expected_dependency = ""
  },
  [ordered]@{
    name = "XiaoLou-LocalModelWorker"
    expected_dll = Join-Path $Root "publish\local-model-worker-service\XiaoLou.LocalModelWorkerService.dll"
    expected_dependency = "XiaoLou-ControlApi"
  },
  [ordered]@{
    name = "XiaoLou-ClosedApiWorker"
    expected_dll = Join-Path $Root "publish\closed-api-worker\XiaoLou.ClosedApiWorker.dll"
    expected_dependency = "XiaoLou-ControlApi"
  }
)

Add-Item $checks "administrator" ($(if ($isAdmin) { "ok" } else { "not-admin" })) "Current PowerShell administrator=$isAdmin"

foreach ($definition in $services) {
  $name = [string]$definition.name
  $expectedDll = [System.IO.Path]::GetFullPath([string]$definition.expected_dll)
  $cim = Get-ServiceCim -Name $name
  $scSnapshot = $null
  if (-not $cim) {
    try {
      $service = Get-Service -Name $name -ErrorAction Stop
      $scSnapshot = Get-ServiceScSnapshot -Name $name
      Add-Problem "service-cim-access-limited" "$name Win32_Service metadata is unavailable from this PowerShell session; using Get-Service/sc.exe fallback. Re-run elevated for full binPath/start-mode evidence."
    } catch {
      Add-Problem "service-missing" "$name is not registered"
      continue
    }
  } else {
    $service = Get-Service -Name $name -ErrorAction Stop
  }

  $dependencies = @($service.ServicesDependedOn | ForEach-Object { $_.Name })
  $failureActions = Get-ServiceFailureActions -Name $name
  $pathName = if ($cim) { [string]$cim.PathName } else { [string]$scSnapshot.path_name }
  $startMode = if ($cim) { [string]$cim.StartMode } else { [string]$scSnapshot.start_mode }
  $state = if ($cim) { [string]$cim.State } else { [string]$service.Status }
  $processId = if ($cim) { [int]$cim.ProcessId } else { 0 }
  $report = [ordered]@{
    name = $name
    state = $state
    start_mode = $startMode
    process_id = $processId
    path_name = $pathName
    expected_dll = $expectedDll
    dependencies = $dependencies
    failure_actions = $failureActions
    metadata_source = $(if ($cim) { "cim" } else { "get-service-sc" })
  }
  $serviceReports.Add($report) | Out-Null

  if ($startMode -ne "Auto") {
    Add-Problem "service-start-mode" "$name StartMode is $startMode, expected Auto"
  } else {
    Add-Item $checks "service-start-mode" "ok" "$name is Automatic"
  }

  if ($state -ne "Running") {
    Add-Problem "service-running" "$name state is $state, expected Running"
  } else {
    Add-Item $checks "service-running" "ok" "$name is Running"
  }

  if (-not $pathName) {
    Add-Problem "service-binpath-unavailable" "$name binPath could not be read from this PowerShell session"
  } elseif ($pathName -match "powershell(\.exe)?|pwsh(\.exe)?") {
    Add-Problem "service-binpath-wrapper" "$name still points at a PowerShell wrapper: $pathName" -AlwaysBlock
  } elseif ($pathName.IndexOf("dotnet.exe", [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    Add-Problem "service-binpath-dotnet" "$name binPath does not invoke dotnet.exe: $pathName"
  } else {
    Add-Item $checks "service-binpath-dotnet" "ok" "$name invokes dotnet.exe"
  }

  if ($pathName -and $pathName.IndexOf($expectedDll, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    Add-Problem "service-binpath-dll" "$name binPath does not point at expected published DLL: $expectedDll"
  } elseif ($pathName) {
    Add-Item $checks "service-binpath-dll" "ok" "$name points at $expectedDll"
  }

  if ($pathName -and ($pathName -match "^[`"']?C:\\" -or $pathName -match "\s[`"']?C:\\")) {
    Add-Problem "service-binpath-drive" "$name binPath contains a C: runtime path: $pathName" -AlwaysBlock
  } elseif ($pathName -and $pathName.IndexOf("D:\", [StringComparison]::OrdinalIgnoreCase) -ge 0) {
    Add-Item $checks "service-binpath-drive" "ok" "$name uses D: runtime paths"
  }

  if (-not (Test-Path -LiteralPath $expectedDll)) {
    Add-Problem "service-dll-present" "$name expected DLL is missing: $expectedDll"
  } else {
    Add-Item $checks "service-dll-present" "ok" $expectedDll
  }

  if (-not $failureActions.restart_configured) {
    Add-Problem "service-failure-action" "$name does not show restart failure action in sc.exe qfailure output"
  } else {
    Add-Item $checks "service-failure-action" "ok" "$name has restart failure action"
  }

  $expectedDependency = [string]$definition.expected_dependency
  if ($expectedDependency) {
    if ($dependencies -contains $expectedDependency) {
      Add-Item $checks "service-dependency" "ok" "$name depends on $expectedDependency"
    } else {
      Add-Problem "service-dependency" "$name does not depend on $expectedDependency"
    }
  }
}

$plannedCommands.Add("D:\code\XiaoLouAI\scripts\windows\rehearse-production-cutover.ps1 -StrictProduction") | Out-Null
$plannedCommands.Add("D:\code\XiaoLouAI\scripts\windows\verify-windows-service-ops-drill.ps1") | Out-Null
$plannedCommands.Add("D:\code\XiaoLouAI\scripts\windows\verify-windows-service-ops-drill.ps1 -ExecuteRestart -RunP0") | Out-Null
$plannedCommands.Add("D:\code\XiaoLouAI\scripts\windows\restore-runtime-snapshot.ps1") | Out-Null
$plannedCommands.Add("D:\code\XiaoLouAI\scripts\windows\restore-runtime-snapshot.ps1 -Execute -RunP0") | Out-Null
$plannedCommands.Add("D:\code\XiaoLouAI\.runtime\app\scripts\windows\stop-services.ps1") | Out-Null
$plannedCommands.Add("D:\code\XiaoLouAI\.runtime\app\scripts\windows\start-services.ps1") | Out-Null

Invoke-HealthCheck

if ($EventLogMinutes -gt 0) {
  try {
    $since = (Get-Date).AddMinutes(-1 * $EventLogMinutes)
    $events = @(Get-WinEvent -FilterHashtable @{
      LogName = @("Application", "System")
      Level = @(2, 3)
      StartTime = $since
    } -ErrorAction SilentlyContinue | Where-Object {
      $_.ProviderName -match "XiaoLou|\.NET Runtime|Application Error|Service Control Manager" `
        -or $_.Message -match "XiaoLou|XiaoLou\.Control|ClosedApiWorker|LocalModelWorker"
    } | Select-Object -First 20 ProviderName, Id, LevelDisplayName, TimeCreated, Message)

    if ($events.Count -gt 0) {
      Add-Problem "event-log-recent-warning-error" "Found $($events.Count) recent XiaoLou/.NET/SCM warning or error event(s)" 
      Add-Item $checks "event-log-sample" "captured" "Recent warning/error events are included in report" $events
    } else {
      Add-Item $checks "event-log-recent-warning-error" "ok" "No matching warning/error events in the last $EventLogMinutes minute(s)"
    }
  } catch {
    Add-Problem "event-log-read" "Could not read Windows Event Log: $($_.Exception.Message)"
  }
}

if ($ExecuteRestart) {
  if (-not $isAdmin) {
    Add-Problem "execute-restart-admin" "Executing a Windows Service restart drill requires an elevated PowerShell session." -AlwaysBlock
  } elseif ($blockers.Count -eq 0) {
    try {
      Add-Item $restartSteps "stop-worker" "running" "Stopping XiaoLou-ClosedApiWorker"
      Stop-ServiceIfRunning "XiaoLou-ClosedApiWorker"
      Add-Item $restartSteps "stop-worker" "ok" "XiaoLou-ClosedApiWorker stopped"

      Add-Item $restartSteps "stop-worker" "running" "Stopping XiaoLou-LocalModelWorker"
      Stop-ServiceIfRunning "XiaoLou-LocalModelWorker"
      Add-Item $restartSteps "stop-worker" "ok" "XiaoLou-LocalModelWorker stopped"

      Add-Item $restartSteps "restart-control-api" "running" "Restarting XiaoLou-ControlApi"
      Stop-ServiceIfRunning "XiaoLou-ControlApi"
      Start-ServiceIfNeeded "XiaoLou-ControlApi"
      Add-Item $restartSteps "restart-control-api" "ok" "XiaoLou-ControlApi restarted"

      Invoke-HealthCheck

      Add-Item $restartSteps "start-worker" "running" "Starting XiaoLou-LocalModelWorker"
      Start-ServiceIfNeeded "XiaoLou-LocalModelWorker"
      Add-Item $restartSteps "start-worker" "ok" "XiaoLou-LocalModelWorker running"

      Add-Item $restartSteps "start-worker" "running" "Starting XiaoLou-ClosedApiWorker"
      Start-ServiceIfNeeded "XiaoLou-ClosedApiWorker"
      Add-Item $restartSteps "start-worker" "ok" "XiaoLou-ClosedApiWorker running"

      Add-Item $checks "execute-restart" "ok" "Safe service restart order completed"
    } catch {
      Add-Problem "execute-restart" "Restart drill failed: $($_.Exception.Message)" -AlwaysBlock
      foreach ($name in @("XiaoLou-ControlApi", "XiaoLou-LocalModelWorker", "XiaoLou-ClosedApiWorker")) {
        try {
          Start-ServiceIfNeeded $name
          Add-Item $restartSteps "rollback-start" "ok" "$name running"
        } catch {
          Add-Item $restartSteps "rollback-start" "failed" "$name could not be started: $($_.Exception.Message)"
        }
      }
    }
  }
}

if ($RunP0 -and $blockers.Count -eq 0) {
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
  base_url = $BaseUrl
  strict = [bool]$Strict
  execute_restart = [bool]$ExecuteRestart
  run_p0 = [bool]$RunP0
  administrator = $isAdmin
  service_reports = $serviceReports
  restart_steps = $restartSteps
  blockers = $blockers
  warnings = $warnings
  checks = $checks
  planned_commands = $plannedCommands
}

$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 10

if ($blockers.Count -gt 0) {
  throw "Windows service ops drill found $($blockers.Count) blocker(s). See $ReportPath"
}

if ($FailOnWarning -and $warnings.Count -gt 0) {
  throw "Windows service ops drill found $($warnings.Count) warning(s). See $ReportPath"
}
