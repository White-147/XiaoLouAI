# XiaoLouAI 短棒交接

更新时间：2026-05-14 +08
工作目录：`D:\code\XiaoLouAI`

本文件只保留当前接棒必须知道的上下文。旧阶段任务细节不写在短棒内；需要追溯时查 README 和 `deploy\records`。

## 当前接棒

```text
Phase: N frontend-followup-owner-queue
Owner: N11 playground-backend-contract-owner completed
Status: Playground frontend/backend contract now carries current chat options and completes via stable .NET contract stub when no provider route is configured
Goal: preserve L/M closeout context and do not reopen Canvas/Agent host-shell,
runtime/generation or provider-adapter work without an explicit new owner.
```

## 开始前先读

```powershell
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Get-Content .\README.md -Encoding UTF8
Get-Content .\XIAOLOU_REFACTOR_HANDOFF.md -Encoding UTF8
Get-Content .\deploy\records\xiaolouai-frontend-design-constraint-phase-plan.md -Encoding UTF8
Get-Content .\deploy\records\xiaolouai-frontend-design-constraint-task-record.md -Encoding UTF8
Get-Content .\deploy\records\xiaolouai-frontend-followup-phase-plan.md -Encoding UTF8
Get-Content .\deploy\records\xiaolouai-frontend-followup-task-record.md -Encoding UTF8
```

## 阶段归档

```text
L 阶段详情已归档到：
deploy\records\xiaolouai-frontend-design-constraint-phase-plan.md
deploy\records\xiaolouai-frontend-design-constraint-task-record.md

M 阶段详情已归档到：
deploy\records\xiaolouai-frontend-followup-phase-plan.md
deploy\records\xiaolouai-frontend-followup-task-record.md

N 队列已拆入：
deploy\records\xiaolouai-frontend-followup-task-record.md

短棒不要重复做 L/M 全局体检；先读任务记录的
"N Candidate Queue And Short-Stick Rules"，再按用户选择进入单一 owner。
```

## 下一步

```text
建议下一棒：
先读 deploy\records\xiaolouai-frontend-followup-task-record.md 的
"N Candidate Queue And Short-Stick Rules"。
N2 storyboard-prompt-placeholder-owner 已完成。
N3 non-canvas-large-file-preflight 已完成。
N8 image-create-pure-helper-owner 已完成。
N9 image-create-preview-modal-owner 已完成。
N10 image-create-recent-tasks-panel-owner 已完成。
N11 playground-backend-contract-owner 已完成。
默认下一棒建议：若要提交当前 N2/N8/N9/N10/N11 变更，先做提交准备 owner，确认
tracked diff 包含 README.md、XIAOLOU_REFACTOR_HANDOFF.md、两个 N2 提示词文件、
ImageCreate.tsx、新增 imageCreateHelpers.ts 和 imageCreateHelpers.test.ts、
新增 ImageCreatePreviewModal.tsx 与 ImageCreateRecentTasksPanel.tsx，以及
Playground/后端 contract-stub 相关文件，且不要 force-add deploy/records。
若继续代码 owner，则只进入一个明确 owner。
不要重复 M2/M3/M4 的全局检查，不要开启多个 owner。
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
