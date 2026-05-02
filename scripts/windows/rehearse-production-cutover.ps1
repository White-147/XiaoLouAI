param(
  [string]$Root = "",
  [string]$SourceRoot = "",
  [string]$DotnetExe = "",
  [string]$NpmCmd = "",
  [string]$PythonExe = "",
  [switch]$SkipFrontend,
  [switch]$SkipDotnetPublish,
  [switch]$ExecutePublish,
  [switch]$RegisterServices,
  [switch]$UpdateExisting,
  [switch]$StartServices,
  [switch]$RunP0,
  [string]$BaseUrl = "",
  [string]$ReportPath = ""
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
  $ReportPath = Join-Path $SourceRoot ".runtime\xiaolou-logs\p1-cutover-rehearsal-$stamp.json"
}

function Add-Item {
  param(
    [System.Collections.Generic.List[object]]$List,
    [string]$Name,
    [string]$Status,
    [string]$Detail
  )

  $List.Add([ordered]@{
    name = $Name
    status = $Status
    detail = $Detail
  }) | Out-Null
}

function Resolve-DTool {
  param(
    [string]$Provided,
    [string]$DefaultPath,
    [string]$Name
  )

  $value = if ($Provided) { $Provided } else { $DefaultPath }
  if (-not (Test-Path -LiteralPath $value)) {
    throw "$Name not found at $value"
  }

  $full = [System.IO.Path]::GetFullPath($value)
  if (-not $full.StartsWith("D:\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "$Name must use a D: project runtime path. Refusing $full"
  }

  return $full
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
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

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null

$checks = New-Object System.Collections.Generic.List[object]
$warnings = New-Object System.Collections.Generic.List[object]
$blockers = New-Object System.Collections.Generic.List[object]
$commands = New-Object System.Collections.Generic.List[object]

try {
  $DotnetExe = Resolve-DTool $DotnetExe "D:\soft\program\dotnet\dotnet.exe" ".NET runtime"
  Add-Item $checks "dotnet" "ok" $DotnetExe
} catch {
  Add-Item $blockers "dotnet" "failed" $_.Exception.Message
}

try {
  $NpmCmd = Resolve-DTool $NpmCmd "D:\soft\program\nodejs\npm.cmd" "Node/npm runtime"
  Add-Item $checks "npm" "ok" $NpmCmd
} catch {
  Add-Item $blockers "npm" "failed" $_.Exception.Message
}

try {
  $PythonExe = Resolve-DTool $PythonExe "D:\soft\program\Python\Python312\python.exe" "Python runtime"
  Add-Item $checks "python" "ok" $PythonExe
} catch {
  Add-Item $blockers "python" "failed" $_.Exception.Message
}

if ($RegisterServices -or $StartServices) {
  if (Test-IsAdministrator) {
    Add-Item $checks "service-admin" "ok" "Current PowerShell session is elevated."
  } else {
    Add-Item $blockers "service-admin" "failed" "Registering or starting Windows services requires an elevated PowerShell session."
  }
}

foreach ($path in @(
  "$SourceRoot\control-plane-dotnet\XiaoLou.ControlPlane.sln",
  "$SourceRoot\XIAOLOU-main\package.json",
  "$SourceRoot\scripts\windows\.env.windows.example",
  "$SourceRoot\deploy\windows\Caddyfile.windows.example",
  "$SourceRoot\deploy\windows\iis-web.config.example",
  "$SourceRoot\scripts\windows\verify-control-plane-p0.ps1",
  "$SourceRoot\scripts\windows\audit-wallet-ledger.ps1",
  "$SourceRoot\scripts\windows\rebuild-wallet-balances-from-ledger.ps1"
)) {
  if (Test-Path -LiteralPath $path) {
    Add-Item $checks "required-file" "ok" $path
  } else {
    Add-Item $blockers "required-file" "missing" $path
  }
}

$rootFull = [System.IO.Path]::GetFullPath($Root)
if ($rootFull.StartsWith("D:\", [StringComparison]::OrdinalIgnoreCase)) {
  Add-Item $checks "runtime-root" "ok" $rootFull
} else {
  Add-Item $blockers "runtime-root" "failed" "Runtime root must be on D:. Current: $rootFull"
}

$sourceEnv = "$SourceRoot\scripts\windows\.env.windows.example"
if (Test-Path -LiteralPath $sourceEnv) {
  & "$SourceRoot\scripts\windows\assert-d-drive-runtime.ps1" -EnvFile $sourceEnv | Out-Null
  Add-Item $checks "source-env-d-drive" "ok" $sourceEnv
}

$runtimeEnv = "$Root\scripts\windows\.env.windows"
if (Test-Path -LiteralPath $runtimeEnv) {
  & "$SourceRoot\scripts\windows\assert-d-drive-runtime.ps1" -EnvFile $runtimeEnv | Out-Null
  Add-Item $checks "runtime-env-d-drive" "ok" $runtimeEnv
  $runtimeEnvText = Get-Content -LiteralPath $runtimeEnv -Raw
  foreach ($name in @("DATABASE_URL", "PAYMENT_WEBHOOK_SECRET", "INTERNAL_API_TOKEN", "CLIENT_API_TOKEN", "OBJECT_STORAGE_PUBLIC_BASE_URL")) {
    if ($runtimeEnvText -match "(?m)^$name=(change-me|change-me-internal-token|change-me-client-token|https://object-storage\.example\.invalid|)$") {
      Add-Item $warnings "runtime-env-placeholder" "warning" "$name still looks like a placeholder in $runtimeEnv"
    }
  }
  if ((Get-EnvFileValue $runtimeEnv "CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT") -ne "true") {
    Add-Item $warnings "client-api-configured-grants" "warning" "Set CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT=true before production cutover, after CLIENT_API_ALLOWED_ACCOUNT_IDS or CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS are configured."
  }
  $clientApiPermissions = Get-EnvFileValue $runtimeEnv "CLIENT_API_ALLOWED_PERMISSIONS"
  if (-not $clientApiPermissions -or $clientApiPermissions -match "(^|[,;])\s*\*\s*($|[,;])") {
    Add-Item $warnings "client-api-permissions" "warning" "Set CLIENT_API_ALLOWED_PERMISSIONS to explicit public permissions before production cutover."
  }
  if ((Get-EnvFileValue $runtimeEnv "CORE_API_COMPAT_READ_ONLY") -ne "1") {
    Add-Item $warnings "core-api-read-only" "warning" "Set CORE_API_COMPAT_READ_ONLY=1 for any legacy core-api compatibility process."
  }
  if (-not (Get-EnvFileValue $runtimeEnv "CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST")) {
    Add-Item $warnings "core-api-route-allowlist" "warning" "Set CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST to keep legacy GET routes closed by default."
  }
} else {
  Add-Item $warnings "runtime-env" "missing" "$runtimeEnv will be created on publish"
}

$caddyText = Get-Content -LiteralPath "$SourceRoot\deploy\windows\Caddyfile.windows.example" -Raw
if ($caddyText -match "/api/internal/\*" -and $caddyText -match "/api/\* \{\s*respond 404") {
  Add-Item $checks "caddy-public-surface" "ok" "internal and catch-all API blocks are present"
} else {
  Add-Item $blockers "caddy-public-surface" "failed" "Caddy example must block /api/internal/* and deny unlisted /api/*"
}

$iisText = Get-Content -LiteralPath "$SourceRoot\deploy\windows\iis-web.config.example" -Raw
if ($iisText -match "Block XiaoLou Internal API" -and $iisText -match "Block Unlisted XiaoLou API") {
  Add-Item $checks "iis-public-surface" "ok" "internal and unlisted API block rules are present"
} else {
  Add-Item $blockers "iis-public-surface" "failed" "IIS example must block internal and unlisted API routes"
}

$serviceNames = @("XiaoLou-ControlApi", "XiaoLou-LocalModelWorker", "XiaoLou-ClosedApiWorker")
foreach ($name in $serviceNames) {
  $service = Get-Service -Name $name -ErrorAction SilentlyContinue
  if ($service) {
    Add-Item $checks "service" "present" "$name=$($service.Status)"
  } else {
    Add-Item $warnings "service" "missing" "$name is not registered yet"
  }
}

foreach ($port in @(3000, 5173)) {
  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($listener) {
    Add-Item $warnings "frontend-dev-port" "listening" "Port $port is listening; production must serve static dist instead"
  } else {
    Add-Item $checks "frontend-dev-port" "ok" "Port $port is not listening"
  }
}

$installCommand = @(
  "$SourceRoot\scripts\windows\install.ps1",
  "-Root $Root",
  "-DotnetExe $DotnetExe",
  "-NpmCmd $NpmCmd",
  "-PythonExe $PythonExe",
  "-AssertDDrive"
)
if ($SkipFrontend) { $installCommand += "-SkipFrontend" }
if ($SkipDotnetPublish) { $installCommand += "-SkipDotnetPublish" }
if ($RegisterServices) { $installCommand += "-RegisterServices" }
if ($UpdateExisting) { $installCommand += "-UpdateExisting" }
if ($StartServices) { $installCommand += "-StartServices" }
$commands.Add(($installCommand -join " ")) | Out-Null

if ($blockers.Count -eq 0 -and $ExecutePublish) {
  & "$SourceRoot\scripts\windows\install.ps1" `
    -Root $Root `
    -SourceRoot $SourceRoot `
    -DotnetExe $DotnetExe `
    -NpmCmd $NpmCmd `
    -PythonExe $PythonExe `
    -SkipFrontend:$SkipFrontend `
    -SkipDotnetPublish:$SkipDotnetPublish `
    -RegisterServices:$RegisterServices `
    -UpdateExisting:$UpdateExisting `
    -StartServices:$StartServices `
    -AssertDDrive
  Add-Item $checks "publish" "executed" $Root
} elseif (-not $ExecutePublish) {
  Add-Item $checks "publish" "planned" "Pass -ExecutePublish to run the install command"
}

if ($RunP0) {
  foreach ($name in @("INTERNAL_API_TOKEN", "CLIENT_API_TOKEN", "PAYMENT_WEBHOOK_SECRET")) {
    if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
      $value = Get-EnvFileValue $runtimeEnv $name
      if ($value) {
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
      }
    }
  }

  if (-not $env:INTERNAL_API_TOKEN) {
    Add-Item $blockers "p0" "missing-env" "INTERNAL_API_TOKEN must be set before running P0 against a protected control plane"
  } else {
    $env:CONTROL_API_BASE_URL = $BaseUrl
    & "$SourceRoot\scripts\windows\verify-control-plane-p0.ps1" -BaseUrl $BaseUrl -DotnetExe $DotnetExe -PythonExe $PythonExe
    Add-Item $checks "p0" "ok" $BaseUrl
  }
}

$report = [ordered]@{
  generated_at_utc = [DateTimeOffset]::UtcNow.ToString("O")
  source_root = $SourceRoot
  runtime_root = $Root
  base_url = $BaseUrl
  execute_publish = [bool]$ExecutePublish
  register_services = [bool]$RegisterServices
  start_services = [bool]$StartServices
  blockers = $blockers
  warnings = $warnings
  checks = $checks
  planned_commands = $commands
}

$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 8

if ($blockers.Count -gt 0) {
  throw "P1 cutover rehearsal found $($blockers.Count) blocker(s). See $ReportPath"
}
