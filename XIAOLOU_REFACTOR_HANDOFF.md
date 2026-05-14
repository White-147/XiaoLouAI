# XiaoLouAI 短棒交接

更新时间：2026-05-14 +08
工作目录：`D:\code\XiaoLouAI`

本文件只保留当前接棒必须知道的上下文。旧阶段任务细节不写在短棒内；需要追溯时查 README 和 `deploy\records`。

## 当前接棒

```text
Phase: L frontend-design-constraint-governance
Owner: L2 shell-account-center-split completed
Status: ready for explicit single owner selection
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

## 下一步

```text
不要默认继续 runtime。
等待用户明确选择 L3/L4/L5/L6/L7/L8 或其他单一 owner。

建议下一棒提示词：
进行 L3 playground-split。只拆
XIAOLOU-main/src/features/playground/Playground.tsx。
先做无行为变化的 presentational/helper extraction：PlaygroundComposer、
ConversationDrawer、MemoryDrawer、playgroundDisplay。保持 signed
Playground API inputs、web search/attachments deferred、路由和 UI 文案不变；
不要碰 ChatPanel、Agent Canvas runtime、backend、env/proxy/Caddy/scripts。

如果想继续查 Canvas 而不改 runtime，则明确选择 L6
canvas-app-shell-split-preflight。
```

## 历史归档

```text
旧根 handoff 中的阶段任务记录已归档到：
deploy\records\xiaolouai-root-handoff-stage-task-archive.md

该文件只用于追溯历史，不作为下一棒默认阅读内容。
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
