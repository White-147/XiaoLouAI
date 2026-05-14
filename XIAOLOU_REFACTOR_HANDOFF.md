# XiaoLouAI 短棒交接

更新时间：2026-05-14 +08
工作目录：`D:\code\XiaoLouAI`

本文件只保留当前接棒必须知道的上下文。旧阶段任务细节不写在短棒内；需要追溯时查 README 和 `deploy\records`。

## 当前接棒

```text
Phase: M frontend-followup-after-host-shell-closeout
Owner: M4 docs-and-submit-strategy-confirmation completed
Status: M follow-up checks complete; ready for docs-only submit owner or another explicit single owner
Goal: preserve L/M closeout context and do not reopen Canvas/Agent host-shell
or runtime/generation work without an explicit new owner.
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

## M 阶段

```text
M 阶段来自 L18 closeout 后的四个明确后续部分：
M1 frontend-validation-closeout: completed.
M2 canvas-runtime-app-preflight: completed.
M3 canvas-generation-service-preflight: completed.
M4 docs-and-submit-strategy-confirmation: completed.

M1 校验通过：
npm --prefix .\XIAOLOU-main run lint
npm --prefix .\XIAOLOU-main run test:unit
npm --prefix .\XIAOLOU-main run build
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\verify-frontend-legacy-dependencies.ps1 -FailOnLegacyWriteDependency
git diff --check

M1 结果：
test:unit 19 files / 124 tests passed.
build passed.
legacy dependency gate status ok, blockers 0, warnings 0.
git status --short --branch clean against main...origin/main after validation.
deploy/records remains ignored by git and updated locally.

M2 只读检查：
Canvas runtime App.tsx: 3532 lines.
Agent runtime App.tsx: 3854 lines.
业务代码未改；只回写 handoff/project docs。
结论：不要进入宽泛 runtime owner。runtime App 可拆点存在，但核心编排
强耦合于 draft/project sync、generation/recovery、media import、viewport/
pointer/selection、history 和 Agent action bridge。若以后明确选择 runtime
owner，优先从 Canvas-only 纯 helper/appOrchestration mirror 这种低风险切片
开始；否则继续 M3 generation service preflight。

M3 只读检查：
Canvas generation service: 533 lines.
Agent generation service: 533 lines.
业务代码未改；只回写 handoff/project docs。
结论：可以考虑后续 generation service owner，但必须窄化为
task lifecycle helper split，只覆盖重复的 polling/recovery/stray lookup
与任务错误描述。不要把 capabilities 校验或 generateVideo payload shaping
混进同一 owner。Canvas-only video capability preflight、Agent image batch
resultUrls 和 Agent video succeeded-without-url error semantics 必须保留差异。

M4 只读检查：
README.md、XIAOLOU_REFACTOR_HANDOFF.md、deploy/records 下 L/M 记录已检查。
git status --short --branch: main...origin/main, tracked changes only
README.md and XIAOLOU_REFACTOR_HANDOFF.md.
deploy/records is ignored by .gitignore and updated locally only.
git diff --check passed; only CRLF warnings appeared.
补校验建议：当前 tracked diff 是 docs-only，不需要重跑 lint/test/build；
若后续出现业务代码变更，再跑完整验证入口。
提交/PR 策略：默认不要 force-add deploy/records；提交 tracked docs only。
```

## L 阶段收口

```text
L 系列 frontend-design-constraint-governance 已收口。
停止继续拆 Canvas/Agent host shell。
CanvasCreate.tsx 与 AgentCanvasCreate.tsx 已缩到约 204/194 行，剩余职责是
actor/project/theme 输入、mutable refs、context-ready resolver、service
composition、同步 host services 注册、StrictMode cleanup、theme sync 和
render shell。这些职责属于宿主壳最后一层接线；继续拆 service composition
或 context-ready resolver 收益低，风险集中在首帧同步注册、StrictMode 清理、
mutable ref 最新值、projectId readiness 和 Canvas/Agent 差异。
```

## 下一步

```text
建议下一棒：
进行 N1 docs-only-submit-owner。目标是把当前 L/M 收口文档变更准备提交。
先只读确认 git status --short --branch、git diff --stat、git diff --check；
确认 tracked changes 仅 README.md 和 XIAOLOU_REFACTOR_HANDOFF.md，且
deploy/records 继续作为 ignored/local 项目记录不 force-add。若用户明确要求
提交，则只 stage README.md 和 XIAOLOU_REFACTOR_HANDOFF.md，建议 commit message:
docs: close frontend follow-up preflights。若用户明确要求 PR，则在提交后 push
并创建 draft PR。不要改业务代码；不要碰 Canvas/Agent runtime App、
host shell/service/helper、backend、env/proxy/Caddy/scripts、provider adapters
或 Python sidecars。
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
