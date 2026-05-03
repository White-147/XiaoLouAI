param(
  [string]$Root = "",
  [string]$Pwsh = "",
  [string]$DotnetExe = "",
  [string]$PythonExe = "",
  [switch]$UpdateExisting,
  [switch]$ValidateOnly,
  [switch]$AllowPlaceholderSecrets
)

$ErrorActionPreference = "Stop"

if (-not $Root) {
  $candidateRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
  $candidateParent = Split-Path -Parent $candidateRoot
  if ((Split-Path -Leaf $candidateRoot) -eq "app" -and (Split-Path -Leaf $candidateParent) -eq ".runtime") {
    $Root = $candidateRoot
  } else {
    $Root = Join-Path $candidateRoot ".runtime\app"
  }
}

$runtimeStateRoot = Split-Path -Parent $Root
$repoRoot = if ((Split-Path -Leaf $runtimeStateRoot) -eq ".runtime") {
  Split-Path -Parent $runtimeStateRoot
} else {
  $Root
}

if (-not $Pwsh) {
  $Pwsh = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
}

if (-not $DotnetExe) {
  if (Test-Path -LiteralPath "D:\soft\program\dotnet\dotnet.exe") {
    $DotnetExe = "D:\soft\program\dotnet\dotnet.exe"
  } else {
    throw "D:\soft\program\dotnet\dotnet.exe not found. Install .NET 8 to D: or pass -DotnetExe with an explicit D: path."
  }
}

if (-not $PythonExe) {
  if (Test-Path -LiteralPath "D:\soft\program\Python\Python312\python.exe") {
    $PythonExe = "D:\soft\program\Python\Python312\python.exe"
  } else {
    throw "D:\soft\program\Python\Python312\python.exe not found. Install Python to D: or pass -PythonExe with an explicit D: path."
  }
}

function Get-FirstHttpUrl {
  param([string]$Value)

  foreach ($entry in ($Value -split "[;,]")) {
    $trimmed = $entry.Trim()
    if ($trimmed -match "^https?://") {
      return $trimmed.TrimEnd("/")
    }
  }

  return "http://127.0.0.1:4100"
}

function Test-PlaceholderValue {
  param([string]$Value)

  if ($null -eq $Value) { return $true }
  $normalized = $Value.Trim()
  if (-not $normalized) { return $true }
  return $normalized -match "change-me|example\.invalid|(^|[^a-z0-9])(test|smoke|sample|fixture|dummy|placeholder)([^a-z0-9]|$)"
}

function Assert-ProductionEnvValue {
  param(
    [string]$Name,
    [string]$Value
  )

  if (-not $AllowPlaceholderSecrets -and (Test-PlaceholderValue $Value)) {
    throw "$Name is missing or still looks like a placeholder. Edit $envFile first, or pass -AllowPlaceholderSecrets only for isolated local smoke runs."
  }
}

function Assert-ProductionPaymentProviderBoundary {
  param(
    [string]$AllowedProviders,
    [string]$RequireAllowedProvider
  )

  if ($AllowPlaceholderSecrets) {
    return
  }

  if ($RequireAllowedProvider -notmatch "^(1|true|yes|on)$") {
    throw "PAYMENT_CALLBACK_REQUIRE_ALLOWED_PROVIDER must be true before registering production services."
  }

  $allowedProvidersUnsafe = [string]::IsNullOrWhiteSpace($AllowedProviders) `
      -or $AllowedProviders -match "(^|[,;])\s*\*\s*($|[,;])" `
      -or (Test-PlaceholderValue $AllowedProviders) `
      -or $AllowedProviders -match "(^|[,;])\s*(testpay|test|smoke|sample|fixture|dummy|placeholder)\s*($|[,;])"
  if ($allowedProvidersUnsafe) {
    throw "PAYMENT_CALLBACK_ALLOWED_PROVIDERS must be an explicit production provider list before registering production services."
  }
}

function Assert-ProductionPaymentGrayGate {
  param(
    [string]$RequireAccountGrant,
    [string]$AllowedAccountIds,
    [string]$AllowedAccountOwnerIds
  )

  if ($AllowPlaceholderSecrets) {
    return
  }

  if ($RequireAccountGrant -notmatch "^(1|true|yes|on)$") {
    throw "PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT must be true before registering production services."
  }

  $grantItems = New-Object System.Collections.Generic.List[string]
  foreach ($grantList in @($AllowedAccountIds, $AllowedAccountOwnerIds)) {
    foreach ($entry in ($grantList -split "[,;]")) {
      $trimmed = $entry.Trim()
      if ($trimmed) {
        $grantItems.Add($trimmed) | Out-Null
      }
    }
  }

  $combinedGrants = $grantItems -join ","
  $accountGateUnsafe = $grantItems.Count -eq 0 `
      -or $combinedGrants -match "(^|[,;])\s*\*\s*($|[,;])" `
      -or $combinedGrants -match "(^|[,;])\s*(user|organization):\*\s*($|[,;])" `
      -or (Test-PlaceholderValue $combinedGrants)
  if ($accountGateUnsafe) {
    throw "PAYMENT_CALLBACK_ALLOWED_ACCOUNT_IDS or PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS must contain explicit canary account grants before registering production services."
  }
}

function Assert-DDrivePath {
  param(
    [string]$Path,
    [string]$Name
  )

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if (-not $fullPath.StartsWith("D:\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "$Name must stay on D:, got: $fullPath"
  }
}

function Assert-RequiredFile {
  param(
    [string]$Path,
    [string]$Name
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$Name is missing: $Path"
  }
}

$envFile = Join-Path $Root "scripts\windows\.env.windows"
$loadEnv = Join-Path $Root "scripts\windows\load-env.ps1"
if (Test-Path -LiteralPath $loadEnv) {
  . $loadEnv -EnvFile $envFile
}

$cacheRoot = Join-Path $runtimeStateRoot "xiaolou-cache"
$tempRoot = Join-Path $runtimeStateRoot "xiaolou-temp"
$controlApiUrls = if ($env:CONTROL_API_URLS) { $env:CONTROL_API_URLS } else { "http://127.0.0.1:4100" }
$controlApiBaseUrl = if ($env:CONTROL_API_BASE_URL) { $env:CONTROL_API_BASE_URL.TrimEnd("/") } else { Get-FirstHttpUrl $controlApiUrls }
$dotnetRoot = Split-Path -Parent ([System.IO.Path]::GetFullPath($DotnetExe))
$connectionStringsPostgres = if ($env:ConnectionStrings__Postgres) { $env:ConnectionStrings__Postgres } else { "" }
$postgresConnectionString = if ($env:Postgres__ConnectionString) { $env:Postgres__ConnectionString } else { "" }
$postgresApplySchemaOnStartup = if ($env:POSTGRES_APPLY_SCHEMA_ON_STARTUP) { $env:POSTGRES_APPLY_SCHEMA_ON_STARTUP } elseif ($env:Postgres__ApplySchemaOnStartup) { $env:Postgres__ApplySchemaOnStartup } else { "0" }
$postgresMinimumPoolSize = if ($env:Postgres__MinimumPoolSize) { $env:Postgres__MinimumPoolSize } else { "" }
$postgresMaximumPoolSize = if ($env:Postgres__MaximumPoolSize) { $env:Postgres__MaximumPoolSize } else { "" }
$postgresTimeoutSeconds = if ($env:Postgres__TimeoutSeconds) { $env:Postgres__TimeoutSeconds } else { "" }
$postgresCommandTimeoutSeconds = if ($env:Postgres__CommandTimeoutSeconds) { $env:Postgres__CommandTimeoutSeconds } else { "" }
$postgresKeepAliveSeconds = if ($env:Postgres__KeepAliveSeconds) { $env:Postgres__KeepAliveSeconds } else { "" }
$pgBin = if ($env:PG_BIN) { $env:PG_BIN } else { "D:\soft\program\PostgreSQL\18\bin" }
$objectStorageProvider = if ($env:OBJECT_STORAGE_PROVIDER) { $env:OBJECT_STORAGE_PROVIDER } else { "local" }
$objectStorageBucket = if ($env:OBJECT_STORAGE_BUCKET) { $env:OBJECT_STORAGE_BUCKET } else { "xiaolou-staging" }
$objectStoragePublicBaseUrl = if ($env:OBJECT_STORAGE_PUBLIC_BASE_URL) { $env:OBJECT_STORAGE_PUBLIC_BASE_URL } else { "http://127.0.0.1:4100" }
$paymentWebhookSecret = if ($env:PAYMENT_WEBHOOK_SECRET) { $env:PAYMENT_WEBHOOK_SECRET } else { "change-me" }
$paymentCallbackAllowedProviders = if ($env:PAYMENT_CALLBACK_ALLOWED_PROVIDERS) { $env:PAYMENT_CALLBACK_ALLOWED_PROVIDERS } elseif ($env:Payments__AllowedProviders) { $env:Payments__AllowedProviders } else { "testpay,alipay,wechat" }
$paymentCallbackRequireAllowedProvider = if ($env:PAYMENT_CALLBACK_REQUIRE_ALLOWED_PROVIDER) { $env:PAYMENT_CALLBACK_REQUIRE_ALLOWED_PROVIDER } elseif ($env:Payments__RequireAllowedProvider) { $env:Payments__RequireAllowedProvider } else { "true" }
$paymentCallbackRequireAccountGrant = if ($env:PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT) { $env:PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT } elseif ($env:Payments__RequireAccountGrant) { $env:Payments__RequireAccountGrant } else { "false" }
$paymentCallbackAllowedAccountIds = if ($env:PAYMENT_CALLBACK_ALLOWED_ACCOUNT_IDS) { $env:PAYMENT_CALLBACK_ALLOWED_ACCOUNT_IDS } elseif ($env:Payments__AllowedAccountIds) { $env:Payments__AllowedAccountIds } else { "" }
$paymentCallbackAllowedAccountOwnerIds = if ($env:PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS) { $env:PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS } elseif ($env:Payments__AllowedAccountOwnerIds) { $env:Payments__AllowedAccountOwnerIds } else { "" }
$internalApiToken = if ($env:INTERNAL_API_TOKEN) { $env:INTERNAL_API_TOKEN } else { "change-me-internal-token" }
$clientApiToken = if ($env:CLIENT_API_TOKEN) { $env:CLIENT_API_TOKEN } else { "change-me-client-token" }
$clientApiTokenHeader = if ($env:CLIENT_API_TOKEN_HEADER) { $env:CLIENT_API_TOKEN_HEADER } else { "X-XiaoLou-Client-Token" }
$clientApiAuthProvider = if ($env:CLIENT_API_AUTH_PROVIDER) { $env:CLIENT_API_AUTH_PROVIDER } else { "" }
$clientApiAuthProviderSecret = if ($env:CLIENT_API_AUTH_PROVIDER_SECRET) { $env:CLIENT_API_AUTH_PROVIDER_SECRET } else { "" }
$clientApiAuthProviderIssuer = if ($env:CLIENT_API_AUTH_PROVIDER_ISSUER) { $env:CLIENT_API_AUTH_PROVIDER_ISSUER } else { "" }
$clientApiAuthProviderAudience = if ($env:CLIENT_API_AUTH_PROVIDER_AUDIENCE) { $env:CLIENT_API_AUTH_PROVIDER_AUDIENCE } else { "" }
$clientApiAuthProviderTtlSeconds = if ($env:CLIENT_API_AUTH_PROVIDER_TTL_SECONDS) { $env:CLIENT_API_AUTH_PROVIDER_TTL_SECONDS } else { "3600" }
$clientApiAuthProviderClockSkewSeconds = if ($env:CLIENT_API_AUTH_PROVIDER_CLOCK_SKEW_SECONDS) { $env:CLIENT_API_AUTH_PROVIDER_CLOCK_SKEW_SECONDS } else { "60" }
$clientApiRequireAuthProvider = if ($env:CLIENT_API_REQUIRE_AUTH_PROVIDER) { $env:CLIENT_API_REQUIRE_AUTH_PROVIDER } else { "false" }
$clientApiRequireAccountScope = if ($env:CLIENT_API_REQUIRE_ACCOUNT_SCOPE) { $env:CLIENT_API_REQUIRE_ACCOUNT_SCOPE } else { "true" }
$clientApiRequireConfiguredAccountGrant = if ($env:CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT) { $env:CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT } else { "false" }
$clientApiAllowedAccountIds = if ($env:CLIENT_API_ALLOWED_ACCOUNT_IDS) { $env:CLIENT_API_ALLOWED_ACCOUNT_IDS } else { "" }
$clientApiAllowedAccountOwnerIds = if ($env:CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS) { $env:CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS } else { "" }
$clientApiAllowedPermissions = if ($env:CLIENT_API_ALLOWED_PERMISSIONS) { $env:CLIENT_API_ALLOWED_PERMISSIONS } else { "accounts:ensure,jobs:create,jobs:read,jobs:cancel,wallet:read,media:read,media:write,projects:read,projects:write,canvas:read,canvas:write,create:read,create:write,identity:read,identity:write,organization:read,organization:write,api-center:read,api-center:write,admin:read,admin:write,enterprise-applications:read,enterprise-applications:write,playground:read,playground:write,toolbox:read,toolbox:write" }
$coreApiCompatReadOnly = if ($env:CORE_API_COMPAT_READ_ONLY) { $env:CORE_API_COMPAT_READ_ONLY } else { "1" }
$coreApiCompatPublicRouteAllowlist = if ($env:CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST) { $env:CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST } else { "GET /healthz;GET /api/windows-native/status" }
$coreApiCompatDisableTasksStream = if ($env:CORE_API_COMPAT_DISABLE_TASKS_STREAM) { $env:CORE_API_COMPAT_DISABLE_TASKS_STREAM } else { "1" }
$coreApiCompatEnableLegacyPaymentNotify = if ($env:CORE_API_COMPAT_ENABLE_LEGACY_PAYMENT_NOTIFY) { $env:CORE_API_COMPAT_ENABLE_LEGACY_PAYMENT_NOTIFY } else { "0" }
$coreApiPgPoolMax = if ($env:PGPOOL_MAX) { $env:PGPOOL_MAX } else { "2" }
$closedApiWorkerLane = if ($env:CLOSED_API_WORKER_LANE) { $env:CLOSED_API_WORKER_LANE } else { "account-media" }
$closedApiWorkerProviderRoute = if ($env:CLOSED_API_WORKER_PROVIDER_ROUTE) { $env:CLOSED_API_WORKER_PROVIDER_ROUTE } else { "closed-api" }
$localModelWorkerLane = if ($env:LOCAL_MODEL_WORKER_LANE) { $env:LOCAL_MODEL_WORKER_LANE } else { "account-media" }
$localModelWorkerProviderRoute = if ($env:LOCAL_MODEL_WORKER_PROVIDER_ROUTE) { $env:LOCAL_MODEL_WORKER_PROVIDER_ROUTE } else { "local-model" }
$localModelWorkerInternalToken = if ($env:LOCAL_MODEL_WORKER_INTERNAL_TOKEN) { $env:LOCAL_MODEL_WORKER_INTERNAL_TOKEN } else { $internalApiToken }

Assert-ProductionEnvValue "DATABASE_URL" $env:DATABASE_URL
Assert-ProductionEnvValue "PAYMENT_WEBHOOK_SECRET" $paymentWebhookSecret
Assert-ProductionPaymentProviderBoundary $paymentCallbackAllowedProviders $paymentCallbackRequireAllowedProvider
Assert-ProductionPaymentGrayGate $paymentCallbackRequireAccountGrant $paymentCallbackAllowedAccountIds $paymentCallbackAllowedAccountOwnerIds
Assert-ProductionEnvValue "INTERNAL_API_TOKEN" $internalApiToken
if ($clientApiRequireAuthProvider -match "^(1|true|yes|on)$") {
  Assert-ProductionEnvValue "CLIENT_API_AUTH_PROVIDER_SECRET" $clientApiAuthProviderSecret
} else {
  Assert-ProductionEnvValue "CLIENT_API_TOKEN" $clientApiToken
}

$machineEnv = [ordered]@{
  XIAOLOU_ROOT = $Root
  XIAOLOU_RUNTIME_ROOT = $runtimeStateRoot
  XIAOLOU_REPO_ROOT = $repoRoot
  DOTNET_EXE = $DotnetExe
  POWERSHELL_EXE = $Pwsh
  PYTHON_EXE = $PythonExe
  DOTNET_ROOT = $dotnetRoot
  CONTROL_API_DLL = "$Root\publish\control-api\XiaoLou.ControlApi.dll"
  CLOSED_API_WORKER_DLL = "$Root\publish\closed-api-worker\XiaoLou.ClosedApiWorker.dll"
  LOCAL_MODEL_WORKER_SERVICE_DLL = "$Root\publish\local-model-worker-service\XiaoLou.LocalModelWorkerService.dll"
  XIAOLOU_DATA_ROOT = "$Root\data"
  DATABASE_URL = $env:DATABASE_URL
  ConnectionStrings__Postgres = $connectionStringsPostgres
  Postgres__ConnectionString = $postgresConnectionString
  CONTROL_API_URLS = $controlApiUrls
  CONTROL_API_BASE_URL = $controlApiBaseUrl
  ASPNETCORE_URLS = $controlApiUrls
  POSTGRES_APPLY_SCHEMA_ON_STARTUP = $postgresApplySchemaOnStartup
  Postgres__ApplySchemaOnStartup = $postgresApplySchemaOnStartup
  Postgres__MinimumPoolSize = $postgresMinimumPoolSize
  Postgres__MaximumPoolSize = $postgresMaximumPoolSize
  Postgres__TimeoutSeconds = $postgresTimeoutSeconds
  Postgres__CommandTimeoutSeconds = $postgresCommandTimeoutSeconds
  Postgres__KeepAliveSeconds = $postgresKeepAliveSeconds
  PG_BIN = $pgBin
  ObjectStorage__Provider = $objectStorageProvider
  ObjectStorage__Bucket = $objectStorageBucket
  ObjectStorage__PublicBaseUrl = $objectStoragePublicBaseUrl
  Payments__WebhookSecret = $paymentWebhookSecret
  Payments__AllowedProviders = $paymentCallbackAllowedProviders
  Payments__RequireAllowedProvider = $paymentCallbackRequireAllowedProvider
  Payments__RequireAccountGrant = $paymentCallbackRequireAccountGrant
  Payments__AllowedAccountIds = $paymentCallbackAllowedAccountIds
  Payments__AllowedAccountOwnerIds = $paymentCallbackAllowedAccountOwnerIds
  InternalApi__Token = $internalApiToken
  LOCAL_CACHE_DIR = $cacheRoot
  LOCAL_TEMP_DIR = $tempRoot
  LOG_DIR = (Join-Path $runtimeStateRoot "xiaolou-logs")
  BACKUP_DIR = (Join-Path $runtimeStateRoot "xiaolou-backups")
  TMP = $tempRoot
  TEMP = $tempRoot
  DOTNET_CLI_HOME = (Join-Path $cacheRoot "dotnet-cli-home")
  DOTNET_BUNDLE_EXTRACT_BASE_DIR = (Join-Path $cacheRoot "dotnet-bundle")
  NUGET_PACKAGES = (Join-Path $cacheRoot "nuget\packages")
  NUGET_HTTP_CACHE_PATH = (Join-Path $cacheRoot "nuget\v3-cache")
  NUGET_PLUGINS_CACHE_PATH = (Join-Path $cacheRoot "nuget\plugins-cache")
  NUGET_SCRATCH = (Join-Path $tempRoot "NuGetScratch")
  NPM_CONFIG_CACHE = (Join-Path $cacheRoot "npm")
  NPM_CONFIG_PREFIX = (Join-Path $cacheRoot "node-global")
  PIP_CACHE_DIR = (Join-Path $cacheRoot "pip")
  PIP_CONFIG_FILE = (Join-Path $cacheRoot "pip\pip.ini")
  PYTHONPYCACHEPREFIX = (Join-Path $cacheRoot "python-pycache")
  PYTHONUSERBASE = (Join-Path $cacheRoot "python-userbase")
  UV_CACHE_DIR = (Join-Path $cacheRoot "uv")
  POETRY_CACHE_DIR = (Join-Path $cacheRoot "poetry")
  PIPENV_CACHE_DIR = (Join-Path $cacheRoot "pipenv")
  PLAYWRIGHT_BROWSERS_PATH = (Join-Path $cacheRoot "playwright-browsers")
  MAVEN_USER_HOME = (Join-Path $cacheRoot "maven\.m2")
  GRADLE_USER_HOME = (Join-Path $cacheRoot "gradle-user-home")
  COURSIER_CACHE = (Join-Path $cacheRoot "coursier-cache")
  SBT_OPTS = "-Dsbt.boot.directory=$(Join-Path $cacheRoot 'scala\sbt-boot') -Dsbt.global.base=$(Join-Path $cacheRoot 'scala\sbt-global') -Dsbt.ivy.home=$(Join-Path $cacheRoot 'scala\ivy2')"
  HF_HOME = (Join-Path $cacheRoot "huggingface")
  HF_HUB_CACHE = (Join-Path $cacheRoot "huggingface\hub")
  HUGGINGFACE_HUB_CACHE = (Join-Path $cacheRoot "huggingface\hub")
  TRANSFORMERS_CACHE = (Join-Path $cacheRoot "huggingface\transformers")
  TORCH_HOME = (Join-Path $cacheRoot "torch")
  MODELSCOPE_CACHE = (Join-Path $cacheRoot "modelscope")
  PAYMENT_WEBHOOK_SECRET = $paymentWebhookSecret
  PAYMENT_CALLBACK_ALLOWED_PROVIDERS = $paymentCallbackAllowedProviders
  PAYMENT_CALLBACK_REQUIRE_ALLOWED_PROVIDER = $paymentCallbackRequireAllowedProvider
  PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT = $paymentCallbackRequireAccountGrant
  PAYMENT_CALLBACK_ALLOWED_ACCOUNT_IDS = $paymentCallbackAllowedAccountIds
  PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS = $paymentCallbackAllowedAccountOwnerIds
  INTERNAL_API_TOKEN = $internalApiToken
  CLIENT_API_TOKEN = $clientApiToken
  CLIENT_API_TOKEN_HEADER = $clientApiTokenHeader
  ClientApi__Token = $clientApiToken
  ClientApi__TokenHeader = $clientApiTokenHeader
  CLIENT_API_AUTH_PROVIDER = $clientApiAuthProvider
  CLIENT_API_AUTH_PROVIDER_SECRET = $clientApiAuthProviderSecret
  CLIENT_API_AUTH_PROVIDER_ISSUER = $clientApiAuthProviderIssuer
  CLIENT_API_AUTH_PROVIDER_AUDIENCE = $clientApiAuthProviderAudience
  CLIENT_API_AUTH_PROVIDER_TTL_SECONDS = $clientApiAuthProviderTtlSeconds
  CLIENT_API_AUTH_PROVIDER_CLOCK_SKEW_SECONDS = $clientApiAuthProviderClockSkewSeconds
  ClientApi__AuthProvider = $clientApiAuthProvider
  ClientApi__AuthProviderSecret = $clientApiAuthProviderSecret
  ClientApi__AuthProviderIssuer = $clientApiAuthProviderIssuer
  ClientApi__AuthProviderAudience = $clientApiAuthProviderAudience
  ClientApi__AuthProviderClockSkewSeconds = $clientApiAuthProviderClockSkewSeconds
  CLIENT_API_REQUIRE_AUTH_PROVIDER = $clientApiRequireAuthProvider
  CLIENT_API_REQUIRE_ACCOUNT_SCOPE = $clientApiRequireAccountScope
  CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT = $clientApiRequireConfiguredAccountGrant
  CLIENT_API_ALLOWED_ACCOUNT_IDS = $clientApiAllowedAccountIds
  CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS = $clientApiAllowedAccountOwnerIds
  CLIENT_API_ALLOWED_PERMISSIONS = $clientApiAllowedPermissions
  ClientApi__RequireAuthProvider = $clientApiRequireAuthProvider
  ClientApi__RequireAccountScope = $clientApiRequireAccountScope
  ClientApi__RequireConfiguredAccountGrant = $clientApiRequireConfiguredAccountGrant
  ClientApi__AllowedAccountIds = $clientApiAllowedAccountIds
  ClientApi__AllowedAccountOwnerIds = $clientApiAllowedAccountOwnerIds
  ClientApi__AllowedPermissions = $clientApiAllowedPermissions
  Worker__Lane = $closedApiWorkerLane
  Worker__ProviderRoute = $closedApiWorkerProviderRoute
  LOCAL_MODEL_WORKER_LANE = $localModelWorkerLane
  LOCAL_MODEL_WORKER_PROVIDER_ROUTE = $localModelWorkerProviderRoute
  LOCAL_MODEL_WORKER_INTERNAL_TOKEN = $localModelWorkerInternalToken
  CORE_API_COMPAT_READ_ONLY = $coreApiCompatReadOnly
  CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST = $coreApiCompatPublicRouteAllowlist
  CORE_API_COMPAT_DISABLE_TASKS_STREAM = $coreApiCompatDisableTasksStream
  CORE_API_COMPAT_ENABLE_LEGACY_PAYMENT_NOTIFY = $coreApiCompatEnableLegacyPaymentNotify
  PGPOOL_MAX = $coreApiPgPoolMax
}

if (-not $ValidateOnly) {
  foreach ($entry in $machineEnv.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Machine")
  }
} else {
  Write-Host "ValidateOnly: skipping Machine environment updates."
}

foreach ($path in @(
  $Root,
  "$Root\data",
  $cacheRoot,
  $tempRoot,
  (Join-Path $runtimeStateRoot "xiaolou-logs"),
  (Join-Path $runtimeStateRoot "xiaolou-backups"),
  (Join-Path $runtimeStateRoot "xiaolou-inputs"),
  (Join-Path $runtimeStateRoot "xiaolou-replay"),
  (Join-Path $cacheRoot "pip")
)) {
  Assert-DDrivePath -Path $path -Name "runtime directory"
  New-Item -ItemType Directory -Force -Path $path | Out-Null
}

Assert-RequiredFile "$Root\publish\control-api\XiaoLou.ControlApi.dll" "Control API published DLL"
Assert-RequiredFile "$Root\publish\local-model-worker-service\XiaoLou.LocalModelWorkerService.dll" "Local model worker service published DLL"
Assert-RequiredFile "$Root\publish\closed-api-worker\XiaoLou.ClosedApiWorker.dll" "Closed API worker published DLL"
Assert-RequiredFile "$Root\scripts\windows\verify-postgres-backup.ps1" "PostgreSQL backup verification script"
Assert-RequiredFile "$Root\scripts\windows\restore-postgres.ps1" "PostgreSQL restore script"
Assert-RequiredFile "$Root\scripts\windows\verify-legacy-dump-cutover.ps1" "Legacy dump cutover verification script"

$services = @(
  @{
    Name = "XiaoLou-ControlApi"
    DisplayName = "XiaoLou Control API"
    BinaryPath = "`"$DotnetExe`" `"$Root\publish\control-api\XiaoLou.ControlApi.dll`""
    DependsOn = @()
  },
  @{
    Name = "XiaoLou-LocalModelWorker"
    DisplayName = "XiaoLou Local Model Worker"
    BinaryPath = "`"$DotnetExe`" `"$Root\publish\local-model-worker-service\XiaoLou.LocalModelWorkerService.dll`""
    DependsOn = @("XiaoLou-ControlApi")
  },
  @{
    Name = "XiaoLou-ClosedApiWorker"
    DisplayName = "XiaoLou Closed API Worker"
    BinaryPath = "`"$DotnetExe`" `"$Root\publish\closed-api-worker\XiaoLou.ClosedApiWorker.dll`""
    DependsOn = @("XiaoLou-ControlApi")
  }
)

if (-not $ValidateOnly) {
  foreach ($svc in $services) {
    $binaryPath = $svc.BinaryPath
    if (Get-Service -Name $svc.Name -ErrorAction SilentlyContinue) {
      if ($UpdateExisting) {
        sc.exe config $svc.Name binPath= $binaryPath start= auto | Out-Null
        if ($svc.DependsOn.Count -gt 0) {
          sc.exe config $svc.Name depend= ($svc.DependsOn -join "/") | Out-Null
        }
        sc.exe failure $svc.Name reset= 60 actions= restart/60000/restart/60000/""/60000 | Out-Null
        Write-Host "Updated service: $($svc.Name)"
      } else {
        Write-Host "Service already exists: $($svc.Name). Pass -UpdateExisting to update its command line."
      }

      continue
    }

    $serviceParams = @{
      Name = $svc.Name
      DisplayName = $svc.DisplayName
      BinaryPathName = $binaryPath
      StartupType = "Automatic"
    }
    if ($svc.DependsOn.Count -gt 0) {
      $serviceParams.DependsOn = $svc.DependsOn
    }
    New-Service @serviceParams

    sc.exe failure $svc.Name reset= 60 actions= restart/60000/restart/60000/""/60000 | Out-Null
    Write-Host "Created service: $($svc.Name)"
  }
} else {
  Write-Host "ValidateOnly: skipping service create/update."
}

foreach ($svc in $services) {
  $registered = Get-CimInstance Win32_Service -Filter "Name='$($svc.Name)'"
  if (-not $registered) {
    if ($ValidateOnly) {
      Write-Host "ValidateOnly: service is not registered yet: $($svc.Name)"
      continue
    } else {
      throw "Service registration failed: $($svc.Name)"
    }
  }

  if ($registered.StartMode -ne "Auto") {
    throw "Service $($svc.Name) must be Automatic, got $($registered.StartMode)"
  }

  $expectedPath = $svc.BinaryPath.Replace('"', '')
  $actualPath = ([string]$registered.PathName).Replace('"', '')
  if ($actualPath -ne $expectedPath) {
    throw "Service $($svc.Name) binPath mismatch. Expected '$expectedPath', got '$actualPath'"
  }

  Write-Host "Verified service: $($svc.Name) ($($registered.State)/$($registered.StartMode))"
}
