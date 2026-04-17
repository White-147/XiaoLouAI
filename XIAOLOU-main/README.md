<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# XiaoLou — AI 创作平台

## 标准开发方式

**必需端口：**
- **3000** — XIAOLOU-main 前端
- **4100** — core-api 后端

**可选端口：**
- **8080** — Open WebUI / Playground（需单独配置 Docker）

**一键启动：** `scripts\start_xiaolou_stack.cmd`

**手动启动：**
```bash
# 终端 1
cd core-api && npm install && npm run dev

# 终端 2
cd XIAOLOU-main && npm install && npm run dev
```

## 首次安装

```bash
cd XIAOLOU-main && npm install
cd ../core-api && npm install
```

在 `core-api/.env.local` 中配置必要 API Key（参见 `core-api/.env.example`）：

```text
YUNWU_API_KEY=your_real_key
```

前端环境变量（`.env.local`，可选覆盖）：

```text
VITE_CORE_API_BASE_URL=http://127.0.0.1:4100
VITE_CORE_API_PROXY_TARGET=http://127.0.0.1:4100
```

## 功能入口

| 页面 | 路径 | 说明 |
|------|------|------|
| 图片创作 | `/create/image` | 主要功能，基于统一能力层 |
| 视频创作 | `/create/video` | 主要功能，基于统一能力层 |
| 画布创作 | `/create/canvas` | 主要功能，直接嵌入 React 组件 |
| Playground | `/playground` | 可选，需要 Open WebUI（见下） |

## 画布创作架构

画布创作（`/create/canvas`）现已**直接编译进主项目**（`src/canvas/`），
不再使用 iframe + 独立编译产物。不需要启动额外工程，也不需要重建画布 dist。

画布后端由 `core-api (4100)` 提供，API 路径 `/api/canvas/*`。

> 如果你看到仓库里有 `internal/twitcanva-runtime/` 目录，那是历史遗留，
> 当前代码路径不再依赖它。

## 单域名公网部署

将公网域名指向端口 3000，所有请求通过前端 Vite 代理：

- `/` → 前端 3000
- `/api`、`/uploads` → core-api 4100
- `/openwebui` → Open WebUI 8080（如启用）

公网环境推荐配置（`XIAOLOU-main/.env.local`）：
```text
VITE_CORE_API_BASE_URL=http://your-domain.com
VITE_CORE_API_PROXY_TARGET=http://127.0.0.1:4100
VITE_OPEN_WEBUI_URL=/openwebui
VITE_OPEN_WEBUI_PROXY_TARGET=http://127.0.0.1:8080
```

## Playground / Open WebUI

Playground 通过 `/openwebui` 子路径代理到 Open WebUI 容器（端口 8080）。

- 启动脚本：`scripts\start_openwebui.cmd`
- 配置模板：`scripts\openwebui.env.example`（复制为 `openwebui.env.local` 后填入真实 key）
- 需要 Docker 运行环境

**注意：** Playground 目前处于开发早期，没有进行系统性的性能和稳定性调优。
可以使用，但不是当前主要功能承诺。如不需要，可跳过。

## 当前代码状态说明

### 主要功能（已稳定）
- `/create/image`、`/create/video`、`/create/canvas` 是当前核心创作入口
- 标准开发/部署模式 3000 + 4100，无额外依赖
- 视频默认模型：Seedance 系列

### Playground 当前状态
- Playground 仍处于开发初期，没有做系统性的性能、稳定性和交互调优
- 可以使用，但不适合作为当前项目最稳定的核心功能承诺
- 若未配置 Open WebUI / Docker，可直接跳过

### 剧本生成功能当前状态
- 剧本生成功能早期做过联调和基础调试
- 近期不是重点优化方向，可能存在使用体验一般、响应不稳定、偶发 bug 等问题
- 如重点使用该功能，需要自行继续测试和调优
