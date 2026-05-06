# XiaoLouAI 短棒交接

更新时间：2026-05-06 10:52 +08
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
G12 canonical module/service/test-harness refactor: done; detailed G12a-G12f task history is archived in docs\xiaolouai-finalization-handoff.md
G13 CI/static/test-gate hardening through required synthetic E2E: done; detailed G13 and G13-post task history is archived in docs\xiaolouai-finalization-handoff.md
Post-G13 advisory/monitor follow-ups: active queue remains split by owner; latest completed passes are required-synthetic-e2e-stability-monitor, backend-advisory-coverage-expansion, frontend-advisory-coverage-expansion, a second required-synthetic-e2e-stability-monitor pass, coverage-threshold-preflight, security-required-gate-preflight, branch-protection-hardening-review, a 5fac8ca required-synthetic-e2e-stability-monitor pass, backend-advisory response-shape expansion, and frontend auth-account service coverage expansion through 2026-05-06 10:52 +08. Coverage/security gates and branch-protection hardening remain advisory/preflight only; no threshold, security failure gate, workflow, required check, or branch-protection expansion was added.
```

## 当前模块

```text
Owner: next-owner-selection-pending（执行前先从当前可继续队列选择一个 owner）
当前: G12/G13 已完成的详细阶段记录已归档到 docs\xiaolouai-finalization-handoff.md；根 handoff 只保留当前事实和可继续任务。当前默认下一棒是 required-synthetic-e2e-stability-monitor，但只在本地 advisory 变更 push/开 PR 后、新 required check 不稳定时、或任何 required-gate/branch-protection mutation 前执行；若没有这些触发条件，则不要空跑 monitor，改按显式用户指定 owner。当前 `main` branch protection 要求两个 GitHub Actions required checks：`Build and static gates` 与 `Synthetic browser E2E advisory`，二者均来自 app id 15368。最新 main commit 5fac8ca 的 CI run 25412556135 与 Synthetic E2E Advisory run 25412556150 均 success；branch protection readback 仍只要求这两个 contexts，strict=false、enforce_admins=false、required PR reviews=false、restrictions=false、force pushes=false、deletions=false。2026-05-06 10:24 +08 required-synthetic-e2e-stability-monitor 通过：本机 `npm --prefix .\XIAOLOU-main run test:e2e:synthetic` 13/13 通过，Playwright 37.3s、外层 39.48s，低于 60s 调查阈值，未触发 rollback。2026-05-06 10:38 +08 backend-advisory-coverage-expansion 第二轮完成：新增 `BackendAdvisoryEndpointResponseShapeTests`，直接调用 mapped Minimal API route delegate，覆盖 media upload-begin、jobs create、toolbox translate-text 的 account-scope 403 短路，以及 payment callback invalid JSON、provider mismatch、disabled provider envelopes；harness 使用 synthetic unreachable Npgsql data source 与 throw-on-use storage signer/payment verifier，未进入 stores、ledger、signature verifier、真实 DB、provider、payment、object storage 或 production dump；`dotnet test` 190/190 通过，solution build 0 warnings/0 errors，frontend legacy dependency gate status ok，当前 CI/branch-protection readback 未变化。2026-05-06 10:52 +08 frontend-advisory-coverage-expansion 第二轮完成：只新增 `auth-account.test.ts` synthetic mock tests，覆盖 API-center vendor/api-key/test/model scoped encoded routes、稳定 JSON bodies、组织钱包成功路径和非 404 wallet error 透传；未改实现、frontend exported API names、route/status/response/auth/account-scope 行为，未使用真实 provider material、object storage、payment capture、production dump 或真实后端 fixture。验证通过：目标 auth-account 8/8，全量 frontend unit 59/59，coverage advisory 59/59 with All files statements/lines 98.01%、functions 97.94%、branches 72.92%，`auth-account.ts` 100%；frontend lint/build 通过，frontend legacy dependency gate status ok，trailing whitespace clean，`git diff --check` 仅 CRLF warnings。当前未启用 coverage threshold、CodeQL required gate、npm audit failure gate、dotnet vulnerability failure gate、branch-up-to-date strict mode、enforce admins 或 required PR review。真实 auth/provider/payment/storage/operator material、production dump/snapshot、真实 DB fixture、真实 object storage 仍只作为最终验收或运营侧 evidence，不计入日常工程 blocker。
规则: inventory first; 每轮只处理一个 owner；保留现有 route path、exported API names、response shapes、auth/permission/account-scope 行为；不在同轮引入 backend/frontend behavior、polling/transport/DB/DTO owner 变更。
详细记录: docs\xiaolouai-finalization-handoff.md 和 docs\xiaolouai-deep-research-structured.md
```

### 当前可继续队列

```text
NEXT required-synthetic-e2e-stability-monitor: default next owner only after the current local advisory changes are pushed/opened as a PR, if a required check becomes unstable, or before any required-gate/branch-protection mutation. If the required synthetic check flakes, times out, or blocks routine work without a product regression, rollback branch protection to only `Build and static gates`, reread protection/check state, and record the rollback.
DONE backend-advisory-coverage-expansion: route/method metadata plus account-scope/auth-provider grant pass and the mapped route-delegate response-shape pass are done. Continue this owner only if a user explicitly wants more backend synthetic mock coverage; no real DB fixture, provider material, object storage, payment capture, or production dump.
DONE frontend-advisory-coverage-expansion: browser fetch/download/cache/service-worker boundary pass and auth-account service route/error pass are done. Continue this owner only if a user explicitly wants deeper frontend synthetic mock coverage; no real provider material, object storage, payment capture, production dump, or real backend fixture.
DONE coverage-threshold-preflight: preflight completed. Do not add thresholds directly. Future coverage work must be a separate owner: either non-required frontend aggregate advisory floor proposal or backend coverage collector baseline, with rollback/signoff and no branch-protection mutation until stable evidence exists.
DONE security-required-gate-preflight: plan/preflight completed. npm audit and dotnet vulnerable scans are currently clean, local CodeQL CLI is unavailable, latest main CI/synthetic required checks are green, and branch protection stayed unchanged. Keep npm audit failure, dotnet vulnerable failure, and CodeQL non-required until explicit security-gate owner signoff, noise policy, allowlist, remote runner evidence, exact check context, rollback, and baseline-reset conditions exist.
DONE branch-protection-hardening-review: policy review/preflight completed. Current protection keeps required CI + synthetic E2E contexts from GitHub Actions app id 15368 and disables force pushes/deletions, but strict up-to-date, enforce admins, required PR reviews, restrictions, conversation resolution, signatures, and linear history remain off. No mutation was made; any future hardening follow-up must be explicit and signed.
```

### 推荐下一棒顺序

```text
1. DEFAULT NEXT required-synthetic-e2e-stability-monitor: run only after the current local advisory changes are pushed/opened as a PR, before any required-gate/branch-protection mutation, or if the required `Synthetic browser E2E advisory` check flakes/times out.
2. frontend-advisory-coverage-expansion: not the default after the auth-account route/error pass. Continue only if explicitly requested for deeper frontend service/fetch/timer coverage with synthetic mocks.
3. backend-advisory-coverage-expansion: not the default after the response-shape pass. Continue only if explicitly requested for deeper backend handler/store coverage with mocks/isolated synthetic fixtures; no real DB fixture, provider material, object storage, payment capture, or production dump.
4. coverage-threshold-follow-up: not a default NEXT owner. Only proceed if explicitly requested; first allowed steps are non-required frontend aggregate advisory floor proposal or backend coverage collector baseline, never immediate required coverage gate.
5. security-required-gate-follow-up: not a default NEXT owner. Only proceed if explicitly requested; first allowed steps are non-required advisory evidence/noise-policy planning for npm audit, dotnet vulnerable, or CodeQL, never immediate required security gate.
6. branch-protection-hardening-follow-up: not a default NEXT owner. Only proceed if explicitly requested; no branch-protection mutation without exact before/after, test PR evidence, rollback owner/action, stable required-check evidence, and baseline-reset conditions.
```

### 下一棒提示词

```text
当前默认下一棒是 `required-synthetic-e2e-stability-monitor`（只在当前本地 advisory 变更 push/开 PR 后、新 required check 不稳定、或任何 required-gate/branch-protection mutation 前做 required synthetic E2E 监控/rollback 预案读取；不改 workflow、required checks 或 branch protection）。若用户显式指定其他 owner，则按指定 owner 执行；否则按“推荐下一棒顺序”从上到下选择第一个仍适用的 owner。下一棒先读取根 handoff、README Deferred CI/Test Gate Follow-Up、docs\xiaolouai-finalization-handoff.md 当前结论/队列、当前 dirty worktree、XIAOLOU-main test:e2e:synthetic/Playwright harness、backend/frontend route/type static scan records、legacy dependency gate、当前 CI/branch-protection 状态。

执行前先明确选择一个 owner，并只处理该 owner：required-synthetic-e2e-stability-monitor、frontend-advisory-coverage-expansion、backend-advisory-coverage-expansion、coverage-threshold-follow-up、security-required-gate-follow-up、branch-protection-hardening-follow-up。不要把多个 NEXT 项合并到同一棒；required-synthetic-e2e-stability-monitor 只在当前本地 advisory 变更 push/开 PR 后、required check 不稳定、或任何 required-gate/branch-protection mutation 前优先插队；backend/frontend advisory coverage 只在用户显式要求更深 synthetic mock coverage 时继续；backend-advisory-coverage-expansion 当前已有 route metadata/auth grant 与 response-shape 两轮，默认不再优先；frontend-advisory-coverage-expansion 当前已有 browser fetch/download/cache/service-worker 与 auth-account route/error 两轮，默认不再优先；coverage-threshold-follow-up 只有在用户显式要求时才继续，且不得直接 required；security-required-gate-follow-up 只有在用户显式要求时才继续，且不得直接 required；branch-protection-hardening-follow-up 只有在用户显式要求并签收 exact before/after、rollback 和稳定证据时才继续。

保持 DTO、route path、status code、response shape、auth/permission/account-scope 行为、frontend exported API names、polling/transport/DB owner 不变；不删除 api.ts compatibility wrappers 或 legacy verifier/deploy evidence；不读取或上传真实 auth/provider/payment/storage/operator material、production dump/snapshot、真实 DB fixture 或真实 object storage。任何 required gate 或 branch-protection 扩展都必须重新签收并确认精确 check context、CI workflow/check-run 来源、branch-protection before/after、rollback owner、稳定证据和 baseline-reset 条件。
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

# required synthetic browser E2E（合成 harness；check context: Synthetic browser E2E advisory）
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
