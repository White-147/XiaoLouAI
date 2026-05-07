# XiaoLouAI 短棒交接

更新时间：2026-05-07 12:25 +08
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
G14 latest completed: 2026-05-07 12:45 +08 G14aj password-auth-owner
```

## 当前模块

```text
Owner: G14-refactor-gap-closure（当前无默认 signed runtime owner，等待显式签收）

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
- 2026-05-07 10:13 +08 已完成 G14y AuthErrorEnvelopeResponses focused tests and helper split。
- 2026-05-07 10:22 +08 已完成 G14z backend Auth boundary closeout inventory，无 runtime 行为变化。
- 2026-05-07 10:36 +08 已完成 G14aa frontend owner-scope remaining services inventory，无 runtime 行为变化。
- 2026-05-07 10:47 +08 已完成 G14ab frontend owner-scope API-center wave-1。
- 2026-05-07 10:57 +08 已完成 G14ac frontend owner-scope toolbox wave-1。
- 2026-05-07 11:03 +08 已完成 G14ad frontend owner-scope closeout inventory，无 runtime 行为变化。
- 2026-05-07 11:12 +08 已完成 G14ae next-owner calibration，无 runtime 行为变化。
- 2026-05-07 11:23 +08 已完成 G14af backend Auth ClientApi type file split。
- 2026-05-07 11:46 +08 已完成 G14ag explicit UI/current organization selector。
- 2026-05-07 12:02 +08 已完成 G14ah wallet-payment contract change。
- 2026-05-07 12:25 +08 已完成 G14ai Playground real transport。
- 2026-05-07 12:45 +08 已完成 G14aj password-auth-owner。
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
- PostgreSQL users 表已有 `password_hash` 迁移列。
- `PasswordHashing` 使用 versioned PBKDF2-SHA256 hash，密码明文不写入 profile/permissionContext/registration result。
- `/api/auth/login` 与 `/api/auth/admin/login` 现在要求 email/password 并校验已存 hash；登录不再隐式 seed 用户。
- personal/enterprise register 要求 email/password；无 hash 时写入 hash，已有 hash 时必须密码匹配，避免重新注册重置密码。
- organization member create 会存储提供的初始密码；留空时生成临时密码并通过现有 onboarding.tempPassword/generatedPassword 返回。
- local-only demo-session 仍保持独立，不走密码。
- 自助找回/邮件重置 flow 未实现；如需产品化重置需后续独立签收。

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
- 前端 owner-scope 默认 service runtime 迁移已关闭：
  jobs/media/projects/canvas/create/playground/API-center/toolbox 均走 resolver-backed scope。
- api.ts 不再保留全局 user-only buildControlScopeQuery/buildControlMediaScope。
- wallet-payment 已在 G14ah 改为 resolver-backed 默认 owner contract。
- wallet-payment 无显式 owner 参数时读取当前 owner scope。
- wallet-payment getWallet/listWallets/getWalletUsageStats 导出名保持稳定。
- wallet-payment 显式 ownerType/ownerId 参数仍作为兼容覆盖路径保留。
- wallet-entitlements 仍只负责可见性、充值资格和钱包过滤规则。
- 显式 UI/current organization selector 已在 G14ag 完成，属于产品/账号上下文 baseline。
- api.ts 仍是 compatibility barrel；更深 DTO/barrel 拆分不作为默认 runtime owner。
- AuthHelpers low-risk helper split 已完成到 G14y；G14z 确认无默认 backend Auth runtime 下一棒。
- ClientApiOptions/ClientAuthenticationResult/ClientPrincipal 文件拆分已在 G14af 完成。
- AuthHelpers header/env helper wave-1 已完成，facade 名称稳定。
- AuthHelpers ClientAssertionFactory helper split 已完成，facade 名称稳定。
- AuthHelpers ClientAuthProviderValidator helper split 已完成，facade 名称稳定。
- ProjectEndpoints 更深 endpoint filter/MapGroup 收敛仍需独立签收；不作为默认 owner。
- Playground real transport 已在 G14ai 完成：
  streamPlaygroundChat 走 `/api/playground/chat` SSE/ReadableStream，
  runPlaygroundChatFacade 保持非流式 chat-job facade。
- ClosedApiWorker/provider adapter 仍是 stubbed-simulated；
  G14ai 未引入真实 provider credentials、DB schema 或 provider adapter 变更。
- jobs delete/cancel 语义已收口为 dismissTask 主名，deleteTask 兼容 wrapper。
- password-auth-owner 已在 G14aj 完成初始存储、哈希、登录校验和成员临时密码路径。
- 穿插清理无关测试数据/配置已完成一轮；后续仍可在实现 owner 之间按需复扫。
- G14aj 后仍无默认 signed runtime owner；任何候选都必须由用户显式签收。

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

DONE G14y backend-auth-error-envelope-middleware-focused-tests
- completed 2026-05-07 10:13 +08
- added AuthErrorEnvelopeResponses under Modules\Auth
- added focused synthetic tests before helper centralization and kept them green after the move
- centralized public-client auth failure and permission failure response writers for Program.cs
- centralized BadRequestError, ForbiddenError, AccountForbidden, and platform-admin envelopes
  behind the Auth helper while keeping AuthHelpers facade method names stable
- covered public-client authentication 401 JSON, public-client forwarded-address 403 JSON,
  client permission 403 JSON with requiredPermission, account-scope 403 JSON,
  platform-admin 403 JSON, BadRequestError, ForbiddenError, and AccountForbidden shapes
- kept ClientApiOptions, ClientAuthenticationResult, and ClientPrincipal shape stable
- did not move endpoint imports outside AuthHelpers, ProjectEndpoints, Playground transport,
  jobs facade, password auth, avatar upload, wallet entitlement, settings shell,
  frontend api.ts, polling/transport/DB, cleanup/delete files, or branch protection
- required gate/branch protection unchanged:
  contexts `Build and static gates` and `Synthetic browser E2E advisory`,
  source GitHub Actions app id 15368, no branch-protection mutation
- validation passed: targeted Modules.Auth xUnit 128/128 before/after helper move,
  full ControlApi xUnit 239/239, Release solution build 0 warnings/0 errors,
  git diff --check clean except LF/CRLF warnings

DONE G14z backend-auth-boundary-closeout-inventory
- completed 2026-05-07 10:22 +08
- docs/handoff inventory only; no runtime module, import, route, status, response, or Auth behavior changed
- inventoried Auth module after G14v-G14y:
  AccountScopeAuthorizer, AuthErrorEnvelopeResponses, ClientApiHeaderEnvHelpers,
  ClientAssertionFactory, ClientAuthProviderValidator, ClientRoutePolicy, and AuthHelpers facade
- confirmed AuthHelpers now primarily keeps stable facade methods, actor/platform-admin glue,
  account-scope facade glue, dictionary/row/json reader glue, normalization helpers,
  and the ClientApiOptions/ClientAuthenticationResult/ClientPrincipal type declarations
- confirmed Program.cs still owns HTTP middleware control flow for internal, operational,
  and public-client request classification
- confirmed Program.cs public-client 401/403 response bodies now write through AuthErrorEnvelopeResponses
- confirmed Program.cs internal and operational 403 envelopes remain local Program.cs responses
- confirmed endpoint modules still import AuthHelpers facade via static imports;
  no endpoint imports were moved to direct helper imports
- next Auth decision:
  no default backend Auth runtime owner remains after G14v-G14y
- optional low-risk Auth owner if separately signed:
  move ClientApiOptions, ClientAuthenticationResult, and ClientPrincipal declarations
  to a dedicated Auth types file with compile/shape tests
- required gate/branch protection unchanged:
  contexts `Build and static gates` and `Synthetic browser E2E advisory`,
  source GitHub Actions app id 15368, no branch-protection mutation
- validation passed: required docs read, dirty worktree scan,
  AuthHelpers/Program.cs/callsite inventory, docs whitespace scan,
  git diff --check clean except LF/CRLF warnings

DONE G14aa frontend-owner-scope-remaining-services-inventory
- completed 2026-05-07 10:36 +08
- docs/handoff inventory only; no runtime module, import, route, status, response, or frontend export changed
- scanned api.ts, control-owner-scope.ts, auth-account.ts, toolbox.ts, wallet-payment.ts,
  wallet-entitlements.ts, ApiCenter, Home, WalletRecharge, CreditUsage, and current synthetic tests
- confirmed jobs, media, projects/canvas/create, and playground use ControlOwnerScope/resolveCurrentOwnerScope
- confirmed at G14aa time that auth-account API-center routes depended on buildControlScopeQuery()
  and api.ts hardcoded accountOwnerType=user/accountOwnerId=getCurrentActorId for that builder
- confirmed at G14aa time that toolbox write routes depended on buildControlMediaScope(actorId)
  and api.ts hardcoded accountOwnerType=user/accountOwnerId=actorId for that body scope
- confirmed wallet-payment is different: exported wallet APIs take explicit ownerType/ownerId,
  map platform to accountOwnerType=system, and page callers use wallet-entitlements to provide owner scope
- confirmed api.ts remains compatibility barrel and service wiring surface;
  at G14aa time it still owned the legacy user-only scope builders for auth-account/toolbox
- next owner decision:
  G14ab should migrate API-center scope first after focused tests,
  then toolbox can be a later owner; wallet-payment has no default runtime migration owner
- required gate/branch protection unchanged:
  contexts `Build and static gates` and `Synthetic browser E2E advisory`,
  source GitHub Actions app id 15368, no branch-protection mutation
- validation passed: required docs read, dirty worktree scan,
  frontend owner-scope static inventory via git grep and file reads,
  docs whitespace scan, git diff --check clean except LF/CRLF warnings

DONE G14ab frontend-owner-scope-auth-account-api-center-wave-1
- completed 2026-05-07 10:47 +08
- added focused synthetic tests before moving API-center scope construction
- migrated only auth-account/API-center query construction from api.ts user-only buildControlScopeQuery
  to resolver-backed owner scope via createAuthAccountService deps
- covered default personal API-center query paths for getApiCenterConfig and updateApiCenterDefaults
- covered organization API-center query paths through ControlOwnerScope/resolveCurrentOwnerScope
  for saveApiCenterVendorApiKey, testApiCenterVendorConnection, and updateApiVendorModel
- kept api.ts compatibility exports stable and covered the five API-center facade names
- removed api.ts global buildControlScopeQuery because auth-account no longer consumes it
- kept toolbox, wallet-payment, jobs/media/projects/playground, polling/transport/DB,
  backend Auth, password/avatar/wallet entitlement rules, cleanup/delete files,
  route path, status code, response shape, request body shape, required checks,
  and branch protection unchanged
- validation passed:
  targeted API-center/auth-account and api compatibility tests 12/12,
  full frontend unit 100/100, frontend lint, frontend build,
  frontend legacy dependency verifier exit 0 with blockers 0 and advisory warnings,
  git grep confirmed api.ts no longer owns buildControlScopeQuery

DONE G14ac frontend-owner-scope-toolbox-wave-1
- completed 2026-05-07 10:57 +08
- added focused synthetic tests before moving toolbox scope body construction
- first targeted run failed as expected on old buildControlMediaScope/factory deps
- migrated only toolbox scope body construction from api.ts user-only buildControlMediaScope(actorId)
  to resolver-backed owner scope via createToolboxService deps
- covered default personal toolbox body path for translateText
- covered organization toolbox body paths through ControlOwnerScope/resolveCurrentOwnerScope
  for reverseVideoPrompt and runToolboxCapability routes
- covered generateStoryboardGrid25 body path and stable request body/idempotency shape
- kept api.ts compatibility exports stable and covered translateText,
  generateStoryboardGrid25, reverseVideoPrompt, and runToolboxCapability facade names
- removed api.ts global buildControlMediaScope because toolbox no longer consumes it
- kept G14ab API-center resolver-backed query and wallet-payment explicit owner contract stable
- kept jobs/media/projects/playground, polling/transport/DB, backend Auth,
  password/avatar/wallet entitlement rules, cleanup/delete files, route path,
  status code, response shape, request body shape, required checks,
  and branch protection unchanged
- validation passed:
  targeted toolbox/api compatibility tests 10/10,
  full frontend unit 100/100, frontend lint, frontend build,
  frontend legacy dependency verifier exit 0 with blockers 0 and advisory warnings,
  git grep confirmed api.ts no longer owns buildControlMediaScope

DONE G14ad frontend-owner-scope-closeout-inventory
- completed 2026-05-07 11:03 +08
- docs/handoff inventory only; no runtime module, import, route, status, response,
  frontend export, polling, transport, DB, backend Auth, cleanup, or branch protection changed
- inventoried api.ts wiring, control-owner-scope.ts, auth-account.ts, toolbox.ts,
  wallet-payment.ts, wallet-entitlements.ts, and accountOwnerType/accountOwnerId callsites
- confirmed api.ts wires auth-account, jobs, media, playground,
  projects/canvas/create, and toolbox to resolveCurrentControlOwnerScope
- confirmed api.ts no longer owns global user-only buildControlScopeQuery
  or buildControlMediaScope
- confirmed remaining buildControlScopeQuery/buildControlMediaScope names are local service helpers
  in auth-account, jobs, media, playground, projects-canvas-create, and toolbox
- confirmed those local service helpers receive ControlOwnerScope/resolveCurrentOwnerScope
  and keep personal fallback compatibility
- confirmed API-center keeps G14ab resolver-backed query behavior
- confirmed toolbox keeps G14ac resolver-backed body behavior
- confirmed wallet-payment remains an explicit ownerType/ownerId contract
  and maps platform to accountOwnerType=system
- confirmed wallet-entitlements/page callers still provide wallet owner requests explicitly
- decision: no default low-risk frontend owner-scope runtime owner remains
- optional future UI/current organization selector owner requires separate product signoff
- optional wallet-payment contract change requires separate signed owner and tests
- required gate/branch protection unchanged:
  contexts `Build and static gates` and `Synthetic browser E2E advisory`,
  source GitHub Actions app id 15368, no mutation performed
- validation:
  required docs read, dirty worktree scan, git grep/file-read inventory,
  docs whitespace scan, git diff --check clean except LF/CRLF warnings

DONE G14ae refactor-gap-closure-next-owner-calibration
- completed 2026-05-07 11:12 +08
- docs/handoff calibration only; no runtime module, import, route, status, response,
  frontend export, polling, transport, DB, backend Auth, cleanup, or branch protection changed
- re-read backend Auth closeout and frontend owner-scope closeout baselines
- inventoried remaining signed-only structural lines:
  backend Auth ClientApi type file split,
  explicit UI/current organization selector,
  wallet-payment contract change,
  Playground real transport,
  password-auth-owner
- confirmed no default backend Auth runtime owner remains after G14z
- confirmed no default frontend owner-scope runtime owner remains after G14ad
- confirmed ClientApiOptions/ClientAuthenticationResult/ClientPrincipal still live in AuthHelpers.cs
  and are referenced across endpoint modules through existing AuthHelpers/Auth types imports
- confirmed current organization selection remains permission-context/page-local behavior,
  not a signed product selector owner
- confirmed wallet-payment remains explicit ownerType/ownerId contract
- confirmed Playground remains REST chat-job/non-stream facade; no real EventSource/WebSocket/ReadableStream owner is signed
- confirmed password fields exist in DTO/UI, but storage/hash/verification/reset remains future standalone work
- decision:
  no next signed runtime owner should be default without explicit user signoff
- required gate/branch protection unchanged:
  contexts `Build and static gates` and `Synthetic browser E2E advisory`,
  source GitHub Actions app id 15368, no mutation performed
- validation:
  required docs read, dirty worktree scan, signed-owner static inventory,
  docs whitespace scan, git diff --check clean except LF/CRLF warnings

DONE G14af backend-auth-clientapi-types-file-split
- completed 2026-05-07 11:23 +08
- user explicitly signed backend Auth ClientApi type file split after G14ae
- added focused ClientApi type shape/default tests before moving the types
- moved ClientApiOptions, ClientAuthenticationResult, and ClientPrincipal
  from AuthHelpers.cs to Modules\Auth\ClientApiTypes.cs
- kept type names, internal shape, constructors/properties/static factory methods,
  ClientPrincipal.ItemKey, ClientPrincipal.ForStaticToken, and StatusCodes mapping stable
- kept AuthHelpers facade method names stable for Program.cs and endpoint modules
- did not move HTTP middleware control flow, endpoint imports outside AuthHelpers,
  route/status/response/auth/permission/account-scope behavior,
  env option names/defaults/precedence, or branch protection
- validation:
  pre-move AuthHelpersTests 126/126,
  post-move AuthHelpersTests 126/126,
  full ControlApi xUnit 242/242,
  Release solution build 0 warnings/0 errors

DONE G14ag explicit-ui-current-organization-selector
- completed 2026-05-07 11:46 +08
- user explicitly signed explicit UI/current organization selector after G14af
- added focused current-organization selector synthetic tests before runtime wiring
- added CurrentOrganizationSelection helper storage/read/apply/set behavior
- added settings-modal current organization select for multi-organization customers
- wired api.ts resolveCurrentControlOwnerScope to honor stored explicit organization selection
- normalized getMe/updateMe/login/register/demo/google PermissionContext results
  through the selected current organization without changing facade export names
- kept API-center/toolbox resolver-backed owner scope baselines stable
- kept wallet-payment explicit ownerType/ownerId contract unchanged
- did not move HTTP middleware control flow, backend Auth, ProjectEndpoints,
  Playground transport, jobs facade semantics, password auth, avatar upload,
  wallet entitlement rules, polling/transport/DB, deleteTask behavior,
  cleanup/delete files, required checks, or branch protection
- validation:
  pre-helper selector test red as expected,
  focused selector tests 3/3,
  api compatibility tests 5/5,
  full frontend unit 104/104,
  frontend lint,
  frontend build

DONE G14ah wallet-payment-contract-change
- completed 2026-05-07 12:02 +08
- user explicitly signed wallet-payment contract change after G14ag
- added focused wallet-payment synthetic tests before runtime wiring
- pre-change wallet-payment tests failed as expected on old actor-default contract
- wired createWalletPaymentService to resolveCurrentOwnerScope
- changed omitted getWallet/listWallets/getWalletUsageStats args to use resolver-backed owner scope
- kept explicit ownerType/ownerId args as compatibility overrides
- kept platform owner mapping to accountOwnerType=system
- wired api.ts walletPaymentService to resolveCurrentControlOwnerScope
- kept getWallet/listWallets/getWalletUsageStats exported names stable
- changed Home, WalletRecharge, and CreditUsage wallet reads to omit explicit owner args
- kept wallet-entitlements as visibility/recharge/filter rules, not request owner construction
- did not change wallet entitlement rules, payment write closure, payment callback routes,
  route path, status code, response shape, frontend exported API names,
  polling/transport/DB, backend Auth, password auth, avatar upload,
  settings shell, deleteTask behavior, cleanup/delete files,
  required checks, or branch protection
- validation:
  pre-change wallet-payment test red as expected on old default owner behavior,
  focused wallet-payment tests 10/10,
  api compatibility tests 5/5,
  full frontend unit 107/107,
  frontend lint,
  frontend build,
  frontend legacy dependency verifier exit 0 with blockers 0 and existing warnings,
  git diff --check clean except LF/CRLF warnings

DONE G14ai playground-real-transport
- completed 2026-05-07 12:25 +08
- user explicitly signed Playground real transport after G14ah
- added POST `/api/playground/chat` SSE endpoint over existing PlaygroundChatRequest
- reused StartChatJobAsync, existing owner scope, auth/permission/account-scope behavior,
  and chat-job response event shapes
- added controlApiStreamRequest with shared Control API auth headers
- changed streamPlaygroundChat to fetch and parse ReadableStream SSE events
- kept runPlaygroundChatFacade as the stable non-stream chat-job facade
- changed Playground page submit flow to use streamPlaygroundChat event handling
  while keeping active-job polling
- kept frontend exported API names stable
- did not change password auth, backend Auth middleware, ProjectEndpoints,
  jobs facade semantics, wallet-payment, API-center, toolbox, avatar upload,
  wallet entitlement rules, DB schema, provider adapter credentials,
  cleanup/delete files, required checks, or branch protection
- validation:
  focused playground/control-client/route-policy/api compatibility tests 31/31,
  backend route/response-shape tests 100/100,
  full frontend unit 110/110,
  frontend lint,
  frontend build,
  full ControlApi xUnit 244/244,
  Release solution build 0 warnings/0 errors,
  git diff --check clean except LF/CRLF warnings
- required gate/branch protection unchanged:
  contexts `Build and static gates` and `Synthetic browser E2E advisory`,
  source GitHub Actions app id 15368,
  no branch-protection mutation
- blocker: none
- next default owner: none-await-explicit-owner-signoff

DONE G14aj password-auth-owner
- completed 2026-05-07 12:45 +08
- user explicitly signed password-auth-owner after G14ai
- added `users.password_hash` to canonical PostgreSQL migration
- added internal versioned PBKDF2-SHA256 password hashing helper
- login now requires email/password, verifies stored password_hash, and no longer seeds users on login
- personal/enterprise registration now requires email/password and writes password_hash when missing
- existing registrations with a password_hash must match the supplied password, preventing re-register reset
- organization member create stores provided initial passwords, or generates a temporary password when blank
- generated member passwords are returned only through existing onboarding.tempPassword/generatedPassword shape
- platform admin/root emails are rejected from self-registration/member-create paths
- demo-session remains local-only and independent of password auth
- self-service password reset/email flow remains unimplemented and would need a future explicit owner
- did not change DTO names, route paths, success response shapes, frontend exported API names,
  AuthHelpers facade names, Program.cs middleware, ProjectEndpoints, Playground transport,
  jobs facade semantics, API-center, toolbox, wallet-payment, avatar upload, wallet entitlement rules,
  settings shell, cleanup/delete files, required checks, or branch protection
- validation:
  pre-helper PasswordHashing test red as expected,
  focused password/auth response-shape tests 9/9,
  full ControlApi xUnit 253/253,
  Release solution build 0 warnings/0 errors,
  targeted frontend auth/api compatibility tests 13/13,
  git diff --check clean except LF/CRLF warnings
- required gate/branch protection unchanged:
  contexts `Build and static gates` and `Synthetic browser E2E advisory`,
  source GitHub Actions app id 15368,
  no branch-protection mutation
- blocker: none
- next default owner: none-await-explicit-owner-signoff

NO DEFAULT signed runtime owner
- backend Auth ClientApi type split is complete
- explicit UI/current organization selector is complete
- wallet-payment contract change is complete
- Playground real transport is complete
- password-auth-owner is complete for initial storage/hash/login verification/member temporary password
- no default signed runtime owner remains
- required-synthetic-e2e-stability-monitor remains conditional only

FUTURE password-reset-owner
- only if explicitly signed, design self-service password reset/email recovery separately
- do not mix it into account profile, settings navigation, or existing member initial-password owner

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
1. No default signed runtime owner after G14aj.
2. Self-service password reset/email recovery remains future standalone work only if explicitly signed.
3. Do not re-check the user-confirmed `xiaolou` database-name change.
4. required-synthetic-e2e-stability-monitor only when its conditional trigger applies.
```

### 下一棒提示词

```text
当前默认下一棒：
- `none-await-explicit-owner-signoff`

下一棒先读取：
- 根 handoff
- docs\xiaolouai-refactor-gap-verification.md
- docs\xiaolouai-finalization-handoff.md
- docs\xiaolouai-deep-research-structured.md
- 当前 dirty worktree

当前状态：
- G14aj 已完成 password-auth-owner
- no default signed runtime owner remains
- 下一棒必须由用户显式签收具体 owner 后才能开始
- optional signed-only owners:
  none currently queued
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
- keep G14y AuthErrorEnvelopeResponses split as current backend Auth baseline
- keep G14z backend Auth closeout inventory/no-default-runtime-owner decision as current backend Auth baseline
- keep G14aa frontend owner-scope remaining services inventory as current frontend planning baseline
- keep G14ab API-center resolver-backed query behavior as current frontend API-center baseline
- keep G14ac toolbox resolver-backed body behavior as current frontend toolbox baseline
- keep G14ad frontend owner-scope closeout/no-default-runtime-owner decision as current frontend owner-scope baseline
- keep G14ae no-default-signed-runtime-owner decision as current G14 closeout baseline
- keep G14af ClientApiTypes.cs split as current backend Auth type baseline
- keep G14ag explicit UI/current organization selector as current frontend account context baseline
- keep G14ah wallet-payment resolver-backed default owner contract as current wallet baseline
- keep G14ai Playground real transport as current transport baseline
- keep G14aj password auth storage/hash/login verification/member temporary password as current password baseline
- do not move HTTP middleware control flow, AuthHelpers facade names, endpoint imports outside AuthHelpers, ProjectEndpoints helpers, Playground transport beyond the G14ai `/api/playground/chat` SSE boundary, jobs facade semantics, API-center, toolbox, wallet-payment, password auth beyond the G14aj baseline, avatar upload, wallet entitlement rules, settings shell, frontend exported API names, polling/transport/DB outside Playground stream route, deleteTask behavior, or cleanup/delete files

G14b-G14aj 已完成：
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
- G14y AuthErrorEnvelopeResponses focused tests/helper split 已完成，并覆盖 public-client 401/403、permission requiredPermission、account-scope、platform-admin、BadRequestError、ForbiddenError、AccountForbidden synthetic tests
- G14z backend Auth boundary closeout inventory 已完成；无默认 backend Auth runtime 下一棒，ClientApi types 文件拆分仅为可选独立签收项
- G14aa frontend owner-scope remaining services inventory 已完成；API-center/toolbox 后续 owner 已记录，wallet-payment 保持 explicit ownerType/ownerId contract
- G14ab API-center 已迁移到 resolver-backed owner scope，并覆盖 personal/organization query 与五个稳定 facade 名称 synthetic tests
- G14ac toolbox 已迁移到 resolver-backed owner scope，并覆盖 personal/organization body 与四个稳定 facade 名称 synthetic tests
- G14ad frontend owner-scope closeout inventory 已完成；无默认 low-risk frontend owner-scope runtime 下一棒
- wallet-payment 保持 explicit ownerType/ownerId contract；如要改需单独签收
- G14ae next-owner calibration 已完成；无默认 signed runtime 下一棒，等待显式签收
- G14af backend Auth ClientApi type file split 已完成；ClientApiOptions、ClientAuthenticationResult、ClientPrincipal 已移到 ClientApiTypes.cs，并覆盖 type shape/default synthetic tests
- G14ag explicit UI/current organization selector 已完成；设置面板多组织下可显式选择当前组织，api.ts resolver-backed services 会读取该选择
- G14ah wallet-payment contract change 已完成；wallet-payment 默认读取 resolver-backed owner scope，显式 ownerType/ownerId 参数保留兼容覆盖
- G14ai Playground real transport 已完成；streamPlaygroundChat 走 `/api/playground/chat` SSE/ReadableStream，runPlaygroundChatFacade 保持非流式 chat-job facade
- G14aj password-auth-owner 已完成；users.password_hash、PBKDF2-SHA256 hash、登录校验、注册写入、成员临时密码均已落地

Password:
- users.password_hash 已加入 canonical migration
- PasswordHashing 使用 versioned PBKDF2-SHA256
- login/admin-login 要求 email/password 并校验 hash；登录不再 seed 用户
- register personal/enterprise 写入或验证已有 hash；不能用重新注册重置密码
- organization member create 可存储初始密码，空密码会生成 onboarding.tempPassword
- demo-session 不走密码
- self-service reset/email recovery 未实现；如需产品化重置必须另行签收

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

## 2026-05-07 G14ak-G14am follow-up closeout

```text
Owner:
- G14ak current-organization-stale-selection-cleanup
- G14al password-auth-followup-bootstrap-change-reset
- G14am password-auth-db-backed-integration-layer

User signoff:
- User requested current organization stale local selection cleanup.
- User requested password-auth-owner follow-up.
- User requested DB-backed integration coverage for the password flow.

Completed:
- Current organization local selection now validates stored localStorage choice
  against the latest PermissionContext for that actor.
- Malformed stored current organization selections are removed.
- Stale organization selections are removed when the latest context no longer
  grants that organization.
- Stored owner scope now uses the latest organization role instead of stale
  local data.
- Password follow-up added local-only platform password bootstrap for
  reserved admin actors.
- Password follow-up added authenticated self password change.
- Password follow-up added platform-admin password reset for existing users.
- Frontend API facade exports were extended for bootstrap/change/admin-reset
  without removing compatibility wrappers.
- DB-backed password integration tests were added behind the explicit
  XIAOLOU_TEST_POSTGRES_CONNECTION_STRING opt-in.

Stable boundaries:
- Route paths/status/success response shape stay stable except for the newly
  signed password routes.
- AuthHelpers facade names and Program.cs middleware control flow stay stable.
- ClientApiOptions, ClientAuthenticationResult, and ClientPrincipal shape stay
  stable.
- api.ts compatibility wrappers remain.
- No branch-protection, required check, workflow, provider credential,
  payment material, real object storage, production dump/snapshot, or real DB
  fixture was read or changed.

Validation:
- current-organization focused red pre-check failed as expected before helper
  implementation.
- current-organization focused tests passed 5/5 after implementation.
- focused backend auth/response/password tests passed 151/151.
- focused frontend current-organization/auth/API compatibility tests passed
  19/19.
- full frontend unit passed 113/113.
- full backend xUnit passed 262/262.
- frontend lint passed.
- frontend build passed.
- backend Release solution build passed with 0 warnings and 0 errors.

DB-backed test note:
- The new integration test is guarded by
  XIAOLOU_TEST_POSTGRES_CONNECTION_STRING.
- It refuses database names that do not include test or synthetic.
- Without that env var, local validation does not touch a database.

Blocker:
- none for G14ak-G14am.

Next default:
- none-await-explicit-owner-signoff.

Optional future owner:
- password-recovery-audit-owner for self-service recovery, reset tokens,
  rate limiting, audit log, and operator documentation.
```

## 2026-05-07 G14an password-recovery-audit-owner

```text
completed: 2026-05-07
owner: G14an password-recovery-audit-owner
scope: signed password recovery token/audit/rate-limit foundation

password storage note:
- There is no plaintext password column by design.
- The column is users.password_hash.
- If an existing database does not show users.password_hash, the canonical
  PostgreSQL migration has not been applied to that database.

changed:
- control-plane-dotnet\db\migrations\20260501_windows_native_core.sql
- control-plane-dotnet\src\XiaoLou.Domain\ControlPlaneContracts.cs
- control-plane-dotnet\src\XiaoLou.ControlApi\Modules\Accounts\AccountsAuthEndpoints.cs
- control-plane-dotnet\src\XiaoLou.ControlApi\Modules\Auth\ClientRoutePolicy.cs
- control-plane-dotnet\src\XiaoLou.Infrastructure.Postgres\PasswordHashing.cs
- control-plane-dotnet\src\XiaoLou.Infrastructure.Postgres\PostgresIdentityConfigStore.cs
- control-plane-dotnet\tests\XiaoLou.ControlApi.Tests\Modules\Auth\AuthHelpersTests.cs
- control-plane-dotnet\tests\XiaoLou.ControlApi.Tests\Modules\Auth\PasswordAuthPostgresIntegrationTests.cs
- control-plane-dotnet\tests\XiaoLou.ControlApi.Tests\Modules\BackendAdvisory\BackendAdvisoryEndpointResponseShapeTests.cs
- XIAOLOU-main\src\lib\api.ts
- XIAOLOU-main\src\lib\api\auth-account.ts
- XIAOLOU-main\src\lib\api\__tests__\auth-account.test.ts
- XIAOLOU-main\src\lib\api\__tests__\api-compatibility-wrappers.test.ts

result:
- Added password_reset_tokens table.
- Reset tokens are stored only as token_hash.
- Reset token plaintext is generated only for delivery.
- External reset-request responses do not echo resetToken.
- Local loopback reset-request responses may echo resetToken for dev/test
  while no email adapter exists.
- Reset complete consumes exactly one issued, unexpired token.
- Successful reset revokes other issued tokens for the actor.
- Added password_auth_audit_events table.
- Audit rows store event_type, outcome, actor_id, email_hash, and jsonb data.
- Added simple reset-request rate limit: 3 requests per actor per 15 minutes.
- Added frontend facade exports requestPasswordReset and completePasswordReset.

not changed:
- No plaintext password storage.
- No real email/provider credential/operator material.
- No production dump/snapshot, real DB fixture, or real object storage.
- No branch protection, required check, or workflow mutation.
- Existing login/register/change/admin-reset exported names remain stable.

validation:
- focused backend auth/response/password tests passed 156/156.
- focused frontend auth/API compatibility tests passed 14/14.
- full backend xUnit passed 267/267.
- full frontend unit passed 113/113.
- frontend lint passed.
- frontend build passed.
- backend Release solution build passed with 0 warnings and 0 errors.

DB-backed note:
- PasswordAuthPostgresIntegrationTests still require explicit
  XIAOLOU_TEST_POSTGRES_CONNECTION_STRING.
- The test refuses non-test/non-synthetic database names.
- Without that env var, local validation does not touch a database.

blocker:
- none for G14an.

next default:
- none-await-explicit-owner-signoff.

optional future owners:
- password-email-delivery-owner for real mail adapter and templates.
- password-auth-admin-ui-owner for management UI.
```
