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

$env:ObjectStorage__Provider = if ($env:OBJECT_STORAGE_PROVIDER) { $env:OBJECT_STORAGE_PROVIDER } else { "local" }
$env:ObjectStorage__Bucket = if ($env:OBJECT_STORAGE_BUCKET) { $env:OBJECT_STORAGE_BUCKET } else { "xiaolou-staging" }
$env:ObjectStorage__PublicBaseUrl = if ($env:OBJECT_STORAGE_PUBLIC_BASE_URL) { $env:OBJECT_STORAGE_PUBLIC_BASE_URL } else { "http://127.0.0.1:4100" }
if ($env:OBJECT_STORAGE_LOCAL_ROOT) {
  $env:ObjectStorage__LocalRootPath = $env:OBJECT_STORAGE_LOCAL_ROOT
}
$env:Vertex__ProjectId = if ($env:VERTEX_PROJECT_ID) { $env:VERTEX_PROJECT_ID } else { $env:GOOGLE_CLOUD_PROJECT }
$env:Vertex__GeminiLocation = if ($env:VERTEX_GEMINI_LOCATION) { $env:VERTEX_GEMINI_LOCATION } elseif ($env:GOOGLE_CLOUD_LOCATION) { $env:GOOGLE_CLOUD_LOCATION } else { "global" }
$vertexCredentialsPath = $env:GOOGLE_APPLICATION_CREDENTIALS
if ($vertexCredentialsPath -and -not (Test-Path -LiteralPath $vertexCredentialsPath)) {
  $repoSecretCredentials = Join-Path $env:XIAOLOU_REPO_ROOT "deploy\local-secrets\legacy\core-api\vertex-sa.json"
  if (Test-Path -LiteralPath $repoSecretCredentials) {
    $vertexCredentialsPath = $repoSecretCredentials
  }
}
$env:GOOGLE_APPLICATION_CREDENTIALS = $vertexCredentialsPath
$env:Vertex__CredentialsPath = $vertexCredentialsPath
$env:Vertex__AccessToken = $env:VERTEX_ACCESS_TOKEN
$env:Vertex__ApiKey = $env:VERTEX_API_KEY
$env:Worker__Lane = if ($env:CLOSED_API_WORKER_LANE) { $env:CLOSED_API_WORKER_LANE } else { "account-media" }
$env:Worker__ProviderRoute = if ($env:CLOSED_API_WORKER_PROVIDER_ROUTE) { $env:CLOSED_API_WORKER_PROVIDER_ROUTE } else { "closed-api" }

Set-Location "$Root\publish\closed-api-worker"
& "$env:DOTNET_EXE" "$env:CLOSED_API_WORKER_DLL"
