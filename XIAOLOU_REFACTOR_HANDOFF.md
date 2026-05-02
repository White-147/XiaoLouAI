# XiaoLouAI Windows 原生重构交接

更新时间：2026-05-02 22:18 +08
工作目录：`D:\code\XiaoLouAI`

继续执行前先读：
- `docs/xiaolouai-python-refactor-handoff.md`
- `C:\Users\10045\Downloads\deep-research-report.md`

## 当前权威状态

- 路线保持不变：`.NET 8 / ASP.NET Core` Control API + PostgreSQL canonical 唯一事实源 + Windows Service workers。
- 不推进 Docker、Docker Compose、Linux、Linux container、Kubernetes、WSL、Windows + Celery 或 Redis Open Source on Windows 作为生产路径。
- A/B/C/D 工程收口已完成，并已完成运行态 publish/restart/P0。真实支付材料、真实 PostgreSQL dump restore drill、真实 production legacy source rerun 仍只作为上线/最终验收 evidence，不是当前 P2 blocker。
- P2 前端 legacy route 批次已完成：
  - media/upload、`/uploads/*`、`/vr-*`。
  - `/api/tasks*` -> `/api/jobs*`。
  - wallet/recharge/admin billing。
  - `project/canvas/create`、`playground/toolbox`、`auth/profile/organization/admin/API-center` legacy route review 批次。
- frontend legacy route review 计数已从 `159 -> 135 -> 131 -> 115 -> 44 -> 28 -> 7`。剩余 7 项不是 live legacy write：`XIAOLOU-main/src/lib/api.ts` 中 6 个 legacy-surface guard 字面量（`/api`、`/api/`、`/jaaz`、`/jaaz/`、`/jaaz-api`、`/jaaz-api/`）以及 `VIDEO_REPLACE_BASE=/api/video-replace`。

## 最新源码实现

已完成第一批 `.NET` canonical real surface 源码实现，用来替换之前 project/create/canvas 区域的临时 local draft store / job bridge 状态：

- `control-plane-dotnet` 新增 PostgreSQL-backed Control API 路由：
  - `/api/projects`
  - `/api/projects/{projectId}`
  - `/api/projects/{projectId}/overview`
  - `/api/projects/{projectId}/settings`
  - `/api/projects/{projectId}/script`
  - `/api/projects/{projectId}/timeline`
  - `/api/canvas-projects`
  - `/api/canvas-projects/{projectId}`
  - `/api/agent-canvas/projects`
  - `/api/agent-canvas/projects/{projectId}`
  - `/api/create/images`
  - `/api/create/videos`
- `control-plane-dotnet/db/migrations/20260501_windows_native_core.sql` 已加入 forward-compatible canonical tables：`projects`、`project_settings`、`project_scripts`、`project_timelines`、`canvas_projects`、`agent_canvas_projects` 和 create result tombstone。
- `XIAOLOU-main/src/lib/api.ts` 已把 project、canvas、agent-canvas、create image/video list-delete 调到 `.NET` canonical endpoints。create generation 继续使用 canonical `/api/jobs`。
- client permissions、Caddy/IIS 反代示例、P0 脚本默认值、runtime publish/register 默认值、frontend legacy dependency scanner 均已同步新 public paths 和权限：`projects:read/write`、`canvas:read/write`、`create:read/write`。

## 最新验证

源码工作区已通过：

```powershell
D:\soft\program\dotnet\dotnet.exe build .\control-plane-dotnet\XiaoLou.ControlPlane.sln
D:\soft\program\nodejs\npm.cmd --prefix .\XIAOLOU-main run lint
D:\soft\program\nodejs\npm.cmd --prefix .\XIAOLOU-main run build
.\scripts\windows\verify-frontend-legacy-dependencies.ps1 -FailOnLegacyWriteDependency
.\scripts\windows\verify-p2-cutover-audit.ps1 -FailOnFrontendLegacyWriteDependency
.\scripts\windows\verify-core-api-compat-readonly.ps1
.\scripts\windows\assert-d-drive-runtime.ps1 -EnvFile .\scripts\windows\.env.windows.example
```

最新报告：
- frontend hard gate：`D:\code\XiaoLouAI\.runtime\xiaolou-logs\frontend-legacy-dependencies-20260502-220033.json`，`status=ok`、`blockers=0`、`warnings=0`、`review_items=7`。
- P2 audit：`D:\code\XiaoLouAI\.runtime\xiaolou-logs\p2-cutover-audit-20260502-220057.json`，`status=ok`、`blockers=0`、`warnings=0`、`evidence_pending=1`。
- core-api readonly smoke：`core-api-compat-readonly-20260502-220058...`，已通过；legacy public writes 继续返回 410。
- D 盘 runtime 断言：已通过。
- 本地临时 Control API smoke（port 4128）已跑通：`POST/GET/PUT /api/projects`、project settings/script/timeline、`POST/GET /api/canvas-projects`、`POST /api/agent-canvas/projects`、`GET /api/create/images`。
- 文档同步检查已完成：根 handoff 已改为中文权威交接版；`docs/xiaolouai-python-refactor-handoff.md` 第 17 节已整理出“当前权威状态 / 当前有效下一轮 / 旧下一轮历史记录”；相关 README 已按中英文双版同步更新。

## 运行态边界

本批修改了 `.NET` runtime code。源码 build 和本地临时 Control API smoke 已通过，但当前会话不是管理员 PowerShell，尚未对真实 Windows service runtime 执行 publish/restart/P0。因此不要声称当前运行中的 `XiaoLou-ControlApi` 服务已经包含本批。

下一步先在 elevated Administrator PowerShell 中执行：

```powershell
D:\code\XiaoLouAI\scripts\windows\complete-control-api-publish-restart-p0.ps1 `
  -SourceRoot D:\code\XiaoLouAI `
  -Root D:\code\XiaoLouAI\.runtime\app `
  -DotnetExe D:\soft\program\dotnet\dotnet.exe `
  -PythonExe D:\soft\program\Python\Python312\python.exe `
  -BaseUrl http://127.0.0.1:4100
```

完成后通过 `http://127.0.0.1:4100` 对 `/api/projects`、`/api/canvas-projects`、`/api/agent-canvas/projects`、`/api/create/images|videos` 做运行态 smoke。

## 下一步执行顺序

1. 先完成本批 `.NET` canonical project/create/canvas 的管理员 publish/restart/P0 和运行态 smoke。
2. 再继续 auth/profile/organization/admin/API-center 的真实 `.NET` canonical identity/config surfaces，不要重复迁移已经退役的 frontend legacy route 批次。
3. 如果 project 相邻业务流需要更多真实关系，再在 PostgreSQL canonical model 下补 assets/storyboards/export 等关系，并同步 owner grant、route permission、反代 allowlist 和验证脚本。
4. 每批结束后保持 frontend legacy dependency gate、P2 audit、core-api readonly、D 盘 runtime 断言为硬闸门。

## 每次修改结束后的文档同步要求

为避免交接再次混乱，每次代码、脚本、配置、反代或运行态状态发生变化后，收尾时必须同步：

1. 更新本文件 `XIAOLOU_REFACTOR_HANDOFF.md` 的当前状态、最新验证、运行态边界和下一步。
2. 在 `docs/xiaolouai-python-refactor-handoff.md` 的第 17 节追加或整理对应进度记录；如果旧“下一轮执行顺序”被新状态取代，必须明确标注旧描述已失效。
3. 如果变更影响公开部署、生产路线、兼容层边界、README 语言维护规则或开发者入口，同时更新对应 README，并保持 English / 简体中文版本同步。
4. 不得只更新其中一个 handoff；最终回复中应说明两份 handoff 是否已同步。

## 禁止回退

- 不回到 Docker、Docker Compose、Linux、Linux containers、Kubernetes 或 WSL 生产路径。
- 不把 Windows + Celery 作为生产异步控制面。
- 不把 Redis Open Source on Windows 作为关键生产依赖。
- 不把 RabbitMQ 设为默认队列；它只保留为可选后续 adapter。
- 前端生产入口仍是静态构建产物，不允许由 Vite dev server / preview 承担线上流量。

## 下一棒提示词

```text
继续 XiaoLouAI Windows 原生重构。先读 XIAOLOU_REFACTOR_HANDOFF.md 获取当前权威交接，再读 docs/xiaolouai-python-refactor-handoff.md 和 C:\Users\10045\Downloads\deep-research-report.md 获取完整历史。当前路线只走 .NET 8 / ASP.NET Core Control API + PostgreSQL canonical + Windows Service workers，不推进 Docker/Linux/Kubernetes、Windows + Celery 或 Redis Open Source on Windows。A/B/C/D 与前序 P2 frontend legacy route 批次已完成；第一批 .NET canonical source surface 已接入 /api/projects、/api/create/images|videos、/api/canvas-projects、/api/agent-canvas/projects 并通过源码验证，但还需要 elevated Administrator PowerShell 完成 publish/restart/P0 后才能声明运行态部署完成。每次修改收尾都必须同步 XIAOLOU_REFACTOR_HANDOFF.md 和 docs/xiaolouai-python-refactor-handoff.md；若涉及 README 范围，按中英文双版同步更新。
```
