param(
  [string]$ServiceName = "postgresql-x64-18",
  [string]$SourceRoot = "C:\Program Files\PostgreSQL\18",
  [string]$TargetRoot = "D:\soft\program\PostgreSQL\18",
  [switch]$Execute,
  [switch]$RemoveSourceAfterValidation
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from an elevated PowerShell session."
  }
}

function Assert-PathUnder {
  param(
    [string]$Path,
    [string]$Root
  )

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $fullRoot = [System.IO.Path]::GetFullPath($Root)
  if (-not $fullPath.StartsWith($fullRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing unsafe path. Path '$fullPath' is not under '$fullRoot'."
  }

  return $fullPath
}

function Invoke-RobocopyChecked {
  param(
    [string]$From,
    [string]$To
  )

  robocopy $From $To /E /COPYALL /DCOPY:DAT /R:2 /W:2 /XJ | Out-Host
  $exitCode = $LASTEXITCODE
  if ($exitCode -ge 8) {
    throw "robocopy failed with exit code $exitCode"
  }
}

$serviceValidatedOnD = $false
$sourceFull = (Resolve-Path -LiteralPath $SourceRoot).Path
$targetFull = Assert-PathUnder $TargetRoot "D:\soft\program\PostgreSQL"
$targetData = Join-Path $targetFull "data"
$targetBin = Join-Path $targetFull "bin"
$targetPgCtl = Join-Path $targetBin "pg_ctl.exe"
$targetPgIsReady = Join-Path $targetBin "pg_isready.exe"

$service = Get-CimInstance -ClassName Win32_Service -Filter "Name='$ServiceName'" -ErrorAction Stop

Write-Host "PostgreSQL service: $ServiceName"
Write-Host "Service account: $($service.StartName)"
Write-Host "Current ImagePath: $($service.PathName)"
Write-Host "Source root: $sourceFull"
Write-Host "Target root: $targetFull"
Write-Host "Target data: $targetData"
Write-Host "Remove source after validation: $RemoveSourceAfterValidation"

if (-not $Execute) {
  Write-Host ""
  Write-Host "Dry run only. Re-run from elevated PowerShell with -Execute to migrate."
  Write-Host "Use -RemoveSourceAfterValidation only when you are ready to delete $sourceFull after successful service validation."
  exit 0
}

Assert-Admin

New-Item -ItemType Directory -Force -Path $targetFull | Out-Null

Write-Host "Stopping PostgreSQL service..."
Stop-Service -Name $ServiceName -Force

try {
  Write-Host "Copying PostgreSQL install and data directory to D:..."
  Invoke-RobocopyChecked $sourceFull $targetFull

  if (-not (Test-Path -LiteralPath $targetPgCtl)) {
    throw "Copied pg_ctl.exe not found: $targetPgCtl"
  }

  if (-not (Test-Path -LiteralPath $targetData)) {
    throw "Copied PostgreSQL data directory not found: $targetData"
  }

  Write-Host "Ensuring NetworkService can write the migrated directory..."
  icacls $targetFull /grant "NT AUTHORITY\NETWORK SERVICE:(OI)(CI)F" /T | Out-Host

  $imagePath = "`"$targetPgCtl`" runservice -N `"$ServiceName`" -D `"$targetData`" -w"
  Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName" -Name ImagePath -Value $imagePath

  Write-Host "Starting PostgreSQL service from D:..."
  Start-Service -Name $ServiceName
  Start-Sleep -Seconds 5

  $updated = Get-CimInstance -ClassName Win32_Service -Filter "Name='$ServiceName'" -ErrorAction Stop
  if ($updated.State -ne "Running") {
    throw "PostgreSQL service did not reach Running state. Current state: $($updated.State)"
  }

  if (Test-Path -LiteralPath $targetPgIsReady) {
    & $targetPgIsReady -h 127.0.0.1 -p 5432
    if ($LASTEXITCODE -ne 0) {
      throw "pg_isready failed with exit code $LASTEXITCODE"
    }
  }

  $newImagePath = (Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName").ImagePath
  if ($newImagePath.IndexOf($targetPgCtl, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    throw "Service ImagePath was not updated to D:. Current value: $newImagePath"
  }

  Write-Host "PostgreSQL service now runs from D:."
  $serviceValidatedOnD = $true

  if ($RemoveSourceAfterValidation) {
    $resolvedSource = Assert-PathUnder $sourceFull "C:\Program Files\PostgreSQL"
    Write-Host "Taking ownership of migrated source directory before removal..."
    takeown.exe /F $resolvedSource /R /D Y | Out-Host
    icacls $resolvedSource /grant "BUILTIN\Administrators:(OI)(CI)F" /T | Out-Host
    Write-Host "Removing migrated source directory from C: $resolvedSource"
    Remove-Item -LiteralPath $resolvedSource -Recurse -Force
  } else {
    Write-Host "Source directory left in place for rollback: $sourceFull"
  }
} catch {
  if ($serviceValidatedOnD) {
    Write-Host "Cleanup failed after PostgreSQL was validated on D:. Leaving service configured for D:."
    Start-Service -Name $ServiceName -ErrorAction SilentlyContinue
  } else {
    Write-Host "Migration failed before D: validation. Attempting to restore original service ImagePath and restart service from C:."
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    $originalImagePath = "`"$sourceFull\bin\pg_ctl.exe`" runservice -N `"$ServiceName`" -D `"$sourceFull\data`" -w"
    Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName" -Name ImagePath -Value $originalImagePath
    Start-Service -Name $ServiceName -ErrorAction SilentlyContinue
  }

  throw
}
