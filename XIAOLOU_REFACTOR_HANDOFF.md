# XiaoLouAI 短棒交接

更新时间：2026-05-05 22:13 +08
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
G13-post-1b ci-actions-node24-runtime-update: done
G13-post-5a synthetic-browser-e2e-harness-foundation: done
G13-post-5b synthetic-browser-e2e-interaction-flows: done
G13-post-5c synthetic-browser-e2e-runtime-baseline-and-flake-policy: done
G13-post-5d synthetic-browser-e2e-advisory-green-accumulation: done
G13-post-6-preflight required-gate-ratchet-plan-owner-signoff-record: done
G13-post-6 required-gate-ratchet: active (limited to non-required remote advisory check context; `Build and static gates` remains the only required check)
```

## 当前模块

```text
Owner: G13 deferred CI/Test gate follow-up
当前: G12a backend modules done; G12b frontend API service layer done through G12b-9; G12c DTO contract inventory/split/snapshot plan done; G12d cleanup done through G12d-2; G12e backend/frontend test-harness plans done; G12f backend harness done through AuthHelpers/Health/Metrics client-token tests; G12f frontend Vitest test:unit harness now covers Admin/Enterprise, Auth/Account, Jobs public facade, Playground non-stream plus polling/stream fake-timer boundaries, Media upload, Toolbox, Wallet/Payment, Projects/Canvas/Create service factory tests, api.ts compatibility wrapper runtime tests, and shared synthetic fixture/redaction helper tests. G13-post-4 through G13-post-4d frontend harness/advisory owners are complete; G13-post-5 completed synthetic E2E smoke harness precondition planning; G13-post-5a added a non-required Playwright synthetic browser smoke foundation with synthetic auth/localStorage, intercepted synthetic Control API fixtures, fake storage, job mocks, production preview on 127.0.0.1:3100, system Chrome channel, and no CI required check. G13-post-5b extended that non-required synthetic browser harness with interaction flows for email login, personal registration, image create submit/job polling, asset upload through fake object storage, and toolbox synthetic route/job polling from browser context; Home motion_transfer remains product-locked, so toolbox run coverage uses a browser-context synthetic route instead of changing UI behavior. G13-post-5c captured the first runtime/flake baseline: 3 consecutive local `test:e2e:synthetic` runs passed 13/13 with Playwright-reported 29.7-30.0s and outer PowerShell 31.07-31.88s; policy remains retries=0, workers=1, no required check, investigate any failure or >60s single-run runtime, and require repeated advisory greens plus owner signoff before any promotion. G13-post-5d completed 5 effective non-blocking advisory green rounds for synthetic E2E while treating the G13-post-5c three-run burst as seed/baseline evidence rather than the full evidence set. G13-post-6-preflight documented the required-gate ratchet scope. User then explicitly signed off a limited G13-post-6 execution: keep `Build and static gates` as the only required check and add remote non-required synthetic E2E advisory context/evidence. New workflow target is `.github/workflows/synthetic-e2e-advisory.yml`, check context `Synthetic browser E2E advisory`, with no artifact upload and no branch-protection mutation. G13-post-2 through G13-post-2b completed advisory security baseline/remediation, G13-post-1a fixed the wrapper test typecheck failure, G13-post-1 enabled main branch protection, and G13-post-1b updated GitHub Actions major versions to Node 24-runtime actions while keeping project Node 22 and the same single required check. Current GitHub branch protection requires only the GitHub Actions `Build and static gates` check from app id 15368, with strict up-to-date branches false, enforce admins false, no required PR review, no restrictions, no force pushes, and no deletions. npm audit reports 0 vulnerabilities; dotnet vulnerable scan found no vulnerable packages across solution/test projects, and CodeQL was not run because codeql CLI is not installed. No coverage threshold, CI-required E2E gate, npm audit required gate, dotnet vulnerable required gate, CodeQL gate, branch protection expansion, or real fixture/material dependency was introduced.
G13-post-5d evidence accumulation complete: effective greens are 5/5. Run 1: 2026-05-05 21:22 +08 local manual `npm --prefix .\XIAOLOU-main run test:e2e:synthetic`, 13/13 passed, outer PowerShell runtime 31.13s, no flake/timeout, counted. Run 2: 2026-05-05 21:30 +08 local manual same entry, 13/13 passed, Playwright reported 29.4s, outer PowerShell runtime 30.89s, no flake/timeout, counted. Run 3: 2026-05-05 21:36 +08 local manual same entry, 13/13 passed, Playwright reported 29.6s, outer PowerShell runtime 31.06s, no flake/timeout, counted. Run 4: 2026-05-05 21:45 +08 local manual same entry, 13/13 passed, Playwright reported 32.5s, outer PowerShell runtime 34.05s, no flake/timeout, counted. Run 5: 2026-05-05 21:55 +08 local manual same entry, 13/13 passed, Playwright reported 29.5s, outer PowerShell runtime 31.05s, no flake/timeout, counted. G13-post-5c's three-run burst remains seed/baseline evidence only. Current harness inventory remains 13 tests in 2 files, latest Playwright `.last-run.json` status is passed with failedTests empty, latest legacy dependency gate is ok with blockers 0/warnings 0, latest ci.yml run 25373669120 remains success, and main branch protection still requires only `Build and static gates`. This did not change E2E harness, fixtures, Vite config, auth/session, create/upload/toolbox/polling code, CI required checks, or branch protection.
G13-post-6 limited execution record: 2026-05-05 22:13 +08 owner signoff received to execute only the remote advisory context/evidence portion while preserving `Build and static gates` as the sole required check. Added a non-required GitHub Actions workflow named `Synthetic E2E Advisory` with job/check context `Synthetic browser E2E advisory`; it runs `npm --prefix .\XIAOLOU-main run test:e2e:synthetic` on windows-latest with Node 22 and Chrome channel, uploads no artifacts, and does not read real material. Remote run evidence is pending until this workflow is pushed and completed. Branch protection before execution still requires only `Build and static gates`; branch protection must remain unchanged after execution.
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
DONE G13-post-1b ci-actions-node24-runtime-update (workflow actions upgraded to Node 24-runtime major versions; project Node remains 22)
DONE G13-post-5a synthetic-browser-e2e-harness-foundation (non-required Playwright synthetic browser smoke foundation)
DONE G13-post-5b synthetic-browser-e2e-interaction-flows (login/register, create submit/poll, media fake PUT, toolbox run; synthetic only)
DONE G13-post-5c synthetic-browser-e2e-runtime-baseline-and-flake-policy (3 consecutive local green runs; non-required)
DONE G13-post-5d synthetic-browser-e2e-advisory-green-accumulation (5/5 effective non-blocking green rounds counted; G13-post-5c burst remains seed evidence)
DONE G13-post-6-preflight required-gate-ratchet-plan-owner-signoff-record (plan/signoff recorded; no required-check, workflow, or branch-protection mutation; execution signoff NOT granted)
ACTIVE G13-post-6 required-gate-ratchet (limited signed scope: add non-required remote advisory check context/evidence only; keep `Build and static gates` as sole required check)
```

### 下一棒提示词

```text
当前没有无条件 READY NEXT owner。G13-post-6-preflight required-gate-ratchet-plan-owner-signoff-record 已完成，且没有获得执行 G13-post-6 required-gate-ratchet 的显式 owner signoff。先读取三份 handoff、README Deferred CI/Test Gate Follow-Up、当前 dirty worktree、G13-post-5a/5b/5c/5d/5d-completion/G13-post-6-preflight records、XIAOLOU-main test:e2e:synthetic/Playwright harness、backend/frontend route/type static scan records、legacy dependency gate、当前 CI/branch-protection 状态。

当前 required-check scope 仍只能是现有 `Build and static gates`。G13-post-6-preflight 结论：不建议立即推广 synthetic E2E/security/coverage 为 required；synthetic E2E 继续保持 advisory/non-required。任何下一棒若没有显式 owner signoff，只能继续 advisory evidence、监控/记录或等待签收，不得新增/修改 required check、workflow、branch protection，也不得执行 G13-post-6。

若后续 owner 明确签收并要求执行 G13-post-6 required-gate-ratchet，必须在执行前再次确认：精确 check context、CI workflow/check-run 来源、branch-protection before/after、rollback owner、是否需要远端 non-required advisory workflow 绿灯、以及是否发生 harness/fixture/Vite config/auth/session/create/upload/toolbox/polling 变更导致 baseline 重置。保持 DTO、route path、status code、response shape、auth/permission/account-scope 行为、frontend exported API names、polling/transport/DB owner 不变；不删除 api.ts compatibility wrappers 或 legacy verifier/deploy evidence；不读取或上传真实 auth/provider/payment/storage/operator material、production dump/snapshot、真实 DB fixture 或真实 object storage。
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

# 非 required synthetic browser smoke（仅 G13-post-5a+ 合成 harness）
npm --prefix .\XIAOLOU-main run test:e2e:synthetic

# 前端 legacy 依赖门禁
.\scripts\windows\verify-frontend-legacy-dependencies.ps1

# 最终 legacy 表面门禁（G11 后默认 retained manifest 模式）
.\scripts\windows\verify-final-legacy-surface.ps1 -CoreApiRoot .\legacy\__missing-core-api -ServicesApiRoot .\legacy\__missing-services-api -LegacySurfaceManifestPath .\legacy-surface-evidence\final-legacy-surface-manifest-g11k.json

# handoff 空白检查
Select-String -Path .\XIAOLOU_REFACTOR_HANDOFF.md,.\docs\xiaolouai-finalization-handoff.md,.\docs\xiaolouai-deep-research-structured.md -Pattern '[ \t]+$'

# git 空白检查
git diff --check
```
