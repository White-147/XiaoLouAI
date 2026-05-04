# XiaoLouAI 短棒交接

更新时间：2026-05-04 13:03 +08
工作目录：`D:\code\XiaoLouAI`

本文件只保留下一棒必须执行和核对的内容。历史记录看 `docs/xiaolouai-finalization-handoff.md`；deep research 映射看 `docs/xiaolouai-deep-research-structured.md`；G7a 目录盘点看 `docs/xiaolouai-top-level-directory-organization-inventory.md`。

## PowerShell 读取

```powershell
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Get-Content .\XIAOLOU_REFACTOR_HANDOFF.md -Encoding UTF8
Get-Content .\docs\xiaolouai-finalization-handoff.md -Encoding UTF8
```

## 固定路线

- 生产路线只走 `.NET 8 / ASP.NET Core Control API + PostgreSQL canonical + Windows Service workers + 前端静态构建`。
- 不推进 Docker、Linux、Kubernetes、WSL、Windows + Celery 或 Redis Open Source on Windows 作为生产路径。
- `legacy/core-api` 与 `legacy/services-api` 是 legacy reference，不作为生产控制面或生产写入口。
- 不清理 `legacy_quarantine`，除非用户明确要求回滚或归档压缩。
- 每一步开始前都先核对本文件和 `docs/xiaolouai-finalization-handoff.md`，再执行 owner。

## 本轮状态

- 当前 shell：`IsAdministrator=True`，用户：`JYL\10045`。
- P0-admin：已完成。2026-05-04 09:34-09:41 只运行 `.\scripts\windows\verify-release-candidate.ps1 -PublishFrontend`。
- RC 报告：`D:\code\XiaoLouAI\.runtime\xiaolou-logs\release-candidate-s5-20260504-093456.json`。
- RC 结果：`status=warning`，`administrator=true`，`publish_frontend=true`，`blockers=0`，`physical_cleanup_executed=false`，所有 required gates 均为 `ok`。
- publish/restart/P0：`fixed-publish-restart-p0=ok`；报告 `D:\code\XiaoLouAI\.runtime\xiaolou-logs\release-candidate-publish-restart-p0-20260504-093456.json`；runtime 发布到 `D:\code\XiaoLouAI\.runtime\app`；rollback snapshot 为 `D:\code\XiaoLouAI\.runtime\xiaolou-backups\runtime-snapshots\runtime-20260504-093458`。
- 服务停启：依次停止 `XiaoLou-ClosedApiWorker`、`XiaoLou-LocalModelWorker`、`XiaoLou-ControlApi`，随后启动 `XiaoLou-ControlApi`、`XiaoLou-LocalModelWorker`、`XiaoLou-ClosedApiWorker`；当前三项服务均为 Running/Automatic。
- warning 说明：projection verifier 有 3 个运营 evidence warning（missing legacy snapshot、API-center provider health missing、staged-only），无 blocker；最终真实 provider health、真实 legacy dump/source、真实支付材料和真实 restore drill 仍作为最终验收 evidence pending。
- cleanup 边界：未执行 `execute-legacy-cleanup.ps1`，未做 physical cleanup；RC 内只跑 `cleanup-dry-run=ok`。
- G7a：已完成。新增 `docs/xiaolouai-top-level-directory-organization-inventory.md`，只做 inventory，没有移动、删除或重命名目录。
- G7b-1 `xiaolou-backups`：no-op。根目录 `D:\code\XiaoLouAI\xiaolou-backups` 存在但为空；17 处有效引用均指向 `.runtime\xiaolou-backups` 或由 `.runtime` 派生的 `$runtimeRoot` / `$runtimeStateRoot`；未移动、未删除目录。
- G7b-2 `xiaolou-cache`：no-op。根目录 `D:\code\XiaoLouAI\xiaolou-cache` 存在但为空；33 处有效引用均指向 `.runtime\xiaolou-cache` 或由 `.runtime` 派生的 `$runtimeRoot` / `$runtimeStateRoot` / `$cacheRoot`；未移动、未删除目录。
- G7b-3 `xiaolou-temp`：no-op。根目录 `D:\code\XiaoLouAI\xiaolou-temp` 存在但为空；24 处有效引用均指向 `.runtime\xiaolou-temp` 或由 `.runtime` 派生的 `$runtimeRoot` / `$runtimeStateRoot` / `$tempRoot`；未移动、未删除目录。
- G7b-4 `xiaolou-logs`：no-op。根目录 `D:\code\XiaoLouAI\xiaolou-logs` 存在但为空；44 处有效引用均指向 `.runtime\xiaolou-logs` 或由 `.runtime` 派生的 `$runtimeRoot` / `$runtimeStateRoot` / `$logRoot` / `XIAOLOU_ROOT -> .runtime\app`；未移动、未删除目录。
- G7b-5 `xiaolou-inputs`：no-op。根目录 `D:\code\XiaoLouAI\xiaolou-inputs` 存在但为空；3 处有效引用均指向 `.runtime\xiaolou-inputs` 或由 `.runtime` 派生路径；未移动、未删除目录。
- G7b-6 `xiaolou-replay`：no-op。根目录 `D:\code\XiaoLouAI\xiaolou-replay` 存在但为空；19 处有效引用均指向 `.runtime\xiaolou-replay` 或由 `.runtime` 派生路径；未移动、未删除目录。
- G7b-7 `.cache`：moved。旧脚本 `scripts\setup_video_replace.cmd`、`scripts\start_background.ps1`、`scripts\start_core_api.cmd` 已改为 `XIAOLOU_RUNTIME_ROOT -> .runtime\xiaolou-cache\legacy-cache` 派生路径；顶层 `.cache` 内容已移动到 `D:\code\XiaoLouAI\.runtime\xiaolou-cache\legacy-cache`，源目录已删除；2 个 `gh` 同名/重现残余保存在 `_root-cache-conflicts\gh-20260504-101421` 与 `_root-cache-conflicts\gh-20260504-101807`。
- G7c-1 `caddy`：moved。顶层 `D:\code\XiaoLouAI\caddy` 已迁入 `D:\code\XiaoLouAI\deploy\caddy`，源目录已删除；`README.md`、`README.zh-CN.md`、`scripts\start_caddy.cmd`、`deploy\caddy\DEPLOY.md`、legacy readiness/contract docs 的有效引用已更新；`deploy\caddy\Caddyfile` 对齐 Windows Control API allowlist、static asset cache 与 SPA fallback 边界。
- 2026-05-04 10:34 G7 completion audit：G7 仍未完成，不能进入 G8。根目录仍有空 `xiaolou-backups`、`xiaolou-cache`、`xiaolou-inputs`、`xiaolou-logs`、`xiaolou-replay`、`xiaolou-temp`，而 `.runtime\xiaolou-*` 是真实 runtime owner；根目录 `.cache\gh` 已重新出现；根目录还有 `.codex-control-api.err.log` 与 `.codex-control-api.out.log`；`video-replace-service` 仍暴露在根目录且应按首页 AI 工具箱卡片 / `/create/video-replace` / `/api/toolbox*` 归入 `tools\video\video-replace-service`。
- G7d-1 `runtime-root-residue`：moved/removed。空根目录 `xiaolou-backups`、`xiaolou-cache`、`xiaolou-inputs`、`xiaolou-logs`、`xiaolou-replay`、`xiaolou-temp` 已删除；根 `.cache\gh` 重现均已迁入 `.runtime\xiaolou-cache\legacy-cache\_root-cache-conflicts\root-cache-20260504-104208`、`root-cache-20260504-104336`、`root-cache-20260504-104727` 与 `root-cache-20260504-104857`；根 `.codex-control-api.err.log` 与 `.codex-control-api.out.log` 已迁入 `.runtime\xiaolou-logs\codex-control-api\20260504-104208`。
- G7d-1b `root-cache-gh-recurrence`：env-fixed/moved。根 `.cache\gh` 反复生成的直接原因是 User/Process `XDG_CACHE_HOME=D:\code\XiaoLouAI\.cache`；User env 已改为 `D:\code\XiaoLouAI\.runtime\xiaolou-cache\tooling-cache`。`scripts\windows\load-env.ps1` 已能纠正继承到的 repo-root `.cache` 坏值；`scripts\windows\.env.windows.example`、`publish-runtime-to-d.ps1`、`register-services.ps1`、`migrate-user-tool-data-to-d.ps1` 已同步 `XDG_CACHE_HOME`。本轮根 `.cache\gh` 已迁入 `.runtime\xiaolou-cache\tooling-cache\_root-cache-conflicts\root-cache-gh-20260504-111137`；由于当前 Codex 桌面父进程仍继承旧 Process env，验证 shell 又重现一次，最终再迁入 `root-cache-gh-20260504-111500` 并删除根 `.cache`。验证：强制坏值后 dot-source `load-env.ps1` 会改回 tooling-cache；`git diff --check` 通过（仅 CRLF 提示）。新终端或 dot-source `load-env.ps1` 后不应再写根 `.cache`。
- G7d-2 `video-replace-service`：moved。顶层 `D:\code\XiaoLouAI\video-replace-service` 已迁入 `D:\code\XiaoLouAI\tools\video\video-replace-service`，源目录不存在；`scripts\setup_video_replace.cmd` 与 `scripts\start_core_api.cmd` 默认路径已改到 tools/video，保留 `LEGACY_CORE_API_ROOT\video-replace-service` 作为 legacy-only fallback；前端 `/create/video-replace` 与 Control API `/api/toolbox*` 用户入口未改变。验证：423 个 scoped files 复扫后 ActiveRootVideoRefs=0；frontend legacy dependency gate `status=ok`、blockers/warnings 为空；`git diff --check` 无 whitespace error（仅 CRLF 提示）。
- G7d-3 `jaaz`：moved。顶层 `D:\code\XiaoLouAI\jaaz` 已迁入 `D:\code\XiaoLouAI\legacy\jaaz`，源目录不存在；`scripts\start_background.ps1`、`scripts\status.ps1` 和 `scripts\start_xiaolou_stack.cmd` 已改为 `LEGACY_JAAZ_ROOT -> legacy\jaaz`；Caddy/IIS 对 `/jaaz*` 仍是阻断/legacy surface，不反代到生产 Jaaz；前端 `ensureJaazServices()` 仍 retired。验证：422 个 scoped files 复扫后 active physical root Jaaz refs=0（保留 `/jaaz*` route literal review）；frontend legacy dependency gate `status=ok`、blockers/warnings 为空。
- README：本轮 README 中英文已同步；公开顶层目录契约已从 `caddy/` 改为 `deploy/caddy/`，从 `video-replace-service/` 改为 `tools/video/video-replace-service/`，从 `jaaz/` 改为 `legacy/jaaz/`。
- G8a frontend high-risk optimization readiness：已完成。`npm --prefix XIAOLOU-main run build` 成功，Vite v6.4.1 transformed 3169 modules，built in 11.56s；输出 66 个 JS、1 个 CSS、3 个 PNG、1 个 HTML，无 `.gz`/`.br` 预压缩产物。最大 chunk：`useCreateCreditQuote` 890.67 kB raw / 241.06 kB gzip、`AgentCanvasCreate` 663.32 / 188.80、`index` 530.72 / 163.09、`CanvasCreate` 513.00 / 140.88、CSS 209.38 / 28.44。`vite.config.ts` 当前只有 React/Tailwind plugins 与 `chunkSizeWarningLimit=1000`，无 `manualChunks`、compression、SW、CDN、modulepreload/preload 配置；route lazy 边界仍在 `src\App.tsx` 和 `src\components\Layout.tsx`，不在 readiness 阶段批量改动。
- G8b-1 `manualChunks-react-shell`：已完成。只改 `XIAOLOU-main\vite.config.ts`，新增单一 `manualChunks` 规则，范围限定 `react`、`react-dom`、`react-router-dom`，没有引入 compression、Service Worker、CDN、WebP 或自定义 preload/prefetch 策略。before build top chunks：`useCreateCreditQuote` 869.79 KiB、`AgentCanvasCreate` 647.77 KiB、`index` 518.28 KiB、`CanvasCreate` 500.98 KiB。after build：新增 `vendor-react-shell-DqgF9kLt.js` 226.53 KiB，`index-D9QfRRPB.js` 降为 290.88 KiB；`useCreateCreditQuote`、`AgentCanvasCreate`、`CanvasCreate` 基本不变。Vite 自动在 `dist\index.html` 加 `modulepreload` 指向 vendor chunk；这不是额外 preload owner。frontend legacy dependency gate `status=ok`，`git diff --check` 通过（仅 CRLF 提示）。
- G8b-2 `canvas-heavy-chunks`：已完成。复扫确认 `CanvasCreate` 静态拥有 `src\canvas`，`AgentCanvasCreate` 静态拥有 `src\agent-canvas`；`useCreateCreditQuote` 被两套 canvas 的 `NodeControls` 与 agent `ChatPanel` 共用；`@react-three/fiber`、`@react-three/drei`、`three` 只由两套 `OrbitCameraControl` 引入。曾试验配置级 `vendor-canvas-3d` manualChunks，但 `dist\index.html` 会从首页 modulepreload 约 859 KiB 3D vendor，已回退。最终只改两个 `ChangeAnglePanel.tsx`，把 `OrbitCameraControl` 改为面板级 `React.lazy` + `Suspense`，没有引入 compression、Service Worker、CDN、WebP 或自定义 preload/prefetch。before build top chunks：`useCreateCreditQuote-BnG8VYYd.js` 869.83 KiB、`AgentCanvasCreate-Cf_hWX-Q.js` 647.81 KiB、`CanvasCreate-jriDaGTE.js` 501.02 KiB、`index-D9QfRRPB.js` 290.88 KiB、`vendor-react-shell-DqgF9kLt.js` 226.53 KiB。after build：`useCreateCreditQuote-BXJCvgbq.js` 降为 11.74 KiB；3D vendor 延后为 lazy chunk `RoundedBox-D92AitKx.js` 858.04 KiB；`AgentCanvasCreate-CPlYCPjw.js` 639.73 KiB、`CanvasCreate-BGV8jFo1.js` 492.93 KiB、`index-CJDM2e8c.js` 290.88 KiB、`vendor-react-shell-DqgF9kLt.js` 226.53 KiB；两套 `OrbitCameraControl` lazy wrapper 各 8.69 KiB。`dist\index.html` 仍只 modulepreload `vendor-react-shell`，未预加载 3D vendor。build、frontend legacy dependency gate、`git diff --check` 通过（仅 CRLF 提示）。
- G8c `compression`：已完成。复扫确认 before 状态无 Vite compression 插件/脚本、`dist` 无 `.gz`/`.br`，Caddy/IIS 只有静态 cache policy。最终不新增 npm 依赖，只把 `npm run build` 改为 `vite build && node scripts/precompress-dist.mjs`，用 Node 内置 `zlib` 为 `dist` 里的 JS/CSS/HTML/JSON/SVG/TXT/WASM/XML 生成 `.br` 与 `.gz` sidecar；Caddy 生产配置和 Windows 示例均加 `file_server { precompressed br gzip }`，IIS 示例开启 `doStaticCompression=true`、`doDynamicCompression=false`。after build top raw chunks 不变：`RoundedBox` 858.04 KiB、`AgentCanvasCreate` 639.73 KiB、`CanvasCreate` 492.93 KiB、`index` 290.88 KiB、`vendor-react-shell` 226.53 KiB；新增 84 个压缩 sidecar（42 `.br` 777.04 KiB，42 `.gz` 953.28 KiB，总 1730.32 KiB）。`npm --prefix XIAOLOU-main run build`、frontend legacy dependency gate、IIS XML parse/static compression check、Caddy precompressed static scan、`git diff --check` 通过；本机未找到 `caddy.exe`，未做 Caddy runtime validate。未引入 Service Worker、CDN、WebP 或 preload/prefetch 策略。
- G8d `preload-prefetch`：已完成。复扫确认 before `dist\index.html` 只有 Vite 自动 `modulepreload` 到 `vendor-react-shell-DqgF9kLt.js`，没有自定义 preload/prefetch；route lazy 边界在 `App.tsx` 和 `Layout.tsx`，已有 prefetch 仅是 `Assets.tsx` 的 sessionStorage 数据缓存。最终只改 `XIAOLOU-main\src\components\Layout.tsx`：新增侧栏导航 hover/focus 的 intent-based route module prefetch，复用现有 dynamic import 目标；不新增 HTML `<link rel=preload/prefetch>`，不引入 Service Worker、CDN、WebP 或新的 compression 策略。before top chunks：`RoundedBox` 858.04 KiB、`AgentCanvasCreate` 639.73 KiB、`CanvasCreate` 492.93 KiB、`index-CJDM2e8c.js` 290.88 KiB、`vendor-react-shell` 226.53 KiB。after `dist\index.html` 仍只 modulepreload `vendor-react-shell`，主 chunk 变为 `index-BdODh3KS.js` 295.05 KiB；top heavy chunks 保持同级，`.br/.gz` sidecar 仍为 84 个（42 `.br`、42 `.gz`，总 1731.63 KiB）。frontend legacy dependency gate `status=ok` 且 review items 保持 7 项；`git diff --check` 通过（仅 CRLF 提示）。
- G8e `static-media-format`：已完成。复扫确认 `XIAOLOU-main\public` 与 `dist` 只有 3 个 PNG，`src` 无随包静态图片；实际 UI 使用 `chuangjing-logo-shell.png` 9.94 KiB 和 `chuangjing-favicon-32.png` 1.85 KiB，`chuangjing-logo.png` 673x673 / 210.44 KiB 只剩 Agent Studio fallback 字符串指纹，不是首屏或 UI 图片。当前环境无 `magick`/`cwebp`/`ffmpeg`，前端依赖无 `sharp`/`squoosh`，因此不引入转换工具；最终只删除未使用大 PNG，并把 `AgentStudio.tsx` fallback 改为 `/src/main.tsx` + `chuangjing-favicon-32.png`。after build：public/dist 媒体均为 2 个 PNG（合计 11.79 KiB），top chunks 和 84 个 `.br/.gz` sidecar 策略不变；deleted logo 引用扫描为 0，frontend legacy dependency gate `status=ok`，`git diff --check` 通过（仅 CRLF 提示）。
- G8f `dependency-audit`：已完成。复扫 `package.json`、`package-lock.json`、`src` imports 与 build chunks：`face-api.js`、`@google/genai`、`dotenv`、`express` importCount 均为 0；`@react-three/fiber`、`@react-three/drei`、`three` 只由两套 `OrbitCameraControl` lazy chunk 使用；`motion` 只在 `Layout.tsx` 使用；`lucide-react` 为广泛 UI 图标依赖。按单 owner 最小改动只移除未引用 `face-api.js`，没有同时移除 `@google/genai`、`dotenv`、`express`，也没有引入 Service Worker、CDN、WebP/AVIF、新 compression 或 preload/prefetch 策略。`package-lock` 包数量从 487 降为 478，并移除 `face-api.js`、`@tensorflow/tfjs-core`、相关 `@types/*` 与 `seedrandom` transitive entries。before/after top chunks 保持：`RoundedBox` 858.04 KiB、`AgentCanvasCreate` 639.73 KiB、`CanvasCreate` 492.93 KiB、`index-BdODh3KS.js` 295.05 KiB、`vendor-react-shell` 226.53 KiB；`.br/.gz` sidecar 保持 84 个（42 `.br` 777.25 KiB，42 `.gz` 954.38 KiB）。`npm --prefix XIAOLOU-main run build`、frontend legacy dependency gate、`git diff --check` 通过（仅 CRLF 提示）。
- G8g `service-worker-cdn`：已完成。复扫确认前端无 `registerSW`/workbox/SW 注册，`dist\index.html` 仍只有 Vite 对 `vendor-react-shell` 的自动 `modulepreload`；Caddy/IIS 只对 `/assets/*` 使用 immutable cache，SPA shell/root files revalidate，`/api/*`、auth/session/profile、payment notify/callback、provider health、SSE/WebSocket/`socket.io` 和 legacy route 均不进入静态缓存。最终只改 `XIAOLOU-main\src\main.tsx` 与新增 `src\lib\service-worker-retirement.ts`：启动时 unregister 当前同源/当前作用域内旧 Service Worker，并只清理 `xiaolou*`、`xiaolouai*`、`workbox*`、`vite-precache*` 命名的旧 cache；没有注册新 Service Worker，没有新增 CDN/public base path/static host，没有改 compression、WebP/AVIF 或 preload/prefetch 策略。after build：`index-DiGSEMVB.js` 295.54 KiB（约 +0.49 KiB），其他 top chunks 保持同级；`.br/.gz` sidecar 仍 84 个（42 `.br` 777.68 KiB，42 `.gz` 954.54 KiB）。build、frontend legacy gate、Caddy/IIS static cache scan、`git diff --check` 通过。

## 下一步唯一提示词

### G9a：API bandwidth / SSE-WebSocket ownership

状态：下一步默认执行。

```text
执行 G9a API bandwidth / SSE-WebSocket ownership。先读取并核对 XIAOLOU_REFACTOR_HANDOFF.md、docs/xiaolouai-finalization-handoff.md、docs/xiaolouai-deep-research-structured.md、docs/xiaolouai-top-level-directory-organization-inventory.md。只分析并处理 API bandwidth owner：复扫 `XIAOLOU-main\src` 的 fetch/stream/EventSource/WebSocket/轮询调用、`control-plane-dotnet` public API endpoints、`deploy\caddy`、`deploy\windows`、`scripts` 中 `/api/*`、`/healthz`、`/metrics`、provider health、payment callbacks、SSE/WebSocket 现状；输出高带宽/高频 API、payload 风险、缓存禁区和监控证据缺口。若能做最小可验证改动，只允许一个窄范围改动；不得恢复 legacy/core-api、legacy/services-api、legacy/jaaz，不得引入 Service Worker、CDN、新 compression、WebP/AVIF 或 preload/prefetch 策略。验证至少包括 frontend legacy dependency gate、必要的静态扫描、git diff --check；若触碰前端生产构建则跑 npm --prefix XIAOLOU-main run build。同步 handoff/docs。不要碰 legacy/core-api、legacy/services-api、legacy/jaaz、legacy_quarantine；不要执行 execute-legacy-cleanup.ps1。
```

验收边界：

- G7 corrective、G8a readiness、G8b-1 manualChunks react shell split、G8b-2 canvas-heavy-chunks、G8c compression、G8d preload-prefetch、G8e static-media-format、G8f dependency-audit、G8g service-worker-cdn 已完成；不要再移动目录，除非用户明确指定。
- 若 `rg` 仍报 `Access is denied`，使用 `Select-String`。
- 每轮只处理一个 G8 owner，不一次性混入 manualChunks、compression、preload、WebP、Service Worker 等多项高风险改动。
- 若触碰前端生产构建，至少跑 `npm --prefix XIAOLOU-main run build` 或记录明确 blocker。
- 不允许把 legacy reference 注册回 production runtime。

## 队列索引

G7b runtime-artifact 队列来自 `docs/xiaolouai-top-level-directory-organization-inventory.md`：

```text
1. xiaolou-backups -> no-op, root empty; effective refs point to .runtime\xiaolou-backups
2. xiaolou-cache   -> no-op, root empty; effective refs point to .runtime\xiaolou-cache
3. xiaolou-temp    -> no-op, root empty; effective refs point to .runtime\xiaolou-temp
4. xiaolou-logs    -> no-op, root empty; effective refs point to .runtime\xiaolou-logs
5. xiaolou-inputs  -> no-op, root empty; effective refs point to .runtime\xiaolou-inputs
6. xiaolou-replay  -> no-op, root empty; effective refs point to .runtime\xiaolou-replay
7. .cache          -> moved, content now under .runtime\xiaolou-cache\legacy-cache
```

G7c active/support 队列现在进入：

```text
1. caddy                  -> moved, deploy\caddy
2. video-replace-service  -> moved, tools\video\video-replace-service
3. jaaz                   -> moved, legacy\jaaz
```

G7 corrective 队列必须先完成或 blocked，再进入 G8/G9：

```text
1. runtime-root-residue   -> moved/removed, empty root dirs removed; root .cache/.codex logs moved under .runtime; root .cache\gh recurrence env-fixed
2. video-replace-service  -> moved, tools\video\video-replace-service, aligned with homepage toolbox cards and /create/video-replace
3. jaaz                   -> moved, legacy\jaaz
```

G7 corrective 队列已完成；G8 可以开始。P0-admin 已完成，不再重开，除非出现新的 RC 失败报告或用户要求重新验证。

G8 frontend high-risk optimization owner 队列：

```text
1. G8b-1 manualChunks-react-shell  -> done, 只拆 react/react-dom/react-router-dom vendor。
2. G8b-2 canvas-heavy-chunks       -> done, OrbitCameraControl 面板级 lazy，3D vendor 不再挂在 useCreateCreditQuote shared chunk。
3. G8c compression                 -> done, build 生成 .br/.gz sidecar；Caddy 使用 precompressed；IIS 示例开启 static compression。
4. G8d preload-prefetch            -> done, 侧栏导航 hover/focus intent-based route module prefetch；HTML preload 不变。
5. G8e static-media-format         -> done, 删除未使用 210.44 KiB 大 PNG；当前发布包媒体只剩 shell logo/favicon。
6. G8f dependency-audit            -> done, 移除未引用 face-api.js；package-lock 487 -> 478；未同轮处理其他 0-import 依赖。
7. G8g service-worker-cdn          -> done, 不新增 SW/CDN；只退役旧 SW 与旧 XiaoLou/Workbox/Vite precache。
8. G9a API bandwidth/SSE-WebSocket -> next, 复扫高频 API、payload、SSE/WebSocket 与监控证据缺口。
```

## 验证入口

G9a 建议命令：

```powershell
$env:XDG_CACHE_HOME = 'D:\code\XiaoLouAI\.runtime\xiaolou-cache\tooling-cache'
Select-String -Path .\XIAOLOU-main\src\**\*.ts,.\XIAOLOU-main\src\**\*.tsx -Pattern @('fetch(','EventSource','WebSocket','ReadableStream','setInterval','poll','stream','/api/','/healthz','/metrics') -Encoding UTF8
Select-String -Path .\control-plane-dotnet\**\*.cs -Pattern @('MapGet','MapPost','/api/','/healthz','/metrics','text/event-stream','WebSocket') -Encoding UTF8
Select-String -Path .\deploy\caddy\*,.\deploy\windows\*,.\scripts\**\* -Pattern @('/api/','/healthz','/metrics','providers/health','payments','EventSource','WebSocket','Cache-Control') -Encoding UTF8
.\scripts\windows\verify-frontend-legacy-dependencies.ps1 -FailOnLegacyWriteDependency
git diff --check
```

## 禁止项

- 不执行 `scripts\windows\execute-legacy-cleanup.ps1`。
- 不清理 `legacy_quarantine`。
- 不把 Docker/Linux/Kubernetes/WSL、Windows + Celery 或 Redis OSS on Windows 写成生产方案。
- 不把 legacy reference 注册回 production runtime。
- 不跳过当前 owner 的验证。

## 输出要求

每轮必须列出：

- 变更文件。
- legacy route 最终状态。
- 验证命令和结果。
- 未处理 TODO。
- 是否同步 `XIAOLOU_REFACTOR_HANDOFF.md`、`docs/xiaolouai-finalization-handoff.md`、`docs/xiaolouai-deep-research-structured.md`、`docs/xiaolouai-top-level-directory-organization-inventory.md`。
- README 是否修改；若未改，说明原因。
