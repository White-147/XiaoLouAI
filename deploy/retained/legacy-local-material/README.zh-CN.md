# Legacy 本地材料保留目录

本目录保存 G11l 从 `legacy/` 迁出的、经用户确认可随 GitHub 部署携带的非密钥 legacy
本地材料。这样下一台主机可以拿到必要材料，同时不再让 `legacy/` 作为 live workspace
root 占位。`MATERIALS.sha256` 记录排除本地 secret 后的保留文件哈希。

已纳入 Git 的材料：

- `core-api/data/canvas-library/`：保留的 canvas-library 示例素材、图片、视频与
  workflow JSON。
- `core-api/uploads/`：用于跨主机参考、恢复或导入的 legacy 上传媒体。
- `core-api/backup/sqlite-2026-05-01T04-50-19-844Z/`：去除真实 env/demo state
  secret 后的保留备份材料。
- `jaaz/server/user_data/`：经本轮确认可进入部署交接的 Jaaz 本地 user_data，
  但不包含带有非空 API-key 字段的 `config.toml`。

不进入 Git 的材料：

- 真实 env 与 service-account 文件位于被忽略的 `deploy/local-secrets/legacy/`。
- 命中 secret-like app-state 文本的 `demo.sqlite` 位于被忽略的
  `deploy/local-secrets/legacy/`。
- `jaaz/server/user_data/config.toml` 位于被忽略的 `deploy/local-secrets/legacy/`。

本目录不是生产源码，也不能把 `legacy/` 恢复成生产运行入口。部署主机如需使用这些材料，
应通过明确的部署或恢复 owner 复制/导入。
