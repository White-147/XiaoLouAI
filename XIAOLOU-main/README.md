<div align="center">
  <img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# XiaoLou 前端

语言：[简体中文](README.md) | [English](README.en.md)

## 标准开发方式

必需服务：

- `3000` 或当前 Vite 端口：`XIAOLOU-main` 前端
- `4100`：`.NET` Control API，生产 canonical public routes 的主入口
- `core-api`：仅在迁移期作为只读兼容面、登录/签发过渡或本地对照使用，不应恢复旧写入口
- `5174` / `57988`：Jaaz UI / Jaaz API，仅用于本地智能体画布对照或 embed 调试，不是生产控制面

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
| 创境天幕 | `/create/canvas` | 小楼原生画布 |
| 智能体画布 | `/create/agent-studio` | Jaaz 嵌入画布 |
| 项目管理 | `/assets` | 项目资产与智能体画布资产 |
| Playground | `/playground` | 保留路由入口，不再接入外置服务 |

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
- `/create/agent-studio` 的旧 Jaaz 写依赖已退役；需要本地 embed 对照时才使用 Jaaz 端口。
- `/playground` 的外置实现已清理，只保留路由入口，方便后续接入小楼原生能力。
- project、canvas、agent-canvas、create image/video list-delete 已接入第一批 `.NET`
  canonical source endpoints：`/api/projects*`、`/api/canvas-projects*`、
  `/api/agent-canvas/projects*`、`/api/create/images*`、`/api/create/videos*`。
  该批源码验证已通过，但运行态仍需管理员 publish/restart/P0 后才能声明服务已更新。

## README 语言维护规则

请保持本文件与 `README.en.md` 同步。后续修改 README 时必须同时更新中英文版本。
