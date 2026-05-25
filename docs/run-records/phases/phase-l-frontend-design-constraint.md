# Phase L - 前端设计约束收口

## 范围

本记录整理 frontend-design-constraint 阶段的公开摘要。完整长流水保存在本地 ignored `deploy/records/`，公开索引不直接链接该目录。

## 阶段结论

- 完成 shell/account center、Playground、admin console、create/assets、canvas host shell helper/service/project save/load 等拆分和治理收口。
- 约束前端代码只走 Control API DTO/API wrappers，不恢复 legacy runtime 写路径。
- 不触碰 backend、env/proxy、Caddy/IIS、provider adapters、runtime publish 或部署脚本，除非单独 owner 覆盖。

## 验证入口

```powershell
npm --prefix .\XIAOLOU-main run lint
npm --prefix .\XIAOLOU-main run test:unit
npm --prefix .\XIAOLOU-main run build
git diff --check
```

## 来源

- [开发与验证](../../development.md)
- [工程约束](../../engineering-constraints.md)
- [短棒交接](../../../XIAOLOU_REFACTOR_HANDOFF.md)
