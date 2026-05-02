# XiaoLouAI Windows 原生重构下一步交接

更新时间：2026-05-02 16:55:00 +08:00
工作目录：`D:\code\XiaoLouAI`

本文件只服务下一步操作，不再承载 P0/P1 详细进度。完整历史、验证报告路径、修复细节请先读：

- `docs/xiaolouai-python-refactor-handoff.md`
- `C:\Users\10045\Downloads\deep-research-report.md`

## 当前入口状态

- 默认路线：`.NET 8 / ASP.NET Core` Control API + PostgreSQL 唯一事实源 + Windows Service workers。
- Python 只允许用于本地模型适配器/推理执行器。
- `core-api/` 只作为只读兼容层、旧接口参考和迁移桥，不再作为长期主控制面。
- P1 engineering closeout 已完成；后续默认进入 P2。
- 真实支付 provider 材料和真实 production legacy source rerun 只作为上线/最终验收 evidence，不作为工程推进阻塞。

## 禁止回退路线

- 不推进 Docker、Docker Compose、Linux、Linux container、Kubernetes、WSL 生产路径。
- 不把 Windows + Celery 作为生产异步主控。
- 不把 Redis Open Source on Windows 作为关键生产依赖。
- RabbitMQ on Windows 只保留为备选，不作为默认队列。
- 前端生产入口只允许静态构建产物，不允许 Vite dev server / preview 承担线上流量。

## 下一步：P2

1. 扩大并固定 `core-api/` 主写关闭集合。
   - 继续审计 `core-api/src/routes.js` 的 `POST` / `PUT` / `PATCH` / `DELETE`。
   - 把仍可能写入支付、任务、媒体、上传、项目产物、canvas/agent-canvas 的 legacy route 纳入 `scripts/windows/verify-core-api-compat-readonly.ps1 -BlockedWritePaths`。
   - 默认期望：compat readonly 下返回 `410 CORE_API_COMPAT_READ_ONLY`，公开 legacy GET 继续保持窄 allowlist。

2. 固化 legacy -> canonical 迁移审计入口。
   - 继续维护 `project-legacy-to-canonical.ps1`、`verify-legacy-canonical-projection.ps1`、`verify-legacy-canonical-projection-gate.ps1`。
   - 迁移对象覆盖：`tasks`、`provider_jobs`、`video_replace_jobs`、`wallet_recharge_orders`、`payment_events`、legacy media outputs。
   - 没有真实冻结窗口、备份和 reviewer sign-off 时，不对 production schema 执行 projection write。

3. 收窄前端与反代对 legacy 写入口的依赖。
   - 新功能和写路径只接 `.NET` Control API。
   - `core-api/` 只保留健康检查、Windows-native status、必要只读兼容或迁移代理。
   - Caddy/IIS public surface 继续阻断 `/api/internal/*` 和未 allowlist 的 legacy API。

4. 保持发布后固定复查。
   - 重要发布后重复：`complete-control-api-publish-restart-p0.ps1`、service ops drill、P0/canary、non-strict preflight。
   - 若只改脚本/文档，至少跑 parse、D-drive assertion、相关 smoke。

5. 支付真实材料到位时才做商户上线 evidence。
   - 按 README 的 provider onboarding 流程补 key/cert、capture、env、canary account gate。
   - 跑 native adapter、normalizer、staging replay、wallet audit。
   - 不把这些材料缺失当作 P2 工程 blocker。

## 常用验证命令

```powershell
$null = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path '.\scripts\windows\verify-core-api-compat-readonly.ps1'), [ref]$null, [ref]$null)
.\scripts\windows\verify-core-api-compat-readonly.ps1 -Port 4117

.\scripts\windows\verify-legacy-canonical-projection-gate.ps1
.\scripts\windows\verify-windows-service-ops-drill.ps1
.\scripts\windows\verify-control-plane-p0.ps1
.\scripts\windows\rehearse-production-cutover.ps1
.\scripts\windows\assert-d-drive-runtime.ps1 -EnvFile .\scripts\windows\.env.windows.example
```

运行目录同步：

```powershell
.\scripts\windows\publish-runtime-to-d.ps1 -SkipFrontend -SkipDotnetPublish
```

重要完整发布：

```powershell
D:\code\XiaoLouAI\.runtime\app\scripts\windows\complete-control-api-publish-restart-p0.ps1 `
  -SourceRoot D:\code\XiaoLouAI `
  -Root D:\code\XiaoLouAI\.runtime\app `
  -DotnetExe D:\soft\program\dotnet\dotnet.exe `
  -PythonExe D:\soft\program\Python\Python312\python.exe `
  -BaseUrl http://127.0.0.1:4100
```

## 当前已知非阻塞项

- `payment-gray-account-gate`：当前 smoke runtime 未开启真实 provider canary 入账 gate；这是商户上线 warning，不是 P2 blocker。
- 默认 `xiaolou_windows_native_test` public schema 是 canonical smoke DB，不是真实 legacy source；projection production evidence 需要真实冻结 legacy source 或 staging capture。
- `jaaz/`、`services/api/` 等上游/legacy README 只作参考，不是生产部署指南。

## 下一棒提示词

```text
继续 XiaoLouAI Windows 原生重构。先读 XIAOLOU_REFACTOR_HANDOFF.md 获取下一步操作，再读
docs/xiaolouai-python-refactor-handoff.md 和 C:\Users\10045\Downloads\deep-research-report.md 获取完整历史。
当前默认进入 P2：扩大并固定 core-api 主写关闭集合，固化 legacy -> canonical 迁移审计入口，
收窄前端/反代对 legacy 写入口的依赖。不要推进 Docker/Linux/Kubernetes、Windows + Celery、
Redis Open Source on Windows 作为生产路径。真实支付材料和真实 production legacy source rerun
只作为上线/最终验收 evidence，不作为工程 blocker。
```
