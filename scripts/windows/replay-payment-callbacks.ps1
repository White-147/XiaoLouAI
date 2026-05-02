param(
  [string]$InputFile = "",
  [string]$BaseUrl = "",
  [string]$Provider = "",
  [string]$SignatureHeader = "X-XiaoLou-Signature",
  [switch]$Execute,
  [switch]$StopOnFailure,
  [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"

if (-not $InputFile) {
  throw "Pass -InputFile with a JSONL capture file. Each line must contain provider, rawBody/body, and signature/headers."
}

if (-not (Test-Path -LiteralPath $InputFile)) {
  throw "Input file not found: $InputFile"
}

if (-not $BaseUrl) {
  $BaseUrl = if ($env:CONTROL_API_BASE_URL) { $env:CONTROL_API_BASE_URL } else { "http://127.0.0.1:4100" }
}

if (-not $ReportPath) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $scriptBase = (Resolve-Path "$PSScriptRoot\..\..").Path
  $scriptBaseParent = Split-Path -Parent $scriptBase
  if ((Split-Path -Leaf $scriptBase) -eq "app" -and (Split-Path -Leaf $scriptBaseParent) -eq ".runtime") {
    $runtimeStateRoot = $scriptBaseParent
  } else {
    $runtimeStateRoot = Join-Path $scriptBase ".runtime"
  }
  $ReportPath = Join-Path $runtimeStateRoot "xiaolou-logs\payment-callback-replay-$stamp.json"
}

function New-HmacSignature {
  param(
    [string]$Body,
    [string]$Secret
  )

  $secretBytes = [System.Text.Encoding]::UTF8.GetBytes($Secret)
  $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
  $hmac = [System.Security.Cryptography.HMACSHA256]::new($secretBytes)
  try {
    $hash = $hmac.ComputeHash($bodyBytes)
    return -join ($hash | ForEach-Object { $_.ToString("x2") })
  } finally {
    $hmac.Dispose()
  }
}

function Get-PropertyValue {
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

function Convert-Headers {
  param($Headers)

  $result = @{}
  if ($null -eq $Headers) {
    return $result
  }

  foreach ($property in $Headers.PSObject.Properties) {
    if ($null -ne $property.Value -and "$($property.Value)".Length -gt 0) {
      $result[$property.Name] = [string]$property.Value
    }
  }

  return $result
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null

$items = New-Object System.Collections.Generic.List[object]
$lineNumber = 0

Get-Content -LiteralPath $InputFile | ForEach-Object {
  $lineNumber += 1
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) {
    return
  }

  $record = $line | ConvertFrom-Json
  $recordProvider = if ($Provider) { $Provider } else { [string](Get-PropertyValue $record "provider") }
  if ([string]::IsNullOrWhiteSpace($recordProvider)) {
    throw "Line $lineNumber is missing provider."
  }

  $rawBody = Get-PropertyValue $record "rawBody"
  if ($null -eq $rawBody) {
    $body = Get-PropertyValue $record "body"
    if ($null -eq $body) {
      throw "Line $lineNumber is missing rawBody or body."
    }

    $rawBody = $body | ConvertTo-Json -Compress -Depth 50
  }

  $headers = Convert-Headers (Get-PropertyValue $record "headers")
  $signature = Get-PropertyValue $record "signature"
  if (-not $signature -and $headers.ContainsKey($SignatureHeader)) {
    $signature = $headers[$SignatureHeader]
  }

  if (-not $signature -and $env:PAYMENT_WEBHOOK_SECRET) {
    $signature = New-HmacSignature ([string]$rawBody) $env:PAYMENT_WEBHOOK_SECRET
  }

  if ($signature) {
    $headers[$SignatureHeader] = [string]$signature
  }

  $expectedStatus = Get-PropertyValue $record "expectedStatus"
  if ($null -eq $expectedStatus) {
    $expectedStatus = 200
  }

  $item = [ordered]@{
    line = $lineNumber
    provider = $recordProvider
    description = [string](Get-PropertyValue $record "description")
    expected_status = [int]$expectedStatus
    has_signature = -not [string]::IsNullOrWhiteSpace([string]$signature)
    dry_run = -not [bool]$Execute
    status = "planned"
    http_status = $null
    response = $null
    error = $null
  }

  if (-not $item["has_signature"]) {
    $item["status"] = "invalid"
    $item["error"] = "Missing captured signature. Add signature/headers or set PAYMENT_WEBHOOK_SECRET for test HMAC replay."
    $items.Add($item) | Out-Null
    if ($StopOnFailure) { throw "Line $lineNumber missing signature." }
    return
  }

  if (-not $Execute) {
    $items.Add($item) | Out-Null
    return
  }

  try {
    $response = Invoke-WebRequest `
      -Method Post `
      -Uri ($BaseUrl.TrimEnd("/") + "/api/payments/callbacks/$recordProvider") `
      -ContentType "application/json" `
      -Headers $headers `
      -Body ([string]$rawBody) `
      -TimeoutSec 30
    $item["http_status"] = [int]$response.StatusCode
    $item["response"] = $response.Content
  } catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $item["http_status"] = [int]$_.Exception.Response.StatusCode
    }

    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      $item["response"] = $_.ErrorDetails.Message
    } else {
      $item["error"] = $_.Exception.Message
    }
  }

  if ($item["http_status"] -eq $item["expected_status"]) {
    $item["status"] = "ok"
  } else {
    $item["status"] = "failed"
    if (-not $item["error"]) {
      $expected = $item["expected_status"]
      $actual = $item["http_status"]
      $item["error"] = "Expected HTTP $expected, got HTTP $actual"
    }
  }

  $items.Add($item) | Out-Null
  if ($StopOnFailure -and $item["status"] -ne "ok") {
    throw "Replay failed on line $lineNumber. See $ReportPath"
  }
}

$failed = @($items | Where-Object { $_.status -in @("failed", "invalid") })
$report = [ordered]@{
  generated_at_utc = [DateTimeOffset]::UtcNow.ToString("O")
  base_url = $BaseUrl
  input_file = (Resolve-Path $InputFile).Path
  execute = [bool]$Execute
  total = $items.Count
  failed = $failed.Count
  items = $items
}

$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 8

if ($Execute -and $failed.Count -gt 0) {
  throw "Payment callback replay finished with $($failed.Count) failed item(s). See $ReportPath"
}
