param(
  [string]$RepoRoot = "",
  [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
}
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path

if (-not $ReportPath) {
  $logDir = [Environment]::GetEnvironmentVariable("LOG_DIR", "Process")
  if (-not $logDir) {
    $logDir = Join-Path $RepoRoot ".runtime\xiaolou-logs"
  }
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $ReportPath = Join-Path $logDir "control-api-permission-matrix-$stamp.json"
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

function Read-TextFile {
  param([string]$Path)

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
    [System.Collections.Generic.List[object]]$Checks,
    [System.Collections.Generic.List[object]]$Blockers,
    [string]$Name,
    [string]$Text,
    [string[]]$Terms,
    [string]$OkDetail,
    [string]$FailedDetail
  )

  if ($null -eq $Text) {
    Add-Item $Blockers $Name "missing" $FailedDetail
    return
  }

  $missing = @(Test-AllTerms $Text $Terms)
  if ($missing.Count -eq 0) {
    Add-Item $Checks $Name "ok" $OkDetail
  } else {
    Add-Item $Blockers $Name "failed" $FailedDetail ([ordered]@{ missing = $missing })
  }
}

$programPath = Join-Path $RepoRoot "control-plane-dotnet\src\XiaoLou.ControlApi\Program.cs"
$p0Path = Join-Path $RepoRoot "scripts\windows\verify-control-plane-p0.ps1"
$frontendApiPath = Join-Path $RepoRoot "XIAOLOU-main\src\lib\api.ts"
$frontendGatePath = Join-Path $RepoRoot "scripts\windows\verify-frontend-legacy-dependencies.ps1"
$caddyPath = Join-Path $RepoRoot "deploy\windows\Caddyfile.windows.example"
$iisPath = Join-Path $RepoRoot "deploy\windows\iis-web.config.example"

$programText = Read-TextFile $programPath
$p0Text = Read-TextFile $p0Path
$frontendApiText = Read-TextFile $frontendApiPath
$frontendGateText = Read-TextFile $frontendGatePath
$caddyText = Read-TextFile $caddyPath
$iisText = Read-TextFile $iisPath

$checks = New-List
$warnings = New-List
$blockers = New-List

$publicClientRouteTerms = @(
  "/api/accounts/ensure",
  "/api/auth",
  "/api/me",
  "/api/organizations",
  "/api/api-center",
  "/api/admin",
  "/api/enterprise-applications",
  "/api/playground",
  "/api/capabilities",
  "/api/toolbox",
  "/api/jobs",
  "/api/media",
  "/api/projects",
  "/api/canvas-projects",
  "/api/agent-canvas/projects",
  "/api/create",
  "/api/wallet",
  "/api/wallets",
  "/api/wallet/usage-stats"
)

$clientPermissionTerms = @(
  "accounts:ensure",
  "identity:read",
  "identity:write",
  "organization:read",
  "organization:write",
  "api-center:read",
  "api-center:write",
  "admin:read",
  "admin:write",
  "enterprise-applications:read",
  "enterprise-applications:write",
  "playground:read",
  "playground:write",
  "toolbox:read",
  "toolbox:write",
  "jobs:create",
  "jobs:read",
  "jobs:cancel",
  "wallet:read",
  "media:read",
  "media:write",
  "projects:read",
  "projects:write",
  "canvas:read",
  "canvas:write",
  "create:read",
  "create:write"
)

$anonymousIdentityTerms = @(
  "/api/auth/providers",
  "/api/auth/google/exchange",
  "/api/auth/login",
  "/api/auth/admin/login",
  "/api/auth/register/personal",
  "/api/auth/register/enterprise-admin",
  "/api/enterprise-applications"
)

$operationalTerms = @(
  "/api/schema",
  "/api/providers/health",
  "/metrics"
)

$internalTerms = @(
  "/api/internal",
  "/api/internal/jobs/lease",
  "/api/internal/jobs/wait-signal",
  "/api/internal/outbox/lease"
)

$callbackTerms = @(
  "/api/payments/callbacks/{provider}",
  "/api/payments/alipay/notify",
  "/api/payments/wechat/notify"
)

$frontendAssertionTerms = @(
  "/api/accounts/ensure",
  "/api/auth/login",
  "/api/me",
  "/api/api-center",
  "/api/admin/pricing-rules",
  "/api/enterprise-applications",
  "/api/playground/config",
  "/api/toolbox",
  "/api/projects",
  "/api/canvas-projects",
  "/api/agent-canvas/projects",
  "/api/create/images",
  "/api/create/videos",
  'normalizedPath.startsWith("/api/projects/")',
  'normalizedPath.startsWith("/api/api-center/")',
  'normalizedPath.startsWith("/api/admin/")'
)

$reverseProxyTerms = @(
  "/healthz",
  "/livez",
  "/readyz",
  "/api/windows-native/status",
  "/api/internal/*",
  "/api/schema*",
  "/api/providers/health*",
  "/metrics",
  "/api/accounts/ensure",
  "/api/auth*",
  "/api/me",
  "/api/organizations*",
  "/api/api-center*",
  "/api/admin*",
  "/api/enterprise-applications*",
  "/api/playground*",
  "/api/toolbox*",
  "/api/jobs*",
  "/api/wallet",
  "/api/wallets",
  "/api/payments/callbacks/*",
  "/api/payments/alipay/notify",
  "/api/payments/wechat/notify",
  "/api/projects*",
  "/api/canvas-projects*",
  "/api/agent-canvas/projects*",
  "/api/create/images*",
  "/api/create/videos*",
  "/api/*"
)

Add-TermCheck $checks $blockers "program-public-client-surface" $programText $publicClientRouteTerms "Program.cs public client route surface is explicit." "Program.cs is missing one or more public client route terms."
Add-TermCheck $checks $blockers "program-client-permission-map" $programText $clientPermissionTerms "Program.cs maps public client routes to named permissions." "Program.cs is missing one or more public client permission terms."
Add-TermCheck $checks $blockers "program-anonymous-identity-map" $programText $anonymousIdentityTerms "Program.cs keeps anonymous identity/application exceptions explicit." "Program.cs is missing one or more anonymous identity/application terms."
Add-TermCheck $checks $blockers "program-operational-boundary" $programText $operationalTerms "Program.cs operational routes require the internal boundary." "Program.cs is missing one or more operational route terms."
Add-TermCheck $checks $blockers "program-internal-boundary" $programText $internalTerms "Program.cs internal routes require the internal boundary." "Program.cs is missing one or more internal route terms."

Add-TermCheck $checks $blockers "p0-public-client-helper" $p0Text $publicClientRouteTerms "P0 client token helper covers the full public client matrix." "verify-control-plane-p0.ps1 is missing one or more public client route terms."
Add-TermCheck $checks $blockers "p0-forbidden-boundary-checks" $p0Text @(
  "/api/internal/jobs/wait-signal",
  "/api/internal/outbox/lease",
  "/api/schema/apply",
  "/api/providers/health",
  "/metrics",
  "/api/jobs",
  "/api/api-center",
  "/api/admin/orders",
  "/api/playground/models",
  "/api/projects"
) "P0 forbidden checks cover internal, operational, and representative public client groups." "verify-control-plane-p0.ps1 is missing one or more forbidden boundary checks."

Add-TermCheck $checks $blockers "frontend-client-assertion-matrix" $frontendApiText $frontendAssertionTerms "Frontend attaches Control API client assertions only for explicit public client routes." "XIAOLOU-main/src/lib/api.ts is missing one or more public client assertion terms."
if ($frontendApiText -and $frontendApiText -match 'path\.startsWith\("/api/media/"\)') {
  Add-Item $blockers "frontend-media-assertion-width" "too-wide" "Frontend must not grant Control API assertions to all /api/media/* routes."
} else {
  Add-Item $checks "frontend-media-assertion-width" "ok" "Frontend media assertions remain limited to canonical upload/signed-url endpoints."
}

Add-TermCheck $checks $blockers "frontend-dependency-gate-matrix" $frontendGateText @(
  "Test-ControlApiPublicPath",
  "/api/auth",
  "/api/api-center",
  "/api/admin",
  "/api/playground",
  "/api/toolbox",
  "/api/payments/callbacks",
  "caddy-public-surface",
  "iis-public-surface"
) "Frontend dependency gate knows the Control API public/reverse-proxy matrix." "verify-frontend-legacy-dependencies.ps1 is missing one or more matrix terms."

Add-TermCheck $checks $blockers "caddy-permission-matrix" $caddyText $reverseProxyTerms "Caddy example blocks internal/operational/unlisted API routes and proxies explicit public routes." "Caddy example is missing one or more permission matrix terms."
Add-TermCheck $checks $blockers "iis-permission-matrix" $iisText @(
  "Block XiaoLou Internal API",
  "Block XiaoLou Operational API",
  "XiaoLou Public API Reverse Proxy",
  "Block Unlisted XiaoLou API",
  "providers/health",
  "api-center",
  "enterprise-applications",
  "agent-canvas/projects",
  "payments/(callbacks/"
) "IIS example blocks internal/operational/unlisted API routes and proxies explicit public routes." "IIS example is missing one or more permission matrix terms."

$status = if ($blockers.Count -gt 0) {
  "blocked"
} elseif ($warnings.Count -gt 0) {
  "warning"
} else {
  "ok"
}

$matrix = [ordered]@{
  public_client_token = [ordered]@{
    routes = $publicClientRouteTerms
    permissions = $clientPermissionTerms
    anonymous_identity_exceptions = $anonymousIdentityTerms
  }
  internal = [ordered]@{
    routes = $internalTerms
    access = "loopback or X-XiaoLou-Internal-Token only"
  }
  operational = [ordered]@{
    routes = $operationalTerms
    access = "loopback or X-XiaoLou-Internal-Token only; public reverse proxies return 404"
  }
  payment_callbacks = [ordered]@{
    routes = $callbackTerms
    access = "public callback URL with provider signature verification; no client token"
  }
  public_status = [ordered]@{
    routes = @("/healthz", "/livez", "/readyz", "/api/windows-native/status")
    access = "public read-only status"
  }
}

$report = [ordered]@{
  generated_at_utc = [DateTimeOffset]::UtcNow.ToString("O")
  status = $status
  source_root = $RepoRoot
  matrix = $matrix
  checks = $checks
  blockers = $blockers
  warnings = $warnings
}

$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 12

if ($blockers.Count -gt 0) {
  throw "Control API permission matrix verifier found $($blockers.Count) blocker(s). See $ReportPath"
}
