# XiaoLouAI 短棒交接

更新时间：2026-05-05 18:57 +08
工作目录：`D:\code\XiaoLouAI`

本文件是后续每一棒的第一读取文件。根短棒只保留总进度、固定边界、当前 owner/队列提示词和验证入口；历史细节见 docs handoff：

```text
docs\xiaolouai-finalization-handoff.md
docs\xiaolouai-deep-research-structured.md
docs\xiaolouai-legacy-physical-archive-contract.md
```

## PowerShell 读取

```powershell
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Get-Content .\XIAOLOU_REFACTOR_HANDOFF.md -Encoding UTF8
Get-Content .\docs\xiaolouai-finalization-handoff.md -Encoding UTF8
Get-Content .\docs\xiaolouai-deep-research-structured.md -Encoding UTF8
Get-Content .\docs\xiaolouai-legacy-physical-archive-contract.md -Encoding UTF8
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
禁止让 legacy payment notify 默认开启。
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
G12a backend-module-refactor: done
G12b frontend-api-service-layer: done
G12c domain-dto-contract-review: done
G12d shared-helper-and-dependency-cleanup: done
G12e test-harness-planning: done
G12f test-harness-implementation: done
G13-post-4 frontend-test-harness-and-coverage-advisory: done
G13-post-4a frontend-coverage-report-advisory-script: done
G13-post-4b api-compatibility-wrapper-runtime-tests: done
G13-post-4c frontend-polling-stream-fake-timer-tests: done
G13-post-4d frontend-synthetic-fixture-redaction-pack: done
G13-post-5 synthetic-e2e-smoke-harness-precondition-plan: done
G13-post-2 security-baseline-nonblocking-execution: done
G13-post-2a npm-audit-vite-postcss-remediation-plan: done
G13-post-2b npm-audit-vite-postcss-lockfile-update: done
G13-post-1a ci-typecheck-fix-api-compat-wrapper-tests: done
G13-post-1 branch-protection-enable: done
```

## 当前模块

```text
Owner: G13 deferred CI/Test gate follow-up
当前: G12a backend modules done; G12b frontend API service layer done through G12b-9; G12c DTO contract inventory/split/snapshot plan done; G12d cleanup done through G12d-2; G12e backend/frontend test-harness plans done; G12f backend harness done through AuthHelpers/Health/Metrics client-token tests; G12f frontend Vitest test:unit harness now covers Admin/Enterprise, Auth/Account, Jobs public facade, Playground non-stream plus polling/stream fake-timer boundaries, Media upload, Toolbox, Wallet/Payment, Projects/Canvas/Create service factory tests, api.ts compatibility wrapper runtime tests, and shared synthetic fixture/redaction helper tests. G13-post-4 through G13-post-4d frontend harness/advisory owners are complete, G13-post-5 completed synthetic E2E smoke harness precondition planning, G13-post-2 ran non-blocking security baseline execution, G13-post-2a completed npm audit remediation planning, G13-post-2b updated the lockfile/install resolution to Vite 6.4.2 plus PostCSS 8.5.14, G13-post-1a fixed the wrapper test typecheck failure, and G13-post-1 enabled main branch protection. Current GitHub branch protection requires only the GitHub Actions `Build and static gates` check from app id 15368, with strict up-to-date branches false, enforce admins false, no required PR review, no restrictions, no force pushes, and no deletions. npm audit reports 0 vulnerabilities; dotnet vulnerable scan found no vulnerable packages across solution/test projects, and CodeQL was not run because codeql CLI is not installed. No coverage threshold, E2E, Playwright/Cypress dependency, npm audit required gate, dotnet vulnerable required gate, CodeQL gate, or real fixture/material dependency was introduced. No unconditional READY NEXT owner remains; real browser E2E and required-gate ratchets remain parked until prerequisites and owner signoff exist.
规则: inventory first; 每轮只处理一个 owner；保留现有 route path、exported API names、response shapes、auth/permission/account-scope 行为；不在同轮引入 backend/frontend behavior、polling/transport/DB/DTO owner 变更。
详细记录: docs\xiaolouai-finalization-handoff.md 和 docs\xiaolouai-deep-research-structured.md
```

### 当前可继续队列

```text
DONE G12a backend-module-refactor
DONE G12b frontend-api-service-layer (G12b-1 through G12b-9)
DONE G12c-1 dto-contract-inventory
DONE G12c-2 dto-split-safe-contracts
DONE G12c-3 contract-snapshot-or-openapi-plan
DONE G12d-1 shared-helper-cleanup
DONE G12d-2 dead-code-dependency-cleanup
DONE G12e-1 backend-test-harness-plan
DONE G12e-2 frontend-test-harness-plan
DONE G12f-1 backend-test-harness-first-implementation
DONE G12f-1b backend-health-metrics-no-db-tests
DONE G12f-1c backend-authhelpers-client-token-synthetic-tests
DONE G12f-2 frontend-test-harness-first-implementation
DONE G12f-3 frontend-auth-account-service-tests
DONE G12f-4 frontend-jobs-public-facade-tests
DONE G12f-5 frontend-playground-nonstream-service-tests
DONE G12f-6 frontend-media-upload-service-tests
DONE G12f-7 frontend-toolbox-service-tests
DONE G12f-8 frontend-wallet-payment-service-tests
DONE G12f-9 frontend-projects-canvas-create-service-tests
DONE G13-post-4 frontend-test-harness-and-coverage-advisory
DONE G13-post-4a frontend-coverage-report-advisory-script
DONE G13-post-4b api-compatibility-wrapper-runtime-tests
DONE G13-post-4c frontend-polling-stream-fake-timer-tests
DONE G13-post-4d frontend-synthetic-fixture-redaction-pack
DONE G13-post-5 synthetic-e2e-smoke-harness-precondition-plan
DONE G13-post-2 security-baseline-nonblocking-execution
DONE G13-post-2a npm-audit-vite-postcss-remediation-plan
DONE G13-post-2b npm-audit-vite-postcss-lockfile-update
DONE G13-post-1a ci-typecheck-fix-api-compat-wrapper-tests
DONE G13-post-1 branch-protection-enable (requires GitHub Actions Build and static gates on main)
PARKED G13-post-5 real browser E2E implementation (requires test auth, synthetic DB seed, fake object storage, job polling mocks, runtime budget, and flake policy)
PARKED G13-post-6 required-gate-ratchet (requires consecutive green advisory runs and owner signoff; no global one-shot enforcement)
```

### 下一棒提示词

```text
当前没有无条件 READY NEXT owner。G13-post-1a 已修复 XIAOLOU-main/src/lib/api/__tests__/api-compatibility-wrappers.test.ts 的 CI typecheck 失败并推送 main，GitHub Actions run 25372120423 已 green；G13-post-1 已启用 White-147/XiaoLouAI main branch protection，只要求 GitHub Actions app id 15368 的 `Build and static gates` status check，未新增 coverage/E2E/npm audit/dotnet vulnerable/CodeQL required gates，未要求 PR review 或 branch up-to-date。真实 browser E2E implementation 仍 parked，需先落地 test auth、synthetic fixture/seed、fake object storage、job polling mocks、runtime budget 和 flake policy；G13-post-6 required-gate-ratchet 仍需连续绿灯和 owner signoff。

执行任何下一棒前仍需先读取三份 handoff、README Deferred CI/Test Gate Follow-Up、当前 dirty worktree、相关 route/type/static scan record 和目标 owner 的前置条件。保持 DTO、route path、status code、response shape、auth/permission/account-scope 行为、frontend exported API names、polling/transport/DB owner 不变；不删除 api.ts compatibility wrappers 或 legacy verifier/deploy evidence；不读取或上传真实 auth/provider/payment/storage/operator material、production dump/snapshot、真实 DB fixture 或真实 object storage。
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
```

## 快速验证入口

```powershell
# 后端还原/构建
dotnet restore .\control-plane-dotnet\XiaoLou.ControlPlane.sln
dotnet build .\control-plane-dotnet\XiaoLou.ControlPlane.sln --configuration Release --no-restore

# 后端测试（仅存在测试项目时）
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$testProjects = @(Get-ChildItem -Path .\control-plane-dotnet -Recurse -Filter "*Tests*.csproj" -File | Sort-Object FullName)
if ($testProjects.Count -gt 0) { foreach ($project in $testProjects) { dotnet test $project.FullName --configuration Release --no-restore } } else { Write-Host "::notice title=dotnet test skipped::No *Tests*.csproj projects found under control-plane-dotnet." }

# 前端构建
npm --prefix .\XIAOLOU-main run build

# 前端 legacy 依赖门禁
.\scripts\windows\verify-frontend-legacy-dependencies.ps1

# 最终 legacy 表面门禁（G11 后默认 retained manifest 模式）
.\scripts\windows\verify-final-legacy-surface.ps1 -CoreApiRoot .\legacy\__missing-core-api -ServicesApiRoot .\legacy\__missing-services-api -LegacySurfaceManifestPath .\legacy-surface-evidence\final-legacy-surface-manifest-g11k.json

# handoff 空白检查
Select-String -Path .\XIAOLOU_REFACTOR_HANDOFF.md,.\docs\xiaolouai-finalization-handoff.md,.\docs\xiaolouai-deep-research-structured.md -Pattern '[ \t]+$'

# git 空白检查
git diff --check
```
