# 支付 Provider 边界与 replay 验证

## 范围

本记录整理真实支付 provider callback 接入前的边界、adapter / normalizer synthetic verification、staging replay 和 gray release 验证要求。

## 运行摘要

- `.NET Control API` callback route 接收 canonical JSON，并通过 provider route segment、allowlist、account grant、signature 和 ledger idempotency 保护。
- 真实 Alipay RSA2 和 WeChat Pay v3 输入必须先经过 provider-specific verifier/decrypt adapter，再进入 canonical replay 边界。
- 无真实商户凭证和回调 capture 时，工程工作继续使用 synthetic fixtures；这不是 production evidence。
- Real provider replay 必须在 staging PostgreSQL 先跑，确认 idempotency 和 wallet audit 后再考虑 public gray release。

## 验证入口

```powershell
D:\code\XiaoLouAI\.runtime\app\scripts\windows\verify-payment-provider-boundary.ps1
D:\code\XiaoLouAI\scripts\windows\verify-payment-provider-native-adapters.ps1
D:\code\XiaoLouAI\scripts\windows\verify-payment-provider-normalizers.ps1
```

Staging replay wrapper：

```powershell
D:\code\XiaoLouAI\.runtime\app\scripts\windows\stage-payment-provider-replay.ps1 `
  -InputFile D:\code\XiaoLouAI\.runtime\xiaolou-replay\payment-callbacks-20260502.jsonl
```

## 最新本地 smoke 形态

- Native adapter：`status: ok`、`canonical_count: 2`、`skipped_non_paid_count: 1`、`invalid_signatures_blocked: true`
- Normalizer：`status: ok`、`normalized_count: 2`、`skipped_non_paid_count: 1`

## 证据边界

- 真实商户账号、私钥、证书、provider public keys、raw callback captures 不提交。
- `.runtime\xiaolou-replay` 与 `.runtime\xiaolou-logs` 属于部署/运营证据目录，不提交。
- Bundled dry-run sample 不能算 provider evidence。

## 来源

- [Payment Provider Replay Checklist](../../../deploy/windows/payment-provider-replay-checklist.md)
- [运维与证据边界](../../operations-and-evidence.md)
- [Windows Native Ops Runbook](../../../deploy/windows/ops-runbook.md)
