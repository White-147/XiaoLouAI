# XiaoLouAI 控制面（.NET）

语言：[English](README.md) | [简体中文](README.zh-CN.md)

该目录是 XiaoLouAI 的 Windows 原生长期控制面。

```text
.NET 8 / ASP.NET Core
+ PostgreSQL canonical schema
+ PostgreSQL advisory locks / SKIP LOCKED / LISTEN NOTIFY
+ Windows Service workers
```

该控制面不需要 Docker、Linux、Kubernetes、Windows + Celery 或 Redis Open
Source on Windows 作为运行时依赖。

## 项目

```text
src/XiaoLou.ControlApi                 ASP.NET Core API
src/XiaoLou.ClosedApiWorker            闭源 API 调用 Windows Worker Service
src/XiaoLou.Domain                     共享请求 / 响应契约
src/XiaoLou.Infrastructure.Postgres    PostgreSQL 队列、支付、outbox、健康状态
src/XiaoLou.Infrastructure.Storage     对象存储签名抽象
db/migrations                          canonical PostgreSQL SQL
```

## 当前 canonical surfaces

当前源码已实现 accounts、jobs、支付回调、wallet read、media metadata/signing、第一批
project/create/canvas surface、第二批 identity/config surface，以及源码已完成的第三批
project 相邻 surface：

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

Toolbox canonical 状态：`/api/capabilities` 和 `/api/toolbox*` 已由 `.NET` Control API 提供。`toolbox_capabilities` 保存可见能力，`toolbox_runs` 记录每次工具箱运行，实际执行继续进入 canonical `jobs` 的 `account-control` lane。该批次已通过 `.NET` source build、前端 build、frontend legacy dependency gate、临时 4110 P0、strict legacy/canonical projection verifier，以及真实 4100 patched P0 smoke。组合发布脚本已加固：`complete-control-api-publish-restart-p0.ps1` 在 build/publish 后实时输出 P0 进度并抑制单独注册服务提示，`verify-control-plane-p0.ps1` 接受后台 `LeaseRecoveryService` 先恢复 lease 的竞态。

这些路由由 PostgreSQL canonical tables 和显式 client permissions 支撑。project/create/canvas、
identity/config、project 相邻和 admin/system 批次都已通过源码 build、管理员
publish/restart/P0 与 `http://127.0.0.1:4100` runtime smoke，运行中的
`XiaoLou-ControlApi` Windows 服务已经包含这些能力。手工 admin recharge review 继续退役并
返回 410；支付写入只保留 canonical callbacks 与 `wallet_ledger` 路线。

## 本地构建

在 Windows 上安装 .NET 8 SDK，然后运行：

```powershell
dotnet restore
dotnet build
```

启动服务前设置 `DATABASE_URL` 或 `ConnectionStrings__Postgres`：

```powershell
$env:DATABASE_URL="postgres://xiaolou_app:change-me@127.0.0.1:5432/xiaolou"
$env:Postgres__ApplySchemaOnStartup="true"
dotnet run --project .\src\XiaoLou.ControlApi\XiaoLou.ControlApi.csproj
```

API 默认监听 `http://127.0.0.1:4100`。

## P0 验证

API 连接本地 PostgreSQL 测试库后，在仓库根目录运行 Windows 验证脚本：

```powershell
$env:CONTROL_API_BASE_URL="http://127.0.0.1:4100"
$env:PAYMENT_WEBHOOK_SECRET="xiaolou-test-secret"
$env:DATABASE_URL="postgres://root:root@127.0.0.1:5432/xiaolou_windows_native_test"
.\scripts\windows\verify-control-plane-p0.ps1
```

脚本会验证 accounts、schema apply、jobs lease/running/heartbeat/succeed、
LISTEN/NOTIFY、支付回调幂等、不可变 wallet ledger 写入、媒体 metadata、
project/create/canvas canonical routes、provider health、outbox lease，以及
ClosedApiWorker / local-model-worker 的 succeed 和 fail 路径。identity/config routes
与 project 相邻 routes 另有针对 Windows service 的 smoke；admin/system smoke 覆盖 pricing
rules、admin payment-order reads、enterprise application submit/review，以及退役 admin
review 的 410 边界。验证不使用 Docker、Linux、Celery 或 Redis。

当前 worker 成功路径是 skeleton 契约。它们证明 durable PostgreSQL job
lease/running/succeed/fail 行为，不代表真实 provider 或模型已经执行。默认成功
结果保留 `status=stubbed`，并新增 `executionMode=stubbed-simulated`、
`isSimulated=true` 与 `adapterStatus=not_connected`，直到真实 adapter 和 object
storage 媒体输出接入。

## README 语言维护规则

请保持本文件与 `README.md` 同步。后续修改 README 时必须同时更新中英文版本。

## Playground canonical 发布状态 (2026-05-03)

`/api/playground/config|models|conversations|chat-jobs|memories` 已发布到真实 `http://127.0.0.1:4100` Windows service。Playground conversations、messages、memory preferences、memories 使用 PostgreSQL canonical tables，chat job creation 继续通过 canonical `jobs` lane 入队。该批次已通过 `.NET` source build、前端 lint/build、frontend legacy dependency gate、临时 `http://127.0.0.1:4110` P0 smoke，以及 elevated publish/restart/P0。
