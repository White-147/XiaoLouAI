# XiaoLouAI Windows 原生长期重构交接

更新时间：2026-05-02 06:36:00 +08:00
工作目录：`D:\code\XiaoLouAI`
参考文件：`docs/xiaolouai-python-refactor-handoff.md`、本地 deep-research report

## 1. 当前路线

后续修改直接走 `docs/xiaolouai-python-refactor-handoff.md` 中的方案二长期稳定路线：

```text
.NET 8 / ASP.NET Core 控制面
+ PostgreSQL 唯一事实源
+ Windows Service workers
+ Python 仅用于本地模型适配器/推理执行器
```

长期控制面不再继续扩展旧 `core-api/` 作为主后端。`core-api/` 只作为迁移期兼容层、旧接口参考和短期桥接面。

生产约束保持不变：

- 不部署、不登录、不维护 Linux 主机、Linux 容器或 Docker 运行时。
- 不使用 Dockerfile、docker-compose、Kubernetes、WSL 作为生产运行层。
- 不把 Windows + Celery 作为异步主控。
- 不把 Redis Open Source on Windows 作为关键生产依赖。
- 第一阶段任务系统优先使用 PostgreSQL 原生能力。
- RabbitMQ on Windows 只保留为备选，不作为默认推荐。
- 媒体正式主存储必须是对象存储，Windows 本地目录只允许做缓存或临时目录。
- 前端生产入口必须是静态构建产物，不允许用 Vite dev server 或 preview 承担线上流量。

## 2. 已完成进度

### 2.1 .NET 8 环境

- 已卸载原 `Microsoft.DotNet.DesktopRuntime.7`。
- 由于 C 盘 Windows Installer 缓存空间不足，winget/MSI 安装 `.NET SDK 8.0.420` 回滚。
- 已改用微软官方 `dotnet-install.ps1` 安装到 D 盘：
  - `D:\soft\program\dotnet`
  - SDK：`8.0.420`
  - Runtime：`Microsoft.NETCore.App 8.0.26`
  - ASP.NET Core Runtime：`Microsoft.AspNetCore.App 8.0.26`
  - Windows Desktop Runtime：`Microsoft.WindowsDesktop.App 8.0.26`
- 已写入用户级环境变量：
  - `DOTNET_ROOT=D:\soft\program\dotnet`
  - 用户 `Path` 已包含 `D:\soft\program\dotnet`
- 新开的 PowerShell 终端应可直接运行 `dotnet`。

验证命令：

```powershell
D:\soft\program\dotnet\dotnet.exe --info
D:\soft\program\dotnet\dotnet.exe --list-sdks
D:\soft\program\dotnet\dotnet.exe --list-runtimes
```

### 2.2 .NET 控制面骨架

已新增 `control-plane-dotnet/`：

```text
control-plane-dotnet/
  XiaoLou.ControlPlane.sln
  db/migrations/20260501_windows_native_core.sql
  src/
    XiaoLou.ControlApi/
    XiaoLou.ClosedApiWorker/
    XiaoLou.Domain/
    XiaoLou.Infrastructure.Postgres/
    XiaoLou.Infrastructure.Storage/
```

已覆盖 P0 核心骨架：

- accounts / users / organizations / organization_memberships
- jobs / job_attempts
- payment_orders / payment_callbacks
- wallet_ledger / wallet_balances
- outbox_events
- provider_health
- media_objects / upload_sessions
- account lane advisory lock：
  - `account-finance`
  - `account-control`
  - `account-media`
- `SELECT ... FOR UPDATE SKIP LOCKED` jobs lease
- `LISTEN/NOTIFY` job 状态通知
- 支付回调幂等入口
- immutable wallet ledger
- object-storage metadata 与 signed URL skeleton
- closed API worker skeleton

本轮修复并验证了 .NET 编译问题：

- `XiaoLou.Domain/ControlPlaneContracts.cs`
  - `AccountScope` 改为可继承 record。
  - `PaymentCallbackRequest.Currency` 显式标记为 `new`，消除隐藏警告。
- `XiaoLou.Infrastructure.Storage.csproj`
  - 补 `Microsoft.Extensions.Options`。
- `XiaoLou.Infrastructure.Postgres.csproj`
  - 补 `XiaoLou.Infrastructure.Storage` 项目引用。
  - 补 `Microsoft.Extensions.*` 基础依赖。

验证通过：

```powershell
$env:DOTNET_ROOT='D:\soft\program\dotnet'
$env:PATH='D:\soft\program\dotnet;' + $env:PATH
D:\soft\program\dotnet\dotnet.exe build D:\code\XiaoLouAI\control-plane-dotnet\XiaoLou.ControlPlane.sln
```

结果：5 个项目全部成功，0 警告，0 错误。

### 2.3 Windows 原生脚本和部署样例

已新增：

```text
scripts/windows/
  .env.windows.example
  install.ps1
  register-services.ps1
  start-control-api.ps1
  start-closed-api-worker.ps1
  start-local-model-worker.ps1
  start-services.ps1
  stop-services.ps1
  restart-services.ps1
  backup-postgres.ps1

deploy/windows/
  iis-web.config.example
  Caddyfile.windows.example
  ops-runbook.md
```

目标服务：

- `XiaoLou-ControlApi`
- `XiaoLou-ClosedApiWorker`
- `XiaoLou-LocalModelWorker`

### 2.4 旧生产路径清理

已从生产路径清理或降级：

- 根目录 `docker-compose.yml`
- 根目录 `.env.compose.example`
- OpenWebUI 容器启动与注入脚本
- video-replace 容器文件
- `services/api` 中的 Celery worker 文件与测试
- 默认依赖中的 `celery[redis]`、`redis`

保留说明：

- `services/api/` 只作为 legacy reference，不再作为生产异步主控。
- `core-api/` 只作为迁移期兼容层，不再作为长期主控制面。

### 2.5 项目运行路径收口

项目后续新增依赖、配置、缓存、临时文件、日志、备份、发布产物和模型缓存默认写入 D 盘，不把 C 盘作为 XiaoLouAI 的运行数据目录。

保留在交接文档中的 C/D 盘信息只限项目相关项：

- `.NET` 运行时固定使用 `D:\soft\program\dotnet`。
- Python 本地模型适配器固定使用 `D:\soft\program\Python\Python312\python.exe`。
- PostgreSQL 18 固定使用 `D:\soft\program\PostgreSQL\18`，数据目录为 `D:\soft\program\PostgreSQL\18\data`。
- XiaoLouAI 发布、日志、临时目录、缓存、备份分别收拢到 `D:\code\XiaoLouAI\.runtime\app`、`D:\code\XiaoLouAI\.runtime\xiaolou-logs`、`D:\code\XiaoLouAI\.runtime\xiaolou-temp`、`D:\code\XiaoLouAI\.runtime\xiaolou-cache`、`D:\code\XiaoLouAI\.runtime\xiaolou-backups`。
- `scripts/windows/assert-d-drive-runtime.ps1` 用于检查项目 `.env.windows` 与 Windows 服务配置是否出现禁止的 C 盘项目运行路径。

### 2.6 P0.1 本机端到端验证

本轮已把 `.NET 控制面从能编译推进到可跑通`。

本机 PostgreSQL 状态：

- Windows 服务：`postgresql-x64-18`
- 版本：PostgreSQL 18.3
- 监听：`127.0.0.1:5432`
- 测试库：`xiaolou_windows_native_test`
- 迁移文件：`control-plane-dotnet/db/migrations/20260501_windows_native_core.sql`
- 已验证 canonical 表数量：11 张 P0 核心表均已创建。

本轮代码修复：

- `XiaoLou.ControlApi/Program.cs`
  - 支付回调签名改为优先读取 HTTP header：`X-XiaoLou-Signature`。
  - 保留 body 内 `signature` 字段作为兼容回退。
  - 新增 internal 验证端点：`GET /api/internal/jobs/wait-signal?timeoutSeconds=...`，用于确认 PostgreSQL `LISTEN/NOTIFY` 跨进程通知可达。

启动测试 API 使用的关键环境：

```powershell
$env:DOTNET_ROOT='D:\soft\program\dotnet'
$env:PATH='D:\soft\program\dotnet;' + $env:PATH
$env:DATABASE_URL='postgres://root:***@127.0.0.1:5432/xiaolou_windows_native_test'
$env:Payments__WebhookSecret='xiaolou-test-secret'
$env:ObjectStorage__PublicBaseUrl='https://objects.test.local'
```

已通过的端到端检查：

- `GET /healthz`
- `POST /api/schema/apply` 幂等执行成功。
- `POST /api/accounts/ensure`
- `POST /api/jobs`
- `GET /api/jobs`
- `GET /api/jobs/{jobId}`
- `POST /api/internal/jobs/lease`
- `POST /api/internal/jobs/{jobId}/running`
- `POST /api/internal/jobs/{jobId}/heartbeat`
- `POST /api/internal/jobs/{jobId}/succeed`
- `POST /api/jobs/{jobId}/cancel`
- `GET /api/internal/jobs/wait-signal`
- `POST /api/payments/callbacks/{provider}`
  - 非法签名返回 400。
  - 合法签名写入 `payment_orders`、`payment_callbacks`、`wallet_ledger`、`wallet_balances`、`outbox_events`。
  - 重复回调可安全重放，未产生重复 ledger。
- `POST /api/media/upload-begin`
- `POST /api/media/upload-complete`
- `POST /api/media/move-temp-to-permanent`
- `POST /api/media/signed-read-url`
- `PUT /api/providers/health`
- `GET /api/providers/health`
- `POST /api/internal/outbox/lease`
- `POST /api/internal/outbox/{eventId}/complete`

账务一致性验证：

```text
balance_cents = 1200
ledger_sum_cents = 1200
immutable_false_count = 0
duplicate_ledger_keys = 0
paid_orders = 1
processed_callbacks = 1
rejected_callbacks = 1
```

`LISTEN/NOTIFY` 验证：

- migration 中存在 `trg_notify_job_change` trigger。
- 存在 `notify_job_change` 与 `xiaolou_lock_account_lane` 函数。
- 创建 job 时，`/api/internal/jobs/wait-signal` 收到 `xiaolou_jobs` payload：

```json
{
  "job_id": "c7ea5feb-2ef4-4274-8043-94894f195424",
  "account_id": "3613a738-b3cb-4e65-97de-26bbed90881c",
  "lane": "account-media",
  "status": "queued"
}
```

## 3. 当前架构边界

系统拆成四块：

```text
前端静态站点
  XIAOLOU-main/dist
  IIS static site 或 Caddy file_server

.NET 控制面 API
  鉴权
  accounts / organizations / users
  支付下单与回调
  jobs create / cancel / query
  provider router
  signed media URLs 与对象存储协同

支付与账务模块
  account-finance lane
  payment_orders
  payment_callbacks
  wallet_ledger
  wallet_balances
  outbox_events

任务与模型执行面
  Windows Service: local model executor
  Windows Service: closed API caller
  PostgreSQL jobs queue
  object storage for media input/output
```

控制面不做：

- 不在 API 进程里跑 GPU、本地模型、长视频处理或转码。
- 不以内存 Map/Array 作为任务、支付、钱包状态事实源。
- 不把本地磁盘作为正式媒体主存储。

## 4. 2026-05-02 本轮更新

### 4.1 P0 验证脚本已固化

已新增：

```text
scripts/windows/verify-control-plane-p0.ps1
```

该脚本把上一轮手工 HTTP 验证固化为 Windows 原生可重复检查，覆盖：

1. `GET /healthz`
2. `POST /api/schema/apply`
3. accounts ensure
4. jobs create / lease / running / heartbeat / succeed
5. PostgreSQL `LISTEN/NOTIFY` job signal
6. payment callback 非法签名拒绝
7. payment callback 合法签名、重复通知安全重放、immutable ledger 写入
8. media upload begin / complete / move temp to permanent / signed read url
9. provider health upsert
10. outbox lease / complete
11. `XiaoLou.ClosedApiWorker` succeed / failed 路径
12. `services/local-model-worker` succeed / failed 路径

验证命令：

```powershell
$env:DOTNET_ROOT='D:\soft\program\dotnet'
$env:PATH='D:\soft\program\dotnet;' + $env:PATH
$env:DATABASE_URL='postgres://root:root@127.0.0.1:5432/xiaolou_windows_native_test'
$env:CONTROL_API_BASE_URL='http://127.0.0.1:4100'
$env:PAYMENT_WEBHOOK_SECRET='xiaolou-test-secret'
.\scripts\windows\verify-control-plane-p0.ps1 `
  -DotnetExe 'D:\soft\program\dotnet\dotnet.exe' `
  -PythonExe 'D:\soft\program\Python\Python312\python.exe'
```

本轮已实际跑通，最后输出示例：

```json
{
  "runId": "p0-80aaa7b35e1348adb25e33d7ec75d8e6",
  "accountId": "ee0ec697-6bbe-4456-89db-8211535d0c49",
  "baseUrl": "http://127.0.0.1:4100",
  "workersVerified": true
}
```

### 4.2 worker jobs 状态机已接入

已调整 `LeaseJobsRequest` 与 `PostgresJobQueue.LeaseJobsAsync`：

- lease 请求新增 `providerRoute`。
- PostgreSQL lease SQL 增加 `provider_route` 过滤。
- migration 增加 `ix_jobs_lease_pick_provider`，避免不同 worker 在同一 lane 内抢错任务。

`XiaoLou.ClosedApiWorker` 当前行为：

- Windows Worker Service 原生运行。
- 直接使用 PostgreSQL canonical jobs queue。
- 默认只处理 `lane=account-media`、`providerRoute=closed-api`。
- 支持 `Worker__RunOnce=true`，用于集成验证。
- 支持根据 job payload 中 `forceFail=true` 触发 failed 路径。
- 回写状态：`leased -> running -> succeeded/failed`。

`services/local-model-worker` 当前行为：

- 保持 Python 仅用于本地模型适配器/推理执行器。
- 通过 .NET ControlApi internal jobs endpoint 操作队列。
- 默认只处理 `lane=account-media`、`providerRoute=local-model`。
- 支持 `--run-once` / `LOCAL_MODEL_WORKER_RUN_ONCE=true`。
- 支持根据 job payload 中 `forceFail=true` 触发 failed 路径。
- 回写状态：`leased -> running -> succeeded/failed`。

### 4.3 已验证命令

```powershell
D:\soft\program\dotnet\dotnet.exe build .\control-plane-dotnet\XiaoLou.ControlPlane.sln
D:\soft\program\Python\Python312\python.exe -m py_compile .\services\local-model-worker\app\worker.py
.\scripts\windows\verify-control-plane-p0.ps1 -DotnetExe 'D:\soft\program\dotnet\dotnet.exe' -PythonExe 'D:\soft\program\Python\Python312\python.exe'
```

结果：

- `.NET` build：0 warning / 0 error。
- Python worker 语法检查通过。
- P0 Windows 验证脚本通过。
- 验证完成后已停止本轮临时启动的 `ControlApi` 进程。

注意：

- 当前机器的未限定 `python` 命令曾指向 WindowsApps alias 占位符，直接运行会失败；项目脚本必须显式使用 D 盘 Python。
- 后续 Windows 脚本建议显式配置 `PYTHON_EXE=D:\soft\program\Python\Python312\python.exe`，或关闭 WindowsApps Python alias。
- 已将 `scripts/windows/.env.windows.example` 和 `register-services.ps1` 默认值调整为当前机器可用路径：
  - `DOTNET_EXE=D:\soft\program\dotnet\dotnet.exe`
  - `POWERSHELL_EXE=C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`
  - `PYTHON_EXE=D:\soft\program\Python\Python312\python.exe`
- 已新增 `scripts/windows/publish-runtime-to-d.ps1`：
  - 从源码目录发布 `.NET ControlApi` 到 `D:\code\XiaoLouAI\.runtime\app\publish\control-api`。
  - 从源码目录发布 `.NET ClosedApiWorker` 到 `D:\code\XiaoLouAI\.runtime\app\publish\closed-api-worker`。
  - 构建并复制前端静态产物到 `D:\code\XiaoLouAI\.runtime\app\XIAOLOU-main\dist`。
  - 复制 `scripts/windows`、`deploy`、`services/local-model-worker` 到 D 盘运行目录。
  - 自动生成或更新 `D:\code\XiaoLouAI\.runtime\app\scripts\windows\.env.windows` 中的 D 盘路径。
- 已增强 `register-services.ps1`：
  - 支持 `-UpdateExisting` 更新已存在服务的后台启动命令。
  - 继续使用 Windows Service 后台启动，不需要手工前台执行 Python。
- 已新增 `scripts/windows/move-postgres-data-to-d.ps1`：
  - 默认 dry-run，只打印计划。
  - 显式传 `-Execute` 且管理员运行时，才会停 PostgreSQL、复制 data directory、更新服务数据目录。
  - 当前 PostgreSQL 服务已指向 `D:\soft\program\PostgreSQL\18`；该脚本只作为发现历史 C 盘 data directory 时的 data-only 迁移工具。
  - PostgreSQL 运行二进制必须使用 `D:\soft\program\PostgreSQL\18\bin\pg_ctl.exe`。
- 已新增 `scripts/windows/move-postgresql-18-to-d.ps1`，用于按用户要求完整迁移当前本机 PostgreSQL 18：
  - 源目录：旧 C 盘 PostgreSQL 18 安装目录
  - 目标目录：`D:\soft\program\PostgreSQL\18`
  - 服务：`postgresql-x64-18`
  - 服务账号：`NT AUTHORITY\NetworkService`
  - 迁移命令：
    ```powershell
    D:\code\XiaoLouAI\scripts\windows\move-postgresql-18-to-d.ps1 -Execute -RemoveSourceAfterValidation
    ```
  - 迁移期间短暂停 PostgreSQL，复制完整安装目录与 data，更新服务 `ImagePath` 到 D 盘，验证 `pg_isready` 后清理 C 盘源目录。
  - 迁移已完成；最终状态：
    - `postgresql-x64-18`：Running / Automatic。
    - 服务 `ImagePath`：`"D:\soft\program\PostgreSQL\18\bin\pg_ctl.exe" runservice -N "postgresql-x64-18" -D "D:\soft\program\PostgreSQL\18\data" -w`
    - `show data_directory;` 返回 `D:/soft/program/PostgreSQL/18/data`。
    - 测试库 `xiaolou_windows_native_test` 可连接，public schema 表数量为 14。
    - 旧 C 盘 PostgreSQL 安装目录已不存在。
- 已新增 `scripts/windows/remove-postgresql-c-source.ps1`：
  - 用于在服务已指向 D 盘后，单独清理 C 盘 PostgreSQL 旧源目录。
  - 本次清理时发现两个历史遗留的 C 盘 `psql.exe` 进程，已由脚本停止后完成删除。
- 已将“项目后续新增依赖/配置/运行写入不走 C 盘，且 XiaoLou 运行写入收拢到仓库 `.runtime`”固化到 Windows 脚本：
  - `load-env.ps1` 会为 XiaoLouAI 服务进程设置 D 盘默认运行环境。
  - `TMP` / `TEMP` 默认到 `D:\code\XiaoLouAI\.runtime\xiaolou-temp`。
  - 项目 `.NET` / NuGet、npm、pip、Python pycache、本地模型和 Playwright 缓存默认到 `D:\code\XiaoLouAI\.runtime\xiaolou-cache\...`。
  - `publish-runtime-to-d.ps1`、`register-services.ps1`、`start-*.ps1`、`verify-control-plane-p0.ps1` 找不到 D 盘显式运行时会失败，不再回退到 C 盘 PATH。
  - `scripts/windows/assert-d-drive-runtime.ps1` 用于检查 `.env.windows` 和服务配置是否出现禁止的 C 盘项目运行路径，并断言 XiaoLou 写入目录留在 `D:\code\XiaoLouAI` 内。
  - 本轮已验证：`.\scripts\windows\assert-d-drive-runtime.ps1 -EnvFile .\scripts\windows\.env.windows.example` 通过。

### 4.5 2026-05-02 P0.3/P0.4 队列与账务收口

本轮已补齐 P0 队列可靠性验证与账务工具：

- `PostgresJobQueue.LeaseJobsAsync` 增强同账号同 lane lease 控制：
  - lease batch 内按 `account_id/lane` 去重，避免一次批量租约拿到同账号同 lane 的多个 active job。
  - 新增 `xiaolou_try_lock_account_lane(account_id, lane)` 非阻塞事务 advisory lock，用于 lease 抢占期间的账号/lane 互斥。
- `RecoverExpiredLeasesAsync` 增强：
  - 过期 `leased/running` job 自动恢复为 `retry_waiting` 或超过 `max_attempts` 后 `failed`。
  - 过期 running attempt 会写入 `job_attempts.status/error/finished_at`，避免审计记录永久停留在 running。
  - 新增 internal 验证端点：
    - `POST /api/internal/jobs/recover-expired`
    - `GET /api/internal/jobs/{jobId}/attempts`
- `scripts/windows/verify-control-plane-p0.ps1` 已覆盖：
  - lease timeout recovery。
  - `retry_waiting` 重新 lease 并完成。
  - poison job 超过 `max_attempts` 后 `failed`，且 `last_error` 与 `job_attempts` 完整可审计。
  - 同账号同 `account-media` 同批次只 lease 一个 active job。
  - 不同账号同 lane 可并行 lease。
  - 同账号不同 lane 不互相阻塞。
  - worker 验证使用本轮唯一 provider route，避免历史残留 job 干扰重复执行。
- 新增账务脚本：
  - `scripts/windows/audit-wallet-ledger.ps1`
    - 只读审计 `wallet_balances` 与 immutable `wallet_ledger` 汇总是否一致。
    - 检查 duplicate idempotency/source、非 immutable ledger、paid order 缺 ledger、canonical 字段缺失。
    - 支持 `-FailOnMismatch`。
  - `scripts/windows/rebuild-wallet-balances-from-ledger.ps1`
    - 默认 dry-run。
    - 显式 `-Execute` 时才从 `wallet_ledger` 重建 `wallet_balances`。
    - 可按 `-AccountId` / `-Currency` 缩小范围；`-ZeroMissingLedgerBalances` 需显式开启。
- C 盘路径收口：
  - 新增 `.gitignore` 忽略 `**/bin/`、`**/obj/`，并清理本轮 `.NET` build 产物，避免 NuGet 生成元数据中的用户 C 盘缓存路径进入项目文件视野。
  - `scripts/start_core_api.cmd`、`scripts/start_xiaolou_dev.cmd`、`scripts/start_xiaolou_preview.cmd` 不再回退到旧 C 盘 Node.js 安装路径，只使用 D 盘 Node.js。
  - `scripts/generate-model-workbook.js` 默认输入改为 `D:\code\XiaoLouAI\.runtime\xiaolou-inputs\模型.xlsx`，不再默认读取用户 Desktop。
  - `core-api` PostgreSQL 网络说明中的 data dir 示例改为 `D:\soft\program\PostgreSQL\18\data`。
  - 已检查关键旧 C 盘 .NET/PostgreSQL/Microsoft dotnet runtime 位置，均不存在项目运行数据目录。
  - `WindowsApps\python.exe` 是系统 alias 占位符，项目脚本继续显式使用 `D:\soft\program\Python\Python312\python.exe`。

本轮已验证命令：

```powershell
D:\soft\program\dotnet\dotnet.exe build .\control-plane-dotnet\XiaoLou.ControlPlane.sln
D:\soft\program\Python\Python312\python.exe -m py_compile .\services\local-model-worker\app\worker.py
.\scripts\windows\verify-control-plane-p0.ps1 -DotnetExe 'D:\soft\program\dotnet\dotnet.exe' -PythonExe 'D:\soft\program\Python\Python312\python.exe'
.\scripts\windows\audit-wallet-ledger.ps1 -FailOnMismatch
.\scripts\windows\rebuild-wallet-balances-from-ledger.ps1
.\scripts\windows\assert-d-drive-runtime.ps1 -EnvFile .\scripts\windows\.env.windows.example
```

最新 P0 验证 run 示例：

```json
{
  "runId": "p0-7a097383106c404ba1e1d23e42725d0f",
  "workersVerified": true
}
```

### 4.6 2026-05-02 P0.5/P1 支付负例、internal-only 与切生产入口

本轮已完成用户指定的四项继续任务：

- payment callback 负例：
  - 同 `eventId` 不同 raw body 会返回 HTTP 400，错误为 `callback event body mismatch`。
  - 同 `merchantOrderNo` 不同 `providerTradeNo` 会返回 HTTP 400，错误为 `payment order provider trade number mismatch`。
  - 同订单金额/credit 不一致会返回 HTTP 400。
  - 签名正确但 `regionCode` 非 `CN` 会返回 HTTP 400。
  - 签名正确但 `data.dataSensitivity=restricted` 会返回 HTTP 400。
  - `PostgresPaymentLedger` 已修正订单冲突时不覆盖既有 `provider_trade_no`，先保留原订单事实再做一致性校验。
- `/api/internal/*` internal-only 保护：
  - `XiaoLou.ControlApi` 新增 internal middleware。
  - 生产配置 `INTERNAL_API_TOKEN` 或 `InternalApi__Token` 后，internal endpoint 必须携带 `X-XiaoLou-Internal-Token`。
  - 未配置 token 时只允许 loopback 且无外部转发头，作为本地验证兜底。
  - `verify-control-plane-p0.ps1` 会验证外部 `X-Forwarded-For` 请求被 403 拒绝。
  - `services/local-model-worker` 已支持 `--internal-token`，Windows 启动脚本会从 `INTERNAL_API_TOKEN` 传入。
- 支付灰度回放说明：
  - `deploy/windows/ops-runbook.md` 新增 `Payment Gray Replay`。
  - 回放前后要求跑 `audit-wallet-ledger.ps1 -FailOnMismatch`。
  - 钱包修复只能先 dry-run `rebuild-wallet-balances-from-ledger.ps1`，需要明确审批后才 `-Execute`。
- P1 Windows 服务切生产入口：
  - `scripts/windows/install.ps1` 新增 `-RegisterServices`、`-UpdateExisting`、`-StartServices`、`-AssertDDrive`。
  - `.env.windows.example` 新增 `INTERNAL_API_TOKEN`。
  - Caddy/IIS Windows 示例均在 `/api/*` 反代前阻断 `/api/internal/*`。
  - `deploy/windows/ops-runbook.md` 新增 P1 production entry 命令与最小环境变量 checklist。

本轮验证命令：

```powershell
D:\soft\program\dotnet\dotnet.exe build .\control-plane-dotnet\XiaoLou.ControlPlane.sln
D:\soft\program\Python\Python312\python.exe -m py_compile .\services\local-model-worker\app\worker.py
.\scripts\windows\verify-control-plane-p0.ps1 -DotnetExe 'D:\soft\program\dotnet\dotnet.exe' -PythonExe 'D:\soft\program\Python\Python312\python.exe'
.\scripts\windows\audit-wallet-ledger.ps1 -FailOnMismatch
.\scripts\windows\rebuild-wallet-balances-from-ledger.ps1
.\scripts\windows\assert-d-drive-runtime.ps1 -EnvFile .\scripts\windows\.env.windows.example
```

最新 P0 验证 run：

```json
{
  "runId": "p0-5b86104259ff42698bf467802ea75464",
  "workersVerified": true
}
```

账务审计结果：

- `balance_mismatch_count=0`
- `duplicate_source_count=0`
- `duplicate_idempotency_count=0`
- `paid_order_missing_ledger_count=0`
- `planned_change_count=0`

### 4.7 2026-05-02 P1 演练、真实支付回放与 public surface 收窄

本轮继续完成 P1 入口硬化与兼容边界收口：

- 新增 `scripts/windows/rehearse-production-cutover.ps1`：
  - 默认 non-mutating preflight，不发布、不注册服务、不启动服务。
  - 检查 D 盘工具链、必需文件、`.env.windows`、反代 public surface、服务注册状态、前端 dev 端口是否仍在监听。
  - 支持显式 `-ExecutePublish`、`-RegisterServices`、`-UpdateExisting`、`-StartServices`、`-RunP0`。
  - 最新 preflight 无 blocker；warning 仅为预期的 runtime env 尚未发布、三个 Windows 服务尚未注册。
- 新增 `scripts/windows/replay-payment-callbacks.ps1`：
  - 输入 JSONL 捕获文件，字段支持 `provider`、`rawBody`/`body`、`signature`/`headers`、`expectedStatus`。
  - 默认 dry-run 只解析和生成报告；显式 `-Execute` 才向 `/api/payments/callbacks/{provider}` 回放。
  - 支持 `-StopOnFailure` 和 D 盘 JSON 报告输出。
- 新增 `deploy/windows/payment-provider-replay-checklist.md`：
  - 标准化真实 provider 捕获格式、staging 回放、重复回放幂等确认、灰度放量、审计和回滚条件。
- Control API public surface 收窄：
  - `.NET ControlApi` 中 `/api/schema/*` 与 `/api/providers/health` 也按 internal token / loopback 保护。
  - `scripts/windows/verify-control-plane-p0.ps1` 已验证外部 `X-Forwarded-For` 访问 internal/schema/provider-health 均被 403 拒绝。
  - `deploy/windows/Caddyfile.windows.example`、`deploy/windows/iis-web.config.example` 和根 `caddy/Caddyfile` 改为 public allowlist；未列入的 `/api/*`、`/uploads/*`、`/jaaz*`、`/socket.io/*` 不再反代。
- `core-api/` 兼容/只读边界：
  - `core-api/src/server.js` 新增 `CORE_API_COMPAT_READ_ONLY=1` 模式，阻断 `POST` / `PUT` / `PATCH` / `DELETE`，返回 `CORE_API_COMPAT_READ_ONLY`。
  - `core-api/README.md` 修正旧的 “production Python API” 表述，明确新生产能力落到 `control-plane-dotnet/`。
  - `core-api/.env.example` 增加 `CORE_API_COMPAT_READ_ONLY` 示例。
- 文档更新：
  - `README.md` 明确生产反代 allowlist 和 core-api 只读兼容模式。
  - `deploy/windows/ops-runbook.md` 引用 P1 preflight 与真实支付回放 checklist。

本轮验证命令：

```powershell
D:\soft\program\dotnet\dotnet.exe build .\control-plane-dotnet\XiaoLou.ControlPlane.sln
D:\soft\program\nodejs\node.exe --check .\core-api\src\server.js
.\scripts\windows\rehearse-production-cutover.ps1 -ReportPath 'D:\code\XiaoLouAI\.runtime\xiaolou-logs\p1-cutover-rehearsal-latest.json'
.\scripts\windows\verify-control-plane-p0.ps1 -DotnetExe 'D:\soft\program\dotnet\dotnet.exe' -PythonExe 'D:\soft\program\Python\Python312\python.exe'
.\scripts\windows\audit-wallet-ledger.ps1 -FailOnMismatch
.\scripts\windows\rebuild-wallet-balances-from-ledger.ps1
.\scripts\windows\assert-d-drive-runtime.ps1 -EnvFile .\scripts\windows\.env.windows.example
.\scripts\windows\replay-payment-callbacks.ps1 -InputFile D:\code\XiaoLouAI\.runtime\xiaolou-temp\payment-callback-replay-sample.jsonl -ReportPath 'D:\code\XiaoLouAI\.runtime\xiaolou-logs\payment-callback-replay-dryrun-latest.json'
```

最新 P0 验证 run：

```json
{
  "runId": "p0-0b82e79a82754ab3939305a276aebc9e",
  "workersVerified": true
}
```

本轮对新改文件扫描了禁止的项目 C 盘运行路径描述，未发现新增可复制执行的 C 盘项目写入路径。

### 4.8 2026-05-02 P1 显式发布演练、client 权限层与真实回放入口

本轮继续推进 P1 切生产演练和入口收口：

- Control API public client 面新增 `ClientApi` token 与账号作用域保护：
  - `CLIENT_API_TOKEN` / `ClientApi__Token` 配置后，`/api/accounts/ensure`、`/api/jobs*`、`/api/media*` 必须携带 `X-XiaoLou-Client-Token` 或 `Authorization: Bearer <token>`。
  - `CLIENT_API_REQUIRE_ACCOUNT_SCOPE=true` 时，写入/查询请求必须通过 `X-XiaoLou-Account-Id` 或 `X-XiaoLou-Account-Owner-Id` 收窄到账户作用域。
  - 未配置 client token 时仅允许 loopback 且无外部转发头访问，保留本机验证兜底。
  - payment provider callback 继续保持 provider signature 主保护，不改成 client token 入口。
- media signed-read URL 增强为按 `media_object_id + account_id` 查询，避免 token 作用域内按 ID 签出其他账号媒体。
- Windows 发布/启动/服务注册脚本已纳入 `CLIENT_API_TOKEN`、`CLIENT_API_TOKEN_HEADER`、`CLIENT_API_REQUIRE_ACCOUNT_SCOPE`、`CLIENT_API_ALLOWED_ACCOUNT_IDS`、`CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS`。
- `scripts/windows/verify-control-plane-p0.ps1` 已支持 client token 与账号作用域头，并修正 `Lease-TestJobs` 单元素数组在 Windows PowerShell 5 中被解包导致 `.Count` 为 `$null` 的验证问题。
- 前端发布构建 blocker 已修复：`XIAOLOU-main/src/lib/api.ts` 补齐 `CreditUsage*` 类型以及 `getWalletUsageStats`、`searchCreditUsageSubjects`、`getAdminCreditUsageStats` 导出。
- 显式发布演练已通过：
  - `scripts/windows/rehearse-production-cutover.ps1 -ExecutePublish`
  - 发布目录：`D:\code\XiaoLouAI\.runtime\app`
  - `.NET ControlApi`、`.NET ClosedApiWorker` 与前端静态 `dist` 均成功发布。
  - 发布后 non-mutating preflight 无 blocker；仅提示三项 Windows Service 尚未注册。
- 已从发布目录临时启动 Control API，并带 `CLIENT_API_TOKEN` / `INTERNAL_API_TOKEN` 跑通 P0：
  - `runId=p0-2156e9367e6548978dba47c0c9a074d8`
  - `workersVerified=true`
  - 临时 Control API 进程验证后已停止。
- 当前 Codex 进程不是管理员，不能实际注册 Windows Service；`rehearse-production-cutover.ps1 -RegisterServices -UpdateExisting` 已新增管理员权限预检，会明确给出 `service-admin` blocker。
- `scripts/windows/stage-payment-provider-replay.ps1` 已修正 replay 参数 splatting，避免把 `-InputFile` 当作文件路径。
- 真实 provider staging replay 搜索结果：
  - 当前未发现真实 provider callback JSONL 捕获文件。
  - 仅对示例 `D:\code\XiaoLouAI\.runtime\xiaolou-temp\payment-callback-replay-sample.jsonl` 做了 dry-run smoke；pre-audit 通过，dry-run 报告成功生成。

本轮验证命令：

```powershell
D:\soft\program\nodejs\npm.cmd run build
D:\soft\program\nodejs\npm.cmd run lint
.\scripts\windows\rehearse-production-cutover.ps1 -ExecutePublish -ReportPath 'D:\code\XiaoLouAI\.runtime\xiaolou-logs\p1-cutover-publish-latest.json'
.\scripts\windows\rehearse-production-cutover.ps1 -ReportPath 'D:\code\XiaoLouAI\.runtime\xiaolou-logs\p1-cutover-preflight-after-publish.json'
.\scripts\windows\verify-control-plane-p0.ps1 -BaseUrl 'http://127.0.0.1:4100' -DotnetExe 'D:\soft\program\dotnet\dotnet.exe' -PythonExe 'D:\soft\program\Python\Python312\python.exe'
.\scripts\windows\stage-payment-provider-replay.ps1 -InputFile 'D:\code\XiaoLouAI\.runtime\xiaolou-temp\payment-callback-replay-sample.jsonl' -BaseUrl 'http://127.0.0.1:4100'
```

### 4.9 2026-05-02 Control API 生产账号授权开关

本轮继续把 public client 入口从“带 token 可验证”推进到“切生产时可显式收窄授权”：

- `.NET ControlApi` 新增 `ClientApi.RequireConfiguredAccountGrant` / `CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT`。
  - 默认 `false`，保留 P0 动态账号验证与本机演练兼容性。
  - 生产切换时设置为 `true` 后，`/api/accounts/ensure`、`/api/jobs*`、`/api/media*` 只能访问配置授权内的账号或 owner。
  - 授权配置继续使用 `CLIENT_API_ALLOWED_ACCOUNT_IDS`、`CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS`；支持精确账号 ID、`user:<id>` / `organization:<id>` owner grant，以及显式 wildcard grant。
- Windows `.env` 示例、发布脚本、Control API 启动脚本和服务注册脚本均已纳入该开关。
- `scripts/windows/verify-control-plane-p0.ps1` 增加 public client 账号 scope 不匹配负例，确认有效 client token 不能靠错误账号头读取其他账号任务。
- `deploy/windows/ops-runbook.md` 和 `README.md` 已补充生产 cutover 前必须启用 configured grant 的说明。

本轮验证命令：

```powershell
. .\scripts\windows\load-env.ps1 -EnvFile .\scripts\windows\.env.windows.example
& $env:DOTNET_EXE build .\control-plane-dotnet\XiaoLou.ControlPlane.sln
.\scripts\windows\assert-d-drive-runtime.ps1 -EnvFile .\scripts\windows\.env.windows.example
.\scripts\windows\verify-control-plane-p0.ps1 -BaseUrl 'http://127.0.0.1:4100' -DotnetExe 'D:\soft\program\dotnet\dotnet.exe' -PythonExe 'D:\soft\program\Python\Python312\python.exe' -ClientApiToken 'xiaolou-test-client-token'
```

最新 P0 验证 run：

```json
{
  "runId": "p0-17e910af2bfd458ba17da5eeb8463d14",
  "workersVerified": true
}
```

## 5. 下一步计划

### P1：切生产演练与入口硬化

1. 执行一次显式发布演练：`rehearse-production-cutover.ps1 -ExecutePublish -RegisterServices -UpdateExisting -RunP0`，确认 `D:\code\XiaoLouAI\.runtime\app` 运行目录、服务注册和 P0 验证闭环。
2. 用真实 provider 捕获样本跑 staging replay，确认第二次回放幂等、wallet audit 无 mismatch。
3. 继续把 Control API public client token 迁向真实用户/组织鉴权 provider，保留 configured grant 作为切生产收窄和灰度开关。
4. 继续清理或代理 `core-api/` legacy public routes，确保生产只读兼容面不会恢复主写。

### P2：移除旧控制面依赖

1. 停用 `core-api/` 的支付、任务、媒体主写入口。
2. 完成旧 `tasks/provider_jobs/wallet_recharge_orders/payment_events` 到 canonical tables 的投影、校验和下线。
3. PostgreSQL 队列达到瓶颈后，再接入托管消息服务适配层。
4. 不在 P0/P1 提前引入 RabbitMQ/Redis/Celery。

## 6. 下一次继续提示词

```text
继续 XiaoLouAI Windows 原生重构。先读取 XIAOLOU_REFACTOR_HANDOFF.md 和
docs/xiaolouai-python-refactor-handoff.md。当前路线已经确定为方案二：
.NET 8 / ASP.NET Core 控制面 + PostgreSQL 唯一事实源 + Windows Service workers，
Python 只允许用于本地模型适配器/推理执行器。当前 P0 Windows 验证脚本
scripts/windows/verify-control-plane-p0.ps1 已跑通，XiaoLou.ClosedApiWorker 与
services/local-model-worker 已接入 jobs lease/running/succeed/fail 端到端流程。
lease timeout recovery、retry_waiting、poison job、同账号同 lane 并发控制验证，
以及 wallet ledger 重建/账务审计脚本已补齐。payment callback 负例、支付灰度回放说明、
`/api/internal/*` internal-only 保护和 P1 Windows 服务切生产入口已补齐并通过验证。
P1 non-mutating cutover preflight、真实 provider 支付回放 JSONL 脚本/checklist、Control API public surface
allowlist 收窄和 `core-api/` 兼容只读模式已补齐并通过验证。下一步优先做显式发布演练、
真实 provider staging replay、Control API 鉴权/权限层和 legacy public route 收口。不要推进
Docker/Linux/Kubernetes、Windows + Celery、Redis Open Source on Windows 作为生产路径。
```
