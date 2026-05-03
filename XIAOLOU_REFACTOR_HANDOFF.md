# XiaoLouAI Windows 原生重构交接

更新时间：2026-05-03 11:40 +08
工作目录：`D:\code\XiaoLouAI`

继续执行前先读：

- `docs/xiaolouai-python-refactor-handoff.md`
- `C:\Users\10045\Downloads\deep-research-report.md`

## 当前权威状态

- 当前生产路线只走 `.NET 8 / ASP.NET Core Control API + PostgreSQL canonical + Windows Service workers`。
- 不推进 Docker、Docker Compose、Linux、Linux container、Kubernetes、WSL、Windows + Celery 或 Redis Open Source on Windows 作为生产路径。
- `core-api/` 只保留为迁移期只读兼容层、登录/断言过渡、旧实现参考和导入校验工具，不再作为长期生产控制面。
- Python 只允许作为本地模型 adapter / inference runner，不承载主控制面和异步主控。
- PostgreSQL canonical 是运行时唯一事实源；旧 SQLite、旧 PostgreSQL snapshot 和旧表只允许作为导入、dry-run、校验和最终验收 evidence。
- 真实 production legacy dump/source、真实支付材料、真实 PostgreSQL restore drill 都只作为 README 定义的上线/最终验收 evidence，不再作为当前工程下一步 blocker。

## 已完成并发布到真实 4100 Windows service 的批次

以下批次不要重复做，只有后续改动触碰相关 flow 时才复核：

1. A/B/C/D 工程收口与 Windows-native P0 基础设施。
2. 前端 P2 legacy route 批次：media/upload、`/uploads/*`、`/vr-*`、`/api/tasks* -> /api/jobs*`、wallet/recharge/admin billing、project/canvas/create、playground/toolbox、auth/profile/organization/admin/API-center review。
3. 第一批 `.NET` canonical project/create/canvas surface：
   - `/api/projects*`
   - `/api/create/images*`
   - `/api/create/videos*`
   - `/api/canvas-projects*`
   - `/api/agent-canvas/projects*`
4. 第二批 `.NET` canonical identity/config surface：
   - `/api/auth*`
   - `/api/me`
   - `/api/organizations/{organizationId}/members`
   - `/api/api-center*`
5. 第三批 project 相邻 canonical surface：
   - `/api/projects/{projectId}/assets*`
   - `/api/projects/{projectId}/storyboards*`
   - `/api/projects/{projectId}/videos`
   - `/api/projects/{projectId}/dubbings`
   - `/api/projects/{projectId}/exports`
6. 第四批 admin/system canonical surface：
   - `/api/admin/pricing-rules`
   - `/api/admin/orders`
   - `/api/admin/orders/{orderId}/review` 返回 410 retired boundary
   - `/api/enterprise-applications*`
7. 第五批 Playground canonical surface：
   - `/api/playground/config`
   - `/api/playground/models`
   - `/api/playground/conversations*`
   - `/api/playground/chat-jobs*`
   - `/api/playground/memories*`
8. 第六批 Toolbox canonical surface：
   - `GET /api/capabilities`
   - `GET /api/toolbox`
   - `GET /api/toolbox/capabilities`
   - `POST /api/toolbox/character-replace`
   - `POST /api/toolbox/motion-transfer`
   - `POST /api/toolbox/upscale-restore`
   - `POST /api/toolbox/video-reverse-prompt`
   - `POST /api/toolbox/storyboard-grid25`
   - `POST /api/toolbox/translate-text`

## 最新实现要点

- `control-plane-dotnet` 已新增或保留 PostgreSQL-backed stores：`PostgresIdentityConfigStore`、`PostgresProjectSurfaceStore`、`PostgresAdminSystemStore`、`PostgresPlaygroundStore`、`PostgresToolboxStore`。
- Toolbox 使用 canonical `toolbox_capabilities` 和 `toolbox_runs`，可运行工具通过 canonical `jobs` 入队，lane 为 `account-control`，provider route 为 `closed-api`。
- 前端首页工具箱能力发现和可运行工具已切到 `/api/capabilities` 和 `/api/toolbox*`，不再走旧 `/api/jobs` 快捷写入。
- public reverse proxy allowlist、client assertion、runtime env permissions、P0 assertion 和 frontend legacy dependency gate 均已包含 `toolbox:read/write` 与 toolbox routes。
- legacy/canonical projection verifier 已新增 `apiCenterHealth`，会读取 canonical `api_center_configs` 与 `provider_health`，把 API-center 明文密钥字段、无效 JSON、vendor/model id 冲突、默认模型悬空或指向禁用模型、apiKeyHash 状态冲突作为 blocker；已配置 vendor 缺少 `provider_health` 作为日常审计 `evidence_pending`。
- 支付体系继续留在 canonical `payment_orders`、`payment_callbacks`、`wallet_ledger`、`wallet_balances`、callback/ledger 路线；手工 admin recharge review 继续退役。
- 真实 runtime 当前指向本机 `xiaolou_windows_native_test`。库存报告 `runtime-legacy-source-inventory-20260503-084026.json` 显示 canonical 表有当前运行数据，legacy 旧表为空或不存在。
- 当前库备份 `D:\code\XiaoLouAI\.runtime\xiaolou-backups\runtime-current-source\xiaolou-20260503-084033.dump` 只能作为当前运行库状态证据，不能冒充历史 production legacy dump/source。

## 发布脚本卡住问题的结论

用户截图中管理员 PowerShell 在 build 后长时间无输出，原因不是 Windows service 运行卡死：

- `complete-control-api-publish-restart-p0.ps1` 之前把 P0 输出缓存在变量里，导致 publish 后 P0 阶段没有实时日志。
- `publish-runtime-to-d.ps1` 在组合发布流程里仍打印 standalone `register-services.ps1` 提示，容易误导用户以为脚本停在手工步骤。
- `verify-control-plane-p0.ps1` 的 lease recovery 断言会和后台 `LeaseRecoveryService` 抢恢复；后台先恢复时，旧断言会误判失败。

已完成加固：

- `complete-control-api-publish-restart-p0.ps1` 现在实时转发 P0 输出，同时仍捕获输出用于报告。
- `complete-control-api-publish-restart-p0.ps1` 调用 publish 时传入 `-SuppressRegistrationHint`。
- `publish-runtime-to-d.ps1` 新增 `-SuppressRegistrationHint`，组合流程里不再打印 standalone 注册服务提示。
- `verify-control-plane-p0.ps1` 接受后台 `LeaseRecoveryService` 先恢复 expired running job 的合法状态。

结论：build/publish 本身仍可能正常耗时，但后续 P0 不应再安静到像假死。此前 elevated combined report `control-api-publish-restart-p0-toolbox-20260503-105110.json` 是 verifier race 失败；publish 和 Windows service restart 已完成，真实 4100 patched P0 后续已通过。

## 最新验证记录

已通过：

- `.NET build` 0 warning / 0 error。
- `npm --prefix .\XIAOLOU-main run build`。
- `verify-frontend-legacy-dependencies.ps1 -FailOnLegacyWriteDependency`：`status=ok`、`blockers=0`、`warnings=0`、`review_items=7`。
- 临时 `http://127.0.0.1:4110` Control API P0 smoke：`p0-c28dfce9e0974728b75bc40467d0a147`。
- strict legacy/canonical projection verifier：`toolbox_capabilities` count 为 5，`toolbox_runs` 存在。
- `D:\soft\program\nodejs\node.exe --check core-api\scripts\verify-legacy-canonical-projection.js` 通过。
- 当前库 verifier smoke：`legacy-canonical-api-center-verifier-smoke-20260503-current.json`，`apiCenterHealth` 无 blocker；`bytedance` provider health evidence 仍为 warning。
- 裁剪版 P2 audit smoke：`p2-cutover-api-center-verifier-smoke-20260503-current.json`，`status=ok`、`blockers=0`、`warnings=0`；缺真实 legacy snapshot 与 provider health evidence 均归入 `evidence_pending`。
- synthetic projection gate：`legacy-canonical-projection-gate-fixture-20260503-113743.json`，`status=ok`、`exitPolicy=strict-ok`。
- 真实 `http://127.0.0.1:4100` patched P0 smoke：`p0-f48924a66257420ba521ac5844fb896c`，本次为 `-SkipWorkers`。
- 三个发布/P0 脚本 PowerShell parser 检查通过：
  - `scripts/windows/publish-runtime-to-d.ps1`
  - `scripts/windows/complete-control-api-publish-restart-p0.ps1`
  - `scripts/windows/verify-control-plane-p0.ps1`
- `git diff --check` 无 whitespace error，仅保留 Git 的 LF/CRLF 工作区提示。

历史通过的关键报告：

- admin/system publish/restart/P0：`control-api-publish-restart-p0-admin-system-20260503-091100.json`
- admin/system runtime smoke：`control-api-admin-system-runtime-smoke-20260503-091831.json`
- Playground publish/restart/P0：`control-api-publish-restart-p0-playground-20260503-101541.json`
- frontend legacy gate：`frontend-legacy-dependencies-20260503-102934.json`
- P2 audit：`p2-cutover-audit-20260503-102945.json`

## 旧表统合与退役策略

目标：生产运行态只保留 PostgreSQL canonical 表、字段和约束。旧表和旧字段不能继续作为运行时事实源。

阶段：

1. 盘点与冻结：逐域列出旧表、旧字段、旧 route、旧 worker 和 canonical 目标表，冻结旧主写入口。
2. 补列与投影：同名旧表只做向前兼容 `ADD COLUMN IF NOT EXISTS`、索引、约束和 JSON backfill；语义不同的旧表通过幂等 `INSERT ... SELECT ... ON CONFLICT DO UPDATE` 投影到 canonical 表。
3. 运行时切断：Control API、worker、P0 smoke、frontend 调用只能读写 canonical 表和字段。
4. 一致性闸门：verifier 检查旧表未投影、canonical 必填缺失、孤儿引用、JSON/列字段冲突，并作为 blocker。
5. 清理退役：只有完成 publish/restart/P0、4100 smoke、硬闸门、备份，并进入 README 定义的最终验收 evidence 流程后，才允许隔离或物理清理旧表旧字段。
6. 迁移保留：只保留 SQLite/旧架构到 canonical PostgreSQL 的导入脚本、staging schema、dry-run plan、校验报告和回滚证据。

project 相邻域已经推进到第 3/4 阶段：`projectAdjacentHealth` 会把旧表未投影、canonical 必填缺失、孤儿引用、JSON/列字段冲突作为 blocker，synthetic fixture 与当前测试库均通过。API-center/vendor 域已补 `apiCenterHealth`，用于守住 canonical vendor 配置不含明文 secret、默认模型引用可解析、provider health evidence 不被误作当前 blocker。第 5 阶段旧字段旧表物理清理尚未执行。

## 当前有效下一步

1. 不重复 project/create/canvas、identity/config、project-adjacent、admin/system、Playground、Toolbox 已完成批次。
2. 继续 system/audit/权限细化、provider health evidence 接入和 API-center vendor 路由细节完善。
3. 继续旧表 runtime 依赖隔离、verifier 维护和第 5 阶段清理方案设计；新 verifier 不应把真实 vendor/支付/legacy evidence 当作当前工程 blocker。
4. 支付体系继续保持 canonical payment/wallet/callback/ledger 路线。
5. 如果继续优化启动和测试入口，保持命令非交互、带 timeout、完成后返回 exit code；不要引入 `pause`、`cmd /k`、`-NoExit` 或无限轮询。
6. 每批收尾必须同步本文件和 `docs/xiaolouai-python-refactor-handoff.md`。若涉及 README，必须同步中英文双版。

## 禁止回退

- 不回到 Docker、Docker Compose、Linux、Linux container、Kubernetes 或 WSL 生产路线。
- 不把 Windows + Celery 作为生产异步控制面。
- 不把 Redis Open Source on Windows 作为关键生产依赖。
- 不把 RabbitMQ 作为默认队列；它只保留为可选后续 adapter。
- 前端生产入口仍是静态构建产物，不允许由 Vite dev server / preview 承担线上流量。

## 下一棒提示词

```text
继续 XiaoLouAI Windows 原生重构。先读 XIAOLOU_REFACTOR_HANDOFF.md 获取当前权威交接，再读 docs/xiaolouai-python-refactor-handoff.md 和 C:\Users\10045\Downloads\deep-research-report.md 获取完整历史。当前路线只走 .NET 8 / ASP.NET Core Control API + PostgreSQL canonical + Windows Service workers，不推进 Docker/Linux/Kubernetes、Windows + Celery 或 Redis Open Source on Windows。A/B/C/D、前序 P2 frontend legacy route 批次、project/create/canvas、identity/config、project 相邻、admin/system、Playground 与 Toolbox canonical surface 均已完成并发布到真实 Windows service 运行态，4100 runtime smoke 与硬闸门通过。legacy/canonical verifier 已有 `projectAdjacentHealth` 与 `apiCenterHealth`：project 相邻旧表未投影、canonical 必填缺失、孤儿引用、JSON/列字段冲突，以及 API-center 明文密钥、无效 vendor/model/default 配置会成为 blocker；真实 provider health、真实 legacy dump/source 与真实支付材料一样仅作为上线/最终验收 evidence，不再作为当前下一步 blocker。旧字段旧表第 5 阶段物理清理尚未执行；下一步不要重复已完成批次，继续 system/audit/权限细化、provider health evidence 接入、API-center vendor 路由细节、旧表 runtime 依赖隔离、verifier 维护与第 5 阶段清理方案设计。启动/发布脚本已加固，组合 publish/restart/P0 会实时输出 P0 进度并兼容 LeaseRecoveryService recovery race。每次修改收尾都必须同步 XIAOLOU_REFACTOR_HANDOFF.md 和 docs/xiaolouai-python-refactor-handoff.md；若涉及 README 范围，按中英文双版同步更新。
```
