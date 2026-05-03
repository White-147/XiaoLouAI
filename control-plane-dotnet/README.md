# XiaoLouAI Control Plane (.NET)

Language: [English](README.md) | [简体中文](README.zh-CN.md)

This directory is the Windows-native long-term control plane for XiaoLouAI.

```text
.NET 8 / ASP.NET Core
+ PostgreSQL canonical schema
+ PostgreSQL advisory locks / SKIP LOCKED / LISTEN NOTIFY
+ Windows Service workers
```

No Docker, Linux, Kubernetes, Windows + Celery, or Redis Open Source on Windows
runtime is required by this control plane.

## Projects

```text
src/XiaoLou.ControlApi                 ASP.NET Core API
src/XiaoLou.ClosedApiWorker            Windows Worker Service for closed API calls
src/XiaoLou.Domain                     shared request/response contracts
src/XiaoLou.Infrastructure.Postgres    PostgreSQL queues, payments, outbox, health
src/XiaoLou.Infrastructure.Storage     object-storage signing abstraction
db/migrations                          canonical PostgreSQL SQL
```

## Current Canonical Surfaces

Implemented source surfaces include accounts, jobs, payment callbacks, wallet
reads, media metadata/signing, the project/create/canvas batch, the
identity/config batch, the project-adjacent batch, the admin/system batch,
Playground, and Toolbox:

- `/api/projects*`
- `/api/projects/{projectId}/assets*`
- `/api/projects/{projectId}/storyboards*`
- `/api/projects/{projectId}/videos`
- `/api/projects/{projectId}/dubbings`
- `/api/projects/{projectId}/exports`
- `/api/canvas-projects*`
- `/api/agent-canvas/projects*`
- `/api/create/images*`
- `/api/create/videos*`
- `/api/auth*`
- `/api/me`
- `/api/organizations/*/members`
- `/api/api-center*`
- `/api/admin/pricing-rules`
- `/api/admin/orders`
- `/api/enterprise-applications*`
- `/api/capabilities`
- `/api/playground/config|models|conversations|chat-jobs|memories`
- `/api/toolbox*`

These routes are backed by PostgreSQL canonical tables and explicit client
permissions. The project/create/canvas, identity/config, project-adjacent, and
admin/system batches have passed source build, elevated publish/restart/P0, and
`http://127.0.0.1:4100` runtime smokes, so the running `XiaoLou-ControlApi`
Windows service contains them. Manual admin recharge review remains retired and
returns 410; payment writes stay on canonical callbacks plus `wallet_ledger`.
The Playground batch has also passed source build, frontend lint/build, the
frontend legacy dependency gate, a temporary `http://127.0.0.1:4110` P0 smoke,
and elevated publish/restart/P0 against the real 4100 Windows service.
The Toolbox batch is backed by `toolbox_capabilities`, `toolbox_runs`, and
canonical `jobs`; source build, frontend build, the frontend legacy dependency
gate, a temporary 4110 P0 smoke, strict legacy/canonical projection verification,
and a patched 4100 P0 smoke passed. The combined publish script now streams P0
output live after build/publish, and the P0 verifier accepts the background
lease-recovery race that previously made the combined report fail after the
runtime had already been published and restarted.

## Local Build

Install the .NET 8 SDK on Windows, then run:

```powershell
dotnet restore
dotnet build
```

Set `DATABASE_URL` or `ConnectionStrings__Postgres` before starting services.

```powershell
$env:DATABASE_URL="postgres://xiaolou_app:change-me@127.0.0.1:5432/xiaolou"
$env:Postgres__ApplySchemaOnStartup="true"
dotnet run --project .\src\XiaoLou.ControlApi\XiaoLou.ControlApi.csproj
```

The API listens on `http://127.0.0.1:4100` by default.

## P0 Verification

After the API is running against a local PostgreSQL test database, run the
Windows verification script from the repository root:

```powershell
$env:CONTROL_API_BASE_URL="http://127.0.0.1:4100"
$env:PAYMENT_WEBHOOK_SECRET="xiaolou-test-secret"
$env:DATABASE_URL="postgres://root:root@127.0.0.1:5432/xiaolou_windows_native_test"
.\scripts\windows\verify-control-plane-p0.ps1
```

The script verifies accounts, PostgreSQL schema apply, jobs lease/running/
heartbeat/succeed, LISTEN/NOTIFY, payment callback idempotency, immutable wallet
ledger insertion, media metadata, project/create/canvas canonical routes,
Playground conversations/messages/memories, Toolbox capabilities/runs,
provider health, outbox leasing, and the ClosedApiWorker/local-model-worker
succeed and fail paths. Identity/config routes and project-adjacent routes have
separate smoke coverage against the Windows service, and the admin/system smoke
covers pricing rules, admin payment-order reads, enterprise application
submission/review, and the retired admin-review 410 boundary. Verification does
not use Docker, Linux, Celery, or Redis.

## README Language Policy

Keep this README and `README.zh-CN.md` in sync. Any future README change should
update both language versions.
