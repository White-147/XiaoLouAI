# XiaoLouAI 短棒交接

更新时间：2026-05-07 09:59 +08
工作目录：`D:\code\XiaoLouAI`

本文件是后续每一棒的第一读取文件。根短棒只保留总进度、固定边界、当前 owner/队列提示词和验证入口；历史细节见 docs handoff：

```text
docs\xiaolouai-finalization-handoff.md
docs\xiaolouai-deep-research-structured.md
docs\xiaolouai-legacy-physical-archive-contract.md
docs\xiaolouai-refactor-gap-verification.md
```

## PowerShell 读取

```powershell
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Get-Content .\XIAOLOU_REFACTOR_HANDOFF.md -Encoding UTF8
Get-Content .\docs\xiaolouai-finalization-handoff.md -Encoding UTF8
Get-Content .\docs\xiaolouai-deep-research-structured.md -Encoding UTF8
Get-Content .\docs\xiaolouai-legacy-physical-archive-contract.md -Encoding UTF8
Get-Content .\docs\xiaolouai-refactor-gap-verification.md -Encoding UTF8
```

## PowerShell 友好格式

```text
后续修改 handoff/docs 时保持 UTF-8 Markdown。
优先使用短行、普通标题、普通列表和 text 代码块。
避免宽表格、超长单行、隐藏折叠格式和依赖特殊渲染的内容。
关键 owner、决策、验证入口尽量一事一行，便于 PowerShell Get-Content/Select-String 阅读。
```

## 固定路线

```text
1. 后端主线：control-plane-dotnet
2. 前端主线：XIAOLOU-main
3. legacy 只作为参考、归档或受控验证对象
4. 不恢复 legacy 为生产入口
5. 不新增 Python FastAPI 主服务
6. 不新增 Node/Express 主服务
7. 不让前端重新直连 legacy 端口
```

## 禁止恢复

```text
禁止恢复 legacy deploy_aliases 到生产路径。
禁止让 tasks stream 默认开启。
禁止恢复旧支付 notify alias 为默认公开入口；支付回调以 canonical `/api/payments/callbacks/{provider}` 为统一目标。
禁止在 legacy/services-api README 或脚本中重新出现 production API wording。
禁止恢复 legacy 为生产入口，或重新新增 live legacy source root 作为默认工作目录。
历史 legacy 对照只能显式恢复到单独本地副本，并使用 retained manifest 或 live-source gate 受控验证。
```

## 总进度

```text
G0 inventory-and-baseline: done
G1 deploy-alias-baseline: done
G2 core-api-env-harden: done
G3 payment-notify-gate: done
G4 services-api-readme-deproduction: done
G5 frontend-legacy-dependency-gate: done
G6 legacy-physical-archive-contract: done
G7 verify-scripts-alignment: done
G8 handoff-sync: done
G9 operations-evidence-and-acceptance: done
G10 postgres-performance-inventory-and-tuning: done
G11 final-legacy-surface-and-physical-cleanup: done
G12 canonical module/service/test-harness refactor: done
G12 detail archive: docs\xiaolouai-finalization-handoff.md
G13 CI/static/test-gate hardening through required synthetic E2E: done
G13 detail archive: docs\xiaolouai-finalization-handoff.md
Post-G13 advisory/monitor follow-ups: active queue remains split by owner
Post-G13 latest completed through: 2026-05-06 10:52 +08 frontend auth-account service coverage expansion
Post-G13 gates: coverage/security/branch-protection hardening remain advisory/preflight only
Post-G13 no-change: no threshold, security failure gate, workflow, required check, or branch-protection expansion added
G14 refactor-gap closure: active
G14 source: 2026-05-06 uploaded gap report plus 2026-05-06 14:19 +08 user decisions
G14 fact: G12/G13 file split, tests, and required synthetic E2E remain valid
G14 gap: low-coupling closure is not complete
G14 latest completed: 2026-05-07 09:59 +08 G14x backend auth provider/JWT focused tests and helper split
```

## 当前模块

```text
Owner: G14-refactor-gap-closure（下一棒默认从 backend-auth-provider-jwt-focused-tests 开始）

Current facts:
- G12/G13 详细阶段记录已归档到 docs\xiaolouai-finalization-handoff.md。
- 2026-05-06 13:34 +08 已研读上传报告并完成本地只读复核。
- 2026-05-06 14:19 +08 已合并用户确认的产品路线。
- 2026-05-06 14:39 +08 已完成 G14a 支付回调 canonical 收口。
- 2026-05-06 14:55 +08 已完成 G14b 账号/设置/钱包入口盘点，无 runtime 行为变化。
- 2026-05-06 15:01 +08 已完成 G14c 账号资料 contract/password baseline，无 runtime 行为变化。
- 2026-05-06 15:06 +08 已完成 G14d 设置导航壳 runtime 收口。
- 2026-05-06 15:16 +08 已完成 G14e 头像媒体上传/资料渲染链路收口。
- 2026-05-06 15:26 +08 已完成 G14f 钱包额度侧边栏入口与前端 entitlement 收口。
- 2026-05-06 15:34 +08 已完成 G14g 组织上下文来源 inventory/计划，无 runtime 行为变化。
- 2026-05-06 15:46 +08 已完成 G14h 前端 owner-scope contract inventory，无 runtime 行为变化。
- 2026-05-06 15:55 +08 已完成 G14i 前端 owner-scope 纯 resolver 收口。
- 2026-05-06 16:05 +08 已完成 G14j jobs/media owner-scope 迁移。
- 2026-05-06 16:17 +08 已完成 G14k projects/canvas/create owner-scope 迁移。
- 2026-05-06 16:28 +08 已完成 G14l playground owner-scope 迁移。
- 2026-05-06 16:36 +08 已完成 G14m api.ts facade split 盘点和 G14n wave-1 计划，无 runtime 行为变化。
- 2026-05-06 16:55 +08 已完成 G14n api.ts route-policy/control-api-client wave-1 拆分。
- 2026-05-06 17:09 +08 已完成 G14o AuthHelpers boundary split 计划，无 runtime 行为变化。
- 2026-05-06 17:28 +08 已完成 G14p AuthHelpers route-policy/grant helper wave-1 拆分。
- 2026-05-06 17:41 +08 已完成 G14q ProjectEndpoints load/404/authorize helper 收敛。
- 2026-05-06 17:57 +08 已完成 G14r Playground transport 命名语义收口。
- 2026-05-07 09:13 +08 已完成 G14s jobs deleteTask/dismissTask 语义收口。
- 2026-05-07 09:26 +08 已完成 G14t 生成/临时/配置/测试残留盘点，未删除文件。
- 2026-05-07 09:34 +08 已完成 G14u AuthHelpers 剩余边界盘点和后续波次计划，无 runtime 行为变化。
- 2026-05-07 09:43 +08 已完成 G14v AuthHelpers header/env helper wave-1。
- 2026-05-07 09:51 +08 已完成 G14w ClientAssertionFactory focused tests and helper split。
- 2026-05-07 09:59 +08 已完成 G14x ClientAuthProviderValidator focused tests and helper split。
- active backend/proxy/matrix 只保留 `/api/payments/callbacks/{provider}`。
- 旧 `/api/payments/{provider}/notify` 只保留在 legacy verifier/evidence 历史记录中。
- “后端模块和前端服务拆分已完成”仍成立。
- “低耦合已完成”降级为“拆文件完成，边界收口未完成”。

User-confirmed decisions:
- 旧 `/api/payments/{provider}/notify` alias 是老路径兼容。
- 真实支付商户后台未正式上线，可统一成一个 canonical callback。
- 账号资料入口由用户头像和设置二级菜单共同进入。
- 左下角“更多”改为“设置”。
- 身份切换、管理面板、退出登录进入设置二级菜单。
- 用户名是首页显示名。
- 头像走现有媒体上传流程。
- 邮箱必填，手机号可选。
- 默认组织仅企业管理员/企业员工需要编辑。
- 企业管理员管理企业钱包。
- 企业员工无个人钱包。
- 个人账号只有个人钱包。
- 积分统计常驻侧边栏资产库下方。

Password baseline:
- 密码当前只在登录/注册 DTO 接收。
- PostgreSQL users 表未发现 password_hash。
- PostgresIdentityConfigStore 注册/登录未存储也未校验密码。
- Login/Register/CreateOrganizationMember 后端路径当前未读取 request.Password。
- 密码持久化、哈希、验证、重置后续单独 owner 处理。

Cleanup baseline:
- `xiaolou` 数据库名称变更是用户修改，后续清理/复核不再检查该项。
- 临时残留只读扫描已排除 .git/node_modules/dist/bin/obj/coverage/.runtime。
- G14t safe source/test roots 未发现 .tmp/.bak/.orig/.rej/.old/.log/.trace/.tsbuildinfo。
- G14t untracked non-ignored files 为空。
- G14t ignored generated evidence retained: XIAOLOU-main\test-results, XIAOLOU-main\playwright-report, XIAOLOU-main\coverage。
- G14t build artifact excluded: XIAOLOU-main\dist。
- G14t protected local config retained without reading contents: XIAOLOU-main\.env.local。
- 本轮未删除任何文件。

Still-open structural lines:
- 账号/设置/头像/钱包额度与组织作用域操作逻辑。
- 前端 owner scope 统一。
- api.ts facade wave-1 runtime 拆分。
- AuthHelpers 后续 error envelope/middleware response-shape 边界。
- AuthHelpers header/env helper wave-1 已完成，facade 名称稳定。
- AuthHelpers ClientAssertionFactory helper split 已完成，facade 名称稳定。
- AuthHelpers ClientAuthProviderValidator helper split 已完成，facade 名称稳定。
- ProjectEndpoints 后续更深 endpoint filter/MapGroup 收敛（G14q load/404/authorize helper 已完成）。
- Playground real transport/stream 仍属后续独立 owner（G14r 已完成 non-stream facade 命名收口）。
- jobs delete/cancel 语义已收口为 dismissTask 主名，deleteTask 兼容 wrapper。
- 穿插清理无关测试数据/配置已完成一轮；后续仍可在实现 owner 之间按需复扫。

Rules:
- inventory first。
- 每轮只处理一个 owner。
- 保留现有 route path、exported API names、response shapes。
- 保留 auth/permission/account-scope 行为，除非当前 owner 明确签收该边界且测试先行。
- 不在同轮混入 backend/frontend behavior、polling/transport/DB/DTO 多边界变更。
- required-synthetic-e2e-stability-monitor 只在 push/PR、required check 不稳定、required-gate/branch-protection mutation 前插队。

Detailed records:
- docs\xiaolouai-refactor-gap-verification.md
- docs\xiaolouai-finalization-handoff.md
- docs\xiaolouai-deep-research-structured.md
```

### 当前可继续队列

```text
DONE G14a payment-notify-canonical-callback-unification
- removed old `/api/payments/{provider}/notify` compatibility aliases from active backend routes
- kept `/api/payments/callbacks/{provider}` as the single callback path
- synced Caddy/IIS examples, permission matrix, README/handoff, and callback route tests
- preserved legacy verifier/evidence records for the old closed aliases

DONE G14b account-settings-navigation-inventory
- inventory-only; changed only handoff/docs
- scanned App routes, Layout shell, ProfileModal, Home, WalletRecharge, CreditUsage
- scanned auth-account, wallet-payment, api.ts types/wrappers, current tests
- current route state: no /settings, /profile, or /account route
- current avatar state: sidebar avatar menu opens ProfileModal directly
- current ProfileModal title is 个人中心, not 账号与个人资料
- current ProfileModal edits displayName/avatar only
- current avatar upload already calls uploadFile(file, "avatar")
- current left-bottom state: button label/title is 更多
- current settings state: profile menu 设置 opens the existing More modal
- current identity switch state: demo/recent account switch lives in the More modal
- current management state: nav has 订单审核 or 管理员登录; profile menu 管理面板 goes /enterprise
- current logout state: profile menu 退出登录 calls handleLogout
- current wallet state: Home and WalletRecharge prefer organization wallet for enterprise roles
- current wallet state: personal paths filter out organization wallets, but final entitlement rules are not centralized
- current credits state: /wallet/usage exists and profile menu links 积分统计
- current credits state: no persistent sidebar credits/statistics item below /assets
- current test candidates recorded in docs before runtime changes

DONE G14c account-profile-contract-and-password-baseline
- docs-only contract/baseline; no runtime behavior change
- UI/product field 用户名 maps to existing displayName
- UI/product field avatarUrl maps to existing avatar
- API/exported names stay getMe, updateMe, PermissionContext, displayName, avatar
- current PUT /api/me body remains displayName/avatar only
- current PUT /api/me response remains PermissionContext
- current ProfileModal edits displayName/avatar only
- current email is read-only in ProfileModal and typed as string|null in User
- target contract: registered account email is required; guest/system can stay null
- target contract: phone is optional
- target contract: defaultOrganizationId/default organization is enterprise-admin/member only
- current defaultOrganizationId remains string|null in User and is not editable through updateMe
- current users table has email, phone_hash, display_name, data; no password_hash
- current backend login/register/member-create DTOs include password but do not read it
- password persistence/hash/verification/reset stays future password-auth-owner

DONE G14d settings-navigation-shell
- changed left-bottom button label/title from 更多 to 设置
- changed left-bottom icon from MoreHorizontal to Settings
- settings modal now exposes 账号与个人资料, 管理面板, and 退出登录
- identity switch remains inside the settings modal
- avatar/profile menu keeps a direct 账号与个人资料 header entry
- preserved route path, status code, response shape, exported API names, DTOs, transport, DB, owner-scope, avatar upload, wallet entitlement, and password-auth boundaries

DONE G14e avatar-media-upload-profile
- kept avatar local file upload on existing uploadFile(file, "avatar") media flow
- save is disabled while upload is in progress so blob preview URLs are not persisted
- avatar upload failure restores the previous actor avatar in ProfileModal
- profile save merges updated displayName/avatar into returned PermissionContext
- Layout sidebar/profile menu continue to render permissionContext.actor.avatar directly
- added synthetic media upload and profile context merge tests
- preserved route path, status code, response shape, exported API names, uploadFile/updateMe compatibility, DTOs, transport, DB, owner-scope, wallet entitlement, and password-auth boundaries

DONE G14f wallet-credit-sidebar-and-entitlements
- added a persistent sidebar 积分统计 item directly below /assets
- centralized frontend wallet entitlement rules in wallet-entitlements helper
- Home wallet display now uses organization wallet for enterprise roles and user wallet for personal accounts
- WalletRecharge exposes rechargeable wallets only to enterprise admins and personal accounts
- enterprise members no longer get a personal/recharge wallet fallback
- CreditUsage reads organization stats for enterprise roles and personal stats for personal accounts
- preserved route paths, status codes, response shapes, exported API names, api.ts wrappers, DTOs, backend, transport, DB, owner-scope migration, avatar upload, and password-auth boundaries
- required gate/branch protection: no workflow/check context/check-run source/branch-protection mutation in this owner
- readback evidence: main still requires `Build and static gates` and `Synthetic browser E2E advisory`, both GitHub Actions app id 15368
- readback evidence: latest origin/main 5fac8ca check-runs for both required contexts were completed/success
- readback evidence: strict=false, enforce_admins=false, required_pull_request_reviews=null, restrictions=null, allow_force_pushes=false, allow_deletions=false
- any future required-gate change still needs separate signoff and before/after/rollback evidence

DONE G14g organization-scope-ui-account-context-plan
- inventoried currentOrganizationId/defaultOrganizationId/currentOrganizationRole usage after G14b-G14f
- current backend source: PostgresIdentityConfigStore BuildPermissionContext derives currentOrganizationId from actor defaultOrganizationId or first organization membership
- current frontend source: account/settings/profile/enterprise/wallet/statistics UI reads getMe PermissionContext and page-local currentOrganizationId lookups
- current compatibility source: wallet-entitlements resolves currentOrganizationId, then actor.defaultOrganizationId, then first enterprise admin/member organization
- service input parameters remain transitional compatibility only: buildControlScopeQuery, buildControlMediaScope, wallet ownerType/ownerId, and accountOwnerType/accountOwnerId query/body fields
- target rule: explicit UI/account context owns current organization selection; service params mirror that context but are not the long-term source of truth
- target rule: defaultOrganizationId is enterprise admin/member only, and personal/guest/ops/super contexts keep organization fields null/empty
- test/migration boundary recorded for G14h/G14i before implementation
- preserved route path, status code, response shape, exported API names, DTOs, runtime behavior, owner-scope migration, wallet entitlement behavior, avatar upload, password-auth, transport, DB, api.ts wrappers, and legacy/deploy evidence
- required gate/branch protection: no workflow/check context/check-run source/branch-protection mutation in this owner
- readback evidence: latest origin/main 5fac8ca check-runs for `Build and static gates` and `Synthetic browser E2E advisory` were completed/success from GitHub Actions app id 15368
- readback evidence: REST required-status-checks still has contexts `Build and static gates` and `Synthetic browser E2E advisory`, app_id 15368, strict=false
- readback evidence: GraphQL branch protection rule for main has requiresStatusChecks=true, requiresStrictStatusChecks=false, requiresApprovingReviews=false, restrictsPushes=false, allowsForcePushes=false, allowsDeletions=false
- readback caveat: full REST branch-protection endpoint returned EOF twice, so this owner used granular REST and GraphQL readbacks; no mutation was attempted
- rollback owner: future required-gate owner only, if separately signed; stable evidence is static scan plus current green remote check-run readback; baseline resets on check-context/source/workflow/protection changes or required-check instability

DONE G14h frontend-owner-scope-contract-inventory
- inventory-only; changed only handoff/docs
- scanned all frontend accountOwnerType/accountOwnerId query/body paths
- inventoried buildControlScopeQuery/buildControlMediaScope callers
- inventoried wallet ownerType/ownerId usage and current organization-derived callsites
- exact files, request body/query assertion candidates, and test candidates are recorded in docs before runtime changes
- current source-of-truth baseline remains G14g explicit UI/account context
- service owner parameters remain transitional compatibility, not long-term source of truth
- preserved route path, status code, response shape, exported API names, DTOs, runtime behavior, owner-scope migration, wallet entitlement behavior, avatar upload, password-auth, transport, polling, DB, deleteTask, api.ts wrappers, and legacy/deploy evidence
- required gate/branch protection: no workflow/check context/check-run source/branch-protection mutation in this owner
- readback evidence: latest origin/main 5fac8ca check-runs for `Build and static gates` and `Synthetic browser E2E advisory` were completed/success from GitHub Actions app id 15368
- readback evidence: REST required-status-checks still has contexts `Build and static gates` and `Synthetic browser E2E advisory`, app_id 15368, strict=false; enforce_admins=false
- readback evidence: GraphQL branch protection rule for main has requiresStatusChecks=true, requiresStrictStatusChecks=false, requiresApprovingReviews=false, restrictsPushes=false, allowsForcePushes=false, allowsDeletions=false
- readback caveat: full REST branch-protection endpoint returned EOF; this owner used granular REST and GraphQL readbacks; no mutation was attempted
- rollback owner: future required-gate owner only, if separately signed; stable evidence is static scan plus current green remote check-run readback; baseline resets on check-context/source/workflow/protection changes or required-check instability

DONE G14i frontend-owner-scope-core-resolver
- added pure frontend ControlOwnerScope/resolveCurrentOwnerScope boundary
- added synthetic resolver tests for personal/default, enterprise admin, enterprise member, guest/ops/super none and explicit fallback, and stale defaultOrganizationId fallback
- kept G14g source-of-truth rules and G14h request-path inventory as planning baseline
- kept service input parameters as transitional compatibility
- did not migrate jobs, media, playground, projects/canvas/create, toolbox, wallet, or api.ts builders in this owner
- preserved route path, status code, response shape, frontend exported API names, DTOs, default personal compatibility, wallet entitlement behavior, avatar upload, settings shell, password auth, transport, polling, DB, deleteTask, api.ts wrappers, and legacy/deploy evidence
- required gate/branch protection: no workflow/check context/check-run source/branch-protection mutation in this owner
- validation: targeted control-owner-scope tests, frontend lint, full unit tests, frontend build, whitespace scan, and git diff --check passed

DONE G14j frontend-owner-scope-jobs-media
- migrated jobs.ts and media.ts onto ControlOwnerScope/resolveCurrentOwnerScope
- jobs create/list now mirror resolved owner scope into accountOwnerType/accountOwnerId
- media upload-begin/upload-complete/move-temp-to-permanent/signed-read-url bodies now mirror resolved owner scope
- kept actorId for createdByUserId, idempotency, and media object-key compatibility
- kept personal/user fallback for no-owner contexts to preserve current service compatibility
- added organization request body/query synthetic tests for jobs and media
- preserved route path, status code, response shape, frontend exported API names, DTOs, api.ts wrappers, password auth, avatar upload, wallet entitlement, settings shell, playground/project/toolbox/wallet migrations, transport, polling, DB, deleteTask, and legacy/deploy evidence
- required gate/branch protection: no workflow/check context/check-run source/branch-protection mutation in this owner
- validation: targeted jobs/media/resolver tests, api compatibility wrapper tests, frontend lint, full unit tests, frontend build, whitespace scan, and git diff --check passed

DONE G14k frontend-owner-scope-projects-canvas-create
- migrated projects-canvas-create.ts onto ControlOwnerScope/resolveCurrentOwnerScope
- project list/create/update now mirror resolved owner scope into query/body accountOwnerType/accountOwnerId
- canvas and agent-canvas list/save/delete now mirror resolved owner scope into query/body accountOwnerType/accountOwnerId
- create image/video list/delete queries mirror resolved owner scope
- create image/video generation keeps delegating to jobsService.createCanonicalJob, whose G14j body scope remains covered
- kept ownerType/organizationId project input fields as transitional compatibility
- preserved default personal fallback compatibility
- added organization request body/query synthetic tests for project, canvas, agent-canvas, and create image/video paths
- preserved route path, status code, response shape, frontend exported API names, DTOs, api.ts wrappers, playground/toolbox/wallet migrations, password auth, avatar upload, wallet entitlement, settings shell, transport, polling, DB, deleteTask, and legacy/deploy evidence
- required gate/branch protection: no workflow/check context/check-run source/branch-protection mutation in this owner
- readback evidence: origin/main 5fac8ca check-runs for `Build and static gates` and `Synthetic browser E2E advisory` are completed/success from GitHub Actions app id 15368
- readback evidence: required contexts remain `Build and static gates` and `Synthetic browser E2E advisory`, app_id 15368, strict=false, enforce_admins=false
- readback evidence: GraphQL main rule requiresStatusChecks=true, requiresStrictStatusChecks=false, requiresApprovingReviews=false, restrictsPushes=false, allowsForcePushes=false, allowsDeletions=false
- rollback owner: future required-gate owner only, if separately signed; baseline resets on check-context/source/workflow/protection changes or required-check instability
- validation: targeted projects/canvas/create and api compatibility wrapper tests, frontend lint, full unit tests, frontend build, whitespace scan, and git diff --check passed

DONE G14l frontend-owner-scope-playground
- migrated playground.ts onto ControlOwnerScope/resolveCurrentOwnerScope
- playground config and memories read queries mirror resolved owner scope
- playground conversation list/get/delete queries mirror resolved owner scope
- playground conversation create/update bodies mirror resolved owner scope
- playground message list queries mirror resolved owner scope
- playground chat-job list/get queries and start body mirror resolved owner scope
- playground memory preference/update bodies and delete query mirror resolved owner scope
- kept signed-out read fallbacks and auth-required write errors stable
- kept streamPlaygroundChat as the existing non-stream facade with no polling/transport changes
- preserved default personal fallback compatibility
- added organization request body/query synthetic tests for conversations, messages, chat-jobs, and memories
- preserved route path, status code, response shape, frontend exported API names, DTOs, api.ts wrappers, toolbox/wallet migrations, password auth, avatar upload, wallet entitlement, settings shell, transport, polling, DB, deleteTask, and legacy/deploy evidence
- required gate/branch protection: no workflow/check context/check-run source/branch-protection mutation in this owner
- readback evidence: origin/main 5fac8ca check-runs for `Build and static gates` and `Synthetic browser E2E advisory` are completed/success from GitHub Actions app id 15368
- readback evidence: required contexts remain `Build and static gates` and `Synthetic browser E2E advisory`, app_id 15368, strict=false, enforce_admins=false
- readback evidence: GraphQL main rule requiresStatusChecks=true, requiresStrictStatusChecks=false, requiresApprovingReviews=false, restrictsPushes=false, allowsForcePushes=false, allowsDeletions=false
- rollback owner: future required-gate owner only, if separately signed; baseline resets on check-context/source/workflow/protection changes or required-check instability
- validation: targeted playground and api compatibility wrapper tests, frontend lint, full unit tests, frontend build, whitespace scan, and git diff --check passed

DONE G14m frontend-api-facade-split-plan
- docs-only inventory and plan; changed only handoff/docs
- scanned api.ts route allowlist, legacy mutation guard, request clients, DTO/type exports, wrapper exports, and service factory wiring
- recorded exact exported runtime API names and DTO/type export buckets in docs
- recorded exact Control API exact-path allowlist and prefix allowlist in docs
- recorded legacy mutation guard behavior: mutating methods, VITE_ALLOW_LEGACY_MUTATIONS, legacy surface predicate, and 410 LEGACY_WRITE_DISABLED envelope
- recorded request client boundary: API_BASE_URL, ApiRequestError, request, controlApiJsonRequest, fetch headers, auth token/client assertion choice, JSON/error parsing
- recorded service factory wiring: walletPayment, authAccount, media, playground, jobs, projectsCanvasCreate, toolbox, adminEnterprise
- G14n wave-1 plan: extract route-policy and control-api-client modules first, keep api.ts as compatibility barrel and keep DTO/type exports in api.ts for now
- preserved route path, status code, response shape, frontend exported API names, default personal compatibility, api.ts wrappers, owner-scope migrations, password/auth/avatar/wallet/settings/polling/transport/DB/deleteTask boundaries, and legacy/deploy evidence
- required gate/branch protection: no workflow/check context/check-run source/branch-protection mutation in this owner
- validation: static api.ts/export/route-policy/service-wiring scans, docs whitespace scan, and git diff --check passed

DONE G14n frontend-api-facade-split-wave-1
- completed 2026-05-06 16:55 +08
- route-policy.ts now owns the exact/prefix Control API allowlists, legacy surface predicate, mutation methods/env flag, and pure block decision
- control-api-client.ts now owns API_BASE_URL, ApiRequestError, assertNoLegacyMutatingRequest, request, controlApiJsonRequest, auth headers, JSON parsing, and error mapping
- api.ts remains the compatibility barrel and wrapper surface
- api.ts re-exports API_BASE_URL and ApiRequestError and keeps DTO/type exports in place
- videoReplaceRequest still uses the same legacy mutation guard behavior
- service factory wiring order and dependencies stayed stable
- targeted route-policy/control-api-client/api-compatibility tests, lint, full unit, build, whitespace scan, and git diff --check passed

DONE G14o backend-auth-boundary-split-plan
- completed 2026-05-06 17:09 +08
- docs/handoff plan only; no runtime module or import moved
- inventoried AuthHelpers as ClientRoutePolicy, AccountScopeAuthorizer, ClientAssertionFactory, header/env helper, client auth provider, and error envelope boundaries
- mapped G14p wave-1 to pure route policy and grant/account-scope policy helper moves only
- G14p should keep AuthHelpers facade names and should not move HTTP middleware, endpoint imports, error envelopes, env configuration, JWT signing, ProjectEndpoints, transport, DB, password, frontend api.ts, or deleteTask semantics

DONE G14p backend-auth-boundary-split-wave-1
- completed 2026-05-06 17:28 +08
- added ClientRoutePolicy under Modules\Auth for public-client classification, anonymous identity classification, and permission mapping
- added AccountScopeAuthorizer under Modules\Auth for pure CSV grant parsing, configured/provider grant matching, and normalized account-scope allow/deny decisions
- AuthHelpers facade method names remain stable for Program.cs and endpoint modules
- ClientApiOptions, ClientAuthenticationResult, and ClientPrincipal shapes stayed in AuthHelpers unchanged
- did not move HTTP middleware, endpoint imports, error envelopes, env option names/defaults, JWT signing/assertion creation, ProjectEndpoints, Playground transport, jobs delete semantics, password auth, frontend api.ts, polling, transport, DB, real SSE/WS/ReadableStream, or deleteTask
- validation passed: targeted AuthHelpersTests 96/96, full ControlApi xUnit 203/203, Release solution build 0 warnings/0 errors

DONE G14q project-endpoint-authorize-helper
- completed 2026-05-06 17:41 +08
- added ProjectEndpoints.LoadAuthorizedProjectAsync for repeated GetProjectAsync -> 404 -> AuthorizeAccountRow flow
- replaced normal project subresource load/404/authorize boilerplate while leaving canvas/agent-canvas/create owners untouched
- added synthetic helper tests for stable 404, account-scope 403 owner mismatch, configured-owner success, and matching account-header success
- preserved route paths, status codes, response shapes, auth/permission/account-scope behavior, exported API names, AuthHelpers facade names, branch protection, and required checks
- validation passed: targeted ProjectEndpointsAuthorizationTests 4/4, full ControlApi xUnit 207/207, Release solution build 0 warnings/0 errors

DONE G14r playground-transport-semantics
- completed 2026-05-06 17:57 +08
- inventoried Playground frontend/backend transport state after G14l/G14n/G14q
- verified backend Playground exposes REST chat-job POST/GET routes only and no SSE/WS/ReadableStream endpoint
- verified Playground page currently uses startPlaygroundChatJob rather than streamPlaygroundChat
- added runPlaygroundChatFacade as the clearer non-stream facade name
- kept streamPlaygroundChat as a stable compatibility export/wrapper over runPlaygroundChatFacade
- covered non-stream event order, pre-abort behavior, no timer/polling transport, and api.ts facade compatibility
- did not introduce real SSE/WebSocket/ReadableStream, route/status/response/auth/account-scope, polling, DB, backend, ProjectEndpoints, AuthHelpers, jobs delete, password, avatar, wallet, settings, or deleteTask changes
- required gate/branch protection unchanged: contexts `Build and static gates` and `Synthetic browser E2E advisory`, source GitHub Actions app id 15368, no branch-protection mutation; rollback owner remains future required-gate owner if separately signed
- validation passed: targeted playground/api compatibility tests 16/16, full frontend unit tests 97/97, frontend lint, frontend build, whitespace scan, and git diff --check

DONE G14s jobs-delete-task-semantics
- completed 2026-05-07 09:13 +08
- inventoried frontend jobs facade, ImageCreate/VideoCreate callsites, api.ts wrappers, backend InternalJobsEndpoints, Auth route policy, and existing tests
- verified backend has no public DELETE `/api/jobs` route
- verified backend public job mutation for this surface is `POST /api/jobs/{jobId}/cancel`
- clarified deleteTask as a compatibility name, not true delete/archive
- added dismissTask as the clearer public facade name
- kept deleteTask as a stable compatibility export/wrapper over dismissTask
- kept route path/body/response behavior stable: GET task first, cancel only active jobs, return `{ deleted: false, taskId }`
- covered missing-task, active cancel, completed no-op, service alias, and api.ts facade compatibility with synthetic tests
- did not change backend jobs endpoints, route/status/response/auth/account-scope behavior, polling/transport/DB, ProjectEndpoints, AuthHelpers, Playground transport, password, avatar, wallet, settings, or unrelated deleteTask behavior
- required gate/branch protection unchanged: contexts `Build and static gates` and `Synthetic browser E2E advisory`, source GitHub Actions app id 15368, no branch-protection mutation; rollback owner remains future required-gate owner if separately signed
- validation passed: targeted jobs/api compatibility tests 14/14, full frontend unit tests 100/100, frontend lint, frontend build, whitespace scan, and git diff --check

DONE G14t test-data-config-cleanup-check
- completed 2026-05-07 09:26 +08
- inventory-only cleanup check after G14s
- used git untracked scan, ignored-path classification, safe-root temp extension scan, and generated-output metadata scan
- non-ignored untracked files: none
- safe source/test roots found no .tmp/.bak/.orig/.rej/.old/.log/.trace/.tsbuildinfo files
- ignored generated evidence retained: XIAOLOU-main\test-results (1 file, 45 bytes), XIAOLOU-main\playwright-report (1 file, 537092 bytes), XIAOLOU-main\coverage (1 file, 2840 bytes)
- ignored build artifact excluded from cleanup without separate signoff: XIAOLOU-main\dist (158 files, 5377015 bytes)
- protected local config retained without reading contents: XIAOLOU-main\.env.local
- tracked examples/test helpers retained: XIAOLOU-main\.env.example, tools\video\video-replace-service\.env.example, scripts\seed_4_assets.js, synthetic fixtures
- did not review the user-confirmed `xiaolou` database-name change as cleanup
- did not read/upload real auth/provider/payment/storage/operator material, production dump/snapshot, real DB fixture, or real object storage
- no files deleted because candidates were generated evidence, excluded build artifact, protected config, or tracked intentional test/example files
- required gate/branch protection unchanged: contexts `Build and static gates` and `Synthetic browser E2E advisory`, source GitHub Actions app id 15368, no branch-protection mutation; rollback owner remains future required-gate owner if separately signed
- validation passed: no untracked files, safe-root residue scan clean, docs/source whitespace scan clean, and git diff --check

DONE G14u backend-auth-remaining-boundary-plan
- completed 2026-05-07 09:34 +08
- docs/handoff plan only; no runtime module or import moved
- inventoried remaining AuthHelpers responsibilities after G14p:
  ClientAssertionFactory, request header/token/bearer readers, ClientApi env/config option readers,
  client auth provider JWT validation/authentication, client permission evaluation, and error envelopes
- verified Program.cs still uses static AuthHelpers facade names for AuthenticateClientRequest,
  ClientAuthenticationResult, ClientPrincipal, and IsClientPermissionAllowed
- verified AccountsAuthEndpoints still calls CreateLocalAuthToken, CreateControlApiClientAssertion, ReadHeader,
  ResolveActorId, ResolvePublicOwnerScope, and account-scope authorization facades
- verified existing tests cover static token header, custom token header, loopback/forwarded denial,
  route policy, account-scope/grant helpers, permission grants, and BadRequest/Forbidden envelopes
- gap recorded: no direct synthetic coverage yet for controlApiClientAssertion JWT claims/signature/TTL,
  auth provider bearer JWT validation, issuer/audience/time-window/skew behavior, Program.cs middleware
  401/403 envelopes, or platform-admin envelope
- future wave order recorded:
  G14v header/env helper first; later ClientAssertionFactory, client auth provider validator,
  and error-envelope/middleware response-shape owners only after focused tests
- kept AuthHelpers facade names, ClientApiOptions, ClientAuthenticationResult, ClientPrincipal,
  route/status/response/auth/permission/account-scope behavior, branch protection, and required checks stable
- required gate/branch protection unchanged: contexts `Build and static gates` and `Synthetic browser E2E advisory`, source GitHub Actions app id 15368, no branch-protection mutation; rollback owner remains future required-gate owner if separately signed
- validation passed: required docs read, dirty worktree scan, AuthHelpers boundary/callsite/test inventory, docs whitespace scan, and git diff --check with CRLF warnings only

DONE G14v backend-auth-header-env-helper-wave-1
- completed 2026-05-07 09:43 +08
- added ClientApiHeaderEnvHelpers under Modules\Auth
- moved request header/token/bearer/forwarded-address logic behind that helper
- moved ClientApi env/config option readers behind that helper
- kept AuthHelpers facade names stable for Program.cs and endpoint modules
- kept ClientApiOptions, ClientAuthenticationResult, and ClientPrincipal shape stable
- added synthetic tests for Authorization bearer fallback, env/config precedence/defaults/aliases,
  provider alias normalization, and clock-skew clamp
- kept existing default/custom token header, forwarded-address denial, and bool parsing tests
- did not move HTTP middleware, endpoint imports outside AuthHelpers, error envelopes,
  JWT signing/assertion creation, client auth provider validation, ProjectEndpoints helpers,
  Playground transport, jobs facade semantics, password auth, avatar upload, wallet entitlement,
  settings shell, frontend api.ts moves, polling/transport/DB, real SSE/WS/ReadableStream,
  deleteTask behavior, or cleanup/delete files
- required gate/branch protection unchanged:
  contexts `Build and static gates` and `Synthetic browser E2E advisory`,
  source GitHub Actions app id 15368, no branch-protection mutation
- validation passed: targeted AuthHelpersTests 103/103, full ControlApi xUnit 214/214,
  Release solution build 0 warnings/0 errors

DONE G14w backend-auth-client-assertion-factory-focused-tests
- completed 2026-05-07 09:51 +08
- added ClientAssertionFactory under Modules\Auth
- added focused synthetic tests before the helper move and kept them green after the move
- moved CreateLocalAuthToken and CreateControlApiClientAssertion responsibilities behind ClientAssertionFactory
- covered local auth token base64 actor/timestamp shape
- covered controlApiClientAssertion null-without-secret behavior
- covered JWT header/payload/signature shape, issuer/audience claims, jti shape,
  explicit permissions, default permissions, organization owner grants,
  current organization claim, and TTL window deltas
- kept AuthHelpers facade method names stable for Program.cs and endpoint modules
- kept ClientApiOptions, ClientAuthenticationResult, and ClientPrincipal shape stable
- did not move client auth provider JWT validation, Program.cs middleware, error envelopes,
  endpoint imports outside AuthHelpers, ProjectEndpoints, Playground transport, jobs facade,
  password auth, avatar upload, wallet entitlement, settings shell, frontend api.ts,
  polling/transport/DB, cleanup/delete files, or branch protection
- required gate/branch protection unchanged:
  contexts `Build and static gates` and `Synthetic browser E2E advisory`,
  source GitHub Actions app id 15368, no branch-protection mutation
- validation passed: targeted AuthHelpersTests 107/107, full ControlApi xUnit 218/218,
  Release solution build 0 warnings/0 errors

DONE G14x backend-auth-provider-jwt-focused-tests
- completed 2026-05-07 09:59 +08
- added ClientAuthProviderValidator under Modules\Auth
- added focused provider/JWT synthetic tests before the helper move and kept them green after the move
- moved HS256 JWT provider validation and provider permission filtering behind ClientAuthProviderValidator
- covered invalid token segments/base64, alg mismatch, signature failure, valid provider principal,
  subject owner grants, issuer/audience checks, exp/nbf/skew behavior,
  scope/scp array/string claims, required-provider mode, static-token fallback,
  and permission grant filtering
- kept AuthHelpers facade method names stable for Program.cs and endpoint modules
- kept ClientApiOptions, ClientAuthenticationResult, and ClientPrincipal shape stable
- did not move Program.cs middleware, error envelopes, endpoint imports outside AuthHelpers,
  ProjectEndpoints, Playground transport, jobs facade, password auth, avatar upload,
  wallet entitlement, settings shell, frontend api.ts, polling/transport/DB,
  cleanup/delete files, or branch protection
- required gate/branch protection unchanged:
  contexts `Build and static gates` and `Synthetic browser E2E advisory`,
  source GitHub Actions app id 15368, no branch-protection mutation
- validation passed: targeted AuthHelpersTests 123/123 before/after helper move,
  full ControlApi xUnit 234/234, Release solution build 0 warnings/0 errors

NEXT G14y backend-auth-error-envelope-middleware-focused-tests
- add focused synthetic tests for backend AuthHelpers/Program.cs error envelope and middleware response shapes
- cover public-client 401/403 JSON, missing requiredPermission JSON,
  account-scope 403 JSON, platform-admin 403 JSON,
  BadRequestError, ForbiddenError, and AccountForbidden shapes
- move or centralize error envelope/middleware response helpers only after focused tests are green
- keep AuthHelpers facade names stable
- keep ClientApiOptions, ClientAuthenticationResult, and ClientPrincipal shape stable
- do not move endpoint imports outside AuthHelpers, ProjectEndpoints, Playground transport,
  jobs facade, password auth, avatar upload, wallet entitlement, settings shell,
  frontend api.ts, polling/transport/DB, cleanup/delete files, or branch protection

FUTURE password-auth-owner
- design password persistence/hash/verification/reset separately
- do not mix it into account profile or settings navigation owners

CONDITIONAL required-synthetic-e2e-stability-monitor
- run only after push/PR, required check instability, or required-gate/branch-protection mutation

DONE archived advisory/preflight owners
- backend/frontend advisory coverage expansions
- coverage-threshold-preflight
- security-required-gate-preflight
- branch-protection-hardening-review
- continue only on explicit request
```

### 推荐下一棒顺序

```text
1. G14y backend-auth-error-envelope-middleware-focused-tests.
2. Future Playground real transport only with separate signed owner and tests.
3. Do not re-check the user-confirmed `xiaolou` database-name change.
4. password-auth-owner remains future standalone work.
5. required-synthetic-e2e-stability-monitor only when its conditional trigger applies.
```

### 下一棒提示词

```text
当前默认下一棒：
- `G14y backend-auth-error-envelope-middleware-focused-tests`

下一棒先读取：
- 根 handoff
- docs\xiaolouai-refactor-gap-verification.md
- docs\xiaolouai-finalization-handoff.md
- docs\xiaolouai-deep-research-structured.md
- 当前 dirty worktree

G14y 只处理：
- add focused synthetic tests for backend AuthHelpers/Program.cs error envelope and middleware response shapes
- move or centralize error envelope/middleware response helpers only after focused tests are in place and green
- cover public-client authentication 401 JSON envelope
- cover client permission 403 JSON envelope and requiredPermission shape
- cover account-scope 403 JSON envelope
- cover platform-admin 403 JSON envelope
- cover BadRequestError, ForbiddenError, and AccountForbidden helper shapes
- keep AuthHelpers facade method names stable for Program.cs and endpoint modules
- keep ClientApiOptions, ClientAuthenticationResult, and ClientPrincipal public/internal shape stable
- preserve route path, status code, response shape, auth/permission/account-scope behavior, exported API names, polling behavior, branch protection, and required checks
- preserve env option names/defaults/precedence exactly
- keep G14g-G14n frontend owner-scope/api facade work as the current planning baseline
- keep G14p AuthHelpers ClientRoutePolicy/AccountScopeAuthorizer split as the backend Auth planning baseline
- keep G14u/G14v/G14w/G14x remaining AuthHelpers boundary plan as the backend Auth planning baseline
- keep G14q ProjectEndpoints authorize helper as the current backend project endpoint baseline
- keep G14r Playground non-stream facade naming as the current transport baseline
- keep G14s jobs dismissTask/deleteTask compatibility naming as the current jobs facade baseline
- keep G14t cleanup inventory/no-delete baseline
- keep G14v ClientApiHeaderEnvHelpers header/env split as current backend Auth baseline
- keep G14w ClientAssertionFactory split as current backend Auth baseline
- keep G14x ClientAuthProviderValidator split as current backend Auth baseline
- do not move AuthHelpers facade names, endpoint imports outside AuthHelpers, ProjectEndpoints helpers, Playground transport, jobs facade semantics, password auth, avatar upload, wallet entitlement, settings shell, frontend api.ts moves, polling/transport/DB, real SSE/WS/ReadableStream, deleteTask behavior, or cleanup/delete files

G14b-G14x 已完成：
- 账号资料/设置/头像/钱包额度/组织作用域操作逻辑
- 头像入口和设置二级菜单都可进入“账号与个人资料”
- 左下角“更多”改“设置”
- 身份切换、管理面板、退出登录进入设置二级菜单
- 用户名是首页显示名
- 头像走现有媒体上传
- 邮箱必填，手机号可选
- 默认组织只给企业管理员/企业员工
- 积分统计放侧边栏资产库下方
- 企业管理员企业钱包
- 企业员工无个人钱包
- 个人账号个人钱包
- 前端 accountOwnerType/accountOwnerId 与 wallet ownerType/ownerId 请求路径已完成 inventory
- ControlOwnerScope/resolveCurrentOwnerScope 纯前端边界已完成 synthetic tests
- jobs/media 已迁移到 resolver，并覆盖 organization 请求体/query synthetic tests
- projects/canvas/create 已迁移到 resolver，并覆盖 organization 请求体/query synthetic tests
- playground 已迁移到 resolver，并覆盖 organization 请求体/query synthetic tests
- api.ts facade split inventory/plan 已完成
- G14n wave-1 低风险拆分顺序已记录
- api.ts route-policy/control-api-client wave-1 已完成，并覆盖 route-policy/control-api-client/api compatibility synthetic tests
- AuthHelpers boundary split inventory/plan 已完成
- G14p wave-1 低风险 backend route-policy/grant helper 顺序已记录
- G14p backend ClientRoutePolicy/AccountScopeAuthorizer wave-1 已完成，并覆盖 facade/direct helper synthetic tests
- ProjectEndpoints load/404/AuthorizeAccountRow helper 已完成，并覆盖 404/403/owner mismatch/success synthetic tests
- Playground runPlaygroundChatFacade non-stream facade 已完成，streamPlaygroundChat 保留 compatibility wrapper，并覆盖 facade compatibility synthetic tests
- Jobs dismissTask 主名已完成，deleteTask 保留 compatibility wrapper，并覆盖 missing/active/completed/alias/api facade synthetic tests
- G14t generated/temp/config/test-data cleanup inventory 已完成；无确认可删项，未删除文件
- G14u remaining AuthHelpers boundary plan 已完成；G14v header/env helper wave-1 顺序和测试边界已记录
- G14v ClientApiHeaderEnvHelpers header/env helper wave-1 已完成，并覆盖 bearer fallback、env/config aliases、provider alias、clock-skew clamp synthetic tests
- G14w ClientAssertionFactory focused tests/helper split 已完成，并覆盖 local auth token、JWT header/payload/signature、null secret、issuer/audience、permissions、organization grants、current organization、TTL synthetic tests
- G14x ClientAuthProviderValidator focused tests/helper split 已完成，并覆盖 invalid JWT、alg/signature、valid provider principal、subject grants、issuer/audience、exp/nbf/skew、scope/scp、required-provider、static fallback、permission filtering synthetic tests

Password:
- 当前只记录未持久化/未校验事实
- 存储、哈希、验证、重置走 future password-auth-owner

Keep stable unless current owner signs the boundary:
- DTO
- route path
- status code
- response shape
- frontend exported API names
- polling/transport/DB owner

Do not:
- delete api.ts compatibility wrappers
- delete legacy verifier/deploy evidence
- review the user-confirmed `xiaolou` database-name change as cleanup
- read/upload real auth/provider/payment/storage/operator material
- read/upload production dump/snapshot, real DB fixture, or real object storage

Required gate / branch protection:
- must be separately signed off
- must record exact check context
- must record CI workflow/check-run source
- must record branch-protection before/after
- must record rollback owner, stable evidence, and baseline-reset conditions
```

## 输出要求

```text
每棒最终输出必须包含：
1. 本棒 owner
2. 修改了哪些文件
3. 运行了哪些验证
4. 是否有 blocker
5. 下一棒建议

每棒完成后同步：
1. XIAOLOU_REFACTOR_HANDOFF.md
2. docs\xiaolouai-finalization-handoff.md
3. docs\xiaolouai-deep-research-structured.md
4. docs\xiaolouai-refactor-gap-verification.md（G14 队列或复核事实变化时）
5. 以上文件保持 PowerShell 友好格式：UTF-8、短行、text 代码块、避免宽表格
```

## 快速验证入口

```powershell
# 后端还原/构建
dotnet restore .\control-plane-dotnet\XiaoLou.ControlPlane.sln
dotnet build .\control-plane-dotnet\XiaoLou.ControlPlane.sln --configuration Release --no-restore

# 后端测试（仅存在测试项目时）
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$testProjects = @(
  Get-ChildItem -Path .\control-plane-dotnet -Recurse -Filter "*Tests*.csproj" -File |
    Sort-Object FullName
)
if ($testProjects.Count -gt 0) {
  foreach ($project in $testProjects) {
    dotnet test $project.FullName --configuration Release --no-restore
  }
} else {
  Write-Host "::notice title=dotnet test skipped::No *Tests*.csproj projects found."
}

# 前端构建
npm --prefix .\XIAOLOU-main run build

# required synthetic browser E2E（合成 harness；check context: Synthetic browser E2E advisory）
npm --prefix .\XIAOLOU-main run test:e2e:synthetic

# 前端 legacy 依赖门禁
.\scripts\windows\verify-frontend-legacy-dependencies.ps1

# 最终 legacy 表面门禁（G11 后默认 retained manifest 模式）
.\scripts\windows\verify-final-legacy-surface.ps1 `
  -CoreApiRoot .\legacy\__missing-core-api `
  -ServicesApiRoot .\legacy\__missing-services-api `
  -LegacySurfaceManifestPath .\legacy-surface-evidence\final-legacy-surface-manifest-g11k.json

# handoff 空白检查
Select-String -Path .\XIAOLOU_REFACTOR_HANDOFF.md,.\docs\xiaolouai-finalization-handoff.md,.\docs\xiaolouai-deep-research-structured.md -Pattern '[ \t]+$'

# git 空白检查
git diff --check
```
