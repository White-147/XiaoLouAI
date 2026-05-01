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
XIAOLOU-main/    前端 React + Vite
core-api/        后端 Node.js + PostgreSQL
jaaz/            Jaaz Agent Studio 外置源码与运行服务
scripts/         本地启动与维护脚本
docs/            部署说明
```

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

生产或公网单域名部署时，先启动这些服务：

```bash
cd core-api && npm run start      # 4100
cd XIAOLOU-main && npm run dev    # 3000，或 npm run build && npm run preview
```

Caddy 用于统一反向代理入口：

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

## License

MIT
