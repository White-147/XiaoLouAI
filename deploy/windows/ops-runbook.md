# XiaoLouAI Windows Native Ops Runbook

## Services

- `XiaoLou-ControlApi`: `.NET 8 / ASP.NET Core` control plane on `127.0.0.1:4100`.
- `XiaoLou-ClosedApiWorker`: `.NET Worker Service` for closed API jobs.
- `XiaoLou-LocalModelWorker`: `.NET` Windows Service wrapper supervising the Python local model adapter process.

The registered services should use direct service-aware `dotnet.exe <published dll>`
binary paths, not PowerShell wrapper scripts:

- `D:\code\XiaoLouAI\.runtime\app\publish\control-api\XiaoLou.ControlApi.dll`
- `D:\code\XiaoLouAI\.runtime\app\publish\local-model-worker-service\XiaoLou.LocalModelWorkerService.dll`
- `D:\code\XiaoLouAI\.runtime\app\publish\closed-api-worker\XiaoLou.ClosedApiWorker.dll`

## P1 Production Entry

1. Publish the Windows native runtime to `D:\code\XiaoLouAI\.runtime\app`:

```powershell
D:\code\XiaoLouAI\scripts\windows\install.ps1 -RegisterServices -UpdateExisting -AssertDDrive
```

Run service registration from an elevated PowerShell session. The rehearsal script reports `service-admin` as a blocker when `-RegisterServices` or `-StartServices` is requested without administrator rights.
`register-services.ps1` refuses placeholder or smoke/test secrets by default so
an update cannot accidentally overwrite working Machine env with bundled sample
values. Use `-AllowPlaceholderSecrets` only for isolated local smoke runs.

Current checkpoint: the three services have been registered as `Automatic`,
started from an elevated PowerShell session, and verified by P0 run
`p0-4d788b349b6f4fe7aea06aa9fb99825e`. Rehearsal report:
`D:\code\XiaoLouAI\.runtime\xiaolou-logs\p1-cutover-admin-services-20260502-101430.json`.

2. Review `D:\code\XiaoLouAI\.runtime\app\scripts\windows\.env.windows` before starting services. At minimum set production values for:

- `DATABASE_URL`
- `PAYMENT_WEBHOOK_SECRET`
- `INTERNAL_API_TOKEN`
- `CLIENT_API_TOKEN`, or `CLIENT_API_AUTH_PROVIDER=hs256-jwt` with `CLIENT_API_AUTH_PROVIDER_SECRET`
- `OBJECT_STORAGE_PROVIDER`
- `OBJECT_STORAGE_BUCKET`
- `OBJECT_STORAGE_PUBLIC_BASE_URL`

3. Start services after the env file and reverse proxy have been checked:

```powershell
D:\code\XiaoLouAI\.runtime\app\scripts\windows\start-services.ps1
Get-Service XiaoLou-ControlApi,XiaoLou-ClosedApiWorker,XiaoLou-LocalModelWorker
Invoke-RestMethod http://127.0.0.1:4100/healthz
Invoke-RestMethod http://127.0.0.1:4100/livez
Invoke-RestMethod http://127.0.0.1:4100/readyz
```

4. Run the P0 smoke verification against the production-style local endpoint before opening public traffic:

```powershell
$env:CONTROL_API_BASE_URL = "http://127.0.0.1:4100"
$env:INTERNAL_API_TOKEN = "<same value as .env.windows>"
$env:CLIENT_API_TOKEN = "<same value as .env.windows if static-token mode is enabled>"
$env:CLIENT_API_AUTH_PROVIDER_SECRET = "<same value as .env.windows if auth-provider mode is enabled>"
$env:CLIENT_API_AUTH_PROVIDER_ISSUER = "<same value as .env.windows>"
$env:CLIENT_API_AUTH_PROVIDER_AUDIENCE = "<same value as .env.windows>"
D:\code\XiaoLouAI\.runtime\app\scripts\windows\verify-control-plane-p0.ps1 -AccountOwnerId "user_login_smoke_001"
```

When `CLIENT_API_REQUIRE_AUTH_PROVIDER=true`, the P0 verifier signs HS256
provider assertions for public client routes and still uses `INTERNAL_API_TOKEN`
for worker-only internal routes.

For a non-mutating preflight report before publishing or service changes, run:

```powershell
D:\code\XiaoLouAI\scripts\windows\rehearse-production-cutover.ps1
```

Before opening production traffic, run strict preflight after publishing and editing
the runtime env file:

```powershell
D:\code\XiaoLouAI\scripts\windows\rehearse-production-cutover.ps1 -StrictProduction
```

Strict mode promotes unsafe cutover settings to blockers, including placeholder
tokens or database URLs, missing static-token or auth-provider client protection,
smoke/test/staging/sample secrets, unsafe static-token grants, wildcard client
permissions/account grants, and a legacy `core-api` allowlist wider than
`GET /healthz;GET /api/windows-native/status`.

## Internal API Boundary

- `/api/internal/*` is worker-only. Public reverse proxies must block it before general `/api/*` forwarding.
- `/api/schema/*` and `/api/providers/health` are operational APIs. Public reverse proxies must block them too.
- `/healthz`, `/livez`, and `/readyz` are the only public health probes. `/readyz` checks PostgreSQL with a minimal `select 1`; keep it out of high-frequency public scraping.
- `/metrics` is an internal operational endpoint. It requires the same internal
  boundary as `/api/schema/*` and `/api/providers/health`; Caddy/IIS examples
  return 404 for public `/metrics`.
- `deploy/windows/Caddyfile.windows.example` and `deploy/windows/iis-web.config.example` include the public block rules.
- `INTERNAL_API_TOKEN` should be set in production. Workers send it as `X-XiaoLou-Internal-Token`.
- If the token is absent, the Control API only allows internal endpoints from loopback requests with no external forwarding headers. This is for local verification only, not production.

## Public Client API Boundary

- Production public client routes must use either a static `CLIENT_API_TOKEN` or provider-signed assertions.
- Static tokens are sent as `X-XiaoLou-Client-Token` or `Authorization: Bearer <token>`.
- Provider assertions are sent as `Authorization: Bearer <jwt>` and verified with `CLIENT_API_AUTH_PROVIDER=hs256-jwt`, `CLIENT_API_AUTH_PROVIDER_SECRET`, and, for cutover, `CLIENT_API_REQUIRE_AUTH_PROVIDER=true`.
- Provider assertion claims support `sub`, `iss`, `aud`, `exp`, `nbf`, `xiaolou_account_ids`, `xiaolou_account_owner_ids`, `xiaolou_account_owner_type`, and `xiaolou_permissions`. `sub` is treated as a `user:<sub>` owner grant unless `xiaolou_account_owner_type` says otherwise.
- Protected public client routes are `/api/accounts/ensure`, `/api/jobs*`, and `/api/media*`.
- Keep `CLIENT_API_REQUIRE_ACCOUNT_SCOPE=true` in production so requests must carry account scope headers matching the request body/query/route.
- For static-token cutover, set `CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT=true` once the active accounts are known. Then grant only the intended accounts with `CLIENT_API_ALLOWED_ACCOUNT_IDS`, or owner-scoped canaries with `CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS` such as `user:<id>` or `organization:<id>`.
- For auth-provider cutover, keep configured account grants optional as an upper-bound gray-release switch. If `CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT=true` is set, provider assertion grants must also match the configured account or owner grants.
- Set `CLIENT_API_ALLOWED_PERMISSIONS` to the exact public actions this frontend token may call, for example `accounts:ensure,jobs:create,jobs:read,jobs:cancel,media:read,media:write`. Use `jobs:*`, `media:*`, or `*` only as temporary staging grants.
- `CLIENT_API_ALLOWED_ACCOUNT_IDS=*` and owner wildcards such as `user:*` are broad grants. Use them only for temporary staging or deliberate canary windows with a rollback plan.
- `/api/payments/callbacks/*` remains provider-signature protected and is not a client-token route.

## Provider Health, Outbox, and Worker Boundaries

- `PostgresProviderHealthStore` owns provider health snapshots in PostgreSQL.
  Control API exposes `/api/providers/health` as an operational endpoint only;
  public reverse proxies must not expose it.
- `PostgresOutboxStore` owns outbox leasing and completion under
  `/api/internal/outbox/*`. Outbox state is retry/publish coordination, not a
  source of truth. Canonical PostgreSQL tables remain authoritative.
- `XiaoLou-ClosedApiWorker` leases `account-media` jobs for closed API provider
  routes, applies provider-specific retry/backoff behavior, and writes job
  completion back through internal routes.
- `XiaoLou-LocalModelWorker` is a .NET Windows Service wrapper around the local
  Python adapter. Python stays inside the local model execution boundary and
  does not become the control plane or queue coordinator.
- Provider fallback policy should be expressed through PostgreSQL provider health
  rows and job routing decisions. Do not add Redis/Celery or process-local
  queues to coordinate provider state.

## Legacy core-api Compatibility Boundary

- Do not expose `core-api/` as the long-term production control plane.
- If a temporary `core-api` compatibility process must run, set `CORE_API_COMPAT_READ_ONLY=1`.
- In read-only mode, unspecified `CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST` now defaults to `GET /healthz;GET /api/windows-native/status`; all other legacy public GET routes are closed unless deliberately allowlisted.
- Read-only mode must not seed or project legacy snapshots into the Windows-native canonical test database. Use `scripts/windows/verify-core-api-compat-readonly.ps1` to start the full process and verify `/healthz`, `/api/windows-native/status`, closed legacy reads, and blocked writes. The default closed-read smoke covers wallet, jobs, projects/assets, chat model discovery, auth providers, legacy payment checkout, canvas/agent-canvas project reads, canvas library reads, and `/uploads/*`.
- Use `CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST=*` only for local debugging, not production cutover.
- Keep `docs/core-api-cutover.md` current whenever a legacy alias is added or retired.

## Legacy to Canonical Projection Gate

- Use `deploy/windows/legacy-canonical-projection-checklist.md` as the operator checklist before closing old write paths.
- Run `scripts/windows/verify-legacy-canonical-projection.ps1` as a non-mutating report against staging or production before any real cutover.
- If projection is required, run `scripts/windows/project-legacy-to-canonical.ps1` without `-Execute` first, review the report, then run it with `-Execute` only against a `legacy_projection_staging_*` schema unless production writes are frozen and `-AllowNonStaging` has explicit operator approval.
- The verifier checks legacy snapshot/table presence, canonical table readiness, non-terminal legacy job rows with canonical projection proof, paid recharge order projection, payment event callback projection, and wallet ledger canonical fields.
- After old legacy writers/workers are frozen, rerun `scripts/windows/verify-legacy-canonical-projection.ps1 -LegacyWritesFrozen` so projected non-terminal legacy rows no longer appear as a warning. This does not suppress missing projection blockers.
- `-AllowMissingLegacy` is only for local canonical smoke databases where no real legacy capture exists yet; do not use it as production evidence.
- A clean projection gate does not replace real provider payment replay or wallet audit. Run both before opening production traffic.

## Payment Gray Replay

1. Keep `wallet_ledger` immutable. Do not repair production balances with manual SQL updates.
   The built-in HMAC payment verifier is for normalized sandbox/replay payloads only.
   Real Alipay and WeChat Pay callbacks must go through the provider-specific native
   verifier/decrypt adapter before ledger processing.
2. Before replay, back up PostgreSQL and run:

```powershell
D:\code\XiaoLouAI\.runtime\app\scripts\windows\audit-wallet-ledger.ps1 -FailOnMismatch
D:\code\XiaoLouAI\.runtime\app\scripts\windows\rebuild-wallet-balances-from-ledger.ps1
```

Verify at least one `pg_dump -Fc` artifact in an isolated temporary database
before trusting it for rollback:

```powershell
D:\code\XiaoLouAI\.runtime\app\scripts\windows\verify-postgres-backup.ps1 `
  -DumpFile D:\code\XiaoLouAI\.runtime\xiaolou-backups\xiaolou-YYYYMMDD-HHMMSS.dump `
  -PgBin D:\soft\program\PostgreSQL\18\bin
```

3. Replay captured payment callbacks into a staging database first. Use the same provider, raw body, and signature headers used by production callbacks.
4. Confirm replay idempotency: the first accepted callback may insert a ledger row; exact duplicates must return `duplicate=true` and must not change balances.
5. Confirm negative replay handling: bad signatures, duplicate event IDs with different bodies, payment order amount/provider-trade conflicts, non-CN regions, and restricted data sensitivity must return HTTP 400.
6. During gray release, expose only the public payment callback route through the reverse proxy. Keep `/api/internal/*` blocked.
7. Before public provider routing, enable the callback account gate:
   `PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT=true` and one explicit canary grant
   in `PAYMENT_CALLBACK_ALLOWED_ACCOUNT_IDS` or
   `PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS`. Do not use wildcard grants.
8. After gray replay, rerun wallet audit. If balances are wrong, run the rebuild script in dry-run first and only apply a rebuild after operator approval.

Use `deploy/windows/payment-provider-replay-checklist.md` and
`scripts/windows/stage-payment-provider-replay.ps1` for real provider capture replay.
Without `-Execute`, the staging wrapper runs wallet audit and dry-run parsing only.

## Daily Checks

```powershell
Get-Service XiaoLou-ControlApi,XiaoLou-ClosedApiWorker,XiaoLou-LocalModelWorker
Invoke-RestMethod http://127.0.0.1:4100/healthz
Invoke-RestMethod http://127.0.0.1:4100/livez
Invoke-RestMethod http://127.0.0.1:4100/readyz
```

`/healthz` confirms the ASP.NET Core process is responding. `/livez` is a
minimal liveness probe for service managers and reverse proxies. `/readyz`
checks PostgreSQL readiness. `/metrics` is available only as an internal
operational endpoint and currently exposes process-level gauges; use Windows
Event Log plus `D:\code\XiaoLouAI\.runtime\xiaolou-logs` for structured
operational evidence.

## Windows Service Ops Drill

Run the service drill in read-only mode after publishing or service registration
changes. It checks the three Windows services, direct `dotnet.exe <dll>` service
paths, D: runtime boundaries, restart failure actions, dependencies, Control API
health, and recent XiaoLou/.NET/SCM warning or error events:

```powershell
D:\code\XiaoLouAI\scripts\windows\verify-windows-service-ops-drill.ps1
```

From an elevated PowerShell session, run the explicit restart drill only during
a staging or approved cutover window. The drill stops workers first, restarts
Control API, verifies `/healthz`, then starts workers in dependency order:

```powershell
D:\code\XiaoLouAI\scripts\windows\verify-windows-service-ops-drill.ps1 -ExecuteRestart
```

To combine the restart drill with the mutating P0 smoke, pass `-RunP0` only
against staging or a production-approved canary account:

```powershell
D:\code\XiaoLouAI\scripts\windows\verify-windows-service-ops-drill.ps1 `
  -ExecuteRestart `
  -RunP0 `
  -P0AccountOwnerId "user_login_smoke_001"
```

Rollback order remains conservative: stop workers before changing Control API,
start Control API first, then start `XiaoLou-LocalModelWorker` and
`XiaoLou-ClosedApiWorker`. The script writes a JSON report under
`D:\code\XiaoLouAI\.runtime\xiaolou-logs`.

## Runtime Rollback Drill

`publish-runtime-to-d.ps1` creates a rollback snapshot under
`D:\code\XiaoLouAI\.runtime\xiaolou-backups\runtime-snapshots` before it
overwrites published runtime artifacts. The snapshot covers published DLLs,
frontend `dist`, scripts, deploy files, and the local model worker payload.
It intentionally excludes `scripts\windows\.env.windows` so runtime secrets are
not copied into rollback archives.

Before an approved rollback window, run the verifier in read-only mode:

```powershell
D:\code\XiaoLouAI\scripts\windows\restore-runtime-snapshot.ps1
```

To restore the latest snapshot, use an elevated PowerShell session. The script
stops workers first, stops Control API, restores the runtime artifact paths,
preserves the active `.env.windows`, starts Control API, checks `/healthz`, and
then starts workers:

```powershell
D:\code\XiaoLouAI\scripts\windows\restore-runtime-snapshot.ps1 -Execute
```

Only combine rollback with P0 smoke against staging or a production-approved
canary account:

```powershell
D:\code\XiaoLouAI\scripts\windows\restore-runtime-snapshot.ps1 `
  -Execute `
  -RunP0 `
  -P0AccountOwnerId "user_login_smoke_001"
```

## Backups

```powershell
D:\code\XiaoLouAI\.runtime\app\scripts\windows\backup-postgres.ps1
```

Keep payment and wallet backups through at least one full reconciliation cycle.

## Recovery Rules

- Do not edit or delete `wallet_ledger` rows.
- Rebuild `wallet_balances` from immutable ledger rows if a balance snapshot is wrong.
- Reprocess `payment_callbacks` through idempotent payment handlers instead of manual balance edits.
- If workers fail, stop workers first, recover expired leases, then restart.
- Object storage permanent objects are never deleted during rollback; pause temp cleanup during incident windows.

## Forbidden Production Paths

- Docker, Docker Compose, Linux containers, Kubernetes, WSL.
- Windows + Celery as the async foundation.
- Redis Open Source on Windows as a critical dependency.
- RabbitMQ on Windows as the default queue.
- Legacy or upstream README files under `jaaz/`, `services/api/`, or other
  reference directories are not deployment guides. Do not copy Docker, Linux,
  Celery, Redis, RabbitMQ, or container startup steps from those references into
  production operations.
