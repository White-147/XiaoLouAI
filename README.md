# XiaoLouAI - Windows Native AI Creation Platform

Language: [English](README.md) | [简体中文](README.zh-CN.md)

XiaoLouAI production is Windows-native and PostgreSQL-first. The long-term
control plane is `.NET 8 / ASP.NET Core`; Python is reserved for local model
adapters and inference runners.

## Production Architecture

```text
XIAOLOU-main/dist                  frontend static site
control-plane-dotnet/              .NET 8 / ASP.NET Core control API
PostgreSQL                         only source of truth
Windows Service workers            local model + closed API execution
object storage                     media primary storage
```

The production target does not use Linux hosts, Linux containers, Docker,
Kubernetes, Windows + Celery, or Redis Open Source on Windows as critical
runtime dependencies. First-stage async execution uses PostgreSQL advisory
locks, `FOR UPDATE SKIP LOCKED`, and `LISTEN/NOTIFY`.

## Repository Layout

```text
XIAOLOU-main/          React + Vite SPA; production output is dist/
control-plane-dotnet/  .NET control plane and Windows worker projects
core-api/              Node compatibility layer and migration reference
services/api/          legacy Python API reference; not production control plane
video-replace-service/ local model / video replacement reference code
caddy/                 Windows Caddy static site + API proxy config
scripts/windows/       Windows install, service, backup, and runtime scripts
docs/                  local handoff and Windows-native operations notes
```

## Development Setup

Frontend:

```powershell
cd XIAOLOU-main
npm install
npm run dev
```

Node compatibility API, only while routes are being migrated:

```powershell
cd core-api
npm install
npm run dev
```

.NET control plane:

```powershell
cd control-plane-dotnet
dotnet restore
dotnet build
dotnet run --project .\src\XiaoLou.ControlApi\XiaoLou.ControlApi.csproj
```

Install the .NET 8 SDK on developer machines before building the control plane.

## Production Build

Frontend production must be a static build:

```powershell
cd XIAOLOU-main
npm ci
npm run build
```

Publish the .NET services:

```powershell
cd control-plane-dotnet
dotnet publish .\src\XiaoLou.ControlApi\XiaoLou.ControlApi.csproj -c Release -o D:\code\XiaoLouAI\.runtime\app\publish\control-api
dotnet publish .\src\XiaoLou.ClosedApiWorker\XiaoLou.ClosedApiWorker.csproj -c Release -o D:\code\XiaoLouAI\.runtime\app\publish\closed-api-worker
```

Use `scripts/windows/register-services.ps1` to register:

- `XiaoLou-ControlApi`
- `XiaoLou-LocalModelWorker`
- `XiaoLou-ClosedApiWorker`

Caddy or IIS should serve `XIAOLOU-main/dist` directly and reverse-proxy
only the approved public Control API routes to `127.0.0.1:4100`:

- `/healthz`
- `/api/accounts/ensure`
- `/api/jobs*`
- `/api/payments/callbacks/*`
- `/api/media/upload-begin`
- `/api/media/upload-complete`
- `/api/media/move-temp-to-permanent`
- `/api/media/signed-read-url`

`/api/internal/*`, `/api/schema/*`, `/api/providers/health`, and unlisted
legacy API paths must not be exposed through the public reverse proxy.

For production, set both `INTERNAL_API_TOKEN` and `CLIENT_API_TOKEN`.
`/api/accounts/ensure`, `/api/jobs*`, and `/api/media*` require the client token
plus account-scope headers. Before cutover, enable
`CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT=true` and explicitly grant the
intended accounts or owners. Also keep `CLIENT_API_ALLOWED_PERMISSIONS` to the
minimal public actions needed by the frontend token. `/api/payments/callbacks/*`
remains protected by provider callback signature verification.

## Runtime Rules

- PostgreSQL is canonical for accounts, jobs, payments, wallet ledger, media
  metadata, outbox, and provider health.
- Payment callbacks must be idempotent, signature-checked, and written through
  immutable `wallet_ledger` entries in the `account-finance` lane.
- Jobs are leased from PostgreSQL with `FOR UPDATE SKIP LOCKED`; workers do not
  keep canonical task state in memory.
- Media primary storage is object storage. Windows local folders are cache/temp
  only.
- `core-api/` exists for compatibility during cutover. New control-plane work
  belongs in `control-plane-dotnet/`. Set `CORE_API_COMPAT_READ_ONLY=1` for
  any production compatibility process so old Node routes cannot continue
  accepting writes; in that mode, legacy public GET routes are closed by
  default except `GET /healthz` and `GET /api/windows-native/status`.

## Handoff

Read these first before continuing the refactor:

- `XIAOLOU_REFACTOR_HANDOFF.md`
- `docs/xiaolouai-python-refactor-handoff.md`

## README Language Policy

Every project README should stay bilingual. When changing a README, update the
matching English and Simplified Chinese version in the same change, and keep the
language switch links at the top working in GitHub.

## License

MIT
