# 开发与验证

本文记录 XiaoLouAI 本地开发和常用验证入口。生产部署细节见 [Windows 部署与公网访问](./deployment-windows.md)。

## 前置环境

- Windows 开发环境。
- Node.js 22 或兼容当前前端工具链的版本。
- .NET 8 SDK。
- 可用 PostgreSQL 实例，用于 Control API canonical stores。
- PowerShell。

真实 provider 密钥、支付凭证、对象存储凭证和生产 dump 不应放入仓库。

## 前端开发

```powershell
cd XIAOLOU-main
npm install
npm run dev
```

前端 dev server 默认运行在：

```text
http://localhost:3000
```

常用环境变量：

```text
VITE_CORE_API_BASE_URL=http://127.0.0.1:4100
VITE_CORE_API_PROXY_TARGET=http://127.0.0.1:4100
```

前端代码应继续按产品域放在 `XIAOLOU-main/src/features/<product-area>/`。新增 API 调用应走 feature-owned wrappers 或 `src/lib/api` 中的 Control API wrapper，不应直接访问数据库、文件系统、Python 脚本、provider SDK 或凭证。

## 后端开发

```powershell
cd backend/dotnet/control-plane
dotnet restore
dotnet build
dotnet run --project .\src\XiaoLou.ControlApi\XiaoLou.ControlApi.csproj
```

Control API 默认监听：

```text
http://127.0.0.1:4100
```

项目组成：

```text
src/XiaoLou.ControlApi
src/XiaoLou.Domain
src/XiaoLou.Infrastructure.Postgres
src/XiaoLou.Infrastructure.Storage
src/XiaoLou.ClosedApiWorker
src/XiaoLou.LocalModelWorkerService
tests/XiaoLou.ControlApi.Tests
```

## 本地模型 sidecar

本地模型 sidecar 只用于明确签过边界的 local adapter。单次运行形态：

```powershell
cd backend\services\model-runtime\local-model-worker-sidecar
.\.venv\Scripts\python -m app.worker --control-api http://127.0.0.1:4100 --lane account-media --provider-route local-model --run-once
```

不要把 Python sidecar 扩展成默认控制面。canonical task state 仍由 Control API 和 PostgreSQL 负责。

## 常用验证

前端：

```powershell
npm --prefix .\XIAOLOU-main run lint
npm --prefix .\XIAOLOU-main run test:unit
npm --prefix .\XIAOLOU-main run build
```

后端：

```powershell
dotnet test .\backend\dotnet\control-plane\XiaoLou.ControlPlane.sln --no-restore -v:minimal
dotnet build .\backend\dotnet\control-plane\XiaoLou.ControlPlane.sln -c Release --no-restore -v:minimal
```

边界脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\verify-frontend-legacy-dependencies.ps1 -FailOnLegacyWriteDependency
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\verify-public-access-capacity.ps1
git diff --check
```

Synthetic E2E：

```powershell
npm --prefix .\XIAOLOU-main run test:e2e:synthetic
```

Synthetic E2E 在 CI 中是 required advisory check。不要把真实 provider、真实支付、真实对象存储或生产数据带入 synthetic fixtures。

## 变更收口要求

- 代码、脚本、配置、runtime 或 README 变更应同步相关文档。
- 根 handoff 只写当前短棒；长历史记录放在 `deploy/records`。
- `deploy/records` 默认是本地 ignored 记录，不要因为提交准备而 force-add。
- 每个 owner 只处理一个明确边界，避免把 media storage、rate limits、prewarm、compression、load testing 等不同面混在一起。
- 工作区可能已有别人或前一棒的改动；不要回滚不属于自己的变更。
