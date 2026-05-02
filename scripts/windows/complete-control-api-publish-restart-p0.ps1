param(
  [string]$SourceRoot = "",
  [string]$Root = "",
  [string]$DotnetExe = "",
  [string]$NpmCmd = "",
  [string]$PythonExe = "",
  [string]$BaseUrl = "",
  [string]$P0AccountOwnerId = "",
  [string]$ReportPath = "",
  [switch]$PublishFrontend,
  [switch]$SkipWorkersAfterP0
)

$ErrorActionPreference = "Stop"

if (-not $SourceRoot) {
  $SourceRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
}

if (-not $Root) {
  $Root = Join-Path $SourceRoot ".runtime\app"
}

if (-not $BaseUrl) {
  $BaseUrl = if ($env:CONTROL_API_BASE_URL) { $env:CONTROL_API_BASE_URL } else { "http://127.0.0.1:4100" }
}

if (-not $ReportPath) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $ReportPath = Join-Path $SourceRoot ".runtime\xiaolou-logs\control-api-publish-restart-p0-$stamp.json"
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Add-Step {
  param(
    [System.Collections.Generic.List[object]]$Steps,
    [string]$Name,
    [string]$Status,
    [string]$Detail
  )

  $Steps.Add([ordered]@{
    name = $Name
    status = $Status
    detail = $Detail
  }) | Out-Null
}

function Wait-ServiceStatus {
  param(
    [string]$Name,
    [string]$Status,
    [int]$TimeoutSeconds = 60
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($service -and [string]$service.Status -eq $Status) {
      return
    }

    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  $current = Get-Service -Name $Name -ErrorAction SilentlyContinue
  throw "Service $Name did not reach $Status within $TimeoutSeconds seconds. Current status: $($current.Status)"
}

function Get-EnvFileValue {
  param(
    [string]$EnvFile,
    [string]$Name
  )

  if (-not (Test-Path -LiteralPath $EnvFile)) {
    return $null
  }

  foreach ($line in Get-Content -LiteralPath $EnvFile) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }

    $parts = $trimmed.Split("=", 2)
    if ($parts.Count -eq 2 -and $parts[0].Trim() -eq $Name) {
      return $parts[1].Trim()
    }
  }

  return $null
}

function Get-FirstOwnerGrant {
  param([string]$OwnerGrants)

  if (-not $OwnerGrants) {
    return $null
  }

  foreach ($entry in ($OwnerGrants -split "[,;]")) {
    $trimmed = $entry.Trim()
    if (-not $trimmed -or $trimmed -match "\*$") {
      continue
    }

    $parts = $trimmed.Split(":", 2)
    if ($parts.Count -eq 2 -and $parts[1].Trim()) {
      return $parts[1].Trim()
    }

    return $trimmed
  }

  return $null
}

function Invoke-DotnetBuildServerShutdown {
  if (-not $DotnetExe) {
    return
  }

  try {
    & $DotnetExe build-server shutdown | Out-Null
    Add-Step $steps "dotnet-build-server-shutdown" "ok" $DotnetExe
  } catch {
    Add-Step $steps "dotnet-build-server-shutdown" "warning" $_.Exception.Message
  }
}

function Convert-P0Output {
  param([string]$Text)

  if (-not $Text) {
    return $null
  }

  try {
    return $Text | ConvertFrom-Json
  } catch {
  }

  $start = $Text.LastIndexOf("`n{")
  if ($start -ge 0) {
    $candidate = $Text.Substring($start + 1).Trim()
  } else {
    $start = $Text.LastIndexOf("{")
    if ($start -lt 0) {
      return $null
    }
    $candidate = $Text.Substring($start).Trim()
  }

  try {
    return $candidate | ConvertFrom-Json
  } catch {
    return $null
  }
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null
$steps = New-Object System.Collections.Generic.List[object]
$failure = $null
$p0Result = $null
$p0RunId = ""

if (-not (Test-IsAdministrator)) {
  throw "This script must be run from an elevated Administrator PowerShell so it can stop/restart XiaoLou-ControlApi and replace the locked published DLL."
}

try {
  foreach ($name in @("XiaoLou-ClosedApiWorker", "XiaoLou-LocalModelWorker", "XiaoLou-ControlApi")) {
    $service = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($service -and $service.Status -ne "Stopped") {
      Stop-Service -Name $name -Force
      Wait-ServiceStatus -Name $name -Status "Stopped" -TimeoutSeconds 60
      Add-Step $steps "stop-service" "ok" $name
    } elseif ($service) {
      Add-Step $steps "stop-service" "already-stopped" $name
    } else {
      Add-Step $steps "stop-service" "missing" $name
    }
  }

  $publishArgs = @{
    SourceRoot = $SourceRoot
    RuntimeRoot = $Root
    SkipFrontend = -not [bool]$PublishFrontend
  }
  if ($DotnetExe) { $publishArgs.DotnetExe = $DotnetExe }
  if ($NpmCmd) { $publishArgs.NpmCmd = $NpmCmd }
  if ($PythonExe) { $publishArgs.PythonExe = $PythonExe }
  & "$SourceRoot\scripts\windows\publish-runtime-to-d.ps1" @publishArgs
  Add-Step $steps "publish-runtime" "ok" $Root

  Start-Service -Name XiaoLou-ControlApi
  Wait-ServiceStatus -Name XiaoLou-ControlApi -Status "Running" -TimeoutSeconds 60
  Add-Step $steps "start-control-api" "ok" "XiaoLou-ControlApi"

  $envFile = Join-Path $Root "scripts\windows\.env.windows"
  if (-not $P0AccountOwnerId) {
    $P0AccountOwnerId = Get-FirstOwnerGrant (Get-EnvFileValue $envFile "PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS")
  }
  if (-not $P0AccountOwnerId) {
    $P0AccountOwnerId = Get-FirstOwnerGrant (Get-EnvFileValue $envFile "CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS")
  }

  $p0Args = @{
    BaseUrl = $BaseUrl
    RepoRoot = $SourceRoot
  }
  if ($DotnetExe) { $p0Args.DotnetExe = $DotnetExe }
  if ($PythonExe) { $p0Args.PythonExe = $PythonExe }
  if ($P0AccountOwnerId) { $p0Args.AccountOwnerId = $P0AccountOwnerId }
  $p0Output = & "$SourceRoot\scripts\windows\verify-control-plane-p0.ps1" @p0Args
  $p0OutputText = ($p0Output | Out-String).Trim()
  if ($p0OutputText) {
    $p0Result = Convert-P0Output $p0OutputText
    if ($p0Result) {
      $p0RunId = [string]$p0Result.runId
    } else {
      Add-Step $steps "p0-output" "unparsed" $p0OutputText
    }
  }
  Add-Step $steps "p0-canary" "ok" "BaseUrl=$BaseUrl; AccountOwnerId=$P0AccountOwnerId"

  if (-not $SkipWorkersAfterP0) {
    foreach ($name in @("XiaoLou-LocalModelWorker", "XiaoLou-ClosedApiWorker")) {
      Start-Service -Name $name
      Wait-ServiceStatus -Name $name -Status "Running" -TimeoutSeconds 60
      Add-Step $steps "start-service" "ok" $name
    }
  }

  & "$Root\scripts\windows\verify-windows-service-ops-drill.ps1" | Out-Null
  Add-Step $steps "service-ops-drill" "ok" "read-only"
  Invoke-DotnetBuildServerShutdown
} catch {
  $failure = $_
  Add-Step $steps "failure" "failed" $failure.Exception.Message
  if (-not $SkipWorkersAfterP0) {
    foreach ($name in @("XiaoLou-LocalModelWorker", "XiaoLou-ClosedApiWorker")) {
      try {
        $service = Get-Service -Name $name -ErrorAction SilentlyContinue
        if ($service -and $service.Status -ne "Running") {
          Start-Service -Name $name
          Wait-ServiceStatus -Name $name -Status "Running" -TimeoutSeconds 60
          Add-Step $steps "start-service-after-failure" "ok" $name
        }
      } catch {
        Add-Step $steps "start-service-after-failure" "failed" "${name}: $($_.Exception.Message)"
      }
    }
  }
  Invoke-DotnetBuildServerShutdown
}

$report = [ordered]@{
  generated_at_utc = [DateTimeOffset]::UtcNow.ToString("O")
  status = if ($failure) { "failed" } else { "ok" }
  source_root = $SourceRoot
  runtime_root = $Root
  base_url = $BaseUrl
  p0_account_owner_id = $P0AccountOwnerId
  p0_run_id = $p0RunId
  p0_result = $p0Result
  publish_frontend = [bool]$PublishFrontend
  steps = $steps
}

$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 8

if ($failure) {
  throw $failure
}
