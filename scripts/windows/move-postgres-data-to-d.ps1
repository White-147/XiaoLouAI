param(
  [string]$ServiceName = "postgresql-x64-18",
  [string]$SourceDataDir = "C:\Program Files\PostgreSQL\18\data",
  [string]$TargetDataDir = "D:\soft\program\PostgreSQL\18\data",
  [string]$PgCtlExe = "D:\soft\program\PostgreSQL\18\bin\pg_ctl.exe",
  [switch]$Execute
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from an elevated PowerShell session."
  }
}

$source = (Resolve-Path -LiteralPath $SourceDataDir).Path
$targetParent = Split-Path -Parent $TargetDataDir
New-Item -ItemType Directory -Force -Path $targetParent | Out-Null
$targetFull = [System.IO.Path]::GetFullPath($TargetDataDir)

if (-not $targetFull.StartsWith("D:\soft\program\PostgreSQL\", [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to move PostgreSQL data outside D:\soft\program\PostgreSQL. Target was: $targetFull"
}

Write-Host "PostgreSQL service: $ServiceName"
Write-Host "Source data dir: $source"
Write-Host "Target data dir: $targetFull"
Write-Host "pg_ctl exe: $PgCtlExe"

if (-not $Execute) {
  Write-Host ""
  Write-Host "Dry run only. Re-run with -Execute from elevated PowerShell to stop PostgreSQL, copy data to D:, and update the service data directory."
  Write-Host "This data-only migrator expects PostgreSQL binaries on D:. For full C: to D: migration, use move-postgresql-18-to-d.ps1."
  exit 0
}

Assert-Admin

if (-not (Test-Path -LiteralPath $PgCtlExe)) {
  throw "pg_ctl.exe not found: $PgCtlExe"
}

Stop-Service -Name $ServiceName -Force

New-Item -ItemType Directory -Force -Path $targetFull | Out-Null
robocopy $source $targetFull /E /COPYALL /DCOPY:DAT /R:2 /W:2 | Out-Host
$robocopyExit = $LASTEXITCODE
if ($robocopyExit -ge 8) {
  throw "robocopy failed with exit code $robocopyExit"
}

$imagePath = "`"$PgCtlExe`" runservice -N `"$ServiceName`" -D `"$targetFull`" -w"
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName" -Name ImagePath -Value $imagePath

Start-Service -Name $ServiceName
Write-Host "PostgreSQL data directory now points to $targetFull"
