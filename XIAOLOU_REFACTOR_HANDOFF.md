# XiaoLouAI Python Refactor Handoff

Generated: 2026-05-01
Workspace: `D:\code\XiaoLouAI`

This is the portable continuation note for the Python-first refactor. A longer
local copy may exist at `docs/xiaolouai-python-refactor-handoff.md`, but
`/docs/` is ignored by this repo, so this root file is the one to carry across
sessions and commits.

## Current State

- Frontend: `XIAOLOU-main/`, React + Vite SPA. Keep it; production should serve
  `dist` through Caddy/Nginx/Ingress after `vite build`.
- Node API: `core-api/`, retained only as a transition compatibility layer.
- Python API: `services/api/`, now contains the Stage 1 FastAPI + SQLAlchemy +
  Alembic minimum runtime, the Stage 2 payment minimum loop, the Stage 3
  Celery/provider foundation, the Stage 4 video-replace Celery enqueue path,
  and the local public-schema UUID merge.
- Important correction vs the external report: current local
  `core-api/src/server.js` does not directly construct `SqliteStore`; it uses
  `store-factory.js`, which creates `PostgresStore`.
- Remaining risks:
  - `core-api/scripts/*sqlite*.js` still use `node:sqlite`, but are migration-only
    tools.
  - `core-api/src/video-replace-native.js` still contains legacy
    `_runningPipelines` / `_queuedPipelineJobs` helpers for old detached
    process adoption, but new `generate` requests enqueue through Python API +
    Celery `video_local_gpu`.
  - `video-replace-service/` is legacy HTTP sidecar code; its CLI/model code can
    be reused by GPU Celery workers.
- Root production Docker/K8s/monitoring files are still missing.
- Root `docker-compose.yml` now exists for local infrastructure unblock:
  RabbitMQ and Redis start by default with pinned stable official image tags
  and local `root` / `root` credentials. PostgreSQL is retained behind the
  optional `postgres` profile for isolated/new-machine testing. Compose
  PostgreSQL maps to host port `55432` by default to avoid colliding with a
  host PostgreSQL on `5432`. Docker is not installed on this workstation yet,
  so image pull/start remains unverified here.
- The `backup_before_uuid_merge_20260501` schema must be retained until a full
  release and reconciliation cycle completes.

## Completed In This Session

### Stage 0

- Removed frontend bundle injection of `process.env.GEMINI_API_KEY` from
  `XIAOLOU-main/vite.config.ts`.
- Changed mock payment default from global `*` exposure to local-only in:
  - `core-api/.env.example`
  - `core-api/src/payments/shared.js`
- Added standard PostgreSQL env examples to `core-api/.env.example`:
  - `DATABASE_URL`
  - `READ_DATABASE_URL`
  - `PGBOUNCER_DATABASE_URL`
  - `POSTGRES_USER`
  - `POSTGRES_PASSWORD`
  - `POSTGRES_DB`
- Updated `README.md` and `core-api/README.md` to record the real runtime state:
  Node `core-api` is transitional, `services/api` is the Python production
  target, `CORE_API_DB_PATH` is migration-only, and `vite preview` is not a
  production serving mode.
- Checked `core-api/package.json` script paths against `core-api/scripts/`; all
  declared script files exist.

### Stage 1

Created the minimum Python API runtime under `services/api/`:

```text
services/api/.env.example
services/api/README.md
services/api/alembic.ini
services/api/alembic/env.py
services/api/alembic/versions/20260501_0001_initial_schema.py
services/api/app/__init__.py
services/api/app/config.py
services/api/app/db.py
services/api/app/logging.py
services/api/app/main.py
services/api/app/metrics.py
services/api/app/models.py
services/api/app/schemas.py
services/api/app/api/__init__.py
services/api/app/api/routes/__init__.py
services/api/app/api/routes/health.py
services/api/app/api/routes/projects.py
services/api/app/api/routes/tasks.py
services/api/app/api/routes/uploads.py
services/api/pyproject.toml
services/api/tests/test_health.py
services/api/tests/test_models.py
```

Stage 1 schema currently includes:

- `users`
- `projects`
- `assets`
- `tasks`
- `wallets`
- `wallet_ledger`
- `wallet_recharge_orders`
- `payment_events`
- `idempotency_keys`
- `video_replace_jobs`
- `provider_jobs`
- `outbox_events`
- `audit_logs`

Payment safety primitives already present at schema level:

- `wallet_recharge_orders.idempotency_key` unique constraint
- `wallet_recharge_orders(provider, provider_trade_no)` unique constraint
- `payment_events(provider, event_id)` unique constraint
- `idempotency_keys(scope, key)` unique constraint
- wallet ledger source uniqueness
- outbox and audit tables

The Python runtime now defaults to the existing PostgreSQL `public` schema,
not the temporary `xiaolou_app` schema. Alembic revision `20260501_0002`
converted legacy public text IDs to deterministic UUIDs in place, preserving the
old values in `legacy_id` / `legacy_*` columns and `public.legacy_id_map`.
Before altering public tables, the migration copied legacy data into:

```text
backup_before_uuid_merge_20260501
```

API project/task lookups accept both the new UUID and the old legacy text ID.
The Node compatibility projector in `core-api/src/postgres-schema.js` now uses
the same deterministic UUID mapping for future public-table writes.

### Stage 2

Added:

```text
services/api/app/api/routes/admin.py
services/api/app/api/routes/payments.py
services/api/app/api/routes/wallets.py
services/api/app/services/audit.py
services/api/app/services/payment_signatures.py
services/api/app/services/payments.py
services/api/app/services/wallets.py
services/api/tests/test_payments.py
```

Implemented:

- Recharge order creation with `Idempotency-Key` / request body idempotency key.
- Database-backed idempotency via `idempotency_keys(scope, key)`.
- Recharge order uniqueness by `idempotency_key` and `provider + provider_trade_no`.
- Payment event dedupe by `payment_events(provider, event_id)`.
- Wallet credit once by `wallet_ledger(wallet_id, source_type, source_id)`.
- Wallet ledger + outbox event in the same transaction.
- Order state transition guard.
- Alipay RSA2 callback verification and replay window check.
- WeChat Pay RSA callback verification, replay window check, and AES-GCM resource
  decryption.
- Audit log writes for order creation, webhook missing-order cases, paid orders,
  and admin make-up payments.
- Admin make-up endpoint:
  `POST /api/admin/payments/recharge-orders/{order_id}/make-up`.

### Stage 2 Runtime Hardening

Fixed during the Stage 3 continuation:

- `services/api/.env.example` now leaves `PGBOUNCER_DATABASE_URL` empty by
  default. The API still prefers PgBouncer when configured, but a copied local
  `.env` no longer points at a likely-missing local port `6432`.
- Wallet creation now uses PostgreSQL `ON CONFLICT DO NOTHING` for
  `wallets(owner_type, owner_id)` so concurrent recharge attempts do not race on
  the unique owner constraint.
- Wallet credit-once now locks the wallet before checking
  `wallet_ledger(wallet_id, source_type, source_id)`, closing the replay race
  where a second transaction could read before the first ledger row committed.
- Payment webhook signature parsing now maps malformed PEM/signature/ciphertext,
  invalid UTF-8, bad JSON, and bad WeChat encrypted resources to
  `PaymentSignatureError` instead of leaking 500-class runtime errors.

### Stage 3

Added:

```text
services/api/app/providers/__init__.py
services/api/app/providers/base.py
services/api/app/providers/cloud_video.py
services/api/app/providers/local_video.py
services/api/app/providers/cloud_image.py
services/api/app/providers/local_image.py
services/api/app/providers/registry.py
services/api/app/services/task_orchestration.py
services/api/app/workers/__init__.py
services/api/app/workers/celery_app.py
services/api/app/workers/tasks.py
services/api/tests/test_providers.py
services/api/tests/test_workers.py
```

Implemented:

- Celery app using RabbitMQ broker and Redis result backend.
- Queues:
  - `default`
  - `payments`
  - `provider_polling`
  - `video_local_gpu`
  - `video_local_gpu_dlq`
  - `video_cloud_api`
- Provider model ID format: `<backend>:<kind>:<name>`, for example
  `cloud:video:default` or `local:video:replace`.
- Provider abstraction:
  - `CloudVideoProvider`
  - `LocalVideoProvider`
  - `CloudImageProvider`
  - `LocalImageProvider`
  - `resolve_provider(model_id)`
  - `infer_model_id(...)`
  - `queue_for_model(model_id)` without requiring provider credentials.
- `POST /api/tasks` now creates a `tasks` row, infers/records a `provider_jobs`
  row for video/image tasks, and attempts to publish a Celery dispatch task.
  Publish failures are recorded on the task as `enqueue_failed` unless
  `TASK_PUBLISH_ENABLED=false`.
- Worker tasks:
  - `dispatch_task`
  - `submit_provider_job`
  - `poll_provider_job`
  - `reconcile_recharge_order`
- Provider submission/polling updates `provider_jobs`, propagates status and
  progress back to `tasks`, and reschedules non-terminal jobs through
  `provider_polling`.

### Stage 4

Added/changed:

```text
docker-compose.yml
.env.compose.example
scripts/pull-local-compose-images.ps1
services/api/app/api/routes/video_replace.py
services/api/app/services/video_replace.py
services/api/tests/test_video_replace.py
services/api/app/workers/celery_app.py
services/api/app/workers/tasks.py
video-replace-service/app/services/tasks_db.py
core-api/src/video-replace-native.js
```

Implemented:

- Python API routes:
  - `GET /api/video-replace/jobs`
  - `GET /api/video-replace/jobs/{job_id}`
  - `POST /api/video-replace/jobs/{job_id}/enqueue`
  - `POST /api/video-replace/jobs/{job_id}/cancel`
- `VideoReplaceJob` ORM now maps to the real public
  `video_replace_jobs.job_id` UUID primary key instead of a non-existent `id`
  column.
- Node video-replace compatibility routes now proxy
  upload/import/reference/reference-import/detect to the Python API after
  lightweight legacy access checks. Python creates UUID job IDs matching the
  merged public schema. Legacy text IDs can still be resolved through
  `legacy_id`.
- `POST /api/video-replace/jobs/:id/generate` in Node no longer calls the
  process-local GPU queue. It updates the durable row to `queued`, then calls
  the Python API enqueue endpoint.
- Python enqueue links the durable `video_replace_jobs` row to:
  - a `tasks` row with `task_type=video_replace`
  - a `provider_jobs` row with `provider=local_video`
  - queue `video_local_gpu`
- Celery tasks added:
  - `run_video_replace_detection`
  - `run_video_replace_pipeline`
- `run_video_replace_pipeline` executes
  `video-replace-service/vr_pipeline_cli.py` from the `video_local_gpu` worker,
  records the pipeline PID, syncs final stage/progress/result back to
  `tasks`/`provider_jobs`, and marks failures durably.
- Python cancellation marks the job/task/provider job cancelled and can kill
  recorded `pipeline_pid` / `subprocess_pid` process trees.
- Python API now owns video-replace upload/import/reference/reference-import
  and detect compatibility routes:
  - `POST /api/video-replace/upload`
  - `POST /api/video-replace/reference`
  - `POST /api/video-replace/jobs`
  - `POST /api/video-replace/jobs/{job_id}/detect`
  - `POST /api/video-replace/reference-import`
- Core API still exposes the compatibility URL surface during cutover, but the
  above routes are forwarded to `PYTHON_API_INTERNAL_BASE_URL`.
- Python API mounts shared static directories:
  `/vr-uploads`, `/vr-thumbnails`, `/vr-candidates`, `/vr-keyframes`,
  `/vr-references`, `/vr-masks`, `/vr-results`, and `/vr-finals`.
- `VideoReplaceJob.progress` is mapped as `Numeric(10,4)`, matching the real
  PostgreSQL `numeric` column used by Node and `video-replace-service`.
- `video_local_gpu` now has RabbitMQ dead-letter configuration targeting
  `video_local_gpu_dlq`, late ACKs, worker-lost rejection, prefetch 1, and a
  one-retry Celery policy for transient task exceptions.
- Cancellation now also attempts to revoke the recorded Celery task id before
  killing recorded process trees.
- `video-replace-service/app/services/tasks_db.py` now aligns its DDL and
  lookups with UUID `job_id`, while preserving legacy lookup by `legacy_id`.
- `core-api/src/postgres-schema.js` now creates `video_replace_jobs.job_id` as
  UUID for new projected schemas and adds `legacy_id`.
- `PYTHON_API_INTERNAL_BASE_URL` documents the Node-to-Python enqueue target.
- Local compose infrastructure added:
  - `postgres:18.3-trixie`
  - `rabbitmq:4.2.6-management`
  - `redis:8.6.2-trixie`
  - named volumes for all three services
  - health checks for all three services
  - RabbitMQ management UI on `15672`
  - RabbitMQ/Redis start by default; PostgreSQL is opt-in via compose profile
    `postgres`
  - PostgreSQL host port `55432` by default, container port `5432`
  - developer credentials `root` / `root`
  - `scripts/pull-local-compose-images.ps1` for image download once Docker is
    installed; pass `-IncludePostgres` to pull the optional PostgreSQL image.

## Validation Already Run

```powershell
node --check core-api\src\payments\shared.js
```

Passed.

```powershell
Get-ChildItem -Path XIAOLOU-main,core-api -Recurse -Force -File |
  Where-Object { $_.FullName -notmatch '\\node_modules\\|\\.git\\|\\.venv\\|\\.cache\\|backup\\|\\.env\.local$' } |
  Select-String -Pattern 'process\.env\.GEMINI_API_KEY','PAYMENT_MOCK_ALLOWED_HOSTS="\*"','DEFAULT_PAYMENT_MOCK_ALLOWED_HOSTS = \["\*"\]' |
  Select-Object Path,LineNumber,Line
```

Only remaining `process.env.GEMINI_API_KEY` hit is
`core-api/src/canvas-library.js`, which is server-side and not injected into the
Vite client bundle.

Python syntax was checked with the bundled Codex Python by compiling source
strings directly. Result: `syntax ok`.

The dependency issue from the previous session is resolved. A virtualenv exists
at `services/api/.venv` with the bundled Python 3.12.13, dependencies were
installed with `pip install -e .[dev]`, and the current validation is:

```powershell
cd D:\code\XiaoLouAI\services\api
.\.venv\Scripts\python.exe -m pytest -q
# 8 passed

.\.venv\Scripts\python.exe -m ruff check app tests alembic
# All checks passed

.\.venv\Scripts\python.exe -m alembic upgrade head
# upgraded to 20260501_0003

.\.venv\Scripts\python.exe -m alembic current -v
# Rev: 20260501_0003 (head)
```

Verified merged runtime tables exist in `public`:

```text
assets, audit_logs, idempotency_keys, outbox_events, payment_events, projects,
provider_jobs, tasks, users, video_replace_jobs, wallet_ledger,
wallet_recharge_orders, wallets
```

Also ran an API-level smoke test with `httpx.AsyncClient + ASGITransport`:
`POST /api/payments/recharge-orders` twice with the same `Idempotency-Key`
returned `201` both times and the same order ID. Smoke rows were cleaned up.

After the Stage 3 continuation, the latest validation is:

```powershell
cd D:\code\XiaoLouAI\services\api
.\.venv\Scripts\python.exe -m alembic current -v
# Rev: 20260501_0003 (head)

.\.venv\Scripts\python.exe -m pytest -q
# 13 passed

.\.venv\Scripts\python.exe -m ruff check app tests alembic
# All checks passed

.\.venv\Scripts\python.exe -c "import app.workers.tasks; print('workers import ok')"
# workers import ok

.\.venv\Scripts\python.exe -c "from app.main import create_app; app=create_app(); print(len(app.openapi()['paths']))"
# 13
```

After the Stage 4 upload/import/reference/detect continuation, the latest
validation is:

```powershell
cd D:\code\XiaoLouAI\services\api
.\.venv\Scripts\python.exe -m pytest -q
# 16 passed

.\.venv\Scripts\python.exe -m ruff check app tests alembic
# All checks passed

.\.venv\Scripts\python.exe -m alembic current -v
# Rev: 20260501_0003 (head)

.\.venv\Scripts\python.exe -c "import app.workers.tasks; from app.main import create_app; app=create_app(); print('worker/openapi', len(app.openapi()['paths']))"
# worker/openapi 21

cd D:\code\XiaoLouAI
node --check core-api\src\video-replace-native.js
# passed

node --check core-api\src\postgres-schema.js
# passed
```

RabbitMQ/Redis/GPU worker E2E status:

```powershell
Test-NetConnection 127.0.0.1 -Port 5672 -InformationLevel Quiet
# False

Test-NetConnection 127.0.0.1 -Port 6379 -InformationLevel Quiet
# False

Get-Command docker,rabbitmq-server,redis-server -ErrorAction SilentlyContinue
# no commands found on PATH

Get-Service *rabbit*,*redis* -ErrorAction SilentlyContinue
# no services found
```

The real `video_local_gpu` generate E2E remains blocked on local runtime
availability, not on the Python API code path.

Post-merge smoke test results:

- `GET /api/projects/{uuid}` returned `200`.
- `GET /api/projects/proj_demo_001` returned `200` and the same project UUID.
- Two `POST /api/payments/recharge-orders` calls with the same
  `Idempotency-Key` returned `201` and the same order ID.
- Smoke rows were deleted; `public.idempotency_keys` has no
  `codex-merge-smoke-%` rows.
- Stage 3 task smoke with `TASK_PUBLISH_ENABLED=false`:
  - `POST /api/tasks` with `task_type=video_replace` and
    `model_id=local:video:smoke` returned `202`.
  - Response status was `queued`.
  - Queue was `video_local_gpu`.
  - Provider was `local_video`.
  - Smoke `tasks` / `provider_jobs` rows were deleted.
- Stage 4 enqueue smoke with `TASK_PUBLISH_ENABLED=false`:
  - Inserted a temporary UUID `video_replace_jobs` row at stage `queued`.
  - `POST /api/video-replace/jobs/{job_id}/enqueue` returned `202`.
  - Response showed `published=false`, status `queued`, queue `video_local_gpu`.
  - The row was linked to both a `tasks` row and a `provider_jobs` row.
  - Smoke `video_replace_jobs` / `tasks` / `provider_jobs` rows were deleted.

## Commands For The Next Developer

Start local infrastructure after Docker Desktop is installed:

```powershell
cd D:\code\XiaoLouAI
Copy-Item .env.compose.example .env
.\scripts\pull-local-compose-images.ps1
docker compose up -d rabbitmq redis
docker compose ps
```

To use isolated compose PostgreSQL instead of host PostgreSQL:

```powershell
.\scripts\pull-local-compose-images.ps1 -IncludePostgres
docker compose --profile postgres up -d postgres rabbitmq redis
```

Install and run Stage 1 locally:

```powershell
cd D:\code\XiaoLouAI\services\api
Copy-Item .env.example .env
python -m venv .venv
.\.venv\Scripts\python -m pip install -e .[dev]
.\.venv\Scripts\alembic upgrade head
.\.venv\Scripts\pytest
.\.venv\Scripts\uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Start workers:

```powershell
cd D:\code\XiaoLouAI\services\api
.\.venv\Scripts\celery -A app.workers.celery_app.celery_app worker -Q default,payments,provider_polling,video_cloud_api
.\.venv\Scripts\celery -A app.workers.celery_app.celery_app worker -Q video_local_gpu
```

Useful endpoints:

```text
GET  /healthz
GET  /readyz
GET  /metrics
GET  /api/projects
POST /api/projects
GET  /api/tasks
POST /api/tasks
POST /api/tasks/{task_id}/cancel
POST /api/uploads/sign
POST /api/video-replace/upload
POST /api/video-replace/reference
GET  /api/video-replace/jobs
POST /api/video-replace/jobs
POST /api/video-replace/jobs/{job_id}/detect
POST /api/video-replace/jobs/{job_id}/enqueue
POST /api/video-replace/jobs/{job_id}/cancel
POST /api/video-replace/reference-import
```

Alembic operations:

```powershell
cd D:\code\XiaoLouAI\services\api
.\.venv\Scripts\alembic current
.\.venv\Scripts\alembic upgrade head
.\.venv\Scripts\alembic revision --autogenerate -m "message"
```

Do not run `alembic downgrade -1` across `20260501_0002` in production. Restore
from `backup_before_uuid_merge_20260501` manually if the UUID merge itself must
be rolled back.

## Recommended Next Steps

### Stage 4 Video Replace Remaining

- Run an end-to-end GPU worker test with real RabbitMQ/Redis and
  `video_local_gpu` worker online. On this workstation, TCP checks for
  `127.0.0.1:5672` and `127.0.0.1:6379` failed, and no Docker/RabbitMQ/Redis
  commands or Windows services were found, so the true worker E2E is
  environment-blocked.
- Wire `LocalVideoProvider` directly to the CLI/model code or retire the
  generic HTTP local-video adapter once all video paths use
  `video_replace_jobs`.
- Decide when to retire the now-unused Node-local upload/import/reference/detect
  handler implementations after the Python proxy has soaked.
- Decide when to remove legacy Node orphan adoption helpers for pre-Stage-4
  detached pipeline processes.

### Stage 5 Deployment

Current credential convention for continuing the local/initial deployment:

```text
POSTGRES_USER=root
POSTGRES_PASSWORD=root
POSTGRES_PORT=55432
RABBITMQ_DEFAULT_USER=root
RABBITMQ_DEFAULT_PASS=root
RABBITMQ_DEFAULT_VHOST=xiaolou
RABBITMQ_URL=amqp://root:root@rabbitmq:5672/xiaolou
REDIS_PASSWORD=root
REDIS_URL=redis://:root@redis:6379/0
```

For host-mode Python API tests against compose PostgreSQL, use
`DATABASE_URL=postgres://root:root@127.0.0.1:55432/xiaolou`. For containers on
the compose network, use `postgres:5432`.

This `root` / `root` convention is for developer convenience while the stack is
being assembled. Do not commit real production secrets. Before internet-facing
or shared production deployment, replace PostgreSQL, RabbitMQ, and Redis
passwords with independent strong values in the server `.env`, deployment
secrets, or secret manager.

Generate:

```text
Dockerfile
deploy/caddy/Caddyfile
deploy/nginx/nginx.conf
deploy/k8s/*.yaml
deploy/pgbouncer/*
deploy/rabbitmq/*
deploy/redis/*
deploy/prometheus/*
deploy/grafana/*
.github/workflows/ci.yml
```

Compose services:

- `api`
- `worker-cpu`
- `worker-gpu`
- `postgres`
- `pgbouncer`
- `rabbitmq`
- `redis`
- `caddy`
- `prometheus`
- `grafana`
- `loki`

## Next Session Prompt

```text
请继续 XiaoLouAI Python 化重构。先读取 XIAOLOU_REFACTOR_HANDOFF.md，按当前仓库真实代码继续。Stage 0-4 已完成到当前切面：配置收紧、README 更新、脚本路径核验、services/api FastAPI + SQLAlchemy + Alembic 最小闭环、支付幂等/钱包记账/webhook 验签/审计日志/后台补单入口、Celery/RabbitMQ/Redis 队列骨架、provider 抽象层，以及 video-replace generate 从 Node 进程内队列迁到 Python API + tasks/video_replace_jobs + provider_jobs + Celery video_local_gpu。请先运行 services/api 的 pytest/ruff/alembic current 验证；如通过，继续 Stage 4 剩余项：真实 RabbitMQ/Redis + video_local_gpu GPU worker 端到端验证，逐步把 upload/import/reference/detect 兼容路由迁入 Python，完善 retry/dead-letter/cancel 语义。注意：外部报告里关于 server.js 直接 new SqliteStore 的结论已过期，本地当前是 store-factory.js -> PostgresStore。
```

## Previous Mojibake Prompt

```text
请继续 XiaoLouAI Python 化重构。先读取 XIAOLOU_REFACTOR_HANDOFF.md，按当前仓库真实代码继续。
Stage 0 已完成配置收紧、README 更新和脚本路径核验；Stage 1 已补齐 services/api FastAPI + SQLAlchemy + Alembic 最小闭环；Stage 2 已补齐支付幂等、钱包记账、webhook 验签、审计日志和后台补单入口。
请先运行 services/api 的 pytest/ruff/alembic current 验证；如通过，进入 Stage 3：Celery/RabbitMQ/Redis 任务编排与 provider 抽象层。
注意：外部报告里关于 server.js 直接 new SqliteStore 的结论已过期，本地当前是 store-factory.js -> PostgresStore。
```
