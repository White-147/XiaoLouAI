# XiaoLouAI 短棒交接

更新时间：2026-05-08 16:36 +08
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
Phase: H feature-layout-cleanup
Owner: H14 assets-media-projects-shared-media-ui
Status: done; next owner should continue function-owner inventory and migration

Done:
- New layout-cleanup work now records as lightweight H-stage entries rather than continuing G14 numbering.
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
- Python local-model worker sidecar was moved out of the flat services root into:
  backend\services\model-runtime\local-model-worker-sidecar.
- The root tools directory was removed after the sidecar move.
- setup_video_replace.cmd and start_core_api.cmd now use backend\services\toolbox\video-replace-sidecar.
- start-local-model-worker.ps1, publish/restore runtime scripts, P0 verification,
  legacy runtime dependency scan, and the .NET supervisor now use
  backend\services\model-runtime\local-model-worker-sidecar.
- Playground frontend page moved to XIAOLOU-main\src\features\playground\Playground.tsx.
- Playground frontend API service moved to XIAOLOU-main\src\features\playground\api\playground.ts.
- Old Playground page/API paths are thin compatibility re-exports.
- Playground service test moved with the feature; Vitest now includes feature-local tests.
- Script Plaza moved to XIAOLOU-main\src\features\comic-production\script-plaza\ScriptPlaza.tsx.
- Old Script Plaza page path is a thin compatibility re-export.
- API Center moved to XIAOLOU-main\src\features\wallet-payments-api-center\api-center\ApiCenter.tsx.
- API Center now has a feature-local API wrapper at
  XIAOLOU-main\src\features\wallet-payments-api-center\api-center\api\api-center.ts.
- Old API Center page path is a thin compatibility re-export.
- Credit Usage moved to XIAOLOU-main\src\features\wallet-payments-api-center\credit-usage\CreditUsage.tsx.
- Credit Usage now has a feature-local API wrapper at
  XIAOLOU-main\src\features\wallet-payments-api-center\credit-usage\api\credit-usage.ts.
- Old Credit Usage page path is a thin compatibility re-export.
- Wallet Recharge moved to XIAOLOU-main\src\features\wallet-payments-api-center\wallet-recharge\WalletRecharge.tsx.
- Wallet Recharge now has a feature-local API wrapper at
  XIAOLOU-main\src\features\wallet-payments-api-center\wallet-recharge\api\wallet-recharge.ts.
- Old Wallet Recharge page path is a thin compatibility re-export.
- Assets moved to XIAOLOU-main\src\features\assets-media-projects\assets\Assets.tsx.
- Assets now has a feature-local API wrapper at
  XIAOLOU-main\src\features\assets-media-projects\assets\api\assets.ts.
- Old Assets page path is a thin compatibility re-export.
- Enterprise Console moved to XIAOLOU-main\src\features\account-admin-enterprise\enterprise-console\EnterpriseConsole.tsx.
- Enterprise Console now has a feature-local API wrapper at
  XIAOLOU-main\src\features\account-admin-enterprise\enterprise-console\api\enterprise-console.ts.
- Old Enterprise Console page path is a thin compatibility re-export.
- Register moved to XIAOLOU-main\src\features\account-admin-enterprise\register\Register.tsx.
- Register now has a feature-local API wrapper at
  XIAOLOU-main\src\features\account-admin-enterprise\register\api\register.ts.
- Admin Orders moved to XIAOLOU-main\src\features\account-admin-enterprise\admin-orders\AdminOrders.tsx.
- Admin Orders now has a feature-local API wrapper at
  XIAOLOU-main\src\features\account-admin-enterprise\admin-orders\api\admin-orders.ts.
- Super Admin Console moved to XIAOLOU-main\src\features\account-admin-enterprise\super-admin-console\SuperAdminConsole.tsx.
- Super Admin Console now has a feature-local API wrapper at
  XIAOLOU-main\src\features\account-admin-enterprise\super-admin-console\api\super-admin-console.ts.
- Old Register, AdminOrders, and SuperAdminConsole page paths are thin compatibility re-exports.
- App route lazy import and Layout route prefetch now load Super Admin Console from the feature path.
- Create Image moved to XIAOLOU-main\src\features\create-image\image-create\ImageCreate.tsx.
- Create Image now has a feature-local API wrapper at
  XIAOLOU-main\src\features\create-image\image-create\api\create-image.ts.
- Old pages\create\ImageCreate.tsx is a thin compatibility re-export.
- App route lazy import and Layout route prefetch now load Create Image from the feature path.
- Create Video moved to XIAOLOU-main\src\features\create-video\video-create\VideoCreate.tsx.
- Create Video now has a feature-local API wrapper at
  XIAOLOU-main\src\features\create-video\video-create\api\create-video.ts.
- Old pages\create\VideoCreate.tsx is a thin compatibility re-export.
- App route lazy import and Layout route prefetch now load Create Video from the feature path.
- Comic workflow shell and subpages moved to XIAOLOU-main\src\features\comic-production\comic.
- Comic workflow now has a feature-local API wrapper at
  XIAOLOU-main\src\features\comic-production\comic\api\comic-production.ts.
- Old pages\comic\*.tsx files are thin compatibility re-exports.
- App route lazy imports and Layout route prefetch now load comic workflow from the feature path.
- Canvas Create moved to XIAOLOU-main\src\features\canvas-agent-canvas\canvas\CanvasCreate.tsx.
- Canvas runtime moved from XIAOLOU-main\src\canvas to
  XIAOLOU-main\src\features\canvas-agent-canvas\canvas\runtime.
- Agent Canvas Create moved to XIAOLOU-main\src\features\canvas-agent-canvas\agent-canvas\AgentCanvasCreate.tsx.
- Agent Canvas runtime moved from XIAOLOU-main\src\agent-canvas to
  XIAOLOU-main\src\features\canvas-agent-canvas\agent-canvas\runtime.
- Agent Studio and Jaaz embed moved to XIAOLOU-main\src\features\canvas-agent-canvas\agent-studio.
- Canvas, Agent Canvas, and Agent Studio now have feature-local API wrappers under their capability folders.
- Old pages\create canvas/agent-canvas/agent-studio/Jaaz embed paths are thin compatibility re-exports.
- Layout lazy imports, route prefetch, Assets warmups, and toolbox model imports now load canvas code from the feature path.
- Layout moved to XIAOLOU-main\src\features\home\nav-layout\Layout.tsx.
- Profile modal moved to XIAOLOU-main\src\features\home\nav-layout\ProfileModal.tsx.
- Navigation guards moved to XIAOLOU-main\src\features\home\nav-layout\navigation-guards.ts.
- Old components\Layout.tsx, components\modals\ProfileModal.tsx, and lib\navigation-guards.ts are thin compatibility re-exports.
- App route root now imports Layout from the feature path.
- Asset sync controls moved to XIAOLOU-main\src\features\assets-media-projects\asset-sync\AssetSyncControls.tsx.
- Reference asset picker moved to XIAOLOU-main\src\features\assets-media-projects\reference-assets\ReferenceAssetPicker.tsx.
- Generated media placeholder moved to XIAOLOU-main\src\features\assets-media-projects\media\GenerationPlaceholder.tsx.
- Old components\create\AssetSyncControls.tsx, components\create\ReferenceAssetPicker.tsx, and
  components\media\GenerationPlaceholder.tsx are thin compatibility re-exports.
- create-image, create-video, toolbox, comic, and assets imports now reference the assets-media-projects owner directly.
- download-media, media-url-policy, api\media, and api\projects-canvas-create were audited as cross-product/control API foundations and remain in lib.
- .gitignore now allows committable deploy configs and retained evidence while ignoring:
  deploy\local-secrets, deploy\records, deploy temp/output, sidecar .venv/data/weights.

Current layout check:
- D:\code\XiaoLouAI\XIAOLOU-main\src\features\toolbox is frontend TS/TSX code:
  api wrapper, pages, presets, and prompt module.
- D:\code\XiaoLouAI\XIAOLOU-main\src\features\playground is frontend Playground page/API/test code.
- D:\code\XiaoLouAI\XIAOLOU-main\src\features\comic-production\script-plaza is the script template plaza route.
- D:\code\XiaoLouAI\XIAOLOU-main\src\features\wallet-payments-api-center\api-center is the API Center route and feature-local API wrapper.
- D:\code\XiaoLouAI\XIAOLOU-main\src\features\wallet-payments-api-center\credit-usage is the wallet usage statistics route and feature-local API wrapper.
- D:\code\XiaoLouAI\XIAOLOU-main\src\features\wallet-payments-api-center\wallet-recharge is the wallet recharge route and feature-local API wrapper.
- D:\code\XiaoLouAI\XIAOLOU-main\src\features\assets-media-projects\assets is the assets route and feature-local API wrapper.
- D:\code\XiaoLouAI\XIAOLOU-main\src\features\assets-media-projects\asset-sync is the shared project-asset sync UI.
- D:\code\XiaoLouAI\XIAOLOU-main\src\features\assets-media-projects\reference-assets is the shared project reference asset picker UI.
- D:\code\XiaoLouAI\XIAOLOU-main\src\features\assets-media-projects\media is the generated media placeholder/resolution UI.
- D:\code\XiaoLouAI\XIAOLOU-main\src\features\account-admin-enterprise\enterprise-console is the enterprise console route and feature-local API wrapper.
- D:\code\XiaoLouAI\XIAOLOU-main\src\features\account-admin-enterprise\register is the registration page and feature-local API wrapper.
- D:\code\XiaoLouAI\XIAOLOU-main\src\features\account-admin-enterprise\admin-orders is the admin recharge review page and feature-local API wrapper.
- D:\code\XiaoLouAI\XIAOLOU-main\src\features\account-admin-enterprise\super-admin-console is the super admin route and feature-local API wrapper.
- D:\code\XiaoLouAI\XIAOLOU-main\src\features\comic-production\comic is the comic workflow shell, subpages, editors, and feature-local API wrapper.
- D:\code\XiaoLouAI\XIAOLOU-main\src\features\create-image\image-create is the create image route and feature-local API wrapper.
- D:\code\XiaoLouAI\XIAOLOU-main\src\features\create-video\video-create is the create video route and feature-local API wrapper.
- D:\code\XiaoLouAI\XIAOLOU-main\src\features\canvas-agent-canvas\canvas is the native canvas route, runtime, and feature-local API wrapper.
- D:\code\XiaoLouAI\XIAOLOU-main\src\features\canvas-agent-canvas\agent-canvas is the agent canvas route, runtime, and feature-local API wrapper.
- D:\code\XiaoLouAI\XIAOLOU-main\src\features\canvas-agent-canvas\agent-studio is the Agent Studio/Jaaz embed route and feature-local API wrapper.
- D:\code\XiaoLouAI\XIAOLOU-main\src\features\home\nav-layout is the app Layout, route prefetch, profile modal, and navigation guard owner.
- D:\code\XiaoLouAI\backend\services\toolbox\video-replace-sidecar is Python sidecar/runtime code:
  app, scripts, pyproject, local data, weights, sqlite, and venv/runtime artifacts.
- D:\code\XiaoLouAI\backend\services\model-runtime\local-model-worker-sidecar is Python local model queue-worker sidecar code:
  app package and canonical queue skeleton worker.
- The sidecar is service-side now, not retired.
- Existing first-class frontend feature roots are only:
  XIAOLOU-main\src\features\home
  XIAOLOU-main\src\features\account-admin-enterprise
  XIAOLOU-main\src\features\assets-media-projects
  XIAOLOU-main\src\features\canvas-agent-canvas
  XIAOLOU-main\src\features\comic-production
  XIAOLOU-main\src\features\create-image
  XIAOLOU-main\src\features\create-video
  XIAOLOU-main\src\features\playground
  XIAOLOU-main\src\features\toolbox
  XIAOLOU-main\src\features\wallet-payments-api-center
- Remaining non-wrapper route implementations still need owner-by-owner review:
  none currently known under XIAOLOU-main\src\pages, src\pages\create, or src\pages\comic.
- Already-thin page wrappers should not be counted as remaining main implementations:
  AdminOrders, ApiCenter, Assets, CreditUsage, EnterpriseConsole, Home, Playground,
  ScriptPlaza, WalletRecharge, create\AgentCanvasCreate, create\AgentStudio,
  create\CanvasCreate, create\ImageCreate, create\JaazAgentCanvasEmbed,
  create\VideoCreate, create\ScriptBreakdown, create\StoryboardGrid25,
  create\VideoReplace, create\VideoReverse, comic\ComicShell, comic\Dubbing, comic\Entities,
  comic\GlobalSettings, comic\Preview, comic\Storyboard,
  comic\StoryboardEditor, comic\StoryScript, comic\Video, comic\VideoEditor,
  Register, SuperAdminConsole.
- Component/lib compatibility wrappers should not be counted as main implementations:
  components\Layout.tsx, components\modals\ProfileModal.tsx, lib\navigation-guards.ts.
- Remaining shared/API review should be owner-by-owner only:
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

## H-stage owner 状态
```text
Purpose:
- This list marks only directory/layout cleanup that is exact from current files.
- "done" means the route or runtime owner has canonical placement plus old wrappers where needed.
- "partial" means a named sub-surface is done, but related owner surfaces still have main code outside feature folders.
- Do not rework done items unless a later route/API behavior change requires it.

Done:
- top-level-layout: done.
  Only XIAOLOU-main, backend, scripts, deploy remain as first-class code/deploy roots.
- toolbox: done.
  Frontend toolbox pages/API live under XIAOLOU-main\src\features\toolbox.
  Python video-replace sidecar lives under backend\services\toolbox\video-replace-sidecar.
  Old toolbox page paths are thin wrappers.
- playground: done.
  Page, API service, and feature-local test live under XIAOLOU-main\src\features\playground.
  Old page/API paths are thin wrappers.
- account-admin-enterprise route/page surfaces: done.
  Enterprise Console, Register, AdminOrders, and SuperAdminConsole live under
  XIAOLOU-main\src\features\account-admin-enterprise with feature-local API wrappers.
  Old page paths are thin wrappers.
- wallet-payments-api-center route surfaces: done.
  api-center, credit-usage, and wallet-recharge live under
  XIAOLOU-main\src\features\wallet-payments-api-center.
  Old page paths are thin wrappers.
- create-image frontend route: done.
  Main page and API facade live under XIAOLOU-main\src\features\create-image\image-create.
  Old pages\create\ImageCreate.tsx is a thin wrapper.
- create-video frontend route: done.
  Main page and API facade live under XIAOLOU-main\src\features\create-video\video-create.
  Old pages\create\VideoCreate.tsx is a thin wrapper.
- comic-production workflow: done.
  Script Plaza lives under XIAOLOU-main\src\features\comic-production\script-plaza.
  Comic shell, subpages, editors, and API facade live under
  XIAOLOU-main\src\features\comic-production\comic.
  Old pages\comic\*.tsx files are thin wrappers.
- canvas-agent-canvas: done.
  CanvasCreate, AgentCanvasCreate, AgentStudio, JaazAgentCanvasEmbed, and
  the native canvas/agent-canvas runtimes live under
  XIAOLOU-main\src\features\canvas-agent-canvas.
  Old pages\create canvas paths are thin wrappers.
- home/nav/layout: done.
  Home route lives under XIAOLOU-main\src\features\home.
  Layout, route prefetch, ProfileModal, and navigation guards live under
  XIAOLOU-main\src\features\home\nav-layout.
  Old component/lib paths are thin wrappers.
- assets-media-projects: done.
  Assets route and API facade live under
  XIAOLOU-main\src\features\assets-media-projects\assets.
  Shared asset sync controls, reference asset picker, and generated media placeholder UI live under
  XIAOLOU-main\src\features\assets-media-projects.
  Old component paths are thin wrappers.
  download-media, media-url-policy, api\media, and api\projects-canvas-create remain in lib because current usage spans create-image, create-video, toolbox, comic, canvas, home, and assets surfaces.
- model-runtime local-model-worker sidecar placement: done.
  Python sidecar lives under backend\services\model-runtime\local-model-worker-sidecar.

Partial:
- none recorded in this handoff; continue full inventory each baton and add newly found partial owners here.
Not yet layout-cleaned:
- none recorded in this handoff; continue full inventory each baton and add newly found owners here.
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
先对照上方 H-stage owner 状态；done 项不再作为下一棒默认候选，
partial / not-yet 项优先。
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
