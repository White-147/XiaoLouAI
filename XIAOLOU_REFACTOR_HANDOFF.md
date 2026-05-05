# XiaoLouAI 短棒交接

更新时间：2026-05-05 11:43 +08
工作目录：`D:\code\XiaoLouAI`

本文件是后续每一棒的第一读取文件。根短棒只保留当前 owner、总进度、固定边界、下一棒提示词和验证入口；历史细节见 docs handoff：

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
G12b frontend-api-service-layer-plan: pending
G12c domain-dto-contract-review: pending
G13a ci-build-test-gate: done
G13b lint-security-coverage-plan: pending
```

## 当前 Owner

```text
Owner: G12 frontend API service layer
状态: G9/G10/G11 archived as done; G12a backend-module-refactor done; G12b-1 frontend-api-inventory next
目标: 先盘点 XIAOLOU-main API callers、response shapes、polling loops、account scope propagation 和 legacy guard interactions；后续每轮只抽一个 frontend service，保持页面行为不变。
当前结论: G11 已完成并归档为一个总阶段。legacy 物理 root 当前不存在；421 个 reviewed git-tracked legacy source candidate 已删除；非密钥 legacy local material 位于 deploy/retained/legacy-local-material；真实 env/service-account、敏感 demo SQLite 和 Jaaz config.toml 位于 ignored deploy/local-secrets/legacy；final/projection source gates 使用 legacy-surface-evidence retained manifests。README 状态复查已完成，根 README、frontend README 和 control-plane 中文 README 已对齐 G11/G12 当前状态。G12a backend route modules 已全部完成并复核通过；逐项记录保留在 docs\xiaolouai-finalization-handoff.md。下一 owner 是 G12b-1 frontend-api-inventory。
```

## G9-G11 归档摘要

```text
G9: operations evidence and final acceptance checklist complete through G9f. Detailed records remain in docs\xiaolouai-finalization-handoff.md and docs\xiaolouai-deep-research-structured.md.
G10: PostgreSQL performance inventory/planning/tuning complete through G10c. No broad DB migration was added; future DB performance work remains measurement-gated.
G11: final legacy surface and physical cleanup complete through G11l. legacy physical root is absent; retained verifier manifests live in legacy-surface-evidence; deploy-approved non-secret local material lives in deploy/retained/legacy-local-material; real local secrets stay ignored under deploy/local-secrets/legacy.
G11 validation: final surface manifest ok; projection manifest ok; frontend dependency gate ok; P2 reduced/static ok; cleanup dry-run blockers=0 with database-inventory-skipped warning; RC reduced blockers=0 with intentional skip warnings; dev launcher missing-root/static ok; git diff --check ok with CRLF warnings only.
```

## G12 已完成摘要

```text
G12a: backend module refactor stage done。完成 route-to-module inventory、Auth helper boundary、permission matrix alignment，以及 Health/Metrics、Operational、Toolbox、Media、Playground、Admin、InternalJobs、Payments、Accounts/Auth、Projects endpoint modules。Program.cs 现在保留 middleware、schema apply、hosted service/options/helpers 和各 module registration；/api/schema/apply 仍按边界留在 Program.cs。
G12a 复核: dotnet build 通过；control-api permission matrix ok；frontend legacy dependency verifier ok；Program.cs route map 只剩 /api/schema/apply；10 个 endpoint module registration 齐全；模块内 route map 共 123 条。逐项 G12a-1..G12a-11 执行记录、验证和回滚路径见 docs\xiaolouai-finalization-handoff.md。
下一 G12 owner: G12b-1 frontend-api-inventory。
```

## README 状态复查

```text
2026-05-05 11:43 +08: completed
范围: README.md, README.zh-CN.md, XIAOLOU-main README pair, control-plane-dotnet README pair, services/local-model-worker README pair, legacy-surface-evidence README pair, deploy/retained/legacy-local-material README pair.
结果: frontend README 不再把 legacy/core-api 或 Jaaz 端口列为必需服务；control-plane 中文 README 已补齐 Playground/Toolbox canonical surface 与 P0 验证说明；根 README 已避免暗示 live legacy README 子目录仍存在。
验证: README trailing whitespace check ok; git diff --check ok with CRLF warnings only.
```

## 下一棒提示词

```text
执行 G12b-1 frontend-api-inventory。先读取 XIAOLOU_REFACTOR_HANDOFF.md、docs\xiaolouai-finalization-handoff.md、docs\xiaolouai-deep-research-structured.md 中 G12/G12a 阶段记录，以及 XIAOLOU-main\src\lib\api.ts、frontend legacy dependency gate、Control API endpoint modules 和 account scope/client assertion helpers。

本轮只做 frontend API caller inventory 和 service 边界计划，不直接抽 service、不改页面行为、不改 backend routes、不引入新的 polling/transport/DB/DTO owner。输出 route-to-service inventory：auth/account、media、playground、toolbox、wallet/payment、projects/canvas/create、admin/enterprise、jobs/internal-read callers；标出 exported API names、response shapes、polling loops、account scope propagation、legacy guard interactions 和低耦合第一 owner。

验证 frontend legacy dependency gate、projects/canvas/control-api caller static scan、npm --prefix XIAOLOU-main run build only if frontend code changes、git diff --check。同步三份 handoff 文档；README 仅在用户可见架构/运行契约变化时同步。
```

## G11 详细归档位置

```text
G11a-G11l detailed execution, validation, rollback and retained-manifest records:
  docs\xiaolouai-finalization-handoff.md
  docs\xiaolouai-deep-research-structured.md
  docs\xiaolouai-legacy-physical-archive-contract.md
Root handoff only keeps the G11 stage-level status after 2026-05-05 11:36 +08.
```

## G12 后续提示词

```text
使用方式: G9/G10/G11 与 G12a 已完成，后续按以下 G12 owner 顺序推进。每轮只做一个 owner，保持功能正常优先。
```

### G12a backend-module-refactor (done)

```text
已归拢为阶段完成项。G12a 完成 Control API backend route-to-module refactor，逐项 owner、验证和回滚记录保留在 docs\xiaolouai-finalization-handoff.md。根 handoff 后续只保留当前阶段入口。
```

### G12b frontend service layer

```text
执行 G12b frontend API service layer work。先做 G12b-1 frontend-api-inventory：盘点 XIAOLOU-main API callers、response shapes、polling loops、account scope propagation、legacy guard interactions。随后每轮只抽一个 service：auth/account、media、playground、toolbox、wallet/payment、projects/canvas。保留现有 exported API names 或 compatibility wrappers，默认不改页面行为。每个 frontend owner 验证 npm build、frontend legacy dependency verifier、git diff --check，并在可行时做 route/page smoke。同步三份 handoff 文档。
```

### G12c DTO and contract review

```text
执行 G12c domain DTO contract review。先做 G12c-1 dto-contract-inventory，快照 backend request/response DTO 与 frontend expectations。再按单 owner 拆 over-shared create/update/list DTO，必须保留默认 public response shape 或提供 compatibility wrapper。不要和 route migration、frontend service extraction、DB migration 混在同一轮。验证 dotnet build、npm build if frontend contracts touched、contract/static scan、git diff --check。同步三份 handoff 文档。
```

### G12d helper and cleanup optimization

```text
执行 G12d helper and cleanup optimization。只在相关 modules/service boundaries 已稳定后执行。G12d-1 清理重复 normalization/auth/JSON helper；G12d-2 清理 dead code/imports/dependencies。删除前必须 reference scan，删除后必须 build。不得删除 legacy reference、verify scripts、deploy examples 或 operator evidence material，除非另有明确 deletion owner 和 rollback。同步三份 handoff 文档。
```

### G12e test harness

```text
执行 G12e test harness planning/implementation。先做窄范围测试 owner，不在 route migration 同轮创建大而全 scaffold。Backend 可从 Health/Metrics/auth helper tests 开始；frontend 可等 service layer 后补 service tests。验证 dotnet test only when test project exists、npm test only when script exists、build、git diff --check。同步三份 handoff 文档。
```

## 后续 G13 队列

```text
G13a ci-build-test-gate: done

G13 与 G11/G12 依赖判断:
  G13 最小 PR CI 不需要等待 G12b/G12c 完成。
  原因: 最小 CI 只固化当前可重复 build/static gates；G12 后续改动会被该 gate 保护，而不是作为前置。
  边界: 不改当前 Owner，不抢占 G12b；只有用户明确切到 G13 时才创建 workflow。

G13a-1 minimal-github-actions-workflow: ready when user switches to G13
  前置已接受: workflow 可触发 pull_request 和 push main；使用 windows-latest；允许 npm/NuGet restore；dotnet test 仅在发现 *Tests*.csproj 时运行；frontend test 暂不强制。
  文件: .github\workflows\ci.yml
  最小步骤: checkout；setup-node；npm ci --prefix XIAOLOU-main；npm --prefix XIAOLOU-main run build；setup-dotnet 8.x；dotnet restore/build .\control-plane-dotnet\XiaoLou.ControlPlane.sln；conditional dotnet test；verify-final-legacy-surface；verify-frontend-legacy-dependencies；git diff --check。
  secrets: none required for PR gate。
  Windows runner: required for first workflow because verifier scripts and path assumptions are Windows-oriented。
  禁止写入 CI: 真实 provider health、支付商户材料、真实回调捕获、production legacy dump/snapshot、真实 restore drill、production secrets、service publish/register/restart、release-candidate publish、strict production rehearsal、真实 payment replay、backup/restore drill、operator-only .runtime evidence。

G13b lint-security-coverage-plan: pending
  提示: 整理 lint/security/coverage 后续 gate 计划，避免一次性扩大 owner。
  前置: 不阻塞 G13a-1；coverage/test gate 需要 backend test project、frontend test script 或明确的测试 owner 后再设为强制。
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
# 后端构建
dotnet build .\control-plane-dotnet\XiaoLou.ControlPlane.sln --no-restore

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
