param(
  [string]$InputFile = "",
  [string]$BaseUrl = "",
  [string]$Provider = "",
  [switch]$Execute,
  [switch]$SkipAudit,
  [switch]$StopOnFailure,
  [switch]$AllowSampleInput,
  [switch]$AllowInputOutsideReplayRoot,
  [switch]$AllowUnverifiedCapture,
  [string]$CaptureManifestFile = "",
  [string]$ReportDir = "",
  [switch]$DiscoverOnly,
  [string[]]$SearchRoot = @()
)

$ErrorActionPreference = "Stop"

$scriptBase = (Resolve-Path "$PSScriptRoot\..\..").Path
$scriptBaseParent = Split-Path -Parent $scriptBase
if ((Split-Path -Leaf $scriptBase) -eq "app" -and (Split-Path -Leaf $scriptBaseParent) -eq ".runtime") {
  $runtimeRoot = $scriptBase
  $runtimeStateRoot = $scriptBaseParent
  $repoRoot = if ($env:XIAOLOU_REPO_ROOT) { $env:XIAOLOU_REPO_ROOT } else { Split-Path -Parent $runtimeStateRoot }
} else {
  $repoRoot = $scriptBase
  $runtimeStateRoot = Join-Path $repoRoot ".runtime"
  $runtimeRoot = Join-Path $runtimeStateRoot "app"
}

if (-not $BaseUrl) {
  $BaseUrl = if ($env:CONTROL_API_BASE_URL) { $env:CONTROL_API_BASE_URL } else { "http://127.0.0.1:4100" }
}

if (-not $ReportDir) {
  $ReportDir = Join-Path $runtimeStateRoot "xiaolou-logs"
}

New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$summaryPath = Join-Path $ReportDir "payment-provider-staging-replay-$stamp.json"
$dryRunReport = Join-Path $ReportDir "payment-provider-replay-dryrun-$stamp.json"
$firstReplayReport = Join-Path $ReportDir "payment-provider-replay-execute-1-$stamp.json"
$secondReplayReport = Join-Path $ReportDir "payment-provider-replay-execute-2-$stamp.json"
$credentialRoot = Join-Path $runtimeRoot "credentials\payment"
$replayRoot = Join-Path $runtimeStateRoot "xiaolou-replay"

function Invoke-Step {
  param(
    [string]$Name,
    [scriptblock]$Action
  )

  Write-Host "==> $Name"
  & $Action
}

function Get-ReplayCaptureCandidates {
  param([string[]]$Roots)

  $items = New-Object System.Collections.Generic.List[object]
  foreach ($root in $Roots) {
    if (-not $root) {
      continue
    }

    $fullRoot = [System.IO.Path]::GetFullPath($root)
    if (-not (Test-Path -LiteralPath $fullRoot)) {
      continue
    }

    Get-ChildItem -LiteralPath $fullRoot -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
      $_.Extension -in @(".jsonl", ".ndjson")
    } | ForEach-Object {
      $fullPath = $_.FullName
      $normalized = $fullPath.ToLowerInvariant()
      $looksLikeProviderCapture = $normalized -match "payment|callback|provider|replay|webhook"
      if ($looksLikeProviderCapture) {
        $manifest = Get-CaptureManifestPath -InputPath $fullPath
        $items.Add([ordered]@{
          path = $fullPath
          root = $fullRoot
          length_bytes = $_.Length
          last_write_time_utc = $_.LastWriteTimeUtc.ToString("O")
          sample = [bool]($normalized -match "sample|example|fixture|test|dryrun|dry-run")
          has_manifest = [bool]$manifest
          manifest_path = $manifest
        }) | Out-Null
      }
    }
  }

  return $items.ToArray()
}

function Test-TruthyValue {
  param($Value)

  if ($null -eq $Value) {
    return $false
  }

  if ($Value -is [bool]) {
    return $Value
  }

  return "$Value" -match "^(1|true|yes|on)$"
}

function Test-PathUnderRoot {
  param(
    [string]$Path,
    [string]$Root
  )

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $fullRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd("\")
  return $fullPath -eq $fullRoot -or $fullPath.StartsWith($fullRoot + "\", [StringComparison]::OrdinalIgnoreCase)
}

function Get-Sha256Hex {
  param([string]$Path)

  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
      $hash = $sha.ComputeHash($stream)
      return -join ($hash | ForEach-Object { $_.ToString("x2") })
    } finally {
      $stream.Dispose()
    }
  } finally {
    $sha.Dispose()
  }
}

function Get-CaptureManifestPath {
  param([string]$InputPath)

  if ($CaptureManifestFile) {
    if (Test-Path -LiteralPath $CaptureManifestFile) {
      return (Resolve-Path -LiteralPath $CaptureManifestFile).Path
    }

    return $CaptureManifestFile
  }

  $full = [System.IO.Path]::GetFullPath($InputPath)
  $directory = Split-Path -Parent $full
  $fileName = Split-Path -Leaf $full
  $nameWithoutExtension = [System.IO.Path]::GetFileNameWithoutExtension($full)
  $candidates = @(
    "$full.manifest.json",
    (Join-Path $directory "$nameWithoutExtension.manifest.json"),
    (Join-Path $directory "$nameWithoutExtension.capture-manifest.json"),
    (Join-Path $directory "$fileName.manifest.json")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  return $null
}

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

function Get-CaptureEvidence {
  param([string]$Path)

  $fullPath = (Resolve-Path -LiteralPath $Path).Path
  $extension = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
  $normalized = $fullPath.ToLowerInvariant()
  $manifestPath = Get-CaptureManifestPath -InputPath $fullPath
  $manifest = $null
  $manifestErrors = New-Object System.Collections.Generic.List[string]
  $manifestVerified = $false

  if ($manifestPath -and (Test-Path -LiteralPath $manifestPath)) {
    try {
      $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
      foreach ($field in @(
        "operator_verified_real_capture",
        "merchant_credentials_configured",
        "contains_raw_provider_callbacks"
      )) {
        if (-not (Test-TruthyValue (Get-RecordProperty $manifest $field))) {
          $manifestErrors.Add("Manifest field '$field' must be true.") | Out-Null
        }
      }

      $manifestVerified = $manifestErrors.Count -eq 0
    } catch {
      $manifestErrors.Add("Manifest is not valid JSON: $($_.Exception.Message)") | Out-Null
    }
  } elseif ($manifestPath) {
    $manifestErrors.Add("Capture manifest file does not exist: $manifestPath") | Out-Null
  }

  $providers = New-Object System.Collections.Generic.HashSet[string]
  $totalRecords = 0
  $jsonErrors = New-Object System.Collections.Generic.List[string]
  $missingBody = 0
  $missingSignature = 0

  Get-Content -LiteralPath $fullPath | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      return
    }

    $totalRecords += 1
    try {
      $record = $line | ConvertFrom-Json
      $recordProvider = [string](Get-RecordProperty $record "provider")
      if ($Provider) {
        $recordProvider = $Provider
      }
      if ($recordProvider) {
        $providers.Add($recordProvider) | Out-Null
      }

      $rawBody = Get-RecordProperty $record "rawBody"
      $body = Get-RecordProperty $record "body"
      if ($null -eq $rawBody -and $null -eq $body) {
        $missingBody += 1
      }

      $headers = Get-RecordProperty $record "headers"
      $signature = Get-RecordProperty $record "signature"
      $hasHeaderSignature = $false
      if ($headers) {
        foreach ($property in $headers.PSObject.Properties) {
          if ($property.Name -match "signature|sign|serial|timestamp|nonce" -and "$($property.Value)") {
            $hasHeaderSignature = $true
            break
          }
        }
      }
      if (-not $signature -and -not $hasHeaderSignature) {
        $missingSignature += 1
      }
    } catch {
      $jsonErrors.Add("Line $totalRecords JSON parse failed: $($_.Exception.Message)") | Out-Null
    }
  }

  return [ordered]@{
    input_file = $fullPath
    length_bytes = (Get-Item -LiteralPath $fullPath).Length
    sha256 = Get-Sha256Hex -Path $fullPath
    extension = $extension
    under_replay_root = [bool](Test-PathUnderRoot -Path $fullPath -Root $replayRoot)
    sample = [bool]($normalized -match "sample|example|fixture|test|dryrun|dry-run")
    record_count = $totalRecords
    provider_count = $providers.Count
    providers = @($providers)
    missing_body_count = $missingBody
    missing_signature_count = $missingSignature
    json_error_count = $jsonErrors.Count
    json_errors = @($jsonErrors | Select-Object -First 10)
    manifest_path = $manifestPath
    manifest_present = [bool]($manifestPath -and (Test-Path -LiteralPath $manifestPath))
    manifest_verified = $manifestVerified
    manifest_errors = @($manifestErrors)
    manifest_template = [ordered]@{
      operator_verified_real_capture = $true
      merchant_credentials_configured = $true
      contains_raw_provider_callbacks = $true
      provider = "alipay-or-wechat"
      capture_environment = "staging-or-production"
      captured_at_utc = [DateTimeOffset]::UtcNow.ToString("O")
      operator = "<operator>"
      notes = "Do not include secrets in this manifest."
    }
  }
}

if ($SearchRoot.Count -eq 0) {
  $SearchRoot = @(
    (Join-Path $runtimeStateRoot "xiaolou-replay"),
    (Join-Path $runtimeStateRoot "xiaolou-logs"),
    (Join-Path $runtimeStateRoot "xiaolou-temp")
  )
}

if ($DiscoverOnly -or -not $InputFile) {
  $candidates = @(Get-ReplayCaptureCandidates -Roots $SearchRoot)
  $realCandidates = @($candidates | Where-Object { -not $_.sample })
  $discoverySummaryPath = Join-Path $ReportDir "payment-provider-staging-replay-discovery-$stamp.json"
  $status = if ($realCandidates.Count -gt 0) { "real_capture_found_input_required" } else { "missing_real_capture" }
  $nextAction = if ($realCandidates.Count -gt 0) {
    "Review the capture, confirm matching real merchant configuration, then rerun with -InputFile pointing at one approved provider JSONL capture."
  } else {
    "Provide operator-owned real Alipay/WeChat merchant configuration and place a real provider callback JSONL capture under .runtime\xiaolou-replay, then rerun with -InputFile."
  }
  $requiredInputs = @(
    "operator-provided real Alipay or WeChat Pay merchant/app account configuration",
    "runtime key/certificate files under $credentialRoot",
    "reviewed real callback JSONL or NDJSON capture under $replayRoot",
    "exact raw callback body bytes and provider signature headers",
    "staging Control API, PostgreSQL, wallet audit, and account/order mapping",
    "native Alipay/WeChat adapter or normalized canonical callback JSON signed with staging HMAC"
  )
  $missingInputs = @()
  if ($realCandidates.Count -eq 0) {
    $missingInputs += "real_callback_jsonl_capture"
  }
  $missingInputs += "operator_verified_real_merchant_credentials"

  $summary = [ordered]@{
    generated_at_utc = [DateTimeOffset]::UtcNow.ToString("O")
    status = $status
    base_url = $BaseUrl
    search_roots = @($SearchRoot)
    candidate_count = $candidates.Count
    real_candidate_count = $realCandidates.Count
    candidates = $candidates
    required_inputs = $requiredInputs
    missing_inputs = $missingInputs
    credential_root = $credentialRoot
    replay_root = $replayRoot
    repo_secret_policy = "Real provider merchant secrets and private callback captures are not expected in source control."
    current_control_api_callback_boundary = "The Windows-native .NET endpoint currently verifies normalized canonical callback JSON with Payments:{provider}:WebhookSecret and X-XiaoLou-Signature. Raw native Alipay/WeChat callback formats require an adapter or normalizer before direct replay."
    next_action = $nextAction
  }

  $summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $discoverySummaryPath -Encoding UTF8
  $summary | ConvertTo-Json -Depth 8
  return
}

if (-not (Test-Path -LiteralPath $InputFile)) {
  throw "Input file not found: $InputFile"
}

$inputEvidence = Get-CaptureEvidence -Path $InputFile
$inputBlockers = New-Object System.Collections.Generic.List[string]
$inputWarnings = New-Object System.Collections.Generic.List[string]

if ($inputEvidence.extension -notin @(".jsonl", ".ndjson")) {
  $inputBlockers.Add("Input capture must be .jsonl or .ndjson.") | Out-Null
}
if ($inputEvidence.json_error_count -gt 0) {
  $inputBlockers.Add("Input capture contains invalid JSONL records.") | Out-Null
}
if ($inputEvidence.record_count -eq 0) {
  $inputBlockers.Add("Input capture contains no replay records.") | Out-Null
}
if ($inputEvidence.missing_body_count -gt 0) {
  $inputBlockers.Add("Input capture has $($inputEvidence.missing_body_count) record(s) without rawBody/body.") | Out-Null
}
if ($inputEvidence.missing_signature_count -gt 0 -and -not $env:PAYMENT_WEBHOOK_SECRET) {
  $inputWarnings.Add("Input capture has $($inputEvidence.missing_signature_count) record(s) without captured signatures. Test HMAC replay requires PAYMENT_WEBHOOK_SECRET.") | Out-Null
}
if ($inputEvidence.sample -and -not $AllowSampleInput) {
  if ($Execute) {
    $inputBlockers.Add("Refusing to execute replay for a sample/test/fixture-looking capture. Pass -AllowSampleInput only for isolated local smoke.") | Out-Null
  } else {
    $inputWarnings.Add("Input looks like a sample/test/fixture capture and is not production evidence.") | Out-Null
  }
}
if (-not $inputEvidence.under_replay_root -and -not $AllowInputOutsideReplayRoot) {
  if ($Execute) {
    $inputBlockers.Add("Refusing to execute replay for input outside $replayRoot. Move the approved capture there or pass -AllowInputOutsideReplayRoot.") | Out-Null
  } else {
    $inputWarnings.Add("Input is outside $replayRoot and should not be treated as cutover evidence.") | Out-Null
  }
}
if (-not $inputEvidence.manifest_verified) {
  $detail = if ($inputEvidence.manifest_present) {
    "Capture manifest exists but is not verified: $($inputEvidence.manifest_errors -join '; ')"
  } else {
    "Capture manifest is missing. Create a sidecar manifest with operator_verified_real_capture, merchant_credentials_configured, and contains_raw_provider_callbacks set to true."
  }
  if ($Execute -and -not $AllowUnverifiedCapture) {
    $inputBlockers.Add($detail) | Out-Null
  } else {
    $inputWarnings.Add($detail) | Out-Null
  }
}

if ($inputBlockers.Count -gt 0) {
  $summary = [ordered]@{
    generated_at_utc = [DateTimeOffset]::UtcNow.ToString("O")
    status = "blocked"
    base_url = $BaseUrl
    input_file = (Resolve-Path -LiteralPath $InputFile).Path
    execute = [bool]$Execute
    input_evidence = $inputEvidence
    input_blockers = @($inputBlockers)
    input_warnings = @($inputWarnings)
  }
  $summary | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
  $summary | ConvertTo-Json -Depth 10
  throw "Payment provider replay input failed evidence gate. See $summaryPath"
}

$steps = New-Object System.Collections.Generic.List[object]

if (-not $SkipAudit) {
  Invoke-Step "Running pre-replay wallet ledger audit" {
    & "$PSScriptRoot\audit-wallet-ledger.ps1" -FailOnMismatch | Tee-Object -Variable auditOutput | Out-Null
    $steps.Add([ordered]@{
      name = "pre_audit"
      status = "ok"
      output = ($auditOutput -join "`n")
    }) | Out-Null
  }
}

Invoke-Step "Dry-run parsing provider callback capture" {
  $replayParams = @{
    InputFile = $InputFile
    BaseUrl = $BaseUrl
    ReportPath = $dryRunReport
  }
  if ($Provider) { $replayParams.Provider = $Provider }
  & "$PSScriptRoot\replay-payment-callbacks.ps1" @replayParams | Out-Null
  $steps.Add([ordered]@{
    name = "dry_run"
    status = "ok"
    report = $dryRunReport
  }) | Out-Null
}

if ($Execute) {
  Invoke-Step "Executing first provider callback replay" {
    $replayParams = @{
      InputFile = $InputFile
      BaseUrl = $BaseUrl
      ReportPath = $firstReplayReport
      Execute = $true
    }
    if ($Provider) { $replayParams.Provider = $Provider }
    if ($StopOnFailure) { $replayParams.StopOnFailure = $true }
    & "$PSScriptRoot\replay-payment-callbacks.ps1" @replayParams | Out-Null
    $steps.Add([ordered]@{
      name = "execute_1"
      status = "ok"
      report = $firstReplayReport
    }) | Out-Null
  }

  Invoke-Step "Executing second provider callback replay for idempotency" {
    $replayParams = @{
      InputFile = $InputFile
      BaseUrl = $BaseUrl
      ReportPath = $secondReplayReport
      Execute = $true
    }
    if ($Provider) { $replayParams.Provider = $Provider }
    if ($StopOnFailure) { $replayParams.StopOnFailure = $true }
    & "$PSScriptRoot\replay-payment-callbacks.ps1" @replayParams | Out-Null
    $steps.Add([ordered]@{
      name = "execute_2_idempotency"
      status = "ok"
      report = $secondReplayReport
    }) | Out-Null
  }

  if (-not $SkipAudit) {
    Invoke-Step "Running post-replay wallet ledger audit" {
      & "$PSScriptRoot\audit-wallet-ledger.ps1" -FailOnMismatch | Tee-Object -Variable auditOutput | Out-Null
      $steps.Add([ordered]@{
        name = "post_audit"
        status = "ok"
        output = ($auditOutput -join "`n")
      }) | Out-Null
    }

    Invoke-Step "Running wallet balance rebuild dry-run" {
      & "$PSScriptRoot\rebuild-wallet-balances-from-ledger.ps1" | Tee-Object -Variable rebuildOutput | Out-Null
      $steps.Add([ordered]@{
        name = "rebuild_dry_run"
        status = "ok"
        output = ($rebuildOutput -join "`n")
      }) | Out-Null
    }
  }
}

$summary = [ordered]@{
  generated_at_utc = [DateTimeOffset]::UtcNow.ToString("O")
  status = if ($inputWarnings.Count -gt 0) { "warning" } else { "ok" }
  base_url = $BaseUrl
  input_file = (Resolve-Path -LiteralPath $InputFile).Path
  provider_override = $Provider
  execute = [bool]$Execute
  skip_audit = [bool]$SkipAudit
  allow_sample_input = [bool]$AllowSampleInput
  allow_input_outside_replay_root = [bool]$AllowInputOutsideReplayRoot
  allow_unverified_capture = [bool]$AllowUnverifiedCapture
  input_evidence = $inputEvidence
  input_warnings = @($inputWarnings)
  steps = $steps
}

$summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
$summary | ConvertTo-Json -Depth 8
