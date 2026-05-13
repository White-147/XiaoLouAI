# XiaoLouAI - Windows 原生 AI 创作平台

本文件是项目唯一 README。原先分散在前端、控制面、本地模型 worker、
legacy evidence、retained material、Caddy 与 toolbox 目录下的 README 内容已合并到这里；
后续只维护这一份入口文档，避免同一信息在多个目录里漂移。

## 产品概览

XiaoLouAI 是面向内容创作团队的 AI 创作与资产协作平台。它把图片创作、
视频创作、剧本与分镜工具、素材库、画布编排、Playground 调试和企业管理放在同一个
Windows 原生部署里，让创作者可以从创意、提示词、素材、生成任务到项目资产沉淀走完闭环。

当前产品功能按使用场景分为：

- 首页和 AI 工具箱：提供能力入口与轻量任务流，包括剧本拆解、视频反推提示词、
  25 格分镜、人物替换、动作迁移、高清修复和翻译等工具。
- 图片创作：支持参考图上传、素材库引用、模型选择、任务创建、生成结果预览、
  下载与同步到项目资产库。当前 Vertex Gemini 图片模型已接入真实出图链路。
- 视频创作：支持视频/图片/音频参考素材、比例与时长参数、模型选择和任务队列。
  Vertex/Veo 视频适配仍是后续工作，现阶段视频侧继续沿用既有任务框架。
- Playground：用于原生 canonical 会话、消息、记忆偏好、模型配置和聊天任务验证；
  前端体验按 ChuangJingAI 创意入口 composer、Skills、模型/模式菜单重做。
- 原生画布与智能体画布：承载视觉素材、生成节点和项目化编排；智能体画布当前从
  XiaoLou 主前端进入，历史 Jaaz 仅保留为非生产参考，不再作为默认生产控制面。
- 资产与项目管理：按项目沉淀图片、视频、storyboard、dubbing、export 等资产，
  并通过 Control API 与 PostgreSQL canonical tables 保持一致。
- 账号、组织、钱包与管理后台：支持身份、组织成员、API-center 配置、价格规则、
  订单读取、企业申请与权限控制。权限策略要求只有游客缺少创作权限。

从产品视角看，平台核心目标不是单点调用某个模型，而是把“工具箱能力、
多模态创作器、项目资产库、画布和企业管理”统一成一个可部署、可审计、可继续扩展的生产系统。

## 功能入口

| 模块 | 路径 | 当前说明 |
| --- | --- | --- |
| 首页 / AI 工具箱 | `/home`、`/` | 能力卡片、工具箱任务入口和项目导航；Layout/nav shell 位于 `XIAOLOU-main/src/features/home/nav-layout/`。 |
| 图片创作 | `/create/image` | 前端位于 `XIAOLOU-main/src/features/create-image/image-create/`，支持参考图和素材库引用；Vertex 图片链路已接入真实 provider。 |
| 视频创作 | `/create/video` | 前端位于 `XIAOLOU-main/src/features/create-video/video-create/`，保留队列和参数面；Vertex/Veo 视频 adapter 待接入。 |
| 剧本广场 | `/script-plaza` | 前端位于 `XIAOLOU-main/src/features/comic-production/script-plaza/`，用于从剧本模板创建漫剧项目。 |
| 漫剧制作 | `/comic/*` | 前端位于 `XIAOLOU-main/src/features/comic-production/comic/`，包含全局设定、剧本、资产、分镜、视频、配音和预览。 |
| 剧本拆解 | `/create/script-breakdown` | 前端位于 `XIAOLOU-main/src/features/toolbox/script-breakdown/`，通过 toolbox job API 排队。 |
| 人物替换 | `/create/video-replace` | 前端位于 `XIAOLOU-main/src/features/toolbox/video-replace/`，Python sidecar 位于 `backend/services/toolbox/video-replace-sidecar/`。 |
| 视频反推提示词 | `/create/video-reverse` | 前端位于 `XIAOLOU-main/src/features/toolbox/video-reverse/`，通过 toolbox job API 排队。 |
| 25 格分镜 | `/create/storyboard-25` | 前端位于 `XIAOLOU-main/src/features/toolbox/storyboard-25/`，通过 toolbox job API 排队。 |
| 原生画布 | `/create/canvas` | 前端宿主和 runtime 位于 `XIAOLOU-main/src/features/canvas-agent-canvas/canvas/`，直接编译进主前端。 |
| 智能体画布 | `/create/agent-canvas` | 前端宿主和 runtime 位于 `XIAOLOU-main/src/features/canvas-agent-canvas/`；K 阶段先对齐 ChuangJingAI 外观和入口，深层 local image edit、overlay、3D Director 后续单独迁移。 |
| 资产管理 | `/assets` | 前端位于 `XIAOLOU-main/src/features/assets-media-projects/assets/`；资产引用选择器、同步入库控件和生成媒体占位 UI 也由 `assets-media-projects` owner 承载。 |
| 企业控制台 | `/enterprise` | 前端位于 `XIAOLOU-main/src/features/account-admin-enterprise/enterprise-console/`，用于组织成员、企业钱包和项目权限管理。 |
| 账号 / 超级后台 | `/admin` | 超级管理员控制台位于 `XIAOLOU-main/src/features/account-admin-enterprise/super-admin-console/`；注册页、充值审核页和 Google 登录按钮分别收口到同一 owner 下的 `register/`、`admin-orders/`、`auth/`。 |
| Playground | `/playground` | 前端位于 `XIAOLOU-main/src/features/playground/`；K2 已按 ChuangJingAI 重做为创意入口 composer，并保留会话与记忆抽屉能力。 |
| 积分统计 | `/wallet/usage` | 前端位于 `XIAOLOU-main/src/features/wallet-payments-api-center/credit-usage/`，用于个人或平台视角的积分消耗统计。 |
| API 中心 | `/api-center` | 前端位于 `XIAOLOU-main/src/features/wallet-payments-api-center/api-center/`，用于供应商模型、默认链路和 API Key 配置。 |
| 钱包充值 | `/wallet/recharge` | 前端位于 `XIAOLOU-main/src/features/wallet-payments-api-center/wallet-recharge/`，用于钱包充值订单、支付方式、凭证上传和最近流水。 |

## Technical Positioning

XiaoLouAI production is Windows-native and PostgreSQL-first. The long-term
control plane is `.NET 8 / ASP.NET Core`; Python is reserved for local model
adapters and inference runners.

## Production Architecture

```text
XIAOLOU-main/dist                  frontend static site
backend/dotnet/control-plane/              .NET 8 / ASP.NET Core control API
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
XIAOLOU-main/src/features/account-admin-enterprise/ account/admin/enterprise/auth frontend surfaces
XIAOLOU-main/src/features/assets-media-projects/ assets route, reference picker, media UI, and project asset surfaces
XIAOLOU-main/src/features/canvas-agent-canvas/ canvas and agent-canvas frontend runtimes plus shared hooks
XIAOLOU-main/src/features/comic-production/ comic production frontend surfaces and script state
XIAOLOU-main/src/features/create-workbench/ shared create workbench shell/layout
XIAOLOU-main/src/features/create-image/ create image frontend surface
XIAOLOU-main/src/features/create-video/ create video frontend surface
XIAOLOU-main/src/features/home/     home product surface, nav/layout shell, and profile helpers
XIAOLOU-main/src/features/playground/ Playground frontend surface and API wrapper
XIAOLOU-main/src/features/wallet-payments-api-center/ wallet/payment/API-center frontend surfaces
XIAOLOU-main/src/features/toolbox/  toolbox frontend surfaces grouped by capability
backend/dotnet/control-plane/  .NET control plane and Windows worker projects
backend/services/toolbox/video-replace-sidecar/ local Python sidecar for video replacement
backend/services/model-runtime/local-model-worker-sidecar/ local model queue worker sidecar
deploy/caddy/          Windows Caddy static site + API proxy config
deploy/windows/        Windows reverse-proxy examples and operations runbooks
scripts/windows/       Windows install, service, backup, and runtime scripts
deploy/records/                  local handoff and Windows-native operations notes
legacy/core-api/       historical Node compatibility path; source/root removed
legacy/services-api/   historical legacy Python reference path; source/root removed
legacy/jaaz/           historical upstream Jaaz path; source/root removed
legacy/                archived legacy references; no live working-tree root
deploy/retained/legacy-surface-evidence/ retained sanitized manifests for non-live legacy source gates
deploy/retained/legacy-local-material/ non-secret retained legacy material for deployment handoff
```

Former tools-based sidecar locations have been retired after the toolbox layout
pass. New frontend toolbox work belongs under
`XIAOLOU-main/src/features/toolbox/`; backend/runtime sidecars belong under
`backend/services/toolbox/` or the `.NET` control-plane toolbox module.

Retained evidence/material directories and upstream-adjacent directories no
longer keep separate README files. Their production boundary notes are folded
into this root README. Mentions of Docker, Linux, Celery, Redis, RabbitMQ,
container startup, Jaaz, or legacy source paths are migration/reference records,
not production deployment guides. Production operations are defined by this
README and `deploy/windows/ops-runbook.md`.
G2b-2 has moved the former root legacy reference paths `core-api/` and
`services/api/` to `legacy/core-api` and `legacy/services-api`; G7d-3 has moved
the former root upstream Jaaz reference to `legacy/jaaz`. The archive paths
remain migration references only: do not register them as production services,
reverse-proxy backends, scheduled tasks, or control-plane working directories.
G11k removed the reviewed git-tracked legacy source candidates from
`legacy/core-api`, `legacy/services-api`, and `legacy/jaaz`. G11l moved
operator-approved non-secret local material out of `legacy/` into
`deploy/retained/legacy-local-material/`, moved real env/service-account files
and secret-like demo SQLite state into ignored `deploy/local-secrets/legacy/`,
removed logs/caches/empty directories, and removed the remaining tracked legacy
`.gitignore` files after root ignore coverage existed. The retained non-secret
final-surface and projection manifests under `deploy/retained/legacy-surface-evidence/` are now
the explicit non-live verifier evidence. The cleanup dry-run and release
candidate verifiers pass these manifests into their dependent sub-gates when
live legacy roots are intentionally absent; reduced RC runs remain warning
evidence, not full final acceptance.

Final positioning anchors remain unchanged for verifier clarity: the historical
`legacy/core-api` role was "Node compatibility layer and migration reference",
`legacy/services-api` was "legacy Python API reference; not production control plane",
and `legacy/` remains "archived legacy references" rather than a production
runtime.

## Development Setup

Frontend:

```powershell
cd XIAOLOU-main
npm install
npm run dev
```

The legacy Node compatibility source is no longer part of the tracked working
tree. Legacy-only launchers skip missing roots or generated dependencies by
default. For a deliberate historical comparison, restore the needed legacy
source from an earlier git commit into a separate local copy, restore
dependencies there, and point `LEGACY_CORE_API_ROOT` at that copy.

.NET control plane:

```powershell
cd backend/dotnet/control-plane
dotnet restore
dotnet build
dotnet run --project .\src\XiaoLou.ControlApi\XiaoLou.ControlApi.csproj
```

Install the .NET 8 SDK on developer machines before building the control plane.

### Frontend Notes

The frontend lives under `XIAOLOU-main/` and is a React + Vite SPA. Normal
development depends on the frontend dev server plus the `.NET` Control API on
port `4100`; legacy Jaaz or Node-era services are optional historical comparison
targets only.

Useful frontend environment variables:

```text
VITE_CORE_API_BASE_URL=http://127.0.0.1:4100
VITE_CORE_API_PROXY_TARGET=http://127.0.0.1:4100
VITE_JAAZ_AGENT_CANVAS_URL=/jaaz/?embed=xiaolou
VITE_JAAZ_DEV_PROXY_TARGET=http://localhost:5174
VITE_JAAZ_API_PROXY_TARGET=http://127.0.0.1:57988
```

Current frontend canonical route batches call `.NET` source endpoints for
projects, canvas projects, agent-canvas projects, create image/video lists,
identity/config, project-adjacent assets/storyboards/videos/dubbings/exports,
admin reads, Playground, capabilities, and Toolbox. Playground and Toolbox now
live under feature-owned paths. New route-owned code should live under
`XIAOLOU-main/src/features/<product-area>/`. During an active move, old
page/lib/component paths may briefly remain as thin compatibility re-exports,
but they should be deleted once import scans, route checks, build, and targeted
tests prove no old-path callers remain. H17 completed that cleanup for the
known H-stage page/component/lib wrappers.

### ChuangJingAI Frontend Alignment

ChuangJingAI is the frontend visual and interaction reference for the next
alignment phase. This does not change XiaoLouAI's production architecture:
frontend code still lives under `XIAOLOU-main/src/features/<product-area>/`,
talks to the `.NET` Control API through DTOs, and must not restore Jaaz or Node
`core-api` as live production control planes.

Phase K tracks this work in:

```text
deploy\records\xiaolouai-chuangjing-frontend-alignment-phase-plan.md
deploy\records\xiaolouai-chuangjing-frontend-alignment-task-record.md
```

Confirmed scope:

- Playground: rebuild `/playground` as the ChuangJingAI creative entry with
  composer, starter prompts, Skills, model menu and mode menu; preserve current
  XiaoLouAI conversations and memory controls as sidebars or drawers.
- Agent Canvas: first align `/create/agent-canvas` shell, loading/permission
  states, top-bar/chat entry and visible navigation; deeper local image edit,
  node overlay, annotation and 3D Director feature blocks are later owners.
- Account and profile: use ChuangJingAI account-center styling while retaining
  XiaoLouAI avatar/profile editing, password change and default organization
  selection inside the account center.

K1 shared shell/account center is complete: the primary nav now uses the
ChuangJingAI-style shell entries, `记忆中心` points at the Playground memory
drawer, wallet usage/recharge stay reachable from the account center, and
`ProfileModal` now presents `个人主页` / `订阅` / `账单` while keeping XiaoLouAI
profile editing, password change and default organization selection.

K2 Playground creative entry is complete: `/playground` now opens on the
ChuangJingAI-style central composer with starter prompts, Skills, mode menu,
model menu and thinking toggle. XiaoLouAI canonical conversations, messages,
chat jobs, memory preference and memories remain on the existing Control API,
with history and memory moved into secondary drawers via Playground controls and
`/playground?panel=history|memory`. Web search and attachments remain deferred
until the signed Playground API contract exposes those inputs.

### Toolbox Frontend Layout

Toolbox frontend capabilities are grouped together under
`XIAOLOU-main/src/features/toolbox/` rather than scattered through page/lib
roots:

| Capability | Frontend route | Canonical frontend path | Execution |
| --- | --- | --- | --- |
| script-breakdown | `/create/script-breakdown` | `XIAOLOU-main/src/features/toolbox/script-breakdown/` | Control-plane toolbox job; no separate Python sidecar. |
| video-replace | `/create/video-replace` | `XIAOLOU-main/src/features/toolbox/video-replace/` | Frontend page/presets; Python sidecar lives in `backend/services/toolbox/video-replace-sidecar/`. |
| video-reverse | `/create/video-reverse` | `XIAOLOU-main/src/features/toolbox/video-reverse/` | Control-plane toolbox job; no separate Python sidecar. |
| storyboard-25 | `/create/storyboard-25` | `XIAOLOU-main/src/features/toolbox/storyboard-25/` | Control-plane toolbox job; no separate Python sidecar. |

The backend route family is `backend/dotnet/control-plane/src/XiaoLou.ControlApi/Modules/Toolbox`.
Capabilities queue through `toolbox_capabilities`, `toolbox_runs`, and canonical
`jobs`.

Toolbox backend/runtime code should stay grouped separately from the frontend:

- `.NET` route/API orchestration: `backend/dotnet/control-plane/src/XiaoLou.ControlApi/Modules/Toolbox`
- Python video-replace sidecar: `backend/services/toolbox/video-replace-sidecar/`

### Control Plane Surfaces

The `.NET` control plane lives under `backend/dotnet/control-plane/`:

```text
src/XiaoLou.ControlApi                 ASP.NET Core API
src/XiaoLou.ClosedApiWorker            Windows Worker Service for closed API calls
src/XiaoLou.Domain                     shared request/response contracts
src/XiaoLou.Infrastructure.Postgres    PostgreSQL queues, payments, outbox, health
src/XiaoLou.Infrastructure.Storage     object-storage signing/local path abstraction
db/migrations                          canonical PostgreSQL SQL
```

Implemented public surfaces include accounts, jobs, payment callbacks, wallet
reads, media metadata/signing, projects, canvas/agent-canvas, create image/video,
identity/config, project-adjacent assets, admin/system reads, enterprise
applications, Playground, capabilities, and Toolbox. These surfaces are backed
by PostgreSQL canonical tables and explicit client permissions.

### Local Model Worker Boundary

`backend/services/model-runtime/local-model-worker-sidecar/` is the only production architecture area that may
supervise Python for local model adapters and inference runners. It talks back
through the Control API internal jobs endpoint, while PostgreSQL remains the
source of truth through Control API writes. It is currently a canonical queue
skeleton unless a real adapter, model weights, endpoint, and media output path
are explicitly attached.

Single-run validation shape:

```powershell
cd backend\services\model-runtime\local-model-worker-sidecar
.\.venv\Scripts\python -m app.worker --control-api http://127.0.0.1:4100 --lane account-media --provider-route local-model --run-once
```

## Production Build

Frontend production must be a static build:

```powershell
cd XIAOLOU-main
npm ci
npm run build
```

Publish the .NET services:

```powershell
cd backend/dotnet/control-plane
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
Worker success payloads are explicit contracts. `XiaoLou-LocalModelWorker`
remains a queue skeleton until real local adapters are attached. The
`XiaoLou-ClosedApiWorker` now has a real Vertex Gemini image path for
`create_image_generate`, `storyboard_image_generate`, and
`asset_image_generate`: it can call Vertex, write generated image bytes to local
object storage, and return `imageUrl` / `resultUrl` through `jobs.result`.
Unsupported closed-API job types continue to complete through the compatibility
stub with an explicit adapter status until their provider adapters are added.

### Caddy / Reverse Proxy

`deploy/caddy/` contains the same-host convenience Caddyfile used by
`scripts\start_caddy.cmd`. The canonical production example remains
`deploy/windows/Caddyfile.windows.example`; both should route API traffic to the
`.NET` Control API Windows Service on port `4100` and serve `XIAOLOU-main/dist`
as a static SPA. Do not route production traffic to `core-api/`, `services/api/`,
legacy Jaaz, a Vite dev/preview server, Docker, Linux, Kubernetes, Windows +
Celery, or Redis Open Source on Windows.

Windows local start:

```cmd
scripts\start_caddy.cmd
```

Portable start after installing Caddy:

```bash
caddy run --config deploy/caddy/Caddyfile
```

The repository intentionally does not commit `caddy.exe`, downloaded archives,
logs, or pid files. If the deployment domain is not `www.xiaolouai.cn`,
`www.xiaolou.cn`, or `aitianmu.cn`, update the site blocks in
`deploy/caddy/Caddyfile` before starting Caddy.

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
Legacy `/api/payments/{provider}/notify` callback aliases are retired; expose
only `/api/payments/callbacks/{provider}`.

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

## Legacy Evidence And Retained Material

`deploy/retained/legacy-surface-evidence/` is a sanitized evidence directory for non-live legacy
source-removal verification. It is not a runtime directory and must not contain
secrets, uploads, operator-only production evidence, local database dumps, or
deploy-retained local material. Its retained manifests are:

- `final-legacy-surface-manifest-g11k.json`
- `legacy-projection-manifest-g11k.json`

`deploy/retained/legacy-local-material/` contains operator-approved, non-secret
legacy local material moved out of `legacy/` so it can travel with deployment
handoffs without restoring `legacy/` as a live workspace root. It includes
retained canvas-library assets, legacy upload media, selected backup material,
and approved Jaaz local user data. `MATERIALS.sha256` records hashes after local
secret material was excluded.

Excluded material belongs under ignored `deploy/local-secrets/legacy/` or an
operator secret store: real env files, service-account files, secret-like demo
SQLite state, and Jaaz config files with non-empty API-key fields. None of this
material should be treated as production source or as a production runtime
entrypoint.

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
dry-run reports, verifier code, synthetic fixtures, and operator-approved
non-secret deployment handoff material under
`deploy/retained/legacy-local-material/`, but not the real material. True local
secrets for this checkout belong under ignored `deploy/local-secrets/` or the
deployment host's own secret store, not in Git.

Final acceptance evidence should include, when available:

- 2026-05-04 admin Release Candidate evidence:
  `D:\code\XiaoLouAI\.runtime\xiaolou-logs\release-candidate-s5-20260504-093456.json`.
  The RC ran `verify-release-candidate.ps1 -PublishFrontend` from an
  Administrator PowerShell, published to `.runtime\app`, restarted the three
  XiaoLou Windows services, and finished with `blockers=0`. The top-level
  status is `warning` because real legacy snapshot and real provider-health
  evidence remain operator-supplied final acceptance items.
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
tooling under `scripts/windows/`. Historical legacy payment route evidence is
retained through `deploy/retained/legacy-surface-evidence/`; legacy source is not a production
control-plane dependency.

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

## Deferred CI/Test Gate Follow-Up

G13 has finished the currently actionable CI/static-gate work: the required
GitHub Actions build/static gate exists, frontend typecheck lint is in CI,
conditional `.NET` test detection is hardened, synthetic browser E2E is now a
required check, security/coverage plans are documented, and the frontend service
harness has a non-required advisory coverage script. The remaining CI/test gates
still need fixtures, baselines, owner signoff, or stable runtime budget before
they can move forward. Treat them like operator-supplied payment/provider
material: they are follow-up readiness items, not routine handoff blockers.

```text
Status: required gate ratchet complete for synthetic browser E2E. `main` now requires both `Build and static gates` and `Synthetic browser E2E advisory`.
Current PR gate: `main` branch protection requires GitHub Actions `Build and static gates` plus `Synthetic browser E2E advisory`, both from app id 15368.
Do not require yet: coverage thresholds, CodeQL, npm audit failure, dotnet vulnerability failure, or standalone test checks outside the existing `Build and static gates` workflow.
Do not read or upload: .runtime, deploy/local-secrets, real env/provider/payment/object-storage/operator material, production dumps/snapshots, restore drills, or real payment replay captures.
```

Deferred queue:

```text
G13-post-1 branch-protection-enable: done after first green GitHub Actions run. At that stage, `main` branch protection required only the GitHub Actions `Build and static gates` check; coverage, E2E, CodeQL, npm audit failure, dotnet vulnerability failure, deployment, and operator evidence remained non-required/deferred until later owner signoff.
G13-post-2 security-baseline-nonblocking-execution: completed a manual non-blocking baseline after allowlist/noise policy and secret boundary confirmation. The follow-up G13-post-2b package remediation updated the Vite/PostCSS lockfile/install resolution to Vite 6.4.2 and PostCSS 8.5.14; `npm audit --json` now reports 0 vulnerabilities. `dotnet list package --vulnerable --include-transitive` found no vulnerable packages across the solution/test projects, and CodeQL was not run because the local `codeql` CLI is unavailable. This remains advisory/non-required; no npm audit failure gate, workflow change, branch protection, or CI required security check has been added.
G13-post-3 backend-test-harness-and-coverage-advisory: backend xUnit harness now exists under `backend/dotnet/control-plane/tests/XiaoLou.ControlApi.Tests`. The 2026-05-06 backend-advisory-coverage-expansion first pass added synthetic/no-secret route+method metadata coverage for Payments, Projects/canvas/create, Media, Toolbox, Playground, Jobs/outbox, plus account-scope/auth-provider grant edge tests. The later response-shape pass added synthetic route-delegate coverage for media/job/toolbox account-scope 403 short-circuits and payment callback invalid-JSON/provider-boundary envelopes before any store, ledger, signature verifier, DB, provider, payment, or object-storage access. Latest local backend xUnit passed 190/190. Any deeper backend advisory coverage should use mocks or isolated synthetic fixtures only and must not use a real DB fixture, provider material, object storage, payment capture, or production dump.
G13-post-4 frontend-test-harness-and-coverage-advisory: done for the first service-harness advisory baseline. The 2026-05-06 frontend-advisory-coverage-expansion first pass added synthetic browser fetch/download/service-worker/cache boundary tests for `guessMediaFilename`, `downloadMediaFile`, and `retireStaticBuildServiceWorkers`; the later auth-account pass added synthetic API-center vendor/model scoped-route and organization-wallet error-boundary tests. Latest local frontend validation passed lint, test:unit 59/59, test:coverage:advisory 59/59 with All files statements/lines 98.01%, functions 97.94%, branches 72.92%, build, and frontend legacy dependency gate status=ok with blockers 0/warnings 0. Coverage remains advisory/non-required with no thresholds; deeper fetch/timer/service boundaries and any required coverage gate remain deferred until stable baselines and owner signoff exist.
G13-post-5 synthetic-e2e-smoke-harness: foundation plus interaction flows added a Playwright synthetic browser smoke script using synthetic auth/localStorage, intercepted synthetic Control API fixtures, fake storage/job mocks, production preview on port 3100, and no real material. It now covers static route smoke, API-center client navigation, Playground synthetic requests, email login, personal registration, image create submit/job polling, asset fake PUT upload, and toolbox synthetic route/job polling. First local runtime baseline on May 5, 2026: 3 consecutive `test:e2e:synthetic` runs passed 13/13, Playwright reported 29.7-30.0s, and outer PowerShell timing was 31.07-31.88s. Flake policy: keep retries=0 and workers=1, investigate any failure or any single run above 60s, and do not count an immediate rerun as a green baseline. G13-post-6 later promoted this synthetic E2E check to required.
G13-post-5d synthetic-browser-e2e-advisory-green-accumulation: done. Effective greens 5/5 recorded: May 5, 2026 21:22 +08 local manual `npm --prefix .\XIAOLOU-main run test:e2e:synthetic`, 13/13 passed, outer runtime 31.13s, no flake/timeout, counted; May 5, 2026 21:30 +08 local manual same entry, 13/13 passed, Playwright reported 29.4s, outer runtime 30.89s, no flake/timeout, counted; May 5, 2026 21:36 +08 local manual same entry, 13/13 passed, Playwright reported 29.6s, outer runtime 31.06s, no flake/timeout, counted; May 5, 2026 21:45 +08 local manual same entry, 13/13 passed, Playwright reported 32.5s, outer runtime 34.05s, no flake/timeout, counted; May 5, 2026 21:55 +08 local manual same entry, 13/13 passed, Playwright reported 29.5s, outer runtime 31.05s, no flake/timeout, counted. G13-post-5c's three-run burst remains seed/baseline evidence only. No E2E harness, fixture, Vite config, auth/session, create/upload/toolbox, polling code, workflow, CI required check, or branch protection changed.
G13-post-6-preflight required-gate-ratchet-plan-owner-signoff-record: done. Initial preflight kept synthetic E2E advisory/non-required, then later owner signoffs approved remote evidence and required promotion. Rollback for the ratchet is to restore branch protection to the single `Build and static gates` required check, remove `Synthetic browser E2E advisory` from the required list, rerun CI/protection readback, and update README plus handoffs.
G13-post-6 required-gate-ratchet: done. Added GitHub Actions workflow `.github/workflows/synthetic-e2e-advisory.yml` with check context `Synthetic browser E2E advisory`; it runs `npm --prefix .\XIAOLOU-main run test:e2e:synthetic` on windows-latest/Node 22/Chrome and uploads no artifacts. Remote evidence before promotion: run 25381961070 on commit 2e7c553 succeeded with 13 passed in 55.7s, and run 25382399392 on commit 116b4c8 succeeded with 13 passed in 39.8s; required CI run 25382399379 on the same head also succeeded. Required promotion executed on May 5, 2026 22:36 +08 by updating only `required_status_checks`: branch protection now requires `Build and static gates` and `Synthetic browser E2E advisory`, both app id 15368, strict=false, enforce_admins=false, required PR reviews=false, restrictions=false, force pushes=false, deletions=false.
G13-post-6a required-synthetic-e2e-stability-monitor: latest monitor passes on May 6, 2026 kept branch protection unchanged after live readback showed both required checks still green on commit 6229031. The first local sample exposed one email-login timeout caused by Playwright waiting for the animated auth modal button to become stable; the harness now force-clicks that already-targeted synthetic login button and then passed targeted login plus full `test:e2e:synthetic` 13/13 in 30.5s reported by Playwright and 32.30s outer PowerShell time. The second local sample at 09:55 +08 passed full `test:e2e:synthetic` 13/13 with Playwright 32.4s and 34.27s outer PowerShell time; frontend legacy dependency gate stayed `status=ok` with blockers 0 and warnings 0. No rollback condition was met.
G13-post-7 coverage-threshold-preflight: completed as plan/preflight only. At that preflight, frontend advisory coverage evidence was 11 files/57 tests with All files lines/statements 96.41%, functions 95.89%, branches 72.34%; later G13-post-12 raised the current frontend advisory totals to 59 tests, All files statements/lines 98.01%, functions 97.94%, branches 72.92%, and `auth-account.ts` 100%. Backend xUnit was 184/184 at the preflight and is 190/190 after G13-post-11, but the backend test project still has no coverlet/coverage collector or backend coverage baseline. Recommendation remains: no global or required coverage gate yet. Future work must be a separate signed owner: first a non-required frontend aggregate advisory floor or backend coverage collector baseline, then remote non-required evidence, then required promotion only with explicit branch-protection before/after and rollback.
G13-post-8 security-required-gate-preflight: completed as plan/preflight only. Current evidence on May 6, 2026 10:09 +08: `npm --prefix .\XIAOLOU-main audit --json` exited 0 with 0 vulnerabilities; `dotnet list .\backend\dotnet\control-plane\XiaoLou.ControlPlane.sln package --vulnerable --include-transitive` found no vulnerable packages across the control-plane projects; local `codeql` CLI is unavailable; frontend legacy dependency gate stayed `status=ok`; latest main commit 5fac8ca had CI run 25412556135 success and Synthetic E2E Advisory run 25412556150 success. Branch protection still requires only `Build and static gates` and `Synthetic browser E2E advisory`, both app id 15368, strict=false, enforce_admins=false, required PR reviews=false, restrictions=false, force pushes=false, deletions=false. Recommendation: do not add npm audit, dotnet vulnerable, or CodeQL as required gates yet. Future security-gate work must start as a separate non-required advisory owner with noise policy, allowlist, exact check contexts, remote runner/check-run source, branch-protection before/after, rollback owner/action, baseline-reset conditions, and explicit owner signoff.
G13-post-9 branch-protection-hardening-review: completed as policy review/preflight only. Current readback on May 6, 2026 10:18 +08: `main` still requires only `Build and static gates` and `Synthetic browser E2E advisory`, both GitHub Actions app id 15368; latest commit 5fac8ca had both check-runs success; strict up-to-date branches=false, enforce admins=false, required PR reviews=null, restrictions=null, required conversation resolution=false, required signatures=false, required linear history=false, force pushes=false, deletions=false, block creations=false, lock branch=false. No CODEOWNERS file was found, and the workflow inventory remains `.github/workflows/ci.yml` plus `.github/workflows/synthetic-e2e-advisory.yml`. Recommendation: no immediate branch-protection hardening mutation. Future hardening must be a separate explicit owner with PR workflow readiness, exact before/after, rollback owner/action, test PR or equivalent remote evidence, stable required-check evidence, and baseline-reset conditions for workflow/check context, GitHub Actions app/source, CODEOWNERS/permissions, or direct-push policy changes.
G13-post-10 required-synthetic-e2e-stability-monitor: completed a new-push monitor pass for main commit 5fac8ca on May 6, 2026 10:24 +08. Remote readback stayed green: CI run 25412556135 and Synthetic E2E Advisory run 25412556150 succeeded, with check-runs `Build and static gates` and `Synthetic browser E2E advisory` from GitHub Actions app id 15368. Branch protection still requires only those two contexts, strict=false, enforce_admins=false, required PR reviews=false, restrictions=false, force pushes=false, deletions=false. Local monitor sample `npm --prefix .\XIAOLOU-main run test:e2e:synthetic` passed 13/13, Playwright reported 37.3s, outer PowerShell time was 39.48s, below the 60s investigation threshold. Frontend legacy dependency gate stayed `status=ok` with blockers 0/warnings 0. No rollback condition was met, and no workflow, required check, branch protection, DTO/route/status/response/auth/exported-name/polling/transport/DB behavior, real material, api.ts wrapper, or legacy/deploy evidence changed.
G13-post-11 backend-advisory-coverage-expansion: completed a backend-only synthetic response-shape pass on May 6, 2026 10:38 +08. Added `BackendAdvisoryEndpointResponseShapeTests` for mapped Minimal API route delegates: media upload-begin, jobs create, and toolbox translate-text return the stable 403 account-scope envelope before synthetic stores; payment callbacks return stable invalid-JSON, provider-mismatch, and disabled-provider envelopes before ledger/signature processing. The harness uses a synthetic unreachable Npgsql data source and throw-on-use storage signer/payment verifier, so no real DB fixture, provider material, object storage, payment capture, or production dump was read. Backend xUnit passed 190/190, solution build passed with 0 warnings/0 errors, frontend legacy dependency gate stayed `status=ok`, and current CI/branch-protection readback remained unchanged.
G13-post-12 frontend-advisory-coverage-expansion: completed a frontend-only synthetic auth-account service pass on May 6, 2026 10:52 +08. Added tests for API-center vendor api-key/test/model encoded scoped routes, stable JSON request bodies, organization wallet success, and non-not-found wallet error propagation. No implementation, exported API name, route/status/response/auth/account-scope behavior, real provider material, object storage, payment capture, production dump, real backend fixture, workflow, required check, or branch protection changed. Local validation passed target auth-account 8/8, frontend unit 59/59, coverage advisory 59/59 with `auth-account.ts` at 100%, frontend lint/build, frontend legacy dependency gate, trailing-whitespace scan, and `git diff --check` with CRLF warnings only. Next default owner is required-synthetic-e2e-stability-monitor only after these local advisory changes are pushed/opened as a PR, if a required check becomes unstable, or before required-gate/branch-protection mutation.
```

PowerShell reading shortcut:

```powershell
Select-String -Path .\README.md -Pattern 'Deferred CI/Test Gate Follow-Up' -Context 0,40
Select-String -Path .\deploy\records\xiaolouai-finalization-handoff.md -Pattern 'Post-G13 deferred execution queue' -Context 0,12
```

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
- Tracked legacy source was removed in G11k after manifest gates and deletion
  readiness passed. The former root paths `core-api/` and `services/api/` are
  not production control-plane locations, and new control-plane work belongs in
  `backend/dotnet/control-plane/`. If a temporary historical compatibility process is
  restored from an earlier commit, set `CORE_API_COMPAT_READ_ONLY=1`; legacy
  public GET routes must remain closed by default except `GET /healthz` and
  `GET /api/windows-native/status`.

## Handoff

Read these first before continuing the refactor:

- `XIAOLOU_REFACTOR_HANDOFF.md`
- `deploy/records/xiaolouai-finalization-handoff.md`
- `deploy/records/xiaolouai-deep-research-structured.md`
- `deploy/records/xiaolouai-legacy-physical-archive-contract.md`, for the completed
  G2b-2 archive record and rollback path

The root handoff is a short PowerShell-readable baton. It keeps only the current
short next-step context and verification entrypoints. Completed G9-G13 records
belong in the docs handoff files above; long-wait G13 test/fixture/runtime
follow-ups are tracked in `Deferred CI/Test Gate Follow-Up` in this README.

After every code, script, config, reverse-proxy, runtime, or README change,
update the root handoff plus the related docs handoff files before closing the
work. Use the structured deep research reader to keep the remaining work as
finite task cards. If a prior
"next execution" note has been superseded, mark it as historical in
`deploy/records/xiaolouai-finalization-handoff.md` instead of leaving two competing
instructions.

## README Policy

Keep a single project README at the repository root. Do not add small README
files under feature, service, deployment, evidence, or tooling directories just
to repeat route/path notes; fold those notes into this file or the appropriate
long-form document under `deploy/records/`. External dependency README files under ignored
or generated directories such as `node_modules`, `.venv`, and `.runtime` are not
project documentation.

## License

MIT
