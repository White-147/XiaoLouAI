param(
  [string]$Psql = "",
  [string]$AccountId = "",
  [string]$Currency = "",
  [switch]$Execute,
  [switch]$ZeroMissingLedgerBalances
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

if (-not $env:DATABASE_URL) {
  throw "DATABASE_URL is required."
}

$parsedAccountId = [Guid]::Empty
if ($AccountId -and -not [Guid]::TryParse($AccountId, [ref]$parsedAccountId)) {
  throw "AccountId must be a UUID when provided."
}

$Psql = Resolve-DDriveTool $Psql "D:\soft\program\PostgreSQL\18\bin\psql.exe" "psql.exe"
$zeroMissing = if ($ZeroMissingLedgerBalances) { "true" } else { "false" }
$accountIdSql = if ($AccountId) { "'$AccountId'::uuid" } else { "NULL::uuid" }
$currencySql = if ($Currency) { "'" + $Currency.Replace("'", "''") + "'::text" } else { "NULL::text" }

if ($Execute) {
  $sql = @'
WITH params AS (
  SELECT
    __ACCOUNT_ID_SQL__ AS account_id,
    __CURRENCY_SQL__ AS currency,
    __ZERO_MISSING_SQL__::boolean AS zero_missing
),
canonical_ledger AS (
  SELECT
    wl.account_id,
    wl.currency,
    CASE
      WHEN lower(wl.entry_type) IN ('debit', 'spend', 'charge', 'consume') THEN -abs(coalesce(wl.amount_cents, 0))
      ELSE coalesce(wl.amount_cents, 0)
    END AS signed_cents,
    CASE
      WHEN lower(wl.entry_type) IN ('debit', 'spend', 'charge', 'consume') THEN -abs(coalesce(wl.credit_amount, 0))
      ELSE coalesce(wl.credit_amount, 0)
    END AS signed_credits
  FROM wallet_ledger wl
  CROSS JOIN params p
  WHERE wl.account_id IS NOT NULL
    AND wl.currency IS NOT NULL
    AND (p.account_id IS NULL OR wl.account_id = p.account_id)
    AND (p.currency IS NULL OR wl.currency = p.currency)
),
ledger_totals AS (
  SELECT
    account_id,
    currency,
    sum(signed_cents)::bigint AS balance_cents,
    sum(signed_credits)::numeric(18,4) AS credit_balance,
    count(*)::bigint AS ledger_version
  FROM canonical_ledger
  GROUP BY account_id, currency
),
upserted AS (
  INSERT INTO wallet_balances (
    account_id,
    currency,
    balance_cents,
    credit_balance,
    ledger_version,
    updated_at
  )
  SELECT
    account_id,
    currency,
    balance_cents,
    credit_balance,
    ledger_version,
    now()
  FROM ledger_totals
  ON CONFLICT (account_id, currency) DO UPDATE SET
    balance_cents = EXCLUDED.balance_cents,
    credit_balance = EXCLUDED.credit_balance,
    ledger_version = EXCLUDED.ledger_version,
    updated_at = now()
  RETURNING
    account_id::text,
    currency,
    balance_cents,
    credit_balance,
    ledger_version
),
zeroed AS (
  UPDATE wallet_balances b
  SET balance_cents = 0,
      credit_balance = 0,
      ledger_version = 0,
      updated_at = now()
  FROM params p
  WHERE p.zero_missing
    AND (p.account_id IS NULL OR b.account_id = p.account_id)
    AND (p.currency IS NULL OR b.currency = p.currency)
    AND NOT EXISTS (
      SELECT 1
      FROM ledger_totals lt
      WHERE lt.account_id = b.account_id
        AND lt.currency = b.currency
    )
  RETURNING
    b.account_id::text,
    b.currency,
    b.balance_cents,
    b.credit_balance,
    b.ledger_version
)
SELECT jsonb_pretty(jsonb_build_object(
  'mode', 'execute',
  'generated_at_utc', to_jsonb(now() AT TIME ZONE 'UTC'),
  'account_id_filter', (SELECT account_id::text FROM params),
  'currency_filter', (SELECT currency FROM params),
  'zero_missing_ledger_balances', (SELECT zero_missing FROM params),
  'rebuilt_count', (SELECT count(*) FROM upserted),
  'rebuilt_rows', coalesce((SELECT jsonb_agg(to_jsonb(u)) FROM (SELECT * FROM upserted ORDER BY account_id, currency LIMIT 100) u), '[]'::jsonb),
  'zeroed_count', (SELECT count(*) FROM zeroed),
  'zeroed_rows', coalesce((SELECT jsonb_agg(to_jsonb(z)) FROM (SELECT * FROM zeroed ORDER BY account_id, currency LIMIT 100) z), '[]'::jsonb)
));
'@
} else {
  $sql = @'
WITH params AS (
  SELECT
    __ACCOUNT_ID_SQL__ AS account_id,
    __CURRENCY_SQL__ AS currency
),
canonical_ledger AS (
  SELECT
    wl.account_id,
    wl.currency,
    CASE
      WHEN lower(wl.entry_type) IN ('debit', 'spend', 'charge', 'consume') THEN -abs(coalesce(wl.amount_cents, 0))
      ELSE coalesce(wl.amount_cents, 0)
    END AS signed_cents,
    CASE
      WHEN lower(wl.entry_type) IN ('debit', 'spend', 'charge', 'consume') THEN -abs(coalesce(wl.credit_amount, 0))
      ELSE coalesce(wl.credit_amount, 0)
    END AS signed_credits
  FROM wallet_ledger wl
  CROSS JOIN params p
  WHERE wl.account_id IS NOT NULL
    AND wl.currency IS NOT NULL
    AND (p.account_id IS NULL OR wl.account_id = p.account_id)
    AND (p.currency IS NULL OR wl.currency = p.currency)
),
ledger_totals AS (
  SELECT
    account_id,
    currency,
    sum(signed_cents)::bigint AS balance_cents,
    sum(signed_credits)::numeric(18,4) AS credit_balance,
    count(*)::bigint AS ledger_version
  FROM canonical_ledger
  GROUP BY account_id, currency
),
current_balances AS (
  SELECT
    b.account_id,
    b.currency,
    b.balance_cents,
    b.credit_balance,
    b.ledger_version
  FROM wallet_balances b
  CROSS JOIN params p
  WHERE (p.account_id IS NULL OR b.account_id = p.account_id)
    AND (p.currency IS NULL OR b.currency = p.currency)
),
planned AS (
  SELECT
    coalesce(c.account_id, lt.account_id)::text AS account_id,
    coalesce(c.currency, lt.currency) AS currency,
    coalesce(c.balance_cents, 0)::bigint AS current_balance_cents,
    coalesce(lt.balance_cents, 0)::bigint AS rebuilt_balance_cents,
    coalesce(c.credit_balance, 0)::numeric(18,4) AS current_credit_balance,
    coalesce(lt.credit_balance, 0)::numeric(18,4) AS rebuilt_credit_balance,
    coalesce(c.ledger_version, 0)::bigint AS current_ledger_version,
    coalesce(lt.ledger_version, 0)::bigint AS rebuilt_ledger_version,
    CASE
      WHEN lt.account_id IS NULL THEN 'zero_if_requested'
      WHEN c.account_id IS NULL THEN 'insert'
      WHEN c.balance_cents <> lt.balance_cents
        OR c.credit_balance <> lt.credit_balance
        OR c.ledger_version <> lt.ledger_version THEN 'update'
      ELSE 'unchanged'
    END AS planned_action
  FROM current_balances c
  FULL OUTER JOIN ledger_totals lt
    ON lt.account_id = c.account_id
   AND lt.currency = c.currency
)
SELECT jsonb_pretty(jsonb_build_object(
  'mode', 'dry-run',
  'generated_at_utc', to_jsonb(now() AT TIME ZONE 'UTC'),
  'account_id_filter', (SELECT account_id::text FROM params),
  'currency_filter', (SELECT currency FROM params),
  'planned_change_count', (SELECT count(*) FROM planned WHERE planned_action <> 'unchanged'),
  'planned_rows', coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM (SELECT * FROM planned ORDER BY account_id, currency LIMIT 100) p), '[]'::jsonb)
));
'@
}

$sql = $sql.Replace("__ACCOUNT_ID_SQL__", $accountIdSql)
$sql = $sql.Replace("__CURRENCY_SQL__", $currencySql)
$sql = $sql.Replace("__ZERO_MISSING_SQL__", $zeroMissing)

$result = & $Psql `
  -X `
  --set ON_ERROR_STOP=1 `
  --tuples-only `
  --no-align `
  $env:DATABASE_URL `
  --command $sql

if ($LASTEXITCODE -ne 0) {
  throw "wallet balance rebuild failed with exit code $LASTEXITCODE"
}

($result -join "`n").Trim()

if (-not $Execute) {
  Write-Host "Dry run only. Re-run with -Execute to rebuild wallet_balances from wallet_ledger."
}
