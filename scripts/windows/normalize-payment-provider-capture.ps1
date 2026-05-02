param(
  [Parameter(Mandatory = $true)]
  [string]$InputFile,
  [string]$OutputFile = "",
  [ValidateSet("auto", "alipay-form", "wechat-v3-plaintext", "canonical")]
  [string]$InputFormat = "auto",
  [string]$Provider = "",
  [string]$AccountOwnerType = "user",
  [string]$AccountOwnerId = "",
  [string]$RegionCode = "CN",
  [string]$DefaultCurrency = "CNY",
  [decimal]$CreditPerYuan = 1.0,
  [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"

$scriptBase = (Resolve-Path "$PSScriptRoot\..\..").Path
$scriptBaseParent = Split-Path -Parent $scriptBase
if ((Split-Path -Leaf $scriptBase) -eq "app" -and (Split-Path -Leaf $scriptBaseParent) -eq ".runtime") {
  $runtimeStateRoot = $scriptBaseParent
} else {
  $runtimeStateRoot = Join-Path $scriptBase ".runtime"
}

if (-not (Test-Path -LiteralPath $InputFile)) {
  throw "Input file not found: $InputFile"
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
if (-not $OutputFile) {
  $OutputFile = Join-Path $runtimeStateRoot "xiaolou-temp\payment-provider-normalized-$stamp.jsonl"
}
if (-not $ReportPath) {
  $ReportPath = Join-Path $runtimeStateRoot "xiaolou-logs\payment-provider-normalizer-$stamp.json"
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputFile) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null

function Get-RecordProperty {
  param(
    $Object,
    [string]$Name
  )

  if ($null -eq $Object) {
    return $null
  }

  $property = $Object.PSObject.Properties[$Name]
  if ($property) {
    return $property.Value
  }

  return $null
}

function Test-Blank {
  param($Value)
  return $null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)
}

function First-NonBlank {
  param([object[]]$Values)

  foreach ($value in $Values) {
    if (-not (Test-Blank $value)) {
      return [string]$value
    }
  }

  return $null
}

function ConvertTo-StringMap {
  param($Object)

  $map = [ordered]@{}
  if ($null -eq $Object) {
    return $map
  }

  foreach ($property in $Object.PSObject.Properties) {
    if ($null -ne $property.Value) {
      $map[$property.Name] = [string]$property.Value
    }
  }

  return $map
}

function ConvertFrom-FormEncoded {
  param([string]$RawBody)

  $map = [ordered]@{}
  if ([string]::IsNullOrWhiteSpace($RawBody)) {
    return $map
  }

  foreach ($pair in $RawBody.Split("&")) {
    if ([string]::IsNullOrWhiteSpace($pair)) {
      continue
    }

    $parts = $pair.Split("=", 2)
    $key = [System.Net.WebUtility]::UrlDecode($parts[0])
    if ([string]::IsNullOrWhiteSpace($key)) {
      continue
    }

    $value = if ($parts.Count -gt 1) {
      [System.Net.WebUtility]::UrlDecode($parts[1])
    } else {
      ""
    }
    $map[$key] = $value
  }

  return $map
}

function Convert-MajorAmountToCents {
  param($Value)

  if (Test-Blank $Value) {
    throw "Missing provider amount."
  }

  $style = [System.Globalization.NumberStyles]::AllowDecimalPoint -bor [System.Globalization.NumberStyles]::AllowLeadingSign
  $amount = [decimal]::Parse(([string]$Value).Trim(), $style, [System.Globalization.CultureInfo]::InvariantCulture)
  return [int64][Math]::Round($amount * 100, 0, [System.MidpointRounding]::AwayFromZero)
}

function Convert-CentsToCredit {
  param([int64]$AmountCents)

  return [Math]::Round(([decimal]$AmountCents / 100) * $CreditPerYuan, 4, [System.MidpointRounding]::AwayFromZero)
}

function Convert-ProviderTime {
  param(
    [string]$Value,
    [switch]$AlipayLocalChinaTime
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $null
  }

  if ($AlipayLocalChinaTime) {
    $exact = [DateTime]::MinValue
    if ([DateTime]::TryParseExact(
      $Value,
      "yyyy-MM-dd HH:mm:ss",
      [System.Globalization.CultureInfo]::InvariantCulture,
      [System.Globalization.DateTimeStyles]::None,
      [ref]$exact)) {
      return ([DateTimeOffset]::new($exact, [TimeSpan]::FromHours(8))).ToString("O")
    }
  }

  $parsed = [DateTimeOffset]::MinValue
  if ([DateTimeOffset]::TryParse(
    $Value,
    [System.Globalization.CultureInfo]::InvariantCulture,
    [System.Globalization.DateTimeStyles]::AssumeUniversal,
    [ref]$parsed)) {
    return $parsed.ToString("O")
  }

  return $Value
}

function Get-EffectiveFormat {
  param(
    $Record,
    [string]$RecordProvider
  )

  if ($InputFormat -ne "auto") {
    return $InputFormat
  }

  $format = First-NonBlank @(
    (Get-RecordProperty $Record "format"),
    (Get-RecordProperty $Record "inputFormat"),
    (Get-RecordProperty $Record "providerFormat")
  )
  if ($format) {
    return $format
  }

  if ($RecordProvider -match "alipay") {
    return "alipay-form"
  }
  if ($RecordProvider -match "wechat|wxpay") {
    return "wechat-v3-plaintext"
  }

  $body = Get-RecordProperty $Record "body"
  if ($body -and (Get-RecordProperty $body "eventId")) {
    return "canonical"
  }

  throw "Unable to infer provider input format."
}

function Get-AlipayParams {
  param($Record)

  $params = Get-RecordProperty $Record "params"
  if ($params) {
    return ConvertTo-StringMap $params
  }

  $rawBody = Get-RecordProperty $Record "rawBody"
  if (-not (Test-Blank $rawBody)) {
    $text = [string]$rawBody
    if ($text.TrimStart().StartsWith("{")) {
      return ConvertTo-StringMap ($text | ConvertFrom-Json)
    }

    return ConvertFrom-FormEncoded $text
  }

  $body = Get-RecordProperty $Record "body"
  if ($body) {
    return ConvertTo-StringMap $body
  }

  throw "Alipay record is missing params, rawBody, or body."
}

function Get-WeChatPlaintext {
  param($Record)

  $plain = Get-RecordProperty $Record "decrypted"
  if (-not $plain) {
    $plain = Get-RecordProperty $Record "resourcePlaintext"
  }
  if (-not $plain) {
    $plain = Get-RecordProperty $Record "resource_plaintext"
  }

  $body = Get-RecordProperty $Record "body"
  if (-not $plain -and $body) {
    $plain = Get-RecordProperty $body "resourcePlaintext"
  }
  if (-not $plain -and $body) {
    $plain = Get-RecordProperty $body "resource_plaintext"
  }
  if (-not $plain -and $body) {
    $resource = Get-RecordProperty $body "resource"
    if ($resource) {
      $plain = Get-RecordProperty $resource "plaintext"
    }
  }
  if (-not $plain -and $body -and (Get-RecordProperty $body "out_trade_no")) {
    $plain = $body
  }

  if ($plain -is [string]) {
    return $plain | ConvertFrom-Json
  }
  if ($plain) {
    return $plain
  }

  throw "WeChat Pay record is missing decrypted resource plaintext. Native encrypted callbacks must be verified/decrypted by the adapter before this normalizer."
}

function New-CanonicalBody {
  param(
    [string]$ProviderName,
    [string]$EventId,
    [string]$MerchantOrderNo,
    [string]$ProviderTradeNo,
    [int64]$AmountCents,
    [string]$Currency,
    [string]$PaidAt,
    $Data
  )

  if (Test-Blank $EventId) {
    throw "Normalized callback is missing eventId."
  }
  if (Test-Blank $MerchantOrderNo) {
    throw "Normalized callback is missing merchantOrderNo."
  }
  if ($AmountCents -le 0) {
    throw "Normalized callback amountCents must be positive."
  }
  if (Test-Blank $AccountOwnerId) {
    throw "Pass -AccountOwnerId so normalized callbacks cannot float outside an explicit owner grant."
  }

  $body = [ordered]@{
    accountOwnerType = $AccountOwnerType
    accountOwnerId = $AccountOwnerId
    regionCode = $RegionCode
    currency = if ([string]::IsNullOrWhiteSpace($Currency)) { $DefaultCurrency } else { $Currency }
    eventId = $EventId
    merchantOrderNo = $MerchantOrderNo
    providerTradeNo = $ProviderTradeNo
    amountCents = $AmountCents
    creditAmount = Convert-CentsToCredit $AmountCents
    data = $Data
  }
  if (-not [string]::IsNullOrWhiteSpace($PaidAt)) {
    $body["paidAt"] = $PaidAt
  }

  return [ordered]@{
    provider = $ProviderName
    body = $body
    expectedStatus = 200
  }
}

function Convert-AlipayRecord {
  param(
    $Record,
    [string]$ProviderName
  )

  $params = Get-AlipayParams $Record
  $status = $params["trade_status"]
  $isPaid = $status -in @("TRADE_SUCCESS", "TRADE_FINISHED")
  if (-not $isPaid) {
    return [ordered]@{
      skipped = $true
      reason = "Alipay trade_status is not paid: $status"
      provider_status = $status
    }
  }

  $amountCents = Convert-MajorAmountToCents $params["total_amount"]
  $data = [ordered]@{
    normalizedFrom = "alipay-form"
    providerPaymentStatus = $status
    providerNotificationId = $params["notify_id"]
    transactionId = $params["trade_no"]
    appId = $params["app_id"]
    sellerId = $params["seller_id"]
    signType = $params["sign_type"]
    native = $params
  }

  return New-CanonicalBody `
    -ProviderName $ProviderName `
    -EventId (First-NonBlank @($params["notify_id"], $params["trade_no"], $params["out_trade_no"])) `
    -MerchantOrderNo $params["out_trade_no"] `
    -ProviderTradeNo $params["trade_no"] `
    -AmountCents $amountCents `
    -Currency (First-NonBlank @($params["currency"], $params["trans_currency"], $DefaultCurrency)) `
    -PaidAt (Convert-ProviderTime $params["gmt_payment"] -AlipayLocalChinaTime) `
    -Data $data
}

function Convert-WeChatRecord {
  param(
    $Record,
    [string]$ProviderName
  )

  $plain = Get-WeChatPlaintext $Record
  $body = Get-RecordProperty $Record "body"
  $notifyId = First-NonBlank @(
    (Get-RecordProperty $Record "id"),
    (Get-RecordProperty $body "id"),
    (Get-RecordProperty $plain "transaction_id"),
    (Get-RecordProperty $plain "out_trade_no")
  )
  $amount = Get-RecordProperty $plain "amount"
  if (-not $amount) {
    throw "WeChat Pay decrypted plaintext is missing amount."
  }

  $status = [string](Get-RecordProperty $plain "trade_state")
  if ($status -ne "SUCCESS") {
    return [ordered]@{
      skipped = $true
      reason = "WeChat Pay trade_state is not SUCCESS: $status"
      provider_status = $status
    }
  }

  $amountCents = [int64](Get-RecordProperty $amount "total")
  $currency = First-NonBlank @((Get-RecordProperty $amount "currency"), $DefaultCurrency)
  $data = [ordered]@{
    normalizedFrom = "wechat-v3-plaintext"
    providerPaymentStatus = $status
    providerNotificationId = $notifyId
    transactionId = (Get-RecordProperty $plain "transaction_id")
    appId = (Get-RecordProperty $plain "appid")
    mchId = (Get-RecordProperty $plain "mchid")
    tradeType = (Get-RecordProperty $plain "trade_type")
    native = $plain
  }

  return New-CanonicalBody `
    -ProviderName $ProviderName `
    -EventId $notifyId `
    -MerchantOrderNo (Get-RecordProperty $plain "out_trade_no") `
    -ProviderTradeNo (Get-RecordProperty $plain "transaction_id") `
    -AmountCents $amountCents `
    -Currency $currency `
    -PaidAt (Convert-ProviderTime ([string](Get-RecordProperty $plain "success_time"))) `
    -Data $data
}

function Convert-CanonicalRecord {
  param(
    $Record,
    [string]$ProviderName
  )

  $body = Get-RecordProperty $Record "body"
  if (-not $body) {
    $body = $Record
  }

  return [ordered]@{
    provider = $ProviderName
    body = $body
    expectedStatus = if ($null -ne (Get-RecordProperty $Record "expectedStatus")) { [int](Get-RecordProperty $Record "expectedStatus") } else { 200 }
  }
}

$normalizedLines = New-Object System.Collections.Generic.List[string]
$items = New-Object System.Collections.Generic.List[object]
$lineNumber = 0

Get-Content -LiteralPath $InputFile | ForEach-Object {
  $lineNumber += 1
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) {
    return
  }

  $item = [ordered]@{
    line = $lineNumber
    status = "ok"
    provider = $null
    input_format = $null
    output_provider = $null
    merchant_order_no = $null
    provider_trade_no = $null
    event_id = $null
    amount_cents = $null
    error = $null
  }

  try {
    $record = $line | ConvertFrom-Json
    $recordProvider = if ($Provider) { $Provider } else { First-NonBlank @((Get-RecordProperty $record "provider"), "unknown") }
    $format = Get-EffectiveFormat -Record $record -RecordProvider $recordProvider
    $item["provider"] = $recordProvider
    $item["input_format"] = $format

    $normalized = switch ($format) {
      "alipay-form" { Convert-AlipayRecord -Record $record -ProviderName $recordProvider }
      "wechat-v3-plaintext" { Convert-WeChatRecord -Record $record -ProviderName $recordProvider }
      "canonical" { Convert-CanonicalRecord -Record $record -ProviderName $recordProvider }
      default { throw "Unsupported input format: $format" }
    }

    if ($normalized.skipped) {
      $item["status"] = "skipped"
      $item["error"] = $normalized.reason
      $items.Add($item) | Out-Null
      return
    }

    $description = First-NonBlank @(
      (Get-RecordProperty $record "description"),
      "$format line $lineNumber"
    )
    $output = [ordered]@{
      description = $description
      provider = $normalized.provider
      body = $normalized.body
      expectedStatus = $normalized.expectedStatus
    }
    $normalizedLines.Add(($output | ConvertTo-Json -Compress -Depth 50)) | Out-Null
    $item["output_provider"] = $normalized.provider
    $item["merchant_order_no"] = $normalized.body.merchantOrderNo
    $item["provider_trade_no"] = $normalized.body.providerTradeNo
    $item["event_id"] = $normalized.body.eventId
    $item["amount_cents"] = $normalized.body.amountCents
  } catch {
    $item["status"] = "failed"
    $item["error"] = $_.Exception.Message
  }

  $items.Add($item) | Out-Null
}

if ($normalizedLines.Count -gt 0) {
  Set-Content -LiteralPath $OutputFile -Encoding UTF8 -Value $normalizedLines
} else {
  Set-Content -LiteralPath $OutputFile -Encoding UTF8 -Value @()
}

$failed = @($items | Where-Object { $_.status -eq "failed" })
$skipped = @($items | Where-Object { $_.status -eq "skipped" })
$report = [ordered]@{
  generated_at_utc = [DateTimeOffset]::UtcNow.ToString("O")
  status = if ($failed.Count -gt 0) { "failed" } elseif ($skipped.Count -gt 0) { "warning" } else { "ok" }
  input_file = (Resolve-Path -LiteralPath $InputFile).Path
  output_file = [System.IO.Path]::GetFullPath($OutputFile)
  input_format = $InputFormat
  account_owner_type = $AccountOwnerType
  account_owner_id = $AccountOwnerId
  region_code = $RegionCode
  default_currency = $DefaultCurrency
  credit_per_yuan = $CreditPerYuan
  total = $items.Count
  normalized = $normalizedLines.Count
  skipped = $skipped.Count
  failed = $failed.Count
  items = $items
}

$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 10

if ($failed.Count -gt 0) {
  throw "Payment provider normalization failed for $($failed.Count) item(s). See $ReportPath"
}
