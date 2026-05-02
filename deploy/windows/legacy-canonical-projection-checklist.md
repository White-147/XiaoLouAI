# Legacy to Canonical Projection Checklist

This checklist is for the P1/P2 cutover window where old `core-api/` and
`services/api/` data must be proven readable or projected into the Windows
native control plane. It is intentionally non-Docker, non-Linux, and
PostgreSQL-first.

## Scope

Canonical source of truth after cutover:

- `accounts`, `users`, `organizations`, `organization_memberships`
- `jobs`, `job_attempts`
- `payment_orders`, `payment_callbacks`
- `wallet_ledger`, `wallet_balances`
- `media_objects`, `upload_sessions`
- `outbox_events`, `provider_health`

Legacy sources to freeze, audit, or project:

- `legacy_state_snapshot`
- `tasks`, `provider_jobs`, `video_replace_jobs`
- `wallet_recharge_orders`, `payment_events`
- `wallets`, `wallet_ledger`
- project/media output tables or snapshot fields such as `project_assets`,
  `videos`, `dubbings`, `create_studio_images`, and `create_studio_videos`

`core-api/` may run only as a read-only compatibility process during this
phase. It must not write legacy snapshots or projection tables into the
Windows-native canonical database.

## Non-Mutating Preflight

Run this before any legacy write shutdown:

```powershell
D:\code\XiaoLouAI\scripts\windows\verify-legacy-canonical-projection.ps1
```

For a local canonical smoke database that intentionally has no real legacy
source yet:

```powershell
D:\code\XiaoLouAI\scripts\windows\verify-legacy-canonical-projection.ps1 -AllowMissingLegacy
```

The script writes a JSON report under
`D:\code\XiaoLouAI\.runtime\xiaolou-logs`. In strict mode, blockers fail the
command. Warnings are still operator review items.

## Projection Dry Run

If the verifier reports missing account/job/ledger projection, generate a
dry-run projection plan against an isolated staging schema first:

```powershell
$db = "postgres://root:root@127.0.0.1:5432/xiaolou_windows_native_test?options=-c%20search_path%3Dlegacy_projection_staging_YYYYMMDD_HHMMSS"
D:\code\XiaoLouAI\scripts\windows\project-legacy-to-canonical.ps1 -DatabaseUrl $db
```

The projector plans these deterministic canonical writes:

- `users` / `organizations` / wallet owners to `accounts`
- `organization_members` to `organization_memberships`
- `tasks` to `jobs` with recognized legacy ids in `jobs.payload`
- `provider_jobs` and `video_replace_jobs` to `jobs` with source-specific
  legacy ids and `legacy:provider-job:*` / `legacy:video-replace-job:*`
  idempotency keys
- `wallet_ledger` canonical account/currency/idempotency fields and
  `wallet_balances`
- paid `wallet_recharge_orders` to `payment_orders`
- verified `payment_events` to `payment_callbacks`
- project assets, generated videos, dubbings, and create-studio media rows to
  `media_objects` with `legacyProjection` provenance and permanent object keys

Execute only after the dry-run report is reviewed:

```powershell
D:\code\XiaoLouAI\scripts\windows\project-legacy-to-canonical.ps1 -DatabaseUrl $db -Execute
D:\code\XiaoLouAI\scripts\windows\verify-legacy-canonical-projection.ps1 -DatabaseUrl $db
```

`-Execute` is intentionally restricted to `legacy_projection_staging_*`
schemas by default. Production execution requires a frozen legacy write window,
fresh backup, named operator approval, and the explicit `-AllowNonStaging`
switch.

If non-terminal legacy task/provider/video rows remain after projection, the
verifier will keep a warning until operators confirm the old write paths and old
workers are frozen:

```powershell
D:\code\XiaoLouAI\scripts\windows\verify-legacy-canonical-projection.ps1 -DatabaseUrl $db -LegacyWritesFrozen
```

This switch does not bypass missing projection proof. Active legacy rows still
block the gate when canonical `jobs.payload` does not expose recognized legacy
ids.

## Synthetic Gate Fixture

Run this after changing projector or verifier logic:

```powershell
D:\code\XiaoLouAI\scripts\windows\verify-legacy-canonical-projection-gate.ps1
```

The fixture creates an isolated `legacy_projection_staging_*` schema with one
active `provider_jobs` row and one active `video_replace_jobs` row, executes the
projection, and runs the strict verifier with `-LegacyWritesFrozen`. The
verifier must show source-specific canonical job proof for both rows. This
prevents unrelated `tasks` projections from accidentally satisfying the
provider/video job gate.

## Projection Matrix

| Legacy source | Canonical target | Required proof |
| --- | --- | --- |
| `users`, `organizations`, `organization_members`, snapshot identities | `accounts`, `users`, `organizations`, `organization_memberships` | `accounts.legacy_owner_type` and `accounts.legacy_owner_id` are populated; no wildcard owner grant is needed for normal reads. |
| `tasks`, `provider_jobs`, `video_replace_jobs` | `jobs`, `job_attempts` | No non-terminal legacy rows remain, or active rows have canonical `jobs` records with legacy ids in `payload`/idempotency keys. |
| `wallet_recharge_orders` | `payment_orders` | Paid/succeeded legacy orders are represented by `payment_orders.legacy_recharge_order_id`; provider trade uniqueness still holds. |
| `payment_events` | `payment_callbacks` | Verified legacy events are represented by canonical `(provider, event_id)` callbacks; duplicate event bodies remain rejected. |
| `wallets`, `wallet_ledger` | `wallet_ledger`, `wallet_balances` | Canonical ledger rows have `account_id`, `currency`, `idempotency_key`, and `immutable=true`; `wallet_balances` rebuild/audit has zero mismatch. |
| project assets and generated output URLs | `media_objects` | Permanent object-storage keys exist; local paths are cache/temp only; legacy ids are retained in `media_objects.data`. |
| legacy outbox/event side effects | `outbox_events` | Pending events are replayable and do not become a second source of truth. |

## Cutover Steps

1. Put legacy write paths into a freeze window. Do not stop read-only
   compatibility reads yet.
2. Back up PostgreSQL and any stopped SQLite migration source.
3. Run `verify-legacy-canonical-projection.ps1` against the intended staging or
   production database.
4. Drain or project non-terminal legacy `tasks/provider_jobs/video_replace_jobs`
   before stopping legacy workers.
5. Replay real provider payment callback JSONL in staging, then run wallet audit:

```powershell
D:\code\XiaoLouAI\.runtime\app\scripts\windows\stage-payment-provider-replay.ps1 -InputFile <capture.jsonl>
D:\code\XiaoLouAI\.runtime\app\scripts\windows\audit-wallet-ledger.ps1 -FailOnMismatch
```

6. If the audit is clean, switch public writes to the .NET Control API and keep
   `CORE_API_COMPAT_READ_ONLY=1` for any temporary legacy process.
7. Keep legacy public GET routes closed unless a route has a named owner,
   operator, and rollback plan.

## Blockers

- No real legacy source was supplied for a real cutover.
- Canonical required tables are missing.
- Legacy jobs are still active and not represented by canonical `jobs`.
- `provider_jobs` or `video_replace_jobs` are active but only generic
  `tasks` projections exist; each source needs its own canonical job proof.
- Paid legacy recharge orders are not represented by
  `payment_orders.legacy_recharge_order_id`.
- Verified legacy payment events are not represented by canonical callbacks.
- `wallet_ledger` contains rows missing canonical account/currency/idempotency
  fields or has `immutable=false`.
- Legacy media output rows are not represented by canonical `media_objects`
  with legacy provenance and permanent object keys.
- Wallet audit or replay reports any mismatch.
- `core-api/` is not in read-only mode while exposed to production traffic.

## Rollback

- Stop workers first so no new canonical jobs are consumed during rollback.
- Do not delete canonical `jobs`, `payment_callbacks`, `payment_orders`,
  `wallet_ledger`, or permanent object-storage rows.
- Do not manually update wallet balances. Rebuild `wallet_balances` from the
  immutable ledger if needed.
- If legacy reads must be reopened, keep them read-only and keep public route
  allowlists narrow until reconciliation has passed.
