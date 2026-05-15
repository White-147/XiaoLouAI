# 运维与证据边界

本文记录 XiaoLouAI 中不能提交的生产材料、retained evidence 的用途、支付/provider 接入边界和 CI/test gate 现状。

## 不提交的材料

以下材料不能进入 Git：

- 真实生产 legacy dump/source、SQLite snapshots、PostgreSQL snapshots、restore-drill outputs。
- Alipay/WeChat Pay 商户账号、私钥、证书、provider public keys、production secrets、raw callback captures。
- closed API/vendor account credentials、API keys、provider routing approvals、production provider health evidence。
- object-storage credentials、CDN/WAF credentials、production domain secrets、operator-only audit exports。
- `.runtime` 下的 logs、backups、publish artifacts、local service state。
- `deploy/local-secrets` 下的 env、service-account、支付证书、密钥材料。

## Retained Material

`deploy/retained/legacy-surface-evidence/` 是 sanitized evidence 目录，只用于非 live legacy source removal verification。它不是 runtime directory，不应包含 secrets、uploads、operator-only production evidence、local database dumps 或真实 deployment secrets。

`deploy/retained/legacy-local-material/` 仅包含 operator-approved、non-secret legacy local material，用于部署交接，不表示恢复 legacy runtime。

真实 local secrets 应放在 ignored `deploy/local-secrets/` 或部署主机自己的 secret store。

## Final Acceptance Evidence

真实生产材料缺失不是日常工程阻塞项。它们属于 final acceptance 或 cutover evidence，应由运营方在部署主机或证据系统中维护。

最终验收证据通常包括：

- strict P0 和 4100 runtime smoke reports。
- `verify-p2-cutover-audit.ps1` 无 blockers 输出。
- legacy dump restore/projection verification report。
- payment adapter/normalizer verification 与 staging replay/audit。
- provider health evidence。
- PostgreSQL backup 和 restore-drill evidence。
- public access capacity report。

仓库可以保留 synthetic fixtures、dry-run reports、verifier code 和 sanitized examples，但不能保留真实生产输入。

## 支付 Provider 接入

Control API callbacks 接收规范化 canonical JSON，并使用配置的 HMAC secret 验签：

```text
Payments:{provider}:WebhookSecret
X-XiaoLou-Signature
```

真实 Alipay RSA2 和 WeChat Pay v3 输入由 `scripts/windows/` 下的 adapter/normalizer tooling 处理。接入真实 provider 时：

1. 将 key/certificate files 放在 `D:\code\XiaoLouAI\.runtime\app\credentials\payment\`。
2. 将 reviewed JSONL/NDJSON captures 放在 `D:\code\XiaoLouAI\.runtime\xiaolou-replay\`。
3. 在 `.runtime\app\scripts\windows\.env.windows` 填写真实 provider secrets 和 allowlists。
4. 开启 canary intake：`PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT=true`，并使用非 wildcard account/owner grants。
5. 先运行 adapter/normalizer smoke，再做 discovery、dry-run、staging execute/idempotency。

示例命令：

```powershell
.\scripts\windows\verify-payment-provider-native-adapters.ps1
.\scripts\windows\verify-payment-provider-normalizers.ps1
.\scripts\windows\stage-payment-provider-replay.ps1 -DiscoverOnly
```

## CI 与测试门禁

当前 `main` branch protection 要求 GitHub Actions：

- `Build and static gates`
- `Synthetic browser E2E advisory`

以下门禁暂不作为 required gate：

- coverage thresholds。
- CodeQL。
- npm audit failure。
- dotnet vulnerable failure。
- 独立于现有 workflow 的 standalone test checks。

未来要提升 security/coverage/branch-protection 门禁，必须单独 owner，记录 before/after、回滚动作、remote evidence、check context、runner/source 和 baseline reset 条件。

## Public Access Evidence

公网访问容量核验使用：

```powershell
.\scripts\windows\verify-public-access-capacity.ps1
```

默认模式不需要密钥，也不访问公网入口；它会核算 PostgreSQL pool、worker lease throughput、Playground active-job polling interval 和 body caps。

公网 HTTP smoke 需要 public origin 和可用 client auth：

```powershell
.\scripts\windows\verify-public-access-capacity.ps1 `
  -RunHttp `
  -BaseUrl "https://xiaolou.example.com" `
  -ClientApiToken "<public client token or canary assertion>" `
  -ObjectContentPath "/api/media/object-content/<bucket>/<objectKey>"
```

`-RunRateLimitProbe` 会故意消耗匿名 auth fixed-window budget，只能在批准窗口使用。
