param(
  [Parameter(Mandatory = $true)]
  [string]$InputFile,
  [string]$VerifiedOutputFile = "",
  [string]$CanonicalOutputFile = "",
  [string]$AccountOwnerType = "user",
  [string]$AccountOwnerId = "",
  [string]$AlipayPublicKeyFile = "",
  [string]$WeChatPayPlatformPublicKeyFile = "",
  [string]$WeChatPayApiV3Key = "",
  [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"

. "$PSScriptRoot\load-env.ps1"

if (-not (Test-Path -LiteralPath $InputFile)) {
  throw "Input file not found: $InputFile"
}

$runtimeRoot = [Environment]::GetEnvironmentVariable("XIAOLOU_RUNTIME_ROOT", "Process")
if (-not $runtimeRoot) {
  throw "XIAOLOU_RUNTIME_ROOT is not set."
}

$nodeExe = [Environment]::GetEnvironmentVariable("NODE_EXE", "Process")
if (-not $nodeExe -or -not (Test-Path -LiteralPath $nodeExe)) {
  throw "NODE_EXE must point to D:\soft\program\nodejs\node.exe for native provider crypto adapter tooling."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
if (-not $VerifiedOutputFile) {
  $VerifiedOutputFile = Join-Path $runtimeRoot "xiaolou-temp\payment-provider-native-verified-$stamp.jsonl"
}
if (-not $CanonicalOutputFile) {
  $CanonicalOutputFile = Join-Path $runtimeRoot "xiaolou-temp\payment-provider-native-canonical-$stamp.jsonl"
}
if (-not $ReportPath) {
  $ReportPath = Join-Path $runtimeRoot "xiaolou-logs\payment-provider-native-adapter-$stamp.json"
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $VerifiedOutputFile) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $CanonicalOutputFile) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null

$reportDir = Split-Path -Parent $ReportPath
$reportStem = [System.IO.Path]::GetFileNameWithoutExtension($ReportPath)
$nativeReportPath = Join-Path $reportDir "$reportStem-native.json"
$normalizerReportPath = Join-Path $reportDir "$reportStem-normalizer.json"
$adapterJs = Join-Path $PSScriptRoot "payment-provider-native-adapter.js"

$args = @(
  $adapterJs,
  "adapt",
  "--input",
  (Resolve-Path -LiteralPath $InputFile).Path,
  "--output",
  [System.IO.Path]::GetFullPath($VerifiedOutputFile),
  "--report",
  [System.IO.Path]::GetFullPath($nativeReportPath)
)
if ($AlipayPublicKeyFile) {
  $args += @("--alipay-public-key-file", (Resolve-Path -LiteralPath $AlipayPublicKeyFile).Path)
}
if ($WeChatPayPlatformPublicKeyFile) {
  $args += @("--wechat-platform-public-key-file", (Resolve-Path -LiteralPath $WeChatPayPlatformPublicKeyFile).Path)
}
if ($WeChatPayApiV3Key) {
  $args += @("--wechat-api-v3-key", $WeChatPayApiV3Key)
}

& $nodeExe @args | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Native provider adapter failed. See $nativeReportPath"
}

if (-not $AccountOwnerId) {
  throw "Pass -AccountOwnerId so verified native provider callbacks can be normalized inside an explicit owner grant boundary."
}

& "$PSScriptRoot\normalize-payment-provider-capture.ps1" `
  -InputFile $VerifiedOutputFile `
  -OutputFile $CanonicalOutputFile `
  -InputFormat "auto" `
  -AccountOwnerType $AccountOwnerType `
  -AccountOwnerId $AccountOwnerId `
  -ReportPath $normalizerReportPath | Out-Null

$nativeReport = Get-Content -LiteralPath $nativeReportPath -Raw | ConvertFrom-Json
$normalizerReport = Get-Content -LiteralPath $normalizerReportPath -Raw | ConvertFrom-Json

$summary = [ordered]@{
  generated_at_utc = [DateTimeOffset]::UtcNow.ToString("O")
  status = if ($nativeReport.status -eq "ok" -and $normalizerReport.failed -eq 0) { "ok" } else { "failed" }
  input_file = (Resolve-Path -LiteralPath $InputFile).Path
  verified_output_file = [System.IO.Path]::GetFullPath($VerifiedOutputFile)
  canonical_output_file = [System.IO.Path]::GetFullPath($CanonicalOutputFile)
  native_report = [System.IO.Path]::GetFullPath($nativeReportPath)
  normalizer_report = [System.IO.Path]::GetFullPath($normalizerReportPath)
  account_owner_type = $AccountOwnerType
  account_owner_id = $AccountOwnerId
  native = $nativeReport
  normalizer = $normalizerReport
}

$summary | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$summary | ConvertTo-Json -Depth 12

if ($summary.status -ne "ok") {
  throw "Native payment provider adapter finished with status $($summary.status). See $ReportPath"
}
