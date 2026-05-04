param(
  [string]$RepoRoot = "",
  [string]$CoreApiRoot = "",
  [string]$ServicesApiRoot = "",
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

if (-not $ServicesApiRoot) {
  $ServicesApiRoot = Join-Path $RepoRoot "legacy\services-api"
} elseif (-not [System.IO.Path]::IsPathRooted($ServicesApiRoot)) {
  $ServicesApiRoot = Join-Path $RepoRoot $ServicesApiRoot
}
$ServicesApiRoot = [System.IO.Path]::GetFullPath($ServicesApiRoot)

if (-not $ReportPath) {
  $logDir = [Environment]::GetEnvironmentVariable("LOG_DIR", "Process")
  if (-not $logDir) {
    $logDir = Join-Path $RepoRoot ".runtime\xiaolou-logs"
  }
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $ReportPath = Join-Path $logDir "final-legacy-surface-$stamp.json"
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

function Add-CheckedFile {
  param([string]$Path)

  if (-not $Path) {
    return
  }

  $display = Get-DisplayPath $Path
  if (-not $script:checkedFileSet.Contains($display)) {
    $script:checkedFileSet.Add($display) | Out-Null
    $script:checkedFiles.Add($display) | Out-Null
  }
}

function Read-TextFile {
  param([string]$Path)

  Add-CheckedFile $Path
  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  return Get-Content -LiteralPath $Path -Raw
}

function Test-AllTerms {
  param(
    [string]$Text,
    [string[]]$Terms
  )

  $missing = New-List
  foreach ($term in $Terms) {
    if ($Text -notmatch [regex]::Escape($term)) {
      $missing.Add($term) | Out-Null
    }
  }

  return $missing
}

function Add-TermCheck {
  param(
    [string]$Name,
    [string]$Text,
    [string[]]$Terms,
    [string]$OkDetail,
    [string]$FailedDetail
  )

  if ($null -eq $Text) {
    Add-Item $script:blockers $Name "missing" $FailedDetail
    return
  }

  $missing = @(Test-AllTerms $Text $Terms)
  if ($missing.Count -eq 0) {
    Add-Item $script:checks $Name "ok" $OkDetail
  } else {
    Add-Item $script:blockers $Name "failed" $FailedDetail ([ordered]@{ missing = $missing })
  }
}

function Get-ServicesApiTextFiles {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return @()
  }

  $textExtensions = @(
    ".cfg",
    ".env",
    ".example",
    ".ini",
    ".json",
    ".md",
    ".py",
    ".toml",
    ".txt",
    ".yaml",
    ".yml"
  )

  return @(Get-ChildItem -LiteralPath $Path -Recurse -File | Where-Object {
    $fullName = $_.FullName
    $extension = [System.IO.Path]::GetExtension($_.Name)
    $fullName -notmatch "\\(\.venv|__pycache__|\.pytest_cache|\.ruff_cache|xiaolou_api\.egg-info)(\\|$)" `
      -and $textExtensions -contains $extension
  })
}

$allowlistValue = "GET /healthz;GET /api/windows-native/status"
$allowedServiceNames = @(
  "XiaoLou-ControlApi",
  "XiaoLou-LocalModelWorker",
  "XiaoLou-ClosedApiWorker"
)

$checks = New-List
$blockers = New-List
$warnings = New-List
$reviewItems = New-List
$checkedFiles = New-List
$checkedFileSet = New-Object System.Collections.Generic.HashSet[string]

$serverPath = Join-Path $CoreApiRoot "src\server.js"
$routesPath = Join-Path $CoreApiRoot "src\routes.js"
$envExamplePath = Join-Path $RepoRoot "scripts\windows\.env.windows.example"
$publishPath = Join-Path $RepoRoot "scripts\windows\publish-runtime-to-d.ps1"
$registerPath = Join-Path $RepoRoot "scripts\windows\register-services.ps1"
$readmePath = Join-Path $RepoRoot "README.md"
$readmeZhPath = Join-Path $RepoRoot "README.zh-CN.md"
$servicesApiPath = $ServicesApiRoot

$serverText = Read-TextFile $serverPath
$routesText = Read-TextFile $routesPath
$envExampleText = Read-TextFile $envExamplePath
$publishText = Read-TextFile $publishPath
$registerText = Read-TextFile $registerPath
$readmeText = Read-TextFile $readmePath
$readmeZhText = Read-TextFile $readmeZhPath

if ($serverText -and $serverText -match ('DEFAULT_COMPAT_PUBLIC_ROUTE_ALLOWLIST\s*=\s*"' + [regex]::Escape($allowlistValue) + '"')) {
  Add-Item $checks "core-api-default-public-allowlist" "ok" "core-api default public compatibility allowlist remains narrow."
} else {
  Add-Item $blockers "core-api-default-public-allowlist" "failed" "core-api/src/server.js must default CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST to '$allowlistValue'."
}

if ($envExampleText -and $envExampleText -match ('(?m)^CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST=' + [regex]::Escape($allowlistValue) + '\s*$')) {
  Add-Item $checks "windows-env-public-allowlist" "ok" ".env.windows.example keeps the core-api public allowlist narrow."
} else {
  Add-Item $blockers "windows-env-public-allowlist" "failed" ".env.windows.example must keep CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST=$allowlistValue."
}

Add-TermCheck `
  -Name "core-api-final-route-defaults" `
  -Text $routesText `
  -Terms @(
    'route("GET", "/api/tasks/stream"',
    'envFlag("CORE_API_COMPAT_DISABLE_TASKS_STREAM", true)',
    'compatRouteClosed("core-api legacy task stream is retired. Use the .NET control plane job APIs.")',
    'routeWithStatus("POST", "/api/payments/wechat/notify"',
    'routeWithStatus("POST", "/api/payments/alipay/notify"',
    'envFlag("CORE_API_COMPAT_ENABLE_LEGACY_PAYMENT_NOTIFY", false)',
    'CORE_API_COMPAT_ROUTE_CLOSED'
  ) `
  -OkDetail "core-api legacy task stream and legacy payment notify aliases default to closed." `
  -FailedDetail "core-api/src/routes.js must keep F1 route closures as defaults."

Add-TermCheck `
  -Name "windows-env-core-api-final-flags" `
  -Text $envExampleText `
  -Terms @(
    "CORE_API_COMPAT_READ_ONLY=1",
    "CORE_API_COMPAT_DISABLE_TASKS_STREAM=1",
    "CORE_API_COMPAT_ENABLE_LEGACY_PAYMENT_NOTIFY=0"
  ) `
  -OkDetail ".env.windows.example documents the final core-api compatibility defaults." `
  -FailedDetail ".env.windows.example must pin core-api read-only, task stream closed, and payment notify closed defaults."

Add-TermCheck `
  -Name "runtime-env-sync-core-api-final-flags" `
  -Text (($publishText, $registerText) -join "`n") `
  -Terms @(
    "CORE_API_COMPAT_READ_ONLY",
    "CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST",
    "CORE_API_COMPAT_DISABLE_TASKS_STREAM",
    "CORE_API_COMPAT_ENABLE_LEGACY_PAYMENT_NOTIFY",
    $allowlistValue
  ) `
  -OkDetail "publish/register scripts preserve final core-api compatibility env values." `
  -FailedDetail "publish/register scripts must sync final core-api compatibility env values."

$servicesApiFiles = @(Get-ServicesApiTextFiles $servicesApiPath)
if ($servicesApiFiles.Count -eq 0) {
  Add-Item $blockers "services-api-source-scan" "missing" "legacy services API reference contains no scannable text files."
} else {
  Add-Item $checks "services-api-source-scan" "ok" "Scanned $($servicesApiFiles.Count) legacy services API text file(s) for production API wording."
}

$productionWordingHits = New-List
foreach ($file in $servicesApiFiles) {
  Add-CheckedFile $file.FullName
  $lines = Get-Content -LiteralPath $file.FullName
  for ($index = 0; $index -lt $lines.Count; $index++) {
    $line = [string]$lines[$index]
    if ($line -match "(?i)\b(Python\s+production\s+API|production\s+API)\b") {
      $productionWordingHits.Add([ordered]@{
        file = Get-DisplayPath $file.FullName
        line = $index + 1
        text = $line.Trim()
      }) | Out-Null
    }
  }
}

if ($productionWordingHits.Count -eq 0) {
  Add-Item $checks "services-api-production-api-wording" "ok" "legacy services API no longer self-identifies as a production API."
} else {
  Add-Item $blockers "services-api-production-api-wording" "failed" "legacy services API must not contain 'production API' or 'Python production API' wording." ([ordered]@{ hits = $productionWordingHits })
}

Add-TermCheck `
  -Name "root-readme-final-positioning-en" `
  -Text $readmeText `
  -Terms @(
    "control-plane-dotnet/",
    "core-api/",
    "Node compatibility layer and migration reference",
    "services/api/",
    "legacy Python API reference; not production control plane",
    "legacy/core-api",
    "legacy/services-api",
    "archived legacy references",
    "deletion"
  ) `
  -OkDetail "README.md clearly positions archived core-api and services API references for finalization." `
  -FailedDetail "README.md must clearly position archived core-api and services API final states."

Add-TermCheck `
  -Name "root-readme-final-positioning-zh" `
  -Text $readmeZhText `
  -Terms @(
    "control-plane-dotnet/",
    "core-api/",
    "services/api/",
    "legacy/core-api",
    "legacy/services-api",
    "Node ",
    "Python API",
    "legacy-surface",
    "legacy reference",
    "Windows Service workers"
  ) `
  -OkDetail "README.zh-CN.md contains the synchronized final positioning anchors." `
  -FailedDetail "README.zh-CN.md must keep the synchronized final positioning anchors."

if ($registerText) {
  $serviceMatches = [regex]::Matches($registerText, 'Name\s*=\s*"(?<name>XiaoLou-[^"]+)"')
  $actualServiceNames = @($serviceMatches | ForEach-Object { $_.Groups["name"].Value } | Sort-Object -Unique)
  $missingServices = @($allowedServiceNames | Where-Object { $_ -notin $actualServiceNames })
  $extraServices = @($actualServiceNames | Where-Object { $_ -notin $allowedServiceNames })

  if ($missingServices.Count -eq 0 -and $extraServices.Count -eq 0 -and $registerText -match "New-Service @serviceParams") {
    Add-Item $checks "windows-service-registration-surface" "ok" "register-services.ps1 only defines the three Windows-native runtime services." ([ordered]@{ service_names = $actualServiceNames })
  } else {
    Add-Item $blockers "windows-service-registration-surface" "failed" "register-services.ps1 must only register the three Windows-native runtime services." ([ordered]@{
      expected = $allowedServiceNames
      actual = $actualServiceNames
      missing = $missingServices
      extra = $extraServices
    })
  }
} else {
  Add-Item $blockers "windows-service-registration-surface" "missing" "scripts/windows/register-services.ps1 is missing."
}

Add-Item $reviewItems "operator-final-acceptance-evidence" "not-source-blocker" "Real provider health, production legacy dump/source, real payment material, and real restore drill remain README final acceptance evidence only."

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
  phase = "F3-final-legacy-surface"
  source_root = $RepoRoot
  policy = [ordered]@{
    canonical_runtime = ".NET 8 / ASP.NET Core Control API + PostgreSQL canonical + Windows Service workers"
    forbidden_production_paths = @("docker", "linux", "kubernetes", "windows-celery", "redis-open-source-windows")
    allowed_runtime_services = $allowedServiceNames
    core_api_public_allowlist = $allowlistValue
    core_api_root = $CoreApiRoot
    services_api_root = $ServicesApiRoot
  }
  checked_files = $checkedFiles
  checks = $checks
  blockers = $blockers
  warnings = $warnings
  review_items = $reviewItems
}

$report | ConvertTo-Json -Depth 14 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 14

if ($blockers.Count -gt 0) {
  throw "Final legacy surface verifier found $($blockers.Count) blocker(s). See $ReportPath"
}
