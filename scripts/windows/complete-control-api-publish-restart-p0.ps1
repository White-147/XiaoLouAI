param(
  [string]$SourceRoot = "",
  [string]$Root = "",
  [string]$DotnetExe = "",
  [string]$NpmCmd = "",
  [string]$PythonExe = "",
  [string]$BaseUrl = "",
  [string]$P0AccountOwnerId = "",
  [string]$ReportPath = "",
  [int]$P0TimeoutSeconds = 1200,
  [int]$OpsDrillTimeoutSeconds = 180,
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

function Write-Stage {
  param([string]$Message)
  Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message)
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

  Write-Stage "$Name [$Status] $Detail"
}

function Write-NewLogLines {
  param(
    [string]$Path,
    [ref]$LineCount,
    [string]$Prefix = ""
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  $lines = @(Get-Content -LiteralPath $Path -Encoding UTF8 -ErrorAction SilentlyContinue)
  for ($index = $LineCount.Value; $index -lt $lines.Count; $index += 1) {
    if ($Prefix) {
      Write-Host "$Prefix$($lines[$index])"
    } else {
      Write-Host $lines[$index]
    }
  }

  $LineCount.Value = $lines.Count
}

function Invoke-ProcessWithLiveOutput {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [string]$StdoutPath,
    [string]$StderrPath,
    [int]$TimeoutSeconds,
    [string]$Label,
    [string]$WorkingDirectory = ""
  )

  Remove-Item -LiteralPath $StdoutPath, $StderrPath -Force -ErrorAction SilentlyContinue
  Write-Stage "$Label started; timeout=${TimeoutSeconds}s"
  Write-Stage "$Label stdout: $StdoutPath"
  Write-Stage "$Label stderr: $StderrPath"

  $startArgs = @{
    FilePath = $FilePath
    ArgumentList = $ArgumentList
    RedirectStandardOutput = $StdoutPath
    RedirectStandardError = $StderrPath
    WindowStyle = "Hidden"
    PassThru = $true
  }
  if ($WorkingDirectory) {
    $startArgs.WorkingDirectory = $WorkingDirectory
  }

  $process = Start-Process @startArgs
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $stdoutLines = 0
  $stderrLines = 0

  while (-not $process.HasExited) {
    Write-NewLogLines -Path $StdoutPath -LineCount ([ref]$stdoutLines)
    Write-NewLogLines -Path $StderrPath -LineCount ([ref]$stderrLines) -Prefix "$Label stderr: "
    if ((Get-Date) -ge $deadline) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      Write-NewLogLines -Path $StdoutPath -LineCount ([ref]$stdoutLines)
      Write-NewLogLines -Path $StderrPath -LineCount ([ref]$stderrLines) -Prefix "$Label stderr: "
      throw "$Label timed out after $TimeoutSeconds seconds. Stdout: $StdoutPath; stderr: $StderrPath"
    }

    Start-Sleep -Milliseconds 500
    $process.Refresh()
  }

  $process.WaitForExit()
  $process.Refresh()
  Write-NewLogLines -Path $StdoutPath -LineCount ([ref]$stdoutLines)
  Write-NewLogLines -Path $StderrPath -LineCount ([ref]$stderrLines) -Prefix "$Label stderr: "

  $stdoutText = if (Test-Path -LiteralPath $StdoutPath) {
    (Get-Content -LiteralPath $StdoutPath -Raw -Encoding UTF8)
  } else {
    ""
  }
  $stderrText = if (Test-Path -LiteralPath $StderrPath) {
    (Get-Content -LiteralPath $StderrPath -Raw -Encoding UTF8)
  } else {
    ""
  }
  $exitCode = $process.ExitCode
  if ($null -eq $exitCode) {
    if (-not [string]::IsNullOrWhiteSpace($stderrText)) {
      throw "$Label exited with unknown code and stderr output. Stdout: $StdoutPath; stderr: $StderrPath"
    }

    Write-Stage "$Label exit code was not reported by Start-Process; treating empty stderr as success. Stdout: $StdoutPath"
  } elseif ($exitCode -ne 0) {
    throw "$Label exited with code $exitCode. Stdout: $StdoutPath; stderr: $StderrPath"
  }

  return $stdoutText.Trim()
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

function Sync-MachineEnvironmentFromEnvFile {
  param([string]$EnvFile)

  if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "Runtime environment file is missing: $EnvFile"
  }

  $count = 0
  foreach ($line in Get-Content -LiteralPath $EnvFile) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }

    $parts = $trimmed.Split("=", 2)
    if ($parts.Count -ne 2) {
      continue
    }

    $name = $parts[0].Trim()
    if (-not $name) {
      continue
    }

    [Environment]::SetEnvironmentVariable($name, $parts[1].Trim(), "Machine")
    $count += 1
  }

  return $count
}

function Invoke-DotnetBuildServerShutdown {
  param([int]$TimeoutSeconds = 30)

  if (-not $DotnetExe) {
    return
  }

  $process = $null
  try {
    $process = Start-Process -FilePath $DotnetExe -ArgumentList @("build-server", "shutdown") -WindowStyle Hidden -PassThru
    Wait-Process -Id $process.Id -Timeout $TimeoutSeconds -ErrorAction SilentlyContinue
    $process.Refresh()
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      Add-Step $steps "dotnet-build-server-shutdown" "warning" "Timed out after $TimeoutSeconds seconds; process was stopped."
      return
    }

    if ($process.ExitCode -eq 0) {
      Add-Step $steps "dotnet-build-server-shutdown" "ok" $DotnetExe
    } else {
      Add-Step $steps "dotnet-build-server-shutdown" "warning" "dotnet build-server shutdown exited with code $($process.ExitCode)"
    }
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
      Write-Stage "Stopping service $name"
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
    SuppressRegistrationHint = $true
  }
  if ($DotnetExe) { $publishArgs.DotnetExe = $DotnetExe }
  if ($NpmCmd) { $publishArgs.NpmCmd = $NpmCmd }
  if ($PythonExe) { $publishArgs.PythonExe = $PythonExe }
  Write-Stage "Publishing runtime to $Root"
  & "$SourceRoot\scripts\windows\publish-runtime-to-d.ps1" @publishArgs
  Add-Step $steps "publish-runtime" "ok" $Root

  $envFile = Join-Path $Root "scripts\windows\.env.windows"
  Write-Stage "Syncing Machine environment from $envFile"
  $syncedEnvCount = Sync-MachineEnvironmentFromEnvFile $envFile
  Add-Step $steps "sync-machine-env" "ok" "$syncedEnvCount values from $envFile"

  Write-Stage "Starting service XiaoLou-ControlApi"
  Start-Service -Name XiaoLou-ControlApi
  Wait-ServiceStatus -Name XiaoLou-ControlApi -Status "Running" -TimeoutSeconds 60
  Add-Step $steps "start-control-api" "ok" "XiaoLou-ControlApi"

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
  $reportStem = [IO.Path]::GetFileNameWithoutExtension($ReportPath)
  $reportDir = Split-Path -Parent $ReportPath
  $p0StdoutPath = Join-Path $reportDir "$reportStem.p0.out.txt"
  $p0StderrPath = Join-Path $reportDir "$reportStem.p0.err.txt"
  $p0ArgumentList = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    (Join-Path $SourceRoot "scripts\windows\verify-control-plane-p0.ps1"),
    "-BaseUrl",
    $BaseUrl,
    "-RepoRoot",
    $SourceRoot
  )
  if ($DotnetExe) { $p0ArgumentList += @("-DotnetExe", $DotnetExe) }
  if ($PythonExe) { $p0ArgumentList += @("-PythonExe", $PythonExe) }
  if ($P0AccountOwnerId) { $p0ArgumentList += @("-AccountOwnerId", $P0AccountOwnerId) }

  $p0OutputText = Invoke-ProcessWithLiveOutput `
    -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -ArgumentList $p0ArgumentList `
    -StdoutPath $p0StdoutPath `
    -StderrPath $p0StderrPath `
    -TimeoutSeconds $P0TimeoutSeconds `
    -Label "P0"
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
      Write-Stage "Starting service $name"
      Start-Service -Name $name
      Wait-ServiceStatus -Name $name -Status "Running" -TimeoutSeconds 60
      Add-Step $steps "start-service" "ok" $name
    }
  }

  $opsStdoutPath = Join-Path $reportDir "$reportStem.ops.out.txt"
  $opsStderrPath = Join-Path $reportDir "$reportStem.ops.err.txt"
  Invoke-ProcessWithLiveOutput `
    -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -ArgumentList @(
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      (Join-Path $Root "scripts\windows\verify-windows-service-ops-drill.ps1")
    ) `
    -StdoutPath $opsStdoutPath `
    -StderrPath $opsStderrPath `
    -TimeoutSeconds $OpsDrillTimeoutSeconds `
    -Label "service-ops-drill" `
    -WorkingDirectory $Root | Out-Null
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
          Write-Stage "Starting service $name after failure"
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
  p0_timeout_seconds = $P0TimeoutSeconds
  ops_drill_timeout_seconds = $OpsDrillTimeoutSeconds
  p0_stdout_log = $p0StdoutPath
  p0_stderr_log = $p0StderrPath
  ops_stdout_log = $opsStdoutPath
  ops_stderr_log = $opsStderrPath
  steps = $steps
}

$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 8

if ($failure) {
  throw $failure
}
