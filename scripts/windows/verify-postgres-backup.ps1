param(
  [Parameter(Mandatory = $true)]
  [string]$DumpFile,
  [string]$PgBin = "",
  [string]$HostName = "127.0.0.1",
  [int]$Port = 5432,
  [string]$Username = "postgres",
  [string]$Database = "",
  [int]$Jobs = 4,
  [string]$ReportPath = "",
  [switch]$KeepDatabase
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\load-env.ps1"

function Resolve-PostgresBin {
  param([string]$Configured)

  foreach ($candidate in @(
    $Configured,
    $env:PG_BIN,
    "D:\soft\program\PostgreSQL\18\bin",
    "D:\soft\program\PostgreSQL\17\bin",
    "D:\soft\program\PostgreSQL\16\bin"
  )) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  throw "PostgreSQL bin directory was not found. Pass -PgBin with a D: path that contains psql.exe."
}

function Resolve-PostgresTool {
  param(
    [string]$Bin,
    [string]$Name
  )

  $path = Join-Path $Bin $Name
  if (-not (Test-Path -LiteralPath $path)) {
    throw "$Name was not found in $Bin"
  }

  return $path
}

if (-not (Test-Path -LiteralPath $DumpFile)) {
  throw "Dump file not found: $DumpFile"
}

if (-not $Database) {
  $Database = "xiaolou_verify_" + (Get-Date -Format "yyyyMMdd_HHmmss")
}

if (-not $ReportPath) {
  $logDir = $env:LOG_DIR
  if (-not $logDir) {
    $logDir = Join-Path (Resolve-Path "$PSScriptRoot\..\..").Path ".runtime\xiaolou-logs"
  }
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $ReportPath = Join-Path $logDir ("postgres-backup-verify-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")
}

$pgBinPath = Resolve-PostgresBin $PgBin
$psql = Resolve-PostgresTool $pgBinPath "psql.exe"
$dropdb = Resolve-PostgresTool $pgBinPath "dropdb.exe"
$restoreScript = Join-Path $PSScriptRoot "restore-postgres.ps1"
$dumpFullPath = (Resolve-Path -LiteralPath $DumpFile).Path
$status = "blocked"
$errorMessage = $null
$counts = $null

try {
  & $restoreScript `
    -DumpFile $dumpFullPath `
    -PgBin $pgBinPath `
    -HostName $HostName `
    -Port $Port `
    -Username $Username `
    -Database $Database `
    -Jobs $Jobs `
    -CreateDatabase `
    -DropExisting `
    -Execute | Out-Host

  $sql = @"
SELECT json_build_object(
  'jobs', CASE WHEN to_regclass('public.jobs') IS NULL THEN NULL ELSE (SELECT count(*) FROM public.jobs) END,
  'payment_orders', CASE WHEN to_regclass('public.payment_orders') IS NULL THEN NULL ELSE (SELECT count(*) FROM public.payment_orders) END,
  'wallet_ledger', CASE WHEN to_regclass('public.wallet_ledger') IS NULL THEN NULL ELSE (SELECT count(*) FROM public.wallet_ledger) END
)::text;
"@

  $countsJson = & $psql "--host=$HostName" "--port=$Port" "--username=$Username" "--dbname=$Database" "--tuples-only" "--no-align" "--command=$sql"
  if ($LASTEXITCODE -ne 0) {
    throw "psql verification query failed with exit code $LASTEXITCODE"
  }

  $counts = ($countsJson | Where-Object { $_ -and $_.Trim() } | Select-Object -First 1 | ConvertFrom-Json)
  $status = "ok"
} catch {
  $errorMessage = $_.Exception.Message
  $status = "failed"
  throw
} finally {
  if (-not $KeepDatabase) {
    & $dropdb "--if-exists" "--host=$HostName" "--port=$Port" "--username=$Username" $Database | Out-Null
  }

  $report = [ordered]@{
    generated_at_utc = [DateTimeOffset]::UtcNow.ToString("O")
    status = $status
    dumpFile = $dumpFullPath
    pgBin = $pgBinPath
    host = $HostName
    port = $Port
    database = $Database
    keptDatabase = [bool]$KeepDatabase
    counts = $counts
    error = $errorMessage
  }
  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
  $report | ConvertTo-Json -Depth 6
}
