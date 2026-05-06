# XiaoLouAI 短棒交接

更新时间：2026-05-06 09:59 +08
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
Post-G13 advisory/monitor follow-ups: active queue remains split by owner; latest completed first passes are required-synthetic-e2e-stability-monitor, backend-advisory-coverage-expansion, and frontend-advisory-coverage-expansion, plus a second required-synthetic-e2e-stability-monitor pass through 2026-05-06 09:55 +08. Coverage remains advisory/non-required and branch protection was not expanded.
```

## 当前模块

```text
Owner: next-owner-selection-pending（执行前先从当前可继续队列选择一个 owner）
当前: G12/G13 已完成的详细阶段记录已归档到 docs\xiaolouai-finalization-handoff.md；根 handoff 只保留当前事实和可继续任务。当前没有单一默认 owner，但下方“当前可继续队列”中的 NEXT 项均可按显式选择继续。当前 `main` branch protection 要求两个 GitHub Actions required checks：`Build and static gates` 与 `Synthetic browser E2E advisory`，二者均来自 app id 15368。最新 required 后首轮远端验证在 commit 6229031 通过：Synthetic E2E Advisory run 25383164041 报告 13 passed (40.0s)，CI run 25383164073 success。2026-05-06 09:19 +08 required-synthetic-e2e-stability-monitor 本地采样先捕到 email-login 用例因 modal 动画稳定性等待导致 30s timeout、外层 74.52s；未回滚 branch protection，因为远端 required checks 仍为 success，随后仅将 synthetic harness 的登录按钮点击改为 forced click，targeted login 通过，完整 `test:e2e:synthetic` 13/13 通过（Playwright 30.5s，外层 32.30s）。2026-05-06 09:31 +08 backend-advisory-coverage-expansion 第一轮完成：新增 backend advisory route/method metadata 测试覆盖 Payments、Projects/canvas/create、Media、Toolbox、Playground、Jobs/outbox，并扩展 AuthHelpers synthetic account-scope/auth-provider grant 边界；`dotnet test` 184/184 通过，solution build 0 warnings/0 errors。2026-05-06 09:44 +08 frontend-advisory-coverage-expansion 第一轮完成：新增 synthetic browser fetch/download/cache/service-worker 边界 Vitest，覆盖 `guessMediaFilename`、`downloadMediaFile` same-origin/remote/data-URL/failure fallback 和 `retireStaticBuildServiceWorkers` scope/cache delete 行为；frontend lint、test:unit 57/57、test:coverage:advisory 57/57、build、legacy dependency gate 均通过；branch protection 读取仍未变。2026-05-06 09:55 +08 required-synthetic-e2e-stability-monitor 第二轮读取到远端 required checks 仍为 commit 6229031 success，branch protection 仍要求同两个 contexts；本机 `test:e2e:synthetic` 13/13 通过（Playwright 32.4s，外层 34.27s），legacy dependency gate status ok，未触发 rollback。当前未启用 coverage threshold、CodeQL required gate、npm audit failure gate、dotnet vulnerability failure gate、branch-up-to-date strict mode、enforce admins 或 required PR review。真实 auth/provider/payment/storage/operator material、production dump/snapshot、真实 DB fixture、真实 object storage 仍只作为最终验收或运营侧 evidence，不计入日常工程 blocker。
规则: inventory first; 每轮只处理一个 owner；保留现有 route path、exported API names、response shapes、auth/permission/account-scope 行为；不在同轮引入 backend/frontend behavior、polling/transport/DB/DTO owner 变更。
详细记录: docs\xiaolouai-finalization-handoff.md 和 docs\xiaolouai-deep-research-structured.md
```

### 当前可继续队列

```text
NEXT required-synthetic-e2e-stability-monitor: continue observing the now-required `Synthetic browser E2E advisory` check on new pushes/PRs. If it flakes, times out, or blocks routine work without a product regression, rollback branch protection to only `Build and static gates`, reread protection/check state, and record the rollback.
NEXT backend-advisory-coverage-expansion: first route/method metadata plus account-scope/auth-provider grant pass is done. Continue this owner only for deeper handler/store response-shape coverage with mocks/isolated synthetic fixtures; no real DB fixture, provider material, object storage, payment capture, or production dump.
NEXT frontend-advisory-coverage-expansion: first synthetic browser fetch/download/cache/service-worker boundary pass is done. Continue this owner only for deeper service/fetch/timer boundaries with synthetic mocks; keep coverage advisory/non-required until stable baselines and owner signoff exist.
NEXT coverage-threshold-preflight: after backend/frontend advisory coverage is broader and stable, design a narrow threshold plan for critical routes/services with rollback and owner signoff. Do not add thresholds directly.
NEXT security-required-gate-preflight: npm audit is currently clean and dotnet vulnerable scan previously had no findings, but npm audit failure, dotnet vulnerability failure, and CodeQL remain non-required. Any required security gate needs noise policy, allowlist, remote runner evidence, and explicit owner signoff.
NEXT branch-protection-hardening-review: optional policy review for strict up-to-date branches, enforce admins, and required PR reviews. Treat as a separate owner; do not change protection without explicit signoff and rollback record.
```

### 推荐下一棒顺序

```text
1. DEFAULT NEXT coverage-threshold-preflight: plan/preflight only. Backend and frontend advisory first passes are now present, so the next useful move is to inventory exact advisory coverage evidence and draft a narrow threshold proposal with rollback/signoff requirements. Do not add thresholds, workflow changes, or required checks in this owner.
2. security-required-gate-preflight: plan/preflight only after coverage-threshold-preflight, or sooner only if the user explicitly asks for security. Keep npm audit failure, dotnet vulnerable failure, and CodeQL non-required until noise policy, allowlist, remote evidence, and owner signoff exist.
3. required-synthetic-e2e-stability-monitor: run again on new pushes/PRs, before any required-gate/branch-protection mutation, or if the required `Synthetic browser E2E advisory` check flakes/times out. Otherwise treat it as a recurring guard, not the default next code owner.
4. branch-protection-hardening-review: optional policy review only after explicit owner selection; do not change strict mode, enforce admins, required reviews, restrictions, force pushes, or deletions without signed before/after plus rollback.
5. backend-advisory-coverage-expansion: continue only for deeper handler/store response-shape coverage with mocks/isolated synthetic fixtures.
6. frontend-advisory-coverage-expansion: continue only for deeper service/fetch/timer boundaries with synthetic mocks.
```

### 下一棒提示词

```text
当前默认下一棒是 `coverage-threshold-preflight`（只做 plan/preflight，不加阈值、不改 workflow、不改 required checks、不改 branch protection）。若用户显式指定其他 owner，则按指定 owner 执行；否则按“推荐下一棒顺序”从上到下选择第一个仍适用的 owner。下一棒先读取根 handoff、README Deferred CI/Test Gate Follow-Up、docs\xiaolouai-finalization-handoff.md 当前结论/队列、当前 dirty worktree、XIAOLOU-main test:e2e:synthetic/Playwright harness、backend/frontend route/type static scan records、legacy dependency gate、当前 CI/branch-protection 状态。

执行前先明确选择一个 owner，并只处理该 owner：coverage-threshold-preflight、security-required-gate-preflight、required-synthetic-e2e-stability-monitor、branch-protection-hardening-review、backend-advisory-coverage-expansion、frontend-advisory-coverage-expansion。不要把多个 NEXT 项合并到同一棒；required-synthetic-e2e-stability-monitor 只在新 push/PR、required check 不稳定、或任何 required-gate/branch-protection mutation 前优先插队；backend/frontend advisory coverage 只在需要更深 synthetic mock coverage 时继续。

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
