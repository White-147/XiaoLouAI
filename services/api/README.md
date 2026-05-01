# XiaoLouAI Python API

This is the new production-oriented API layer for XiaoLouAI. It is intentionally
small in Stage 1: FastAPI, SQLAlchemy 2.x async sessions, Alembic migrations,
health checks, metrics, and basic project/task/upload routes.

The local PostgreSQL runtime now uses the existing `public` schema by default.
The former isolated `xiaolou_app` staging schema is no longer the default. Public
legacy IDs were converted in place to UUIDs by Alembic while preserving the
original text IDs in `legacy_id` / `legacy_*` columns and
`public.legacy_id_map`.

Before the in-place UUID merge, Alembic copied legacy public tables into:

```text
backup_before_uuid_merge_20260501
```

Keep that backup schema until production has run through at least one full
release and reconciliation cycle.

## Local setup

```powershell
cd D:\code\XiaoLouAI\services\api
Copy-Item .env.example .env
python -m venv .venv
.\.venv\Scripts\python -m pip install -e .[dev]
.\.venv\Scripts\alembic upgrade head
.\.venv\Scripts\uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Leave `PGBOUNCER_DATABASE_URL` empty for the simple local path unless PgBouncer
is running. When it is set, the API runtime prefers it over `DATABASE_URL`.

## Local infrastructure

The repository root now includes `docker-compose.yml` for local infrastructure.
By default it starts RabbitMQ and Redis only, so the API can keep using an
existing host PostgreSQL on `127.0.0.1:5432`. A compose PostgreSQL service is
kept behind the optional `postgres` profile for isolated/new-machine testing.
It uses pinned current stable official image tags:

```text
postgres:18.3-trixie
rabbitmq:4.2.6-management
redis:8.6.2-trixie
```

Initial developer credentials are `root` / `root` across PostgreSQL, RabbitMQ,
and Redis. Copy the compose example before starting RabbitMQ/Redis:

```powershell
cd D:\code\XiaoLouAI
Copy-Item .env.compose.example .env
.\scripts\pull-local-compose-images.ps1
docker compose up -d rabbitmq redis
```

To use the isolated compose PostgreSQL too:

```powershell
.\scripts\pull-local-compose-images.ps1 -IncludePostgres
docker compose --profile postgres up -d postgres rabbitmq redis
```

The compose PostgreSQL service maps container port `5432` to host port `55432`
by default so it does not collide with an existing host PostgreSQL. Keep
`DATABASE_URL=postgres://root:root@127.0.0.1:5432/xiaolou` for host PostgreSQL,
or switch to `127.0.0.1:55432` when testing against compose PostgreSQL.

RabbitMQ management UI:

```text
http://127.0.0.1:15672
user: root
password: root
```

Then copy `services/api/.env.example` to `services/api/.env`, run Alembic, and
start the API/workers from the host virtualenv. Replace these local passwords
before shared or internet-facing deployment.

OpenAPI:

```text
http://127.0.0.1:8000/docs
```

Health and core endpoints:

```text
GET /healthz
GET /readyz
GET /metrics
GET /api/projects
POST /api/projects
GET /api/tasks
POST /api/tasks
POST /api/uploads/sign
POST /api/payments/recharge-orders
GET /api/payments/recharge-orders/{order_id}
POST /api/admin/payments/recharge-orders/{order_id}/make-up
GET /api/admin/audit-logs
POST /api/video-replace/upload
POST /api/video-replace/reference
GET /api/video-replace/jobs
POST /api/video-replace/jobs
GET /api/video-replace/jobs/{job_id}
POST /api/video-replace/jobs/{job_id}/detect
POST /api/video-replace/jobs/{job_id}/enqueue
POST /api/video-replace/jobs/{job_id}/cancel
POST /api/video-replace/reference-import
```

## Workers

Stage 3 adds Celery orchestration with RabbitMQ as broker and Redis as result
backend. Start CPU/API workers and the GPU queue separately:

```powershell
.\.venv\Scripts\celery -A app.workers.celery_app.celery_app worker -Q default,payments,provider_polling,video_cloud_api
.\.venv\Scripts\celery -A app.workers.celery_app.celery_app worker -Q video_local_gpu
```

Configured queues:

```text
default
payments
provider_polling
video_local_gpu
video_local_gpu_dlq
video_cloud_api
```

Provider model IDs use `<backend>:<kind>:<name>`, for example
`cloud:video:default`, `local:video:replace`, or `cloud:image:default`.

Stage 4 routes video-replace generation through the Python API and Celery:

- Python API now owns upload/import/reference/reference-import/detect routes and
  mounts the shared `/vr-*` static directories from `video-replace-service/data`.
- Node `core-api` keeps the compatibility URL surface during cutover, but now
  proxies upload/import/reference/reference-import/detect to this Python API.
- `POST /api/video-replace/jobs/{job_id}/enqueue` links the PostgreSQL
  `video_replace_jobs` row to a `tasks` row and `provider_jobs` row.
- The Celery `video_local_gpu` worker runs `video-replace-service/vr_pipeline_cli.py`.
- Cancellation marks the durable job cancelled and, when configured, kills
  recorded `pipeline_pid` / `subprocess_pid` process trees and revokes the
  Celery task when its task id is known.
- `video_local_gpu` is configured with a RabbitMQ dead-letter route to
  `video_local_gpu_dlq`, late ACKs, worker-lost rejection, and prefetch 1.

Useful env vars:

```text
VIDEO_REPLACE_SERVICE_DIR=../../video-replace-service
VIDEO_REPLACE_PYTHON_PATH=
VIDEO_REPLACE_PIPELINE_TIMEOUT_SECONDS=10800
VIDEO_REPLACE_DETECT_TIMEOUT_SECONDS=120
VIDEO_REPLACE_MODEL_ID=local:video:replace
```

## Migration commands

```powershell
.\.venv\Scripts\alembic current
.\.venv\Scripts\alembic upgrade head
.\.venv\Scripts\alembic downgrade -1
```

Current local head:

```text
20260501_0003
```

Migration highlights:

- `20260501_0001`: initial Python schema.
- `20260501_0002`: merge legacy `public` tables into UUID-compatible runtime
  schema and copy `project_assets` into `assets`.
- `20260501_0003`: add runtime defaults for JSON, timestamps, wallet, ledger,
  and recharge fields after the public UUID merge.

Important: `20260501_0002` intentionally does not implement automatic
downgrade. Restoring pre-merge data must be a manual restore from
`backup_before_uuid_merge_20260501`, otherwise writes made after the merge could
be silently discarded.

## Stage boundaries

- Stage 1: minimum runtime and schema.
- Stage 2: payment idempotency, wallet ledger, webhook verification, audit log,
  and admin make-up order endpoint.
- Stage 3: Celery/RabbitMQ/Redis task orchestration and provider abstraction.
- Stage 4: video-replace worker migration from Node process-local queue to
  Python API + Celery `video_local_gpu`.
