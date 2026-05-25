# XiaoLouAI 运行记录索引

本目录只作为公开可读的运行记录访问入口。总索引只承接链接，不承载大块阶段流水；每个阶段或证据域各自维护一份短记录。

## 阅读方式

- 阶段推进记录放在 `phases/`，按 L/M/N/O 队列拆分。
- 验证证据记录放在 `evidence/`，只保留可复核入口、边界和来源。
- `deploy/records/` 是本地长记录目录，默认 ignored，不作为 GitHub README 链接目标。
- `.runtime/` 中的 logs、replay、backups 和 publish artifacts 不提交。

## 阶段记录

- [Phase L - 前端设计约束收口](./phases/phase-l-frontend-design-constraint.md)
- [Phase M - 前端 follow-up 收口](./phases/phase-m-frontend-followup.md)
- [Phase N - 前端 owner 队列](./phases/phase-n-owner-queue.md)
- [Phase O - 公网访问硬化队列](./phases/phase-o-public-access-hardening.md)

## 证据记录

- [Windows-native Control Plane 验证](./evidence/windows-native-control-plane.md)
- [Legacy surface 与 canonical projection 证据](./evidence/legacy-surface-projection.md)
- [支付 Provider 边界与 replay 验证](./evidence/payment-provider-boundary.md)
- [运维 drill、备份与回滚验证](./evidence/ops-drills-and-rollback.md)
