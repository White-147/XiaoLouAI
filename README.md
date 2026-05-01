<div align="center">
  <img width="120" alt="XiaoLou Logo" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
  <h1>XiaoLou - AI 创作平台</h1>
  <p>AI 图片、视频、画布创作一体化平台。</p>
</div>

---

## 功能入口

| 功能 | 路径 | 说明 |
|------|------|------|
| 图片创作 | `/create/image` | 文生图、图生图，多模型路由 |
| 视频创作 | `/create/video` | 文生视频、图生视频、首尾帧生成 |
| 创境天幕 | `/create/canvas` | 节点式 AI 画布，已内置到主项目 |
| 智能体画布 | `/create/agent-studio` | Jaaz Agent Studio 嵌入入口 |
| 项目管理 | `/assets` | 项目资产、画布项目、智能体画布资产 |
| Playground | `/playground` | 保留路由入口，当前不再接入外置服务 |

## 项目结构

```text
XIAOLOU-main/    前端 React + Vite SPA
core-api/        Node.js 过渡兼容 API（当前 PostgreSQL runtime）
services/api/    Python FastAPI 生产主后端（重构目标）
jaaz/            Jaaz Agent Studio 外置源码与运行服务
scripts/         本地启动与维护脚本
docs/            本地接力/部署说明（当前被 .gitignore 忽略）
```

## 重构状态

当前仓库以代码真实行为为准：`core-api/src/server.js` 已经通过
`store-factory.js` 创建 `PostgresStore`，不再直接实例化旧的
`SqliteStore`。但 Node `core-api` 仍是过渡兼容层；新的生产主后端正在
`services/api` 下按 FastAPI + SQLAlchemy + Alembic + Celery 方向补齐。

SQLite 相关脚本仅保留为迁移/备份工具，`CORE_API_DB_PATH` 只允许作为
migration-only 输入，不应作为运行时配置。视频替换链路仍有进程内 GPU
队列状态，后续会迁移到 PostgreSQL 持久化 + RabbitMQ/Celery worker。

## 快速开始

```bash
cd core-api && npm install
cd ../XIAOLOU-main && npm install
```

配置后端 API Key：

```bash
cp core-api/.env.example core-api/.env.local
```

启动：

```bash
cd core-api && npm run dev
cd XIAOLOU-main && npm run dev
```

Windows 可双击：

```text
scripts\start_xiaolou_stack.cmd
```

## 环境变量

| 文件 | 关键变量 | 说明 |
|------|---------|------|
| `core-api/.env.local` | `YUNWU_API_KEY` | 图片 / 视频生成 |
| `core-api/.env.local` | `VOLCENGINE_ARK_API_KEY` | Seedance / Ark 能力 |
| `XIAOLOU-main/.env.local` | `VITE_CORE_API_BASE_URL` | 公网部署时可改为域名 |
| `XIAOLOU-main/.env.local` | `VITE_JAAZ_*` | Jaaz 嵌入与 API 代理 |

`/playground` 只保留前端路由入口，不再启动 Docker 容器或连接外置对话服务。

## 部署说明

建议目标机器使用 Node.js 20+。仓库已提交前端、后端、Jaaz UI 的
`package-lock.json`，部署时按 lockfile 安装依赖即可：

```bash
cd core-api && npm install
cd ../XIAOLOU-main && npm install
cd ../jaaz/react && npm install
```

本地开发可继续用 Vite dev server。生产或公网部署不要用 `npm run dev`
或 `vite preview` 承担线上流量；正确方式是构建前端静态产物，再由
Caddy/Nginx/Ingress 托管 `dist`：

```bash
cd XIAOLOU-main && npm run build
# 发布 XIAOLOU-main/dist，由 Caddy/Nginx/Ingress 托管
```

过渡期如果仍运行 Node 兼容 API：

```bash
cd core-api && npm run start      # 4100
```

Caddy/Nginx 用于统一反向代理入口：

- `/api/*`、`/uploads/*`、`/jaaz*`、`/jaaz-api*`、`/socket.io/*` 转发到 `4100`
- 其他页面转发到前端 `3000`

仓库只提交 `caddy/Caddyfile` 与部署说明，不提交 `caddy.exe`、zip、日志和
pid 文件。目标机器请安装系统 Caddy，或从官方 release 下载二进制后运行：

```bash
caddy run --config caddy/Caddyfile
```

Windows 本地调试可以使用：

```text
scripts\start_xiaolou_stack.cmd
scripts\start_caddy.cmd
```

部署前请根据实际域名修改 `caddy/Caddyfile` 中的站点块，并把真实密钥只写入
`.env.local`，不要提交到仓库。

## Local Docker Compose infrastructure

The root `docker-compose.yml` starts the local infrastructure required by the
Python API and Celery workers. By default it starts RabbitMQ and Redis only;
PostgreSQL is kept behind the optional `postgres` profile for isolated/new
machine testing:

```text
PostgreSQL  postgres:18.3-trixie
RabbitMQ    rabbitmq:4.2.6-management
Redis       redis:8.6.2-trixie
```

For local development the initial credentials are `root` / `root`. Do not use
these passwords for a shared or internet-facing production deployment.

```powershell
Copy-Item .env.compose.example .env
.\scripts\pull-local-compose-images.ps1
docker compose up -d rabbitmq redis
```

RabbitMQ management UI is exposed at `http://127.0.0.1:15672`.

To start the isolated compose PostgreSQL as well:

```powershell
.\scripts\pull-local-compose-images.ps1 -IncludePostgres
docker compose --profile postgres up -d postgres rabbitmq redis
```

## License

MIT
