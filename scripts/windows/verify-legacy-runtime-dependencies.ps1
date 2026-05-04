param(
  [string]$RepoRoot = "",
  [string]$CoreApiRoot = "",
  [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
}
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path

if (-not $CoreApiRoot) {
  $CoreApiRoot = Join-Path $RepoRoot "legacy\core-api"
} elseif (-not [System.IO.Path]::IsPathRooted($CoreApiRoot)) {
  $CoreApiRoot = Join-Path $RepoRoot $CoreApiRoot
}
$CoreApiRoot = [System.IO.Path]::GetFullPath($CoreApiRoot)

if (-not $ReportPath) {
  $logDir = [Environment]::GetEnvironmentVariable("LOG_DIR", "Process")
  if (-not $logDir) {
    $logDir = Join-Path $RepoRoot ".runtime\xiaolou-logs"
  }
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $ReportPath = Join-Path $logDir "legacy-runtime-dependencies-$stamp.json"
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

function Get-DisplayPath {
  param([string]$Path)

  $fullRoot = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd("\", "/")
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if ($fullPath.StartsWith($fullRoot, [StringComparison]::OrdinalIgnoreCase)) {
    return $fullPath.Substring($fullRoot.Length).TrimStart("\", "/")
  }
  return $fullPath
}

function Get-SourceFiles {
  param(
    [string]$Path,
    [string[]]$Include
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return @()
  }

  return @(Get-ChildItem -LiteralPath $Path -Recurse -File -Include $Include | Where-Object {
    $_.FullName -notmatch "\\(bin|obj|node_modules|dist|build|coverage|__pycache__)(\\|$)"
  })
}

function Test-AllowedLegacyFinding {
  param([object]$Finding)

  $file = [string]$Finding.file
  $kind = [string]$Finding.kind
  $line = [string]$Finding.detail
  $route = [string]$Finding.route

  $isCoreApiSource = $file -match "^(core-api|legacy\\core-api)\\src\\"
  if (-not $isCoreApiSource -and $script:CoreApiSourceDisplayRoot) {
    $prefix = "$($script:CoreApiSourceDisplayRoot)\"
    $isCoreApiSource = $file.Equals($script:CoreApiSourceDisplayRoot, [StringComparison]::OrdinalIgnoreCase) `
      -or $file.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
  }

  if ($isCoreApiSource) {
    return [ordered]@{
      allowed = $true
      reason = "core-api is retained only as read-only compatibility/migration reference; S3 requires CORE_API_COMPAT_READ_ONLY and the compat-readonly smoke."
    }
  }

  if ($kind -eq "legacy-route-reference" -and $file -eq "XIAOLOU-main\src\lib\api.ts") {
    if ($route -match "^/api/video-replace" -or $route -match "^/vr-" -or $route -match "^/jaaz") {
      return [ordered]@{
        allowed = $true
        reason = "Retired frontend helper/guard reference; mutating video-replace calls are blocked by assertNoLegacyMutatingRequest unless an explicit dev escape hatch is enabled."
      }
    }
  }

  if ($kind -eq "legacy-route-reference" -and $file -eq "XIAOLOU-main\src\lib\google-auth.ts" -and $route -match "^/api/auth/google/start($|[?])") {
    return [ordered]@{
      allowed = $true
      reason = "Legacy OAuth start URL remains a UI compatibility reference; Windows-native identity exposes providers/exchange and Google is disabled unless explicitly configured."
    }
  }

  if ($kind -eq "legacy-route-reference" -and $file -eq "XIAOLOU-main\src\pages\create\JaazAgentCanvasEmbed.tsx") {
    return [ordered]@{
      allowed = $true
      reason = "Jaaz embed path is guarded by import.meta.env.DEV and is not part of the Windows-native production route matrix."
    }
  }

  if ($kind -eq "legacy-route-reference" -and $file -eq "XIAOLOU-main\src\agent-canvas\hooks\useChatAgent.ts" -and $route -match "^/api/agent-canvas/chat") {
    return [ordered]@{
      allowed = $true
      reason = "Residual agent-canvas chat compatibility call is isolated by core-api read-only route closure; agent-canvas project persistence is already canonical."
    }
  }

  return [ordered]@{
    allowed = $false
    reason = ""
  }
}

function Read-TextFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  return Get-Content -LiteralPath $Path -Raw
}

$checks = New-List
$blockers = New-List
$warnings = New-List
$reviewItems = New-List
$allowlist = New-List
$findings = New-List

$dotnetFiles = @(Get-SourceFiles (Join-Path $RepoRoot "control-plane-dotnet\src") @("*.cs", "*.json"))
$workerFiles = @(Get-SourceFiles (Join-Path $RepoRoot "services\local-model-worker\app") @("*.py"))
$frontendFiles = @(Get-SourceFiles (Join-Path $RepoRoot "XIAOLOU-main\src") @("*.ts", "*.tsx", "*.js", "*.jsx"))
$coreApiSourceRoot = Join-Path $CoreApiRoot "src"
$script:CoreApiSourceDisplayRoot = Get-DisplayPath $coreApiSourceRoot
$coreApiFiles = @(Get-SourceFiles $coreApiSourceRoot @("*.js"))

$legacyTablePattern = "(?i)\b(from|join|insert\s+into|update|delete\s+from)\s+(tasks|wallet_recharge_orders|storyboards|videos|dubbings)\b"
$legacyHelperPattern = 'DeleteProjectItemAsync\("(?<table>storyboards|videos|dubbings)"'
$legacyRoutePattern = "(?<route>/(?:api/tasks|api/wallet/recharge(?:-orders)?|api/admin/recharge|api/billing|api/uploads|uploads/|api/video-replace|vr-[A-Za-z0-9_-]+|api/chat/models|api/auth/google/start|api/agent-canvas/chat(?:/stream)?|api/canvas-library|jaaz-api|jaaz)(?:[A-Za-z0-9_./:?=&%-]*)?)"

foreach ($sourceGroup in @(
  [ordered]@{ name = "dotnet"; files = $dotnetFiles; runtime = "control-plane-dotnet/src" },
  [ordered]@{ name = "worker"; files = $workerFiles; runtime = "services/local-model-worker/app" },
  [ordered]@{ name = "frontend"; files = $frontendFiles; runtime = "XIAOLOU-main/src" },
  [ordered]@{ name = "core-api"; files = $coreApiFiles; runtime = $script:CoreApiSourceDisplayRoot }
)) {
  foreach ($file in @($sourceGroup.files)) {
    $text = Get-Content -LiteralPath $file.FullName -Raw
    $lines = $text -split "`n"
    for ($index = 0; $index -lt $lines.Count; $index++) {
      $line = $lines[$index]
      $lineNumber = $index + 1

      foreach ($match in [regex]::Matches($line, $legacyTablePattern)) {
        $findings.Add([ordered]@{
          kind = "legacy-table-sql"
          area = $sourceGroup.name
          file = Get-DisplayPath $file.FullName
          line = $lineNumber
          table = $match.Groups[2].Value
          detail = $line.Trim()
        }) | Out-Null
      }

      foreach ($match in [regex]::Matches($line, $legacyHelperPattern)) {
        $findings.Add([ordered]@{
          kind = "legacy-table-helper"
          area = $sourceGroup.name
          file = Get-DisplayPath $file.FullName
          line = $lineNumber
          table = $match.Groups["table"].Value
          detail = $line.Trim()
        }) | Out-Null
      }

      foreach ($match in [regex]::Matches($line, $legacyRoutePattern)) {
        $route = "/" + $match.Groups["route"].Value.TrimStart("/")
        $findings.Add([ordered]@{
          kind = "legacy-route-reference"
          area = $sourceGroup.name
          file = Get-DisplayPath $file.FullName
          line = $lineNumber
          route = $route
          detail = $line.Trim()
        }) | Out-Null
      }
    }
  }

  Add-Item $checks "scan-$($sourceGroup.name)" "ok" "Scanned $(@($sourceGroup.files).Count) runtime source file(s) under $($sourceGroup.runtime)."
}

foreach ($finding in $findings.ToArray()) {
  $allow = Test-AllowedLegacyFinding $finding
  if ($allow.allowed) {
    $allowlist.Add([ordered]@{
      kind = $finding.kind
      area = $finding.area
      file = $finding.file
      line = $finding.line
      route = $finding.route
      table = $finding.table
      reason = $allow.reason
      detail = $finding.detail
    }) | Out-Null
    continue
  }

  if ($finding.area -in @("dotnet", "worker")) {
    Add-Item $blockers "runtime-legacy-source-dependency" "blocked" "Windows-native runtime source references a legacy table or route outside the allowlist." $finding
  } elseif ($finding.area -eq "frontend") {
    Add-Item $blockers "frontend-legacy-runtime-route" "blocked" "Frontend source references a legacy route outside the S3 allowlist." $finding
  } elseif ($finding.area -eq "core-api") {
    Add-Item $blockers "core-api-legacy-dependency-unclassified" "blocked" "core-api legacy dependency was not classified as read-only compatibility." $finding
  }
}

if ($allowlist.Count -gt 0) {
  Add-Item $reviewItems "legacy-runtime-dependency-allowlist" "review" "S3 found $($allowlist.Count) legacy reference(s) retained only under read-only, retired, dev-only, or migration compatibility rules." $allowlist
}

$serverText = Read-TextFile (Join-Path $CoreApiRoot "src\server.js")
$postgresStoreText = Read-TextFile (Join-Path $CoreApiRoot "src\postgres-store.js")
$envText = Read-TextFile (Join-Path $RepoRoot "scripts\windows\.env.windows.example")
$publishText = Read-TextFile (Join-Path $RepoRoot "scripts\windows\publish-runtime-to-d.ps1")
$registerText = Read-TextFile (Join-Path $RepoRoot "scripts\windows\register-services.ps1")
$p2Text = Read-TextFile (Join-Path $RepoRoot "scripts\windows\verify-p2-cutover-audit.ps1")
$projectionText = Read-TextFile (Join-Path $CoreApiRoot "scripts\verify-legacy-canonical-projection.js")

if ($serverText -match "CORE_API_COMPAT_READ_ONLY" -and $serverText -match "CORE_API_COMPAT_ROUTE_CLOSED" -and $serverText -match "CORE_API_COMPAT_READ_ONLY") {
  Add-Item $checks "core-api-readonly-middleware" "ok" "core-api server defaults to read-only compatibility and closes non-allowlisted routes."
} else {
  Add-Item $blockers "core-api-readonly-middleware" "missing" "core-api server must keep CORE_API_COMPAT_READ_ONLY and route-closed guards."
}

if ($postgresStoreText -match "Refusing to persist core-api legacy snapshot while CORE_API_COMPAT_READ_ONLY=1") {
  Add-Item $checks "core-api-persistence-guard" "ok" "core-api postgres store refuses legacy snapshot persistence in read-only mode."
} else {
  Add-Item $blockers "core-api-persistence-guard" "missing" "core-api postgres store must refuse writes while CORE_API_COMPAT_READ_ONLY=1."
}

if ($envText -match "CORE_API_COMPAT_READ_ONLY=1" -and $envText -match "CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST=GET /healthz;GET /api/windows-native/status") {
  Add-Item $checks "windows-env-core-api-readonly" "ok" ".env.windows.example keeps core-api read-only and public allowlist narrow."
} else {
  Add-Item $blockers "windows-env-core-api-readonly" "missing" ".env.windows.example must set CORE_API_COMPAT_READ_ONLY=1 and the narrow status allowlist."
}

if ($publishText -match "CORE_API_COMPAT_READ_ONLY" -and $publishText -match "GET /healthz;GET /api/windows-native/status" -and $registerText -match "CORE_API_COMPAT_READ_ONLY" -and $registerText -match "GET /healthz;GET /api/windows-native/status") {
  Add-Item $checks "runtime-env-sync-core-api-readonly" "ok" "publish/register scripts preserve core-api read-only compatibility env values."
} else {
  Add-Item $blockers "runtime-env-sync-core-api-readonly" "missing" "publish/register scripts must preserve core-api read-only compatibility env values."
}

if ($p2Text -match "core-api-compat-readonly" -and $p2Text -match "verify-core-api-compat-readonly.ps1") {
  Add-Item $checks "p2-core-api-readonly-gate" "ok" "P2 audit still runs the core-api read-only compatibility gate unless explicitly skipped."
} else {
  Add-Item $blockers "p2-core-api-readonly-gate" "missing" "P2 audit must keep the core-api read-only compatibility gate."
}

if ($projectionText -match "projectAdjacentHealth" -and $projectionText -match "apiCenterHealth") {
  Add-Item $checks "projection-verifier-health-gates" "ok" "Projection verifier still contains projectAdjacentHealth and apiCenterHealth."
} else {
  Add-Item $blockers "projection-verifier-health-gates" "missing" "Projection verifier must keep projectAdjacentHealth and apiCenterHealth."
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
  core_api_root = $CoreApiRoot
  policy = [ordered]@{
    canonical_runtime = ".NET 8 Control API + Windows Service workers + PostgreSQL canonical"
    legacy_allowed_only_for = @("core-api read-only compatibility", "frontend retired/dev guards", "legacy import/projection verification")
    hard_blockers = @("dotnet-or-worker legacy table SQL", "dotnet-or-worker legacy route reference", "frontend legacy route outside allowlist", "missing core-api read-only gate")
  }
  scanned = [ordered]@{
    dotnet = $dotnetFiles.Count
    worker = $workerFiles.Count
    frontend = $frontendFiles.Count
    core_api = $coreApiFiles.Count
  }
  checks = $checks
  allowlist = $allowlist
  blockers = $blockers
  warnings = $warnings
  review_items = $reviewItems
}

$report | ConvertTo-Json -Depth 14 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 14

if ($blockers.Count -gt 0) {
  throw "Legacy runtime dependency verifier found $($blockers.Count) blocker(s). See $ReportPath"
}
