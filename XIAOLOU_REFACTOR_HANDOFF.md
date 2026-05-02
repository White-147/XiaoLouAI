# XiaoLouAI Windows 原生重构下一步交接

更新时间：2026-05-02 20:58:00 +08:00
工作目录：`D:\code\XiaoLouAI`
完整历史参考：
- `docs/xiaolouai-python-refactor-handoff.md`
- `C:\Users\10045\Downloads\deep-research-report.md`

## 当前状态

- 路线保持不变：`.NET 8 / ASP.NET Core` Control API + PostgreSQL 唯一事实源 + Windows Service workers；不补 Docker/Linux/Kubernetes，不把 Windows + Celery 或 Redis Open Source on Windows 作为生产路径。
- deep-research report 对应的 A/B/C/D 工程收口已完成并进入运行态；真实支付材料、真实 PostgreSQL dump restore drill、真实 production legacy source rerun 都是上线/最终验收 evidence，不是当前 P2 工程 blocker。
- P2 第一批 media/upload 与 `/uploads/*`、`/vr-*` 已完成；frontend `uploadFile` 已迁到 `.NET` media begin/object PUT/complete/move/signed-read-url，旧静态媒体路径已按 retired legacy media 处理。
- P2 第二批 `/api/tasks*` -> `/api/jobs*` 已完成并发布到运行态。管理员完整发布报告：`D:\code\XiaoLouAI\.runtime\xiaolou-logs\control-api-publish-restart-p0-wallet-20260502-205006.json`，`status=ok`，P0 runId `p0-5a034fd5b748450abc5de1bca0a08ccf`，`workersVerified=true`。
- P2 第三批 wallet/recharge/admin billing 已完成源码与运行态收口：
  - `.NET` 新增 canonical wallet read surface：`GET /api/wallet`、`GET /api/wallets`、`GET /api/wallets/{walletId}/ledger`、`GET /api/wallet/usage-stats`，由 `accounts`、`wallet_balances`、`wallet_ledger` 返回只读数据。
  - 前端 wallet read 已迁到 Control API；旧充值 capabilities/order create/order lookup/refresh/proof/confirm 与 admin manual review 已显式退役，抛 `410 RECHARGE_FLOW_RETIRED`；admin pricing/orders/usage 不再调用旧 route，改为本地 read-only baseline/空统计。
  - Caddy/IIS public allowlist、`verify-frontend-legacy-dependencies.ps1`、`docs/core-api-cutover.md` 已同步 wallet read public surface；`core-api/src/control-api-client-assertion.js` 与 Windows env 默认 permission 已加入 `wallet:read`。
  - Machine env 与 runtime `.env.windows` 已同步 `CLIENT_API_ALLOWED_PERMISSIONS=accounts:ensure,jobs:create,jobs:read,jobs:cancel,wallet:read,media:read,media:write`；三项 Windows 服务均 Running。钱包运行态 smoke：`GET /api/wallet`、`GET /api/wallets`、`GET /api/wallet/usage-stats` 均返回 200。
- 最新 frontend hard gate：`D:\code\XiaoLouAI\.runtime\xiaolou-logs\frontend-legacy-dependencies-20260502-204713.json`，`status=ok`、`blockers=0`、`warnings=0`，review_items 从 `159 -> 135 -> 131 -> 115`。
- 最新 P2 audit：`D:\code\XiaoLouAI\.runtime\xiaolou-logs\p2-cutover-audit-20260502-204926.json`，`status=ok`、`blockers=0`、`warnings=0`、`evidence_pending=1`；nested core-api readonly 自动发现/验证 mutating routes `87/87`。
- `verify-core-api-compat-readonly.ps1` 独立通过；`assert-d-drive-runtime.ps1 -EnvFile .\scripts\windows\.env.windows.example` 通过；`git diff --check` 无 whitespace error，仅有既有 CRLF 提示。
- 运行态前端 dist 已用 `publish-runtime-to-d.ps1 -SkipDotnetPublish` 同步，snapshot：`D:\code\XiaoLouAI\.runtime\xiaolou-backups\runtime-snapshots\runtime-20260502-205527`。

## 下一步

不要回到原地重复 hard gate。下一批继续按 review_items 做业务面减量，优先处理 `project/canvas/create`，然后是 `playground/toolbox` 与剩余 auth/profile/organization/admin 旧写流程。

处理原则：

1. 对仍需保留的读/写能力，先补 `.NET` canonical endpoint、权限边界、反代 allowlist 和验证，再迁前端。
2. 对不准备恢复的旧写流程，在 API client/UI 明确退役，不保留旧 route literal，不依赖 `assertNoLegacyMutatingRequest` 作为长期业务逻辑。
3. 每批变更后继续硬闸门：

```powershell
D:\soft\program\nodejs\npm.cmd --prefix .\XIAOLOU-main run lint
D:\soft\program\nodejs\npm.cmd --prefix .\XIAOLOU-main run build
.\scripts\windows\verify-frontend-legacy-dependencies.ps1 -FailOnLegacyWriteDependency
.\scripts\windows\verify-p2-cutover-audit.ps1 -FailOnFrontendLegacyWriteDependency
.\scripts\windows\verify-core-api-compat-readonly.ps1
.\scripts\windows\assert-d-drive-runtime.ps1 -EnvFile .\scripts\windows\.env.windows.example
```

若改 `.NET` 或运行时代码，再用管理员 PowerShell 完整 publish/restart/P0：

```powershell
D:\code\XiaoLouAI\scripts\windows\complete-control-api-publish-restart-p0.ps1 `
  -SourceRoot D:\code\XiaoLouAI `
  -Root D:\code\XiaoLouAI\.runtime\app `
  -DotnetExe D:\soft\program\dotnet\dotnet.exe `
  -PythonExe D:\soft\program\Python\Python312\python.exe `
  -BaseUrl http://127.0.0.1:4100
```

## 禁止回退路线

- 不推进 Docker、Docker Compose、Linux、Linux container、Kubernetes、WSL 生产路径。
- 不把 Windows + Celery 作为生产异步主控。
- 不把 Redis Open Source on Windows 作为关键生产依赖。
- RabbitMQ on Windows 仅保留为备选，不作为默认队列。
- 前端生产入口只允许静态构建产物，不允许 Vite dev server / preview 承担线上流量。

## 下一棒提示词

```text
继续 XiaoLouAI Windows 原生重构。先读 XIAOLOU_REFACTOR_HANDOFF.md 获取下一步操作，再读
docs/xiaolouai-python-refactor-handoff.md 和 C:\Users\10045\Downloads\deep-research-report.md 获取完整历史。
deep-research-report.md 的结论是继续 Windows 原生路线，不补 Docker/Linux；A/B/C/D 工程收口已完成并已完整 publish/restart/P0。
当前 P2 hard gate 为 status ok / blockers 0 / warnings 0；真实支付材料、真实 PostgreSQL dump、真实 production legacy source rerun 只作为上线/最终验收 evidence。
media/upload 与 /uploads/*、/vr-* 第一批已完成；/api/tasks* -> /api/jobs* 第二批已完成并发布运行态；wallet/recharge/admin billing 第三批已完成并发布运行态，frontend review_items 从 159 -> 135 -> 131 -> 115。
下一步不要继续原地复查 hard gate，而是按批次迁移/退役剩余前端 legacy route review_items：优先 project/canvas/create，然后 playground/toolbox，再处理剩余 auth/profile/organization/admin 旧写流程。
每批变更后保持 verify-frontend-legacy-dependencies.ps1 -FailOnLegacyWriteDependency、verify-p2-cutover-audit.ps1 -FailOnFrontendLegacyWriteDependency 和 verify-core-api-compat-readonly.ps1 为硬闸门。
不要推进 Docker/Linux/Kubernetes、Windows + Celery、Redis Open Source on Windows 作为生产路径。修改完成后更新 XIAOLOU_REFACTOR_HANDOFF.md 和 docs/xiaolouai-python-refactor-handoff.md。
```
