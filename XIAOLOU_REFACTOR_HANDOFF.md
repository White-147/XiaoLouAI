# XiaoLouAI 短棒交接

更新时间：2026-05-14 +08
工作目录：`D:\code\XiaoLouAI`

本文件只保留当前接棒必须知道的上下文。旧阶段任务细节不写在短棒内；需要追溯时查 README 和 `deploy\records`。

## 当前接棒

```text
Phase: L frontend-design-constraint-governance
Owner: L18 frontend-design-constraint-governance-closeout completed
Status: phase closeout complete; wait for explicit single owner selection
Goal: future frontend work must follow high-cohesion, low-coupling,
owner-scoped, documented slices.
```

## 开始前先读

```powershell
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Get-Content .\README.md -Encoding UTF8
Get-Content .\XIAOLOU_REFACTOR_HANDOFF.md -Encoding UTF8
Get-Content .\deploy\records\xiaolouai-frontend-design-constraint-phase-plan.md -Encoding UTF8
Get-Content .\deploy\records\xiaolouai-frontend-design-constraint-task-record.md -Encoding UTF8
```

## 收口结论

```text
L 系列 frontend-design-constraint-governance 已收口。

已完成 owner：
L2 shell-account-center-split
L3 playground-split
L4 admin-console-split
L5 create-and-assets-split
L6 canvas-app-shell-split-preflight
L7 canvas-host-shell-helper-split
L8 canvas-host-shell-service-builder-preflight
L9 canvas-host-generation-service-split
L10 canvas-host-asset-service-split
L11 canvas-host-project-save-service-preflight
L12 canvas-host-project-service-split
L13 canvas-host-save-service-preflight
L14 canvas-host-save-service-split
L15 canvas-host-project-load-service-preflight
L16 canvas-host-project-load-helper-split
L17 canvas-host-shell-final-preflight
L18 frontend-design-constraint-governance-closeout

结论：停止继续拆 Canvas/Agent host shell。
CanvasCreate.tsx 与 AgentCanvasCreate.tsx 已缩到约 204/194 行，剩余职责是
actor/project/theme 输入、mutable refs、context-ready resolver、service
composition、同步 host services 注册、StrictMode cleanup、theme sync 和
render shell。这些职责属于宿主壳最后一层接线；继续拆 service composition
或 context-ready resolver 收益低，风险集中在首帧同步注册、StrictMode 清理、
mutable ref 最新值、projectId readiness 和 Canvas/Agent 差异。
```

## 工作树状态

```text
当前 git status 显示 L 系列变更尚未提交：
README.md
XIAOLOU_REFACTOR_HANDOFF.md
CanvasCreate.tsx
AgentCanvasCreate.tsx
以及同目录新增 generation/asset/project/save/project-load helper/service 文件。

deploy/records 处于 ignored 目录；其中 phase/task record 已在本地回写 L18 closeout。
```

## 后续候选 Owner

```text
不要默认继续 runtime。
等待用户明确选择一个单一 owner。

明确候选：
1. canvas-runtime-app-preflight：只读检查 Canvas/Agent runtime/App.tsx
   的职责、风险和可拆 owner；不得默认修改 runtime。
2. canvas-generation-service-preflight：只读检查已抽出的 generation service
   是否需要继续按 polling/recovery/capabilities 拆分；不得默认改代码。
3. frontend-validation-closeout：只读执行/汇总前端校验入口，确认 L 系列
   工作树提交前风险。
4. choose-new-product-area-owner：从 README 的功能入口中选择新的单一
   product-area owner，继续按高内聚低耦合规则推进。
```

## 硬性约束指针

```text
完整约束以 README 的 Hard Constraints 为准。
本短棒只提示：高内聚、低耦合、按 product-area 聚合、前端只走
Control API DTO/API wrappers、不得恢复 Jaaz/Node core-api/Node payment
runtime/task-stream/Node memory-vector、不得碰 .env/Vite proxy/Caddy/IIS/
scripts/backend runtime 除非明确 owner、不得删除 agent-studio、
不默认创建 Python sidecar。
```

## 验证入口

```powershell
git status --short --branch
npm --prefix .\XIAOLOU-main run lint
npm --prefix .\XIAOLOU-main run test:unit
npm --prefix .\XIAOLOU-main run build
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\verify-frontend-legacy-dependencies.ps1 -FailOnLegacyWriteDependency
git diff --check
```

## 文档规则

```text
根 handoff 只写短棒。
阶段计划、任务记录、历史 owner 展开和归档材料写入 deploy\records。
所有 handoff/docs 保持 UTF-8 Markdown。
关键 owner、决策和验证入口一事一行。
```
