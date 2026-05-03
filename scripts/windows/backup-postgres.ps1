param(
  [string]$BackupDir = "",
  [string]$PgDump = ""
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\load-env.ps1"

function ConvertTo-LibpqDatabaseUrl {
  param([string]$DatabaseUrl)

  if (-not $DatabaseUrl) {
    return $DatabaseUrl
  }

  $uri = $null
  if (-not [System.Uri]::TryCreate($DatabaseUrl, [System.UriKind]::Absolute, [ref]$uri)) {
    return $DatabaseUrl
  }
  if ($uri.Scheme -ne "postgres" -and $uri.Scheme -ne "postgresql") {
    return $DatabaseUrl
  }

  $allowed = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($name in @(
    "application_name",
    "channel_binding",
    "client_encoding",
    "connect_timeout",
    "gssencmode",
    "keepalives",
    "keepalives_count",
    "keepalives_idle",
    "keepalives_interval",
    "options",
    "sslcert",
    "sslcrl",
    "sslkey",
    "sslmode",
    "sslpassword",
    "sslrootcert",
    "target_session_attrs",
    "tcp_user_timeout"
  )) {
    $allowed.Add($name) | Out-Null
  }

  $kept = New-Object System.Collections.Generic.List[string]
  foreach ($part in $uri.Query.TrimStart("?").Split("&", [System.StringSplitOptions]::RemoveEmptyEntries)) {
    $keyValue = $part.Split("=", 2)
    $key = [System.Uri]::UnescapeDataString($keyValue[0]).Trim()
    if (-not $allowed.Contains($key)) {
      continue
    }

    $value = if ($keyValue.Count -gt 1) { [System.Uri]::UnescapeDataString($keyValue[1]) } else { "" }
    $kept.Add("$([System.Uri]::EscapeDataString($key))=$([System.Uri]::EscapeDataString($value))") | Out-Null
  }

  $builder = [System.UriBuilder]::new($uri)
  $builder.Query = if ($kept.Count -gt 0) { $kept -join "&" } else { "" }
  return $builder.Uri.AbsoluteUri
}

if (-not $BackupDir) {
  $BackupDir = $env:BACKUP_DIR
}
if (-not $BackupDir) {
  throw "BACKUP_DIR is required."
}

$databaseUrl = $env:DATABASE_URL
if (-not $databaseUrl -or $databaseUrl.Contains("change-me")) {
  throw "DATABASE_URL is required and must not contain placeholder credentials for PostgreSQL backup."
}
$pgDumpDatabaseUrl = ConvertTo-LibpqDatabaseUrl $databaseUrl

if (-not $PgDump) {
  if (Test-Path -LiteralPath "D:\soft\program\PostgreSQL\18\bin\pg_dump.exe") {
    $PgDump = "D:\soft\program\PostgreSQL\18\bin\pg_dump.exe"
  } else {
    throw "D:\soft\program\PostgreSQL\18\bin\pg_dump.exe not found. Install PostgreSQL client tools to D: or pass -PgDump with an explicit D: path."
  }
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$out = Join-Path $BackupDir "xiaolou-$stamp.dump"

& $PgDump --format=custom --file=$out $pgDumpDatabaseUrl
if ($LASTEXITCODE -ne 0) {
  throw "pg_dump failed with exit code $LASTEXITCODE"
}
Write-Host "PostgreSQL backup written to $out"
