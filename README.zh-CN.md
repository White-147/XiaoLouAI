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
```

使用 `scripts/windows/register-services.ps1` 注册：

- `XiaoLou-ControlApi`
- `XiaoLou-LocalModelWorker`
- `XiaoLou-ClosedApiWorker`

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

`/api/internal/*`、`/api/schema/*`、`/api/providers/health` 以及未列入的
legacy API 路径不能暴露到公开反代。

生产环境必须同时设置 `INTERNAL_API_TOKEN` 和 `CLIENT_API_TOKEN`。
`/api/accounts/ensure`、`/api/jobs*` 和 `/api/media*` 需要 client token
与账号作用域头。切生产前启用
`CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT=true`，并显式授权目标账号或
owner；同时把 `CLIENT_API_ALLOWED_PERMISSIONS` 收窄到前端 token 所需的
最小公开动作。`/api/payments/callbacks/*` 继续由 provider 回调签名保护。

## 运行规则

- PostgreSQL 是 accounts、jobs、payments、wallet ledger、media metadata、
  outbox 和 provider health 的唯一事实源。
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

## README 语言维护规则

所有项目 README 都应保持中英文双版。修改 README 时，请在同一次变更里更新
对应的 English 与简体中文版本，并保持文件顶部的 GitHub 语言切换链接可用。

## License

MIT
