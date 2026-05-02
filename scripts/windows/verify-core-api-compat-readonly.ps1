param(
  [string]$RepoRoot = "",
  [string]$EnvFile = "$PSScriptRoot\.env.windows",
  [string]$NodeExe = "",
  [string]$DatabaseUrl = "",
  [int]$Port = 4113,
  [int]$TimeoutSeconds = 30,
  [string]$CompatPublicRouteAllowlist = "GET /healthz;GET /api/windows-native/status",
  [string[]]$AllowedReadPaths = @(
    "/healthz",
    "/api/windows-native/status"
  ),
  [string[]]$ClosedReadPaths = @(
    "/api/wallet",
    "/api/wallets",
    "/api/wallet/recharge-capabilities",
    "/api/jobs",
    "/api/projects",
    "/api/projects/smoke-project/assets",
    "/api/chat/models",
    "/api/auth/providers",
    "/api/payments/alipay/checkout/smoke-order",
    "/api/canvas-projects",
    "/api/agent-canvas/projects",
    "/api/canvas-library/templates",
    "/uploads/smoke.txt"
  ),
  [string[]]$BlockedWritePaths = @(
    "POST /api/demo/reset",
    "POST /api/jobs",
    "DELETE /api/tasks",
    "POST /api/wallet/recharge-orders",
    "POST /api/payments/alipay/notify",
    "POST /api/media/upload-begin",
    "POST /api/uploads"
  )
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
}

. "$PSScriptRoot\load-env.ps1" -EnvFile $EnvFile

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

function Test-PortOpen {
  param(
    [string]$HostName,
    [int]$PortNumber
  )

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect($HostName, $PortNumber, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(500)) {
      return $false
    }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Invoke-CoreApiRequest {
  param(
    [string]$Method,
    [string]$Path,
    [string]$Body = ""
  )

  $uri = "http://127.0.0.1:$Port$Path"
  try {
    $parameters = @{
      Method = $Method
      Uri = $uri
      UseBasicParsing = $true
      TimeoutSec = 10
    }
    if ($Body) {
      $parameters["Body"] = $Body
      $parameters["ContentType"] = "application/json"
    }

    $response = Invoke-WebRequest @parameters
    $content = [string]$response.Content
    $json = $null
    if ($content) {
      try { $json = $content | ConvertFrom-Json } catch {}
    }
    return [ordered]@{
      statusCode = [int]$response.StatusCode
      body = $content
      json = $json
    }
  } catch {
    $response = $_.Exception.Response
    if (-not $response) {
      throw
    }

    $content = ""
    try {
      $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
      $content = $reader.ReadToEnd()
    } finally {
      if ($reader) { $reader.Dispose() }
    }
    if (-not $content -and $_.ErrorDetails -and $_.ErrorDetails.Message) {
      $content = [string]$_.ErrorDetails.Message
    }

    $json = $null
    if ($content) {
      try { $json = $content | ConvertFrom-Json } catch {}
    }

    return [ordered]@{
      statusCode = [int]$response.StatusCode
      body = $content
      json = $json
    }
  }
}

function Assert-Status {
  param(
    $Response,
    [int]$ExpectedStatus,
    [string]$Label
  )

  if ([int]$Response.statusCode -ne $ExpectedStatus) {
    throw "$Label expected HTTP $ExpectedStatus but got $($Response.statusCode): $($Response.body)"
  }
}

function Get-ResponseErrorCode {
  param($Response)

  $json = $Response["json"]
  $body = [string]$Response["body"]
  if ($null -eq $json -and $body) {
    try { $json = $body | ConvertFrom-Json } catch {}
  }

  $code = $null
  if ($null -ne $json -and $null -ne $json.error) {
    $code = $json.error.code
  }
  if (-not $code -and $body -match '"code"\s*:\s*"([^"]+)"') {
    $code = $Matches[1]
  }

  return $code
}

function Assert-ErrorCode {
  param(
    $Response,
    [string]$ExpectedCode,
    [string]$Label
  )

  $actualCode = Get-ResponseErrorCode $Response
  if ($actualCode -ne $ExpectedCode) {
    throw "$Label expected error code $ExpectedCode but got $actualCode. Body: $($Response["body"])"
  }
}

function Split-MethodPathEntry {
  param(
    [string]$Entry
  )

  $parts = [string]$Entry -split "\s+", 2
  if ($parts.Count -ne 2 -or -not $parts[0] -or -not $parts[1]) {
    throw "Invalid method/path entry '$Entry'. Expected format like 'POST /api/jobs'."
  }

  return [ordered]@{
    method = $parts[0].Trim().ToUpperInvariant()
    path = $parts[1].Trim()
  }
}

$NodeExe = Resolve-DTool $NodeExe "NODE_EXE" "D:\soft\program\nodejs\node.exe" "Node.js"
$CoreApiRoot = Join-Path $RepoRoot "core-api"
$PackageJson = Join-Path $CoreApiRoot "package.json"
$PgModule = Join-Path $CoreApiRoot "node_modules\pg\package.json"
if (-not (Test-Path -LiteralPath $PackageJson)) {
  throw "core-api package.json not found at $PackageJson"
}
if (-not (Test-Path -LiteralPath $PgModule)) {
  throw "core-api dependency pg is missing. Run npm install in $CoreApiRoot with D: npm before smoke testing."
}

if (-not $DatabaseUrl) {
  $DatabaseUrl = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
}
if (-not $DatabaseUrl -or $DatabaseUrl.Contains("change-me")) {
  $DatabaseUrl = "postgres://root:root@127.0.0.1:5432/xiaolou_windows_native_test"
}

if (Test-PortOpen "127.0.0.1" $Port) {
  throw "Port $Port is already listening. Stop the existing process or pass a different -Port."
}

$logDir = [Environment]::GetEnvironmentVariable("LOG_DIR", "Process")
if (-not $logDir) {
  $logDir = Join-Path $RepoRoot ".runtime\xiaolou-logs"
}
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stdoutLog = Join-Path $logDir "core-api-compat-readonly-$stamp.out.log"
$stderrLog = Join-Path $logDir "core-api-compat-readonly-$stamp.err.log"

[Environment]::SetEnvironmentVariable("PORT", [string]$Port, "Process")
[Environment]::SetEnvironmentVariable("HOST", "127.0.0.1", "Process")
[Environment]::SetEnvironmentVariable("DATABASE_URL", $DatabaseUrl, "Process")
[Environment]::SetEnvironmentVariable("READ_DATABASE_URL", $DatabaseUrl, "Process")
[Environment]::SetEnvironmentVariable("VR_DATABASE_URL", $DatabaseUrl, "Process")
[Environment]::SetEnvironmentVariable("JAAZ_DATABASE_URL", $DatabaseUrl, "Process")
[Environment]::SetEnvironmentVariable("CORE_API_COMPAT_READ_ONLY", "1", "Process")
[Environment]::SetEnvironmentVariable("CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST", $CompatPublicRouteAllowlist, "Process")
[Environment]::SetEnvironmentVariable("POSTGRES_ALLOW_EMPTY_BOOTSTRAP", "0", "Process")
[Environment]::SetEnvironmentVariable("JAAZ_AUTO_START", "0", "Process")
[Environment]::SetEnvironmentVariable("JAAZ_UI_MODE", "off", "Process")

$proc = $null
try {
  $proc = Start-Process `
    -FilePath $NodeExe `
    -ArgumentList @("src/server.js") `
    -WorkingDirectory $CoreApiRoot `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -WindowStyle Hidden `
    -PassThru

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $health = $null
  do {
    Start-Sleep -Milliseconds 500
    if ($proc.HasExited) {
      $stderr = if (Test-Path -LiteralPath $stderrLog) { Get-Content -Raw -LiteralPath $stderrLog } else { "" }
      throw "core-api exited before health check. ExitCode=$($proc.ExitCode). stderr=$stderr"
    }

    try {
      $health = Invoke-CoreApiRequest -Method "GET" -Path "/healthz"
    } catch {
      $health = $null
    }
  } while (($null -eq $health -or [int]$health.statusCode -ne 200) -and (Get-Date) -lt $deadline)

  if ($null -eq $health) {
    throw "core-api did not answer /healthz within $TimeoutSeconds seconds."
  }
  Assert-Status $health 200 "GET /healthz"

  $allowedReadChecks = New-Object System.Collections.Generic.List[object]
  foreach ($allowedPath in $AllowedReadPaths) {
    $allowedRead = Invoke-CoreApiRequest -Method "GET" -Path $allowedPath
    Assert-Status $allowedRead 200 "GET $allowedPath"
    $allowedReadChecks.Add([ordered]@{
      path = $allowedPath
      statusCode = $allowedRead["statusCode"]
    }) | Out-Null
  }

  $closedReadChecks = New-Object System.Collections.Generic.List[object]
  foreach ($closedPath in $ClosedReadPaths) {
    $closedRead = Invoke-CoreApiRequest -Method "GET" -Path $closedPath
    Assert-Status $closedRead 410 "GET $closedPath"
    Assert-ErrorCode $closedRead "CORE_API_COMPAT_ROUTE_CLOSED" "GET $closedPath"
    $closedReadChecks.Add([ordered]@{
      path = $closedPath
      statusCode = $closedRead["statusCode"]
      errorCode = Get-ResponseErrorCode $closedRead
    }) | Out-Null
  }

  $blockedWriteChecks = New-Object System.Collections.Generic.List[object]
  $firstBlockedWriteCode = $null
  foreach ($blockedWritePath in $BlockedWritePaths) {
    $entry = Split-MethodPathEntry $blockedWritePath
    $method = $entry["method"]
    $path = $entry["path"]
    $body = if ($method -in @("POST", "PUT", "PATCH")) { "{}" } else { "" }
    $blockedWrite = Invoke-CoreApiRequest -Method $method -Path $path -Body $body
    Assert-Status $blockedWrite 410 "$method $path"
    Assert-ErrorCode $blockedWrite "CORE_API_COMPAT_READ_ONLY" "$method $path"
    $errorCode = Get-ResponseErrorCode $blockedWrite
    if (-not $firstBlockedWriteCode) {
      $firstBlockedWriteCode = $errorCode
    }
    $blockedWriteChecks.Add([ordered]@{
      method = $method
      path = $path
      statusCode = $blockedWrite["statusCode"]
      errorCode = $errorCode
    }) | Out-Null
  }

  [ordered]@{
    ok = $true
    baseUrl = "http://127.0.0.1:$Port"
    databaseUrl = $DatabaseUrl
    nodeExe = $NodeExe
    compatPublicRouteAllowlist = $CompatPublicRouteAllowlist
    stdoutLog = $stdoutLog
    stderrLog = $stderrLog
    checks = [ordered]@{
      allowedReads = $allowedReadChecks
      legacyPublicGetsClosed = $closedReadChecks
      mutatingWriteClosed = $firstBlockedWriteCode
      mutatingWritesClosed = $blockedWriteChecks
    }
  } | ConvertTo-Json -Depth 8
} finally {
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    try { Wait-Process -Id $proc.Id -Timeout 5 -ErrorAction SilentlyContinue } catch {}
  }
}
