# XiaoLouAI 短棒交接

更新时间：2026-05-13 +08
工作目录：`D:\code\XiaoLouAI`

本文件只保留下一棒需要立刻接住的上下文。
长记录和阶段计划放在 `deploy\records`。

## 每棒先读

```powershell
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Get-Content .\XIAOLOU_REFACTOR_HANDOFF.md -Encoding UTF8
Get-Content .\deploy\records\xiaolouai-modular-migration-phase-plan.md -Encoding UTF8
Get-Content .\deploy\records\xiaolouai-modular-migration-task-record.md -Encoding UTF8
Get-Content .\deploy\records\xiaolouai-finalization-handoff.md -Encoding UTF8 -Tail 160
Get-Content .\deploy\records\xiaolouai-refactor-gap-verification.md -Encoding UTF8 -Tail 120
```

## 文档格式约束

```text
所有 handoff/docs 保持 UTF-8 Markdown。
优先短行、普通标题、普通列表和 text 代码块。
避免宽表格、超长单行、隐藏折叠格式和依赖特殊渲染的内容。
关键 owner、决策、验证入口尽量一事一行。
所有文档必须便于 PowerShell Get-Content / Select-String 阅读。
根 handoff 只写短棒；长规划和修改记录写入 deploy\records。
```

## 固定路线

```text
1. XiaoLouAI 当前模块化仍在进行，H 阶段不是全部模块化完成。
2. I 阶段目标是在迁移 ChuangJingAI 更新的同时继续模块化。
3. 不允许把 ChuangJingAI 的大块代码直接搬进当前项目。
4. 每次只迁移一个 owner 或一个窄 capability。
5. 迁移时必须先拆 owner、定契约、补验证，再搬实现。
6. 前端主线：XIAOLOU-main/src/features/<product-area>/<capability>。
7. 后端主线：backend/dotnet/control-plane。
8. 非 .NET 服务主线：backend/services/<product-area>/<capability>-sidecar。
9. 部署配置、保留材料和记录统一进入 deploy。
10. 不恢复 legacy 为生产入口。
11. 不新增 Node/Express 主控制面。
12. 不让前端重新直连 legacy、Jaaz 或临时 Node 端口。
13. Python 只允许作为明确签收的本地模型或 sidecar adapter。
14. PostgreSQL / .NET Control API / Windows-native worker 仍是后端架构主线。
```

## 继承 MiLuStudio 约束

```text
1. 必须遵守高内聚、低耦合、职责单一、关注点分离和依赖倒置。
2. UI 不能直接访问数据库、文件系统、模型 SDK、Python 脚本或 FFmpeg。
3. 前端只通过 Control API 和 DTO 通信。
4. .NET Control API 负责编排、状态、资产索引和 sidecar 调用。
5. Python sidecar / skills runtime 只负责具体生产技能执行。
6. 模型、存储、队列、FFmpeg、Windows 打包等变化点必须隔离在 adapter / service 边界。
7. 禁止循环依赖、跨层反向依赖和共享隐式全局状态。
8. 不为了架构感提前堆大型抽象；原则服务功能落地。
9. 目录优先按路由或功能域聚合，不把同一功能拆散到低信息量目录。
10. MVP 临时直连必须限制在单一 adapter / gateway 内，并写入任务记录。
11. 依赖、配置、缓存、运行数据、日志、上传素材和生成结果优先限制在 D 盘项目目录或明确 D 盘工具目录。
12. Python、Node.js、.NET、Electron、Playwright、模型缓存等不得主动写入 C 盘。
13. 如果工具无法避免写入 C 盘，先停止并记录原因，等待用户确认。
14. 每个 owner 或阶段完成后必须自主更新文档：
    先更新阶段计划，再更新任务记录，最后只把下一棒必须知道的短记录写入本 handoff。
15. 如阶段涉及外部事实或新工具版本，必须联网搜索自检；如发现方向偏差，先修正文档再继续 runtime。
```

## 禁止恢复

```text
禁止恢复 legacy deploy_aliases 到生产路径。
禁止让 tasks stream 默认开启。
禁止恢复旧支付 notify alias 为默认公开入口。
支付回调以 canonical /api/payments/callbacks/{provider} 为统一目标。
禁止恢复 legacy 为生产入口，或重新新增 live legacy source root 作为默认工作目录。
禁止把 ChuangJingAI 的 core-api 当作 XiaoLouAI 新控制面。
禁止恢复 Jaaz iframe/runtime 为主应用默认路径。
禁止删除或降级现有 CI、Vitest、xUnit、synthetic E2E 和 legacy surface gate。
禁止把 yolov8n.pt 等大权重二进制直接纳入生产源码迁移。
允许按 2026-05-13 用户确认新增 canonical .NET payment order/review contract。
该支付方向只允许进入 .NET Payments/Admin 模块，不能恢复 Node core-api 控制面或 legacy 支付入口。
```

## 当前接棒

```text
Phase: I modular-migration
Owner: I4g wallet-recharge-dotnet-contract-reopen
Status: ready, wait for explicit I4g instruction
I0: done 2026-05-13 docs/handoff calibration only
I1a: done 2026-05-13 module-progress-inventory docs only
I1b: done 2026-05-13 chuangjing-delta-owner-matrix docs only
I1c: done 2026-05-13 docs-consistency-and-contract-handoff-audit docs only
I2a: done 2026-05-13 home-nav-jaaz-remnant-inventory docs/decision only
I2a-1: done 2026-05-13 home-nav-agentstudio-route-retirement runtime slice
I2b: done 2026-05-13 assets-agent-canvas-copyword-cleanup runtime slice
I2c: done 2026-05-13 create-workbench-recent-tasks-dialog-map docs/decision only
I2d: done 2026-05-13 memory-center-route-decision docs/decision only
I2e: done 2026-05-13 route-preload-helper-decision docs/decision only
I3a: done 2026-05-13 chatpanel-current-split-closeout validation/docs only
I3b: done 2026-05-13 agent-canvas-app-orchestration helper split
I3c: done 2026-05-13 agent-canvas-chat-contract-preflight docs/decision only
I3d: done 2026-05-13 agent-canvas-3d-director-front-slice docs/decision only
I3e: done 2026-05-13 agent-canvas-local-image-edit-front-slice docs/decision only
I3f: done 2026-05-13 agent-canvas-node-overlay-tools-slice runtime slice
I3g: done 2026-05-13 agent-canvas-native-agent-catalog-slice runtime slice
I4a: done 2026-05-13 agent-canvas-chat-dotnet-contract-inventory docs/decision only
I4b: done 2026-05-13 agent-canvas-chat-nonstream-dotnet-stub-or-adapter backend stub
I4c: done 2026-05-13 agent-canvas-chat-stream-dotnet-sse backend stub SSE
I4d: done 2026-05-13 local-image-edit-dotnet-route-contract backend unavailable stub
I4e: done 2026-05-13 projects-endpoints-canvas-agent-split-plan docs/decision only
I4f: done 2026-05-13 permission-matrix-and-route-policy-update tests/matrix only
Goal: 在继续 XiaoLouAI 模块化的同时，按 owner 迁移 ChuangJingAI 的可取更新。
```

I0 已完成：

- 根 handoff 改为 MiLuStudio 式短棒交接。
- 新增 I 阶段计划：`deploy\records\xiaolouai-modular-migration-phase-plan.md`。
- 新增 I 阶段任务记录：`deploy\records\xiaolouai-modular-migration-task-record.md`。
- 明确 H 阶段不代表全部模块化完成。
- 明确 I 阶段必须“迁移即模块化”，禁止大块搬运。
- 明确继承 MiLuStudio 的设计、环境、阶段结束和文档约束。

I1a 已完成：

- 复核当前未提交 ChatPanel 模块化工作。
- 复核当前 frontend feature roots、空 pages/components、lib/api 残留。
- 复核 backend .NET Modules 大文件和 agent-canvas 契约缺口。
- 复核 ChuangJingAI 增量集中在 agent-canvas/canvas、Node core-api、
  studio_ai 和 video-replace-service。
- 细化 I 阶段为 I1b/I2a/I2b/I3a 等小 owner，避免大块任务漂移。

I1b/I1c 已完成：

- I1b 已产出 ChuangJingAI 到 XiaoLouAI owner 的迁移矩阵。
- I1b 已记录账户/管理中心/支付重叠修改区。
- 用户确认：账户设置和管理中心保留 XiaoLouAI baseline。
- 用户确认：支付按 ChuangJingAI 产品/交互方向走。
- 支付实现必须补 `.NET Control API` Payments/Admin contract。
- 不恢复 Node `core-api`、legacy payment alias、旧 admin route owner 或 Jaaz runtime。
- I1c 已复核短棒、阶段计划、任务记录、cutover 和历史 docs 路径说明。

当前本地注意事项：

- I3d 开始时 `git status --short --branch` 显示 `main...origin/main`，
  仅根 handoff 既有 modified。
- I3d 开始时 ChatPanel components、runtime `App.tsx` 和
  `appOrchestration.ts` 均无 dirty 输出。
- I3d 未改 runtime/backend；当前只更新根 handoff 和 `deploy\records`
  决策记录。
- ChatPanel 模块化拆分已经进入 tracked clean baseline；不是未提交脏树。
- 下一棒处理 agent-canvas 时仍必须保护现有 ChatPanel/App baseline，不要回滚或大块重写。
- I3d 决策：3D Director 暂不做 runtime；ChuangJingAI 方案跨
  R3F/Drei workbench、NodeType/NodeData、node defaults、NodeContent、
  CanvasNode/ConnectionsLayer、geometry、toolbar、context menu、App guards
  和 env/permission gate。
- XiaoLouAI 已有 R3F/Drei/three 依赖，但没有 3D Director node surface；
  后续必须显式开小 slice，且不得顺手改 env/proxy/Caddy/scripts。
- `deploy\records` 是 checkout-local 记录区，当前按 .gitignore 不进入 GitHub。
- 当前 `src/pages` 和 `src/components` 没有文件，但这只说明旧入口清理完成。
- 当前 `src/lib`、`src/lib/api`、agent-canvas runtime、canvas runtime、
  create-video、Assets、Layout、ProjectEndpoints 等仍是模块化后续重点。
- `/create/agent-studio` route/nav/home keepalive 已退役。
- `assets-media-projects` 已清理 `/create/agent-studio` helpers/buttons、
  Jaaz/AgentStudio 文案、`jaaz-prefetch` key 和 retired sync event listener。
- 当前 Jaaz env、Vite proxy、Caddy/scripts 和 `agent-studio` 目录残留
  仍需单独 cleanup owner；不要混进 I3e。
- 当前 `docs\*.md` 历史引用是旧路径；当前记录根目录是 `deploy\records`。
- `deploy\records` 里的历史记录可保留旧路径文字，但新工作必须写当前路径。
- 支付 runtime 不能在 I2 直接开写；先走 I4g/I4h .NET contract owner。

I2a 已完成：

- 已读取本 handoff、phase plan、task record。
- 已确认 `git status --short --branch`。
- 当前 dirty tree 仍包含 ChatPanel 模块化现场：
  `ChatPanel.tsx` tracked 修改，以及大量 `ChatPanel*` / `useChatPanel*`
  未跟踪拆分文件。
- I2a 未改 runtime code。
- XiaoLouAI 当前 home/nav/layout 仍有 `/create/agent-studio` route、
  `JaazAgentCanvasEmbed` lazy import、route prefetch、导航项、保活挂载、
  `ensureJaazServices` keepalive、iframe-style postMessage 同步桥。
- ChuangJingAI 当前 home/nav 主入口只有 `/create/canvas` 和
  `/create/agent-canvas`，没有 `/create/agent-studio` 和 Jaaz keepalive。
- `.env*`、Vite `/jaaz*` proxy、Caddy/script、`agent-studio` 目录删除
  都不属于下一棒第一刀。
- 已按用户澄清补充检查：
  ChuangJingAI 自己存在但自己当前主线未使用的内容默认不迁移。
- ChuangJingAI self-unused / reject：
  `jaaz/`、`studio_ai/`、`scripts/openwebui*`、
  `XIAOLOU-main/API MODEL LIST.txt`、`XIAOLOU-main/metadata.json`、
  未注册路由的 `XIAOLOU-main/src/pages/Register.tsx`。
- ChuangJingAI 自己确实使用但仍不能直接迁移：
  `core-api/`、`video-replace-service/`、`caddy/`、
  `AdminLogin.tsx`、`AdminOrders.tsx`。
  这些只能作为 owner/contract 参考，不可大块搬运。

I2a-1 已完成：

- 已读取本 handoff、phase plan、task record。
- 已确认 `git status --short --branch` 和 ChatPanel dirty tree。
- 已保护 ChatPanel 模块化现场；未编辑任何 ChatPanel 文件。
- Runtime 只 touch：
  `XIAOLOU-main/src/App.tsx` 和
  `XIAOLOU-main/src/features/home/nav-layout/Layout.tsx`。
- 已移除 `/create/agent-studio` child route placeholder。
- 已移除 AgentStudio lazy import、route prefetch、route predicate、
  mount state、hidden mount block 和 home/nav nav item。
- 已移除 home/nav 中的 `ensureJaazServices` keepalive。
- 已移除 Layout iframe-style postMessage asset/project sync。
- 没有新增 .NET Control API contract。
- 没有新增 Python sidecar 或 adapter。
- 验证通过：
  `npm --prefix .\XIAOLOU-main run build`，
  `npm --prefix .\XIAOLOU-main run test:unit`，
  scoped `git diff --check`。

I2b 已完成：

- 已读取本 handoff、phase plan、task record。
- 已确认 `git status --short --branch` 和 ChatPanel dirty tree。
- 已保护 ChatPanel 模块化现场；未编辑任何 ChatPanel 文件。
- Runtime 只 touch：
  `XIAOLOU-main/src/features/assets-media-projects/assets/Assets.tsx` 和
  `XIAOLOU-main/src/features/assets-media-projects/asset-sync/AssetSyncControls.tsx`。
- 已移除 Assets 中的 `/create/agent-studio` helper/button。
- 已移除 `xiaolou:jaaz-prefetch:*` sessionStorage key 使用。
- 已移除 Assets 中 retired `xiaolou:agent-*` sync event listener。
- 已把 visible copy 从 Jaaz/AgentStudio/智能体画布收口为：
  `智能画布` 和 `历史智能画布工程`。
- 保留 `agent_studio` sourceModule key 作为持久化数据兼容字段。
- 没有新增 .NET Control API contract。
- 没有新增 Python sidecar 或 adapter。
- 验证通过：
  `npm --prefix .\XIAOLOU-main run build`，
  `npm --prefix .\XIAOLOU-main run test:unit`，
  `git diff --check`。
- `assets-media-projects` 残留扫描已无 Jaaz / AgentStudio / agent-studio /
  `/create/agent-studio` / `jaaz-prefetch` / `xiaolou:agent-*` 命中。
- 全 src 相关残留只剩 `agent-studio/JaazAgentCanvasEmbed.tsx` 自身，
  留给后续显式 cleanup owner。

I2c 已完成：

- 已读取本 handoff、phase plan、task record。
- 已确认 `git status --short --branch` 和 ChatPanel dirty tree。
- 已保护 ChatPanel 模块化现场；未编辑任何 ChatPanel 文件。
- 未改 runtime code。
- 已对比 ChuangJingAI：
  `components/create/RecentTaskDetailsDialog.tsx`、
  `RecentTasksFullscreenDialog.tsx`、`lib/task-status.ts`、
  `pages/create/ImageCreate.tsx`、`pages/create/VideoCreate.tsx`。
- 已对照 XiaoLouAI：
  `create-workbench/studio-layout`、`create-image/image-create`、
  `create-video/video-create`、`lib/api/jobs-*` 和 `.NET /api/jobs`。
- Owner map 结论：
  recent task details/fullscreen dialog 归
  `features/create-workbench/recent-tasks`，由 `create-image` 和
  `create-video` 逐页消费。
- I2c 不做 runtime patch：
  当前 adopt 会跨 create-workbench/create-image/create-video/shared
  task-status/.NET jobs contract。
- 新 I4 gap：
  `I4i task-history-dotnet-contract`。
- Contract needs：
  jobs list 需要 `limit/offset/types` 或等价多类型过滤；
  job detail 需要结构化 failure/provider 字段或明确 metadata projection。
- Python sidecar / adapter：
  不需要。
- Forbidden kept：
  不恢复 Jaaz、Node core-api、`/api/tasks/stream` 默认、支付 runtime、
  大目录复制、测试删除或大二进制。

I2d 已完成：

- 已读取本 handoff、phase plan、task record。
- 已确认 `git status --short` 和 ChatPanel dirty tree。
- 已保护 ChatPanel 模块化现场；未编辑任何 ChatPanel 文件。
- 未改 runtime code。
- 已对比 ChuangJingAI：
  `pages/MemoryCenter.tsx`、`pages/Playground.tsx`、
  `lib/api.ts` playground memory APIs、
  `core-api/src/routes.js`、`playground-memory-vectors.js` 和
  `007_playground_memory_vectors.sql`。
- 已对照 XiaoLouAI：
  `features/playground/Playground.tsx`、
  `features/playground/api/playground.ts`、
  `lib/api/playground-*`、
  `.NET PlaygroundEndpoints.cs` 和 `PostgresPlaygroundStore.cs`。
- Route / owner 结论：
  未来 MemoryCenter 可采用独立 `/memory` 产品路由，但实现必须归
  `features/playground/memory-center`；`home/nav-layout` 只做 route/nav
  consumer。
- I2d 不做 runtime patch：
  当前独立 MemoryCenter 会暴露 vector-index、recall-test、create
  semantics、permission 和分页/filtering 缺口。
- 新 I4 gap：
  `I4j playground-memory-dotnet-contract`。
- Contract needs：
  memory create/upsert 语义、vector schema/index、embedding provider
  adapter、recall fallback、owner-scope permission、pagination/filtering 和
  chat memory extraction/recall injection 边界。
- Python sidecar / adapter：
  默认不需要；如接受 vector recall，也应先走 .NET-owned embedding/provider
  adapter。
- Forbidden kept：
  不恢复 Jaaz、Node core-api、`/api/tasks/stream` 默认、支付 runtime、
  不导入 Node memory/vector stores、不改 env/proxy/Caddy/scripts、
  不删除 `agent-studio`。

I2e 已完成：

- 已读取本 handoff、phase plan、task record。
- 已确认 `git status --short --branch` 和 ChatPanel dirty tree。
- 已保护 ChatPanel 模块化现场；未编辑任何 ChatPanel 文件。
- 未改 runtime code。
- 已对比 ChuangJingAI：
  `src/lib/route-preload.ts` 只缓存 `pages/Playground` dynamic import；
  `components/Layout.tsx` 通过 `lazy(loadPlaygroundPage)` 挂载 hidden
  Playground shell，并在 home route 预热后延迟 160ms 首次 mount；
  `pages/Home.tsx` 在 prompt-to-playground transition 前调用
  `preloadPlaygroundPage()`。
- 已对照 XiaoLouAI：
  当前没有 route-preload helper；`src/App.tsx` 直接
  `lazy(() => import("./features/playground/Playground"))` 并用
  `DeferredRoute` 渲染 `/playground/*`；`home/nav-layout/Layout.tsx`
  仅对 canvas/agent-canvas 做当前 route shell 挂载。
- Owner 结论：
  route-preload helper 的消费入口归 `features/home/nav-layout`；
  Playground loader 的真实模块边界归 `features/playground`。
- I2e 不做 runtime patch：
  最小复刻也会同时跨 `home/nav-layout`、`playground` 和 App route tree，
  并触碰当前已 dirty 的 `App.tsx` / `Layout.tsx`；同时 ChuangJingAI
  行为包含 hidden Playground keepalive，应先签 owner 决策再写。
- 后续窄 slice 如被明确要求：
  可在 `features/home/nav-layout` 内新增 route-preload helper，和
  `features/playground` 共享 Playground loader；不得顺手修改 canvas、
  agent-canvas keepalive 或恢复 Jaaz/Node/task-stream 行为。
- Python sidecar / adapter：不需要。

I3a 已完成：

- 已读取本 handoff、phase plan、task record。
- 已确认 `git status --short --branch`：
  `main...origin/main [ahead 1]`，无 dirty 输出。
- 已确认 ChatPanel 路径下没有 tracked/untracked dirty 输出。
- 当前 ChatPanel split 文件已经全部 tracked；盘点到 52 个
  `ChatPanel*` / `chatPanel*` / `useChatPanel*` 文件。
- `ChatPanel.tsx` 当前是 1001 行的编排 shell，使用拆出的 composer、
  header、message list、menus、media attachments、model/video hooks 等。
- 未发现 import/export/type/build 断点；未改 runtime code。
- 验证通过：
  `npm --prefix .\XIAOLOU-main run build`，
  `npm --prefix .\XIAOLOU-main run test:unit`
  （19 files / 122 tests）。
- Focused tests 决策：
  I3a 未改 runtime，且全量 unit suite 通过，本轮不新增 ChatPanel tests。
- Baseline 结论：
  当前 ChatPanel 可作为后续 ChuangJingAI agent-canvas 迁移基线；后续迁移
  应继续小 slice，不要把 ChatPanel 重新合并成大文件。
- Python sidecar / adapter：不需要。

I3b 已完成：

- 已读取本 handoff、phase plan、task record。
- 已确认 git status 和 ChatPanel baseline：ChatPanel components 路径无 dirty。
- 已对照 ChuangJingAI `src/agent-canvas/App.tsx`：
  源文件约 8794 行，混有 AgentProjectHub、local image edit、ImageAnnotation、
  vector trace、shape drawing、mockup rotation、3D Director gating 和 native pan。
- 已盘点 XiaoLouAI `agent-canvas/runtime/App.tsx`：
  原 4002 行，仍集中承担 runtime config、host/draft hydration、generation
  access、project asset sync、media drop/paste、viewport safety、agent actions
  和 render composition。
- Split 决策：
  本轮只做 app orchestration helper split，不采纳 ChuangJingAI 的越界能力。
- Runtime 只 touch：
  `agent-canvas/runtime/App.tsx` 和新增
  `agent-canvas/runtime/appOrchestration.ts`。
- 已搬出纯 helper：
  URL/base64、drag/drop media import、editable target 判断、draft/title
  helpers、viewport safe-bounds、generation permission/credit 文案、project
  asset sync draft builder。
- 未触碰：
  ChatPanel baseline、agent action parsing/chat contract、3D Director、local
  image edit、node overlay tools、native agent catalog、canvas runtime、
  backend contracts、Jaaz/Node/env/proxy/Caddy/scripts/payment/I4j。
- 验证通过：
  `npm --prefix .\XIAOLOU-main run build`，
  `npm --prefix .\XIAOLOU-main run test:unit`
  （19 files / 122 tests），`git diff --check`。
- Python sidecar / adapter：不需要。

I3c 已完成：

- 已读取本 handoff、phase plan、task record。
- 已确认 git status：`main...origin/main`；ChatPanel baseline 无 dirty。
- 未改 runtime/backend。
- 已对照 XiaoLouAI：
  `ChatPanel.tsx` split shell、`useChatAgent.ts`、
  `runtime/App.tsx` ChatPanel 调用点、`useWorkflow` agentContext 持久化、
  `.NET /api/agent-canvas/projects`。
- 已对照 ChuangJingAI：
  `src/agent-canvas/hooks/useChatAgent.ts`、
  `src/agent-canvas/components/ChatPanel.tsx`、
  `src/agent-canvas/App.tsx`。
- 结论：
  XiaoLouAI 前端已有 `/api/agent-canvas/chat` 和
  `/api/agent-canvas/chat/stream` client / SSE parser，但 .NET Control API
  目前只有 `/api/agent-canvas/projects` CRUD 与 raw `agentContext` 存取；
  没有 chat/stream route、DTO、permission mapping 或 advisory/test。
- ChuangJingAI AgentProjectHub / marker-scoped chat / generated media preview
  会跨 chat contract、project persistence、wallet permission、marker/canvas
  runtime 和 generated media owner。
- Owner 决策：
  I3c 不做 runtime patch；ChatPanel/useChatAgent 保持 frontend owner，
  chat/stream 先进入 I4a/I4c/I4f，AgentProjectHub 等 project/wallet/nav owner
  签收后再做 UI slice。
- I4 gap：
  `I4a agent-canvas-chat-dotnet-contract-inventory` 需签 request/response/action
  DTO；`I4c` 需签 SSE event contract；`I4f` 需签权限矩阵；
  `I4e` 如需补 project library/save/delete 契约再接；I4j memory/vector/recall
  未修改。
- 验证：
  runtime/backend 未改，未跑 build/test；记录更新后以 `git diff --check`
  为本轮 gate。
- Python sidecar / adapter：不需要。

I3d 已完成：

- 已读取本 handoff、phase plan、task record。
- 已确认 git status 和 ChatPanel/App orchestration baseline。
- 未改 runtime/backend。
- ChuangJingAI 3D Director 是 R3F/Drei/three 前端工作台，接线跨
  `components/3d-director`、`types.ts`、`runtimeConfig.ts`、Node defaults、
  NodeContent、CanvasNode、ConnectionsLayer、nodeGeometry、CanvasToolbar、
  ContextMenu 和 App guards。
- XiaoLouAI 已有 three 依赖，但没有 `DIRECTOR_3D` node surface。
- 决策：
  I3d 不做 runtime；3D Director front owner 归
  `canvas-agent-canvas/agent-canvas/runtime`，workbench 归
  `runtime/components/3d-director`。
- gap：
  env/config gate 留给后续显式 slice 或 I6；账号/角色 permission 留给 I4f。
- Python sidecar / adapter：不需要。

I3e 已完成：

- 已读取本 handoff、phase plan、task record。
- 已确认 git status 和 ChatPanel/App orchestration baseline。
- 未改 runtime/backend。
- ChuangJingAI local image edit 前端分两层：
  ImageEditorModal 的 remove-background、smart erase/inpaint、OCR；
  以及 image-node floating toolbar/overlays 的 eraser、move-object、
  editText/editElements 等工具。
- ChuangJingAI `localImageEditService.ts` 依赖
  `/api/canvas/local-image-edit/*`，并最终指向 video-replace-service 的
  Python/model 命令。
- XiaoLouAI 当前已有 ImageEditorModal、imageEditor hooks、editor fields 和
  canvasPersistence data/blob URL 防护，但没有 localImageEdit service、
  modal 本地编辑 controls、App execution handlers 或 image-node overlay 文件。
- 决策：
  I3e 不做 runtime；modal-level front owner 保持在 ImageEditorModal /
  imageEditor hooks；typed `localImageEditService.ts` 等 I4d 签 .NET route/DTO
  后再加；node overlay tools 归 I3f。
- gap：
  I4d 签 local-image-edit route/DTO/error/media/auth/sync-job 契约；
  I5b 签 local-image-edit sidecar/adapter、weights/cache/GPU/CPU/capability
  契约；如需权限或额度 gate 再进 I4f。
- Python sidecar / adapter：I3e 不创建，后续 I5b 决策。

I3f 已完成：

- 已读取本 handoff、phase plan、task record。
- 已确认 git status 和 ChatPanel/App orchestration baseline。
- Runtime 只 touch：
  `agent-canvas/runtime/components/canvas/ImageNodeFloatingToolbar.tsx`。
- 未改 App execution handlers、CanvasNode overlay props、ImageEditorModal、
  backend、sidecar、env/proxy/Caddy/scripts。
- 已对照 ChuangJingAI：
  image-node tools 跨 ImageNodeFloatingToolbar、Eraser/MoveObject/TextEdit/
  Expand overlays、CanvasNode props、App active/apply state、localImageEditService
  和 upload/output-node 创建。
- XiaoLouAI 当前 CanvasNode 已有 optional `onImageNodeToolbarAction` prop，
  但 App 不传 handler；toolbar 之前有一批未签 owner 的可见动作。
- 决策：
  I3f 不导入 overlay 文件，不接 App 执行链；overlay UI 归后续
  `agent-canvas/runtime/components/canvas` 明确 slice，执行链等 I4d/I5b。
- 最小 frontend slice：
  在 ImageNodeFloatingToolbar 内加入 contract-gated action reasons；
  将 remove-background、upscale、eraser、edit-elements、edit-text、
  move-object、expand、adjust、vector、flip/rotate、mockup 等未签契约动作
  置为 disabled；保留 quick edit、multi-angle、project sync、download 和
  crop。
- `more:crop` 已回落到现有 ImageEditorModal，不新增 overlay/backend。
- gap：
  local-image-edit 执行继续归 I4d .NET route/DTO 和 I5b sidecar/adapter；
  mockup/vector/adjust/flip-rotate 需要后续 frontend field/runtime owner；
  如需权限或额度 gate 再进 I4f。
- 验证通过：
  `npm --prefix .\XIAOLOU-main run build`，
  `npm --prefix .\XIAOLOU-main run test:unit`
  （19 files / 122 tests），`git diff --check`
  （仅 Git LF/CRLF working-copy warning）。
- Python sidecar / adapter：I3f 不创建，后续 I5b 决策。

I3g 已完成：

- 先确认 git status：
  当前仍保留 I3f 的 `ImageNodeFloatingToolbar.tsx` 和 root handoff 变更；
  ChuangJingAI 参照仓库干净。
- ChatPanel / App baseline：
  XiaoLouAI 当前使用 split ChatPanel、`useChatPanelModelCatalog`、
  `ChatPanelSkillsMenu`、composer toolbar/actions 和静态
  `nativeAgentCatalog.ts`；App 已有 `generate_image` action 解析。
- 对照 ChuangJingAI：
  static native agent model/tool catalog 已基本在 XiaoLouAI 存在；
  ChuangJingAI 的 `storyboard-breakdown` 会走 Storyboard Manager/Image
  占位和 connect_nodes，I3g 未采用；
  ChuangJingAI 的 `script-grid-image` 是可做的静态 Skill。
- 最小 frontend slice：
  在 `agentCanvasSkills.ts` 新增 `script-grid-image` /
  “剧本拆解生成多宫格”。
  它要求用户明确宫格数和剧本正文；缺失时 actions 为空；完整时只允许
  复用现有一个 `generate_image` action，1:1、2K、count/batchCount=1。
- 未改：
  ChatPanel baseline、App handler、backend contract、Python sidecar/adapter、
  local image edit、node overlays、3D Director、memory/recall、payment、
  `.env`、vite proxy、Caddy、scripts、Jaaz/Node core-api。
- gap：
  I4a 仍需签 agent-canvas chat DTO/action schema/skill fields；
  I4f 负责权限/account/provider-scoped catalog；
  marker-scoped chat options 仍属于 I4a gap。
- 验证通过：
  `npm --prefix .\XIAOLOU-main run build`，
  `npm --prefix .\XIAOLOU-main run test:unit`
  （19 files / 122 tests），`git diff --check`
  （仅 Git LF/CRLF working-copy warning）。

I4a 已完成：

- 已读取本 handoff、phase plan、task record。
- 已确认 git status：
  `main...origin/main`，保留 I3f `ImageNodeFloatingToolbar.tsx`、
  I3g `agentCanvasSkills.ts` 和 root handoff 变更。
- 已确认 frontend chat caller：
  `useChatAgent.ts` 先 POST `/api/agent-canvas/chat/stream`，
  pre-event stream failure 才 fallback 到 POST `/api/agent-canvas/chat`；
  `useChatPanelSendMessage.ts` 传 model/tool pool、skill、canvas files、
  webSearch、instruction 和 attachments。
- 已确认 .NET baseline：
  当前只有 `/api/agent-canvas/projects` CRUD；
  `CanvasProjectRequest.AgentContext` 是 raw `JsonElement` persistence；
  没有 `/api/agent-canvas/chat` 或 `/api/agent-canvas/chat/stream` route/DTO。
- 已确认 `ClientRoutePolicy` baseline：
  只把 `/api/agent-canvas/projects` 纳入 public client API 和
  `canvas:read/write`；chat/stream 尚无权限映射。
- I4a contract decision：
  chat route owner 归 `.NET Control API` 的 Agent Canvas chat contract；
  I4b 只处理 non-stream `/api/agent-canvas/chat`，stream 归 I4c；
  最小权限建议先用 `canvas:write`，I4f 再细化矩阵。
- I4a gap：
  provider adapter、SSE stream runtime、generated media preview projection、
  local image edit execution、node overlays、3D Director、memory/recall、
  payment、env/proxy/Caddy/scripts 均未进入本轮。
- 验证：
  文档/契约盘点 only；未跑 build/test；记录更新后以 `git diff --check`
  为 gate。

I4b 已完成：

- 已读取本 handoff、phase plan、task record 和 I4a inventory。
- 已确认 git status、frontend chat caller、.NET route 和
  ClientRoutePolicy baseline。
- Backend runtime touch：
  新增 `Modules/AgentCanvas/AgentCanvasChatEndpoints.cs`；
  `Program.cs` 注册 `MapAgentCanvasChatEndpoints()`；
  `ControlPlaneContracts.cs` 新增 Agent Canvas chat request/response DTO；
  `ClientRoutePolicy.cs` exact `/api/agent-canvas/chat` 映射到
  `canvas:write`。
- `POST /api/agent-canvas/chat` 已实现 contract-stub：
  返回 `{ success:true, data }`、空 `actions`、`AGENT_CANVAS_CHAT_STUB`
  warning、`provider=contract-stub`、回显 model/session/topic。
- blank `message` 返回 400：
  `{ success:false, error:{ code, message } }`，前端可读
  `payload.error.message`。
- `/api/agent-canvas/chat/stream` 仍未注册、未纳入 policy、未实现 SSE；
  继续归 I4c。
- 未改：
  frontend ChatPanel/App、provider adapter、Python sidecar、local image edit、
  node overlays、3D Director、memory/recall、payment、env/proxy/Caddy/scripts、
  Jaaz/Node core-api。
- 验证通过：
  `dotnet build .\backend\dotnet\control-plane\src\XiaoLou.ControlApi\XiaoLou.ControlApi.csproj --no-restore -v:minimal`；
  `dotnet test .\backend\dotnet\control-plane\tests\XiaoLou.ControlApi.Tests\XiaoLou.ControlApi.Tests.csproj --no-restore -v:minimal`
  （292 tests）。

I4c 已完成：

- 已读取本 handoff、phase plan、task record、I4a inventory 和 I4b stub record。
- 已确认 git status、frontend stream caller、non-stream fallback route、
  .NET route 和 ClientRoutePolicy baseline。
- Backend runtime touch：
  `AgentCanvasChatEndpoints.cs`、`ClientRoutePolicy.cs` 和相关 xUnit tests。
- `POST /api/agent-canvas/chat/stream` 已实现 contract-stub SSE：
  有效 message 才发送 `ready/status/result/done`；
  空 message 返回 400 JSON，且不写任何 SSE event，保留前端 pre-event
  fallback 语义。
- stub stream 复用 I4b response shape：
  空 `actions`、`AGENT_CANVAS_CHAT_STUB` warning、`provider=contract-stub`、
  回显 model/session/topic；不生成真实 provider/media/runtime actions。
- `ClientRoutePolicy` 只 exact-map `/api/agent-canvas/chat/stream` 到
  public client API 和 `canvas:write`；permission matrix 细化仍归 I4f。
- 未改：
  frontend ChatPanel/App、provider adapter、Python sidecar、local image edit、
  node overlays、3D Director、memory/recall、payment、env/proxy/Caddy/scripts、
  Jaaz/Node core-api。
- 验证通过：
  `dotnet build .\backend\dotnet\control-plane\src\XiaoLou.ControlApi\XiaoLou.ControlApi.csproj --no-restore -v:minimal`；
  `dotnet test .\backend\dotnet\control-plane\tests\XiaoLou.ControlApi.Tests\XiaoLou.ControlApi.Tests.csproj --no-restore -v:minimal`
  （296 tests）。

I4d 已完成：

- 已读取本 handoff、phase plan、task record、I3e local image edit 记录和
  I3f overlay/tools 记录。
- 已确认 git status、当前 ImageEditorModal / imageEditor hooks /
  ImageNodeFloatingToolbar gates、.NET routes 和 ClientRoutePolicy baseline。
- 已对照 ChuangJingAI `localImageEditService.ts`、
  `core-api/src/local-image-edit-native.js` 和 video-replace-service
  `image_edit_cli.py` 参考能力。
- Backend runtime touch：
  `ControlPlaneContracts.cs`、`AgentCanvasLocalImageEditEndpoints.cs`、
  `Program.cs`、`ClientRoutePolicy.cs` 和相关 xUnit tests。
- 已签 canonical route prefix：
  `/api/canvas/local-image-edit`。
- 已注册：
  `GET /api/canvas/local-image-edit/health`；
  `POST /remove-background`、`/upscale`、`/segment-mask`、`/inpaint`、
  `/move-object`、`/ocr`、`/multi-angle`。
- DTO：
  `LocalImageEditRequest : AccountScope` 覆盖 imageUrl/dataUrl/maskDataUrl、
  projectId/nodeId 和 ChuangJingAI caller 的 upscale、inpaint、move-object、
  OCR/multi-angle 参数。
- Contract behavior：
  health 返回 `available=false` contract-stub；
  invalid input 返回 400 `LOCAL_IMAGE_EDIT_INVALID_REQUEST`；
  合法 POST 返回 503 `LOCAL_IMAGE_EDIT_UNAVAILABLE`，不返回 resultUrl/jobId，
  不生成 media/provider/runtime actions。
- Auth/policy：
  POST 执行 account scope 授权；
  `ClientRoutePolicy` 只窄映射 `/api/canvas/local-image-edit`，
  GET=`canvas:read`，non-GET=`canvas:write`；permission matrix 细化仍归 I4f。
- 未签/未做：
  `/api/local-image-edit` alias、`human-25d`、真实图像编辑、media 写入、
  sync job execution、Python sidecar/adapter、Node core-api、frontend modal/
  overlay/App wiring、3D Director、memory/recall、payment、env/proxy/Caddy/scripts。
- 验证通过：
  `dotnet test backend/dotnet/control-plane/tests/XiaoLou.ControlApi.Tests/XiaoLou.ControlApi.Tests.csproj`
  （316 tests）。

I4e 已完成：

- 已读取本 handoff、phase plan、task record。
- 已确认 git status、当前 AgentProjectHub / project save-open-delete caller、
  `.NET` Projects/AgentCanvas project route 和 ClientRoutePolicy baseline。
- ChuangJingAI `AgentProjectHub` 是 ChatPanel 导出的浮动项目菜单，
  显示 wallet balance，并调用新建、保存、项目管理、返回首页和删除当前项目。
- XiaoLouAI 当前没有 `AgentProjectHub` 组件；`TopBar` 已有同类项目动作。
- XiaoLouAI `AgentCanvasCreate` 已通过 `listAgentCanvasProjects`、
  `getAgentCanvasProject`、`saveAgentCanvasProject` 和
  `deleteAgentCanvasProject` 消费 `/api/agent-canvas/projects`。
- `.NET` 已有 canonical agent-canvas project CRUD：
  `GET/POST /api/agent-canvas/projects`，
  `GET/PUT/DELETE /api/agent-canvas/projects/{projectId}`。
- `agent_canvas_projects` 独立存储 `canvas_data`、`agent_context`、
  `thumbnail_url`、`created_at` 和 `updated_at`。
- `ClientRoutePolicy` 当前把 `/api/agent-canvas/projects` 映射为
  GET=`canvas:read`、non-GET=`canvas:write`；细分权限仍归 I4f。
- Owner 决策：
  AgentProjectHub save/open/delete 已由现有 project CRUD 覆盖；
  I4e 不新增 route/DTO，不拆 runtime backend。
- ProjectEndpoints split 决策：
  未来如要拆，应单独把 agent-canvas project routes 机械移动到
  `Modules\AgentCanvas\AgentCanvasProjectEndpoints.cs` 或同等小模块，
  保持 route、DTO、store、policy 和 tests 不变。
- Gap：
  frontend 已发送 `expectedUpdatedAt` / `baseTitle` / `baseCanvasData`，
  但 `.NET CanvasProjectRequest` 和 store 当前未签服务端 optimistic
  concurrency；如需真实保存冲突保护，后续单独开 project-concurrency owner。
- 未改：
  runtime/backend、ChatPanel、local-image-edit、payment、memory/recall、
  3D Director、sidecar、env/proxy/Caddy/scripts、Jaaz/Node core-api。
- 验证：
  `git diff --check` 通过，仅有既有 Git LF/CRLF working-copy warnings。

I4f 已完成：

- 已读取本 handoff、phase plan、task record、I4a/I4b/I4c/I4d contract
  记录和 I4e AgentProjectHub inventory。
- 已确认 git status、当前 ClientRoutePolicy/AuthHelpers tests baseline。
- `ClientRoutePolicy` 代码已符合 signed route matrix，本轮未扩 runtime
  route，也未改 ChatPanel / local-image-edit execution / payment / memory。
- Matrix 决策：
  `/api/agent-canvas/projects` GET=`canvas:read`、non-GET=`canvas:write`；
  project list/write 继续走 owner scope，detail 继续走 row ownership。
- Matrix 决策：
  `POST /api/agent-canvas/chat` 和 `/api/agent-canvas/chat/stream`
  继续 `canvas:write`；当前 contract stub 无 provider/media/runtime side
  effects，后续真实 project/provider execution 必须单独补 account scope。
- Matrix 决策：
  `GET /api/canvas/local-image-edit/health`=`canvas:read`；
  signed POST operations=`canvas:write` 并沿用 `LocalImageEditRequest`
  account scope；`/api/local-image-edit` alias 仍未签。
- Matrix 决策：
  AgentProjectHub wallet balance 只可读 existing wallet routes：
  `/api/wallet`、`/api/wallets`、`/api/wallets/{walletId}/ledger`、
  `/api/wallet/usage-stats`，均为 `wallet:read`；wallet/payment writes
  留给 I4g/I4h。
- Tests：
  `AuthHelpersTests.cs` 补 project CRUD、chat/stream、local-image-edit、
  wallet read 和 unsigned/write denial coverage。
- 验证通过：
  `dotnet test ... --filter FullyQualifiedName~AuthHelpersTests`
  （195 tests）；
  `dotnet test ...XiaoLou.ControlApi.Tests.csproj --no-restore -v:minimal`
  （351 tests）。

## 下一棒任务

```text
I4g wallet-recharge-dotnet-contract-reopen

只有用户明确要求继续 I4g 时才执行。
先读本 handoff、phase plan、task record、I4f matrix 记录、
I1b/I1c payment/account-billing 记录和当前 Payments module。
先确认 git status、当前 wallet/payment route tests baseline。
目标以 phase plan/task record 为准：盘点 retired wallet recharge 前端调用
和 `.NET` PaymentEndpoints baseline，签最小 wallet recharge .NET contract：
`/api/wallet/recharge-capabilities`、
`/api/wallet/recharge-orders`、
`/api/wallet/recharge-orders/{orderId}`、
`/api/wallet/recharge-orders/{orderId}/refresh-status`、
`/api/wallet/recharge-orders/{orderId}/bank-transfer-proof`、
`/api/wallet/recharge-orders/{orderId}/confirm`。
必须明确 account scope、permission、ledger idempotency 和 callback safety。
I4g 不做 admin order review；admin review 留给 I4h。

不得回滚或大块重写 ChatPanel baseline。
不得恢复 Jaaz iframe/runtime 或 Node core-api。
不得删除 agent-studio 目录。
不得编辑 .env、vite proxy、Caddy、scripts。
不得恢复 /api/tasks/stream 默认开启。
不得导入 Node memory/vector stores。
不得恢复 Node 支付 runtime；支付必须保持 .NET Payments/Admin owner。
不得修改 I4j memory/vector/recall 后端 contract。
默认不创建 Python sidecar 或 adapter。
完成后自主更新 phase plan、task record 和本短棒。
```

## 验证入口

```powershell
git status --short --branch
npm --prefix .\XIAOLOU-main run build
npm --prefix .\XIAOLOU-main run test:unit
dotnet build .\backend\dotnet\control-plane\src\XiaoLou.ControlApi\XiaoLou.ControlApi.csproj --no-restore -v:minimal
dotnet test .\backend\dotnet\control-plane\tests\XiaoLou.ControlApi.Tests\XiaoLou.ControlApi.Tests.csproj --no-build -v:minimal
.\scripts\windows\verify-final-legacy-surface.ps1 -LegacySurfaceManifestPath .\deploy\retained\legacy-surface-evidence\final-legacy-surface-manifest-g11k.json
git diff --check
```
