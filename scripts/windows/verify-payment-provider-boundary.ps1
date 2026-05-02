param(
  [string]$BaseUrl = "http://127.0.0.1:4118",
  [string]$RepoRoot = "",
  [string]$DotnetExe = "",
  [string]$ControlApiDll = "",
  [string]$PaymentWebhookSecret = "",
  [string]$ReportPath = "",
  [switch]$Build
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $candidateRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
  $candidateParent = Split-Path -Parent $candidateRoot
  if ((Split-Path -Leaf $candidateRoot) -eq "app" -and (Split-Path -Leaf $candidateParent) -eq ".runtime") {
    $RepoRoot = Split-Path -Parent $candidateParent
  } else {
    $RepoRoot = $candidateRoot
  }
}

$runtimeEnvFile = Join-Path $RepoRoot ".runtime\app\scripts\windows\.env.windows"
$sourceEnvFile = Join-Path $RepoRoot "scripts\windows\.env.windows"
if (Test-Path -LiteralPath $runtimeEnvFile) {
  . "$RepoRoot\scripts\windows\load-env.ps1" -EnvFile $runtimeEnvFile
} else {
  . "$RepoRoot\scripts\windows\load-env.ps1" -EnvFile $sourceEnvFile
}

foreach ($name in @("DATABASE_URL", "DOTNET_EXE")) {
  if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
    $machineValue = [Environment]::GetEnvironmentVariable($name, "Machine")
    if ($machineValue) {
      [Environment]::SetEnvironmentVariable($name, $machineValue, "Process")
    }
  }
}

if (-not $DotnetExe) {
  if ($env:DOTNET_EXE) {
    $DotnetExe = $env:DOTNET_EXE
  } elseif (Test-Path -LiteralPath "D:\soft\program\dotnet\dotnet.exe") {
    $DotnetExe = "D:\soft\program\dotnet\dotnet.exe"
  } else {
    throw "D:\soft\program\dotnet\dotnet.exe not found. Verification must use the D: .NET runtime."
  }
}

if (-not [System.IO.Path]::GetFullPath($DotnetExe).StartsWith("D:\", [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to use non-D: dotnet path: $DotnetExe"
}

if (-not $ControlApiDll) {
  $ControlApiDll = Join-Path $RepoRoot "control-plane-dotnet\src\XiaoLou.ControlApi\bin\Debug\net8.0\XiaoLou.ControlApi.dll"
}

if (-not $PaymentWebhookSecret) {
  $PaymentWebhookSecret = "provider-boundary-smoke-secret"
}

if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
  throw "DATABASE_URL must be set by source env, runtime env, or Machine env."
}

$runtimeRoot = Join-Path $RepoRoot ".runtime"
$logRoot = Join-Path $runtimeRoot "xiaolou-logs"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
if (-not $ReportPath) {
  $ReportPath = Join-Path $logRoot "payment-provider-boundary-$stamp.json"
}

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )

  if (-not $Condition) {
    throw "Assertion failed: $Message"
  }
}

function New-HmacSignature {
  param(
    [string]$Body,
    [string]$Secret
  )

  $hmac = [System.Security.Cryptography.HMACSHA256]::new([System.Text.Encoding]::UTF8.GetBytes($Secret))
  try {
    $hash = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Body))
    return -join ($hash | ForEach-Object { $_.ToString("x2") })
  } finally {
    $hmac.Dispose()
  }
}

function Invoke-Json {
  param(
    [string]$Method,
    [string]$Path,
    [string]$Body = "",
    [hashtable]$Headers = @{}
  )

  $parameters = @{
    Method = $Method
    Uri = $BaseUrl.TrimEnd("/") + $Path
    Headers = $Headers
    TimeoutSec = 30
  }
  if ($Body) {
    $parameters.ContentType = "application/json"
    $parameters.Body = $Body
  }

  Invoke-RestMethod @parameters
}

function Invoke-ExpectedStatus {
  param(
    [string]$Method,
    [string]$Path,
    [int]$ExpectedStatus,
    [string]$Body = "",
    [hashtable]$Headers = @{},
    [string]$ExpectedText = ""
  )

  try {
    $parameters = @{
      Method = $Method
      Uri = $BaseUrl.TrimEnd("/") + $Path
      Headers = $Headers
      TimeoutSec = 30
      ErrorAction = "Stop"
    }
    if ($Body) {
      $parameters.ContentType = "application/json"
      $parameters.Body = $Body
    }

    Invoke-WebRequest @parameters | Out-Null
  } catch {
    $statusCode = $null
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $statusCode = [int]$_.Exception.Response.StatusCode.value__
    }

    $responseText = ""
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      $responseText = $_.ErrorDetails.Message
    } elseif ($_.Exception.Response) {
      $stream = $_.Exception.Response.GetResponseStream()
      if ($stream) {
        $reader = [System.IO.StreamReader]::new($stream)
        try {
          $responseText = $reader.ReadToEnd()
        } finally {
          $reader.Dispose()
        }
      }
    }

    $textMatches = -not $ExpectedText -or $responseText.Contains($ExpectedText)
    if ($statusCode -eq $ExpectedStatus -and $textMatches) {
      return [ordered]@{
        status = "ok"
        http_status = $statusCode
        response = $responseText
      }
    }

    throw
  }

  throw "Expected HTTP $ExpectedStatus for $Method $Path."
}

if ($Build -or -not (Test-Path -LiteralPath $ControlApiDll)) {
  & $DotnetExe build (Join-Path $RepoRoot "control-plane-dotnet\XiaoLou.ControlPlane.sln")
  if ($LASTEXITCODE -ne 0) {
    throw "dotnet build failed with exit code $LASTEXITCODE"
  }
}

Assert-True (Test-Path -LiteralPath $ControlApiDll) "Control API DLL not found: $ControlApiDll"

$stdoutPath = Join-Path $logRoot "payment-provider-boundary-control-api-$stamp.out.log"
$stderrPath = Join-Path $logRoot "payment-provider-boundary-control-api-$stamp.err.log"
$runId = "provider-boundary-" + [Guid]::NewGuid().ToString("N")
$allowedOwnerId = "$runId-owner"
$blockedOwnerId = "$runId-blocked-owner"
$previousEnv = @{}
foreach ($name in @(
  "ASPNETCORE_URLS",
  "CONTROL_API_BASE_URL",
  "Payments__WebhookSecret",
  "Payments__AllowedProviders",
  "Payments__RequireAllowedProvider",
  "PAYMENT_CALLBACK_ALLOWED_PROVIDERS",
  "PAYMENT_CALLBACK_REQUIRE_ALLOWED_PROVIDER",
  "Payments__AllowedAccountIds",
  "Payments__AllowedAccountOwnerIds",
  "Payments__RequireAccountGrant",
  "PAYMENT_CALLBACK_ALLOWED_ACCOUNT_IDS",
  "PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS",
  "PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT",
  "Postgres__ApplySchemaOnStartup"
)) {
  $previousEnv[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

$process = $null
try {
  $env:ASPNETCORE_URLS = $BaseUrl
  $env:CONTROL_API_BASE_URL = $BaseUrl
  $env:Payments__WebhookSecret = $PaymentWebhookSecret
  $env:Payments__AllowedProviders = "testpay"
  $env:Payments__RequireAllowedProvider = "true"
  $env:PAYMENT_CALLBACK_ALLOWED_PROVIDERS = "testpay"
  $env:PAYMENT_CALLBACK_REQUIRE_ALLOWED_PROVIDER = "true"
  $env:Payments__AllowedAccountOwnerIds = "user:$allowedOwnerId"
  $env:Payments__RequireAccountGrant = "true"
  $env:PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS = "user:$allowedOwnerId"
  $env:PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT = "true"
  $env:Postgres__ApplySchemaOnStartup = "true"

  $process = Start-Process `
    -FilePath $DotnetExe `
    -ArgumentList @($ControlApiDll, "--urls", $BaseUrl) `
    -WorkingDirectory (Split-Path -Parent $ControlApiDll) `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru

  $health = $null
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    try {
      $health = Invoke-Json -Method "Get" -Path "/healthz"
      if ($health.status -eq "ok") {
        break
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  Assert-True ($health.status -eq "ok") "Control API did not become healthy at $BaseUrl"

  $validBody = [ordered]@{
    accountOwnerType = "user"
    accountOwnerId = $allowedOwnerId
    regionCode = "CN"
    currency = "CNY"
    eventId = "$runId-paid"
    merchantOrderNo = "$runId-order"
    providerTradeNo = "$runId-trade"
    amountCents = 123
    creditAmount = 1.23
    paidAt = [DateTimeOffset]::UtcNow.ToString("O")
    data = @{ verifier = "provider-boundary-valid" }
  } | ConvertTo-Json -Compress -Depth 10
  $validSignature = New-HmacSignature $validBody $PaymentWebhookSecret
  $valid = Invoke-Json -Method "Post" -Path "/api/payments/callbacks/testpay" -Body $validBody -Headers @{
    "X-XiaoLou-Signature" = $validSignature
  }
  Assert-True ($valid.ledger_inserted -eq $true) "Allowed provider callback did not insert ledger"

  $blockedBody = [ordered]@{
    accountOwnerType = "user"
    accountOwnerId = $allowedOwnerId
    regionCode = "CN"
    currency = "CNY"
    eventId = "$runId-blocked"
    merchantOrderNo = "$runId-blocked-order"
    providerTradeNo = "$runId-blocked-trade"
    amountCents = 123
    creditAmount = 1.23
    data = @{ verifier = "provider-boundary-blocked" }
  } | ConvertTo-Json -Compress -Depth 10
  $blockedSignature = New-HmacSignature $blockedBody $PaymentWebhookSecret
  $blocked = Invoke-ExpectedStatus -Method "Post" -Path "/api/payments/callbacks/notallowed" -ExpectedStatus 403 -Body $blockedBody -Headers @{
    "X-XiaoLou-Signature" = $blockedSignature
  } -ExpectedText "payment callback provider is not enabled"

  $mismatchBody = [ordered]@{
    provider = "notallowed"
    accountOwnerType = "user"
    accountOwnerId = $allowedOwnerId
    regionCode = "CN"
    currency = "CNY"
    eventId = "$runId-mismatch"
    merchantOrderNo = "$runId-mismatch-order"
    providerTradeNo = "$runId-mismatch-trade"
    amountCents = 123
    creditAmount = 1.23
    data = @{ verifier = "provider-boundary-mismatch" }
  } | ConvertTo-Json -Compress -Depth 10
  $mismatchSignature = New-HmacSignature $mismatchBody $PaymentWebhookSecret
  $mismatch = Invoke-ExpectedStatus -Method "Post" -Path "/api/payments/callbacks/testpay" -ExpectedStatus 400 -Body $mismatchBody -Headers @{
    "X-XiaoLou-Signature" = $mismatchSignature
  } -ExpectedText "payment callback provider mismatch"

  $invalidProviderBody = $blockedBody
  $invalidProviderSignature = New-HmacSignature $invalidProviderBody $PaymentWebhookSecret
  $invalidProvider = Invoke-ExpectedStatus -Method "Post" -Path "/api/payments/callbacks/bad.provider" -ExpectedStatus 400 -Body $invalidProviderBody -Headers @{
    "X-XiaoLou-Signature" = $invalidProviderSignature
  } -ExpectedText "payment callback provider is invalid"

  $blockedAccountBody = [ordered]@{
    accountOwnerType = "user"
    accountOwnerId = $blockedOwnerId
    regionCode = "CN"
    currency = "CNY"
    eventId = "$runId-account-blocked"
    merchantOrderNo = "$runId-account-blocked-order"
    providerTradeNo = "$runId-account-blocked-trade"
    amountCents = 123
    creditAmount = 1.23
    data = @{ verifier = "provider-boundary-account-blocked" }
  } | ConvertTo-Json -Compress -Depth 10
  $blockedAccountSignature = New-HmacSignature $blockedAccountBody $PaymentWebhookSecret
  $blockedAccount = Invoke-ExpectedStatus -Method "Post" -Path "/api/payments/callbacks/testpay" -ExpectedStatus 403 -Body $blockedAccountBody -Headers @{
    "X-XiaoLou-Signature" = $blockedAccountSignature
  } -ExpectedText "payment callback account is not enabled"

  $report = [ordered]@{
    generated_at_utc = [DateTimeOffset]::UtcNow.ToString("O")
    status = "ok"
    base_url = $BaseUrl
    allowed_provider = "testpay"
    blocked_provider = "notallowed"
    allowed_account_owner_id = "user:$allowedOwnerId"
    blocked_account_owner_id = "user:$blockedOwnerId"
    run_id = $runId
    control_api_stdout = $stdoutPath
    control_api_stderr = $stderrPath
    checks = @(
      [ordered]@{ name = "allowed-provider"; status = "ok"; detail = "testpay callback processed" },
      [ordered]@{ name = "blocked-provider"; status = "ok"; detail = $blocked.response },
      [ordered]@{ name = "body-route-provider-mismatch"; status = "ok"; detail = $mismatch.response },
      [ordered]@{ name = "invalid-provider-format"; status = "ok"; detail = $invalidProvider.response },
      [ordered]@{ name = "blocked-account-gray-gate"; status = "ok"; detail = $blockedAccount.response }
    )
  }
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
  $report | ConvertTo-Json -Depth 8
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }

  foreach ($name in $previousEnv.Keys) {
    [Environment]::SetEnvironmentVariable($name, $previousEnv[$name], "Process")
  }
}
