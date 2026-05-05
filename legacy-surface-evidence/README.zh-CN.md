# Legacy Surface Evidence

语言：[English](README.md) | [简体中文](README.zh-CN.md)

本目录保存 legacy source removal readiness 以及 G11k/G11l 之后非 live verifier
模式使用的已脱敏 retained evidence。它不是运行目录，不能存放 secret、upload、运营侧
生产 evidence、本地数据库 dump，或已归拢到 deploy 的 retained local material。

当前保留的 manifest：

- `final-legacy-surface-manifest-g11k.json`：live `legacy/core-api` 与
  `legacy/services-api` 通过 final legacy surface checks 后生成。
- `legacy-projection-manifest-g11k.json`：live `legacy/core-api` projection
  source evidence 通过 projection source checks 后生成。

G11k 已从 `legacy/core-api`、`legacy/services-api` 与 `legacy/jaaz` 删除 421 个经
复核的 git-tracked legacy source candidate。G11l 随后把用户确认可随部署携带的非密钥本地
材料移动到 `deploy/retained/legacy-local-material/`，把真实 env/service-account 文件、
命中 secret-like app-state 的 demo SQLite 和带非空 API-key 字段的 Jaaz config 移到
被忽略的 `deploy/local-secrets/legacy/`，
删除日志、缓存和空目录，并在根 `.gitignore` 覆盖后删除剩余 tracked legacy `.gitignore`。

这些 manifest 支持显式非 live verifier 模式；它们不能替代运营侧最终验收 evidence、
真实 restore drill，或有意恢复 live legacy reference 时所需的 dependency restore。

G11l validation note：cleanup dry-run 与 release candidate verifier 会在 live legacy root
缺席时把这些 manifest 继续传给子 gate。使用显式 skip 的 RC 或 P2 运行仍是 reduced warning
evidence，不是完整最终验收。
