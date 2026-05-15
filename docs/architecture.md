# 总体架构

XiaoLouAI 的生产形态是 Windows 原生 AI 创作平台。前端是 React + Vite 静态站点，后端控制面是 `.NET 8 / ASP.NET Core`，PostgreSQL 是唯一 canonical source of truth，Windows Service workers 负责异步任务执行，媒体主存储是对象存储。

## 架构原则

- 前端只通过 Control API DTO/API wrappers 访问后端能力。
- PostgreSQL 负责账号、组织、钱包、支付、项目、资产、任务、Playground、Toolbox、provider health 和 outbox 等 canonical state。
- Jobs 从 PostgreSQL 队列租约执行，workers 不在内存中持有 canonical task state。
- Python 仅用于明确签过边界的本地模型 adapter 或 sidecar，不作为默认控制面。
- 生产入口不恢复 Jaaz iframe/runtime、Node `core-api`、Node payment runtime、Vite dev/preview、Docker/Linux/Kubernetes/Celery/Redis Open Source on Windows。

## 生产组件

| 组件 | 位置 | 说明 |
| --- | --- | --- |
| 前端静态站点 | `XIAOLOU-main/dist` | React + Vite build 输出，由 Caddy/IIS 服务 |
| Control API | `backend/dotnet/control-plane/src/XiaoLou.ControlApi` | `.NET 8 / ASP.NET Core` public/internal API |
| Domain | `backend/dotnet/control-plane/src/XiaoLou.Domain` | 共享请求/响应和领域模型 |
| PostgreSQL infra | `backend/dotnet/control-plane/src/XiaoLou.Infrastructure.Postgres` | canonical stores、queues、payments、outbox、health |
| Storage infra | `backend/dotnet/control-plane/src/XiaoLou.Infrastructure.Storage` | 对象存储签名、本地 provider URL policy |
| Closed API worker | `backend/dotnet/control-plane/src/XiaoLou.ClosedApiWorker` | closed API provider jobs，当前含 Vertex Gemini 图片链路 |
| Local model worker | `backend/dotnet/control-plane/src/XiaoLou.LocalModelWorkerService` | Windows Service wrapper，监督本地模型 sidecar |
| Local sidecar | `backend/services/model-runtime/local-model-worker-sidecar` | Python 本地模型 adapter 边界 |

## 前端产品域

前端代码按产品域聚合在 `XIAOLOU-main/src/features/` 下：

| 产品域 | 说明 |
| --- | --- |
| `home` | 首页、导航壳、账号中心、route prefetch |
| `create-image` | 图片创作、参考图、素材引用、结果预览 |
| `create-video` | 视频创作、参考素材、任务历史 |
| `toolbox` | 剧本拆解、视频反推、25 格分镜、人物替换等工具 |
| `playground` | 会话、消息、模型配置、记忆偏好 |
| `canvas-agent-canvas` | 原生画布和智能体画布 |
| `assets-media-projects` | 资产、项目、媒体管理 |
| `wallet-payments-api-center` | 钱包、支付、API-center |
| `account-admin-enterprise` | 账号、企业控制台、超级后台 |
| `comic-production` | 剧本广场、漫剧制作 |

## Public API Surface

公网代理只应暴露经过审查的 Control API routes，例如：

- `/healthz`、`/livez`、`/readyz`
- `/api/accounts/ensure`
- `/api/jobs*`
- `/api/payments/callbacks/*`
- `/api/media/upload-begin`
- `/api/media/upload-complete`
- `/api/media/move-temp-to-permanent`
- `/api/media/signed-read-url`
- `/api/media/object-content/*`
- `/api/media/object-upload/*`
- `/api/wallet*`
- `/api/auth*`
- `/api/me`
- `/api/organizations*`
- `/api/api-center*`
- `/api/admin*`
- `/api/enterprise-applications*`
- `/api/capabilities`
- `/api/playground*`
- `/api/toolbox*`
- `/api/projects*`
- `/api/canvas-projects*`
- `/api/agent-canvas/projects*`
- `/api/create/images*`
- `/api/create/videos*`

公网代理必须阻断 `/api/internal/*`、`/api/schema/*`、`/api/providers/health`、`/metrics` 和未列入 public surface 的 legacy API。

## 核心任务流

1. 前端创建任务或上传素材。
2. Control API 完成 client auth、account scope、权限、body cap、rate/concurrency guard。
3. Control API 写入 PostgreSQL canonical tables 和 job queue。
4. Worker 使用 `FOR UPDATE SKIP LOCKED` 租约任务。
5. Worker 调用 closed API provider 或本地 adapter。
6. 生成媒体写入对象存储。
7. Worker 写入 job result，前端通过 Control API 读取状态和稳定媒体 URL。

## 对象存储

媒体主存储是 object storage。`ObjectStorage:Provider=local` 时：

- 浏览器上传使用签名 `/api/media/object-upload/{bucket}/{objectKey}`。
- 稳定读取使用 `/api/media/object-content/{bucket}/{objectKey}`。
- object-content 支持 HTTP range read。
- 外部 object storage/CDN provider 不应把 frontend `urlPath` 改写成本地 object-content。

## 公网硬化

当前公网访问硬化包含：

- Caddy/IIS 粗粒度 body ceiling：auth `64KB`、public JSON `2MB`、object upload `256MB`。
- Control API `PublicAccessLimits` 固定窗口和并发保护。
- Home-to-Playground 只预取 lazy route chunk，不隐藏挂载 Playground。
- 稳定 JSON metadata routes 启用 dynamic compression、private `max-age=30`、weak ETag 和 304。
- `scripts/windows/verify-public-access-capacity.ps1` 提供离线容量核算和 public-origin HTTP smoke。
