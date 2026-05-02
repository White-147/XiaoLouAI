# XiaoLouAI - Windows 原生 AI 创作平台

语言：[English](README.md) | [简体中文](README.zh-CN.md)

XiaoLouAI 的生产路线是 Windows 原生、PostgreSQL 优先。长期控制面是
`.NET 8 / ASP.NET Core`；Python 只保留给本地模型适配器和推理执行器。

## 生产架构

```text
XIAOLOU-main/dist                  前端静态站点
control-plane-dotnet/              .NET 8 / ASP.NET Core 控制面 API
PostgreSQL                         唯一事实源
Windows Service workers            本地模型与闭源 API 执行面
object storage                     媒体主存储
```

生产目标不依赖 Linux 主机、Linux 容器、Docker、Kubernetes、Windows +
Celery 或 Redis Open Source on Windows 作为关键运行时。第一阶段异步执行
使用 PostgreSQL advisory lock、`FOR UPDATE SKIP LOCKED` 和
`LISTEN/NOTIFY`。

## 仓库结构

```text
XIAOLOU-main/          React + Vite SPA；生产产物是 dist/
control-plane-dotnet/  .NET 控制面和 Windows worker 项目
core-api/              Node 兼容层与迁移参考
services/api/          旧 Python API 参考；不是生产控制面
video-replace-service/ 本地模型 / 视频替换参考代码
caddy/                 Windows Caddy 静态站点与 API 代理配置
scripts/windows/       Windows 安装、服务、备份和运行脚本
docs/                  本地交接与 Windows 原生运维说明
```

部分 legacy 或上游子目录会保留自己的 README，供迁移/参考使用。即使其中提到
Docker、Linux、Celery、Redis、RabbitMQ 或容器启动，也不能视为生产部署指南。
生产运维以本 README 和 `deploy/windows/ops-runbook.md` 为准。

## 开发启动

前端：

```powershell
cd XIAOLOU-main
npm install
npm run dev
```

Node 兼容 API，仅限迁移期：

```powershell
cd core-api
npm install
npm run dev
```

.NET 控制面：

```powershell
cd control-plane-dotnet
dotnet restore
dotnet build
dotnet run --project .\src\XiaoLou.ControlApi\XiaoLou.ControlApi.csproj
```

构建控制面前，请在开发机安装 .NET 8 SDK。

## 生产构建

前端生产必须使用静态构建：

```powershell
cd XIAOLOU-main
npm ci
npm run build
```

发布 .NET 服务：

```powershell
cd control-plane-dotnet
dotnet publish .\src\XiaoLou.ControlApi\XiaoLou.ControlApi.csproj -c Release -o D:\code\XiaoLouAI\.runtime\app\publish\control-api
dotnet publish .\src\XiaoLou.ClosedApiWorker\XiaoLou.ClosedApiWorker.csproj -c Release -o D:\code\XiaoLouAI\.runtime\app\publish\closed-api-worker
dotnet publish .\src\XiaoLou.LocalModelWorkerService\XiaoLou.LocalModelWorkerService.csproj -c Release -o D:\code\XiaoLouAI\.runtime\app\publish\local-model-worker-service
```

使用 `scripts/windows/register-services.ps1` 注册：

- `XiaoLou-ControlApi`
- `XiaoLou-LocalModelWorker`
- `XiaoLou-ClosedApiWorker`

注册后的服务使用 service-aware 的 `.NET` host，`binPath` 直接指向
`dotnet.exe <published dll>`。`XiaoLou-LocalModelWorker` 是一个很薄的 `.NET`
Windows Service wrapper，用来监管 Python 本地模型 adapter 进程；Python 仍只限于
本地模型推理执行。

Caddy 或 IIS 应直接服务 `XIAOLOU-main/dist`，并只把已批准的公开
Control API 路由反代到 `127.0.0.1:4100`：

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
- `/api/projects*`
- `/api/canvas-projects*`
- `/api/agent-canvas/projects*`
- `/api/create/images*`
- `/api/create/videos*`

`/api/internal/*`、`/api/schema/*`、`/api/providers/health` 以及未列入的
legacy API 路径不能暴露到公开反代。

生产环境必须设置 `INTERNAL_API_TOKEN`，并用静态 `CLIENT_API_TOKEN` 或
provider 签发的 client assertion 保护公开 client 路由。新的 provider
路径使用 `CLIENT_API_AUTH_PROVIDER=hs256-jwt`、`CLIENT_API_AUTH_PROVIDER_SECRET`
和 `CLIENT_API_REQUIRE_AUTH_PROVIDER=true`；assertion 必须携带账号或 owner
授权以及 route 权限。静态 token 模式还应启用
`CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT=true`，并显式授权目标账号或
owner。provider 切生产也可以用同一个 configured-grant 开关作为非 wildcard
灰度上界。两种模式都要把 `CLIENT_API_ALLOWED_PERMISSIONS` 收窄到前端所需的
最小公开动作。`/api/payments/callbacks/*` 继续由 provider 回调签名保护。

发布并编辑 `.runtime\app\scripts\windows\.env.windows` 后，运行严格生产预检：

```powershell
.\scripts\windows\rehearse-production-cutover.ps1 -StrictProduction
```

真实登录/用户组织签发层已接入 provider assertion：`core-api` 在邮箱登录、管理员登录、
Google 登录交换、个人注册和企业管理员注册成功后，会在配置
`CLIENT_API_AUTH_PROVIDER_SECRET` 时下发 `controlApiClientAssertion`。前端将它与
legacy `xiaolou-auth-token` 分开保存，并且只在 Windows-native Control API client
路由上作为 `Authorization: Bearer <jwt>` 发送。`CLIENT_API_AUTH_PROVIDER_TTL_SECONDS`
控制 assertion 的 `exp` 窗口，默认 3600 秒；JWT 会同时携带 user owner grant、当前
organization grant 和 route permission。

最新 Windows 发布演练：`scripts/windows/rehearse-production-cutover.ps1
-ExecutePublish -RegisterServices -UpdateExisting -StartServices -StrictProduction`
已在管理员 PowerShell 中发布到 `D:\code\XiaoLouAI\.runtime\app`。
`XiaoLou-ControlApi`、`XiaoLou-LocalModelWorker`、`XiaoLou-ClosedApiWorker`
已注册为 `Automatic` Windows 服务并处于 running，服务路径均为直接
`dotnet.exe <dll>`。严格服务态 P0 已通过，runId 为
`p0-4d788b349b6f4fe7aea06aa9fb99825e`；报告：
`D:\code\XiaoLouAI\.runtime\xiaolou-logs\p1-cutover-admin-services-20260502-101430.json`，
P0 log：
`D:\code\XiaoLouAI\.runtime\xiaolou-logs\p1-cutover-admin-p0-20260502-101430.out.log`。
P0 验证脚本现在会在 `CLIENT_API_REQUIRE_AUTH_PROVIDER=true` 时签发 HS256
provider assertion，严格 auth-provider 服务 smoke 不再回退到静态 client token。
真实支付 provider 捕获不会随仓库提供，也不再作为 P1 工程收口的必做项；它只是在接入真实
支付宝或微信支付商户时需要补齐的商户上线证据。
本轮 P0/P1 隐患复查也加固了跨主机部署：发布脚本会保留既有 runtime env，
服务注册默认拒绝 placeholder 或 smoke/test secret，`rehearse -RunP0` 会导入 runtime
auth-provider env 并选择 configured owner grant，`StrictProduction` 会按预期阻断当前本机
smoke env，直到替换为真实生产密钥。

当前 P2 源码检查点：前端 legacy write route 批次已经迁移或退役，剩余 frontend
review item 只是已 guard 的非 live 字面量。第一批 `.NET` canonical real-surface 源码已接入
`/api/projects`、`/api/create/images|videos`、`/api/canvas-projects` 和
`/api/agent-canvas/projects`，并已通过源码验证。由于本批修改 `.NET` runtime code，
在 elevated Administrator PowerShell 执行 `complete-control-api-publish-restart-p0.ps1`
并通过 `http://127.0.0.1:4100` 对这些路由完成 runtime smoke 前，不要声称运行中的
Windows 服务已经包含该批能力。

严格模式会把占位密钥、缺少静态 token 或 auth provider 的 client 保护、client
permission 或账号授权 wildcard、开启 configured grant 但未配置具体 grant、
不安全的静态 token grant 配置，以及宽于
`GET /healthz;GET /api/windows-native/status` 的 legacy `core-api` public allowlist
视为 blocker。

## 支付 Provider 对接操作

支付 provider 集成闸门已经准备好，但真实支付宝/微信支付商户材料不是 P1 工程阶段 blocker。
本仓库不会包含真实商户账号、私钥、证书、provider 公钥、生产 secret 或真实回调捕获；这些材料
只作为运营侧商户上线证据，且只应存放在 `.runtime` 下。

当前 Windows-native Control API 的支付回调入口接收标准化 canonical JSON，并用
`Payments:{provider}:WebhookSecret` / `X-XiaoLou-Signature` 做 HMAC 校验。原生支付宝
RSA2 与微信支付 v3 输入由 `scripts/windows/` 下的 adapter/normalizer 工具链处理；旧的
`core-api/src/payments/alipay.js` 与 `core-api/src/payments/wechat.js` 只作为迁移参考，不是
长期生产控制面。

接入真实 provider 账号时：

1. 将密钥/证书文件放到 `D:\code\XiaoLouAI\.runtime\app\credentials\payment\`。
2. 将已审核的 JSONL/NDJSON 捕获放到 `D:\code\XiaoLouAI\.runtime\xiaolou-replay\`。
3. 在 `D:\code\XiaoLouAI\.runtime\app\scripts\windows\.env.windows` 填入 provider secret
   与 allowlist；不要把真实值提交到仓库。
4. 对公网 provider callback 放量前开启显式 canary 入账：
   `PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT=true`，并配置非 wildcard 的
   `PAYMENT_CALLBACK_ALLOWED_ACCOUNT_IDS` 或
   `PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS`。
5. 回放原生捕获前先跑 adapter/normalizer smoke：
   `verify-payment-provider-native-adapters.ps1` 和
   `verify-payment-provider-normalizers.ps1`。
6. 依次执行 discovery、dry-run、staging execute/idempotency：

```powershell
.\scripts\windows\stage-payment-provider-replay.ps1 -DiscoverOnly
.\scripts\windows\stage-payment-provider-replay.ps1 `
  -InputFile D:\code\XiaoLouAI\.runtime\xiaolou-replay\<capture>.jsonl
.\scripts\windows\stage-payment-provider-replay.ps1 `
  -InputFile D:\code\XiaoLouAI\.runtime\xiaolou-replay\<capture>.jsonl `
  -Execute `
  -StopOnFailure
```

真实材料暂不可得时，保持 synthetic provider adapter/normalizer smoke、provider boundary smoke、
P0/canary、wallet ledger audit 和非支付 P1 cutover gate 通过即可，继续向 P2 推进。

## 运行规则

- PostgreSQL 是 accounts、jobs、payments、wallet ledger、media metadata、
  project/canvas/create surfaces、outbox 和 provider health 的唯一事实源。
- 支付回调必须幂等、验签，并通过 `account-finance` lane 写入不可变
  `wallet_ledger`。
- Jobs 通过 PostgreSQL `FOR UPDATE SKIP LOCKED` 租约执行；worker 不在内存中
  保存权威任务状态。
- 媒体主存储是对象存储；Windows 本地目录只用于缓存和临时文件。
- `core-api/` 只在切换期作为兼容层存在。新控制面工作归属
  `control-plane-dotnet/`。任何生产兼容进程都应设置
  `CORE_API_COMPAT_READ_ONLY=1`，避免旧 Node 路由继续接收写入；该模式下
  legacy public GET 默认只开放 `GET /healthz` 和
  `GET /api/windows-native/status`。

## 交接

继续重构前先读：

- `XIAOLOU_REFACTOR_HANDOFF.md`
- `docs/xiaolouai-python-refactor-handoff.md`

每次代码、脚本、配置、反代、运行态或 README 发生变更后，收尾前都要同步更新这两份
handoff。如果旧的“下一轮执行顺序”已被新状态取代，必须在
`docs/xiaolouai-python-refactor-handoff.md` 中标为历史记录，不要留下两套互相竞争的
执行入口。

## README 语言维护规则

所有项目 README 都应保持中英文双版。修改 README 时，请在同一次变更里更新
对应的 English 与简体中文版本，并保持文件顶部的 GitHub 语言切换链接可用。

## License

MIT
