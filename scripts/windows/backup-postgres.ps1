param(
  [string]$BackupDir = "",
  [string]$PgDump = ""
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\load-env.ps1"

if (-not $BackupDir) {
  $BackupDir = $env:BACKUP_DIR
}

if (-not $PgDump) {
  if (Test-Path -LiteralPath "D:\soft\program\PostgreSQL\18\bin\pg_dump.exe") {
    $PgDump = "D:\soft\program\PostgreSQL\18\bin\pg_dump.exe"
  } else {
    throw "D:\soft\program\PostgreSQL\18\bin\pg_dump.exe not found. Install PostgreSQL client tools to D: or pass -PgDump with an explicit D: path."
  }
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$out = Join-Path $BackupDir "xiaolou-$stamp.dump"

& $PgDump --format=custom --file=$out $env:DATABASE_URL
Write-Host "PostgreSQL backup written to $out"
