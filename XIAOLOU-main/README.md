<div align="center">
  <img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# XiaoLou 前端

语言：[简体中文](README.md) | [English](README.en.md)

## 标准开发方式

必需服务：

- `3000` 或当前 Vite 端口：`XIAOLOU-main` 前端。
- `4100`：`.NET` Control API，生产 canonical public routes 的主入口。
- `core-api`：仅用于迁移期只读兼容、登录/签发过渡或本地对照；不要恢复旧写入口。
- `5174` / `57988`：Jaaz UI / Jaaz API 仅用于本地 agent-canvas 对照或 embed 调试，不是生产控制面。

一键启动：

```text
scripts\start_xiaolou_stack.cmd
```

手动启动：

```powershell
cd control-plane-dotnet && dotnet run --project .\src\XiaoLou.ControlApi\XiaoLou.ControlApi.csproj
cd XIAOLOU-main && npm run dev
```

## 功能入口

| 页面 | 路径 | 说明 |
|------|------|------|
| 图片创作 | `/create/image` | 主要创作入口 |
| 视频创作 | `/create/video` | 主要创作入口 |
| 原生画布 | `/create/canvas` | XiaoLou 原生画布 |
| 智能体画布 | `/create/agent-studio` | Jaaz 嵌入画布 |
| 资产管理 | `/assets` | 项目资产与 agent-canvas 资产 |
| 首页工具箱 | `/` | canonical 能力卡片与排队执行的工具箱任务 |
| Playground | `/playground` | 原生 canonical 会话、消息、记忆与聊天任务 |

## 前端环境变量

```text
VITE_CORE_API_BASE_URL=http://127.0.0.1:4100
VITE_CORE_API_PROXY_TARGET=http://127.0.0.1:4100
VITE_JAAZ_AGENT_CANVAS_URL=/jaaz/?embed=xiaolou
VITE_JAAZ_DEV_PROXY_TARGET=http://localhost:5174
VITE_JAAZ_API_PROXY_TARGET=http://127.0.0.1:57988
```

## 当前说明

- `/create/canvas` 已直接编译进主前端，不需要独立画布端口。
- `/create/agent-studio` 不再默认依赖旧 Jaaz 写入；仅在本地 embed 对照时使用 Jaaz 端口。
- `/playground` 的外置实现已清理，当前调用 `.NET` canonical `/api/playground/config|models|conversations|chat-jobs|memories`。
- Project、canvas、agent-canvas、create image/video list-delete 已接入第一批 `.NET` canonical source endpoints：`/api/projects*`、`/api/canvas-projects*`、`/api/agent-canvas/projects*`、`/api/create/images*` 和 `/api/create/videos*`。源码验证、管理员 publish/restart/P0 和 `http://127.0.0.1:4100` runtime smoke 已通过，运行中的 Windows service 已包含该批能力。
- Login/register、profile、organization members、API-center settings 已接入第二批 `.NET` canonical identity/config endpoints：`/api/auth*`、`/api/me`、`/api/organizations/*/members` 和 `/api/api-center*`。4100 runtime smoke 覆盖登录、profile 更新、企业管理员注册、组织成员写入，以及 API-center defaults/key/test/model 写入。
- Project 相邻 assets/storyboards/videos/dubbings/exports 已切到第三批 `.NET` canonical endpoints：`/api/projects/{projectId}/assets*`、`/storyboards*`、`/videos`、`/dubbings` 和 `/exports`。该批已通过管理员 publish/restart/P0 与 4100 runtime smoke。
- Admin pricing/order reads 已切到 admin/system `.NET` canonical endpoints：`/api/admin/pricing-rules` 和 `/api/admin/orders`。手工 admin recharge review 继续退役并返回 410，enterprise applications 使用 `/api/enterprise-applications*`。
- Playground conversations、messages、memory preferences、memories 和 chat job creation 现在调用 `/api/playground*`。该批已通过 source build、frontend lint/build、frontend legacy dependency gate、临时 4110 P0，以及真实 4100 elevated publish/restart/P0。
- 首页工具箱 capability discovery 与可运行工具现在调用 `/api/capabilities` 和 `/api/toolbox*`。角色替换、动作迁移、高清修复、视频反推、25 格分镜和翻译请求会创建 canonical `toolbox_runs` 并进入 `jobs` 队列，不再走旧 `/api/jobs` 快捷写入。该批已通过前端 build、frontend legacy dependency gate、临时 4110 P0、strict projection verifier，以及真实 4100 patched P0 smoke。

## README 语言维护规则

请保持本文档与 `README.en.md` 同步。后续修改 README 时必须同时更新中英文版本。
