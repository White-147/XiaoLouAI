# Windows 部署与公网访问

XiaoLouAI 生产目标是 Windows 原生部署：静态前端由 Caddy/IIS 服务，`.NET` Control API 和 workers 作为 Windows Services 运行，PostgreSQL 是 canonical state，媒体主存储是 object storage。

## 生产禁止项

生产流量不得路由到：

- Vite dev/preview server。
- Jaaz iframe/runtime。
- Node `core-api` 或 Node/Express 控制面。
- Node payment runtime 或 legacy payment aliases。
- Docker、Linux、Kubernetes、Windows + Celery。
- Redis Open Source on Windows。

## 构建前端

```powershell
cd XIAOLOU-main
npm ci
npm run build
```

输出目录：

```text
XIAOLOU-main/dist
```

## 发布服务

推荐使用统一安装脚本：

```powershell
.\scripts\windows\install.ps1 -RegisterServices -UpdateExisting -AssertDDrive
```

核心 Windows Services：

- `XiaoLou-ControlApi`
- `XiaoLou-ClosedApiWorker`
- `XiaoLou-LocalModelWorker`

服务应使用 direct `dotnet.exe <published dll>` service-aware 路径，不使用 PowerShell wrapper 作为长期 `binPath`。

## Runtime Env

发布后检查：

```text
D:\code\XiaoLouAI\.runtime\app\scripts\windows\.env.windows
```

至少应配置生产值：

- `DATABASE_URL`
- `PAYMENT_WEBHOOK_SECRET`
- `INTERNAL_API_TOKEN`
- `CLIENT_API_TOKEN`，或 `CLIENT_API_AUTH_PROVIDER=hs256-jwt` 与 `CLIENT_API_AUTH_PROVIDER_SECRET`
- `OBJECT_STORAGE_PROVIDER`
- `OBJECT_STORAGE_BUCKET`
- `OBJECT_STORAGE_PUBLIC_BASE_URL`
- `OBJECT_STORAGE_SIGNING_SECRET`

真实值不能提交到 Git。

## 启动与健康检查

```powershell
D:\code\XiaoLouAI\.runtime\app\scripts\windows\start-services.ps1
Get-Service XiaoLou-ControlApi,XiaoLou-ClosedApiWorker,XiaoLou-LocalModelWorker
Invoke-RestMethod http://127.0.0.1:4100/healthz
Invoke-RestMethod http://127.0.0.1:4100/livez
Invoke-RestMethod http://127.0.0.1:4100/readyz
```

## 反向代理

参考配置：

- `deploy/windows/Caddyfile.windows.example`
- `deploy/windows/iis-web.config.example`
- `deploy/caddy/Caddyfile`

Caddy/IIS 应服务 `XIAOLOU-main/dist`，并只转发 approved public Control API routes 到：

```text
http://127.0.0.1:4100
```

必须阻断：

- `/api/internal/*`
- `/api/schema/*`
- `/api/providers/health`
- `/metrics`
- 未列入 public surface 的 legacy API

## Public Access Limits

公网 body ceiling：

| 请求类型 | 边界 |
| --- | --- |
| auth/account bootstrap | `64KB` |
| public JSON writes | `2MB` |
| local object upload | `256MB` |

Control API `PublicAccessLimits` 负责固定窗口、并发保护和更细粒度 per-route body caps。生产保持：

```text
PublicAccessLimits__Enabled=true
```

## Object Storage Public Contract

`ObjectStorage:Provider=local` 时：

- 浏览器上传走签名 `/api/media/object-upload/{bucket}/{objectKey}`。
- 稳定读取走 `/api/media/object-content/{bucket}/{objectKey}`。
- 读取支持 HTTP range。
- `OBJECT_STORAGE_PUBLIC_BASE_URL` 应指向 public site origin。
- `OBJECT_STORAGE_SIGNING_SECRET` 不能是 placeholder。

外部 object storage/CDN provider 应保持 provider signed read URL，不应改写成本地 object-content。

## Stable Metadata Cache

只有审查过的稳定 JSON metadata routes 启用动态压缩和短缓存：

- `/api/capabilities`
- `/api/toolbox`
- `/api/toolbox/capabilities`
- `/api/playground/models`

这些响应使用 private `max-age=30`、weak ETag、`Vary`，并支持 matching `If-None-Match` 返回 304。SSE、range media、auth/payment/provider/operational、账号态 Playground 和 wallet reads 不进入该策略。

## 上线前验证

严格生产预检：

```powershell
.\scripts\windows\rehearse-production-cutover.ps1 -StrictProduction
```

P0 smoke：

```powershell
$env:CONTROL_API_BASE_URL = "http://127.0.0.1:4100"
$env:INTERNAL_API_TOKEN = "<same value as .env.windows>"
$env:CLIENT_API_TOKEN = "<same value as .env.windows if static-token mode is enabled>"
$env:CLIENT_API_AUTH_PROVIDER_SECRET = "<same value as .env.windows if auth-provider mode is enabled>"
$env:CLIENT_API_AUTH_PROVIDER_ISSUER = "<same value as .env.windows>"
$env:CLIENT_API_AUTH_PROVIDER_AUDIENCE = "<same value as .env.windows>"
D:\code\XiaoLouAI\.runtime\app\scripts\windows\verify-control-plane-p0.ps1 -AccountOwnerId "user_login_smoke_001"
```

公网容量默认离线核算：

```powershell
.\scripts\windows\verify-public-access-capacity.ps1
```

公网 HTTP smoke：

```powershell
.\scripts\windows\verify-public-access-capacity.ps1 `
  -RunHttp `
  -BaseUrl "https://xiaolou.example.com" `
  -ClientApiToken "<public client token or canary assertion>" `
  -ObjectContentPath "/api/media/object-content/<bucket>/<objectKey>"
```

`-RunRateLimitProbe` 会故意消耗匿名 auth fixed-window budget，只能在批准的 canary window 使用。
