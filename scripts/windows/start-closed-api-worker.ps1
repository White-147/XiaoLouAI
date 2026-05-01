$ErrorActionPreference = "Stop"
. "$PSScriptRoot\load-env.ps1"

$Root = $env:XIAOLOU_ROOT
if (-not $Root) { throw "XIAOLOU_ROOT was not initialized by load-env.ps1." }

if (-not $env:DOTNET_EXE) {
  if (Test-Path -LiteralPath "D:\soft\program\dotnet\dotnet.exe") {
    $env:DOTNET_EXE = "D:\soft\program\dotnet\dotnet.exe"
  } else {
    throw "D:\soft\program\dotnet\dotnet.exe not found. ClosedApiWorker must use the D: .NET runtime."
  }
}

if (-not $env:CLOSED_API_WORKER_DLL) {
  $env:CLOSED_API_WORKER_DLL = "$Root\publish\closed-api-worker\XiaoLou.ClosedApiWorker.dll"
}

$env:ObjectStorage__Provider = $env:OBJECT_STORAGE_PROVIDER
$env:ObjectStorage__Bucket = $env:OBJECT_STORAGE_BUCKET
$env:ObjectStorage__PublicBaseUrl = $env:OBJECT_STORAGE_PUBLIC_BASE_URL
$env:Worker__Lane = if ($env:CLOSED_API_WORKER_LANE) { $env:CLOSED_API_WORKER_LANE } else { "account-media" }
$env:Worker__ProviderRoute = if ($env:CLOSED_API_WORKER_PROVIDER_ROUTE) { $env:CLOSED_API_WORKER_PROVIDER_ROUTE } else { "closed-api" }

Set-Location "$Root\publish\closed-api-worker"
& "$env:DOTNET_EXE" "$env:CLOSED_API_WORKER_DLL"
