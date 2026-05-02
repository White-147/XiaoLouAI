param(
  [string]$RepoRoot = "",
  [string]$ReportPath = "",
  [switch]$FailOnLegacyWriteDependency
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
}

if (-not $ReportPath) {
  $logDir = [Environment]::GetEnvironmentVariable("LOG_DIR", "Process")
  if (-not $logDir) {
    $logDir = Join-Path $RepoRoot ".runtime\xiaolou-logs"
  }
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $ReportPath = Join-Path $logDir "frontend-legacy-dependencies-$stamp.json"
}

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

function Test-ControlApiPublicPath {
  param([string]$Path)

  return $Path -match "^/api/accounts/ensure($|[/?#])" `
    -or $Path -match "^/api/jobs($|[/?#])" `
    -or $Path -match "^/api/jobs/" `
    -or $Path -match "^/api/wallet($|[/?#])" `
    -or $Path -match "^/api/wallet/usage-stats($|[/?#])" `
    -or $Path -match "^/api/wallets($|[/?#])" `
    -or $Path -match "^/api/wallets/" `
    -or $Path -match "^/api/media/(upload-begin|upload-complete|move-temp-to-permanent|signed-read-url)($|[/?#])" `
    -or $Path -match "^/api/payments/callbacks/[^/?#]+($|[/?#])" `
    -or $Path -match "^/api/payments/(alipay|wechat)/notify($|[/?#])"
}

function Test-CoreApiReadonlyPublicPath {
  param([string]$Path)

  return $Path -in @("/healthz", "/livez", "/readyz") -or $Path -match "^/api/windows-native/status($|[/?#])"
}

function Test-LegacyCandidatePath {
  param([string]$Path)

  if (Test-ControlApiPublicPath $Path) { return $false }
  if (Test-CoreApiReadonlyPublicPath $Path) { return $false }
  return $Path -match "^/(api|uploads|jaaz-api|jaaz|vr-)"
}

function Get-DisplayPath {
  param([string]$Path)

  $fullRoot = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd("\", "/")
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if ($fullPath.StartsWith($fullRoot, [StringComparison]::OrdinalIgnoreCase)) {
    return $fullPath.Substring($fullRoot.Length).TrimStart("\", "/")
  }
  return $fullPath
}

$checks = New-List
$warnings = New-List
$blockers = New-List
$reviewItems = New-List

$frontendSrc = Join-Path $RepoRoot "XIAOLOU-main\src"
$apiTs = Join-Path $frontendSrc "lib\api.ts"
$caddyPath = Join-Path $RepoRoot "deploy\windows\Caddyfile.windows.example"
$iisPath = Join-Path $RepoRoot "deploy\windows\iis-web.config.example"
$frontendLegacyMutationGuardPresent = $false

foreach ($path in @($frontendSrc, $apiTs, $caddyPath, $iisPath)) {
  if (-not (Test-Path -LiteralPath $path)) {
    Add-Item $blockers "required-path" "missing" $path
  }
}

if (Test-Path -LiteralPath $apiTs) {
  $apiText = Get-Content -LiteralPath $apiTs -Raw
  $frontendLegacyMutationGuardPresent = $apiText -match "function\s+assertNoLegacyMutatingRequest" `
    -and $apiText -match "LEGACY_WRITE_DISABLED" `
    -and $apiText -match "VITE_ALLOW_LEGACY_MUTATIONS"
  if ($apiText -match 'path\.startsWith\("/api/media/"\)') {
    Add-Item $blockers "frontend-control-api-client-path" "too-wide" "isControlApiClientPath must not grant Control API assertions to all /api/media/* routes."
  } elseif ($apiText -match 'CONTROL_API_CLIENT_EXACT_PATHS' -and $apiText -match '/api/media/signed-read-url') {
    Add-Item $checks "frontend-control-api-client-path" "ok" "Control API assertion routes are explicit."
  } else {
    Add-Item $warnings "frontend-control-api-client-path" "review" "Could not find the explicit Control API client path set in XIAOLOU-main/src/lib/api.ts."
  }

  if ($frontendLegacyMutationGuardPresent) {
    Add-Item $checks "frontend-legacy-mutation-guard" "ok" "api.ts blocks non-Control API mutating legacy requests by default; VITE_ALLOW_LEGACY_MUTATIONS is the explicit dev escape hatch."
  } else {
    Add-Item $warnings "frontend-legacy-mutation-guard" "missing" "api.ts should block non-Control API mutating legacy requests by default."
  }
}

if (Test-Path -LiteralPath $caddyPath) {
  $caddyText = Get-Content -LiteralPath $caddyPath -Raw
  $hasInternalBlock = $caddyText -match "handle\s+/api/internal/\*\s*\{[\s\S]*?respond\s+404"
  $hasCatchAllBlock = $caddyText -match "handle\s+/api/\*\s*\{[\s\S]*?respond\s+404"
  $hasMetricsBlock = $caddyText -match "handle\s+/metrics\s*\{[\s\S]*?respond\s+404"
  $hasControlApiRoutes = $caddyText -match "handle\s+/api/accounts/ensure\s*\{[\s\S]*?reverse_proxy\s+127\.0\.0\.1:4100" `
    -and $caddyText -match "handle\s+/api/jobs\*\s*\{[\s\S]*?reverse_proxy\s+127\.0\.0\.1:4100" `
    -and $caddyText -match "handle\s+/api/wallet\s*\{[\s\S]*?reverse_proxy\s+127\.0\.0\.1:4100" `
    -and $caddyText -match "handle\s+/api/wallet/usage-stats\s*\{[\s\S]*?reverse_proxy\s+127\.0\.0\.1:4100" `
    -and $caddyText -match "handle\s+/api/wallets\s*\{[\s\S]*?reverse_proxy\s+127\.0\.0\.1:4100" `
    -and $caddyText -match "handle\s+/api/wallets/\*\s*\{[\s\S]*?reverse_proxy\s+127\.0\.0\.1:4100" `
    -and $caddyText -match "handle\s+/livez\s*\{[\s\S]*?reverse_proxy\s+127\.0\.0\.1:4100" `
    -and $caddyText -match "handle\s+/readyz\s*\{[\s\S]*?reverse_proxy\s+127\.0\.0\.1:4100" `
    -and $caddyText -match "handle\s+/api/windows-native/status\s*\{[\s\S]*?reverse_proxy\s+127\.0\.0\.1:4100" `
    -and $caddyText -match "handle\s+/api/payments/alipay/notify\s*\{[\s\S]*?reverse_proxy\s+127\.0\.0\.1:4100" `
    -and $caddyText -match "handle\s+/api/payments/wechat/notify\s*\{[\s\S]*?reverse_proxy\s+127\.0\.0\.1:4100" `
    -and $caddyText -match "handle\s+/api/media/upload-begin\s*\{[\s\S]*?reverse_proxy\s+127\.0\.0\.1:4100" `
    -and $caddyText -match "handle\s+/api/media/signed-read-url\s*\{[\s\S]*?reverse_proxy\s+127\.0\.0\.1:4100"
  $hasLegacyReverseProxy = $caddyText -match "handle\s+/(api|uploads|jaaz|jaaz-api|socket\.io)\*" `
    -and $caddyText -match "reverse_proxy"

  if ($hasInternalBlock -and $hasCatchAllBlock -and $hasMetricsBlock -and $hasControlApiRoutes -and -not $hasLegacyReverseProxy) {
    Add-Item $checks "caddy-public-surface" "ok" "Caddy routes only explicit Control API public paths and blocks unlisted /api/*."
  } else {
    Add-Item $blockers "caddy-public-surface" "failed" "Caddy must proxy only explicit Control API public paths and respond 404 for /api/internal/*, /metrics, plus unlisted /api/*."
  }
}

if (Test-Path -LiteralPath $iisPath) {
  $iisText = Get-Content -LiteralPath $iisPath -Raw
  $hasInternalBlock = $iisText -match 'Block XiaoLou Internal API'
  $hasOperationalBlock = $iisText -match '\^\(metrics\|api/\(schema\.\*\|providers/health\.\*\)\)\$'
  $hasUnlistedBlock = $iisText -match 'Block Unlisted XiaoLou API'
  $hasHealthProxy = $iisText -match '\^\(healthz\|livez\|readyz\)\$'
  $hasPublicProxy = $iisText -match 'windows-native/status\|accounts/ensure\|jobs\(/.\*\)\?\|wallet\|wallet/usage-stats\|wallets\(/.\*\)\?\|payments/\(callbacks/\[\^/\]\+\|alipay/notify\|wechat/notify\)\|media/\(upload-begin\|upload-complete\|move-temp-to-permanent\|signed-read-url\)'
  if ($hasInternalBlock -and $hasOperationalBlock -and $hasUnlistedBlock -and $hasHealthProxy -and $hasPublicProxy) {
    Add-Item $checks "iis-public-surface" "ok" "IIS routes only explicit Control API public paths and blocks unlisted legacy surfaces."
  } else {
    Add-Item $blockers "iis-public-surface" "failed" "IIS rewrite rules must proxy explicit Control API public paths and block unlisted legacy surfaces."
  }
}

$legacyReferences = New-List
$legacyWriteCandidates = New-List
$retiredLegacyWriteCandidates = New-List
$literalPattern = '["''`](?<path>/(?:api|uploads|jaaz-api|jaaz|vr-)[A-Za-z0-9_./:?=&%-]*)'
if (Test-Path -LiteralPath $frontendSrc) {
  $files = @(Get-ChildItem -LiteralPath $frontendSrc -Recurse -File -Include *.ts,*.tsx,*.js,*.jsx)
  foreach ($file in $files) {
    $text = Get-Content -LiteralPath $file.FullName -Raw
    foreach ($match in [regex]::Matches($text, $literalPattern)) {
      $path = $match.Groups["path"].Value
      if (-not (Test-LegacyCandidatePath $path)) {
        continue
      }

      $line = ($text.Substring(0, $match.Index).Split("`n").Count)
      $relativePath = Get-DisplayPath $file.FullName
      $windowStart = $match.Index
      $windowLength = [Math]::Min($text.Length - $windowStart, 520)
      $window = $text.Substring($windowStart, $windowLength)
      $methodMatch = [regex]::Match($window, 'method\s*:\s*["''](?<method>POST|PUT|PATCH|DELETE)["'']', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
      $method = if ($methodMatch.Success) { $methodMatch.Groups["method"].Value.ToUpperInvariant() } else { "UNKNOWN" }
      $entry = [ordered]@{
        file = $relativePath
        line = $line
        path = $path
        method = $method
      }
      $legacyReferences.Add($entry) | Out-Null
      if ($method -ne "UNKNOWN") {
        if ($frontendLegacyMutationGuardPresent -and $relativePath -eq "XIAOLOU-main\src\lib\api.ts") {
          $retiredLegacyWriteCandidates.Add($entry) | Out-Null
        } else {
          $legacyWriteCandidates.Add($entry) | Out-Null
        }
      }
    }
  }
}

if ($legacyReferences.Count -eq 0) {
  Add-Item $checks "frontend-legacy-api-references" "ok" "No non-Control API legacy route literals found in frontend source."
} else {
  Add-Item $reviewItems "frontend-legacy-api-references" "review" "Found $($legacyReferences.Count) non-Control API legacy route literal(s) in frontend source." $legacyReferences
}

if ($legacyWriteCandidates.Count -eq 0) {
  Add-Item $checks "frontend-legacy-write-candidates" "ok" "No obvious mutating frontend legacy route references found."
} elseif ($FailOnLegacyWriteDependency) {
  Add-Item $blockers "frontend-legacy-write-candidates" "failed" "Found $($legacyWriteCandidates.Count) mutating legacy route candidate(s) in frontend source." $legacyWriteCandidates
} else {
  Add-Item $warnings "frontend-legacy-write-candidates" "pending-migration" "Found $($legacyWriteCandidates.Count) mutating legacy route candidate(s); keep them blocked by proxy until migrated to .NET Control API or explicitly retired." $legacyWriteCandidates
}

if ($retiredLegacyWriteCandidates.Count -gt 0) {
  Add-Item $checks "frontend-retired-legacy-write-candidates" "retired" "Retired $($retiredLegacyWriteCandidates.Count) frontend legacy mutating route candidate(s) behind assertNoLegacyMutatingRequest." $retiredLegacyWriteCandidates
}

$status = if ($blockers.Count -gt 0) {
  "blocked"
} elseif ($warnings.Count -gt 0) {
  "warning"
} else {
  "ok"
}

$report = [ordered]@{
  generated_at_utc = [DateTimeOffset]::UtcNow.ToString("O")
  status = $status
  source_root = $RepoRoot
  fail_on_legacy_write_dependency = [bool]$FailOnLegacyWriteDependency
  blockers = $blockers
  warnings = $warnings
  review_items = $reviewItems
  checks = $checks
}

$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 12

if ($blockers.Count -gt 0) {
  throw "Frontend legacy dependency check found $($blockers.Count) blocker(s). See $ReportPath"
}
