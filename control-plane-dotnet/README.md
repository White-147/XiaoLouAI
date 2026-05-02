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
reads, media metadata/signing, and the first project/create/canvas batch:

- `/api/projects*`
- `/api/canvas-projects*`
- `/api/agent-canvas/projects*`
- `/api/create/images*`
- `/api/create/videos*`

These routes are backed by PostgreSQL canonical tables and explicit client
permissions. The source build and local temporary smoke have passed, but this
batch must still be published from an elevated Administrator PowerShell before
the running `XiaoLou-ControlApi` Windows service can be treated as updated.

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
provider health, outbox leasing, and the ClosedApiWorker/local-model-worker
succeed and fail paths. It does not use Docker, Linux, Celery, or Redis.

## README Language Policy

Keep this README and `README.zh-CN.md` in sync. Any future README change should
update both language versions.
