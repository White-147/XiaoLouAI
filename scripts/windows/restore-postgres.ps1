param(
  [Parameter(Mandatory = $true)]
  [string]$DumpFile,
  [string]$PgBin = "",
  [string]$HostName = "127.0.0.1",
  [int]$Port = 5432,
  [string]$Database = "xiaolou_restore",
  [string]$Username = "postgres",
  [int]$Jobs = 4,
  [switch]$CreateDatabase,
  [switch]$DropExisting,
  [switch]$Clean,
  [switch]$Execute
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

  throw "PostgreSQL bin directory was not found. Pass -PgBin with a D: path that contains pg_restore.exe."
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

$pgBinPath = Resolve-PostgresBin $PgBin
$pgRestore = Resolve-PostgresTool $pgBinPath "pg_restore.exe"
$createdb = Resolve-PostgresTool $pgBinPath "createdb.exe"
$dropdb = Resolve-PostgresTool $pgBinPath "dropdb.exe"
$dumpFullPath = (Resolve-Path -LiteralPath $DumpFile).Path
$safeJobs = [Math]::Max(1, $Jobs)

$plan = [ordered]@{
  dumpFile = $dumpFullPath
  pgBin = $pgBinPath
  host = $HostName
  port = $Port
  database = $Database
  username = $Username
  jobs = $safeJobs
  createDatabase = [bool]$CreateDatabase
  dropExisting = [bool]$DropExisting
  clean = [bool]$Clean
  execute = [bool]$Execute
}

if (-not $Execute) {
  $plan | ConvertTo-Json -Depth 4
  Write-Host "Dry-run only. Re-run with -Execute to restore the dump."
  return
}

if ($DropExisting) {
  & $dropdb "--no-password" "--if-exists" "--host=$HostName" "--port=$Port" "--username=$Username" $Database
  if ($LASTEXITCODE -ne 0) {
    throw "dropdb failed with exit code $LASTEXITCODE"
  }
}

if ($CreateDatabase) {
  & $createdb "--no-password" "--host=$HostName" "--port=$Port" "--username=$Username" $Database
  if ($LASTEXITCODE -ne 0) {
    throw "createdb failed with exit code $LASTEXITCODE"
  }
}

$restoreArgs = @(
  "--no-password",
  "--host=$HostName",
  "--port=$Port",
  "--username=$Username",
  "--dbname=$Database",
  "--jobs=$safeJobs"
)
if ($Clean) {
  $restoreArgs += "--clean"
  $restoreArgs += "--if-exists"
}
$restoreArgs += $dumpFullPath

& $pgRestore @restoreArgs
if ($LASTEXITCODE -ne 0) {
  throw "pg_restore failed with exit code $LASTEXITCODE"
}

$plan["status"] = "ok"
$plan | ConvertTo-Json -Depth 4
