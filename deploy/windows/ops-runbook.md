# XiaoLouAI Windows Native Ops Runbook

## Services

- `XiaoLou-ControlApi`: `.NET 8 / ASP.NET Core` control plane on `127.0.0.1:4100`.
- `XiaoLou-ClosedApiWorker`: `.NET Worker Service` for closed API jobs.
- `XiaoLou-LocalModelWorker`: Python local model adapter process.

## P1 Production Entry

1. Publish the Windows native runtime to `D:\code\XiaoLouAI\.runtime\app`:

```powershell
D:\code\XiaoLouAI\scripts\windows\install.ps1 -RegisterServices -UpdateExisting -AssertDDrive
```

Run service registration from an elevated PowerShell session. The rehearsal script reports `service-admin` as a blocker when `-RegisterServices` or `-StartServices` is requested without administrator rights.

2. Review `D:\code\XiaoLouAI\.runtime\app\scripts\windows\.env.windows` before starting services. At minimum set production values for:

- `DATABASE_URL`
- `PAYMENT_WEBHOOK_SECRET`
- `INTERNAL_API_TOKEN`
- `CLIENT_API_TOKEN`
- `OBJECT_STORAGE_PROVIDER`
- `OBJECT_STORAGE_BUCKET`
- `OBJECT_STORAGE_PUBLIC_BASE_URL`

3. Start services after the env file and reverse proxy have been checked:

```powershell
D:\code\XiaoLouAI\.runtime\app\scripts\windows\start-services.ps1
Get-Service XiaoLou-ControlApi,XiaoLou-ClosedApiWorker,XiaoLou-LocalModelWorker
Invoke-RestMethod http://127.0.0.1:4100/healthz
```

4. Run the P0 smoke verification against the production-style local endpoint before opening public traffic:

```powershell
$env:CONTROL_API_BASE_URL = "http://127.0.0.1:4100"
$env:INTERNAL_API_TOKEN = "<same value as .env.windows>"
$env:CLIENT_API_TOKEN = "<same value as .env.windows>"
D:\code\XiaoLouAI\.runtime\app\scripts\windows\verify-control-plane-p0.ps1
```

For a non-mutating preflight report before publishing or service changes, run:

```powershell
D:\code\XiaoLouAI\scripts\windows\rehearse-production-cutover.ps1
```

## Internal API Boundary

- `/api/internal/*` is worker-only. Public reverse proxies must block it before general `/api/*` forwarding.
- `/api/schema/*` and `/api/providers/health` are operational APIs. Public reverse proxies must block them too.
- `deploy/windows/Caddyfile.windows.example` and `deploy/windows/iis-web.config.example` include the public block rules.
- `INTERNAL_API_TOKEN` should be set in production. Workers send it as `X-XiaoLou-Internal-Token`.
- If the token is absent, the Control API only allows internal endpoints from loopback requests with no external forwarding headers. This is for local verification only, not production.

## Public Client API Boundary

- `CLIENT_API_TOKEN` should be set in production. Public client routes send it as `X-XiaoLou-Client-Token` or `Authorization: Bearer <token>`.
- Protected public client routes are `/api/accounts/ensure`, `/api/jobs*`, and `/api/media*`.
- Keep `CLIENT_API_REQUIRE_ACCOUNT_SCOPE=true` in production so requests must carry account scope headers matching the request body/query/route.
- Set `CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT=true` before production cutover once the active accounts are known. Then grant only the intended accounts with `CLIENT_API_ALLOWED_ACCOUNT_IDS`, or owner-scoped canaries with `CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS` such as `user:<id>` or `organization:<id>`.
- `CLIENT_API_ALLOWED_ACCOUNT_IDS=*` and owner wildcards such as `user:*` are broad grants. Use them only for temporary staging or deliberate canary windows with a rollback plan.
- `/api/payments/callbacks/*` remains provider-signature protected and is not a client-token route.

## Payment Gray Replay

1. Keep `wallet_ledger` immutable. Do not repair production balances with manual SQL updates.
2. Before replay, back up PostgreSQL and run:

```powershell
D:\code\XiaoLouAI\.runtime\app\scripts\windows\audit-wallet-ledger.ps1 -FailOnMismatch
D:\code\XiaoLouAI\.runtime\app\scripts\windows\rebuild-wallet-balances-from-ledger.ps1
```

3. Replay captured payment callbacks into a staging database first. Use the same provider, raw body, and signature headers used by production callbacks.
4. Confirm replay idempotency: the first accepted callback may insert a ledger row; exact duplicates must return `duplicate=true` and must not change balances.
5. Confirm negative replay handling: bad signatures, duplicate event IDs with different bodies, payment order amount/provider-trade conflicts, non-CN regions, and restricted data sensitivity must return HTTP 400.
6. During gray release, expose only the public payment callback route through the reverse proxy. Keep `/api/internal/*` blocked.
7. After gray replay, rerun wallet audit. If balances are wrong, run the rebuild script in dry-run first and only apply a rebuild after operator approval.

Use `deploy/windows/payment-provider-replay-checklist.md` and
`scripts/windows/stage-payment-provider-replay.ps1` for real provider capture replay.
Without `-Execute`, the staging wrapper runs wallet audit and dry-run parsing only.

## Daily Checks

```powershell
Get-Service XiaoLou-ControlApi,XiaoLou-ClosedApiWorker,XiaoLou-LocalModelWorker
Invoke-RestMethod http://127.0.0.1:4100/healthz
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
