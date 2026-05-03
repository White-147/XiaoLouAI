# Legacy to Canonical Projection Checklist

This checklist is for the P1/P2 cutover window where old `core-api/` and
`services/api/` data must be proven readable or projected into the Windows
native control plane. It is intentionally non-Docker, non-Linux, and
PostgreSQL-first.

## Scope

Canonical source of truth after cutover:

- `accounts`, `users`, `organizations`, `organization_memberships`
- `api_center_configs`, `pricing_rules`, `enterprise_applications`
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
  `storyboards`, `videos`, `dubbings`, `create_studio_images`, and
  `create_studio_videos`

`core-api/` may run only as a read-only compatibility process during this
phase. It must not write legacy snapshots or projection tables into the
Windows-native canonical database.

## Non-Mutating Preflight

For routine P2 cutover audit, use the consolidated entrypoint first:

```powershell
D:\code\XiaoLouAI\scripts\windows\verify-p2-cutover-audit.ps1 -FailOnFrontendLegacyWriteDependency
```

It runs the synthetic projection fixture, the legacy projection verifier, wallet
ledger audit, the `core-api` read-only compatibility smoke, and the
frontend/reverse-proxy legacy dependency audit. Without a supplied real legacy
source, missing legacy evidence is reported under `evidence_pending` rather
than as an engineering blocker. Frontend legacy route literals that are guarded
from mutating network calls are reported under `review_items`. The hard gate is
still the absence of `blockers` and live frontend legacy write candidates.
API-center provider health gaps are also folded into `evidence_pending` for
routine local audits; they become operator evidence for real vendor routing.

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
command. Routine evidence gaps should be reported under `evidence_pending`, and
guarded legacy literals should be reported under `review_items`; top-level
`warnings` are reserved for engineering issues that still need operator
attention before cutover.

## Real Legacy Dump Strict Rerun

When a real PostgreSQL legacy dump is available, do not run verifier cleanup
directly on the live database. Restore the dump into a temporary staging
database, run projection dry-run/evidence checks there, and keep the report as
cutover evidence:

```powershell
$env:PGPASSWORD = "<restore-admin-password>"
D:\code\XiaoLouAI\scripts\windows\verify-legacy-dump-cutover.ps1 `
  -DumpFile D:\code\XiaoLouAI\.runtime\xiaolou-backups\incoming\legacy.dump `
  -Username postgres
```

The script computes a SHA-256 evidence hash for the dump, restores it into a
`xiaolou_legacy_verify_*` database, runs `project-legacy-to-canonical.ps1`
dry-run, runs `verify-legacy-canonical-projection.ps1 -LegacyWritesFrozen` in
strict mode, then runs the wallet ledger audit. The temporary database is
dropped by default; pass `-KeepDatabase` only for a named operator inspection.

If the restored dump contains legacy rows that still need projection before the
strict verifier can pass, execute projection only inside the temporary
verification database:

```powershell
$env:PGPASSWORD = "<restore-admin-password>"
D:\code\XiaoLouAI\scripts\windows\verify-legacy-dump-cutover.ps1 `
  -DumpFile D:\code\XiaoLouAI\.runtime\xiaolou-backups\incoming\legacy.dump `
  -Username postgres `
  -ExecuteProjection
```

`-ExecuteProjection` is refused unless the target database name starts with
`xiaolou_legacy_verify_`. This keeps production cleanup separated from evidence
generation. The restore account must be allowed to create and drop temporary
databases. The consolidated P2 audit can also run this step when a dump is
available:

```powershell
$env:PGPASSWORD = "<restore-admin-password>"
D:\code\XiaoLouAI\scripts\windows\verify-p2-cutover-audit.ps1 `
  -LegacyDumpFile D:\code\XiaoLouAI\.runtime\xiaolou-backups\incoming\legacy.dump `
  -LegacyDumpUsername postgres `
  -StrictLegacySource `
  -LegacyWritesFrozen `
  -FailOnFrontendLegacyWriteDependency
```

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

## API-center Vendor Integrity Gate

`verify-legacy-canonical-projection.ps1` also reports `apiCenterHealth` for the
canonical API vendor management surface. This is a read-only check against
`api_center_configs` and `provider_health`.

The verifier blocks cutover when:

- API-center JSON is invalid or missing the canonical `vendors` / `defaults`
  sections.
- Vendor configs contain raw secret-looking fields such as `apiKey`, `token`,
  `secret`, `privateKey`, or `password`. Canonical rows may store state flags
  and `apiKeyHash`, but not plaintext secrets.
- Vendor ids or model ids are invalid, duplicated, or ambiguous.
- Default model assignments point at missing or disabled models.
- `apiKeyHash` exists while `apiKeyConfigured=false`.

Configured vendors that do not yet have `provider_health` evidence are reported
as warnings. Keep real vendor routing gated until the provider health records
exist; this warning does not block local canonical engineering runs without real
provider material.

## Frontend and Reverse Proxy Dependency Audit

Run this after changing frontend API wiring or Windows public-surface examples:

```powershell
D:\code\XiaoLouAI\scripts\windows\verify-frontend-legacy-dependencies.ps1
```

The scanner verifies that Caddy/IIS only expose explicit Control API public
routes and that unlisted `/api/*` routes remain blocked. It also scans frontend
source for non-Control API legacy route references. Guarded legacy literals are
reported under `review_items`; live legacy mutating references become blockers
when `-FailOnLegacyWriteDependency` is enabled.

Current P2 guard expectation: `XIAOLOU-main/src/lib/api.ts` blocks retired
legacy mutating frontend calls before network with `LEGACY_WRITE_DISABLED`, so
`verify-frontend-legacy-dependencies.ps1 -FailOnLegacyWriteDependency` should
pass with zero live write candidates. Any new live candidate is a cutover
blocker until it is migrated to a `.NET` Control API canonical write endpoint
or explicitly retired behind the same guard.

## Projection Matrix

| Legacy source | Canonical target | Required proof |
| --- | --- | --- |
| `users`, `organizations`, `organization_members`, snapshot identities | `accounts`, `users`, `organizations`, `organization_memberships` | `accounts.legacy_owner_type` and `accounts.legacy_owner_id` are populated; no wildcard owner grant is needed for normal reads. |
| `tasks`, `provider_jobs`, `video_replace_jobs` | `jobs`, `job_attempts` | No non-terminal legacy rows remain, or active rows have canonical `jobs` records with legacy ids in `payload`/idempotency keys. |
| `wallet_recharge_orders` | `payment_orders` | Paid/succeeded legacy orders are represented by `payment_orders.legacy_recharge_order_id`; provider trade uniqueness still holds. |
| `payment_events` | `payment_callbacks` | Verified legacy events are represented by canonical `(provider, event_id)` callbacks; duplicate event bodies remain rejected. |
| `wallets`, `wallet_ledger` | `wallet_ledger`, `wallet_balances` | Canonical ledger rows have `account_id`, `currency`, `idempotency_key`, and `immutable=true`; `wallet_balances` rebuild/audit has zero mismatch. |
| `project_assets` | `project_assets` canonical columns | `project_id`, `asset_type`, media URLs, and `data` are present; JSON payload values do not conflict with canonical columns. |
| `storyboards`, `videos`, `dubbings` | `project_storyboards`, `project_videos`, `project_dubbings` | Every legacy row with `project_id` is represented in the matching `project_*` table; missing `project_id`, orphan project/storyboard links, and JSON/column conflicts are blockers. |
| create-studio generated output URLs | `media_objects` | Permanent object-storage keys exist; local paths are cache/temp only; legacy ids are retained in `media_objects.data`. |
| legacy outbox/event side effects | `outbox_events` | Pending events are replayable and do not become a second source of truth. |
| API vendor configuration | `api_center_configs`, `provider_health` | Vendor config JSON contains no plaintext secret fields; defaults point at enabled models; configured vendors have provider health evidence before real routing. |

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

- No real legacy source was supplied for a real cutover. During routine P2
  engineering audit this remains `evidence_pending`, not a blocker; it becomes
  a blocker only for final cutover evidence with `-StrictLegacySource`.
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
- Project-adjacent legacy rows are missing `project_id`, are not represented in
  `project_*` canonical tables, reference orphan project/storyboard/job rows,
  or preserve JSON fields that conflict with canonical columns.
- API-center vendor config stores plaintext secret-looking fields, has invalid
  JSON, invalid/duplicated vendor or model ids, or defaults that point at
  missing/disabled models.
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
