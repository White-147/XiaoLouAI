# XiaoLouAI - Windows 原生 AI 创作平台

语言：[English](README.md) | [简体中文](README.zh-CN.md)

XiaoLouAI 的生产路线是 Windows 原生、PostgreSQL 优先。长期控制面是
`.NET 8 / ASP.NET Core`；Python 只保留给本地模型 adapter 和推理执行器。

## 生产架构

```text
XIAOLOU-main/dist                  前端静态站点
control-plane-dotnet/              .NET 8 / ASP.NET Core Control API
PostgreSQL                         唯一事实源
Windows Service workers            本地模型 + 闭源 API 执行面
object storage                     媒体主存储
```

生产目标不使用 Linux 主机、Linux container、Docker、Kubernetes、
Windows + Celery 或 Redis Open Source on Windows 作为关键运行时依赖。
第一阶段异步执行使用 PostgreSQL advisory lock、`FOR UPDATE SKIP LOCKED`
和 `LISTEN/NOTIFY`。

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
`services/api/` 仅在旧路由映射、历史 FastAPI/SQLAlchemy/支付/上传/video-replace
代码仍有对照价值时保留；最终 legacy-surface 检查不再需要它后，可迁入 `legacy/`
或删除。

## 开发启动

前端：

```powershell
cd XIAOLOU-main
npm install
npm run dev
```

Node 兼容 API，仅迁移期使用：

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

注册后的服务使用 service-aware `.NET` host，`binPath` 直接指向
`dotnet.exe <published dll>`。`XiaoLou-LocalModelWorker` 是很薄的 `.NET`
Windows Service wrapper，用来监管 Python 本地模型 adapter 进程；Python 仍只限于
本地模型推理执行。
当前 worker 成功结果是明确的 skeleton 契约，不代表真实模型或 provider 已经执行。
`XiaoLou-LocalModelWorker` 和 `XiaoLou-ClosedApiWorker` 已能 lease、mark running、
succeed、fail、retry canonical PostgreSQL jobs，但默认成功结果会保留
`status=stubbed`、`executionMode=stubbed-simulated`、`isSimulated=true` 和
`adapterStatus=not_connected`，直到真实模型/provider adapter 与媒体输出接入。

Caddy 或 IIS 应直接服务 `XIAOLOU-main/dist`，并只把已批准的公开 Control API
路由反代到 `127.0.0.1:4100`：

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

`/api/internal/*`、`/api/schema/*`、`/api/providers/health` 以及未列入的
legacy API 路径不能暴露到公开反代。

生产环境必须设置 `INTERNAL_API_TOKEN`，并用静态 `CLIENT_API_TOKEN` 或
provider 签发的 client assertion 保护公开 client 路由。新的 provider 路径使用
`CLIENT_API_AUTH_PROVIDER=hs256-jwt`、`CLIENT_API_AUTH_PROVIDER_SECRET` 和
`CLIENT_API_REQUIRE_AUTH_PROVIDER=true`。assertion 必须携带账号或 owner 授权以及
route permission。静态 token 模式还应启用
`CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT=true`，并显式授权目标账号或 owner。
两种模式都要把 `CLIENT_API_ALLOWED_PERMISSIONS` 收窄到前端所需的最小公开动作。
`/api/payments/callbacks/*` 继续由 provider 回调签名保护。

发布并编辑 `.runtime\app\scripts\windows\.env.windows` 后，运行严格生产预检：

```powershell
.\scripts\windows\rehearse-production-cutover.ps1 -StrictProduction
```

严格模式会把占位密钥、缺少静态 token 或 auth provider 的 client 保护、client
permission 或账号授权 wildcard、开启 configured grant 但未配置具体 grant、不安全的
静态 token grant 配置，以及宽于 `GET /healthz;GET /api/windows-native/status` 的
legacy `core-api` public allowlist 视为 blocker。

当前 P2 状态：frontend legacy write route 批次已经迁移或退役；project/create/canvas、
identity/config、project 相邻、admin/system、Playground 与 Toolbox canonical surface
均已实现并发布到真实 `http://127.0.0.1:4100` Windows service。发布脚本会把 runtime
env 同步到 Windows Machine env 后再重启直接 `dotnet.exe <dll>` 服务，确保新增
client permissions 进入运行态。组合 publish/restart/P0 已经加固，会实时转发 P0 输出，
并兼容后台 `LeaseRecoveryService` 先完成恢复的竞态。

## 运营侧最终验收材料

部分生产材料有意不进入仓库。它们属于上线/最终验收或 cutover evidence，不是日常
工程推进 blocker。handoff 文件应指向本节，不再反复把缺少真实材料写成下一步堵点。

不要提交这些材料：

- 真实 production legacy dump/source、SQLite snapshot、旧 PostgreSQL snapshot 或
  restore drill 输出。
- 真实支付宝/微信支付商户账号、私钥、证书、provider 公钥、生产 secret 和原始回调捕获。
- 真实闭源 API/vendor 账号凭据、API key、provider 路由审批材料或生产 provider health evidence。
- 真实对象存储凭据、CDN/WAF 凭据、生产域名 secret 和运营侧审计导出。

已收集的 evidence 只能存放在部署机 `.runtime` 下，或运营侧受控 evidence 存储中。
仓库可以保留脱敏示例、dry-run 报告、verifier 代码和 synthetic fixture，但不能保留真实材料。

最终验收 evidence 在可获得时应包括：

- 真实 Windows service 的严格 P0 与 4100 runtime smoke 报告。
- `verify-p2-cutover-audit.ps1` 输出，且没有 blocker。
- 如果存在历史 legacy source，则保留 `verify-legacy-dump-cutover.ps1` 的真实 dump
  restore/projection 校验报告。
- 经过审核的真实支付 provider 捕获对应的 adapter/normalizer 校验、staging replay 和
  wallet audit 报告。
- 公开真实 vendor 流量前，证明已配置 vendor 可路由的 API-center/provider health evidence。
- 目标生产 PostgreSQL 的备份和 restore drill evidence。

当上述真实材料暂不可得时，保持 synthetic 和 staging gate 通过，并继续 Windows 原生重构。
缺少真实材料只在本节作为最终验收 evidence 跟踪，不作为 handoff blocker。

## 支付 Provider 对接操作

支付 provider 集成闸门已经准备好。真实商户材料与原始 provider 捕获由上面的运营侧
evidence 模块跟踪，不作为源码仓库输入。

当前 Windows-native Control API 的支付回调入口接收标准化 canonical JSON，并用
`Payments:{provider}:WebhookSecret` / `X-XiaoLou-Signature` 做 HMAC 校验。原生支付宝
RSA2 与微信支付 v3 输入由 `scripts/windows/` 下的 adapter/normalizer 工具链处理；旧的
`core-api/src/payments/alipay.js` 与 `core-api/src/payments/wechat.js` 只作为迁移参考，
不是长期生产控制面。

接入真实 provider 账号时：

1. 将密钥/证书文件放到 `D:\code\XiaoLouAI\.runtime\app\credentials\payment\`。
2. 将已审核的 JSONL/NDJSON 捕获放到 `D:\code\XiaoLouAI\.runtime\xiaolou-replay\`。
3. 在 `D:\code\XiaoLouAI\.runtime\app\scripts\windows\.env.windows` 填入 provider
   secret 与 allowlist；不要把真实值提交到仓库。
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

## 运行规则

- PostgreSQL 是 accounts、organizations、identity/profile context、API-center config、
  admin pricing/order reads、enterprise applications、jobs、payments、wallet ledger、
  media metadata、project/canvas/create surfaces、project 相邻 assets/storyboards/
  videos/dubbings/exports、Playground、Toolbox、outbox 和 provider health 的唯一事实源。
- 支付回调必须幂等、验签，并通过 `account-finance` lane 写入不可变 `wallet_ledger`。
- Jobs 通过 PostgreSQL `FOR UPDATE SKIP LOCKED` 租约执行；worker 不在内存中保存权威任务状态。
- 媒体主存储是对象存储；Windows 本地目录只用于缓存和临时文件。
- `core-api/` 只在切换期作为兼容层存在。新控制面工作归属 `control-plane-dotnet/`。
  任何生产兼容进程都应设置 `CORE_API_COMPAT_READ_ONLY=1`，避免旧 Node 路由继续接收写入。

## 交接

继续重构前先读：

- `XIAOLOU_REFACTOR_HANDOFF.md`
- `docs/xiaolouai-finalization-handoff.md`
- `docs/xiaolouai-deep-research-structured.md`

每次代码、脚本、配置、反代、运行态或 README 发生变更后，收尾前都要同步更新这两份
handoff。使用 deep research 结构化阅读版把剩余工作保持为有限任务卡。如果旧的“下一轮执行顺序”已被新状态取代，必须在
`docs/xiaolouai-finalization-handoff.md` 中标为历史记录，或替换为当前有效下一步。

## README 语言维护规则

所有项目 README 都应保持中英文双版。修改 README 时，请在同一次变更里更新对应的
English 与简体中文版本，并保持文件顶部的 GitHub 语言切换链接可用。

## License

MIT
