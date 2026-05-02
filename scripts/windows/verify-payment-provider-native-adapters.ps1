param(
  [string]$AccountOwnerId = "",
  [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"

. "$PSScriptRoot\load-env.ps1"

if (-not $AccountOwnerId) {
  $AccountOwnerId = "provider-native-adapter-synthetic-owner"
}

$runtimeRoot = [Environment]::GetEnvironmentVariable("XIAOLOU_RUNTIME_ROOT", "Process")
$nodeExe = [Environment]::GetEnvironmentVariable("NODE_EXE", "Process")
if (-not $runtimeRoot) {
  throw "XIAOLOU_RUNTIME_ROOT is not set."
}
if (-not $nodeExe -or -not (Test-Path -LiteralPath $nodeExe)) {
  throw "NODE_EXE must point to D:\soft\program\nodejs\node.exe."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$fixtureRoot = Join-Path $runtimeRoot "xiaolou-temp\payment-provider-native-adapter-fixtures\$stamp"
$logRoot = Join-Path $runtimeRoot "xiaolou-logs"
New-Item -ItemType Directory -Force -Path $fixtureRoot | Out-Null
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

if (-not $ReportPath) {
  $ReportPath = Join-Path $logRoot "payment-provider-native-adapter-contract-$stamp.json"
}

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )

  if (-not $Condition) {
    throw $Message
  }
}

$adapterJs = Join-Path $PSScriptRoot "payment-provider-native-adapter.js"
$keysDir = Join-Path $fixtureRoot "keys"
$nativeInput = Join-Path $fixtureRoot "synthetic-native-provider-callbacks.jsonl"
$invalidInput = Join-Path $fixtureRoot "synthetic-native-provider-callbacks-invalid.jsonl"
$fixtureReport = Join-Path $logRoot "payment-provider-native-adapter-fixture-$stamp.json"
$verifiedOutput = Join-Path $fixtureRoot "verified-provider-callbacks.jsonl"
$canonicalOutput = Join-Path $fixtureRoot "canonical-provider-callbacks.jsonl"
$adapterReport = Join-Path $logRoot "payment-provider-native-adapter-valid-$stamp.json"
$invalidVerifiedOutput = Join-Path $fixtureRoot "invalid-verified-provider-callbacks.jsonl"
$invalidCanonicalOutput = Join-Path $fixtureRoot "invalid-canonical-provider-callbacks.jsonl"
$invalidReport = Join-Path $logRoot "payment-provider-native-adapter-invalid-$stamp.json"
$replayReport = Join-Path $logRoot "payment-provider-native-adapter-replay-dryrun-$stamp.json"

& $nodeExe $adapterJs make-synthetic `
  --output $nativeInput `
  --invalid-output $invalidInput `
  --keys-dir $keysDir `
  --report $fixtureReport | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to generate synthetic native provider fixtures."
}

$fixture = Get-Content -LiteralPath $fixtureReport -Raw | ConvertFrom-Json

& "$PSScriptRoot\adapt-native-payment-provider-capture.ps1" `
  -InputFile $nativeInput `
  -VerifiedOutputFile $verifiedOutput `
  -CanonicalOutputFile $canonicalOutput `
  -AccountOwnerId $AccountOwnerId `
  -AlipayPublicKeyFile $fixture.alipay_public_key_file `
  -WeChatPayPlatformPublicKeyFile $fixture.wechat_platform_public_key_file `
  -WeChatPayApiV3Key $fixture.wechat_api_v3_key `
  -ReportPath $adapterReport | Out-Null

$adapter = Get-Content -LiteralPath $adapterReport -Raw | ConvertFrom-Json
Assert-True ($adapter.status -eq "ok") "Expected native adapter status ok."
Assert-True ($adapter.native.adapted -eq 3) "Expected native adapter to verify/decrypt 3 synthetic provider records."
Assert-True ($adapter.normalizer.normalized -eq 2) "Expected canonical normalizer to produce 2 paid callbacks."
Assert-True ($adapter.normalizer.skipped -eq 1) "Expected canonical normalizer to skip 1 non-paid callback."
Assert-True ($adapter.normalizer.failed -eq 0) "Expected canonical normalizer to have no failed records."

$canonicalRecords = @(Get-Content -LiteralPath $canonicalOutput | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })
Assert-True ($canonicalRecords.Count -eq 2) "Expected exactly 2 canonical callback records."

$alipay = $canonicalRecords | Where-Object { $_.provider -eq "alipay" } | Select-Object -First 1
$wechat = $canonicalRecords | Where-Object { $_.provider -eq "wechatpay" } | Select-Object -First 1
Assert-True ($null -ne $alipay) "Missing canonical Alipay callback."
Assert-True ($null -ne $wechat) "Missing canonical WeChat Pay callback."
Assert-True ($alipay.body.eventId -eq "synthetic-native-alipay-notify-001") "Alipay native signature adapter event mapping failed."
Assert-True ([int64]$alipay.body.amountCents -eq 2345) "Alipay native amount mapping failed."
Assert-True ($wechat.body.eventId -eq "synthetic-native-wechat-notify-001") "WeChat native notification id mapping failed."
Assert-True ([int64]$wechat.body.amountCents -eq 2345) "WeChat native amount mapping failed."

$oldPaymentSecret = $env:PAYMENT_WEBHOOK_SECRET
$env:PAYMENT_WEBHOOK_SECRET = "provider-native-adapter-synthetic-hmac-secret"
try {
  & "$PSScriptRoot\replay-payment-callbacks.ps1" `
    -InputFile $canonicalOutput `
    -ReportPath $replayReport | Out-Null
} finally {
  if ($null -eq $oldPaymentSecret) {
    Remove-Item Env:\PAYMENT_WEBHOOK_SECRET -ErrorAction SilentlyContinue
  } else {
    $env:PAYMENT_WEBHOOK_SECRET = $oldPaymentSecret
  }
}

$replay = Get-Content -LiteralPath $replayReport -Raw | ConvertFrom-Json
Assert-True ($replay.total -eq 2) "Expected replay dry-run to parse 2 canonical callbacks."
Assert-True ($replay.failed -eq 0) "Expected replay dry-run to have no invalid canonical callbacks."

$invalidBlocked = $false
try {
  & "$PSScriptRoot\adapt-native-payment-provider-capture.ps1" `
    -InputFile $invalidInput `
    -VerifiedOutputFile $invalidVerifiedOutput `
    -CanonicalOutputFile $invalidCanonicalOutput `
    -AccountOwnerId $AccountOwnerId `
    -AlipayPublicKeyFile $fixture.alipay_public_key_file `
    -WeChatPayPlatformPublicKeyFile $fixture.wechat_platform_public_key_file `
    -WeChatPayApiV3Key $fixture.wechat_api_v3_key `
    -ReportPath $invalidReport | Out-Null
} catch {
  $invalidBlocked = $true
}
Assert-True $invalidBlocked "Expected invalid native provider signatures to be blocked."

$invalidNativeReport = Join-Path (Split-Path -Parent $invalidReport) ([System.IO.Path]::GetFileNameWithoutExtension($invalidReport) + "-native.json")
$summary = [ordered]@{
  generated_at_utc = [DateTimeOffset]::UtcNow.ToString("O")
  status = "ok"
  fixture_root = $fixtureRoot
  fixture_report = $fixtureReport
  adapter_report = $adapterReport
  replay_report = $replayReport
  invalid_native_report = $invalidNativeReport
  canonical_output_file = $canonicalOutput
  canonical_count = $canonicalRecords.Count
  skipped_non_paid_count = $adapter.normalizer.skipped
  invalid_signatures_blocked = $invalidBlocked
  native_contract_scope = @(
    "Alipay RSA2 callback signature verification before canonical normalization",
    "WeChat Pay v3 callback RSA signature verification over timestamp, nonce, and raw body",
    "WeChat Pay v3 AEAD_AES_256_GCM resource decrypt before canonical normalization"
  )
}

$summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$summary | ConvertTo-Json -Depth 8
