param(
  [string]$Psql = "",
  [string]$OutputPath = "",
  [switch]$FailOnMismatch
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\load-env.ps1"

function Resolve-DDriveTool {
  param(
    [string]$Value,
    [string]$DefaultPath,
    [string]$Name
  )

  $path = if ($Value) { $Value } else { $DefaultPath }
  if (-not (Test-Path -LiteralPath $path)) {
    throw "$Name not found at $path. Install PostgreSQL client tools to D: or pass an explicit D: path."
  }

  $full = [System.IO.Path]::GetFullPath($path)
  if (-not $full.StartsWith("D:\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing non-D: $Name path: $full"
  }

  return $full
}

function Assert-DDriveOutput {
  param([string]$Path)

  if (-not $Path) {
    return ""
  }

  $full = [System.IO.Path]::GetFullPath($Path)
  if (-not $full.StartsWith("D:\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write audit output outside D:: $full"
  }

  return $full
}

if (-not $env:DATABASE_URL) {
  throw "DATABASE_URL is required."
}

$Psql = Resolve-DDriveTool $Psql "D:\soft\program\PostgreSQL\18\bin\psql.exe" "psql.exe"
$OutputPath = Assert-DDriveOutput $OutputPath

$sql = @'
WITH canonical_ledger AS (
  SELECT
    account_id,
    currency,
    CASE
      WHEN lower(entry_type) IN ('debit', 'spend', 'charge', 'consume') THEN -abs(coalesce(amount_cents, 0))
      ELSE coalesce(amount_cents, 0)
    END AS signed_cents,
    CASE
      WHEN lower(entry_type) IN ('debit', 'spend', 'charge', 'consume') THEN -abs(coalesce(credit_amount, 0))
      ELSE coalesce(credit_amount, 0)
    END AS signed_credits,
    idempotency_key,
    source_type,
    source_id,
    immutable,
    payment_order_id
  FROM wallet_ledger
  WHERE account_id IS NOT NULL
    AND currency IS NOT NULL
),
ledger_totals AS (
  SELECT
    account_id,
    currency,
    sum(signed_cents)::bigint AS ledger_balance_cents,
    sum(signed_credits)::numeric(18,4) AS ledger_credit_balance,
    count(*)::bigint AS ledger_rows
  FROM canonical_ledger
  GROUP BY account_id, currency
),
combined AS (
  SELECT
    coalesce(b.account_id, l.account_id) AS account_id,
    coalesce(b.currency, l.currency) AS currency,
    coalesce(b.balance_cents, 0)::bigint AS balance_cents,
    coalesce(l.ledger_balance_cents, 0)::bigint AS ledger_balance_cents,
    coalesce(b.credit_balance, 0)::numeric(18,4) AS credit_balance,
    coalesce(l.ledger_credit_balance, 0)::numeric(18,4) AS ledger_credit_balance,
    coalesce(b.ledger_version, 0)::bigint AS ledger_version,
    coalesce(l.ledger_rows, 0)::bigint AS ledger_rows
  FROM wallet_balances b
  FULL OUTER JOIN ledger_totals l
    ON l.account_id = b.account_id
   AND l.currency = b.currency
),
balance_mismatches AS (
  SELECT
    account_id::text AS account_id,
    currency,
    balance_cents,
    ledger_balance_cents,
    credit_balance,
    ledger_credit_balance,
    ledger_version,
    ledger_rows
  FROM combined
  WHERE balance_cents <> ledger_balance_cents
     OR credit_balance <> ledger_credit_balance
     OR ledger_version <> ledger_rows
),
duplicate_idempotency AS (
  SELECT account_id::text AS account_id, idempotency_key, count(*)::bigint AS duplicate_count
  FROM wallet_ledger
  WHERE account_id IS NOT NULL
    AND idempotency_key IS NOT NULL
  GROUP BY account_id, idempotency_key
  HAVING count(*) > 1
),
duplicate_source AS (
  SELECT account_id::text AS account_id, source_type, source_id, count(*)::bigint AS duplicate_count
  FROM wallet_ledger
  WHERE account_id IS NOT NULL
    AND source_type IS NOT NULL
    AND source_id IS NOT NULL
  GROUP BY account_id, source_type, source_id
  HAVING count(*) > 1
),
paid_order_missing_ledger AS (
  SELECT po.id::text AS payment_order_id, po.account_id::text AS account_id, po.merchant_order_no
  FROM payment_orders po
  WHERE po.status = 'paid'
    AND NOT EXISTS (
      SELECT 1
      FROM wallet_ledger wl
      WHERE wl.payment_order_id = po.id
    )
)
SELECT jsonb_pretty(jsonb_build_object(
  'generated_at_utc', to_jsonb(now() AT TIME ZONE 'UTC'),
  'wallet_balance_rows', (SELECT count(*) FROM wallet_balances),
  'wallet_ledger_rows', (SELECT count(*) FROM wallet_ledger),
  'balance_mismatch_count', (SELECT count(*) FROM balance_mismatches),
  'balance_mismatches', coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM (SELECT * FROM balance_mismatches ORDER BY account_id, currency LIMIT 100) m), '[]'::jsonb),
  'immutable_false_count', (SELECT count(*) FROM wallet_ledger WHERE account_id IS NOT NULL AND immutable IS NOT TRUE),
  'ledger_missing_canonical_fields_count', (
    SELECT count(*)
    FROM wallet_ledger
    WHERE account_id IS NULL
       OR currency IS NULL
       OR amount_cents IS NULL
       OR credit_amount IS NULL
       OR idempotency_key IS NULL
  ),
  'duplicate_idempotency_count', (SELECT count(*) FROM duplicate_idempotency),
  'duplicate_idempotency', coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM (SELECT * FROM duplicate_idempotency ORDER BY account_id, idempotency_key LIMIT 100) d), '[]'::jsonb),
  'duplicate_source_count', (SELECT count(*) FROM duplicate_source),
  'duplicate_source', coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM (SELECT * FROM duplicate_source ORDER BY account_id, source_type, source_id LIMIT 100) d), '[]'::jsonb),
  'paid_order_missing_ledger_count', (SELECT count(*) FROM paid_order_missing_ledger),
  'paid_order_missing_ledger', coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM (SELECT * FROM paid_order_missing_ledger ORDER BY payment_order_id LIMIT 100) p), '[]'::jsonb),
  'processed_callback_count', (SELECT count(*) FROM payment_callbacks WHERE processing_status IN ('processed', 'replayed')),
  'paid_order_count', (SELECT count(*) FROM payment_orders WHERE status = 'paid')
));
'@

$result = & $Psql -X --set ON_ERROR_STOP=1 --tuples-only --no-align $env:DATABASE_URL --command $sql
if ($LASTEXITCODE -ne 0) {
  throw "wallet ledger audit failed with exit code $LASTEXITCODE"
}

$jsonText = ($result -join "`n").Trim()
if ($OutputPath) {
  $parent = Split-Path -Parent $OutputPath
  if ($parent) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  Set-Content -LiteralPath $OutputPath -Encoding UTF8 -Value $jsonText
}

Write-Output $jsonText

if ($FailOnMismatch) {
  $audit = $jsonText | ConvertFrom-Json
  $hasMismatch = $audit.balance_mismatch_count -gt 0 `
    -or $audit.immutable_false_count -gt 0 `
    -or $audit.ledger_missing_canonical_fields_count -gt 0 `
    -or $audit.duplicate_idempotency_count -gt 0 `
    -or $audit.duplicate_source_count -gt 0 `
    -or $audit.paid_order_missing_ledger_count -gt 0

  if ($hasMismatch) {
    throw "wallet ledger audit found mismatches."
  }
}
