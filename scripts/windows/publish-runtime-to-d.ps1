param(
  [string]$SourceRoot = "",
  [string]$RuntimeRoot = "",
  [string]$DotnetExe = "",
  [string]$NpmCmd = "",
  [string]$PythonExe = "",
  [switch]$SkipFrontend,
  [switch]$SkipDotnetPublish,
  [switch]$SkipRollbackSnapshot,
  [switch]$SuppressRegistrationHint
)

$ErrorActionPreference = "Stop"

if (-not $SourceRoot) {
  $SourceRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
}

if (-not $RuntimeRoot) {
  $RuntimeRoot = Join-Path $SourceRoot ".runtime\app"
}

& "$SourceRoot\scripts\windows\load-env.ps1" -EnvFile "$SourceRoot\scripts\windows\.env.windows"

if (-not $DotnetExe) {
  if (Test-Path -LiteralPath "D:\soft\program\dotnet\dotnet.exe") {
    $DotnetExe = "D:\soft\program\dotnet\dotnet.exe"
  } else {
    throw "D:\soft\program\dotnet\dotnet.exe not found. Install .NET 8 to D: or pass -DotnetExe with an explicit D: path."
  }
}

if (-not $NpmCmd) {
  if (Test-Path -LiteralPath "D:\soft\program\nodejs\npm.cmd") {
    $NpmCmd = "D:\soft\program\nodejs\npm.cmd"
  } else {
    throw "D:\soft\program\nodejs\npm.cmd not found. Install Node.js to D: or pass -NpmCmd with an explicit D: path."
  }
}

if (-not $PythonExe) {
  if (Test-Path -LiteralPath "D:\soft\program\Python\Python312\python.exe") {
    $PythonExe = "D:\soft\program\Python\Python312\python.exe"
  } else {
    throw "D:\soft\program\Python\Python312\python.exe not found. Install Python to D: or pass -PythonExe with an explicit D: path."
  }
}

foreach ($toolPath in @($DotnetExe, $NpmCmd, $PythonExe)) {
  $fullToolPath = [System.IO.Path]::GetFullPath($toolPath)
  if (-not $fullToolPath.StartsWith("D:\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use non-D: project tool path: $fullToolPath"
  }
}

$dotnetRoot = Split-Path -Parent ([System.IO.Path]::GetFullPath($DotnetExe))
$nodeExe = Join-Path (Split-Path -Parent ([System.IO.Path]::GetFullPath($NpmCmd))) "node.exe"

[Environment]::SetEnvironmentVariable("DOTNET_EXE", $DotnetExe, "Process")
[Environment]::SetEnvironmentVariable("PYTHON_EXE", $PythonExe, "Process")
[Environment]::SetEnvironmentVariable("NPM_CMD", $NpmCmd, "Process")
[Environment]::SetEnvironmentVariable("DOTNET_CLI_USE_MSBUILD_SERVER", "0", "Process")
[Environment]::SetEnvironmentVariable("MSBUILDDISABLENODEREUSE", "1", "Process")

$runtimeStateRoot = Split-Path -Parent $RuntimeRoot
$rollbackSnapshotRoot = Join-Path $runtimeStateRoot "xiaolou-backups\runtime-snapshots"
New-Item -ItemType Directory -Force -Path $rollbackSnapshotRoot | Out-Null

function Copy-RuntimeSnapshotDirectory {
  param(
    [string]$RelativePath,
    [string]$SnapshotPath,
    [string[]]$ExcludeNames = @()
  )

  $source = Join-Path $RuntimeRoot $RelativePath
  if (-not (Test-Path -LiteralPath $source)) {
    return $null
  }

  $destination = Join-Path $SnapshotPath $RelativePath
  New-Item -ItemType Directory -Force -Path $destination | Out-Null

  foreach ($item in Get-ChildItem -LiteralPath $source -Force) {
    if ($ExcludeNames -contains $item.Name) {
      continue
    }

    Copy-Item -LiteralPath $item.FullName -Destination $destination -Recurse -Force
  }

  return [ordered]@{
    relative_path = $RelativePath
    source = $source
    destination = $destination
    excluded_names = $ExcludeNames
  }
}

if (-not $SkipRollbackSnapshot) {
  $snapshotItems = New-Object System.Collections.Generic.List[object]
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $snapshotPath = Join-Path $rollbackSnapshotRoot "runtime-$stamp"
  New-Item -ItemType Directory -Force -Path $snapshotPath | Out-Null

  foreach ($item in @(
    [ordered]@{ path = "publish\control-api"; exclude = @() },
    [ordered]@{ path = "publish\closed-api-worker"; exclude = @() },
    [ordered]@{ path = "publish\local-model-worker-service"; exclude = @() },
    [ordered]@{ path = "XIAOLOU-main\dist"; exclude = @() },
    [ordered]@{ path = "scripts\windows"; exclude = @(".env.windows") },
    [ordered]@{ path = "docs"; exclude = @() },
    [ordered]@{ path = "deploy"; exclude = @() },
    [ordered]@{ path = "services\local-model-worker"; exclude = @() }
  )) {
    $copied = Copy-RuntimeSnapshotDirectory `
      -RelativePath $item.path `
      -SnapshotPath $snapshotPath `
      -ExcludeNames $item.exclude
    if ($null -ne $copied) {
      $snapshotItems.Add($copied) | Out-Null
    }
  }

  if ($snapshotItems.Count -gt 0) {
    $manifest = [ordered]@{
      created_at_utc = [DateTimeOffset]::UtcNow.ToString("O")
      source_root = $SourceRoot
      runtime_root = $RuntimeRoot
      snapshot_path = $snapshotPath
      excluded_secret_files = @("scripts\windows\.env.windows")
      items = $snapshotItems
    }
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $snapshotPath "snapshot-manifest.json") -Encoding UTF8
    Write-Host "Created rollback snapshot at $snapshotPath"
  } else {
    Remove-Item -LiteralPath $snapshotPath -Force -ErrorAction SilentlyContinue
    Write-Host "No existing runtime artifacts found; rollback snapshot was skipped."
  }
}

$paths = @(
  $RuntimeRoot,
  "$RuntimeRoot\publish\control-api",
  "$RuntimeRoot\publish\closed-api-worker",
  "$RuntimeRoot\publish\local-model-worker-service",
  "$RuntimeRoot\scripts\windows",
  "$RuntimeRoot\docs",
  "$RuntimeRoot\services\local-model-worker",
  "$RuntimeRoot\XIAOLOU-main\dist",
  "$runtimeStateRoot\xiaolou-cache",
  "$runtimeStateRoot\xiaolou-temp",
  "$runtimeStateRoot\xiaolou-logs",
  "$runtimeStateRoot\xiaolou-backups",
  $rollbackSnapshotRoot,
  "$runtimeStateRoot\xiaolou-inputs",
  "$runtimeStateRoot\xiaolou-replay"
)

foreach ($path in $paths) {
  New-Item -ItemType Directory -Force -Path $path | Out-Null
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

foreach ($path in @($RuntimeRoot, $runtimeStateRoot, "$runtimeStateRoot\xiaolou-logs", "$runtimeStateRoot\xiaolou-backups", "$runtimeStateRoot\xiaolou-temp", "$runtimeStateRoot\xiaolou-cache")) {
  Assert-DDrivePath -Path $path -Name "runtime path"
}

function Invoke-NativeTool {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$Name
  )

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # Windows PowerShell can surface native stderr lines as NativeCommandError
    # records. npm writes warnings to stderr even when it exits successfully, so
    # keep the actual process exit code as the source of truth here.
    $script:ErrorActionPreference = "Continue"
    & $FilePath @Arguments
    $exitCode = $LASTEXITCODE
  } finally {
    $script:ErrorActionPreference = $previousErrorActionPreference
  }

  if ($exitCode -ne 0) {
    throw "$Name failed with exit code $exitCode"
  }
}

function Invoke-DotnetBuildServerShutdown {
  param([int]$TimeoutSeconds = 30)

  $process = $null
  try {
    $process = Start-Process -FilePath $DotnetExe -ArgumentList @("build-server", "shutdown") -WindowStyle Hidden -PassThru
    Wait-Process -Id $process.Id -Timeout $TimeoutSeconds -ErrorAction SilentlyContinue
    $process.Refresh()
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      Write-Warning "dotnet build-server shutdown timed out after $TimeoutSeconds seconds; process was stopped."
      return
    }

    if ($process.ExitCode -ne 0) {
      Write-Warning "dotnet build-server shutdown exited with code $($process.ExitCode)"
    }
  } catch {
    Write-Warning "dotnet build-server shutdown failed: $($_.Exception.Message)"
  }
}

if (-not $SkipDotnetPublish) {
  Push-Location "$SourceRoot\control-plane-dotnet"
  try {
    Invoke-NativeTool -FilePath $DotnetExe -Arguments @("restore", ".\XiaoLou.ControlPlane.sln") -Name "dotnet restore"

    Invoke-NativeTool -FilePath $DotnetExe -Arguments @("publish", ".\src\XiaoLou.ControlApi\XiaoLou.ControlApi.csproj", "-c", "Release", "-o", "$RuntimeRoot\publish\control-api", "-p:UseSharedCompilation=false") -Name "dotnet publish ControlApi"

    Invoke-NativeTool -FilePath $DotnetExe -Arguments @("publish", ".\src\XiaoLou.ClosedApiWorker\XiaoLou.ClosedApiWorker.csproj", "-c", "Release", "-o", "$RuntimeRoot\publish\closed-api-worker", "-p:UseSharedCompilation=false") -Name "dotnet publish ClosedApiWorker"

    Invoke-NativeTool -FilePath $DotnetExe -Arguments @("publish", ".\src\XiaoLou.LocalModelWorkerService\XiaoLou.LocalModelWorkerService.csproj", "-c", "Release", "-o", "$RuntimeRoot\publish\local-model-worker-service", "-p:UseSharedCompilation=false") -Name "dotnet publish LocalModelWorkerService"
  } finally {
    Invoke-DotnetBuildServerShutdown
    Pop-Location
  }
}

if (-not $SkipFrontend) {
  Push-Location "$SourceRoot\XIAOLOU-main"
  try {
    Invoke-NativeTool -FilePath $NpmCmd -Arguments @("ci") -Name "npm ci"

    Invoke-NativeTool -FilePath $NpmCmd -Arguments @("run", "build") -Name "npm run build"
  } finally {
    Pop-Location
  }

  Copy-Item -Path "$SourceRoot\XIAOLOU-main\dist\*" -Destination "$RuntimeRoot\XIAOLOU-main\dist" -Recurse -Force
}

Copy-Item -Path "$SourceRoot\scripts\windows\*" -Destination "$RuntimeRoot\scripts\windows" -Recurse -Force
if (Test-Path -LiteralPath "$SourceRoot\docs") {
  Copy-Item -Path "$SourceRoot\docs" -Destination "$RuntimeRoot" -Recurse -Force
}
Copy-Item -Path "$SourceRoot\deploy" -Destination "$RuntimeRoot" -Recurse -Force
Copy-Item -Path "$SourceRoot\services\local-model-worker\*" -Destination "$RuntimeRoot\services\local-model-worker" -Recurse -Force

if (-not (Test-Path -LiteralPath "$RuntimeRoot\scripts\windows\.env.windows")) {
  Copy-Item -LiteralPath "$RuntimeRoot\scripts\windows\.env.windows.example" -Destination "$RuntimeRoot\scripts\windows\.env.windows"
}

$envFile = "$RuntimeRoot\scripts\windows\.env.windows"
$envText = Get-Content -LiteralPath $envFile -Raw
function Get-EnvFileValue {
  param(
    [string]$Text,
    [string]$Name
  )

  foreach ($line in ($Text -split "\r?\n")) {
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

function Resolve-EnvValue {
  param(
    [string]$Text,
    [string]$Name,
    [string]$DefaultValue = ""
  )

  $processValue = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ($processValue) {
    return $processValue
  }

  $existing = Get-EnvFileValue -Text $Text -Name $Name
  if ($null -ne $existing) {
    return $existing
  }

  return $DefaultValue
}

function Merge-DelimitedValues {
  param(
    [string]$CurrentValue,
    [string]$RequiredValue
  )

  $items = New-Object System.Collections.Generic.List[string]
  foreach ($value in @($CurrentValue, $RequiredValue)) {
    foreach ($entry in ($value -split "[,;\s]+")) {
      $trimmed = $entry.Trim()
      if (-not $trimmed) {
        continue
      }

      if (-not $items.Contains($trimmed)) {
        $items.Add($trimmed) | Out-Null
      }
    }
  }

  return ($items.ToArray() -join ",")
}

function Set-EnvFileValue {
  param(
    [string]$Text,
    [string]$Name,
    [string]$Value
  )

  $pattern = "(?m)^$([regex]::Escape($Name))=.*$"
  $line = "$Name=$Value"
  if ([regex]::IsMatch($Text, $pattern)) {
    return [regex]::Replace($Text, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $line })
  }

  return $Text.TrimEnd() + "`r`n$line`r`n"
}

$cacheRoot = "$runtimeStateRoot\xiaolou-cache"
$tempRoot = "$runtimeStateRoot\xiaolou-temp"
$connectionStringsPostgres = Resolve-EnvValue -Text $envText -Name "ConnectionStrings__Postgres"
$postgresConnectionString = Resolve-EnvValue -Text $envText -Name "Postgres__ConnectionString"
$postgresApplySchemaOnStartup = Resolve-EnvValue -Text $envText -Name "POSTGRES_APPLY_SCHEMA_ON_STARTUP" -DefaultValue (Resolve-EnvValue -Text $envText -Name "Postgres__ApplySchemaOnStartup" -DefaultValue "false")
$postgresMinimumPoolSize = Resolve-EnvValue -Text $envText -Name "Postgres__MinimumPoolSize"
$postgresMaximumPoolSize = Resolve-EnvValue -Text $envText -Name "Postgres__MaximumPoolSize"
$postgresTimeoutSeconds = Resolve-EnvValue -Text $envText -Name "Postgres__TimeoutSeconds"
$postgresCommandTimeoutSeconds = Resolve-EnvValue -Text $envText -Name "Postgres__CommandTimeoutSeconds"
$postgresKeepAliveSeconds = Resolve-EnvValue -Text $envText -Name "Postgres__KeepAliveSeconds"
$pgBin = Resolve-EnvValue -Text $envText -Name "PG_BIN" -DefaultValue "D:\soft\program\PostgreSQL\18\bin"
$coreApiPgPoolMax = Resolve-EnvValue -Text $envText -Name "PGPOOL_MAX" -DefaultValue "2"
$clientApiToken = Resolve-EnvValue -Text $envText -Name "CLIENT_API_TOKEN" -DefaultValue "change-me-client-token"
$clientApiTokenHeader = Resolve-EnvValue -Text $envText -Name "CLIENT_API_TOKEN_HEADER" -DefaultValue "X-XiaoLou-Client-Token"
$clientApiAuthProvider = Resolve-EnvValue -Text $envText -Name "CLIENT_API_AUTH_PROVIDER"
$clientApiAuthProviderSecret = Resolve-EnvValue -Text $envText -Name "CLIENT_API_AUTH_PROVIDER_SECRET"
$clientApiAuthProviderIssuer = Resolve-EnvValue -Text $envText -Name "CLIENT_API_AUTH_PROVIDER_ISSUER"
$clientApiAuthProviderAudience = Resolve-EnvValue -Text $envText -Name "CLIENT_API_AUTH_PROVIDER_AUDIENCE"
$clientApiAuthProviderTtlSeconds = Resolve-EnvValue -Text $envText -Name "CLIENT_API_AUTH_PROVIDER_TTL_SECONDS" -DefaultValue "3600"
$clientApiAuthProviderClockSkewSeconds = Resolve-EnvValue -Text $envText -Name "CLIENT_API_AUTH_PROVIDER_CLOCK_SKEW_SECONDS" -DefaultValue "60"
$clientApiRequireAuthProvider = Resolve-EnvValue -Text $envText -Name "CLIENT_API_REQUIRE_AUTH_PROVIDER" -DefaultValue "false"
$clientApiRequireAccountScope = Resolve-EnvValue -Text $envText -Name "CLIENT_API_REQUIRE_ACCOUNT_SCOPE" -DefaultValue "true"
$clientApiRequireConfiguredAccountGrant = Resolve-EnvValue -Text $envText -Name "CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT" -DefaultValue "false"
$clientApiAllowedAccountIds = Resolve-EnvValue -Text $envText -Name "CLIENT_API_ALLOWED_ACCOUNT_IDS"
$clientApiAllowedAccountOwnerIds = Resolve-EnvValue -Text $envText -Name "CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS"
$defaultClientApiAllowedPermissions = "accounts:ensure,jobs:create,jobs:read,jobs:cancel,wallet:read,media:read,media:write,projects:read,projects:write,canvas:read,canvas:write,create:read,create:write,identity:read,identity:write,organization:read,organization:write,api-center:read,api-center:write,admin:read,admin:write,enterprise-applications:read,enterprise-applications:write,playground:read,playground:write,toolbox:read,toolbox:write"
$clientApiAllowedPermissions = Merge-DelimitedValues `
  -CurrentValue (Resolve-EnvValue -Text $envText -Name "CLIENT_API_ALLOWED_PERMISSIONS") `
  -RequiredValue $defaultClientApiAllowedPermissions
$coreApiCompatReadOnly = Resolve-EnvValue -Text $envText -Name "CORE_API_COMPAT_READ_ONLY" -DefaultValue "1"
$coreApiCompatPublicRouteAllowlist = Resolve-EnvValue -Text $envText -Name "CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST" -DefaultValue "GET /healthz;GET /api/windows-native/status"
$paymentCallbackAllowedProviders = Resolve-EnvValue -Text $envText -Name "PAYMENT_CALLBACK_ALLOWED_PROVIDERS" -DefaultValue "testpay,alipay,wechat"
$paymentCallbackRequireAllowedProvider = Resolve-EnvValue -Text $envText -Name "PAYMENT_CALLBACK_REQUIRE_ALLOWED_PROVIDER" -DefaultValue "true"
$paymentCallbackRequireAccountGrant = Resolve-EnvValue -Text $envText -Name "PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT" -DefaultValue "false"
$paymentCallbackAllowedAccountIds = Resolve-EnvValue -Text $envText -Name "PAYMENT_CALLBACK_ALLOWED_ACCOUNT_IDS"
$paymentCallbackAllowedAccountOwnerIds = Resolve-EnvValue -Text $envText -Name "PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS"
$envValues = [ordered]@{
  XIAOLOU_RUNTIME_ROOT = $runtimeStateRoot
  XIAOLOU_REPO_ROOT = $SourceRoot
  XIAOLOU_ROOT = $RuntimeRoot
  XIAOLOU_DATA_ROOT = "$RuntimeRoot\data"
  DOTNET_ROOT = $dotnetRoot
  DOTNET_EXE = $DotnetExe
  PYTHON_EXE = $PythonExe
  NODE_EXE = $nodeExe
  NPM_CMD = $NpmCmd
  CONTROL_API_DLL = "$RuntimeRoot\publish\control-api\XiaoLou.ControlApi.dll"
  CLOSED_API_WORKER_DLL = "$RuntimeRoot\publish\closed-api-worker\XiaoLou.ClosedApiWorker.dll"
  LOCAL_MODEL_WORKER_SERVICE_DLL = "$RuntimeRoot\publish\local-model-worker-service\XiaoLou.LocalModelWorkerService.dll"
  LOCAL_CACHE_DIR = $cacheRoot
  LOCAL_TEMP_DIR = $tempRoot
  LOG_DIR = "$runtimeStateRoot\xiaolou-logs"
  BACKUP_DIR = "$runtimeStateRoot\xiaolou-backups"
  TMP = $tempRoot
  TEMP = $tempRoot
  DOTNET_CLI_HOME = "$cacheRoot\dotnet-cli-home"
  DOTNET_BUNDLE_EXTRACT_BASE_DIR = "$cacheRoot\dotnet-bundle"
  NUGET_PACKAGES = "$cacheRoot\nuget\packages"
  NUGET_HTTP_CACHE_PATH = "$cacheRoot\nuget\v3-cache"
  NUGET_PLUGINS_CACHE_PATH = "$cacheRoot\nuget\plugins-cache"
  NUGET_SCRATCH = "$tempRoot\NuGetScratch"
  NPM_CONFIG_CACHE = "$cacheRoot\npm"
  NPM_CONFIG_PREFIX = "$cacheRoot\node-global"
  PIP_CACHE_DIR = "$cacheRoot\pip"
  PIP_CONFIG_FILE = "$cacheRoot\pip\pip.ini"
  PYTHONPYCACHEPREFIX = "$cacheRoot\python-pycache"
  PYTHONUSERBASE = "$cacheRoot\python-userbase"
  UV_CACHE_DIR = "$cacheRoot\uv"
  POETRY_CACHE_DIR = "$cacheRoot\poetry"
  PIPENV_CACHE_DIR = "$cacheRoot\pipenv"
  PLAYWRIGHT_BROWSERS_PATH = "$cacheRoot\playwright-browsers"
  MAVEN_USER_HOME = "$cacheRoot\maven\.m2"
  GRADLE_USER_HOME = "$cacheRoot\gradle-user-home"
  COURSIER_CACHE = "$cacheRoot\coursier-cache"
  SBT_OPTS = "-Dsbt.boot.directory=$cacheRoot\scala\sbt-boot -Dsbt.global.base=$cacheRoot\scala\sbt-global -Dsbt.ivy.home=$cacheRoot\scala\ivy2"
  HF_HOME = "$cacheRoot\huggingface"
  HF_HUB_CACHE = "$cacheRoot\huggingface\hub"
  HUGGINGFACE_HUB_CACHE = "$cacheRoot\huggingface\hub"
  TRANSFORMERS_CACHE = "$cacheRoot\huggingface\transformers"
  TORCH_HOME = "$cacheRoot\torch"
  MODELSCOPE_CACHE = "$cacheRoot\modelscope"
  CLIENT_API_TOKEN = $clientApiToken
  CLIENT_API_TOKEN_HEADER = $clientApiTokenHeader
  CLIENT_API_AUTH_PROVIDER = $clientApiAuthProvider
  CLIENT_API_AUTH_PROVIDER_SECRET = $clientApiAuthProviderSecret
  CLIENT_API_AUTH_PROVIDER_ISSUER = $clientApiAuthProviderIssuer
  CLIENT_API_AUTH_PROVIDER_AUDIENCE = $clientApiAuthProviderAudience
  CLIENT_API_AUTH_PROVIDER_TTL_SECONDS = $clientApiAuthProviderTtlSeconds
  CLIENT_API_AUTH_PROVIDER_CLOCK_SKEW_SECONDS = $clientApiAuthProviderClockSkewSeconds
  CLIENT_API_REQUIRE_AUTH_PROVIDER = $clientApiRequireAuthProvider
  CLIENT_API_REQUIRE_ACCOUNT_SCOPE = $clientApiRequireAccountScope
  CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT = $clientApiRequireConfiguredAccountGrant
  CLIENT_API_ALLOWED_ACCOUNT_IDS = $clientApiAllowedAccountIds
  CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS = $clientApiAllowedAccountOwnerIds
  CLIENT_API_ALLOWED_PERMISSIONS = $clientApiAllowedPermissions
  ClientApi__AllowedPermissions = $clientApiAllowedPermissions
  ConnectionStrings__Postgres = $connectionStringsPostgres
  Postgres__ConnectionString = $postgresConnectionString
  POSTGRES_APPLY_SCHEMA_ON_STARTUP = $postgresApplySchemaOnStartup
  Postgres__ApplySchemaOnStartup = $postgresApplySchemaOnStartup
  Postgres__MinimumPoolSize = $postgresMinimumPoolSize
  Postgres__MaximumPoolSize = $postgresMaximumPoolSize
  Postgres__TimeoutSeconds = $postgresTimeoutSeconds
  Postgres__CommandTimeoutSeconds = $postgresCommandTimeoutSeconds
  Postgres__KeepAliveSeconds = $postgresKeepAliveSeconds
  PG_BIN = $pgBin
  PGPOOL_MAX = $coreApiPgPoolMax
  CORE_API_COMPAT_READ_ONLY = $coreApiCompatReadOnly
  CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST = $coreApiCompatPublicRouteAllowlist
  PAYMENT_CALLBACK_ALLOWED_PROVIDERS = $paymentCallbackAllowedProviders
  PAYMENT_CALLBACK_REQUIRE_ALLOWED_PROVIDER = $paymentCallbackRequireAllowedProvider
  PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT = $paymentCallbackRequireAccountGrant
  PAYMENT_CALLBACK_ALLOWED_ACCOUNT_IDS = $paymentCallbackAllowedAccountIds
  PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS = $paymentCallbackAllowedAccountOwnerIds
  Payments__AllowedProviders = $paymentCallbackAllowedProviders
  Payments__RequireAllowedProvider = $paymentCallbackRequireAllowedProvider
  Payments__RequireAccountGrant = $paymentCallbackRequireAccountGrant
  Payments__AllowedAccountIds = $paymentCallbackAllowedAccountIds
  Payments__AllowedAccountOwnerIds = $paymentCallbackAllowedAccountOwnerIds
}

foreach ($entry in $envValues.GetEnumerator()) {
  $envText = Set-EnvFileValue -Text $envText -Name $entry.Key -Value $entry.Value
}

foreach ($name in @(
  "DATABASE_URL",
  "ConnectionStrings__Postgres",
  "Postgres__ConnectionString",
  "POSTGRES_APPLY_SCHEMA_ON_STARTUP",
  "Postgres__ApplySchemaOnStartup",
  "Postgres__MinimumPoolSize",
  "Postgres__MaximumPoolSize",
  "Postgres__TimeoutSeconds",
  "Postgres__CommandTimeoutSeconds",
  "Postgres__KeepAliveSeconds",
  "PG_BIN",
  "PGPOOL_MAX",
  "PAYMENT_WEBHOOK_SECRET",
  "INTERNAL_API_TOKEN",
  "OBJECT_STORAGE_PROVIDER",
  "OBJECT_STORAGE_BUCKET",
  "OBJECT_STORAGE_PUBLIC_BASE_URL",
  "OBJECT_STORAGE_TEMP_PREFIX",
  "OBJECT_STORAGE_PERMANENT_PREFIX"
)) {
  $value = [Environment]::GetEnvironmentVariable($name, "Process")
  if ($value) {
    $envText = Set-EnvFileValue -Text $envText -Name $name -Value $value
  }
}
Set-Content -LiteralPath $envFile -Value $envText -Encoding UTF8

foreach ($requiredFile in @(
  "$RuntimeRoot\scripts\windows\restore-postgres.ps1",
  "$RuntimeRoot\scripts\windows\verify-postgres-backup.ps1",
  "$RuntimeRoot\scripts\windows\verify-legacy-dump-cutover.ps1",
  "$RuntimeRoot\scripts\windows\complete-control-api-publish-restart-p0.ps1",
  "$RuntimeRoot\deploy\windows\ops-runbook.md"
)) {
  if (-not (Test-Path -LiteralPath $requiredFile)) {
    throw "Required runtime file was not published: $requiredFile"
  }
}

if (-not $SkipDotnetPublish) {
  foreach ($requiredDll in @(
    "$RuntimeRoot\publish\control-api\XiaoLou.ControlApi.dll",
    "$RuntimeRoot\publish\closed-api-worker\XiaoLou.ClosedApiWorker.dll",
    "$RuntimeRoot\publish\local-model-worker-service\XiaoLou.LocalModelWorkerService.dll"
  )) {
    if (-not (Test-Path -LiteralPath $requiredDll)) {
      throw "Required published DLL was not created: $requiredDll"
    }
  }
}

Write-Host "Published XiaoLouAI runtime to $RuntimeRoot"
if ($SuppressRegistrationHint) {
  Write-Host "Publish step completed; continuing with the caller's service restart/P0 flow."
} else {
  Write-Host "Review $envFile, then register/update Windows services:"
  Write-Host "$RuntimeRoot\scripts\windows\register-services.ps1 -Root $RuntimeRoot -DotnetExe $DotnetExe -PythonExe $PythonExe -UpdateExisting"
}
