param(
  [string]$Root = "",
  [string]$SourceRoot = "",
  [string]$DotnetExe = "",
  [string]$NpmCmd = "",
  [string]$PythonExe = "",
  [switch]$SkipFrontend,
  [switch]$SkipDotnetPublish,
  [switch]$RegisterServices,
  [switch]$UpdateExisting,
  [switch]$StartServices,
  [switch]$AssertDDrive
)

$ErrorActionPreference = "Stop"

if (-not $SourceRoot) {
  $SourceRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
}

if (-not $Root) {
  $Root = Join-Path $SourceRoot ".runtime\app"
}

& "$PSScriptRoot\publish-runtime-to-d.ps1" `
  -SourceRoot $SourceRoot `
  -RuntimeRoot $Root `
  -DotnetExe $DotnetExe `
  -NpmCmd $NpmCmd `
  -PythonExe $PythonExe `
  -SkipFrontend:$SkipFrontend `
  -SkipDotnetPublish:$SkipDotnetPublish

$runtimeScripts = Join-Path $Root "scripts\windows"
$envFile = Join-Path $runtimeScripts ".env.windows"

if ($AssertDDrive -or $RegisterServices) {
  & (Join-Path $runtimeScripts "assert-d-drive-runtime.ps1") -EnvFile $envFile
}

if ($RegisterServices) {
  & (Join-Path $runtimeScripts "register-services.ps1") `
    -Root $Root `
    -DotnetExe $DotnetExe `
    -PythonExe $PythonExe `
    -UpdateExisting:$UpdateExisting
}

if ($StartServices) {
  & (Join-Path $runtimeScripts "start-services.ps1")
}
