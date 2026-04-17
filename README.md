# XiaoLou — AI 创作平台

AI 图片、视频、画布创作一体化平台，支持 Seedance / PixVerse / Kling / Grok 等多模型。

---

## 目录结构

```
XIAOLOU-main/   前端 (React + Vite, 端口 3000)
core-api/       后端 (Node.js + SQLite, 端口 4100)
scripts/        启动脚本
```

> `src/canvas/` 已并入 XIAOLOU-main 主项目，**不再需要独立的 TwitCanva / canvas 工程**。

---

## 环境要求

| 工具 | 最低版本 | 用途 |
|------|---------|------|
| Node.js | 22.5+ | 前后端运行时（内置 SQLite） |
| npm | 9+ | 依赖管理 |
| Docker | 任意版本 | 仅 Playground / Open WebUI 场景需要 |

---

## 首次安装

```bash
# 后端依赖
cd core-api
npm install

# 配置 API Key（复制模板后填入真实值）
cp .env.example .env.local
# 编辑 .env.local，至少填入：
#   YUNWU_API_KEY=your_real_key

# 前端依赖
cd ../XIAOLOU-main
npm install
```

---

## 环境变量配置

### 后端 `core-api/.env.local`

```text
# 必填 — 图片/视频生成
YUNWU_BASE_URL=https://yunwu.ai
YUNWU_API_KEY=your_real_key

# 可选 — Volcengine Ark（Seedance 2.0 视频）
# VOLCENGINE_ARK_API_KEY=your_ark_key

# 可选 — PixVerse 视频
# PIXVERSE_API_KEY=your_pixverse_key
```

参考：`core-api/.env.example`

### 前端 `XIAOLOU-main/.env.local`（本地开发默认不需要创建）

```text
# 默认已通过 vite.config 代理，通常不需要修改
VITE_CORE_API_BASE_URL=http://127.0.0.1:4100
VITE_CORE_API_PROXY_TARGET=http://127.0.0.1:4100
```

参考：`XIAOLOU-main/.env.example`

---

## 启动步骤

### 方式一：一键启动（Windows）

```
双击 scripts\start_xiaolou_stack.cmd
```

### 方式二：手动启动

```bash
# 终端 1 — 后端
cd core-api && npm run dev

# 终端 2 — 前端
cd XIAOLOU-main && npm run dev
```

---

## 访问地址

| 地址 | 说明 |
|------|------|
| http://127.0.0.1:3000 | 主站前端 |
| http://127.0.0.1:4100 | 后端 API |
| http://127.0.0.1:3000/create/image | 图片创作 |
| http://127.0.0.1:3000/create/video | 视频创作 |
| http://127.0.0.1:3000/create/canvas | 画布创作 |
| http://127.0.0.1:3000/assets | 我的资产 |

---

## 可选：启动 Playground / Open WebUI

Playground 需要 Docker 和 Volcengine Ark / OpenAI 兼容 API Key。

```bash
# 1. 复制配置模板
copy scripts\openwebui.env.example scripts\openwebui.env.local

# 2. 编辑 scripts\openwebui.env.local，填入：
#    OPENAI_API_KEY=your_key
#    WEBUI_PUBLIC_URL=http://127.0.0.1:8080

# 3. 启动（需要 Docker 已运行）
scripts\start_openwebui.cmd
```

启动后访问：http://127.0.0.1:8080

---

## 常见问题排查

**前端起不来 / 端口被占用**

```bash
# Windows：查找并结束占用 3000 端口的进程
netstat -ano | findstr :3000
taskkill /PID <pid> /F
```

**后端报错 `node:sqlite` 实验性警告**

正常现象（Node 24），不影响功能。

**图片/视频生成失败**

检查 `core-api/.env.local` 中 `YUNWU_API_KEY` 是否已填写且有效。

**画布创作节点不显示**

画布数据存储在 SQLite（`core-api/data/demo.sqlite`）。
确保后端正常运行后刷新页面，或执行：

```
POST http://127.0.0.1:4100/api/demo/reset
```

**Open WebUI 无法启动**

确认 Docker Desktop 已运行，`scripts/openwebui.env.local` 中 `OPENAI_API_KEY` 已填写。

---

## 单域名公网部署

将公网域名反向代理到端口 3000，通过 Vite 代理转发：

- `/` → 前端 3000
- `/api`、`/uploads` → core-api 4100
- `/openwebui` → Open WebUI 8080（可选）

在 `XIAOLOU-main/.env.local` 中设置：

```text
VITE_CORE_API_BASE_URL=https://your-domain.com
VITE_CORE_API_PROXY_TARGET=http://127.0.0.1:4100
```

在 `core-api/.env.local` 中设置：

```text
CORE_API_PUBLIC_BASE_URL=https://your-domain.com
```

---

## 当前代码状态说明

### 主要功能（稳定）

- `/create/image`、`/create/video`、`/create/canvas` 是当前核心创作入口，已充分联调
- 画布创作已直接内嵌在主项目中（`src/canvas/`），无独立工程依赖
- 视频默认模型：Seedance 2.0

### Playground 当前状态

- Playground 仍处于开发初期，未做系统性的性能、稳定性和交互调优
- 可以使用，但**不适合**作为当前版本最稳定功能的核心承诺
- 若未配置 Open WebUI / Docker，可直接跳过，不影响其他功能

### 剧本生成功能当前状态

- 剧本生成功能早期做过联调和基础调试，近期不是重点优化方向
- 目前可能存在：使用体验一般、响应不稳定、偶发 bug
- 如果重点使用该功能，需要自行进一步测试和调优

### 整体说明

- 现阶段优先保障主创作链（图片 / 视频 / 画布）稳定
- 所有外围模块（Playground、剧本生成等）均可独立启用，不影响主链
- 3000 + 4100 是标准最小部署，8080 完全可选
