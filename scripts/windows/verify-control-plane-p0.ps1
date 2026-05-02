param(
  [string]$BaseUrl = "",
  [string]$RepoRoot = "",
  [string]$DotnetExe = "",
  [string]$PythonExe = "",
  [string]$PaymentWebhookSecret = "",
  [string]$ClientApiToken = "",
  [string]$AccountOwnerId = "",
  [switch]$Build,
  [switch]$SkipWorkers
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
}

function Import-EnvFileDefaults {
  param([string]$EnvFile)

  if (-not (Test-Path -LiteralPath $EnvFile)) {
    return
  }

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
    $value = $parts[1].Trim()
    if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

function Import-MachineEnvDefaults {
  param([string[]]$Names)

  foreach ($name in $Names) {
    if ([Environment]::GetEnvironmentVariable($name, "Process")) {
      continue
    }

    $value = [Environment]::GetEnvironmentVariable($name, "Machine")
    if ($value) {
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

Import-EnvFileDefaults (Join-Path $RepoRoot ".runtime\app\scripts\windows\.env.windows")
Import-EnvFileDefaults (Join-Path $RepoRoot "scripts\windows\.env.windows")
Import-MachineEnvDefaults @(
  "DATABASE_URL",
  "PAYMENT_WEBHOOK_SECRET",
  "INTERNAL_API_TOKEN",
  "CLIENT_API_TOKEN",
  "CLIENT_API_TOKEN_HEADER",
  "CLIENT_API_AUTH_PROVIDER",
  "CLIENT_API_AUTH_PROVIDER_SECRET",
  "CLIENT_API_AUTH_PROVIDER_ISSUER",
  "CLIENT_API_AUTH_PROVIDER_AUDIENCE",
  "CLIENT_API_AUTH_PROVIDER_TTL_SECONDS",
  "CLIENT_API_AUTH_PROVIDER_CLOCK_SKEW_SECONDS",
  "CLIENT_API_REQUIRE_AUTH_PROVIDER",
  "CLIENT_API_REQUIRE_ACCOUNT_SCOPE",
  "CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT",
  "CLIENT_API_ALLOWED_ACCOUNT_IDS",
  "CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS",
  "CLIENT_API_ALLOWED_PERMISSIONS",
  "PAYMENT_CALLBACK_ALLOWED_PROVIDERS",
  "PAYMENT_CALLBACK_REQUIRE_ALLOWED_PROVIDER",
  "PAYMENT_CALLBACK_ALLOWED_ACCOUNT_IDS",
  "PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS",
  "PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT",
  "Payments__AllowedProviders",
  "Payments__RequireAllowedProvider",
  "Payments__AllowedAccountIds",
  "Payments__AllowedAccountOwnerIds",
  "Payments__RequireAccountGrant",
  "DOTNET_EXE",
  "PYTHON_EXE",
  "CONTROL_API_BASE_URL"
)

if (-not $BaseUrl) {
  $BaseUrl = if ($env:CONTROL_API_BASE_URL) { $env:CONTROL_API_BASE_URL } else { "http://127.0.0.1:4100" }
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

if (-not $PythonExe) {
  if ($env:PYTHON_EXE) {
    $PythonExe = $env:PYTHON_EXE
  } elseif (Test-Path -LiteralPath "D:\soft\program\Python\Python312\python.exe") {
    $PythonExe = "D:\soft\program\Python\Python312\python.exe"
  } else {
    throw "D:\soft\program\Python\Python312\python.exe not found. Verification must use the D: Python runtime."
  }
}

if (-not $PaymentWebhookSecret) {
  $PaymentWebhookSecret = if ($env:PAYMENT_WEBHOOK_SECRET) { $env:PAYMENT_WEBHOOK_SECRET } else { "xiaolou-test-secret" }
}

if (-not $ClientApiToken) {
  $ClientApiToken = if ($env:CLIENT_API_TOKEN) { $env:CLIENT_API_TOKEN } else { "" }
}

if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
  throw "DATABASE_URL must be set in process, Machine env, or .runtime\app\scripts\windows\.env.windows for worker verification"
}

function Get-FirstConfiguredPaymentCallbackOwnerId {
  $requireGrant = if ($env:PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT) {
    $env:PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT
  } elseif ([Environment]::GetEnvironmentVariable("Payments__RequireAccountGrant", "Process")) {
    [Environment]::GetEnvironmentVariable("Payments__RequireAccountGrant", "Process")
  } else {
    ""
  }

  if ($requireGrant -notmatch "^(1|true|yes|on)$") {
    return $null
  }

  $allowedOwners = if ($env:PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS) {
    $env:PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS
  } elseif ([Environment]::GetEnvironmentVariable("Payments__AllowedAccountOwnerIds", "Process")) {
    [Environment]::GetEnvironmentVariable("Payments__AllowedAccountOwnerIds", "Process")
  } else {
    ""
  }

  foreach ($entry in ($allowedOwners -split "[,;]")) {
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

function Get-FirstConfiguredClientApiOwnerId {
  $allowedOwners = if ($env:CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS) {
    $env:CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS
  } else {
    ""
  }

  $fallbackOwner = $null
  foreach ($entry in ($allowedOwners -split "[,;]")) {
    $trimmed = $entry.Trim()
    if (-not $trimmed -or $trimmed -match "\*$") {
      continue
    }

    $parts = $trimmed.Split(":", 2)
    if ($parts.Count -eq 2 -and $parts[1].Trim()) {
      $ownerType = $parts[0].Trim().ToLowerInvariant()
      $ownerId = $parts[1].Trim()
      if ($ownerType -eq "user") {
        return $ownerId
      }
      if (-not $fallbackOwner) {
        $fallbackOwner = $ownerId
      }
      continue
    }

    if (-not $fallbackOwner) {
      $fallbackOwner = $trimmed
    }
  }

  return $fallbackOwner
}

$RunId = "p0-" + [Guid]::NewGuid().ToString("N")
if (-not $AccountOwnerId) {
  $configuredPaymentOwner = Get-FirstConfiguredPaymentCallbackOwnerId
  $configuredClientOwner = Get-FirstConfiguredClientApiOwnerId
  $AccountOwnerId = if ($configuredPaymentOwner) {
    $configuredPaymentOwner
  } elseif ($configuredClientOwner) {
    $configuredClientOwner
  } else {
    "verify-" + $RunId
  }
}
$ManualProviderRoute = "verify-script-$RunId"
$RecoveryProviderRoute = "verify-recovery-$RunId"
$RetryProviderRoute = "verify-retry-$RunId"
$PoisonProviderRoute = "verify-poison-$RunId"
$ConcurrencyProviderRoute = "verify-concurrency-$RunId"
$ClosedApiProviderRoute = "closed-api-$RunId"
$LocalModelProviderRoute = "local-model-$RunId"
$ClosedApiWorkerDll = Join-Path $RepoRoot "control-plane-dotnet\src\XiaoLou.ClosedApiWorker\bin\Debug\net8.0\XiaoLou.ClosedApiWorker.dll"
$SolutionPath = Join-Path $RepoRoot "control-plane-dotnet\XiaoLou.ControlPlane.sln"
$LocalWorkerRoot = Join-Path $RepoRoot "services\local-model-worker"
$script:VerifiedAccountId = $null
$script:KnownJobAccounts = @{}

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message"
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

function ConvertTo-Array {
  param($Value)
  if ($null -eq $Value) {
    return ,[object[]]@()
  }

  if ($Value -is [System.Array]) {
    return ,[object[]]$Value
  }

  return ,[object[]]@($Value)
}

function Test-TruthyEnvValue {
  param([string]$Value)
  return $Value -match "^(1|true|yes|on)$"
}

function Get-ConfiguredPaymentCallbackProvider {
  $allowedProviders = if ($env:PAYMENT_CALLBACK_ALLOWED_PROVIDERS) {
    $env:PAYMENT_CALLBACK_ALLOWED_PROVIDERS
  } elseif ([Environment]::GetEnvironmentVariable("Payments__AllowedProviders", "Process")) {
    [Environment]::GetEnvironmentVariable("Payments__AllowedProviders", "Process")
  } else {
    ""
  }

  foreach ($entry in ($allowedProviders -split "[,;]")) {
    $provider = $entry.Trim().ToLowerInvariant()
    if ($provider -and $provider -ne "*") {
      return $provider
    }
  }

  return "testpay"
}

function Get-PaymentWebhookSecretForProvider {
  param([string]$Provider)

  $providerSecret = [Environment]::GetEnvironmentVariable("Payments__${Provider}__WebhookSecret", "Process")
  if ($providerSecret) {
    return $providerSecret
  }

  return $PaymentWebhookSecret
}

function ConvertTo-Base64Url {
  param([byte[]]$Bytes)
  return [Convert]::ToBase64String($Bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function New-ClientAuthProviderAssertion {
  param(
    [string]$OwnerType,
    [string]$OwnerId,
    [string]$AccountId = ""
  )

  $secret = if ($env:CLIENT_API_AUTH_PROVIDER_SECRET) { $env:CLIENT_API_AUTH_PROVIDER_SECRET } else { "" }
  if (-not $secret) {
    return ""
  }

  if (-not $OwnerType) { $OwnerType = "user" }
  $ownerGrants = New-Object System.Collections.Generic.List[string]
  if ($OwnerId) {
    $ownerGrants.Add("${OwnerType}:$OwnerId") | Out-Null
  }

  $accountGrants = New-Object System.Collections.Generic.List[string]
  if ($AccountId) {
    $accountGrants.Add($AccountId) | Out-Null
  }

  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $ttl = 600
  if ($env:CLIENT_API_AUTH_PROVIDER_TTL_SECONDS) {
    $parsedTtl = 0
    if ([int]::TryParse($env:CLIENT_API_AUTH_PROVIDER_TTL_SECONDS, [ref]$parsedTtl) -and $parsedTtl -gt 0) {
      $ttl = [Math]::Min($parsedTtl, 3600)
    }
  }

  $payload = [ordered]@{
    sub = if ($OwnerId) { $OwnerId } else { $AccountOwnerId }
    iat = $now
    nbf = $now
    exp = $now + $ttl
    jti = [Guid]::NewGuid().ToString("N")
    xiaolou_account_owner_type = $OwnerType
    xiaolou_account_owner_ids = @($ownerGrants.ToArray())
    xiaolou_account_ids = @($accountGrants.ToArray())
    xiaolou_permissions = @(
      "accounts:ensure",
      "jobs:create",
      "jobs:read",
      "jobs:cancel",
      "wallet:read",
      "media:read",
      "media:write",
      "projects:read",
      "projects:write",
      "canvas:read",
      "canvas:write",
      "create:read",
      "create:write"
    )
  }

  if ($env:CLIENT_API_AUTH_PROVIDER_ISSUER) {
    $payload["iss"] = $env:CLIENT_API_AUTH_PROVIDER_ISSUER
  }
  if ($env:CLIENT_API_AUTH_PROVIDER_AUDIENCE) {
    $payload["aud"] = $env:CLIENT_API_AUTH_PROVIDER_AUDIENCE
  }

  $headerJson = @{ alg = "HS256"; typ = "JWT" } | ConvertTo-Json -Compress
  $payloadJson = $payload | ConvertTo-Json -Compress -Depth 8
  $headerSegment = ConvertTo-Base64Url ([System.Text.Encoding]::UTF8.GetBytes($headerJson))
  $payloadSegment = ConvertTo-Base64Url ([System.Text.Encoding]::UTF8.GetBytes($payloadJson))
  $signingInput = "$headerSegment.$payloadSegment"
  $hmac = [System.Security.Cryptography.HMACSHA256]::new([System.Text.Encoding]::UTF8.GetBytes($secret))
  try {
    $signature = ConvertTo-Base64Url ($hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($signingInput)))
    return "$signingInput.$signature"
  } finally {
    $hmac.Dispose()
  }
}

function Invoke-ApiJson {
  param(
    [string]$Method,
    [string]$Path,
    $Body = $null,
    [hashtable]$Headers = @{}
  )

  $uri = $BaseUrl.TrimEnd("/") + $Path
  $effectiveHeaders = @{}
  foreach ($key in $Headers.Keys) {
    $effectiveHeaders[$key] = $Headers[$key]
  }
  $requiresInternalToken = $Path.StartsWith("/api/internal") `
    -or $Path.StartsWith("/api/schema") `
    -or $Path.StartsWith("/api/providers/health")
  if ($requiresInternalToken -and $env:INTERNAL_API_TOKEN -and -not $effectiveHeaders.ContainsKey("X-XiaoLou-Internal-Token")) {
    $effectiveHeaders["X-XiaoLou-Internal-Token"] = $env:INTERNAL_API_TOKEN
  }
  $requiresClientToken = Test-PublicClientApiPath $Path
  if ($requiresClientToken -and $ClientApiToken -and -not $effectiveHeaders.ContainsKey("X-XiaoLou-Client-Token")) {
    $effectiveHeaders["X-XiaoLou-Client-Token"] = $ClientApiToken
  }
  if ($requiresClientToken) {
    Add-ClientAccountScopeHeaders -Path $Path -Body $Body -Headers $effectiveHeaders
    Add-ClientAuthProviderHeaders -Body $Body -Headers $effectiveHeaders
  }

  $parameters = @{
    Uri = $uri
    Method = $Method
    Headers = $effectiveHeaders
    TimeoutSec = 30
  }

  if ($null -ne $Body) {
    if ($Body -is [string]) {
      $parameters.Body = $Body
    } else {
      $parameters.Body = $Body | ConvertTo-Json -Compress -Depth 20
    }
    $parameters.ContentType = "application/json"
  }

  Invoke-RestMethod @parameters
}

function Test-PublicClientApiPath {
  param([string]$Path)
  return $Path.StartsWith("/api/accounts/ensure") `
    -or $Path.StartsWith("/api/jobs") `
    -or $Path -eq "/api/wallet" `
    -or $Path.StartsWith("/api/wallet?") `
    -or $Path -eq "/api/wallets" `
    -or $Path.StartsWith("/api/wallets") `
    -or $Path.StartsWith("/api/wallet/usage-stats") `
    -or $Path.StartsWith("/api/media")
}

function Get-BodyValue {
  param(
    $Body,
    [string]$Name
  )

  if ($null -eq $Body -or $Body -is [string]) {
    return $null
  }

  if ($Body -is [System.Collections.IDictionary] -and $Body.Contains($Name)) {
    return $Body[$Name]
  }

  $property = $Body.PSObject.Properties[$Name]
  if ($property) {
    return $property.Value
  }

  return $null
}

function Add-ClientAccountScopeHeaders {
  param(
    [string]$Path,
    $Body,
    [hashtable]$Headers
  )

  $bodyAccountId = Get-BodyValue $Body "accountId"
  $bodyOwnerType = Get-BodyValue $Body "accountOwnerType"
  $bodyOwnerId = Get-BodyValue $Body "accountOwnerId"

  if ($bodyAccountId -and -not $Headers.ContainsKey("X-XiaoLou-Account-Id")) {
    $Headers["X-XiaoLou-Account-Id"] = [string]$bodyAccountId
  }

  if ($bodyOwnerType -and -not $Headers.ContainsKey("X-XiaoLou-Account-Owner-Type")) {
    $Headers["X-XiaoLou-Account-Owner-Type"] = [string]$bodyOwnerType
  }

  if ($bodyOwnerId -and -not $Headers.ContainsKey("X-XiaoLou-Account-Owner-Id")) {
    $Headers["X-XiaoLou-Account-Owner-Id"] = [string]$bodyOwnerId
  }

  $jobId = $null
  if ($Path -match "^/api/jobs/([0-9a-fA-F-]{36})(/|$)") {
    $jobId = $Matches[1]
  }

  if (-not $Headers.ContainsKey("X-XiaoLou-Account-Id") -and $jobId -and $script:KnownJobAccounts.ContainsKey($jobId)) {
    $Headers["X-XiaoLou-Account-Id"] = $script:KnownJobAccounts[$jobId]
  }

  if (-not $Headers.ContainsKey("X-XiaoLou-Account-Id") -and $script:VerifiedAccountId) {
    $Headers["X-XiaoLou-Account-Id"] = $script:VerifiedAccountId
  }
}

function Add-ClientAuthProviderHeaders {
  param(
    $Body,
    [hashtable]$Headers
  )

  if ($Headers.ContainsKey("Authorization")) {
    return
  }

  $provider = if ($env:CLIENT_API_AUTH_PROVIDER) { $env:CLIENT_API_AUTH_PROVIDER } else { "" }
  $requiresProvider = Test-TruthyEnvValue $env:CLIENT_API_REQUIRE_AUTH_PROVIDER
  if (-not $requiresProvider -and $provider -notmatch "^(hs256-jwt|jwt-hs256)$") {
    return
  }

  $ownerType = if ($Headers.ContainsKey("X-XiaoLou-Account-Owner-Type")) {
    [string]$Headers["X-XiaoLou-Account-Owner-Type"]
  } else {
    "user"
  }
  $ownerId = if ($Headers.ContainsKey("X-XiaoLou-Account-Owner-Id")) {
    [string]$Headers["X-XiaoLou-Account-Owner-Id"]
  } else {
    [string](Get-BodyValue $Body "accountOwnerId")
  }
  $accountId = if ($Headers.ContainsKey("X-XiaoLou-Account-Id")) {
    [string]$Headers["X-XiaoLou-Account-Id"]
  } else {
    [string](Get-BodyValue $Body "accountId")
  }

  if (-not $ownerId) {
    $ownerId = $AccountOwnerId
  }

  $assertion = New-ClientAuthProviderAssertion -OwnerType $ownerType -OwnerId $ownerId -AccountId $accountId
  if ($assertion) {
    $Headers["Authorization"] = "Bearer $assertion"
  }
}

function Remember-JobAccount {
  param($Job)

  if ($null -eq $Job) {
    return
  }

  $jobId = [string](Get-BodyValue $Job "id")
  $accountId = [string](Get-BodyValue $Job "account_id")
  if ($jobId -and $accountId) {
    $script:KnownJobAccounts[$jobId] = $accountId
  }
}

function New-HmacSignature {
  param(
    [string]$Body,
    [string]$Secret
  )

  $secretBytes = [System.Text.Encoding]::UTF8.GetBytes($Secret)
  $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
  $hmac = [System.Security.Cryptography.HMACSHA256]::new($secretBytes)
  try {
    $hash = $hmac.ComputeHash($bodyBytes)
    return -join ($hash | ForEach-Object { $_.ToString("x2") })
  } finally {
    $hmac.Dispose()
  }
}

function Invoke-PaymentCallbackBadRequest {
  param(
    [string]$Provider,
    [string]$RawBody,
    [string]$ExpectedError
  )

  $badRequest = $false
  $responseText = ""
  $signature = New-HmacSignature $RawBody $PaymentCallbackSecret
  try {
    Invoke-ApiJson "Post" "/api/payments/callbacks/$Provider" $RawBody @{ "X-XiaoLou-Signature" = $signature } | Out-Null
  } catch {
    $statusCode = $null
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $statusCode = [int]$_.Exception.Response.StatusCode
    }

    if ($statusCode -eq 400) {
      $badRequest = $true
      if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
        $responseText = $_.ErrorDetails.Message
      }
    } else {
      throw
    }
  }

  Assert-True $badRequest "Payment callback negative case was not rejected with HTTP 400: $ExpectedError"
  if (-not [string]::IsNullOrWhiteSpace($ExpectedError) -and -not [string]::IsNullOrWhiteSpace($responseText)) {
    Assert-True ($responseText.Contains($ExpectedError)) "Payment callback negative case did not return expected error '$ExpectedError'. Response: $responseText"
  }
}

function Invoke-ApiForbidden {
  param(
    [string]$Method,
    [string]$Path,
    [hashtable]$Headers = @{},
    [int[]]$ExpectedStatusCodes = @(403)
  )

  $forbidden = $false
  try {
    Invoke-RestMethod `
      -Method $Method `
      -Uri ($BaseUrl.TrimEnd("/") + $Path) `
      -Headers $Headers `
      -TimeoutSec 5 | Out-Null
  } catch {
    $statusCode = $null
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $statusCode = [int]$_.Exception.Response.StatusCode
    }

    if ($ExpectedStatusCodes -contains $statusCode) {
      $forbidden = $true
    } else {
      throw
    }
  }

  Assert-True $forbidden "Protected API boundary did not return one of [$($ExpectedStatusCodes -join ', ')] for $Method $Path"
}

function New-TestJob {
  param(
    [string]$ProviderRoute,
    [string]$Scenario,
    [bool]$ForceFail = $false,
    [int]$MaxAttempts = 3,
    [string]$Lane = "account-media",
    [string]$OwnerId = $AccountOwnerId,
    [int]$TimeoutSeconds = 120
  )

  $safeOwner = $OwnerId -replace "[^A-Za-z0-9_-]", "-"
  $safeLane = $Lane -replace "[^A-Za-z0-9_-]", "-"
  $job = Invoke-ApiJson "Post" "/api/jobs" @{
    accountOwnerType = "user"
    accountOwnerId = $OwnerId
    regionCode = "CN"
    currency = "CNY"
    lane = $Lane
    providerRoute = $ProviderRoute
    jobType = "verify"
    idempotencyKey = "$RunId-$safeOwner-$safeLane-$ProviderRoute-$Scenario"
    maxAttempts = $MaxAttempts
    timeoutSeconds = $TimeoutSeconds
    payload = @{
      scenario = $Scenario
      forceFail = $ForceFail
    }
  }
  Remember-JobAccount $job
  return $job
}

function Lease-TestJobs {
  param(
    [string]$ProviderRoute,
    [string]$WorkerId,
    [string]$Lane = "account-media",
    [int]$BatchSize = 1,
    [int]$LeaseSeconds = 120
  )

  $leasedJobs = ConvertTo-Array (Invoke-ApiJson "Post" "/api/internal/jobs/lease" @{
    lane = $Lane
    providerRoute = $ProviderRoute
    workerId = $WorkerId
    batchSize = $BatchSize
    leaseSeconds = $LeaseSeconds
  })
  $leasedJobs | ForEach-Object { Remember-JobAccount $_ }
  return ,$leasedJobs
}

function Complete-LeasedJob {
  param(
    [string]$JobId,
    [string]$WorkerId,
    [string]$Verifier = "scripts/windows/verify-control-plane-p0.ps1"
  )

  Invoke-ApiJson "Post" "/api/internal/jobs/$JobId/running" @{ workerId = $WorkerId } | Out-Null
  Invoke-ApiJson "Post" "/api/internal/jobs/$JobId/succeed" @{ result = @{ verifier = $Verifier } } | Out-Null
  Wait-JobStatus $JobId "succeeded" | Out-Null
}

function Wait-JobStatus {
  param(
    [string]$JobId,
    [string]$ExpectedStatus,
    [int]$Attempts = 30
  )

  for ($i = 0; $i -lt $Attempts; $i++) {
    $job = Invoke-ApiJson "Get" "/api/jobs/$JobId"
    if ($job.status -eq $ExpectedStatus) {
      return $job
    }
    Start-Sleep -Milliseconds 500
  }

  $latest = Invoke-ApiJson "Get" "/api/jobs/$JobId"
  throw "Job $JobId did not reach status $ExpectedStatus. Current status: $($latest.status). Error: $($latest.last_error)"
}

function Invoke-WithEnv {
  param(
    [hashtable]$Values,
    [scriptblock]$Action
  )

  $previous = @{}
  foreach ($name in $Values.Keys) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
    [Environment]::SetEnvironmentVariable($name, [string]$Values[$name], "Process")
  }

  try {
    & $Action
  } finally {
    foreach ($name in $previous.Keys) {
      [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process")
    }
  }
}

function Invoke-ClosedApiWorkerOnce {
  param(
    [string]$WorkerId,
    [string]$ProviderRoute = $ClosedApiProviderRoute
  )

  Assert-True (Test-Path -LiteralPath $ClosedApiWorkerDll) "ClosedApiWorker DLL not found. Run dotnet build first or pass -Build."
  Invoke-WithEnv @{
    "Worker__WorkerId" = $WorkerId
    "Worker__Lane" = "account-media"
    "Worker__ProviderRoute" = $ProviderRoute
    "Worker__BatchSize" = "1"
    "Worker__PollSeconds" = "1"
    "Worker__LeaseSeconds" = "120"
    "Worker__RunOnce" = "true"
  } {
    Push-Location (Split-Path -Parent $ClosedApiWorkerDll)
    try {
      & $DotnetExe $ClosedApiWorkerDll
      Assert-True ($LASTEXITCODE -eq 0) "ClosedApiWorker exited with code $LASTEXITCODE"
    } finally {
      Pop-Location
    }
  }
}

function Invoke-LocalModelWorkerOnce {
  param(
    [string]$WorkerId,
    [string]$ProviderRoute = $LocalModelProviderRoute
  )

  Invoke-WithEnv @{
    "CONTROL_API_BASE_URL" = $BaseUrl
    "LOCAL_MODEL_WORKER_ID" = $WorkerId
    "LOCAL_MODEL_WORKER_LANE" = "account-media"
    "LOCAL_MODEL_WORKER_PROVIDER_ROUTE" = $ProviderRoute
    "LOCAL_MODEL_WORKER_RUN_ONCE" = "true"
    "LOCAL_MODEL_WORKER_BATCH_SIZE" = "1"
    "LOCAL_MODEL_WORKER_POLL_SECONDS" = "1"
    "LOCAL_MODEL_WORKER_LEASE_SECONDS" = "120"
  } {
    Push-Location $LocalWorkerRoot
    try {
      & $PythonExe -m app.worker
      Assert-True ($LASTEXITCODE -eq 0) "local-model-worker exited with code $LASTEXITCODE"
    } finally {
      Pop-Location
    }
  }
}

if ($Build) {
  Write-Step "Building .NET control plane"
  & $DotnetExe build $SolutionPath
  Assert-True ($LASTEXITCODE -eq 0) "dotnet build failed"
}

$PaymentCallbackProvider = Get-ConfiguredPaymentCallbackProvider
$PaymentCallbackSecret = Get-PaymentWebhookSecretForProvider $PaymentCallbackProvider

Write-Step "Checking Control API health at $BaseUrl"
$health = Invoke-ApiJson "Get" "/healthz"
Assert-True ($health.status -eq "ok") "Control API health check failed"

Write-Step "Applying PostgreSQL schema idempotently"
$schema = Invoke-ApiJson "Post" "/api/schema/apply"
Assert-True ($schema.applied -eq $true) "Schema apply endpoint did not confirm success"

Write-Step "Verifying internal API boundary"
Invoke-ApiForbidden "Get" "/api/internal/jobs/wait-signal?timeoutSeconds=1" @{ "X-Forwarded-For" = "203.0.113.10" }
Invoke-ApiForbidden "Post" "/api/schema/apply" @{ "X-Forwarded-For" = "203.0.113.10" }
Invoke-ApiForbidden "Get" "/api/providers/health" @{ "X-Forwarded-For" = "203.0.113.10" }
Invoke-ApiForbidden "Get" "/api/jobs" @{ "X-Forwarded-For" = "203.0.113.10" } @(401, 403)

Write-Step "Ensuring account"
$account = Invoke-ApiJson "Post" "/api/accounts/ensure" @{
  accountOwnerType = "user"
  accountOwnerId = $AccountOwnerId
  regionCode = "CN"
  currency = "CNY"
}
Assert-True (-not [string]::IsNullOrWhiteSpace($account.id)) "Account was not created"
$script:VerifiedAccountId = [string]$account.id

if ($ClientApiToken -and $env:CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT -ne "true") {
  Write-Step "Verifying public client account scope mismatch rejection"
  Invoke-ApiForbidden "Get" "/api/jobs?accountId=$($account.id)" @{
    "X-XiaoLou-Client-Token" = $ClientApiToken
    "X-XiaoLou-Account-Id" = [Guid]::NewGuid().ToString("D")
  }
}

Write-Step "Verifying manual jobs lease/running/heartbeat/succeed"
$manualJob = New-TestJob $ManualProviderRoute "manual-success"
$leased = ConvertTo-Array (Invoke-ApiJson "Post" "/api/internal/jobs/lease" @{
  lane = "account-media"
  providerRoute = $ManualProviderRoute
  workerId = "verify-script-worker"
  batchSize = 1
  leaseSeconds = 120
})
Assert-True ($leased.Count -eq 1) "Manual job lease did not return exactly one job"
$manualJobId = [string]$leased[0].id
Invoke-ApiJson "Post" "/api/internal/jobs/$manualJobId/running" @{ workerId = "verify-script-worker" } | Out-Null
Invoke-ApiJson "Post" "/api/internal/jobs/$manualJobId/heartbeat" @{ workerId = "verify-script-worker"; leaseSeconds = 120 } | Out-Null
Invoke-ApiJson "Post" "/api/internal/jobs/$manualJobId/succeed" @{ result = @{ verifier = "scripts/windows/verify-control-plane-p0.ps1" } } | Out-Null
Wait-JobStatus $manualJobId "succeeded" | Out-Null

Write-Step "Verifying lease timeout recovery and retry_waiting re-lease"
$timeoutJob = New-TestJob $RecoveryProviderRoute "lease-timeout-running" $false 2 "account-media" $AccountOwnerId 1
$timeoutLease = Lease-TestJobs $RecoveryProviderRoute "verify-timeout-worker" "account-media" 1 30
Assert-True ($timeoutLease.Count -eq 1) "Lease timeout test did not lease exactly one job"
$timeoutJobId = [string]$timeoutLease[0].id
Assert-True ($timeoutJobId -eq [string]$timeoutJob.id) "Lease timeout test leased an unexpected job"
Invoke-ApiJson "Post" "/api/internal/jobs/$timeoutJobId/running" @{ workerId = "verify-timeout-worker" } | Out-Null
Start-Sleep -Seconds 2
$recovered = ConvertTo-Array (Invoke-ApiJson "Post" "/api/internal/jobs/recover-expired")
Assert-True (@($recovered | Where-Object { [string]$_.id -eq $timeoutJobId }).Count -eq 1) "Expired running job was not recovered"
$recoveredJob = Wait-JobStatus $timeoutJobId "retry_waiting"
Assert-True ([string]$recoveredJob.last_error -match "lease expired") "Recovered job did not preserve an auditable lease timeout error"
$timeoutAttempts = ConvertTo-Array (Invoke-ApiJson "Get" "/api/internal/jobs/$timeoutJobId/attempts")
Assert-True ($timeoutAttempts.Count -eq 1) "Recovered running job should have exactly one attempt"
Assert-True ($timeoutAttempts[0].status -eq "retry_waiting") "Recovered running attempt was not closed as retry_waiting"
Assert-True (-not [string]::IsNullOrWhiteSpace([string]$timeoutAttempts[0].finished_at)) "Recovered running attempt was not finished"
$retryLease = Lease-TestJobs $RecoveryProviderRoute "verify-timeout-retry-worker" "account-media" 1 30
Assert-True ($retryLease.Count -eq 1) "Recovered retry_waiting job was not leaseable"
Assert-True ([string]$retryLease[0].id -eq $timeoutJobId) "Recovered retry_waiting lease returned an unexpected job"
Complete-LeasedJob $timeoutJobId "verify-timeout-retry-worker"

Write-Step "Verifying explicit retry_waiting path"
$retryJob = New-TestJob $RetryProviderRoute "explicit-retry" $false 3
$retryFirstLease = Lease-TestJobs $RetryProviderRoute "verify-retry-worker-1"
Assert-True ($retryFirstLease.Count -eq 1) "Explicit retry test did not lease the first attempt"
$retryJobId = [string]$retryFirstLease[0].id
Invoke-ApiJson "Post" "/api/internal/jobs/$retryJobId/running" @{ workerId = "verify-retry-worker-1" } | Out-Null
Invoke-ApiJson "Post" "/api/internal/jobs/$retryJobId/fail" @{ error = "verify retry attempt 1"; retry = $true; retryDelaySeconds = 0 } | Out-Null
Wait-JobStatus $retryJobId "retry_waiting" | Out-Null
$retrySecondLease = Lease-TestJobs $RetryProviderRoute "verify-retry-worker-2"
Assert-True ($retrySecondLease.Count -eq 1) "Explicit retry_waiting job was not leased again"
Assert-True ([string]$retrySecondLease[0].id -eq $retryJobId) "Explicit retry_waiting lease returned an unexpected job"
Complete-LeasedJob $retryJobId "verify-retry-worker-2"

Write-Step "Verifying poison job max_attempts and job_attempts audit"
$poisonJob = New-TestJob $PoisonProviderRoute "poison-max-attempts" $false 2
$poisonJobId = [string]$poisonJob.id
for ($attemptNo = 1; $attemptNo -le 2; $attemptNo++) {
  $poisonLease = Lease-TestJobs $PoisonProviderRoute "verify-poison-worker-$attemptNo"
  Assert-True ($poisonLease.Count -eq 1) "Poison job attempt $attemptNo was not leased"
  Assert-True ([string]$poisonLease[0].id -eq $poisonJobId) "Poison job attempt $attemptNo leased an unexpected job"
  Invoke-ApiJson "Post" "/api/internal/jobs/$poisonJobId/running" @{ workerId = "verify-poison-worker-$attemptNo" } | Out-Null
  Invoke-ApiJson "Post" "/api/internal/jobs/$poisonJobId/fail" @{
    error = "verify poison attempt $attemptNo"
    retry = $true
    retryDelaySeconds = 0
  } | Out-Null

  if ($attemptNo -eq 1) {
    Wait-JobStatus $poisonJobId "retry_waiting" | Out-Null
  } else {
    $failedPoison = Wait-JobStatus $poisonJobId "failed"
    Assert-True ([string]$failedPoison.last_error -match "verify poison attempt 2") "Poison job last_error did not record the terminal failure"
  }
}
$poisonAttempts = ConvertTo-Array (Invoke-ApiJson "Get" "/api/internal/jobs/$poisonJobId/attempts")
Assert-True ($poisonAttempts.Count -eq 2) "Poison job should have exactly two attempts"
Assert-True ($poisonAttempts[0].status -eq "retry_waiting") "Poison first attempt should be retry_waiting"
Assert-True ($poisonAttempts[1].status -eq "failed") "Poison terminal attempt should be failed"
Assert-True (-not [string]::IsNullOrWhiteSpace([string]$poisonAttempts[0].finished_at)) "Poison first attempt missing finished_at"
Assert-True (-not [string]::IsNullOrWhiteSpace([string]$poisonAttempts[1].finished_at)) "Poison terminal attempt missing finished_at"

Write-Step "Verifying same-account lane concurrency controls"
$concurrencyProvider = $ConcurrencyProviderRoute
$sameLaneA = New-TestJob $concurrencyProvider "same-account-media-a"
$sameLaneB = New-TestJob $concurrencyProvider "same-account-media-b"
$sameAccountLease = Lease-TestJobs $concurrencyProvider "verify-concurrency-media-a" "account-media" 2
Assert-True ($sameAccountLease.Count -eq 1) "Same account and same lane leased more than one active job in one batch"
$activeMediaJobId = [string]$sameAccountLease[0].id
$inactiveSameLaneJobId = if ($activeMediaJobId -eq [string]$sameLaneA.id) { [string]$sameLaneB.id } else { [string]$sameLaneA.id }

$sameAccountControl = New-TestJob $concurrencyProvider "same-account-control-lane" $false 3 "account-control"
$controlLaneLease = Lease-TestJobs $concurrencyProvider "verify-concurrency-control" "account-control" 1
Assert-True ($controlLaneLease.Count -eq 1) "Same account different lane was blocked by active media lane"
Assert-True ([string]$controlLaneLease[0].id -eq [string]$sameAccountControl.id) "Control lane lease returned an unexpected job"

$otherOwnerId = "$AccountOwnerId-other"
$otherAccountJob = New-TestJob $concurrencyProvider "other-account-media" $false 3 "account-media" $otherOwnerId
$otherAccountLease = Lease-TestJobs $concurrencyProvider "verify-concurrency-media-b" "account-media" 2
Assert-True ($otherAccountLease.Count -eq 1) "Different account same lane did not lease while the first account was active"
Assert-True ([string]$otherAccountLease[0].id -eq [string]$otherAccountJob.id) "Different account lease returned an unexpected job"

Complete-LeasedJob $activeMediaJobId "verify-concurrency-media-a"
Complete-LeasedJob ([string]$controlLaneLease[0].id) "verify-concurrency-control"
Complete-LeasedJob ([string]$otherAccountLease[0].id) "verify-concurrency-media-b"
Invoke-ApiJson "Post" "/api/jobs/$inactiveSameLaneJobId/cancel" @{ reason = "verify same-account lane concurrency cleanup" } | Out-Null

Write-Step "Verifying PostgreSQL LISTEN/NOTIFY bridge"
$signalHeaders = @{}
if ($env:INTERNAL_API_TOKEN) {
  $signalHeaders["X-XiaoLou-Internal-Token"] = $env:INTERNAL_API_TOKEN
}
$listenJob = Start-Job -ScriptBlock {
  param([string]$WaitUrl, [hashtable]$Headers)
  Invoke-RestMethod -Method Get -Uri $WaitUrl -Headers $Headers -TimeoutSec 20
} -ArgumentList ($BaseUrl.TrimEnd("/") + "/api/internal/jobs/wait-signal?timeoutSeconds=10"), $signalHeaders
Start-Sleep -Milliseconds 500
New-TestJob $ManualProviderRoute "listen-notify" | Out-Null
$signal = Receive-Job -Job $listenJob -Wait -AutoRemoveJob
Assert-True ($signal.notified -eq $true) "LISTEN/NOTIFY did not return a job signal"

Write-Step "Verifying payment callback signature rejection"
$invalidBody = @{
  accountOwnerType = "user"
  accountOwnerId = $AccountOwnerId
  regionCode = "CN"
  currency = "CNY"
  eventId = "$RunId-invalid"
  merchantOrderNo = "$RunId-invalid-order"
  providerTradeNo = "$RunId-invalid-trade"
  amountCents = 100
  creditAmount = 1.0
  data = @{ verifier = "invalid-signature" }
} | ConvertTo-Json -Compress -Depth 10
$invalidRejected = $false
try {
  Invoke-ApiJson "Post" "/api/payments/callbacks/$PaymentCallbackProvider" $invalidBody @{ "X-XiaoLou-Signature" = "bad-signature" } | Out-Null
} catch {
  $statusCode = $_.Exception.Response.StatusCode.value__
  if ($statusCode -eq 400) {
    $invalidRejected = $true
  } else {
    throw
  }
}
Assert-True $invalidRejected "Invalid payment signature was not rejected"

Write-Step "Verifying payment callback idempotency and immutable ledger path"
$paidAt = [DateTimeOffset]::UtcNow.ToString("O")
$paymentBody = [ordered]@{
  accountOwnerType = "user"
  accountOwnerId = $AccountOwnerId
  regionCode = "CN"
  currency = "CNY"
  eventId = "$RunId-paid"
  merchantOrderNo = "$RunId-order"
  providerTradeNo = "$RunId-trade"
  amountCents = 1200
  creditAmount = 12.0
  paidAt = $paidAt
  data = @{ verifier = "valid-signature" }
} | ConvertTo-Json -Compress -Depth 10
$signature = New-HmacSignature $paymentBody $PaymentCallbackSecret
$payment = Invoke-ApiJson "Post" "/api/payments/callbacks/$PaymentCallbackProvider" $paymentBody @{ "X-XiaoLou-Signature" = $signature }
Assert-True ($payment.ledger_inserted -eq $true) "Valid payment callback did not insert ledger"
$paymentReplay = Invoke-ApiJson "Post" "/api/payments/callbacks/$PaymentCallbackProvider" $paymentBody @{ "X-XiaoLou-Signature" = $signature }
Assert-True ($paymentReplay.duplicate -eq $true) "Payment replay was not idempotent"

Write-Step "Verifying payment callback signed negative cases"
$duplicateMismatchBody = [ordered]@{
  accountOwnerType = "user"
  accountOwnerId = $AccountOwnerId
  regionCode = "CN"
  currency = "CNY"
  eventId = "$RunId-paid"
  merchantOrderNo = "$RunId-order"
  providerTradeNo = "$RunId-trade"
  amountCents = 1200
  creditAmount = 12.0
  paidAt = $paidAt
  data = @{ verifier = "duplicate-body-mismatch" }
} | ConvertTo-Json -Compress -Depth 10
Invoke-PaymentCallbackBadRequest $PaymentCallbackProvider $duplicateMismatchBody "callback event body mismatch"

$providerTradeMismatchBody = [ordered]@{
  accountOwnerType = "user"
  accountOwnerId = $AccountOwnerId
  regionCode = "CN"
  currency = "CNY"
  eventId = "$RunId-trade-mismatch"
  merchantOrderNo = "$RunId-order"
  providerTradeNo = "$RunId-trade-conflict"
  amountCents = 1200
  creditAmount = 12.0
  paidAt = $paidAt
  data = @{ verifier = "provider-trade-mismatch" }
} | ConvertTo-Json -Compress -Depth 10
Invoke-PaymentCallbackBadRequest $PaymentCallbackProvider $providerTradeMismatchBody "payment order provider trade number mismatch"

$amountMismatchBody = [ordered]@{
  accountOwnerType = "user"
  accountOwnerId = $AccountOwnerId
  regionCode = "CN"
  currency = "CNY"
  eventId = "$RunId-amount-mismatch"
  merchantOrderNo = "$RunId-order"
  providerTradeNo = "$RunId-trade"
  amountCents = 1300
  creditAmount = 13.0
  paidAt = $paidAt
  data = @{ verifier = "amount-mismatch" }
} | ConvertTo-Json -Compress -Depth 10
Invoke-PaymentCallbackBadRequest $PaymentCallbackProvider $amountMismatchBody "payment order amount mismatch"

$regionRejectedBody = [ordered]@{
  accountOwnerType = "user"
  accountOwnerId = $AccountOwnerId
  regionCode = "US"
  currency = "CNY"
  eventId = "$RunId-region-rejected"
  merchantOrderNo = "$RunId-region-order"
  providerTradeNo = "$RunId-region-trade"
  amountCents = 100
  creditAmount = 1.0
  paidAt = $paidAt
  data = @{ verifier = "region-rejected" }
} | ConvertTo-Json -Compress -Depth 10
Invoke-PaymentCallbackBadRequest $PaymentCallbackProvider $regionRejectedBody "payment callback region is not allowed"

$sensitivityRejectedBody = [ordered]@{
  accountOwnerType = "user"
  accountOwnerId = $AccountOwnerId
  regionCode = "CN"
  currency = "CNY"
  eventId = "$RunId-sensitivity-rejected"
  merchantOrderNo = "$RunId-sensitivity-order"
  providerTradeNo = "$RunId-sensitivity-trade"
  amountCents = 100
  creditAmount = 1.0
  paidAt = $paidAt
  data = @{ dataSensitivity = "restricted"; verifier = "sensitivity-rejected" }
} | ConvertTo-Json -Compress -Depth 10
Invoke-PaymentCallbackBadRequest $PaymentCallbackProvider $sensitivityRejectedBody "payment callback data sensitivity is not allowed"

Write-Step "Verifying object-storage media metadata"
$upload = Invoke-ApiJson "Post" "/api/media/upload-begin" @{
  accountOwnerType = "user"
  accountOwnerId = $AccountOwnerId
  regionCode = "CN"
  currency = "CNY"
  idempotencyKey = "$RunId-upload"
  bucket = "xiaolou-test"
  objectKey = "temp/$RunId/input.txt"
  mediaType = "text"
  contentType = "text/plain"
  byteSize = 32
  dataSensitivity = "normal"
  data = @{ verifier = "upload-begin" }
}
Assert-True (-not [string]::IsNullOrWhiteSpace($upload.upload_session_id)) "Upload session was not created"
Invoke-ApiJson "Post" "/api/media/upload-complete" @{
  accountOwnerType = "user"
  accountOwnerId = $AccountOwnerId
  regionCode = "CN"
  currency = "CNY"
  uploadSessionId = $upload.upload_session_id
  mediaObjectId = $upload.media_object_id
  byteSize = 32
} | Out-Null
$moved = Invoke-ApiJson "Post" "/api/media/move-temp-to-permanent" @{
  accountOwnerType = "user"
  accountOwnerId = $AccountOwnerId
  regionCode = "CN"
  currency = "CNY"
  mediaObjectId = $upload.media_object_id
  permanentObjectKey = "media/$RunId/input.txt"
  reason = "verify"
}
Assert-True ($moved.permanent_object_key -eq "media/$RunId/input.txt") "Media object was not moved to permanent key"
$signed = Invoke-ApiJson "Post" "/api/media/signed-read-url" @{
  accountOwnerType = "user"
  accountOwnerId = $AccountOwnerId
  regionCode = "CN"
  currency = "CNY"
  mediaObjectId = $upload.media_object_id
  expiresInSeconds = 300
}
Assert-True (-not [string]::IsNullOrWhiteSpace($signed.signed_read_url)) "Signed read URL was not returned"

Write-Step "Verifying provider health and outbox lease"
$provider = Invoke-ApiJson "Put" "/api/providers/health" @{
  provider = "verify-provider"
  regionCode = "CN"
  modelFamily = "verify"
  status = "healthy"
  successRate = 1.0
  p95LatencyMs = 10
  costScore = 1.0
}
Assert-True ($provider.status -eq "healthy") "Provider health was not upserted"
$outbox = ConvertTo-Array (Invoke-ApiJson "Post" "/api/internal/outbox/lease" @{
  workerId = "verify-outbox"
  batchSize = 1
  leaseSeconds = 120
})
Assert-True ($outbox.Count -ge 1) "Outbox lease did not return an event"
Invoke-ApiJson "Post" "/api/internal/outbox/$($outbox[0].id)/complete" @{ published = $true } | Out-Null

if (-not $SkipWorkers) {
  Write-Step "Verifying ClosedApiWorker succeeded path"
  $closedSuccess = New-TestJob $ClosedApiProviderRoute "closed-success"
  Invoke-ClosedApiWorkerOnce "verify-closed-success"
  Wait-JobStatus ([string]$closedSuccess.id) "succeeded" | Out-Null

  Write-Step "Verifying ClosedApiWorker failed path"
  $closedFail = New-TestJob $ClosedApiProviderRoute "closed-fail" $true 1
  Invoke-ClosedApiWorkerOnce "verify-closed-fail"
  Wait-JobStatus ([string]$closedFail.id) "failed" | Out-Null

  Write-Step "Verifying local-model-worker succeeded path"
  $localSuccess = New-TestJob $LocalModelProviderRoute "local-success"
  Invoke-LocalModelWorkerOnce "verify-local-success"
  Wait-JobStatus ([string]$localSuccess.id) "succeeded" | Out-Null

  Write-Step "Verifying local-model-worker failed path"
  $localFail = New-TestJob $LocalModelProviderRoute "local-fail" $true 1
  Invoke-LocalModelWorkerOnce "verify-local-fail"
  Wait-JobStatus ([string]$localFail.id) "failed" | Out-Null
}

Write-Step "P0 verification completed"
[ordered]@{
  runId = $RunId
  accountId = $account.id
  baseUrl = $BaseUrl
  workersVerified = -not $SkipWorkers
} | ConvertTo-Json -Depth 5
