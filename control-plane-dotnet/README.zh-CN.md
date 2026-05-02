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
provider health、outbox lease，以及 ClosedApiWorker / local-model-worker 的
succeed 和 fail 路径。验证不使用 Docker、Linux、Celery 或 Redis。

## README 语言维护规则

请保持本文件与 `README.md` 同步。后续修改 README 时必须同时更新中英文版本。
