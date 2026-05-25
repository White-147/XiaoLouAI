# 运维 drill、备份与回滚验证

## 范围

本记录整理 Windows Service ops drill、runtime rollback drill、PostgreSQL backup、daily checks 和 recovery rules 的运行验证入口。

## 运行摘要

- Daily checks 覆盖 Windows services、`/healthz`、`/livez`、`/readyz`。
- Windows Service ops drill 检查三项服务、direct `dotnet.exe <dll>` service paths、D 盘 runtime boundaries、restart failure actions、dependencies、Control API health 和近期事件。
- Runtime rollback drill 通过 `restore-runtime-snapshot.ps1` 检查或执行 runtime artifact 恢复，保留 active `.env.windows`。
- Backups 通过 `backup-postgres.ps1` 执行，支付和钱包备份至少保留到一轮完整 reconciliation。

## 验证入口

```powershell
Get-Service XiaoLou-ControlApi,XiaoLou-ClosedApiWorker,XiaoLou-LocalModelWorker
Invoke-RestMethod http://127.0.0.1:4100/healthz
Invoke-RestMethod http://127.0.0.1:4100/livez
Invoke-RestMethod http://127.0.0.1:4100/readyz
```

Drill 与备份入口：

```powershell
D:\code\XiaoLouAI\scripts\windows\verify-windows-service-ops-drill.ps1
D:\code\XiaoLouAI\scripts\windows\verify-windows-service-ops-drill.ps1 -ExecuteRestart
D:\code\XiaoLouAI\scripts\windows\restore-runtime-snapshot.ps1
D:\code\XiaoLouAI\.runtime\app\scripts\windows\backup-postgres.ps1
```

## Recovery rules

- 不直接编辑或删除 `wallet_ledger`。
- balance snapshot 错误时，从 immutable ledger rebuild `wallet_balances`。
- payment callback 通过 idempotent handler 重放，不手工修余额。
- worker 故障时先停 worker，恢复 expired leases，再重启。
- rollback 时不删除 object storage permanent objects。

## 证据边界

Ops drill 和 rollback drill 会把 JSON 报告写到 `.runtime\xiaolou-logs`。这些是 runtime evidence，不提交；公开文档只保留验证入口和摘要。

## 来源

- [Windows Native Ops Runbook](../../../deploy/windows/ops-runbook.md)
- [运维与证据边界](../../operations-and-evidence.md)
- [Windows 部署与公网访问](../../deployment-windows.md)
