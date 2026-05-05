# XiaoLouAI 短棒交接

更新时间：2026-05-05 11:08 +08
工作目录：`D:\code\XiaoLouAI`

本文件是后续每一棒的第一读取文件。根短棒只保留当前 owner、总进度、固定边界、下一棒提示词和验证入口；历史细节见三份 handoff：

```text
XIAOLOU_REFACTOR_HANDOFF.md
docs\xiaolouai-finalization-handoff.md
docs\xiaolouai-deep-research-structured.md
```

## PowerShell 读取

```powershell
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Get-Content .\XIAOLOU_REFACTOR_HANDOFF.md -Encoding UTF8
Get-Content .\docs\xiaolouai-finalization-handoff.md -Encoding UTF8
Get-Content .\docs\xiaolouai-deep-research-structured.md -Encoding UTF8
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
禁止移动或删除 legacy，除非当前 owner 明确证明不会影响现有功能，并已经处理验证器、文档、数据和本地密钥边界。
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
G11a final-legacy-surface-regression: done
G11b legacy-retention-and-delete-policy: done
G11c legacy-deletion-impact-proof: done
G11d legacy-delete-target-split: done
G11e legacy-verifier-docs-decoupling: done
G11f legacy-generated-cache-cleanup: done
G11g legacy-tracked-source-removal-readiness: done
G11h legacy-projection-p2-rc-launcher-decoupling: done
G11i legacy-local-data-fixture-rollback-readiness: done
G11j legacy-protected-material-preserve-and-evidence-root: done
G11k legacy-tracked-source-deletion-execution: done
G11l legacy-local-material-archive-and-physical-root-cleanup: done
G12a backend-module-refactor: done
G12b frontend-api-service-layer-plan: pending
G12c domain-dto-contract-review: pending
G13a ci-build-test-gate: done
G13b lint-security-coverage-plan: pending
```

## 当前 Owner

```text
Owner: G12 frontend API service layer
状态: G11a-G11l done; G12a backend-module-refactor done; G12b-1 frontend-api-inventory next
目标: 先盘点 XIAOLOU-main API callers、response shapes、polling loops、account scope propagation 和 legacy guard interactions；后续每轮只抽一个 frontend service，保持页面行为不变。
当前结论: G11 final legacy surface 已完成到 physical legacy root cleanup。421 个经过 readiness report 复核的 git-tracked legacy source candidate 已删除；用户确认可随部署携带的非密钥 legacy local material 已迁到 deploy/retained/legacy-local-material；真实 env/service-account、命中 secret-like app-state 的 demo SQLite 和带非空 api_key 字段的 Jaaz config.toml 已迁到 ignored deploy/local-secrets/legacy；日志、缓存、空目录和剩余 tracked legacy .gitignore 已删除，legacy 物理 root 当前不存在。final legacy surface、projection、P2、cleanup dry-run、RC reduced/static 和 dev launcher missing-root 边界使用 retained manifests 或静态检查继续通过；RC 现在也把 manifest 传给 P2 与 cleanup dry-run 子 gate。G12a backend route modules 已全部完成并复核通过；逐项记录保留在 docs\xiaolouai-finalization-handoff.md。下一 owner 是 G12b-1 frontend-api-inventory。
```

## G11 已完成摘要

```text
G11a: final legacy surface gate passed。已确认 legacy/core-api public allowlist narrow、tasks stream 默认关闭、legacy payment notify 默认关闭、legacy/services-api 无 production API wording、README 中英文锚点一致。
G11b: retention policy done。默认保留 verify scripts、deploy examples、legacy/core-api、legacy/services-api、legacy/jaaz、execute-legacy-cleanup.ps1；删除需要 owner 证明和回滚路径。
G11c: deletion impact proof done。control-plane-dotnet 与 XIAOLOU-main/src 无 physical legacy 生产依赖；dotnet build、frontend build、frontend legacy dependency gate、final legacy surface gate 均通过。
G11d: delete target split done。tracked source、generated cache、local data/secrets、dev launchers、verifier/docs fixtures 已分组；local data/secrets 需要用户确认，不与 generated cache 同 owner 删除。
G11e: verifier/docs decoupling done。verify-final-legacy-surface.ps1 默认仍严格读取 live legacy source；显式 -WriteLegacySurfaceManifestPath 可写 retained manifest，显式 -LegacySurfaceManifestPath 可在 legacy roots 不存在时完成 final legacy surface source checks。
G11f: generated/cache cleanup done。删除 31 个未跟踪 generated/cache/dependency 目标，包括 node_modules、.venv、dist、__pycache__、.pytest_cache、.ruff_cache、egg-info；复扫同类目标为 0；vertex-sa.json、.env.local、uploads、data、user_data 未触碰。
G11g: tracked source removal readiness done。未删除 tracked source。结论为 blocked：projection/P2/RC 仍依赖 live CoreApiRoot/ServicesApiRoot 或 skip；dev launcher 仍指向 legacy/core-api 与 legacy/jaaz；local data/secrets 仍需 preserve/archive/approval；fixture/archive 与 rollback 边界未完成。
G11h: projection/P2/RC/dev-launcher decoupling done。未删除 tracked source，未处理 local data/secrets。projection verifier/gate 支持显式 retained projection manifest；P2/RC 可显式传入 projection/final surface manifests；legacy-only launchers 对 missing source 或 missing generated dependencies 默认 skip。仍不能删除 tracked source，下一 owner 处理 local data/secrets、fixture/archive 和 rollback。
G11i: local-data/fixture/rollback readiness done。未删除 tracked source，未移动或读取 local data/secrets 内容。verify-legacy-cleanup-dry-run.ps1 新增显式 -AssessPhysicalSourceRemovalReadiness；只做 metadata inventory，记录 protected local material、retained final/projection manifest schema、fixture/archive 留存要求和 git restore + dependency restore rollback path。source removal 仍 blocked。
G11j: protected-material preserve/evidence root done。未删除 tracked source，未移动或读取 local data/secrets 内容。cleanup dry-run readiness 显式支持 preserve-in-place、tracked source target inventory 和 retained evidence root；legacy-surface-evidence 下保留 final/projection manifests。当前 readiness blockers=0，database inventory skipped warning 属于本轮裁剪边界。
G11k: tracked source deletion execution done。按 predelete readiness report 精确 git-rm 421 个 tracked source candidate；只保留 legacy/core-api/.gitignore、legacy/jaaz/.gitignore、legacy/jaaz/react/.gitignore 三个 tracked legacy 文件；protected local material 原地保留。postdelete readiness blockers=0；final/projection manifest modes、frontend legacy dependency gate、P2 manifest/static audit、RC parser/static boundary、dev launcher missing-root/static checks 均通过或保持 reduced/static warning 边界。
G11l: local material archive and physical root cleanup done。按用户确认的部署优先策略，把非密钥 legacy local material 迁到 deploy/retained/legacy-local-material 并生成 MATERIALS.sha256；把真实 .env.local、vertex-sa.json、命中 secret-like app-state 的 demo SQLite 和带非空 api_key 字段的 Jaaz config.toml 迁到 ignored deploy/local-secrets/legacy；删除 legacy 与 frontend/tool local logs、XIAOLOU-main/.cache、Python __pycache__、legacy .tanstack 空缓存和剩余空目录；删除剩余 tracked legacy .gitignore，legacy 物理 root 当前不存在。validation: final surface manifest ok、projection manifest ok、frontend dependency gate ok、P2 reduced/static ok、cleanup dry-run blockers=0 warning=database inventory skipped、RC reduced blockers=0 warning=intentional skips、dev launcher missing-root/static ok、git diff --check ok with CRLF warnings only。
```

## G12 已完成摘要

```text
G12a: backend module refactor stage done。完成 route-to-module inventory、Auth helper boundary、permission matrix alignment，以及 Health/Metrics、Operational、Toolbox、Media、Playground、Admin、InternalJobs、Payments、Accounts/Auth、Projects endpoint modules。Program.cs 现在保留 middleware、schema apply、hosted service/options/helpers 和各 module registration；/api/schema/apply 仍按边界留在 Program.cs。
G12a 复核: dotnet build 通过；control-api permission matrix ok；frontend legacy dependency verifier ok；Program.cs route map 只剩 /api/schema/apply；10 个 endpoint module registration 齐全；模块内 route map 共 123 条。逐项 G12a-1..G12a-11 执行记录、验证和回滚路径见 docs\xiaolouai-finalization-handoff.md。
下一 G12 owner: G12b-1 frontend-api-inventory。
```

## 下一棒提示词

```text
执行 G12b-1 frontend-api-inventory。先读取 XIAOLOU_REFACTOR_HANDOFF.md、docs\xiaolouai-finalization-handoff.md、docs\xiaolouai-deep-research-structured.md 中 G12/G12a 阶段记录，以及 XIAOLOU-main\src\lib\api.ts、frontend legacy dependency gate、Control API endpoint modules 和 account scope/client assertion helpers。

本轮只做 frontend API caller inventory 和 service 边界计划，不直接抽 service、不改页面行为、不改 backend routes、不引入新的 polling/transport/DB/DTO owner。输出 route-to-service inventory：auth/account、media、playground、toolbox、wallet/payment、projects/canvas/create、admin/enterprise、jobs/internal-read callers；标出 exported API names、response shapes、polling loops、account scope propagation、legacy guard interactions 和低耦合第一 owner。

验证 frontend legacy dependency gate、projects/canvas/control-api caller static scan、npm --prefix XIAOLOU-main run build only if frontend code changes、git diff --check。同步三份 handoff 文档；README 仅在用户可见架构/运行契约变化时同步。
```

## G11 后续拆分

```text
G11e legacy-verifier-docs-decoupling: done
  范围: verify-final-legacy-surface、legacy physical archive contract、handoff/docs。
  结果: final legacy surface gate 支持显式 retained manifest；默认 strict live 行为保留。

G11f legacy-generated-cache-cleanup: done
  范围: legacy 下明确 generated/cache/dependency 输出，例如 node_modules、.venv、__pycache__、dist、logs、.pytest_cache、.ruff_cache、egg-info。
  结果: 删除 31 个 untracked generated/cache/dependency 目标；复扫无剩余同名候选；data、uploads、backup、user_data、.env.local、vertex-sa.json 未触碰。

G11g legacy-tracked-source-removal-readiness: done
  范围: 仅在验证器、文档、launcher、fixture、回滚路径全部就绪后，评估 tracked legacy source 是否可移除。
  结果: readiness 审计完成；source removal blocked；未删除 tracked source。

G11h legacy-projection-p2-rc-launcher-decoupling: done
  范围: projection/P2/RC verifiers 与 dev launchers 的 live legacy source 耦合。
  结果: projection retained manifest、P2/RC manifest passthrough、legacy-only launcher skip guards 完成；source removal 仍 blocked。

G11i legacy-local-data-fixture-rollback-readiness: done
  范围: local data/secrets preserve/archive/approval、fixture/archive 留存、rollback 可执行路径。
  结果: cleanup dry-run 显式 readiness 模式已记录 protected local material metadata、manifest schema evidence、fixture/archive blocker 和 rollback path；source removal 仍 blocked。

G11j legacy-protected-material-preserve-and-evidence-root: done
  范围: protected local material preserve-in-place、retained evidence root、tracked source target inventory。
  结果: cleanup dry-run readiness report blockers=0；legacy-surface-evidence 保存已脱敏 final/projection manifests；protected tracked files=0；candidate tracked source files=421；local data/secrets 未移动未读取。

G11k legacy-tracked-source-deletion-execution: done
  范围: 只删除 readiness report 中允许的 git tracked source files；保留 protected local material 与 .gitignore 边界。
  结果: 精确删除 421 个 tracked source candidate；未递归删除 legacy root；未触碰 protected local material；保留 3 个 tracked .gitignore；postdelete readiness blockers=0。

G11l legacy-local-material-archive-and-physical-root-cleanup: done
  范围: 用户确认部署优先后，处理 G11k 后剩余 physical legacy root、本地材料归拢、日志/缓存/空目录清理和上传策略。
  结果: 非密钥 deploy handoff material 迁到 deploy/retained/legacy-local-material；真实 env/service-account、敏感 demo SQLite 与 Jaaz config.toml 迁到 ignored deploy/local-secrets/legacy；剩余 tracked legacy .gitignore 已删除；legacy 物理 root 当前不存在；cleanup dry-run 与 RC 子 gate 均显式透传 retained manifests。
```

## G12 后续提示词

```text
使用方式: G11l 与 G12a 已完成，后续按以下 G12 owner 顺序推进。每轮只做一个 owner，保持功能正常优先。
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
  G13 最小 PR CI 不需要等待 G11e/G11f/G11g 或 G12a/G12b/G12c 完成。
  原因: 最小 CI 只固化当前可重复 build/static gates；G11/G12 后续改动会被该 gate 保护，而不是作为前置。
  边界: 不改当前 Owner，不抢占 G11e；只有用户明确切到 G13 时才创建 workflow。

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

# 最终 legacy 表面门禁
.\scripts\windows\verify-final-legacy-surface.ps1 -CoreApiRoot .\legacy\core-api -ServicesApiRoot .\legacy\services-api

# handoff 空白检查
Select-String -Path .\XIAOLOU_REFACTOR_HANDOFF.md,.\docs\xiaolouai-finalization-handoff.md,.\docs\xiaolouai-deep-research-structured.md -Pattern '[ \t]+$'

# git 空白检查
git diff --check
```
