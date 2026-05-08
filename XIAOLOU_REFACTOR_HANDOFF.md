# XiaoLouAI 短棒交接

更新时间：2026-05-08 14:17 +08
工作目录：`D:\code\XiaoLouAI`

本文件只保留下一棒需要立刻接住的上下文。G14 详细历史已归档到：

```text
deploy\records\xiaolouai-finalization-handoff.md
deploy\records\xiaolouai-deep-research-structured.md
deploy\records\xiaolouai-legacy-physical-archive-contract.md
deploy\records\xiaolouai-refactor-gap-verification.md
```

## 每棒先读

```powershell
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Get-Content .\XIAOLOU_REFACTOR_HANDOFF.md -Encoding UTF8
Get-Content .\deploy\records\xiaolouai-finalization-handoff.md -Encoding UTF8
Get-Content .\deploy\records\xiaolouai-deep-research-structured.md -Encoding UTF8
Get-Content .\deploy\records\xiaolouai-legacy-physical-archive-contract.md -Encoding UTF8
Get-Content .\deploy\records\xiaolouai-refactor-gap-verification.md -Encoding UTF8
```

## PowerShell 友好格式

```text
后续修改 handoff/docs 时保持 UTF-8 Markdown。
优先使用短行、普通标题、普通列表和 text 代码块。
避免宽表格、超长单行、隐藏折叠格式和依赖特殊渲染的内容。
关键 owner、决策、验证入口尽量一事一行，便于 Get-Content/Select-String 阅读。
```

## 固定路线

```text
1. 一级目录只保留：XIAOLOU-main、backend、scripts、deploy
2. 后端主线：backend/dotnet/control-plane
3. 前端主线：XIAOLOU-main
4. 非 .NET 服务主线：backend/services
5. 部署配置、保留材料和记录统一进入 deploy
6. 前端功能布局优先按 XIAOLOU-main/src/features/<product-area> 收口
7. legacy 只作为参考、归档或受控验证对象
8. 不恢复 legacy 为生产入口
9. 不新增 Node/Express 主服务
10. 不让前端重新直连 legacy 端口
11. Python 只允许作为明确签收的本地模型/sidecar adapter；不能作为新控制面
```

## 禁止恢复

```text
禁止恢复 legacy deploy_aliases 到生产路径。
禁止让 tasks stream 默认开启。
禁止恢复旧支付 notify alias 为默认公开入口。
支付回调以 canonical /api/payments/callbacks/{provider} 为统一目标。
禁止在 legacy/services-api README 或脚本中重新出现 production API wording。
禁止恢复 legacy 为生产入口，或重新新增 live legacy source root 作为默认工作目录。
历史 legacy 对照只能显式恢复到单独本地副本，并使用 retained manifest 或 live-source gate 受控验证。
```

## 当前接棒

```text
Owner: G14an repository-root-and-feature-owner-layout
Status: done; next owner should continue function-owner inventory and migration

Done:
- Root handoff G14 long history was moved to deploy\records\xiaolouai-finalization-handoff.md.
- Root handoff now keeps only first-read commands, fixed route, forbidden restore rules, current baton, and verification entrypoints.
- README.md remains the only project README after prior consolidation.
- Project README scan excluding .runtime, node_modules, and .venv finds only root README.md.
- User corrected the layout rule: frontend files are grouped by frontend feature;
  backend/runtime files are grouped separately by backend feature/service.
- Top-level directory cleanup is complete:
  XIAOLOU-main, backend, scripts, deploy, README.md, XIAOLOU_REFACTOR_HANDOFF.md.
- Former top-level control-plane-dotnet moved to backend\dotnet\control-plane.
- Former top-level services moved to backend\services.
- Former docs moved to ignored deploy\records.
- Former legacy-surface-evidence moved to deploy\retained\legacy-surface-evidence.
- Python video-replace sidecar was kept and moved out of tools into:
  backend\services\toolbox\video-replace-sidecar.
- The root tools directory was removed after the sidecar move.
- setup_video_replace.cmd and start_core_api.cmd now use backend\services\toolbox\video-replace-sidecar.
- .gitignore now allows committable deploy configs and retained evidence while ignoring:
  deploy\local-secrets, deploy\records, deploy temp/output, sidecar .venv/data/weights.

Current layout check:
- D:\code\XiaoLouAI\XIAOLOU-main\src\features\toolbox is frontend TS/TSX code:
  api wrapper, pages, presets, and prompt module.
- D:\code\XiaoLouAI\backend\services\toolbox\video-replace-sidecar is Python sidecar/runtime code:
  app, scripts, pyproject, local data, weights, sqlite, and venv/runtime artifacts.
- The sidecar is service-side now, not retired.
- Existing first-class frontend feature roots are only:
  XIAOLOU-main\src\features\home
  XIAOLOU-main\src\features\toolbox
- Remaining route implementations still need owner-by-owner review under:
  XIAOLOU-main\src\pages
  XIAOLOU-main\src\pages\create
  XIAOLOU-main\src\pages\comic
  XIAOLOU-main\src\lib
  XIAOLOU-main\src\lib\api
- Backend .NET route families currently live under:
  backend\dotnet\control-plane\src\XiaoLou.ControlApi\Modules\Accounts
  backend\dotnet\control-plane\src\XiaoLou.ControlApi\Modules\Admin
  backend\dotnet\control-plane\src\XiaoLou.ControlApi\Modules\Auth
  backend\dotnet\control-plane\src\XiaoLou.ControlApi\Modules\Health
  backend\dotnet\control-plane\src\XiaoLou.ControlApi\Modules\InternalJobs
  backend\dotnet\control-plane\src\XiaoLou.ControlApi\Modules\Media
  backend\dotnet\control-plane\src\XiaoLou.ControlApi\Modules\Operational
  backend\dotnet\control-plane\src\XiaoLou.ControlApi\Modules\Payments
  backend\dotnet\control-plane\src\XiaoLou.ControlApi\Modules\Playground
  backend\dotnet\control-plane\src\XiaoLou.ControlApi\Modules\Projects
  backend\dotnet\control-plane\src\XiaoLou.ControlApi\Modules\Toolbox

Open technical follow-ups:
- Implement Vertex/Veo video adapter with predictLongRunning polling and video object writeback.
- Continue feature-layout cleanup for all discovered product areas, not only the four
  previously named routes.
- Split backend endpoint modules by capability only when a module becomes too large or
  mixes unrelated product owners.
```

## 下一棒提示词

```text
继续按“目录/功能高内聚、低耦合”的目标整理项目目录。
先做全量盘点，再选择一个 owner 修改，不要只按用户曾点名的四个功能处理。

每一棒先检查这些入口：
1. 前端路由：XIAOLOU-main\src\App.tsx
2. 前端主实现散落区：XIAOLOU-main\src\pages、src\pages\create、src\pages\comic
3. 前端共享/API 散落区：XIAOLOU-main\src\lib、src\lib\api
4. 已收口前端 feature：XIAOLOU-main\src\features
5. .NET 后端模块：backend\dotnet\control-plane\src\XiaoLou.ControlApi\Modules
6. 后端 worker/provider/storage：backend\dotnet\control-plane\src
7. 非 .NET sidecar：backend\services

后续候选 owner 不限于以下列表，发现新功能也按同一规则加入：
1. home/nav/layout：首页、导航、能力卡片、路由守卫、Layout。
2. toolbox：剧本拆解、视频反推、25 格分镜、人物替换等工具箱功能。
3. create-image：图片创作页面、模型配置、上传引用、任务创建、任务列表、Vertex 图片链路。
4. create-video：视频创作页面、模型配置、上传引用、任务创建、队列和后续 Vertex/Veo adapter。
5. canvas-agent-canvas：canvas、agent-canvas、节点、项目、媒体上传、Control API wrapper。
6. playground：页面、transport、模型/会话/消息 API、后端 Playground module 和测试。
7. assets-media-projects：资产页、媒体 URL 策略、上传、下载、项目资产、Media/Projects modules。
8. account-admin-enterprise：账号、组织、企业后台、超级管理员、权限矩阵、Accounts/Admin/Auth modules。
9. wallet-payments-api-center：钱包、用量、充值、API center、Payments module。
10. comic-production：comic shell、剧本、角色、分镜、视频、配音、预览和相关项目资产工具。

目录收口规则：
1. 前端主实现放到 XIAOLOU-main\src\features\<product-area>\<capability>。
2. 旧 pages 文件只保留薄 re-export/route wrapper，直到对应路由确认稳定。
3. src\lib 只保留真正跨两个以上 product-area 共享的工具；单功能工具移入 feature。
4. src\lib\api 可以逐步拆为 feature-local api wrapper；跨域底座留 control-api-client。
5. .NET 后端继续按 backend\dotnet\control-plane\src\XiaoLou.ControlApi\Modules\<area> 分区。
6. 非 .NET 运行体放 backend\services\<product-area>\<capability>-sidecar。
7. 不把 Python/backend sidecar 放进 XIAOLOU-main。
8. 不新增顶层功能目录；不要恢复 tools、services、docs、control-plane-dotnet 顶层目录。
9. 每次只迁移一个 owner，并同步改 imports、tests、README、handoff 和脚本路径。
10. 移动后保留兼容 re-export，避免一次性打断路由和测试。

验证规则：
1. 前端 owner 必跑 npm --prefix .\XIAOLOU-main run build。
2. 前端 API/行为变更补跑对应 vitest。
3. 后端 owner 必跑相关 dotnet build/xUnit。
4. 涉及 legacy/deploy 边界时跑 verify-final-legacy-surface。
5. 最后跑 git diff --check。
禁止把功能代码重新放回 tools、legacy、零散 pages/lib 主实现目录。
禁止把 Python/backend sidecar 放进 XIAOLOU-main 前端 feature 目录。
```

## 验证入口

```powershell
.\scripts\windows\verify-final-legacy-surface.ps1 -LegacySurfaceManifestPath .\deploy\retained\legacy-surface-evidence\final-legacy-surface-manifest-g11k.json
npm --prefix .\XIAOLOU-main run build
npm --prefix .\XIAOLOU-main run test:unit -- toolbox.test.ts api-compatibility-wrappers.test.ts projects-canvas-create.test.ts control-api-client.test.ts
dotnet build .\backend\dotnet\control-plane\src\XiaoLou.ControlApi\XiaoLou.ControlApi.csproj --no-restore -v:minimal
dotnet build .\backend\dotnet\control-plane\src\XiaoLou.ClosedApiWorker\XiaoLou.ClosedApiWorker.csproj --no-restore -v:minimal
dotnet test .\backend\dotnet\control-plane\tests\XiaoLou.ControlApi.Tests\XiaoLou.ControlApi.Tests.csproj --no-build -v:minimal
```
