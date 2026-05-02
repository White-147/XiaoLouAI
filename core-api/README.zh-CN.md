# core-api

语言：[English](README.md) | [简体中文](README.zh-CN.md)

`core-api` 是 XiaoLou AI 创作平台的 Node.js 兼容 API，使用 Node 内置 HTTP
模块运行。它现在只是迁移期兼容面；生产控制面正在
`../control-plane-dotnet` 下建设。

## 提供的能力

- 项目、脚本、资产、故事板、视频、配音、任务、钱包、企业、工具箱和画布相关
  REST endpoint。
- `/api/tasks/stream` Server-Sent Events，用于任务进度。
- PostgreSQL-backed runtime；SQLite 只保留为迁移输入和备份。

## 运行状态

以当前代码为准，不以旧架构报告为准：`src/server.js` 调用
`store-factory.js`，后者创建 `PostgresStore`。它不会直接实例化旧
`SqliteStore`。`scripts/*sqlite*.js` 中的 SQLite 脚本只作为迁移工具，不得作为
运行时持久化方案。

新的生产工作应优先落在 `control-plane-dotnet/`。P1 切换期间，如果还需要运行
core-api，应把它作为只读兼容面：

```text
CORE_API_COMPAT_READ_ONLY=1
```

该模式下，core-api 会用 `CORE_API_COMPAT_READ_ONLY` 拒绝 `POST` / `PUT` /
`PATCH` / `DELETE`。如果未设置 `CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST`，
只读模式只暴露 `GET /healthz` 和 `GET /api/windows-native/status`；其他
legacy public read route 默认关闭，直到被显式 allowlist 或代理到 .NET 控制面。

## 快速开始

```bash
cd core-api
npm install
cp .env.example .env.local   # 然后填入真实 API key
npm run dev
```

默认端口：**4100**

## 环境变量

复制 `.env.example` 到 `.env.local` 并填入密钥：

```text
YUNWU_API_KEY=your_real_key
YUNWU_BASE_URL=https://yunwu.ai
```

常用覆盖项：

```text
PORT=4100
HOST=::                              # :: = 全部接口；127.0.0.1 = 仅本地
CORE_API_PUBLIC_BASE_URL=https://your-domain.com
CORE_API_COMPAT_READ_ONLY=1
CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST=GET /healthz;GET /api/windows-native/status
DATABASE_URL=postgres://root:root@127.0.0.1:5432/xiaolou
READ_DATABASE_URL=postgres://root:root@127.0.0.1:5432/xiaolou
PGBOUNCER_DATABASE_URL=postgres://root:root@127.0.0.1:6432/xiaolou
POSTGRES_USER=root
POSTGRES_PASSWORD=root
POSTGRES_DB=xiaolou
CORE_API_DB_PATH=./data/demo.sqlite  # 仅迁移输入，不作为运行时数据库
CORE_API_UPLOAD_DIR=./uploads
```

## PostgreSQL 迁移

切换后，PostgreSQL 是唯一运行时写入目标。SQLite 只作为停止写入后的迁移源和
回滚备份。第一阶段 PostgreSQL 会把完整应用快照保存在
`legacy_state_snapshot.snapshot_value`，同时把高价值实体投影到显式管理表，
例如 `users`、`wallets`、`projects`、`project_assets`、`storyboards`、
`videos`、`dubbings`、`tasks`、`canvas_projects`、`create_studio_*` 和
`playground_*`。video-replace job metadata 会迁到 `video_replace_jobs`，
Jaaz 画布、聊天和 workflow 数据会迁到 `jaaz_*` 表。

初始化本地管理账号和数据库：

```bash
cd core-api
psql -f db/init-root.psql postgres
```

迁移前停止 core-api，避免 SQLite 继续接收写入，然后运行：

```bash
npm run db:backup-sqlite
npm run db:migrate
npm run db:import-sqlite
npm run db:import-vr-sqlite
npm run db:import-jaaz-sqlite
npm run db:cutover:postgres
```

`db:cutover:postgres` 会验证 `legacy_state_snapshot` 存在，并把 PostgreSQL
运行时设置写入 `.env.local`。同机部署优先使用 `127.0.0.1`，只有需要公网地址
时才使用 `-- --use-public`。

PostgreSQL 模式默认拒绝空 snapshot 启动，避免在导入前意外用种子数据覆盖当前
SQLite 数据。全新 demo-only 数据库可设置 `POSTGRES_ALLOW_EMPTY_BOOTSTRAP=1`。

重启 core-api 后验证：

```bash
npm run verify:postgres
```

## 支付与充值

充值订单使用服务端规则 `1 RMB = 2 credits`，浏览器传入的展示 credit 会由后端
重新计算。

Alipay RSA2 集成应先使用 sandbox credentials 完成端到端充值，再切换
`ALIPAY_ENV=production` 和生产密钥。Mock recharge 默认仅本地可见，不要在生产
使用 `PAYMENT_MOCK_ALLOWED_HOSTS=*`。

## Public Super Admin Login

`root_demo_001` 只允许 loopback 使用。公网域名访问 admin console 时，应在
`core-api/.env.local` 配置真实 super-admin 账号并重启 core-api。

单域名反向代理时，`/api/*` 与 `/uploads/*` 必须在前端 catch-all 之前代理到
core-api 4100 端口，以便 Alipay async notify 能到达 API。

## 单域名模式

一个公网域名同时暴露前端和 API：

- `/` -> frontend port 3000
- `/api` 和 `/uploads` -> core-api port 4100

在 `core-api/.env.local` 设置：

```text
CORE_API_PUBLIC_BASE_URL=https://your-domain.com
```

并在 `XIAOLOU-main/.env.local` 将 `VITE_CORE_API_BASE_URL` 设置为相同 origin。

## API Key 参考

| Key | 用途 | 获取位置 |
|-----|------|----------|
| `YUNWU_API_KEY` | 图片 / 视频生成（Yunwu gateway） | https://yunwu.ai |
| `VOLCENGINE_ARK_API_KEY` | Seedance 2.0 video，可选 fallback | https://console.volcengine.com/ark |
| `PIXVERSE_API_KEY` | PixVerse video，可选 | https://app.pixverse.ai |

## Smoke test

```bash
npm run verify
```

该命令会随机端口启动服务，并检查 `/healthz`、`/api/projects`、
`/api/projects/:id/overview` 和 `/api/toolbox/capabilities`。它还会创建项目、
重启并确认持久化。

## 常用请求

```powershell
Invoke-RestMethod http://127.0.0.1:4100/api/projects
Invoke-RestMethod http://127.0.0.1:4100/api/projects/proj_demo_001/overview
Invoke-RestMethod http://127.0.0.1:4100/api/toolbox
Invoke-RestMethod -Method Post http://127.0.0.1:4100/api/demo/reset
```

## 说明

- Runtime persistence 只使用 PostgreSQL；SQLite 文件只由迁移 / 备份脚本读取。
- `POST /api/demo/reset` 会恢复 demo 种子数据。
- Canvas API：`/api/canvas/*` 与 `/api/canvas-library/*`，保留 legacy aliases
  `/twitcanva-api/*`。
- Response envelope：`{ success, data?, error?, meta? }`。

## Video Replace 架构（Windows 原生迁移）

`core-api` 现在只是兼容面。长期控制面是 `control-plane-dotnet/`，持久化工作流
必须经过 PostgreSQL `jobs` 和 Windows Service workers。Python 可以继续运行
`video-replace-service/vr_pipeline_cli.py` 这类本地模型适配代码，但不能成为主
控制面或 Celery 异步基础。

切换期兼容流量仍可能进入 **core-api 4100 端口**。新的生产工作应使用 .NET
控制面和 PostgreSQL 队列契约：

```text
browser
   -> .NET control API (4100)
        -> PostgreSQL jobs/job_attempts
        -> Windows Service local-model-worker
             -> optional Python model adapter / inference runner
```

旧 `video-replace-service/app/main.py`（4200 FastAPI standalone）只用于 legacy
debug，不属于默认运行栈。

## README 语言维护规则

请保持本文件与 `README.md` 同步。后续修改 README 时必须同时更新中英文版本。
