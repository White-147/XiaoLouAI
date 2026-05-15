param(
  [string]$RepoRoot = "",
  [string]$BaseUrl = "",
  [string]$ReportPath = "",
  [string]$ClientApiToken = "",
  [string]$ClientApiTokenHeader = "",
  [string]$ObjectContentPath = "",
  [int]$SampleCount = 5,
  [int]$StaticP95Ms = 800,
  [int]$ApiP95Ms = 1000,
  [int]$ObjectReadP95Ms = 1200,
  [int]$ActiveJobPollP95Ms = 1000,
  [int]$ActiveJobPollIntervalMinMs = 1500,
  [long]$MaxPublicUploadBytes = 268435456,
  [int]$PostgresMaxConnections = 200,
  [int]$PostgresReservedConnections = 20,
  [int]$ControlApiInstances = 1,
  [int]$ClosedApiWorkerInstances = 1,
  [int]$LocalModelWorkerInstances = 1,
  [int]$LegacyCompatInstances = 0,
  [int]$MinimumWorkerLeaseThroughputPerMinute = 12,
  [switch]$RunHttp,
  [switch]$RunRateLimitProbe,
  [switch]$Strict
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
}
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path

if (-not $BaseUrl) {
  $BaseUrl = if ($env:PUBLIC_BASE_URL) {
    $env:PUBLIC_BASE_URL
  } elseif ($env:CONTROL_API_BASE_URL) {
    $env:CONTROL_API_BASE_URL
  } else {
    "http://127.0.0.1:4100"
  }
}
$BaseUrl = $BaseUrl.TrimEnd("/")

if (-not $ReportPath) {
  $logDir = [Environment]::GetEnvironmentVariable("LOG_DIR", "Process")
  if (-not $logDir) {
    $logDir = Join-Path $RepoRoot ".runtime\xiaolou-logs"
  }
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $ReportPath = Join-Path $logDir "public-access-capacity-$stamp.json"
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null

function New-List {
  return New-Object System.Collections.Generic.List[object]
}

function Add-Item {
  param(
    [System.Collections.Generic.List[object]]$List,
    [string]$Name,
    [string]$Status,
    [string]$Detail,
    [object]$Data = $null
  )

  $entry = [ordered]@{
    name = $Name
    status = $Status
    detail = $Detail
  }
  if ($null -ne $Data) {
    $entry["data"] = $Data
  }
  $List.Add($entry) | Out-Null
}

function Add-Check {
  param([string]$Name, [string]$Status, [string]$Detail, [object]$Data = $null)
  Add-Item $script:checks $Name $Status $Detail $Data
}

function Add-Warning {
  param([string]$Name, [string]$Detail, [object]$Data = $null)
  if ($Strict) {
    Add-Item $script:blockers $Name "failed" $Detail $Data
  } else {
    Add-Item $script:warnings $Name "warning" $Detail $Data
  }
}

function Add-Blocker {
  param([string]$Name, [string]$Detail, [object]$Data = $null)
  Add-Item $script:blockers $Name "failed" $Detail $Data
}

function Read-EnvFile {
  param([string]$Path)

  $values = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $values
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }

    $parts = $trimmed.Split("=", 2)
    if ($parts.Count -ne 2) {
      continue
    }

    $name = $parts[0].Trim()
    if (-not $name) {
      continue
    }
    if (-not $values.ContainsKey($name)) {
      $values[$name] = $parts[1].Trim()
    }
  }

  return $values
}

function Get-EnvSetting {
  param(
    [hashtable[]]$EnvMaps,
    [string[]]$Names,
    [string]$Default = ""
  )

  foreach ($name in $Names) {
    $value = [Environment]::GetEnvironmentVariable($name, "Process")
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return $value.Trim()
    }
  }

  foreach ($map in $EnvMaps) {
    foreach ($name in $Names) {
      if ($map.ContainsKey($name) -and -not [string]::IsNullOrWhiteSpace($map[$name])) {
        return $map[$name].Trim()
      }
    }
  }

  return $Default
}

function Get-IntSetting {
  param(
    [hashtable[]]$EnvMaps,
    [string[]]$Names,
    [int]$Default
  )

  $raw = Get-EnvSetting $EnvMaps $Names ""
  $parsed = 0
  if ([int]::TryParse($raw, [ref]$parsed)) {
    return $parsed
  }
  return $Default
}

function Get-LongSetting {
  param(
    [hashtable[]]$EnvMaps,
    [string[]]$Names,
    [long]$Default
  )

  $raw = Get-EnvSetting $EnvMaps $Names ""
  $parsed = 0L
  if ([long]::TryParse($raw, [ref]$parsed)) {
    return $parsed
  }
  return $Default
}

function Get-PostgresPoolSize {
  param([hashtable[]]$EnvMaps)

  $configured = Get-IntSetting $EnvMaps @("Postgres__MaximumPoolSize") 0
  if ($configured -gt 0) {
    return $configured
  }

  $connectionString = Get-EnvSetting $EnvMaps @("ConnectionStrings__Postgres", "DATABASE_URL") ""
  if ($connectionString) {
    $decoded = [System.Uri]::UnescapeDataString($connectionString)
    $match = [regex]::Match($decoded, "(?i)(Maximum Pool Size|Max Pool Size|maximum pool size|max pool size)\s*[=]\s*(\d+)")
    if ($match.Success) {
      return [int]$match.Groups[2].Value
    }
  }

  return 100
}

function Get-FirstAssetPath {
  $assetsDir = Join-Path $RepoRoot "XIAOLOU-main\dist\assets"
  if (-not (Test-Path -LiteralPath $assetsDir)) {
    return ""
  }

  $asset = Get-ChildItem -LiteralPath $assetsDir -File |
    Where-Object { $_.Extension -in @(".js", ".css") } |
    Sort-Object Length -Descending |
    Select-Object -First 1
  if (-not $asset) {
    return ""
  }

  return "/assets/$($asset.Name)"
}

function Get-PlaygroundPollIntervalMs {
  $playgroundPath = Join-Path $RepoRoot "XIAOLOU-main\src\features\playground\Playground.tsx"
  if (-not (Test-Path -LiteralPath $playgroundPath)) {
    return 0
  }

  $text = Get-Content -LiteralPath $playgroundPath -Raw
  $match = [regex]::Match($text, "setInterval\([\s\S]*?,\s*(\d+)\s*\)")
  if ($match.Success) {
    return [int]$match.Groups[1].Value
  }

  return 0
}

function Get-Percentile {
  param(
    [double[]]$Values,
    [double]$Percentile
  )

  if (-not $Values -or $Values.Count -eq 0) {
    return 0
  }

  $sorted = @($Values | Sort-Object)
  $index = [Math]::Ceiling(($Percentile / 100.0) * $sorted.Count) - 1
  $index = [Math]::Max(0, [Math]::Min($sorted.Count - 1, $index))
  return [Math]::Round([double]$sorted[$index], 2)
}

function New-CapacityHeaders {
  param(
    [string]$Path,
    [switch]$AcceptCompression,
    [string]$Range = "",
    [string]$IfNoneMatch = ""
  )

  $headers = @{}
  if ($AcceptCompression) {
    $headers["Accept-Encoding"] = "gzip"
  }
  if ($Range) {
    $headers["Range"] = $Range
  }
  if ($IfNoneMatch) {
    $headers["If-None-Match"] = $IfNoneMatch
  }
  if ($Path -match "^/api/" -and $ClientApiToken) {
    $headers[$ClientApiTokenHeader] = $ClientApiToken
  }
  return $headers
}

function Resolve-RequestUri {
  param([string]$Path)

  if ($Path -match "^https?://") {
    return $Path
  }

  if (-not $Path.StartsWith("/")) {
    $Path = "/" + $Path
  }
  return $BaseUrl + $Path
}

function Invoke-CapacityRequest {
  param(
    [string]$Method,
    [string]$Path,
    [hashtable]$Headers = @{},
    [string]$Body = "",
    [string]$ContentType = "application/json",
    [int]$TimeoutSec = 15
  )

  $handler = [System.Net.Http.HttpClientHandler]::new()
  $handler.AutomaticDecompression = [System.Net.DecompressionMethods]::None
  $client = [System.Net.Http.HttpClient]::new($handler)
  $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSec)
  $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($Method), (Resolve-RequestUri $Path))
  foreach ($key in $Headers.Keys) {
    [void]$request.Headers.TryAddWithoutValidation($key, [string]$Headers[$key])
  }
  if ($Body) {
    $request.Content = [System.Net.Http.StringContent]::new($Body, [System.Text.Encoding]::UTF8, $ContentType)
  }

  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $response = $client.SendAsync($request).GetAwaiter().GetResult()
    $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    $stopwatch.Stop()
    $headersOut = @{}
    foreach ($header in $response.Headers.GetEnumerator()) {
      $headersOut[$header.Key] = ($header.Value -join ", ")
    }
    foreach ($header in $response.Content.Headers.GetEnumerator()) {
      $headersOut[$header.Key] = ($header.Value -join ", ")
    }
    return [ordered]@{
      method = $Method
      path = $Path
      statusCode = [int]$response.StatusCode
      durationMs = [Math]::Round($stopwatch.Elapsed.TotalMilliseconds, 2)
      headers = $headersOut
      bodyBytes = $bytes.Length
      error = $null
    }
  } catch {
    $stopwatch.Stop()
    return [ordered]@{
      method = $Method
      path = $Path
      statusCode = 0
      durationMs = [Math]::Round($stopwatch.Elapsed.TotalMilliseconds, 2)
      headers = @{}
      bodyBytes = 0
      error = $_.Exception.Message
    }
  } finally {
    $request.Dispose()
    $client.Dispose()
    $handler.Dispose()
  }
}

function Invoke-SampledGet {
  param(
    [string]$Name,
    [string]$Path,
    [int]$P95ThresholdMs,
    [hashtable]$Headers = @{}
  )

  $samples = New-List
  for ($i = 0; $i -lt [Math]::Max(1, $SampleCount); $i++) {
    $samples.Add((Invoke-CapacityRequest -Method "GET" -Path $Path -Headers $Headers)) | Out-Null
  }

  $durations = @($samples | ForEach-Object { [double]$_.durationMs })
  $success = @($samples | Where-Object { $_.statusCode -ge 200 -and $_.statusCode -lt 400 }).Count
  $p95 = Get-Percentile $durations 95
  $data = [ordered]@{
    path = $Path
    sampleCount = $samples.Count
    successCount = $success
    p95Ms = $p95
    thresholdMs = $P95ThresholdMs
    firstStatusCode = if ($samples.Count -gt 0) { [int]$samples[0].statusCode } else { 0 }
    firstHeaders = if ($samples.Count -gt 0) { $samples[0].headers } else { @{} }
    samples = $samples
  }

  if ($success -ne $samples.Count) {
    Add-Blocker $Name "Expected all sampled requests to return 2xx/3xx." $data
  } elseif ($p95 -gt $P95ThresholdMs) {
    Add-Blocker $Name "p95 latency exceeded threshold." $data
  } else {
    Add-Check $Name "ok" "p95 latency is within threshold." $data
  }

  return $data
}

$runtimeEnv = Read-EnvFile (Join-Path $RepoRoot ".runtime\app\scripts\windows\.env.windows")
$checkoutEnv = Read-EnvFile (Join-Path $RepoRoot "scripts\windows\.env.windows")
$exampleEnv = Read-EnvFile (Join-Path $RepoRoot "scripts\windows\.env.windows.example")
$envMaps = @($runtimeEnv, $checkoutEnv, $exampleEnv)

if (-not $ClientApiToken) {
  $ClientApiToken = Get-EnvSetting $envMaps @("CLIENT_API_TOKEN") ""
  if ($ClientApiToken -match "change-me|example\.invalid") {
    $ClientApiToken = ""
  }
}
if (-not $ClientApiTokenHeader) {
  $ClientApiTokenHeader = Get-EnvSetting $envMaps @("CLIENT_API_TOKEN_HEADER", "ClientApi__TokenHeader") "X-XiaoLou-Client-Token"
}

$script:checks = New-List
$script:warnings = New-List
$script:blockers = New-List
$metrics = [ordered]@{}

$poolSize = Get-PostgresPoolSize $envMaps
$postgresMaxFromEnv = Get-IntSetting $envMaps @("POSTGRES_MAX_CONNECTIONS") 0
if ($postgresMaxFromEnv -gt 0 -and $PostgresMaxConnections -eq 200) {
  $PostgresMaxConnections = $postgresMaxFromEnv
}
$availablePostgres = [Math]::Max(0, $PostgresMaxConnections - $PostgresReservedConnections)
$postgresPoolProcesses = $ControlApiInstances + $ClosedApiWorkerInstances + $LegacyCompatInstances
$postgresDemand = $postgresPoolProcesses * $poolSize
$postgresMargin = $availablePostgres - $postgresDemand
$metrics["postgres_pool_budget"] = [ordered]@{
  perProcessPoolSize = $poolSize
  controlApiInstances = $ControlApiInstances
  closedApiWorkerInstances = $ClosedApiWorkerInstances
  localModelWorkerInstances = $LocalModelWorkerInstances
  legacyCompatInstances = $LegacyCompatInstances
  postgresPoolProcesses = $postgresPoolProcesses
  postgresMaxConnections = $PostgresMaxConnections
  reservedConnections = $PostgresReservedConnections
  availableConnections = $availablePostgres
  projectedDemand = $postgresDemand
  margin = $postgresMargin
}
if ($postgresDemand -gt $availablePostgres) {
  Add-Blocker "postgres-pool-budget" "Projected per-process pool demand exceeds available PostgreSQL connections." $metrics["postgres_pool_budget"]
} elseif ($availablePostgres -gt 0 -and ($postgresMargin / [double]$availablePostgres) -lt 0.10) {
  Add-Warning "postgres-pool-budget" "Projected PostgreSQL connection margin is below 10%." $metrics["postgres_pool_budget"]
} else {
  Add-Check "postgres-pool-budget" "ok" "Projected PostgreSQL connection demand fits the configured budget." $metrics["postgres_pool_budget"]
}

$closedBatchSize = Get-IntSetting $envMaps @("ClosedApiWorker__BatchSize", "CLOSED_API_WORKER_BATCH_SIZE") 2
$closedPollSeconds = Get-IntSetting $envMaps @("ClosedApiWorker__PollSeconds", "CLOSED_API_WORKER_POLL_SECONDS") 5
$localBatchSize = Get-IntSetting $envMaps @("LOCAL_MODEL_WORKER_BATCH_SIZE") 1
$localPollSeconds = Get-IntSetting $envMaps @("LOCAL_MODEL_WORKER_POLL_SECONDS") 5
$closedThroughput = 0.0
$localThroughput = 0.0
if ($closedPollSeconds -gt 0) {
  $closedThroughput = $ClosedApiWorkerInstances * $closedBatchSize * (60.0 / $closedPollSeconds)
}
if ($localPollSeconds -gt 0) {
  $localThroughput = $LocalModelWorkerInstances * $localBatchSize * (60.0 / $localPollSeconds)
}
$totalWorkerThroughput = [Math]::Round($closedThroughput + $localThroughput, 2)
$metrics["worker_queue_throughput"] = [ordered]@{
  closedApiWorkerInstances = $ClosedApiWorkerInstances
  closedApiBatchSize = $closedBatchSize
  closedApiPollSeconds = $closedPollSeconds
  localModelWorkerInstances = $LocalModelWorkerInstances
  localModelBatchSize = $localBatchSize
  localModelPollSeconds = $localPollSeconds
  projectedLeaseCapacityPerMinute = $totalWorkerThroughput
  minimumLeaseCapacityPerMinute = $MinimumWorkerLeaseThroughputPerMinute
}
if ($totalWorkerThroughput -lt $MinimumWorkerLeaseThroughputPerMinute) {
  Add-Blocker "worker-queue-throughput-budget" "Projected worker lease capacity is below threshold." $metrics["worker_queue_throughput"]
} else {
  Add-Check "worker-queue-throughput-budget" "ok" "Projected worker lease capacity is within threshold." $metrics["worker_queue_throughput"]
}

$pollInterval = Get-PlaygroundPollIntervalMs
$metrics["active_job_polling_budget"] = [ordered]@{
  playgroundPollIntervalMs = $pollInterval
  minimumPollIntervalMs = $ActiveJobPollIntervalMinMs
  activeJobPollP95ThresholdMs = $ActiveJobPollP95Ms
}
if ($pollInterval -le 0) {
  Add-Warning "active-job-polling-budget" "Could not locate the Playground active-job polling interval." $metrics["active_job_polling_budget"]
} elseif ($pollInterval -lt $ActiveJobPollIntervalMinMs) {
  Add-Blocker "active-job-polling-budget" "Playground active-job polling interval is below the public access minimum." $metrics["active_job_polling_budget"]
} else {
  Add-Check "active-job-polling-budget" "ok" "Playground active-job polling interval meets the minimum budget." $metrics["active_job_polling_budget"]
}

$authBodyBytes = Get-LongSetting $envMaps @("PublicAccessLimits__AuthRequestBodyBytes") 65536
$jsonBodyBytes = Get-LongSetting $envMaps @("PublicAccessLimits__JsonRequestBodyBytes") 2097152
$mediaUploadBytes = Get-LongSetting $envMaps @("PublicAccessLimits__MediaUploadBodyBytes") 268435456
$metrics["public_body_limits"] = [ordered]@{
  authRequestBodyBytes = $authBodyBytes
  jsonRequestBodyBytes = $jsonBodyBytes
  mediaUploadBodyBytes = $mediaUploadBytes
  maxPublicUploadBytes = $MaxPublicUploadBytes
}
if ($authBodyBytes -gt 65536 -or $jsonBodyBytes -gt 2097152 -or $mediaUploadBytes -gt $MaxPublicUploadBytes) {
  Add-Blocker "public-body-limit-budget" "Configured public request body caps exceed O6 thresholds." $metrics["public_body_limits"]
} else {
  Add-Check "public-body-limit-budget" "ok" "Configured public request body caps fit O6 thresholds." $metrics["public_body_limits"]
}

if (-not $RunHttp) {
  Add-Check "public-http-smoke" "skipped" "HTTP smoke was not run. Use -RunHttp -BaseUrl <public-origin> for static/API/media/p95 checks."
} else {
  $assetPath = Get-FirstAssetPath
  if ($assetPath) {
    $staticData = Invoke-SampledGet "static-asset-p95" $assetPath $StaticP95Ms
    $cacheControl = [string]$staticData.firstHeaders["Cache-Control"]
    if ($cacheControl -match "immutable" -and $cacheControl -match "max-age=31536000") {
      Add-Check "static-asset-cache-header" "ok" "Hashed Vite asset has immutable one-year cache header." ([ordered]@{ path = $assetPath; cacheControl = $cacheControl })
    } else {
      Add-Blocker "static-asset-cache-header" "Hashed Vite asset is missing the immutable one-year cache header." ([ordered]@{ path = $assetPath; cacheControl = $cacheControl })
    }
  } else {
    Add-Warning "static-asset-cache-header" "No built Vite dist asset was found; run frontend build before public static cache smoke."
  }

  $shellData = Invoke-SampledGet "spa-shell-p95" "/" $StaticP95Ms
  $shellCache = [string]$shellData.firstHeaders["Cache-Control"]
  if ($shellCache -match "no-cache|no-store|max-age=0") {
    Add-Check "spa-shell-cache-header" "ok" "SPA shell is revalidated rather than immutable-cached." ([ordered]@{ cacheControl = $shellCache })
  } else {
    Add-Blocker "spa-shell-cache-header" "SPA shell should be revalidated and must not share the immutable /assets policy." ([ordered]@{ cacheControl = $shellCache })
  }

  $metadataHeaders = New-CapacityHeaders -Path "/api/playground/models" -AcceptCompression
  $metadataData = Invoke-SampledGet "metadata-api-p95" "/api/playground/models" $ApiP95Ms $metadataHeaders
  if ($metadataData.firstStatusCode -eq 200) {
    $metadataCache = [string]$metadataData.firstHeaders["Cache-Control"]
    $metadataEtag = [string]$metadataData.firstHeaders["ETag"]
    $metadataVary = [string]$metadataData.firstHeaders["Vary"]
    $encoding = [string]$metadataData.firstHeaders["Content-Encoding"]
    if ($metadataCache -match "private" -and $metadataCache -match "max-age=30" -and $metadataEtag -match '^W/"' -and $metadataVary -match "Accept-Encoding") {
      Add-Check "metadata-cache-etag" "ok" "Stable metadata API carries private short-cache and weak ETag headers." ([ordered]@{ cacheControl = $metadataCache; etag = $metadataEtag; vary = $metadataVary })
    } else {
      Add-Blocker "metadata-cache-etag" "Stable metadata API is missing private short-cache, weak ETag, or Vary headers." ([ordered]@{ cacheControl = $metadataCache; etag = $metadataEtag; vary = $metadataVary })
    }
    if ($encoding -match "gzip|br") {
      Add-Check "metadata-compression" "ok" "Stable metadata API was compressed for Accept-Encoding." ([ordered]@{ contentEncoding = $encoding })
    } else {
      Add-Blocker "metadata-compression" "Stable metadata API was not compressed for Accept-Encoding." ([ordered]@{ contentEncoding = $encoding })
    }

    $notModifiedHeaders = New-CapacityHeaders -Path "/api/playground/models" -AcceptCompression -IfNoneMatch $metadataEtag
    $notModified = Invoke-CapacityRequest -Method "GET" -Path "/api/playground/models" -Headers $notModifiedHeaders
    if ($notModified.statusCode -eq 304) {
      Add-Check "metadata-etag-304" "ok" "Stable metadata API returns 304 for matching If-None-Match." $notModified
    } else {
      Add-Blocker "metadata-etag-304" "Stable metadata API did not return 304 for matching If-None-Match." $notModified
    }
  } else {
    Add-Warning "metadata-api-auth" "Metadata API smoke did not reach HTTP 200; provide client auth headers or run against a configured public origin." $metadataData
  }

  if ($ObjectContentPath) {
    $rangeHeaders = New-CapacityHeaders -Path $ObjectContentPath -Range "bytes=0-0"
    $rangeData = Invoke-SampledGet "object-range-read-p95" $ObjectContentPath $ObjectReadP95Ms $rangeHeaders
    $contentRange = [string]$rangeData.firstHeaders["Content-Range"]
    if ($rangeData.firstStatusCode -eq 206 -and $contentRange -match "^bytes\s+0-0/") {
      Add-Check "object-range-read" "ok" "Object media read supports HTTP range requests." ([ordered]@{ path = $ObjectContentPath; contentRange = $contentRange })
    } else {
      Add-Blocker "object-range-read" "Object media read did not return 206 with a valid Content-Range for bytes=0-0." ([ordered]@{ path = $ObjectContentPath; statusCode = $rangeData.firstStatusCode; contentRange = $contentRange })
    }
  } else {
    Add-Check "object-range-read" "skipped" "Provide -ObjectContentPath /api/media/object-content/<bucket>/<objectKey> to smoke stable object range reads."
  }

  if ($ClientApiToken) {
    $activeHeaders = New-CapacityHeaders -Path "/api/playground/chat-jobs"
    Invoke-SampledGet "active-job-poll-p95" "/api/playground/chat-jobs?activeOnly=true&limit=100" $ActiveJobPollP95Ms $activeHeaders | Out-Null
  } else {
    Add-Check "active-job-poll-p95" "skipped" "Provide -ClientApiToken to smoke active job polling latency."
  }

  if ($RunRateLimitProbe) {
    $attempts = [Math]::Min(100, [Math]::Max(2, (Get-IntSetting $envMaps @("PublicAccessLimits__AuthPermitLimit") 20) + 2))
    $statuses = New-List
    for ($i = 0; $i -lt $attempts; $i++) {
      $body = '{"email":"capacity-smoke@example.invalid","password":"not-a-real-password"}'
      $response = Invoke-CapacityRequest -Method "POST" -Path "/api/auth/login" -Body $body
      $statuses.Add([ordered]@{ statusCode = $response.statusCode; durationMs = $response.durationMs }) | Out-Null
    }
    $rateLimited = @($statuses | Where-Object { $_.statusCode -eq 429 }).Count
    if ($rateLimited -gt 0) {
      Add-Check "auth-rate-limit-429" "ok" "Repeated anonymous auth requests reached 429 as expected." ([ordered]@{ attempts = $attempts; rateLimited = $rateLimited; statuses = $statuses })
    } else {
      Add-Blocker "auth-rate-limit-429" "Repeated anonymous auth requests did not reach 429 within the configured attempt budget." ([ordered]@{ attempts = $attempts; statuses = $statuses })
    }
  } else {
    Add-Check "auth-rate-limit-429" "skipped" "Use -RunRateLimitProbe to intentionally consume the auth fixed-window budget and verify HTTP 429."
  }
}

$status = "ok"
if ($blockers.Count -gt 0) {
  $status = "failed"
} elseif ($warnings.Count -gt 0) {
  $status = "warning"
}

$report = [ordered]@{
  generated_at_utc = (Get-Date).ToUniversalTime().ToString("o")
  status = $status
  source_root = $RepoRoot
  base_url = $BaseUrl
  run_http = [bool]$RunHttp
  strict = [bool]$Strict
  thresholds = [ordered]@{
    staticP95Ms = $StaticP95Ms
    apiP95Ms = $ApiP95Ms
    objectReadP95Ms = $ObjectReadP95Ms
    activeJobPollP95Ms = $ActiveJobPollP95Ms
    activeJobPollIntervalMinMs = $ActiveJobPollIntervalMinMs
    maxPublicUploadBytes = $MaxPublicUploadBytes
    postgresMaxConnections = $PostgresMaxConnections
    postgresReservedConnections = $PostgresReservedConnections
    minimumWorkerLeaseThroughputPerMinute = $MinimumWorkerLeaseThroughputPerMinute
  }
  metrics = $metrics
  checks = $checks
  warnings = $warnings
  blockers = $blockers
}

$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 12

if ($blockers.Count -gt 0) {
  exit 1
}
