param(
  [string]$ServiceName = "postgresql-x64-18",
  [string]$SourceRoot = "C:\Program Files\PostgreSQL\18",
  [string]$ExpectedTargetRoot = "D:\soft\program\PostgreSQL\18",
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

function Normalize-PathString {
  param([string]$Path)
  return [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
}

$sourceFull = Normalize-PathString $SourceRoot
$expectedSource = Normalize-PathString "C:\Program Files\PostgreSQL\18"
$expectedTarget = Normalize-PathString $ExpectedTargetRoot

if ($sourceFull -ne $expectedSource) {
  throw "Refusing to delete unexpected source path: $sourceFull"
}

$imagePath = (Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName" -ErrorAction Stop).ImagePath
if ($imagePath.IndexOf($expectedTarget, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
  throw "PostgreSQL service is not configured for D:. Current ImagePath: $imagePath"
}

$oldProcesses = Get-CimInstance Win32_Process |
  Where-Object {
    ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($sourceFull, [StringComparison]::OrdinalIgnoreCase)) -or
    ($_.CommandLine -and $_.CommandLine.IndexOf($sourceFull, [StringComparison]::OrdinalIgnoreCase) -ge 0)
  } |
  Select-Object ProcessId, ExecutablePath, CommandLine

Write-Host "Service ImagePath: $imagePath"
Write-Host "Source root: $sourceFull"
Write-Host "Expected target root: $expectedTarget"
Write-Host "Old C: PostgreSQL processes: $($oldProcesses.Count)"
if ($oldProcesses.Count -gt 0) {
  $oldProcesses | Format-Table -AutoSize | Out-Host
}

if (-not (Test-Path -LiteralPath $sourceFull)) {
  Write-Host "Source directory already removed."
  exit 0
}

if (-not $Execute) {
  Write-Host "Dry run only. Re-run from elevated PowerShell with -Execute to remove $sourceFull."
  exit 0
}

Assert-Admin

foreach ($process in $oldProcesses) {
  Write-Host "Stopping old C: PostgreSQL process $($process.ProcessId)"
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

Write-Host "Taking ownership and granting Administrators full control..."
takeown.exe /F $sourceFull /R /A /D Y | Out-Host
icacls.exe $sourceFull /grant "BUILTIN\Administrators:(OI)(CI)F" /T /C | Out-Host

Write-Host "Clearing read-only/system/hidden attributes..."
Get-ChildItem -LiteralPath $sourceFull -Recurse -Force -ErrorAction SilentlyContinue |
  ForEach-Object {
    try {
      $_.Attributes = [System.IO.FileAttributes]::Normal
    } catch {
      Write-Warning "Could not clear attributes: $($_.FullName) $($_.Exception.Message)"
    }
  }

Write-Host "Removing source directory from C:..."
Remove-Item -LiteralPath $sourceFull -Recurse -Force -ErrorAction Stop

Write-Host "Removed $sourceFull"
