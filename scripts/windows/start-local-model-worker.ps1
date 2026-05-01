$ErrorActionPreference = "Stop"
. "$PSScriptRoot\load-env.ps1"

$Root = $env:XIAOLOU_ROOT
if (-not $Root) { throw "XIAOLOU_ROOT was not initialized by load-env.ps1." }

if (-not $env:PYTHON_EXE) {
  if (Test-Path -LiteralPath "D:\soft\program\Python\Python312\python.exe") {
    $env:PYTHON_EXE = "D:\soft\program\Python\Python312\python.exe"
  } else {
    throw "D:\soft\program\Python\Python312\python.exe not found. LocalModelWorker must use the D: Python runtime."
  }
}

if (-not $env:CONTROL_API_BASE_URL) {
  $env:CONTROL_API_BASE_URL = "http://127.0.0.1:4100"
}

$Lane = if ($env:LOCAL_MODEL_WORKER_LANE) { $env:LOCAL_MODEL_WORKER_LANE } else { "account-media" }
$ProviderRoute = if ($env:LOCAL_MODEL_WORKER_PROVIDER_ROUTE) { $env:LOCAL_MODEL_WORKER_PROVIDER_ROUTE } else { "local-model" }
$InternalToken = if ($env:LOCAL_MODEL_WORKER_INTERNAL_TOKEN) { $env:LOCAL_MODEL_WORKER_INTERNAL_TOKEN } else { $env:INTERNAL_API_TOKEN }

Set-Location "$Root\services\local-model-worker"
& "$env:PYTHON_EXE" -m app.worker `
  --control-api "$env:CONTROL_API_BASE_URL" `
  --lane "$Lane" `
  --provider-route "$ProviderRoute" `
  --internal-token "$InternalToken"
