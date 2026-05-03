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

Some legacy or upstream subdirectories keep their own README files for
migration/reference work. Those files are not production deployment guides when
they mention Docker, Linux, Celery, Redis, RabbitMQ, or container startup.
Production operations are defined by this README and `deploy/windows/ops-runbook.md`.

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
dotnet publish .\src\XiaoLou.LocalModelWorkerService\XiaoLou.LocalModelWorkerService.csproj -c Release -o D:\code\XiaoLouAI\.runtime\app\publish\local-model-worker-service
```

Use `scripts/windows/register-services.ps1` to register:

- `XiaoLou-ControlApi`
- `XiaoLou-LocalModelWorker`
- `XiaoLou-ClosedApiWorker`

The registered services use service-aware `.NET` hosts with direct
`dotnet.exe <published dll>` `binPath` values. `XiaoLou-LocalModelWorker` is a
small `.NET` Windows Service wrapper that supervises the Python local model
adapter process; Python remains limited to local model inference execution.

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
- `/api/wallet`
- `/api/wallets*`
- `/api/auth*`
- `/api/me`
- `/api/organizations*`
- `/api/api-center*`
- `/api/admin*`
- `/api/enterprise-applications*`
- `/api/capabilities`
- `/api/playground*`
- `/api/toolbox*`
- `/api/projects*`
- `/api/canvas-projects*`
- `/api/agent-canvas/projects*`
- `/api/create/images*`
- `/api/create/videos*`

`/api/internal/*`, `/api/schema/*`, `/api/providers/health`, and unlisted
legacy API paths must not be exposed through the public reverse proxy.

For production, set `INTERNAL_API_TOKEN` and protect public client routes with
either a static `CLIENT_API_TOKEN` or provider-signed client assertions. The
new provider path uses `CLIENT_API_AUTH_PROVIDER=hs256-jwt`,
`CLIENT_API_AUTH_PROVIDER_SECRET`, and `CLIENT_API_REQUIRE_AUTH_PROVIDER=true`.
The compatibility login layer signs `controlApiClientAssertion` on email/admin/
Google login and personal/enterprise registration when the provider secret is
configured. The frontend stores that assertion separately from the legacy
`xiaolou-auth-token` and only sends it to Windows-native Control API client
routes. Assertions must carry account or owner grants plus route permissions;
`CLIENT_API_AUTH_PROVIDER_TTL_SECONDS` controls the issued `exp` window and
defaults to 3600 seconds. Static tokens should additionally enable
`CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT=true` and explicitly grant the
intended accounts or owners. Provider cutover can use the same configured-grant
flag as a non-wildcard gray-release upper bound. In both modes, keep
`CLIENT_API_ALLOWED_PERMISSIONS` to the minimal public actions needed by the
frontend. `/api/payments/callbacks/*` remains protected by provider callback
signature verification.

After publishing and editing `.runtime\app\scripts\windows\.env.windows`, run
the strict production preflight:

```powershell
.\scripts\windows\rehearse-production-cutover.ps1 -StrictProduction
```

Strict mode blocks placeholder secrets, missing static-token or auth-provider
client protection, wildcard client permissions or account grants, a configured
grant flag without concrete grants, unsafe static-token grant settings, and any
legacy `core-api` public allowlist wider than `GET /healthz;GET /api/windows-native/status`.

Latest Windows rehearsal checkpoint: `scripts/windows/rehearse-production-cutover.ps1
-ExecutePublish -RegisterServices -UpdateExisting -StartServices -StrictProduction`
completed to `D:\code\XiaoLouAI\.runtime\app` from an elevated PowerShell
session. `XiaoLou-ControlApi`, `XiaoLou-LocalModelWorker`, and
`XiaoLou-ClosedApiWorker` are registered as `Automatic` Windows services and
are running with direct `dotnet.exe <dll>` service paths. The strict service P0
passed with run `p0-4d788b349b6f4fe7aea06aa9fb99825e`; report:
`D:\code\XiaoLouAI\.runtime\xiaolou-logs\p1-cutover-admin-services-20260502-101430.json`,
P0 log:
`D:\code\XiaoLouAI\.runtime\xiaolou-logs\p1-cutover-admin-p0-20260502-101430.out.log`.
The P0 verifier now signs HS256 provider assertions when
`CLIENT_API_REQUIRE_AUTH_PROVIDER=true`, so strict auth-provider service smoke
does not fall back to the static client token. Operator-supplied final
acceptance material is tracked in the dedicated evidence section below; missing
real captures, dumps, or provider credentials do not block routine engineering
cutover work.
The P0/P1 risk scan also hardened cross-host deployment: publishing now preserves
existing runtime env values, service registration refuses placeholder or
smoke/test secrets by default, `rehearse -RunP0` imports runtime auth-provider
env and picks a configured owner grant, and `StrictProduction` intentionally
blocks the current local smoke env until real production secrets are installed.

Current P2 runtime checkpoint: frontend legacy write route batches have been
retired or migrated, and the remaining frontend review items are guarded
non-live literals. The first `.NET` canonical real-surface batch for
`/api/projects`, `/api/create/images|videos`, `/api/canvas-projects`, and
`/api/agent-canvas/projects` is implemented, published to the running Windows
services, and smoke-tested through `http://127.0.0.1:4100`. The second
identity/config batch is also implemented and published for `/api/auth*`,
`/api/me`, `/api/organizations/*/members`, and `/api/api-center*`; runtime
smoke covered login, profile update, enterprise registration, organization
member writes, and API-center defaults/key/test/model writes. The latest
identity/config P0 report is
`control-api-publish-restart-p0-identity-config-20260503-055717.json`, and
runtime smoke is
`control-api-identity-config-runtime-smoke-20260503-060647.json`. Publishing now
also syncs the runtime env into Windows Machine env before restarting the
direct `dotnet.exe <dll>` service so newly added client permissions reach the
running Control API. The third project-adjacent batch for
`/api/projects/{projectId}/assets*`, `/storyboards*`, `/videos`, `/dubbings`,
and `/exports` has now passed elevated publish/restart/P0 plus a 4100 runtime
smoke, so the running Windows service includes it. The admin/system canonical
batch is also published: `/api/admin/pricing-rules`, `/api/admin/orders`, and
`/api/enterprise-applications*` are backed by PostgreSQL canonical tables;
manual admin recharge review remains retired with 410 because canonical payment
callbacks and `wallet_ledger` are the only write path.

The Playground canonical batch is also published:
`/api/playground/config|models|conversations|chat-jobs|memories` stores
conversations, messages, memory preferences, and memories in PostgreSQL while
continuing to enqueue chat work through canonical `jobs`. Source build,
frontend lint/build, the frontend legacy dependency gate, a temporary
`http://127.0.0.1:4110` Control API P0 smoke, and elevated publish/restart/P0
against the real `http://127.0.0.1:4100` Windows service all passed.

The Toolbox canonical batch is also implemented and available through
`/api/capabilities` and `/api/toolbox*`. The visible toolbox cards are backed by
canonical `toolbox_capabilities`, runnable toolbox actions create
`toolbox_runs`, and execution is queued through canonical `jobs` on the
`account-control` lane. Source build, frontend build, the frontend legacy
dependency gate, a temporary `http://127.0.0.1:4110` Control API P0 smoke, the
strict legacy/canonical projection verifier, and a patched P0 smoke against the
real `http://127.0.0.1:4100` Windows service passed. An earlier combined
elevated publish/restart/P0 report failed only in the verifier after publish and
service restart because background lease recovery won a race with the explicit
P0 recovery call. `verify-control-plane-p0.ps1` now accepts that recovered state,
and `complete-control-api-publish-restart-p0.ps1` streams P0 output live while
suppressing the standalone registration hint, so the admin shell no longer sits
quietly after the build step.

## Operator-Supplied Final Acceptance Evidence

Some production materials are intentionally absent from the repository. They are
final acceptance or cutover evidence, not routine engineering blockers. Handoff
files should point to this section instead of repeating missing-material TODOs.

Do not commit these materials:

- Real production legacy dump/source, SQLite snapshots, old PostgreSQL
  snapshots, or restore-drill outputs.
- Real Alipay/WeChat Pay merchant accounts, private keys, certificates,
  provider public keys, production secrets, and raw callback captures.
- Real closed-API/vendor account credentials, API keys, provider routing
  approvals, or production provider health evidence.
- Real object-storage credentials, CDN/WAF credentials, production domain
  secrets, and operator-only audit exports.

Store collected evidence only under `.runtime` on the deployment host or in an
operator-controlled evidence store. The repository may keep sanitized examples,
dry-run reports, verifier code, and synthetic fixtures, but not the real
material.

Final acceptance evidence should include, when available:

- Strict P0 and 4100 runtime smoke reports from the real Windows services.
- `verify-p2-cutover-audit.ps1` output with no blockers.
- A real legacy dump restore/projection verification report from
  `verify-legacy-dump-cutover.ps1`, if a historical legacy source exists.
- Payment adapter/normalizer verification plus staging replay/audit reports for
  reviewed real provider captures.
- API-center/provider health evidence showing configured vendors are routable
  before public real-vendor traffic is enabled.
- PostgreSQL backup and restore-drill evidence for the intended production
  database.

When any of the real materials above are not yet available, keep the synthetic
and staged gates green and continue the Windows-native refactor. Missing real
material is tracked here as final acceptance evidence, not as a handoff blocker.

## Payment Provider Onboarding

Payment provider integration is prepared. Real merchant material and raw
provider captures are tracked by the operator-supplied evidence module above,
not as source-controlled project inputs.

Current Windows-native Control API callbacks accept normalized canonical JSON
signed with the configured HMAC secret
(`Payments:{provider}:WebhookSecret` / `X-XiaoLou-Signature`). Native Alipay
RSA2 and WeChat Pay v3 inputs are handled by the Windows adapter/normalizer
tooling under `scripts/windows/`; the legacy
`core-api/src/payments/alipay.js` and `core-api/src/payments/wechat.js` files
are migration references only, not the long-term production control plane.

To connect a real provider account:

1. Store key/certificate files under
   `D:\code\XiaoLouAI\.runtime\app\credentials\payment\`.
2. Store reviewed JSONL/NDJSON captures under
   `D:\code\XiaoLouAI\.runtime\xiaolou-replay\`.
3. Fill provider secrets and allowlists in
   `D:\code\XiaoLouAI\.runtime\app\scripts\windows\.env.windows`; never commit
   real values.
4. Enable explicit canary intake before routing public callbacks:
   `PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT=true` plus
   `PAYMENT_CALLBACK_ALLOWED_ACCOUNT_IDS` or
   `PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS` with non-wildcard grants.
5. Run adapter/normalizer smoke before replaying raw native captures:
   `verify-payment-provider-native-adapters.ps1` and
   `verify-payment-provider-normalizers.ps1`.
6. Run discovery, dry-run, then staging execute/idempotency:

```powershell
.\scripts\windows\stage-payment-provider-replay.ps1 -DiscoverOnly
.\scripts\windows\stage-payment-provider-replay.ps1 `
  -InputFile D:\code\XiaoLouAI\.runtime\xiaolou-replay\<capture>.jsonl
.\scripts\windows\stage-payment-provider-replay.ps1 `
  -InputFile D:\code\XiaoLouAI\.runtime\xiaolou-replay\<capture>.jsonl `
  -Execute `
  -StopOnFailure
```

When real material is unavailable, keep the synthetic provider
adapter/normalizer smoke, provider boundary smoke, P0/canary, wallet ledger
audit, and non-payment P1 cutover gates green; continue the Windows-native
refactor toward P2.

## Runtime Rules

- PostgreSQL is canonical for accounts, organizations, identity/profile
  context, API-center config, admin pricing/order reads, enterprise
  applications, jobs, payments, wallet ledger, media metadata, project/canvas/
  create surfaces, project-adjacent assets/storyboards/videos/dubbings/exports,
  and Playground conversations/messages/memory preferences,
  Toolbox capabilities/runs,
  outbox, and provider health.
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

After every code, script, config, reverse-proxy, runtime, or README change,
update both handoff files before closing the work. If a prior "next execution"
note has been superseded, mark it as historical in
`docs/xiaolouai-python-refactor-handoff.md` instead of leaving two competing
instructions.

## README Language Policy

Every project README should stay bilingual. When changing a README, update the
matching English and Simplified Chinese version in the same change, and keep the
language switch links at the top working in GitHub.

## License

MIT
