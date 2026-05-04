param(
  [Parameter(Mandatory = $true)]
  [string]$DataDir,

  [string]$ListenAddresses = "localhost,218.92.180.214",

  [string[]]$AllowedClientCidrs = @("127.0.0.1/32", "::1/128", "218.92.180.214/32"),

  [string]$Database = "xiaolou",

  [string]$User = "root",

  [int]$Port = 5432
)

$ErrorActionPreference = "Stop"

$resolvedDataDir = (Resolve-Path -LiteralPath $DataDir).Path
$postgresqlConf = Join-Path $resolvedDataDir "postgresql.conf"
$pgHba = Join-Path $resolvedDataDir "pg_hba.conf"

if (-not (Test-Path -LiteralPath $postgresqlConf)) {
  throw "postgresql.conf not found: $postgresqlConf"
}

if (-not (Test-Path -LiteralPath $pgHba)) {
  throw "pg_hba.conf not found: $pgHba"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item -LiteralPath $postgresqlConf -Destination "$postgresqlConf.codex-bak-$timestamp" -Force
Copy-Item -LiteralPath $pgHba -Destination "$pgHba.codex-bak-$timestamp" -Force

$conf = Get-Content -LiteralPath $postgresqlConf -Raw
$listenLine = "listen_addresses = '$ListenAddresses'"
$portLine = "port = $Port"

if ($conf -match "(?m)^\s*#?\s*listen_addresses\s*=.*$") {
  $conf = [regex]::Replace($conf, "(?m)^\s*#?\s*listen_addresses\s*=.*$", $listenLine)
} else {
  $conf = $conf.TrimEnd() + [Environment]::NewLine + $listenLine + [Environment]::NewLine
}

if ($conf -match "(?m)^\s*#?\s*port\s*=.*$") {
  $conf = [regex]::Replace($conf, "(?m)^\s*#?\s*port\s*=.*$", $portLine)
} else {
  $conf = $conf.TrimEnd() + [Environment]::NewLine + $portLine + [Environment]::NewLine
}

Set-Content -LiteralPath $postgresqlConf -Value $conf -Encoding UTF8

$beginMarker = "# BEGIN XiaoLouAI PostgreSQL access"
$endMarker = "# END XiaoLouAI PostgreSQL access"
$hba = Get-Content -LiteralPath $pgHba -Raw
$blockPattern = "(?ms)^# BEGIN XiaoLouAI PostgreSQL access\r?\n.*?\r?\n# END XiaoLouAI PostgreSQL access\r?\n?"
$hba = [regex]::Replace($hba, $blockPattern, "")

$blockLines = @($beginMarker)
foreach ($cidr in $AllowedClientCidrs) {
  $blockLines += ("host    {0,-16} {1,-16} {2,-20} scram-sha-256" -f $Database, $User, $cidr)
}
$blockLines += $endMarker

if (-not $hba.EndsWith([Environment]::NewLine)) {
  $hba += [Environment]::NewLine
}
$hba += ($blockLines -join [Environment]::NewLine) + [Environment]::NewLine
Set-Content -LiteralPath $pgHba -Value $hba -Encoding UTF8

$ruleName = "XiaoLouAI-PostgreSQL-$Port"
try {
  $existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  if (-not $existingRule) {
    New-NetFirewallRule `
      -DisplayName $ruleName `
      -Direction Inbound `
      -Action Allow `
      -Protocol TCP `
      -LocalPort $Port | Out-Null
  }
} catch {
  Write-Warning "Could not create firewall rule. Run this script as Administrator or open TCP $Port manually. $($_.Exception.Message)"
}

Write-Host "Updated: $postgresqlConf"
Write-Host "Updated: $pgHba"
Write-Host "Backups suffix: .codex-bak-$timestamp"
Write-Host "Allowed database/user: $Database / $User"
Write-Host "Listen addresses: $ListenAddresses"
Write-Host "Restart PostgreSQL service before testing remote access."
