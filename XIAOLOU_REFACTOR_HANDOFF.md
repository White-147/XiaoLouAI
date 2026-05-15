# XiaoLouAI 短棒交接

更新时间：2026-05-15 +08
工作目录：`D:\code\XiaoLouAI`

本文件只保留当前接棒必须知道的上下文。旧阶段任务细节不写在短棒内；需要追溯时查 README 和 `deploy\records`。

## 当前接棒

```text
Phase: O public-access-hardening-owner-queue
Owner: O6 capacity-and-load-verification-owner completed
Status: Public access capacity/readiness is now measurable through
scripts/windows/verify-public-access-capacity.ps1. Default mode is offline and
non-secret; -RunHttp verifies public-origin static cache, metadata
compression/cache/ETag, object range reads, active-job polling p95, and optional
auth 429 behavior.
Goal: close media storage, edge/API protection, prewarm budget, API cache/
compression and capacity-verification gaps without broad runtime rewrites.
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
Get-Content .\deploy\records\xiaolouai-public-access-hardening-phase-plan.md -Encoding UTF8
Get-Content .\deploy\records\xiaolouai-public-access-hardening-task-record.md -Encoding UTF8
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

O 公网访问硬化队列已拆入：
deploy\records\xiaolouai-public-access-hardening-phase-plan.md
deploy\records\xiaolouai-public-access-hardening-task-record.md

短棒不要重复做 L/M/N 全局体检；先读当前任务记录的
"O Candidate Queue And Short-Stick Rules"，再按用户选择进入单一 owner。
```

## 下一步

```text
建议下一棒：
先读 deploy\records\xiaolouai-public-access-hardening-task-record.md 的
"O Candidate Queue And Short-Stick Rules"。
N2 storyboard-prompt-placeholder-owner 已完成。
N3 non-canvas-large-file-preflight 已完成。
N8 image-create-pure-helper-owner 已完成。
N9 image-create-preview-modal-owner 已完成。
N10 image-create-recent-tasks-panel-owner 已完成。
N11 playground-backend-contract-owner 已完成。
O1 public-access-constraints-preflight 已完成，本轮没有业务代码修改。
O2 media-object-storage-public-contract-owner 已完成：本地 provider 上传走
签名 `/api/media/object-upload/*`，稳定读走 `/api/media/object-content/*`；
前端不再把外部对象存储/CDN URL 改写成稳定本地 urlPath；ClosedApiWorker
generated media 结果带 objectStorageProvider/urlPath；Caddy/IIS 示例已放行
本地对象路由。
O3 edge-and-api-rate-limit-owner 已完成：Control API 已有可配置
PublicAccessLimits 固定窗口/并发保护和 auth/json/upload 请求体上限；
Caddy/IIS 示例已有公网 body ceiling；Windows env/publish/register/preflight
脚本已携带并校验对应配置。
O4 home-playground-prewarm-budget-owner 已完成：/home 不再定时隐藏挂载
Playground；Home composer focus/input/attachment/send 与侧边栏 hover/focus
只预取 lazy route chunk，Playground conversation/job/memory 初始化仍只在
实际 /playground 路由发生。
O5 api-compression-cache-contract-owner 已完成：Control API 仅对已审查的
稳定 JSON metadata 路由（capabilities/toolbox/playground models）启用动态压缩
和 private max-age=30 weak-ETag 短缓存；SSE、range media、auth/payment/provider/
operational、账号态 Playground 与 wallet reads 不进入该策略。
O6 capacity-and-load-verification-owner 已完成：新增
`scripts/windows/verify-public-access-capacity.ps1`，默认离线核算 PostgreSQL
连接池、worker lease 吞吐、Playground active-job 轮询和公网 body caps；
`-RunHttp` 可在公网入口上验证静态缓存、metadata 压缩/ETag/304、object range
read、active-job p95 和可选 auth 429。
O 队列已收口。若只想提交当前代码/文档，先做提交准备 owner，确认 tracked diff
只包含预期代码/文档；deploy/records 仍然不要 force-add。
不要同时开启新的未命名 owner。
不要恢复 Jaaz/Node core-api/Vite dev 生产入口。
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
