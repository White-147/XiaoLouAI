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
  [switch]$StrictProduction,
  [string]$P0AccountOwnerId = "",
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

function Add-ProductionFinding {
  param(
    [string]$Name,
    [string]$Status,
    [string]$Detail
  )

  if ($StrictProduction) {
    Add-Item $blockers $Name "failed" $Detail
  } else {
    Add-Item $warnings $Name $Status $Detail
  }
}

function Test-PlaceholderValue {
  param([string]$Value)

  if ($null -eq $Value) { return $true }
  $normalized = $Value.Trim()
  if (-not $normalized) { return $true }
  if ($normalized -match "change-me|example\.invalid") { return $true }
  if ($StrictProduction -and $normalized -match "(^|[^a-z0-9])(test|smoke|sample|fixture|dummy|placeholder|staging)([^a-z0-9]|$)") { return $true }
  return $normalized -in @(
    "change-me",
    "change-me-internal-token",
    "change-me-client-token",
    "https://object-storage.example.invalid"
  )
}

function Test-TruthyEnvValue {
  param([string]$Value)
  return $Value -match "^(1|true|yes|on)$"
}

function Test-CsvContainsWildcard {
  param([string]$Value)
  if (-not $Value) { return $false }
  foreach ($entry in ($Value -split "[,;]")) {
    if ($entry.Trim() -eq "*") {
      return $true
    }
  }
  return $false
}

function Get-FirstNonBlank {
  param([string[]]$Values)
  foreach ($value in $Values) {
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return $value
    }
  }

  return $null
}

function Test-CoreApiCompatAllowlistSafe {
  param([string]$Value)
  if (-not $Value) { return $false }
  $normalized = ($Value -split "[;,\r\n]+" | ForEach-Object { $_.Trim().ToUpperInvariant() } | Where-Object { $_ }) -join ";"
  return $normalized -eq "GET /HEALTHZ;GET /API/WINDOWS-NATIVE/STATUS"
}

function Get-FirstConfiguredOwnerId {
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

function Get-FirstConfiguredPaymentCallbackOwnerId {
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
  "$SourceRoot\scripts\windows\verify-client-auth-provider.ps1",
  "$SourceRoot\scripts\windows\verify-core-api-compat-readonly.ps1",
  "$SourceRoot\scripts\windows\verify-legacy-canonical-projection.ps1",
  "$SourceRoot\scripts\windows\verify-legacy-canonical-projection-gate.ps1",
  "$SourceRoot\scripts\windows\project-legacy-to-canonical.ps1",
  "$SourceRoot\scripts\windows\verify-p2-cutover-audit.ps1",
  "$SourceRoot\scripts\windows\verify-frontend-legacy-dependencies.ps1",
  "$SourceRoot\scripts\windows\normalize-payment-provider-capture.ps1",
  "$SourceRoot\scripts\windows\verify-payment-provider-normalizers.ps1",
  "$SourceRoot\scripts\windows\payment-provider-native-adapter.js",
  "$SourceRoot\scripts\windows\adapt-native-payment-provider-capture.ps1",
  "$SourceRoot\scripts\windows\verify-payment-provider-native-adapters.ps1",
  "$SourceRoot\scripts\windows\verify-payment-provider-boundary.ps1",
  "$SourceRoot\scripts\windows\complete-control-api-publish-restart-p0.ps1",
  "$SourceRoot\scripts\windows\verify-windows-service-ops-drill.ps1",
  "$SourceRoot\scripts\windows\restore-runtime-snapshot.ps1",
  "$SourceRoot\scripts\windows\audit-wallet-ledger.ps1",
  "$SourceRoot\scripts\windows\rebuild-wallet-balances-from-ledger.ps1",
  "$SourceRoot\deploy\windows\legacy-canonical-projection-checklist.md",
  "$SourceRoot\deploy\windows\payment-provider-replay-checklist.md"
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

  $clientApiAuthProvider = Get-EnvFileValue $runtimeEnv "CLIENT_API_AUTH_PROVIDER"
  $clientApiAuthProviderSecret = Get-EnvFileValue $runtimeEnv "CLIENT_API_AUTH_PROVIDER_SECRET"
  $clientApiRequireAuthProvider = Get-EnvFileValue $runtimeEnv "CLIENT_API_REQUIRE_AUTH_PROVIDER"
  $authProviderConfigured = $clientApiAuthProvider -match "^(hs256-jwt|jwt-hs256)$" -and -not (Test-PlaceholderValue $clientApiAuthProviderSecret)
  $authProviderRequired = Test-TruthyEnvValue $clientApiRequireAuthProvider

  foreach ($name in @(
    "DATABASE_URL",
    "PAYMENT_WEBHOOK_SECRET",
    "INTERNAL_API_TOKEN",
    "OBJECT_STORAGE_PROVIDER",
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_PUBLIC_BASE_URL"
  )) {
    $value = Get-EnvFileValue $runtimeEnv $name
    if (Test-PlaceholderValue $value) {
      Add-ProductionFinding "runtime-env-placeholder" "warning" "$name still looks like a placeholder in $runtimeEnv"
    } else {
      Add-Item $checks "runtime-env-value" "ok" "$name is configured"
    }
  }

  $paymentCallbackAllowedProviders = Get-FirstNonBlank @(
    (Get-EnvFileValue $runtimeEnv "PAYMENT_CALLBACK_ALLOWED_PROVIDERS"),
    (Get-EnvFileValue $runtimeEnv "Payments__AllowedProviders")
  )
  $paymentCallbackRequireAllowedProvider = Get-FirstNonBlank @(
    (Get-EnvFileValue $runtimeEnv "PAYMENT_CALLBACK_REQUIRE_ALLOWED_PROVIDER"),
    (Get-EnvFileValue $runtimeEnv "Payments__RequireAllowedProvider")
  )
  $paymentCallbackRequireAccountGrant = Get-FirstNonBlank @(
    (Get-EnvFileValue $runtimeEnv "PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT"),
    (Get-EnvFileValue $runtimeEnv "Payments__RequireAccountGrant")
  )
  $paymentCallbackAllowedAccountIds = Get-FirstNonBlank @(
    (Get-EnvFileValue $runtimeEnv "PAYMENT_CALLBACK_ALLOWED_ACCOUNT_IDS"),
    (Get-EnvFileValue $runtimeEnv "Payments__AllowedAccountIds")
  )
  $paymentCallbackAllowedAccountOwnerIds = Get-FirstNonBlank @(
    (Get-EnvFileValue $runtimeEnv "PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS"),
    (Get-EnvFileValue $runtimeEnv "Payments__AllowedAccountOwnerIds")
  )
  $paymentCallbackProviderUnsafe = (Test-CsvContainsWildcard $paymentCallbackAllowedProviders) `
      -or (Test-PlaceholderValue $paymentCallbackAllowedProviders) `
      -or ($StrictProduction -and $paymentCallbackAllowedProviders -match "(^|[,;])\s*(testpay|test|smoke|sample|fixture|dummy|placeholder)\s*($|[,;])")
  if (-not (Test-TruthyEnvValue $paymentCallbackRequireAllowedProvider)) {
    Add-ProductionFinding "payment-provider-boundary" "warning" "Set PAYMENT_CALLBACK_REQUIRE_ALLOWED_PROVIDER=true before production cutover."
  } elseif ([string]::IsNullOrWhiteSpace($paymentCallbackAllowedProviders)) {
    Add-ProductionFinding "payment-provider-boundary" "warning" "Set PAYMENT_CALLBACK_ALLOWED_PROVIDERS to explicit provider ids such as alipay,wechat before production cutover."
  } elseif ($paymentCallbackProviderUnsafe) {
    Add-ProductionFinding "payment-provider-boundary" "warning" "Avoid wildcard, smoke, sample, fixture, or test payment callback providers in production cutover: $paymentCallbackAllowedProviders"
  } else {
    Add-Item $checks "payment-provider-boundary" "ok" $paymentCallbackAllowedProviders
  }

  $paymentAccountGrantValues = @($paymentCallbackAllowedAccountIds, $paymentCallbackAllowedAccountOwnerIds) `
    | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  $paymentAccountGrantJoined = $paymentAccountGrantValues -join ","
  $paymentAccountGrantUnsafe = (Test-CsvContainsWildcard $paymentAccountGrantJoined) `
      -or ($paymentAccountGrantJoined -match "(^|[,;])\s*(user|organization):\*\s*($|[,;])") `
      -or ($StrictProduction -and (Test-PlaceholderValue $paymentAccountGrantJoined))
  if (-not (Test-TruthyEnvValue $paymentCallbackRequireAccountGrant)) {
    Add-ProductionFinding "payment-gray-account-gate" "warning" "Set PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT=true before routing public provider callbacks."
  } elseif ($paymentAccountGrantValues.Count -eq 0) {
    Add-ProductionFinding "payment-gray-account-gate" "warning" "Set PAYMENT_CALLBACK_ALLOWED_ACCOUNT_IDS or PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS to the canary account(s) before provider gray release."
  } elseif ($paymentAccountGrantUnsafe) {
    Add-ProductionFinding "payment-gray-account-gate" "warning" "Avoid wildcard, smoke, sample, fixture, or placeholder account grants for provider gray release: $paymentAccountGrantJoined"
  } else {
    Add-Item $checks "payment-gray-account-gate" "ok" $paymentAccountGrantJoined
  }

  $clientApiToken = Get-EnvFileValue $runtimeEnv "CLIENT_API_TOKEN"
  if ((Test-PlaceholderValue $clientApiToken) -and -not $authProviderConfigured) {
    Add-ProductionFinding "runtime-env-placeholder" "warning" "CLIENT_API_TOKEN still looks like a placeholder in $runtimeEnv and no client auth provider is configured."
  } elseif (-not (Test-PlaceholderValue $clientApiToken)) {
    Add-Item $checks "runtime-env-value" "ok" "CLIENT_API_TOKEN is configured"
  }

  if ($clientApiAuthProvider) {
    if ($clientApiAuthProvider -notmatch "^(hs256-jwt|jwt-hs256)$") {
      Add-ProductionFinding "client-api-auth-provider" "warning" "Unsupported CLIENT_API_AUTH_PROVIDER '$clientApiAuthProvider'. Currently supported: hs256-jwt."
    } elseif (Test-PlaceholderValue $clientApiAuthProviderSecret) {
      Add-ProductionFinding "client-api-auth-provider" "warning" "Set CLIENT_API_AUTH_PROVIDER_SECRET before enabling CLIENT_API_AUTH_PROVIDER=$clientApiAuthProvider."
    } else {
      Add-Item $checks "client-api-auth-provider" "ok" "CLIENT_API_AUTH_PROVIDER=$clientApiAuthProvider"
    }
  }

  if ($authProviderConfigured -and -not $authProviderRequired) {
    Add-ProductionFinding "client-api-auth-provider-required" "warning" "Set CLIENT_API_REQUIRE_AUTH_PROVIDER=true when cutting over to provider-signed client assertions."
  } elseif ($authProviderRequired -and -not $authProviderConfigured) {
    Add-ProductionFinding "client-api-auth-provider-required" "warning" "CLIENT_API_REQUIRE_AUTH_PROVIDER=true requires CLIENT_API_AUTH_PROVIDER=hs256-jwt and CLIENT_API_AUTH_PROVIDER_SECRET."
  } elseif ($authProviderRequired) {
    Add-Item $checks "client-api-auth-provider-required" "ok" "CLIENT_API_REQUIRE_AUTH_PROVIDER=$clientApiRequireAuthProvider"
  }

  $requireAccountScope = Get-EnvFileValue $runtimeEnv "CLIENT_API_REQUIRE_ACCOUNT_SCOPE"
  if (-not (Test-TruthyEnvValue $requireAccountScope)) {
    Add-ProductionFinding "client-api-account-scope" "warning" "Set CLIENT_API_REQUIRE_ACCOUNT_SCOPE=true before production cutover."
  } else {
    Add-Item $checks "client-api-account-scope" "ok" "CLIENT_API_REQUIRE_ACCOUNT_SCOPE=$requireAccountScope"
  }

  $requireConfiguredGrant = Get-EnvFileValue $runtimeEnv "CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT"
  $configuredGrantRequired = Test-TruthyEnvValue $requireConfiguredGrant
  if (-not $authProviderRequired -and -not $configuredGrantRequired) {
    Add-ProductionFinding "client-api-configured-grants" "warning" "Set CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT=true before production cutover, after CLIENT_API_ALLOWED_ACCOUNT_IDS or CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS are configured."
  } elseif ($configuredGrantRequired) {
    Add-Item $checks "client-api-configured-grants" "ok" "CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT=$requireConfiguredGrant"
  } else {
    Add-Item $checks "client-api-configured-grants" "delegated" "Provider-signed client assertions are required; configured account grants may remain as an optional gray-release upper bound."
  }

  $accountGrants = @(
    (Get-EnvFileValue $runtimeEnv "CLIENT_API_ALLOWED_ACCOUNT_IDS")
    (Get-EnvFileValue $runtimeEnv "CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS")
  ) | Where-Object { $_ }
  if ($accountGrants.Count -eq 0 -and ($configuredGrantRequired -or -not $authProviderRequired)) {
    Add-ProductionFinding "client-api-account-grants" "warning" "Configure CLIENT_API_ALLOWED_ACCOUNT_IDS or CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS before strict production cutover."
  }
  foreach ($grant in $accountGrants) {
    if (Test-CsvContainsWildcard $grant -or $grant -match "(^|[,;])\s*(user|organization):\*\s*($|[,;])") {
      Add-ProductionFinding "client-api-account-grants" "warning" "Avoid wildcard account grants in production cutover: $grant"
    }
  }

  $clientApiPermissions = Get-EnvFileValue $runtimeEnv "CLIENT_API_ALLOWED_PERMISSIONS"
  if (-not $clientApiPermissions -or (Test-CsvContainsWildcard $clientApiPermissions)) {
    Add-ProductionFinding "client-api-permissions" "warning" "Set CLIENT_API_ALLOWED_PERMISSIONS to explicit public permissions before production cutover."
  } elseif ($clientApiPermissions -match "(^|[,;])\s*(jobs|media):\*\s*($|[,;])") {
    Add-ProductionFinding "client-api-permissions" "warning" "Avoid wildcard permission families such as jobs:* or media:* in production cutover."
  } else {
    Add-Item $checks "client-api-permissions" "ok" $clientApiPermissions
  }

  $coreApiCompatReadOnly = Get-EnvFileValue $runtimeEnv "CORE_API_COMPAT_READ_ONLY"
  if (-not (Test-TruthyEnvValue $coreApiCompatReadOnly)) {
    Add-ProductionFinding "core-api-read-only" "warning" "Set CORE_API_COMPAT_READ_ONLY=1 for any legacy core-api compatibility process."
  } else {
    Add-Item $checks "core-api-read-only" "ok" "CORE_API_COMPAT_READ_ONLY=$coreApiCompatReadOnly"
  }

  $coreApiAllowlist = Get-EnvFileValue $runtimeEnv "CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST"
  if (-not (Test-CoreApiCompatAllowlistSafe $coreApiAllowlist)) {
    Add-ProductionFinding "core-api-route-allowlist" "warning" "Keep CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST at exactly 'GET /healthz;GET /api/windows-native/status' for production cutover."
  } else {
    Add-Item $checks "core-api-route-allowlist" "ok" $coreApiAllowlist
  }
} else {
  Add-ProductionFinding "runtime-env" "missing" "$runtimeEnv will be created on publish"
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
  foreach ($name in @(
    "INTERNAL_API_TOKEN",
    "CLIENT_API_TOKEN",
    "CLIENT_API_TOKEN_HEADER",
    "PAYMENT_WEBHOOK_SECRET",
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
    "PAYMENT_CALLBACK_ALLOWED_ACCOUNT_IDS",
    "PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS",
    "PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT"
  )) {
    $value = Get-EnvFileValue $runtimeEnv $name
    if ($value) {
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }

  if (-not $env:INTERNAL_API_TOKEN) {
    Add-Item $blockers "p0" "missing-env" "INTERNAL_API_TOKEN must be set before running P0 against a protected control plane"
  } else {
    $env:CONTROL_API_BASE_URL = $BaseUrl
    $p0OwnerId = $P0AccountOwnerId
    if (-not $p0OwnerId) {
      $p0OwnerId = Get-FirstConfiguredPaymentCallbackOwnerId ([Environment]::GetEnvironmentVariable("PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS", "Process"))
    }
    if (-not $p0OwnerId) {
      $p0OwnerId = Get-FirstConfiguredOwnerId ([Environment]::GetEnvironmentVariable("CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS", "Process"))
    }

    $p0Args = @{
      BaseUrl = $BaseUrl
      DotnetExe = $DotnetExe
      PythonExe = $PythonExe
    }
    if ($p0OwnerId) {
      $p0Args.AccountOwnerId = $p0OwnerId
      Add-Item $checks "p0-account-owner" "ok" $p0OwnerId
    }

    & "$SourceRoot\scripts\windows\verify-control-plane-p0.ps1" @p0Args
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
  strict_production = [bool]$StrictProduction
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
