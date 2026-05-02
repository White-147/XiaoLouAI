$ErrorActionPreference = "Stop"
. "$PSScriptRoot\load-env.ps1"

$Root = $env:XIAOLOU_ROOT
if (-not $Root) { throw "XIAOLOU_ROOT was not initialized by load-env.ps1." }

if (-not $env:DOTNET_EXE) {
  if (Test-Path -LiteralPath "D:\soft\program\dotnet\dotnet.exe") {
    $env:DOTNET_EXE = "D:\soft\program\dotnet\dotnet.exe"
  } else {
    throw "D:\soft\program\dotnet\dotnet.exe not found. ControlApi must use the D: .NET runtime."
  }
}

if (-not $env:CONTROL_API_DLL) {
  $env:CONTROL_API_DLL = "$Root\publish\control-api\XiaoLou.ControlApi.dll"
}

$env:ASPNETCORE_URLS = $env:CONTROL_API_URLS
$env:Postgres__ApplySchemaOnStartup = $env:POSTGRES_APPLY_SCHEMA_ON_STARTUP
$env:ObjectStorage__Provider = $env:OBJECT_STORAGE_PROVIDER
$env:ObjectStorage__Bucket = $env:OBJECT_STORAGE_BUCKET
$env:ObjectStorage__PublicBaseUrl = $env:OBJECT_STORAGE_PUBLIC_BASE_URL
$env:Payments__WebhookSecret = $env:PAYMENT_WEBHOOK_SECRET
if ($env:INTERNAL_API_TOKEN) {
  $env:InternalApi__Token = $env:INTERNAL_API_TOKEN
}
if ($env:CLIENT_API_TOKEN) {
  $env:ClientApi__Token = $env:CLIENT_API_TOKEN
}
if ($env:CLIENT_API_TOKEN_HEADER) {
  $env:ClientApi__TokenHeader = $env:CLIENT_API_TOKEN_HEADER
}
if ($env:CLIENT_API_REQUIRE_ACCOUNT_SCOPE) {
  $env:ClientApi__RequireAccountScope = $env:CLIENT_API_REQUIRE_ACCOUNT_SCOPE
}
if ($env:CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT) {
  $env:ClientApi__RequireConfiguredAccountGrant = $env:CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT
}
if ($env:CLIENT_API_ALLOWED_ACCOUNT_IDS) {
  $env:ClientApi__AllowedAccountIds = $env:CLIENT_API_ALLOWED_ACCOUNT_IDS
}
if ($env:CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS) {
  $env:ClientApi__AllowedAccountOwnerIds = $env:CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS
}
if ($env:CLIENT_API_ALLOWED_PERMISSIONS) {
  $env:ClientApi__AllowedPermissions = $env:CLIENT_API_ALLOWED_PERMISSIONS
}

Set-Location "$Root\publish\control-api"
& "$env:DOTNET_EXE" "$env:CONTROL_API_DLL"
