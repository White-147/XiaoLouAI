# Legacy surface 与 canonical projection 证据

## 范围

本记录整理 legacy `core-api` / `services-api` 到 Windows-native canonical control plane 的迁移、只读兼容、projection gate 和 retained evidence 摘要。

## 运行摘要

- 当前生产控制面是 `.NET Control API`；legacy `core-api` 只能作为 read-only compatibility process 或迁移参考。
- `legacy/core-api` 与 `legacy/services-api` 是 archive reference paths，不是生产 service registration、reverse-proxy target、scheduled task 或 Windows Service working directory。
- Projection gate 检查 accounts、jobs、payments、wallet ledger、media objects、provider health 和 frontend/reverse-proxy legacy dependency。
- 没有真实 legacy source 时，routine engineering audit 把缺失材料记录为 `evidence_pending`，不是工程 blocker；真实 cutover 才要求 strict evidence。

## 验证入口

```powershell
D:\code\XiaoLouAI\scripts\windows\verify-p2-cutover-audit.ps1 -FailOnFrontendLegacyWriteDependency
D:\code\XiaoLouAI\scripts\windows\verify-legacy-canonical-projection.ps1
D:\code\XiaoLouAI\scripts\windows\verify-legacy-canonical-projection-gate.ps1
D:\code\XiaoLouAI\scripts\windows\verify-frontend-legacy-dependencies.ps1 -FailOnLegacyWriteDependency
```

## 已跟踪证据

- [final-legacy-surface-manifest-g11k.json](../../../deploy/retained/legacy-surface-evidence/final-legacy-surface-manifest-g11k.json)
- [legacy-projection-manifest-g11k.json](../../../deploy/retained/legacy-surface-evidence/legacy-projection-manifest-g11k.json)

上述 retained manifests 是 sanitized evidence，不包含真实生产 dump、secrets 或 operator-only evidence。

## 本地结构化证据

本地 `.runtime\xiaolou-logs` 中存在 `final-legacy-surface-*`、`frontend-legacy-dependencies-*`、`public-access-capacity-*` JSON 报告，最近样例状态为 `status: ok`。这些 runtime reports 不提交。

## 来源

- [Legacy to Canonical Projection Checklist](../../../deploy/windows/legacy-canonical-projection-checklist.md)
- [Windows Native Ops Runbook](../../../deploy/windows/ops-runbook.md)
- [运维与证据边界](../../operations-and-evidence.md)
