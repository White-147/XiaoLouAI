param(
  [string]$AccountOwnerId = "",
  [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"

. "$PSScriptRoot\load-env.ps1"

if (-not $AccountOwnerId) {
  $AccountOwnerId = "provider-normalizer-synthetic-owner"
}

$runtimeRoot = [Environment]::GetEnvironmentVariable("XIAOLOU_RUNTIME_ROOT", "Process")
if (-not $runtimeRoot) {
  throw "XIAOLOU_RUNTIME_ROOT is not set."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$fixtureRoot = Join-Path $runtimeRoot "xiaolou-temp\payment-provider-normalizer-fixtures\$stamp"
$logRoot = Join-Path $runtimeRoot "xiaolou-logs"
New-Item -ItemType Directory -Force -Path $fixtureRoot | Out-Null
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

if (-not $ReportPath) {
  $ReportPath = Join-Path $logRoot "payment-provider-normalizer-contract-$stamp.json"
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

function ConvertTo-JsonLine {
  param($Value)
  return ($Value | ConvertTo-Json -Compress -Depth 50)
}

$inputPath = Join-Path $fixtureRoot "synthetic-provider-callbacks.jsonl"
$normalizedPath = Join-Path $fixtureRoot "normalized-canonical-callbacks.jsonl"
$normalizerReport = Join-Path $logRoot "payment-provider-normalizer-fixture-$stamp.json"
$replayReport = Join-Path $logRoot "payment-provider-normalizer-replay-dryrun-$stamp.json"

$alipayRawBody = "notify_id=synthetic-alipay-notify-001&out_trade_no=synthetic-alipay-order-001&trade_no=2026050222000000000001&total_amount=12.34&trade_status=TRADE_SUCCESS&gmt_payment=2026-05-02+14%3A10%3A11&app_id=synthetic-alipay-app&seller_id=synthetic-alipay-seller&sign_type=RSA2&sign=synthetic-signature"
$alipayPendingRawBody = "notify_id=synthetic-alipay-notify-pending&out_trade_no=synthetic-alipay-order-pending&trade_no=2026050222000000000002&total_amount=9.99&trade_status=WAIT_BUYER_PAY&gmt_payment=2026-05-02+14%3A12%3A13&app_id=synthetic-alipay-app&seller_id=synthetic-alipay-seller&sign_type=RSA2&sign=synthetic-signature"

$wechatRecord = [ordered]@{
  description = "synthetic wechat pay v3 decrypted success callback"
  provider = "wechatpay"
  format = "wechat-v3-plaintext"
  body = [ordered]@{
    id = "synthetic-wechat-notify-001"
    resource_plaintext = [ordered]@{
      appid = "wxsyntheticappid"
      mchid = "1900000000"
      out_trade_no = "synthetic-wechat-order-001"
      transaction_id = "4200000000202605020000000001"
      trade_type = "JSAPI"
      trade_state = "SUCCESS"
      trade_state_desc = "payment success"
      success_time = "2026-05-02T14:11:12+08:00"
      amount = [ordered]@{
        total = 1234
        payer_total = 1234
        currency = "CNY"
        payer_currency = "CNY"
      }
    }
  }
  headers = [ordered]@{
    "Wechatpay-Timestamp" = "1777702272"
    "Wechatpay-Nonce" = "syntheticnonce"
    "Wechatpay-Serial" = "SYNTHETICPLATFORMSERIAL"
    "Wechatpay-Signature" = "synthetic-signature"
  }
}

$lines = @(
  (ConvertTo-JsonLine ([ordered]@{
    description = "synthetic alipay async success callback"
    provider = "alipay"
    format = "alipay-form"
    rawBody = $alipayRawBody
  })),
  (ConvertTo-JsonLine $wechatRecord),
  (ConvertTo-JsonLine ([ordered]@{
    description = "synthetic alipay pending callback should be skipped"
    provider = "alipay"
    format = "alipay-form"
    rawBody = $alipayPendingRawBody
  }))
)
Set-Content -LiteralPath $inputPath -Encoding UTF8 -Value $lines

$normalizerOutput = & "$PSScriptRoot\normalize-payment-provider-capture.ps1" `
  -InputFile $inputPath `
  -OutputFile $normalizedPath `
  -AccountOwnerId $AccountOwnerId `
  -ReportPath $normalizerReport
$normalizer = Get-Content -LiteralPath $normalizerReport -Raw | ConvertFrom-Json

Assert-True ($normalizer.status -eq "warning") "Expected normalizer warning status because one synthetic non-paid callback is skipped."
Assert-True ($normalizer.total -eq 3) "Expected 3 synthetic input records."
Assert-True ($normalizer.normalized -eq 2) "Expected exactly 2 normalized paid callbacks."
Assert-True ($normalizer.skipped -eq 1) "Expected exactly 1 skipped non-paid callback."
Assert-True ($normalizer.failed -eq 0) "Expected no failed normalization records."

$normalizedRecords = @(Get-Content -LiteralPath $normalizedPath | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })
Assert-True ($normalizedRecords.Count -eq 2) "Expected 2 normalized JSONL records."

$alipay = $normalizedRecords | Where-Object { $_.provider -eq "alipay" } | Select-Object -First 1
$wechat = $normalizedRecords | Where-Object { $_.provider -eq "wechatpay" } | Select-Object -First 1
Assert-True ($null -ne $alipay) "Missing normalized Alipay record."
Assert-True ($null -ne $wechat) "Missing normalized WeChat Pay record."

Assert-True ($alipay.body.eventId -eq "synthetic-alipay-notify-001") "Alipay eventId did not use notify_id."
Assert-True ($alipay.body.merchantOrderNo -eq "synthetic-alipay-order-001") "Alipay merchant order mapping failed."
Assert-True ($alipay.body.providerTradeNo -eq "2026050222000000000001") "Alipay provider trade mapping failed."
Assert-True ([int64]$alipay.body.amountCents -eq 1234) "Alipay total_amount cents conversion failed."
Assert-True ([decimal]$alipay.body.creditAmount -eq 12.34) "Alipay credit amount conversion failed."
Assert-True ($alipay.body.data.providerPaymentStatus -eq "TRADE_SUCCESS") "Alipay paid status was not preserved."

Assert-True ($wechat.body.eventId -eq "synthetic-wechat-notify-001") "WeChat eventId did not use notification id."
Assert-True ($wechat.body.merchantOrderNo -eq "synthetic-wechat-order-001") "WeChat merchant order mapping failed."
Assert-True ($wechat.body.providerTradeNo -eq "4200000000202605020000000001") "WeChat transaction mapping failed."
Assert-True ([int64]$wechat.body.amountCents -eq 1234) "WeChat amount.total mapping failed."
Assert-True ([decimal]$wechat.body.creditAmount -eq 12.34) "WeChat credit amount conversion failed."
Assert-True ($wechat.body.data.providerPaymentStatus -eq "SUCCESS") "WeChat paid status was not preserved."

$oldPaymentSecret = $env:PAYMENT_WEBHOOK_SECRET
$env:PAYMENT_WEBHOOK_SECRET = "provider-normalizer-synthetic-hmac-secret"
try {
  & "$PSScriptRoot\replay-payment-callbacks.ps1" `
    -InputFile $normalizedPath `
    -ReportPath $replayReport | Out-Null
} finally {
  if ($null -eq $oldPaymentSecret) {
    Remove-Item Env:\PAYMENT_WEBHOOK_SECRET -ErrorAction SilentlyContinue
  } else {
    $env:PAYMENT_WEBHOOK_SECRET = $oldPaymentSecret
  }
}

$replay = Get-Content -LiteralPath $replayReport -Raw | ConvertFrom-Json
Assert-True ($replay.total -eq 2) "Expected replay dry-run to parse 2 normalized records."
Assert-True ($replay.failed -eq 0) "Expected replay dry-run to have no invalid records."
foreach ($item in $replay.items) {
  Assert-True ($item.has_signature -eq $true) "Replay dry-run did not synthesize HMAC signature for line $($item.line)."
}

$summary = [ordered]@{
  generated_at_utc = [DateTimeOffset]::UtcNow.ToString("O")
  status = "ok"
  fixture_root = $fixtureRoot
  input_file = $inputPath
  normalized_file = $normalizedPath
  normalizer_report = $normalizerReport
  replay_report = $replayReport
  normalized_count = $normalizedRecords.Count
  skipped_non_paid_count = $normalizer.skipped
  official_contract_scope = @(
    "alipay async form callback mapping after RSA verification",
    "wechat pay v3 decrypted resource plaintext mapping after callback signature verification and AES-256-GCM decrypt"
  )
}

$summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$summary | ConvertTo-Json -Depth 8
