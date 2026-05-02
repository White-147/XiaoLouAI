param(
  [string]$BaseUrl = "",
  [string]$Secret = "",
  [string]$Issuer = "",
  [string]$Audience = "",
  [string]$InternalToken = "",
  [string]$OwnerId = "",
  [switch]$ApplySchema
)

$ErrorActionPreference = "Stop"

if (-not $BaseUrl) {
  $BaseUrl = if ($env:CONTROL_API_BASE_URL) { $env:CONTROL_API_BASE_URL } else { "http://127.0.0.1:4100" }
}

if (-not $Secret) {
  $Secret = $env:CLIENT_API_AUTH_PROVIDER_SECRET
}

if (-not $Issuer) {
  $Issuer = $env:CLIENT_API_AUTH_PROVIDER_ISSUER
}

if (-not $Audience) {
  $Audience = $env:CLIENT_API_AUTH_PROVIDER_AUDIENCE
}

if (-not $InternalToken) {
  $InternalToken = $env:INTERNAL_API_TOKEN
}

if (-not $Secret) {
  throw "CLIENT_API_AUTH_PROVIDER_SECRET is required to verify provider-signed client assertions."
}

$RunId = "auth-provider-" + [Guid]::NewGuid().ToString("N")
if (-not $OwnerId) {
  $OwnerId = "verify-$RunId"
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

function ConvertTo-Base64Url {
  param([byte[]]$Bytes)
  return [Convert]::ToBase64String($Bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function New-ClientAuthProviderJwt {
  param(
    [string]$Subject,
    [string[]]$Permissions,
    [string[]]$AccountIds = @(),
    [string[]]$OwnerIds = @()
  )

  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $payload = [ordered]@{
    sub = $Subject
    exp = $now + 600
    nbf = $now - 30
    xiaolou_permissions = $Permissions
  }

  if ($Issuer) {
    $payload.iss = $Issuer
  }

  if ($Audience) {
    $payload.aud = $Audience
  }

  if ($AccountIds.Count -gt 0) {
    $payload.xiaolou_account_ids = $AccountIds
  }

  if ($OwnerIds.Count -gt 0) {
    $payload.xiaolou_account_owner_ids = $OwnerIds
  }

  $headerJson = @{ alg = "HS256"; typ = "JWT" } | ConvertTo-Json -Compress
  $payloadJson = $payload | ConvertTo-Json -Compress -Depth 8
  $encodedHeader = ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes($headerJson))
  $encodedPayload = ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes($payloadJson))
  $signingInput = "$encodedHeader.$encodedPayload"
  $hmac = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($Secret))
  try {
    $signature = ConvertTo-Base64Url ($hmac.ComputeHash([Text.Encoding]::ASCII.GetBytes($signingInput)))
  } finally {
    $hmac.Dispose()
  }

  return "$signingInput.$signature"
}

function Invoke-ApiJson {
  param(
    [string]$Method,
    [string]$Path,
    $Body = $null,
    [hashtable]$Headers = @{}
  )

  $parameters = @{
    Method = $Method
    Uri = $BaseUrl.TrimEnd("/") + $Path
    Headers = $Headers
    TimeoutSec = 30
  }

  if ($null -ne $Body) {
    $parameters.Body = $Body | ConvertTo-Json -Compress -Depth 12
    $parameters.ContentType = "application/json"
  }

  Invoke-RestMethod @parameters
}

function Invoke-ApiExpectedStatus {
  param(
    [string]$Method,
    [string]$Path,
    [int]$ExpectedStatusCode,
    $Body = $null,
    [hashtable]$Headers = @{}
  )

  try {
    Invoke-ApiJson $Method $Path $Body $Headers | Out-Null
  } catch {
    $statusCode = $null
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $statusCode = [int]$_.Exception.Response.StatusCode
    }

    if ($statusCode -eq $ExpectedStatusCode) {
      return
    }

    throw
  }

  throw "Expected HTTP $ExpectedStatusCode for $Method $Path."
}

$health = Invoke-ApiJson "Get" "/healthz"
Assert-True ($health.status -eq "ok") "Control API health check failed"

if ($ApplySchema) {
  $headers = @{}
  if ($InternalToken) {
    $headers["X-XiaoLou-Internal-Token"] = $InternalToken
  }
  $schema = Invoke-ApiJson "Post" "/api/schema/apply" $null $headers
  Assert-True ($schema.applied -eq $true) "Schema apply endpoint did not confirm success"
}

$accountToken = New-ClientAuthProviderJwt `
  -Subject $OwnerId `
  -Permissions @("accounts:ensure", "jobs:create", "jobs:read")
$accountHeaders = @{ Authorization = "Bearer $accountToken" }
$account = Invoke-ApiJson "Post" "/api/accounts/ensure" @{
  accountOwnerType = "user"
  accountOwnerId = $OwnerId
  regionCode = "CN"
  currency = "CNY"
} $accountHeaders
Assert-True (-not [string]::IsNullOrWhiteSpace([string]$account.id)) "Provider assertion did not ensure an account"

$readOnlyToken = New-ClientAuthProviderJwt `
  -Subject $OwnerId `
  -Permissions @("accounts:ensure", "jobs:read")
Invoke-ApiExpectedStatus "Post" "/api/jobs" 403 @{
  accountOwnerType = "user"
  accountOwnerId = $OwnerId
  regionCode = "CN"
  currency = "CNY"
  lane = "account-media"
  providerRoute = "auth-provider-smoke"
  jobType = "verify"
  idempotencyKey = "$RunId-denied"
  payload = @{ scenario = "missing-jobs-create-permission" }
} @{ Authorization = "Bearer $readOnlyToken" }

$job = Invoke-ApiJson "Post" "/api/jobs" @{
  accountOwnerType = "user"
  accountOwnerId = $OwnerId
  regionCode = "CN"
  currency = "CNY"
  lane = "account-media"
  providerRoute = "auth-provider-smoke"
  jobType = "verify"
  idempotencyKey = "$RunId-created"
  payload = @{ scenario = "auth-provider-created" }
} $accountHeaders
Assert-True (-not [string]::IsNullOrWhiteSpace([string]$job.id)) "Provider assertion did not create a job"

$otherOwnerToken = New-ClientAuthProviderJwt `
  -Subject "$OwnerId-other" `
  -Permissions @("jobs:read")
Invoke-ApiExpectedStatus "Get" "/api/jobs?accountId=$($account.id)" 403 $null @{ Authorization = "Bearer $otherOwnerToken" }

[ordered]@{
  runId = $RunId
  ownerId = $OwnerId
  accountId = $account.id
  jobId = $job.id
  baseUrl = $BaseUrl
} | ConvertTo-Json -Depth 4
