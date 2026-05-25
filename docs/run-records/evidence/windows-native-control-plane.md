# Windows-native Control Plane 验证

## 范围

本记录整理 `.NET Control API + PostgreSQL canonical state + Windows Service workers` 的验证入口。项目当前生产控制面是 `backend/dotnet/control-plane/`，历史 Jaaz、Node `core-api`、Linux/Docker/Celery/Redis 路线只作为迁移参考。

## 运行摘要

- Control API 默认监听 `http://127.0.0.1:4100`。
- 核心服务为 `XiaoLou-ControlApi`、`XiaoLou-ClosedApiWorker`、`XiaoLou-LocalModelWorker`。
- 注册服务使用 direct service-aware `dotnet.exe <published dll>` binary path，不使用 PowerShell wrapper 作为服务 binary。
- 生产入口通过 Caddy/IIS 服务静态前端，并把已批准 public routes 转发到本机 Control API。
- Internal API、schema、provider health、metrics 等 operational surface 不应暴露到公网。

## 验证入口

```powershell
dotnet test .\backend\dotnet\control-plane\XiaoLou.ControlPlane.sln --no-restore -v:minimal
dotnet build .\backend\dotnet\control-plane\XiaoLou.ControlPlane.sln -c Release --no-restore -v:minimal
```

生产样式 P0 smoke：

```powershell
$env:CONTROL_API_BASE_URL = "http://127.0.0.1:4100"
$env:INTERNAL_API_TOKEN = "<same value as .env.windows>"
$env:CLIENT_API_TOKEN = "<same value as .env.windows if static-token mode is enabled>"
D:\code\XiaoLouAI\.runtime\app\scripts\windows\verify-control-plane-p0.ps1 -AccountOwnerId "user_login_smoke_001"
```

发布前 strict preflight：

```powershell
D:\code\XiaoLouAI\scripts\windows\rehearse-production-cutover.ps1 -StrictProduction
```

## 证据边界

- `.runtime` 下的 logs、backups、publish artifacts 和 local service state 不提交。
- `.runtime\app\scripts\windows\.env.windows`、支付证书、provider credentials、object-storage credentials 不提交。
- 运行记录只保留验证入口和公开摘要，真实 runtime evidence 应在部署主机或运营证据系统维护。

## 来源

- [开发与验证](../../development.md)
- [Windows 部署与公网访问](../../deployment-windows.md)
- [Windows Native Ops Runbook](../../../deploy/windows/ops-runbook.md)
- [运维与证据边界](../../operations-and-evidence.md)
