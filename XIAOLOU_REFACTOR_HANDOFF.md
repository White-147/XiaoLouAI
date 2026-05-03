# XiaoLouAI Windows 原生重构交接

更新时间：2026-05-03 20:27 +08
工作目录：`D:\code\XiaoLouAI`

继续执行前先读：

- `docs/xiaolouai-python-refactor-handoff.md`
- `C:\Users\10045\Downloads\deep-research-report.md`

## 当前权威状态

- 当前生产路线只走 `.NET 8 / ASP.NET Core Control API + PostgreSQL canonical + Windows Service workers`。
- 不推进 Docker、Docker Compose、Linux、Linux container、Kubernetes、WSL、Windows + Celery 或 Redis Open Source on Windows 作为生产路径。
- `core-api/` 只保留为迁移期只读兼容层、登录/断言过渡、旧实现参考和导入校验工具，不再作为长期生产控制面。
- Python 只允许作为本地模型 adapter / inference runner，不承载主控制面和异步主控。
- PostgreSQL canonical 是运行时唯一事实源；旧 SQLite、旧 PostgreSQL snapshot 和旧表只允许作为导入、dry-run、校验和最终验收 evidence。
- 真实 production legacy dump/source、真实支付材料、真实 provider health evidence、真实 PostgreSQL restore drill 都统一归入根 README 的“Operator-Supplied Final Acceptance Evidence / 运营侧最终验收材料”模块，不再作为当前工程下一步 blocker。

## 已完成并发布到真实 4100 Windows service 的批次

以下批次不要重复做，只有后续改动触碰相关 flow 时才复核：

1. A/B/C/D 工程收口与 Windows-native P0 基础设施。
2. 前端 P2 legacy route 批次：media/upload、`/uploads/*`、`/vr-*`、`/api/tasks* -> /api/jobs*`、wallet/recharge/admin billing、project/canvas/create、playground/toolbox、auth/profile/organization/admin/API-center review。
3. 第一批 `.NET` canonical project/create/canvas surface：
   - `/api/projects*`
   - `/api/create/images*`
   - `/api/create/videos*`
   - `/api/canvas-projects*`
   - `/api/agent-canvas/projects*`
4. 第二批 `.NET` canonical identity/config surface：
   - `/api/auth*`
   - `/api/me`
   - `/api/organizations/{organizationId}/members`
   - `/api/api-center*`
5. 第三批 project 相邻 canonical surface：
   - `/api/projects/{projectId}/assets*`
   - `/api/projects/{projectId}/storyboards*`
   - `/api/projects/{projectId}/videos`
   - `/api/projects/{projectId}/dubbings`
   - `/api/projects/{projectId}/exports`
6. 第四批 admin/system canonical surface：
   - `/api/admin/pricing-rules`
   - `/api/admin/orders`
   - `/api/admin/orders/{orderId}/review` 返回 410 retired boundary
   - `/api/enterprise-applications*`
7. 第五批 Playground canonical surface：
   - `/api/playground/config`
   - `/api/playground/models`
   - `/api/playground/conversations*`
   - `/api/playground/chat-jobs*`
   - `/api/playground/memories*`
8. 第六批 Toolbox canonical surface：
   - `GET /api/capabilities`
   - `GET /api/toolbox`
   - `GET /api/toolbox/capabilities`
   - `POST /api/toolbox/character-replace`
   - `POST /api/toolbox/motion-transfer`
   - `POST /api/toolbox/upscale-restore`
   - `POST /api/toolbox/video-reverse-prompt`
   - `POST /api/toolbox/storyboard-grid25`
   - `POST /api/toolbox/translate-text`

## 最新实现要点

- `control-plane-dotnet` 已新增或保留 PostgreSQL-backed stores：`PostgresIdentityConfigStore`、`PostgresProjectSurfaceStore`、`PostgresAdminSystemStore`、`PostgresPlaygroundStore`、`PostgresToolboxStore`。
- Toolbox 使用 canonical `toolbox_capabilities` 和 `toolbox_runs`，可运行工具通过 canonical `jobs` 入队，lane 为 `account-control`，provider route 为 `closed-api`。
- 前端首页工具箱能力发现和可运行工具已切到 `/api/capabilities` 和 `/api/toolbox*`，不再走旧 `/api/jobs` 快捷写入。
- public reverse proxy allowlist、client assertion、runtime env permissions、P0 assertion 和 frontend legacy dependency gate 均已包含 `toolbox:read/write` 与 toolbox routes。
- legacy/canonical projection verifier 已新增 `apiCenterHealth`，会读取 canonical `api_center_configs` 与 `provider_health`，把 API-center 明文密钥字段、无效 JSON、vendor/model id 冲突、默认模型悬空或指向禁用模型、apiKeyHash 状态冲突作为 blocker；已配置 vendor 缺少 `provider_health` 作为日常审计 `evidence_pending`。
- API-center vendor test 已补 canonical provider-health plumbing：`POST /api/api-center/vendors/{vendorId}/test` 会在更新 vendor JSON 后写入 `provider_health` 的 `evidence_pending` 阶段性记录，并在响应返回 `providerHealth`；该记录不冒充真实 provider health，真实 vendor evidence 仍只进根 README 最终验收材料模块。
- provider health verifier 已区分真实 health 与 staged-only health：`apiCenterHealth` 现在统计 `providerHealthStatusCounts`、`realProviderHealthProviders`、`stagedProviderHealthProviders` 和 `configuredVendorsOnlyStagedProviderHealth`；`evidence_pending` 行不会再让 configured vendor 看起来已有真实 provider health evidence。
- provider health route 真实/阶段性语义展示已完成并发布到真实 4100 runtime：`PostgresProviderHealthStore` 的 `ListAsync` 和 `UpsertAsync` 返回行追加 `evidenceKind`、`isStagedEvidence`、`isRealProviderHealth`、`acceptanceEvidenceRequired` 和 `providerHealthSemantics`；P0 已补断言，要求 `healthy` 写入显示为 `real_provider_health`。真实 4100 smoke 已确认 `healthy -> real_provider_health`、`evidence_pending -> staged_evidence`。
- API-center vendor route 展示细节已完成并发布到真实 4100 frontend/runtime：前端 `ApiCenter` 不再把 vendor test 文案写成“连接正常”，改为“配置已测试/阶段性健康记录”；`providerHealth` 类型显式包含 real/staged 语义字段；4100 `POST /api/api-center/vendors/dashscope/test` 已确认返回 `providerHealth.status=evidence_pending`、`evidenceKind=staged_evidence`、`isStagedEvidence=true`、`isRealProviderHealth=false`。
- S3 旧表 runtime 依赖隔离已完成源码闸门：新增 `scripts/windows/verify-legacy-runtime-dependencies.ps1`，扫描 `.NET`、worker、frontend、core-api 的旧表 SQL、旧 route 和旧写入口引用；`.NET/worker` 无旧表事实源或旧 route blocker，frontend 剩余旧 route 仅限 retired/dev/guard allowlist，core-api 剩余旧入口只允许 read-only compatibility / migration verifier。该 verifier 已接入 `verify-p2-cutover-audit.ps1` 的 `legacy-runtime-dependency-isolation` step。
- S4 第 5 阶段清理 dry-run 方案已完成：新增 `scripts/windows/verify-legacy-cleanup-dry-run.ps1`，会盘点旧表清理候选、保留 canonical/non-cleanable 清单、生成 quarantine/cleanup/rollback SQL 模板，并验证 quarantine SQL 在 `ROLLBACK` 下执行后没有留下 archive table。
- S5 Release Candidate 验证包已落地：新增 `scripts/windows/verify-release-candidate.ps1`，统一编排 fixed publish/restart/P0、frontend hard gate、P2 audit、wallet ledger audit、projection verifier、service ops drill 和 S4 cleanup dry-run 复核；报告显式记录 `physical_cleanup_executed=false`，真实材料仍只进入 README 最终验收 evidence。
- S6 旧表旧字段物理清理窗口已按用户授权执行：新增 `scripts/windows/execute-legacy-cleanup.ps1`，先跑 fresh backup、restore drill、4100 P0、frontend hard gate、P2 audit、wallet audit、projection verifier、service ops drill 与 S4 dry-run，再执行 quarantine-then-drop SQL，并生成 rollback SQL。当前本机 runtime DB 中 `tasks`、`video_replace_jobs`、`wallet_recharge_orders`、`wallets`、`storyboards`、`videos`、`dubbings` 已从 `public` schema 移入 `legacy_quarantine` archive table 后 drop；`provider_jobs`、`payment_events` 原本不存在。canonical 表保持存在且 post-cleanup P0/projection/wallet/P2 audit 通过。
- `verify-windows-service-ops-drill.ps1` 已补非管理员回退：当普通 PowerShell 无法读取 `Win32_Service` CIM 元数据时，改用 `Get-Service` + `sc.exe qc/qfailure` 验证运行态、binPath、failure action 和依赖，不再把 CIM 拒绝访问误报成 Windows service 未注册。
- `complete-control-api-publish-restart-p0.ps1` 已补一处 Windows PowerShell `Start-Process` false-negative：当子进程 stdout 完整、stderr 为空但 ExitCode 未被 API 回填时，不再把成功 P0 误判成失败；带前端发布的完整 elevated publish/restart/P0 报告已成功。
- 2026-05-03 13:16：一次 elevated publish 在 publish 完成后卡在父脚本的 service restart/P0 flow。已确认问题点是 publish 后阶段缺少开始前实时打点，且 P0/ops drill 没有父级硬超时；已修复 `scripts/windows/complete-control-api-publish-restart-p0.ps1`，新增 timestamp stage log、P0 stdout/stderr 实时转发日志、`P0TimeoutSeconds`、`OpsDrillTimeoutSeconds` 和 timeout 后写报告退出。旧卡住进程已清理，三个 Windows service 已恢复 Running，`/healthz` 与 `/readyz` 通过；4100 窄口 smoke 已确认 `dashscope/api-center` 写入 `provider_health.status=evidence_pending`。2026-05-03 17:52 的 S5 管理员 RC 已用 fixed publish/restart/P0 重跑通过。
- 2026-05-03 物理清理窗口的一次长时间卡住原因是临时 PostgreSQL 探测命令 `createdb.exe --username=postgres` 没带 `-w/--no-password`，进程在密码提示处等待输入；这不是 cleanup SQL、Windows service 或 4100 runtime 卡死。残留 `createdb.exe` 已清理，后续管理员只读进程检查确认没有 `createdb/psql/dropdb/pg_restore/pg_dump` 残留。`restore-postgres.ps1` 与 `verify-postgres-backup.ps1` 已给 `dropdb`、`createdb`、`pg_restore` 补 `--no-password`，缺凭据时会快速失败，不再无期限等待交互输入。
- 根 README 中英文版已新增独立最终验收材料模块，集中记录真实 legacy dump/source、真实支付、真实 vendor/provider health、真实 restore drill 等运营侧材料；handoff 后续只引用该模块，不再重复把真实材料缺口写进下一步。
- 仓库源码侧 README*.md（排除虚拟环境、构建产物和依赖缓存）已统一归一化为 UTF-8 BOM；PowerShell `Get-Content` 直接读取中文 README 正常，乱码扫描无命中。
- 支付体系继续留在 canonical `payment_orders`、`payment_callbacks`、`wallet_ledger`、`wallet_balances`、callback/ledger 路线；手工 admin recharge review 继续退役。
- 真实 runtime 当前指向本机 `xiaolou_windows_native_test`。库存报告 `runtime-legacy-source-inventory-20260503-084026.json` 显示 canonical 表有当前运行数据，legacy 旧表为空或不存在。
- 当前库备份 `D:\code\XiaoLouAI\.runtime\xiaolou-backups\runtime-current-source\xiaolou-20260503-084033.dump` 只能作为当前运行库状态证据，不能冒充历史 production legacy dump/source。

## 发布脚本卡住问题的结论

用户截图中管理员 PowerShell 在 build 后长时间无输出，原因不是 Windows service 运行卡死：

- `complete-control-api-publish-restart-p0.ps1` 之前把 P0 输出缓存在变量里，导致 publish 后 P0 阶段没有实时日志。
- `publish-runtime-to-d.ps1` 在组合发布流程里仍打印 standalone `register-services.ps1` 提示，容易误导用户以为脚本停在手工步骤。
- `verify-control-plane-p0.ps1` 的 lease recovery 断言会和后台 `LeaseRecoveryService` 抢恢复；后台先恢复时，旧断言会误判失败。

已完成加固：

- `complete-control-api-publish-restart-p0.ps1` 现在实时转发 P0 输出，同时仍捕获输出用于报告。
- `complete-control-api-publish-restart-p0.ps1` 继续加固：publish 后的 env sync、service start、P0 和 ops drill 都有 timestamp stage log；P0/ops drill 通过独立 PowerShell 子进程运行，stdout/stderr 落到报告同目录并实时转发，超过 timeout 会停止子进程、写失败报告并恢复 worker services。
- `complete-control-api-publish-restart-p0.ps1` 调用 publish 时传入 `-SuppressRegistrationHint`。
- `publish-runtime-to-d.ps1` 新增 `-SuppressRegistrationHint`，组合流程里不再打印 standalone 注册服务提示。
- `verify-control-plane-p0.ps1` 接受后台 `LeaseRecoveryService` 先恢复 expired running job 的合法状态。
- `restore-postgres.ps1` 与 `verify-postgres-backup.ps1` 调用 PostgreSQL CLI 时显式使用 `--no-password`，避免脚本在没有 `PGPASSWORD` 或密码错误时停在交互提示。

结论：build/publish 本身仍可能正常耗时，但后续 P0 不应再安静到像假死。数据库 restore/cleanup 类脚本也不应再停在密码交互提示。此前 elevated combined report `control-api-publish-restart-p0-toolbox-20260503-105110.json` 是 verifier race 失败；publish 和 Windows service restart 已完成，真实 4100 patched P0 后续已通过。2026-05-03 12:55 的 interrupted publish 已完成 runtime DLL 更新，但完整父脚本 P0 未写最终报告；旧进程已清理，服务已恢复。2026-05-03 17:52 的 S5 管理员 RC 已用 fixed publish/restart/P0 重跑通过。2026-05-03 20:01 的 S6 cleanup 执行报告已证明物理清理完成且 post-cleanup P0 通过。

## 最新验证记录

已通过：

- `.NET build` 0 warning / 0 error。
- `npm --prefix .\XIAOLOU-main run build`。
- `verify-frontend-legacy-dependencies.ps1 -FailOnLegacyWriteDependency`：`status=ok`、`blockers=0`、`warnings=0`、`review_items=7`。
- 临时 `http://127.0.0.1:4110` Control API P0 smoke：`p0-c28dfce9e0974728b75bc40467d0a147`。
- strict legacy/canonical projection verifier：`toolbox_capabilities` count 为 5，`toolbox_runs` 存在。
- `D:\soft\program\nodejs\node.exe --check core-api\scripts\verify-legacy-canonical-projection.js` 通过。
- 当前库 verifier smoke：`legacy-canonical-api-center-verifier-smoke-20260503-current.json`，`apiCenterHealth` 无 blocker；`bytedance` provider health evidence 仍为 warning。
- 裁剪版 P2 audit smoke：`p2-cutover-api-center-verifier-smoke-20260503-current.json`，`status=ok`、`blockers=0`、`warnings=0`；缺真实 legacy snapshot 与 provider health evidence 均归入 `evidence_pending`。
- synthetic projection gate：`legacy-canonical-projection-gate-fixture-20260503-113743.json`，`status=ok`、`exitPolicy=strict-ok`。
- README 中英文同步：`README.md` 与 `README.zh-CN.md` 新增运营侧最终验收材料模块，均已规范为 UTF-8 BOM，PowerShell 直接读取中文正常。
- 真实 `http://127.0.0.1:4100` patched P0 smoke：`p0-f48924a66257420ba521ac5844fb896c`，本次为 `-SkipWorkers`。
- 4100 API-center/provider-health 窄口 runtime smoke：`POST /api/api-center/vendors/dashscope/test` 返回 `providerHealth.status=evidence_pending`，`GET /api/providers/health` 可见 `dashscope/CN/api-center` staged row。
- provider-health staged-only verifier smoke：`legacy-canonical-provider-health-staged-verifier-20260503-132713.json`，`status=ok`、`exitPolicy=strict-ok`，`configuredVendorsMissingProviderHealth=5`，`configuredVendorsOnlyStagedProviderHealth=1`。
- 裁剪版 P2 audit smoke：`p2-cutover-provider-health-staged-audit-20260503-132732.json`，`status=ok`、`blockers=0`、`warnings=0`；`api-center-provider-health-staged-only` 已归入 `evidence_pending`。
- 临时 `http://127.0.0.1:4110` provider health route smoke：`healthy` 返回 `evidenceKind=real_provider_health`、`isRealProviderHealth=true`、`isStagedEvidence=false`；`evidence_pending` 返回 `evidenceKind=staged_evidence`、`isRealProviderHealth=false`、`isStagedEvidence=true`；`GET /api/providers/health` 列表包含语义字段。
- 真实 4100 provider health route smoke：`healthy` 返回 `evidenceKind=real_provider_health`、`isRealProviderHealth=true`、`isStagedEvidence=false`；`evidence_pending` 返回 `evidenceKind=staged_evidence`、`isRealProviderHealth=false`、`isStagedEvidence=true`；`GET /api/providers/health` 列表包含语义字段。
- provider health semantics publish/restart/P0：`control-api-publish-restart-p0-provider-health-semantics-20260503-162800.json`，`status=ok`、`p0_run_id=p0-aa4ae5a5e96648bf902d45f183c20ea4`、`workersVerified=true`、`service-ops-drill=ok`。
- API-center provider health UI publish/restart/P0：`control-api-publish-restart-p0-api-center-provider-health-ui-20260503-163500.json`，`status=ok`、`publish_frontend=true`、`p0_run_id=p0-4361d93dc9e64b10ab4529e30af0dd59`、`workersVerified=true`、`service-ops-drill=ok`。
- 4100 API-center vendor test smoke：`dashscope` 返回 `providerHealth.status=evidence_pending`、`evidenceKind=staged_evidence`、`isStagedEvidence=true`、`isRealProviderHealth=false`。
- frontend legacy dependency gate：`frontend-legacy-dependencies-provider-health-ui-20260503-165300.json`，`status=ok`、`blockers=0`、`warnings=0`。
- P2 cutover audit：`p2-cutover-provider-health-ui-20260503-165300.json`，`status=ok`、`blockers=0`、`warnings=0`；真实 legacy/provider evidence 与 staged-only 仍归入 `evidence_pending`。
- S2 permission matrix verifier：`.runtime\xiaolou-logs\control-api-permission-matrix-s2-final.json`，`status=ok`、`blockers=0`、`warnings=0`；矩阵覆盖 public client token、internal、operational、payment callback、public status 五类路由。
- S2 P2 audit 接入验证：`.runtime\xiaolou-logs\p2-cutover-audit-s2-permission-matrix-final.json`，`status=ok`、`control-api-permission-matrix` step `ok`；缺真实 legacy/provider evidence 仍只进 `evidence_pending`。
- S2 frontend dependency gate：`.runtime\xiaolou-logs\frontend-legacy-dependencies-s2-permission-matrix-local.json`，`status=ok`、`blockers=0`、`warnings=0`。
- S2 真实 4100 P0 smoke：`p0-1dee70abd26946afa286200510001a1a`，本次为 `-SkipWorkers`，新增 internal/operational/public-client forbidden checks 通过。
- S3 legacy runtime dependency verifier：`.runtime\xiaolou-logs\legacy-runtime-dependencies-s3-final.json`，`status=ok`、`blockers=0`、`warnings=0`、`allowlist=111`、`review_items=1`；扫描 `.NET=35`、worker `2`、frontend `284`、core-api `37` 个 runtime/source 文件。
- S3 P2 audit 接入验证：`.runtime\xiaolou-logs\p2-cutover-audit-s3-legacy-runtime-local.json`，`status=ok`、`blockers=0`、`warnings=0`；`legacy-runtime-dependency-isolation` step `ok`，真实 legacy/provider evidence 仍只进 `evidence_pending`。
- S3 frontend hard gate：`.runtime\xiaolou-logs\frontend-legacy-dependencies-s3-runtime-isolation.json`，`status=ok`、`blockers=0`、`warnings=0`。
- S3 core-api read-only smoke：临时 `http://127.0.0.1:4114` 通过；87 个 mutating routes 均返回 `410 CORE_API_COMPAT_READ_ONLY`，legacy reads 返回 `410 CORE_API_COMPAT_ROUTE_CLOSED`，允许读接口 `/healthz` 与 `/api/windows-native/status` 返回 200。
- S4 legacy cleanup dry-run：`.runtime\xiaolou-logs\legacy-cleanup-dry-run-s4-final.json`，`status=ok`、`physical_cleanup_executed=false`、`blockers=0`、`warnings=0`、`review_items=1`；当前 runtime DB 中 `tasks`、`video_replace_jobs`、`wallet_recharge_orders`、`wallets`、`storyboards`、`videos`、`dubbings` 存在但均为 0 行，`provider_jobs`、`payment_events` 不存在。
- S4 生成的 SQL 模板：`.runtime\xiaolou-logs\legacy-cleanup-dry-run-20260503-173702\legacy-cleanup-quarantine-dry-run.sql`、`legacy-cleanup-candidate.sql`、`legacy-cleanup-rollback-template.sql`；quarantine dry-run 已在当前 DB 上执行并 `ROLLBACK`，未留下 `legacy_quarantine` archive table。
- S5 Release Candidate 管理员验证：`.runtime\xiaolou-logs\release-candidate-s5-final-admin.json`，`status=warning`、`administrator=true`、`blockers=0`、`warnings=1`、`evidence_pending=1`、`physical_cleanup_executed=false`；全部 required gates 均为 `ok`。顶层 warning 仅来自 projection verifier 对真实 legacy snapshot / provider health evidence 的运营侧提醒，不是工程 blocker。
- S5 fixed publish/restart/P0：`.runtime\xiaolou-logs\release-candidate-publish-restart-p0-20260503-175206.json`，`status=ok`、`publish_frontend=true`、`p0_run_id=p0-80b1e8ed9dcd4634914a2f8570760310`。
- S5 gate 报告归档：`release-candidate-frontend-legacy-dependencies-20260503-175206.json`、`release-candidate-p2-cutover-audit-20260503-175206.json`、`release-candidate-wallet-ledger-20260503-175206.json`、`release-candidate-legacy-canonical-projection-20260503-175206.json`、`release-candidate-service-ops-drill-20260503-175206.json`、`release-candidate-legacy-cleanup-dry-run-20260503-175206.json` 均无 blocker；管理员 service ops drill 为 `status=ok`、三项 Windows service 均 Running/Automatic/CIM metadata。
- 非管理员 ops drill 回退 smoke：`.runtime\xiaolou-logs\windows-service-ops-drill-nonadmin-fallback-smoke.json`，`status=warning`、`blockers=0`；普通 PowerShell 下可通过 `Get-Service` + `sc.exe` 正确识别三项服务 Running，不再误报 service missing。
- S5 后运行态复核：`XiaoLou-ControlApi`、`XiaoLou-LocalModelWorker`、`XiaoLou-ClosedApiWorker` 均 Running/Automatic；`http://127.0.0.1:4100/healthz` 为 `ok`，`/readyz` 为 `ready`。
- S6 物理清理执行：`.runtime\xiaolou-logs\legacy-cleanup-execute-final.json`，`status=warning`、`physical_cleanup_executed=true`、`blockers=0`、`warnings=1`；warning 仅来自 pre-cleanup service ops drill 在普通权限下的 CIM/ops metadata 提醒。fresh backup 为 `.runtime\xiaolou-backups\xiaolou-20260503-200155.dump`，run dir 为 `.runtime\xiaolou-logs\legacy-cleanup-execute-20260503-200155`，cleanup SQL 为 `legacy-cleanup-execute.sql`，rollback SQL 为 `legacy-cleanup-rollback.sql`。
- S6 清理前后 gate：restore drill `postgres-backup-verify.json` 为 `ok`；pre-cleanup P0 为 `p0-c16710670d9b4c9e80821d288cd1b454`；post-cleanup P0 为 `p0-2c04902a47104d1d92c39f9b2727d0c2`；post-cleanup projection verifier 与 wallet ledger audit 均为 `ok`。
- S6 post-cleanup 复核：`.runtime\xiaolou-logs\legacy-cleanup-post-execute-review.json` 为 `status=ok`、`blockers=0`；`.runtime\xiaolou-logs\p2-cutover-audit-post-legacy-cleanup-final.json` 为 `status=ok`、`blockers=0`、`warnings=0`；`.runtime\xiaolou-logs\frontend-legacy-dependencies-post-legacy-cleanup-final.json` 为 `status=ok`。
- S6 后运行态和进程复核：`XiaoLou-ControlApi`、`XiaoLou-LocalModelWorker`、`XiaoLou-ClosedApiWorker` 仍为 Running/Automatic，`http://127.0.0.1:4100/healthz` 为 `ok`，`/readyz` 为 `ready`；只读进程检查未发现 `createdb/psql/dropdb/pg_restore/pg_dump` 残留。
- S6 后 service ops drill 补充报告：`.runtime\xiaolou-logs\windows-service-ops-drill-post-legacy-cleanup-admin.json` 为 `status=ok`、`blockers=0`、`warnings=0`，三项 Windows service 均 Running/Automatic，binPath、failure action 和 dependency 校验通过。
- S6 cleanup/parser 检查通过：
  - `scripts/windows/execute-legacy-cleanup.ps1`
  - `scripts/windows/restore-postgres.ps1`
  - `scripts/windows/verify-postgres-backup.ps1`
  - `scripts/windows/verify-legacy-cleanup-dry-run.ps1`
- 五个发布/验证脚本 PowerShell parser 检查通过：
  - `scripts/windows/publish-runtime-to-d.ps1`
  - `scripts/windows/complete-control-api-publish-restart-p0.ps1`
  - `scripts/windows/verify-control-plane-p0.ps1`
  - `scripts/windows/verify-control-api-permission-matrix.ps1`
  - `scripts/windows/verify-p2-cutover-audit.ps1`
- `git diff --check` 无 whitespace error，仅保留 Git 的 LF/CRLF 工作区提示。

历史通过的关键报告：

- admin/system publish/restart/P0：`control-api-publish-restart-p0-admin-system-20260503-091100.json`
- admin/system runtime smoke：`control-api-admin-system-runtime-smoke-20260503-091831.json`
- Playground publish/restart/P0：`control-api-publish-restart-p0-playground-20260503-101541.json`
- frontend legacy gate：`frontend-legacy-dependencies-20260503-102934.json`
- P2 audit：`p2-cutover-audit-20260503-102945.json`

## 旧表统合与退役策略

目标：生产运行态只保留 PostgreSQL canonical 表、字段和约束。旧表和旧字段不能继续作为运行时事实源。

阶段：

1. 盘点与冻结：逐域列出旧表、旧字段、旧 route、旧 worker 和 canonical 目标表，冻结旧主写入口。
2. 补列与投影：同名旧表只做向前兼容 `ADD COLUMN IF NOT EXISTS`、索引、约束和 JSON backfill；语义不同的旧表通过幂等 `INSERT ... SELECT ... ON CONFLICT DO UPDATE` 投影到 canonical 表。
3. 运行时切断：Control API、worker、P0 smoke、frontend 调用只能读写 canonical 表和字段。
4. 一致性闸门：verifier 检查旧表未投影、canonical 必填缺失、孤儿引用、JSON/列字段冲突，并作为 blocker。
5. 清理退役：只有完成 publish/restart/P0、4100 smoke、硬闸门、备份，并进入 README 定义的最终验收 evidence 流程后，才允许隔离或物理清理旧表旧字段。
6. 迁移保留：只保留 SQLite/旧架构到 canonical PostgreSQL 的导入脚本、staging schema、dry-run plan、校验报告和回滚证据。

project 相邻域已经完成第 3/4/5 阶段：`projectAdjacentHealth` 会把旧表未投影、canonical 必填缺失、孤儿引用、JSON/列字段冲突作为 blocker，synthetic fixture 与当前测试库均通过。API-center/vendor 域已补 `apiCenterHealth`，用于守住 canonical vendor 配置不含明文 secret、默认模型引用可解析、provider health evidence 不被误作当前 blocker。S3 旧表 runtime 依赖隔离已通过源码扫描、P2 audit 接入、frontend hard gate 与 core-api read-only smoke。S4 dry-run、S5 RC 与 S6 物理清理均已完成；旧表 archive 保留在 `legacy_quarantine` schema 作为回滚 evidence，不再作为 runtime 事实源。

## 当前有效下一步

1. 不重复 project/create/canvas、identity/config、project-adjacent、admin/system、Playground、Toolbox、S0 provider health、S1 API-center vendor、S2 权限矩阵、S3 legacy runtime dependency isolation、S4 legacy cleanup dry-run、S5 Release Candidate、S6 physical legacy cleanup 已完成批次。
2. 当前进入“post-cleanup RC 观察 / 运营侧最终验收 evidence 收集”阶段。真实 provider health、真实 legacy dump/source、真实支付材料与真实 restore drill 仍只按根 README 最终验收模块补齐，不写成工程 blocker。
3. 默认下一步只做运行观察、RC 证据复核、必要小修和最终验收材料对接；不要再次清理 public legacy 表，也不要清理 `legacy_quarantine` archive，除非用户明确要求进入回滚或归档压缩窗口。
4. 如需回滚，优先使用 `.runtime\xiaolou-logs\legacy-cleanup-execute-20260503-200155\legacy-cleanup-rollback.sql` 与 `.runtime\xiaolou-backups\xiaolou-20260503-200155.dump`，并在回滚后重跑 4100 P0、frontend hard gate、P2 audit、projection verifier、wallet audit 和 service ops drill。
5. 支付体系继续保持 canonical payment/wallet/callback/ledger 路线。
6. 每批收尾必须同步本文件和 `docs/xiaolouai-python-refactor-handoff.md`。若涉及 README，必须同步中英文双版。

### 去循环化推进安排

结合 `C:\Users\10045\Downloads\deep-research-report.md` 和长 handoff 后，早期 deep research 中的 P0/P1 硬化点大多已完成：PostgreSQL URI query 保留、`ix_jobs_account_lane_active`、`restore-postgres.ps1` / `verify-postgres-backup.ps1`、core-api 只读默认、`.NET` 旧 status/payment/internal alias、Windows-native 部署脚本加固均已落地。剩余工作不再写成宽泛“继续完善”，按以下有限阶段推进：

| 阶段 | 范围 | 完成条件 | 完成后去向 |
|---|---|---|---|
| S0 | provider health route 真实/阶段性语义展示 | 已完成：真实 4100 elevated publish/restart/P0 通过；`healthy` 返回 `real_provider_health`，`evidence_pending` 返回 `staged_evidence` | 不再重复 |
| S1 | API-center vendor route 展示细节 | 已完成：vendor test/staged evidence 响应和前端文案不把 staged 当真实健康；4100 smoke 通过 | 不再重复 |
| S2 | system/audit/权限矩阵 | 已完成：`verify-control-api-permission-matrix.ps1` 固化 public client token、internal、operational、payment callback、public status 五类路由；P0 forbidden checks、frontend dependency gate、P2 audit 接入均无 blocker | 不再重复 |
| S3 | 旧表 runtime 依赖隔离 | 已完成：`verify-legacy-runtime-dependencies.ps1` 扫描 `.NET/worker/frontend/core-api` 无 blocker；allowlist=111；core-api read-only smoke、frontend hard gate、P2 audit 接入均通过 | 不再重复 |
| S4 | 第 5 阶段清理 dry-run 方案 | 已完成：`verify-legacy-cleanup-dry-run.ps1` 生成 quarantine/cleanup/rollback SQL 模板；quarantine SQL 在 `ROLLBACK` 下验证无残留 | 不再重复 |
| S5 | Release Candidate | 已完成：`verify-release-candidate.ps1` 管理员 run 归档；fixed publish/restart/P0、frontend gate、P2 audit、wallet audit、projection verifier、service ops drill、S4 cleanup dry-run 全部无 blocker；顶层 warning 仅为 README 运营侧最终验收 evidence | 不再重复 |
| S6 | 物理清理窗口 | 已完成：`execute-legacy-cleanup.ps1` 在 fresh backup、restore drill、P0、frontend hard gate、P2 audit、wallet audit、projection verifier、service ops drill、S4 dry-run 通过后执行 quarantine-then-drop；post-cleanup P0/P2/projection/wallet/health 均通过 | 进入 post-cleanup RC 观察 |

## 禁止回退

- 不回到 Docker、Docker Compose、Linux、Linux container、Kubernetes 或 WSL 生产路线。
- 不把 Windows + Celery 作为生产异步控制面。
- 不把 Redis Open Source on Windows 作为关键生产依赖。
- 不把 RabbitMQ 作为默认队列；它只保留为可选后续 adapter。
- 前端生产入口仍是静态构建产物，不允许由 Vite dev server / preview 承担线上流量。

## 下一棒提示词

```text
继续 XiaoLouAI Windows 原生重构。先读 XIAOLOU_REFACTOR_HANDOFF.md 获取当前权威交接，再读 docs/xiaolouai-python-refactor-handoff.md 和 C:\Users\10045\Downloads\deep-research-report.md 获取完整历史。当前路线只走 .NET 8 / ASP.NET Core Control API + PostgreSQL canonical + Windows Service workers，不推进 Docker/Linux/Kubernetes、Windows + Celery 或 Redis Open Source on Windows。A/B/C/D、前序 P2 frontend legacy route 批次、project/create/canvas、identity/config、project 相邻、admin/system、Playground 与 Toolbox canonical surface 均已完成并发布到真实 Windows service 运行态，4100 runtime smoke 与硬闸门通过。legacy/canonical verifier 已有 `projectAdjacentHealth` 与 `apiCenterHealth`；真实 provider health、真实 legacy dump/source、真实支付材料与真实 restore drill 已统一归入根 README 的“Operator-Supplied Final Acceptance Evidence / 运营侧最终验收材料”模块，不再作为当前下一步 blocker。S0 provider health、S1 API-center vendor、S2 权限矩阵、S3 旧表 runtime 依赖隔离、S4 第 5 阶段清理 dry-run、S5 Release Candidate 与 S6 物理清理窗口均已完成：`execute-legacy-cleanup.ps1` 已在 fresh backup、restore drill、4100 P0、frontend hard gate、P2 audit、wallet audit、projection verifier、service ops drill、S4 dry-run 后执行 quarantine-then-drop；`.runtime\xiaolou-logs\legacy-cleanup-execute-final.json` 为 `physical_cleanup_executed=true`、`blockers=0`，post-cleanup P0 为 `p0-2c04902a47104d1d92c39f9b2727d0c2`，post-cleanup P2/projection/wallet/health 均通过。一次一小时卡住的原因是临时 `createdb.exe` 未带 `--no-password` 等待密码输入，残留进程已清，`restore-postgres.ps1` 与 `verify-postgres-backup.ps1` 已加 `--no-password`。下一步不要重复 S0-S6，进入 post-cleanup RC 观察与运营侧最终验收 evidence 收集；不要清理 `legacy_quarantine` archive，除非用户明确要求回滚或归档压缩。每次修改收尾都必须同步 XIAOLOU_REFACTOR_HANDOFF.md 和 docs/xiaolouai-python-refactor-handoff.md；若涉及 README 范围，按中英文双版同步更新。
```
