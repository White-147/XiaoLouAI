# 工程约束

本文是 XiaoLouAI 后续工作的工程边界说明。README 保留公开入口；具体 owner 继续以 `XIAOLOU_REFACTOR_HANDOFF.md` 和 `deploy/records` 的当前阶段记录为准。

## 软件设计

- 优先高内聚、低耦合。
- 每个 owner slice 只负责一个明确变更理由。
- shell/navigation、data loading、API adapters、forms、tables、dialogs、runtime orchestration、provider execution 不应无理由混合。
- UI 依赖 feature API wrappers 和 DTOs，不依赖具体 backend/runtime 实现细节。
- 不为了“看起来架构完整”而添加抽象；只有在减少真实重复、隔离真实变化点或让目标拆分更安全时才添加。
- 不在无关 feature/parity 工作中 broad-rewrite 大文件。
- 避免跨层反向依赖、循环依赖和隐式全局状态。
- 如果 MVP 需要临时直连，把它限制在单一 adapter/gateway，并记录债务。

## 目录与所有权

- 活跃前端产品代码放在 `XIAOLOU-main/src/features/<product-area>/`。
- 按 route、product area 或 feature capability 聚合代码。
- 共享 UI/layout primitives 只有在确实复用时才进入 shared owner；不要创建低信息量 `common`、`misc`、`helpers` 桶来混放无关代码。
- Control API 工作放在 `backend/dotnet/control-plane/`。
- 非 .NET runtime services 放在 `backend/services/<product-area>/...`，并且需要明确 owner 签边界。
- deployment、retained evidence、ops notes 和长记录放在 `deploy/`。
- 根 handoff 只保留短棒；长计划和任务历史放在 `deploy/records`。

## Runtime 边界

- 前端必须通过 `.NET Control API` DTO/API wrappers 通信。
- UI 不直接访问数据库、文件系统写入、Python 脚本、model SDK、FFmpeg 或 provider credentials。
- PostgreSQL 是账号、组织、钱包/支付、项目、任务、Playground、Toolbox、provider health、outbox 和资产状态的 canonical source。
- Jobs 从 PostgreSQL-backed queues 租约执行；workers 不在内存中持有 canonical task state。
- Python 只用于显式签过的 local model/sidecar adapters。
- Payment callbacks 使用 canonical `/api/payments/callbacks/{provider}` routes 和幂等 ledger writes。
- 真实 provider secrets、production dumps、payment captures、object-storage credentials 和 retained local secrets 不进入 Git。

## 禁止恢复

- 不恢复 Jaaz iframe/runtime 作为默认生产路径。
- 不恢复 Node `core-api` 或让 Node/Express 成为控制面。
- 不恢复 Node memory/vector stores。
- 不恢复 Node payment runtime 或 legacy payment aliases。
- 不恢复 `/api/tasks/stream` 作为默认 live path。
- 生产流量不路由到 legacy Jaaz、legacy Node services、Vite dev/preview servers、Docker、Linux、Kubernetes、Windows + Celery 或 Redis Open Source on Windows。
- 不删除 `agent-studio`；它继续作为 debug/reference retained material，直到明确 owner 决定。
- 不整体导入 ChuangJingAI monolith 文件；只把行为按 XiaoLouAI owner 边界移植。

## 环境与工具

- 除非当前 owner 明确覆盖，不编辑 `.env`、Vite proxy、Caddy、IIS、Windows service scripts 或 deployment scripts。
- 不默认创建 Python sidecar/adapter。
- dependencies、runtime data、logs、uploads、generated media 和 caches 应留在项目目录或明确批准的 D 盘工具路径下。
- 不主动向 C 盘写项目 dependencies、cache、runtime data 或 generated assets；工具无法避免时先停下确认。
- verification scripts 要严格，但应区分 runtime dependencies 和 test fixtures。

## 文档与验证

- 代码、脚本、配置、runtime 或 README 变更应同步相关文档。
- 根 handoff 只记录当前 phase、immediate next owner、hard boundaries 和 validation entry。
- 新阶段需要在 `deploy/records` 中有 phase plan 和 task record；该目录默认 ignored，不要提交准备时 force-add。
- Markdown 使用 UTF-8，能用 PowerShell `Get-Content -Encoding UTF8` 读取。
- 默认前端验证：

```powershell
git status --short --branch
npm --prefix .\XIAOLOU-main run lint
npm --prefix .\XIAOLOU-main run test:unit
npm --prefix .\XIAOLOU-main run build
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\verify-frontend-legacy-dependencies.ps1 -FailOnLegacyWriteDependency
git diff --check
```

- 后端 contract touched 时运行：

```powershell
dotnet test .\backend\dotnet\control-plane\tests\XiaoLou.ControlApi.Tests\XiaoLou.ControlApi.Tests.csproj --no-restore -v:minimal
```

## README 策略

根 README 是项目公开入口，保持像产品/工程概览而不是长历史记录。不要在 feature、service、deployment、evidence 或 tooling 目录下添加小 README 来重复路线说明；详细说明放在 `docs/`、`deploy/windows/ops-runbook.md` 或 `deploy/records` 的阶段记录中。
