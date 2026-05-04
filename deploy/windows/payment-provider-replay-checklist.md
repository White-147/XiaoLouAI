# Payment Provider Replay Checklist

Use this checklist before routing a real payment provider callback to the
Windows-native `.NET` control plane.

## Scope

- Replay real captured callbacks against a staging PostgreSQL database first.
- Preserve the exact raw body bytes and signature headers from the provider.
- Do not replay into production until staging is idempotent and wallet audit is clean.
- Do not manually edit `wallet_balances`; rebuild from `wallet_ledger` only after approval.

## Required Real Provider Inputs

The repository is intentionally not enough to prove real Alipay or WeChat Pay
replay. No real merchant account, private key, certificate, provider public key,
or staging/production callback capture should be committed here. An operator
must provide the real provider material out of band before this checklist can
advance beyond discovery.

Required common inputs:

- Public callback domain and route approved for gray release.
- Staging Control API, staging PostgreSQL, and wallet audit access.
- Explicit provider allowlist in runtime env. Production values must not include
  smoke/sample/test providers such as `testpay`.
- Account/order mapping for the merchant orders being replayed.
- A reviewed JSONL/NDJSON capture under
  `D:\code\XiaoLouAI\.runtime\xiaolou-replay`.
- Exact raw callback body bytes and all provider signature headers.

Alipay inputs:

- `ALIPAY_ENV` (`sandbox` or `production`)
- `ALIPAY_APP_ID`
- `ALIPAY_SELLER_ID`
- App private key file under
  `D:\code\XiaoLouAI\.runtime\app\credentials\payment\`
- Alipay public key or certificate file under the same runtime credential root
- Notify URL and return URL registered with Alipay

WeChat Pay inputs:

- `WECHAT_PAY_APP_ID`
- `WECHAT_PAY_MCH_ID`
- Merchant private key file under
  `D:\code\XiaoLouAI\.runtime\app\credentials\payment\`
- `WECHAT_PAY_CERT_SERIAL`
- `WECHAT_PAY_API_V3_KEY`
- WeChat Pay platform public key/certificate file under the runtime credential root
- Notify URL registered with WeChat Pay

Current Windows-native boundary: the `.NET` Control API callback route
normalizes the provider route segment, rejects invalid provider ids, rejects
route/body provider mismatch, and can require an explicit provider allowlist
before signature verification and ledger writes. It accepts normalized
canonical JSON verified by HMAC
(`Payments:{provider}:WebhookSecret` / `X-XiaoLou-Signature`). Legacy
`core-api` contains Alipay RSA2 and WeChat Pay v3 reference adapters, but raw
native Alipay form callbacks or WeChat encrypted notifications still require a
provider-specific adapter/normalizer before direct `.NET` replay. Already
normalized canonical captures can use the staging HMAC secret and the replay
scripts below.

G2b-1 leaves those adapter references at the current `core-api/` root. If a
future G2b-2 physical archive is explicitly approved, the same references move
under `legacy/core-api`; they remain migration references only and must not be
used as the production payment callback runtime.

The Windows-native script boundary now includes
`scripts/windows/normalize-payment-provider-capture.ps1` for converting
provider-shaped synthetic or reviewed captures into canonical replay JSONL, and
`scripts/windows/verify-payment-provider-normalizers.ps1` for synthetic
contract verification. These scripts are not real replay evidence; they keep
adapter work moving while real merchant captures remain unavailable.

Native provider verification is covered by
`scripts/windows/adapt-native-payment-provider-capture.ps1` and
`scripts/windows/payment-provider-native-adapter.js`. The JavaScript helper is
only a local Windows tooling bridge for RSA/AES-GCM primitives; it is not a
production control plane and does not change the `.NET + PostgreSQL + Windows
Service` runtime route.

## Control API Provider Boundary

Before staging replay or gray release, verify the Control API provider boundary:

```powershell
D:\code\XiaoLouAI\.runtime\app\scripts\windows\verify-payment-provider-boundary.ps1
```

The smoke starts a temporary Control API and verifies:

- an allowed provider callback can be accepted and recorded;
- a provider outside the allowlist returns `403`;
- a body `provider` that does not match the route segment returns `400`;
- an invalid provider id returns `400`.

Required runtime env:

- `PAYMENT_CALLBACK_REQUIRE_ALLOWED_PROVIDER=true`
- `PAYMENT_CALLBACK_ALLOWED_PROVIDERS=<real-provider-list>`
- `Payments__RequireAllowedProvider=true`
- `Payments__AllowedProviders=<real-provider-list>`
- `PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT=true`
- `PAYMENT_CALLBACK_ALLOWED_ACCOUNT_IDS=<canary-account-uuid>` or
  `PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS=user:<canary-user-id>`
- `Payments__RequireAccountGrant=true`
- `Payments__AllowedAccountIds` / `Payments__AllowedAccountOwnerIds` with the
  same explicit canary grant values

`rehearse-production-cutover.ps1 -StrictProduction` treats missing, wildcard,
or smoke/test/sample provider allowlists as blockers. It also treats a missing
payment callback account gate or wildcard account grant as a blocker. Keeping
`testpay` in the allowlist is acceptable for local smoke only; replace it
before production evidence or public gray release.

## When Real Captures Are Unavailable

Lack of operator-owned merchant credentials or real callback JSONL is not a
reason to pause engineering work. Treat real captures as final acceptance
evidence only. Until they arrive, continue work against official provider
contracts and synthetic fixtures:

- Keep the Control API callback boundary canonical and idempotent.
- Build provider-specific adapters/normalizers outside `core-api/`, preferably
  in the Windows-native control-plane tooling or a dedicated adapter module.
- Use generated local keys, fake platform certificates, and synthetic encrypted
  payloads to test signature/decrypt/parser behavior without storing real
  credentials.
- Keep fixtures visibly named as synthetic and outside
  `.runtime\xiaolou-replay` unless the replay command is explicitly run in local
  smoke mode.
- Do not mark real replay complete until an operator-owned capture and sidecar
  manifest pass the evidence gate.

Official contract notes used for adapter planning:

- Alipay asynchronous notifications require signature verification over all
  returned parameters except `sign` and `sign_type`; Alipay also documents
  `notify_id` as notification idempotence material.
- WeChat Pay API v3 payment notifications require callback signature
  verification using `Wechatpay-Timestamp`, `Wechatpay-Nonce`, the JSON body,
  `Wechatpay-Serial`, and `Wechatpay-Signature`; encrypted `resource`
  ciphertext is decrypted with the API v3 key, `resource.nonce`, and
  `resource.associated_data`.

References:

- Alipay Global, asynchronous notification:
  https://global.alipay.com/developer/helpcenter/detail?_route=sg&categoryId=67617&knowId=201602452303&sceneCode=AC_DEV
- WeChat Pay merchant docs, payment success callback:
  https://pay.wechatpay.cn/doc/v3/merchant/4012791861
- WeChat Pay merchant docs, callback signature headers:
  https://pay.wechatpay.cn/doc/v3/merchant/4013053283
- WeChat Pay merchant docs, decrypt callback resource:
  https://pay.wechatpay.cn/doc/v3/merchant/4012071382

## Native Adapter Contract

Run this when real provider material is not available:

```powershell
D:\code\XiaoLouAI\scripts\windows\verify-payment-provider-native-adapters.ps1
```

The verifier writes only under `D:\code\XiaoLouAI\.runtime` and covers:

- Alipay RSA2 callback signature verification before canonical normalization.
- WeChat Pay v3 callback RSA signature verification over
  `Wechatpay-Timestamp`, `Wechatpay-Nonce`, and the exact raw JSON body.
- WeChat Pay v3 `AEAD_AES_256_GCM` resource decryption with the API v3 key,
  resource nonce, and associated data before canonical normalization.
- Invalid Alipay and WeChat Pay signatures are blocked before normalization.
- The resulting canonical JSONL can be parsed by `replay-payment-callbacks.ps1`
  with a synthetic HMAC secret.

Latest local smoke shape:

```text
status: ok
canonical_count: 2
skipped_non_paid_count: 1
invalid_signatures_blocked: true
```

Manual native adaptation can be run as:

```powershell
D:\code\XiaoLouAI\scripts\windows\adapt-native-payment-provider-capture.ps1 `
  -InputFile D:\code\XiaoLouAI\.runtime\xiaolou-temp\native-provider-callbacks.jsonl `
  -VerifiedOutputFile D:\code\XiaoLouAI\.runtime\xiaolou-temp\verified-provider-callbacks.jsonl `
  -CanonicalOutputFile D:\code\XiaoLouAI\.runtime\xiaolou-temp\canonical-provider-callbacks.jsonl `
  -AccountOwnerId <staging-or-synthetic-owner-id> `
  -AlipayPublicKeyFile D:\code\XiaoLouAI\.runtime\app\credentials\payment\alipay-public.pem `
  -WeChatPayPlatformPublicKeyFile D:\code\XiaoLouAI\.runtime\app\credentials\payment\wechatpay-platform-public.pem `
  -WeChatPayApiV3Key <runtime-api-v3-key>
```

Accepted native adapter input formats:

- `alipay-rsa2-form`: raw form body, JSON body, or `params` object with
  provider `sign` and `sign_type=RSA2`.
- `wechat-v3-notification`: raw WeChat Pay v3 encrypted notification JSON plus
  `headers` containing `Wechatpay-Timestamp`, `Wechatpay-Nonce`,
  `Wechatpay-Serial`, and `Wechatpay-Signature`.

Real merchant keys and platform keys must be provided from runtime credential
storage, never from source control. Synthetic native adapter success remains
engineering evidence only, not real provider replay evidence.

## Synthetic Normalizer Contract

Run this when real provider material is not available:

```powershell
D:\code\XiaoLouAI\scripts\windows\verify-payment-provider-normalizers.ps1
```

The verifier writes only under `D:\code\XiaoLouAI\.runtime` and covers:

- Alipay async form callback mapping after signature verification has already
  accepted the provider payload.
- WeChat Pay v3 decrypted `resource` plaintext mapping after callback signature
  verification and AES-256-GCM decrypt have already accepted the provider
  payload.
- Non-paid provider statuses are skipped, not normalized into payable Control
  API callbacks.
- The normalized canonical JSONL can be parsed by
  `replay-payment-callbacks.ps1` with a synthetic HMAC secret.

Latest local smoke shape:

```text
status: ok
normalized_count: 2
skipped_non_paid_count: 1
```

Manual normalization can be run as:

```powershell
D:\code\XiaoLouAI\scripts\windows\normalize-payment-provider-capture.ps1 `
  -InputFile D:\code\XiaoLouAI\.runtime\xiaolou-temp\synthetic-provider-callbacks.jsonl `
  -OutputFile D:\code\XiaoLouAI\.runtime\xiaolou-temp\normalized-canonical-callbacks.jsonl `
  -AccountOwnerId <staging-or-synthetic-owner-id>
```

Accepted normalizer input formats:

- `alipay-form`: URL-encoded raw body, JSON object body, or `params` object
  containing Alipay async notification fields such as `notify_id`,
  `out_trade_no`, `trade_no`, `total_amount`, `trade_status`, and
  `gmt_payment`.
- `wechat-v3-plaintext`: notification body with already decrypted
  `resource_plaintext` / `resourcePlaintext`, or a direct decrypted transaction
  object containing `out_trade_no`, `transaction_id`, `trade_state`,
  `success_time`, and `amount.total`.
- `canonical`: already normalized Control API callback body.

Native encrypted WeChat Pay notifications and raw Alipay signatures still need
the provider verifier/decrypt adapter before this canonical replay boundary.

## Capture Format

Create a JSONL file inside the repo runtime state directory, for example
`D:\code\XiaoLouAI\.runtime\xiaolou-replay\payment-callbacks-20260502.jsonl`.
Do not count the bundled dry-run sample in `.runtime\xiaolou-temp` as provider
evidence; staging acceptance requires a real provider capture.

For execution through `stage-payment-provider-replay.ps1`, keep the approved
capture under `D:\code\XiaoLouAI\.runtime\xiaolou-replay` and add a sidecar
manifest next to it. The manifest must not contain secrets. It is operator
evidence that the file is a real provider capture and the matching merchant
configuration is available in runtime credential storage:

```json
{
  "operator_verified_real_capture": true,
  "merchant_credentials_configured": true,
  "contains_raw_provider_callbacks": true,
  "provider": "alipay",
  "capture_environment": "staging",
  "captured_at_utc": "2026-05-02T00:00:00Z",
  "operator": "payment-ops",
  "notes": "No secrets in this manifest."
}
```

Accepted sidecar names include:

- `payment-callbacks-20260502.jsonl.manifest.json`
- `payment-callbacks-20260502.manifest.json`
- `payment-callbacks-20260502.capture-manifest.json`

Each line should contain one callback:

```json
{"description":"alipay paid order 1001","provider":"alipay","rawBody":"{\"eventId\":\"evt_1001\"}","headers":{"X-XiaoLou-Signature":"captured-signature"},"expectedStatus":200}
```

Rules:

- `provider` must match the URL segment used by Control API:
  `/api/payments/callbacks/{provider}`.
- Prefer `rawBody` over `body`; `rawBody` preserves provider signing semantics.
- Keep the captured signature header. The replay script only computes HMAC when
  `PAYMENT_WEBHOOK_SECRET` is set, which is for local/test providers.
- Negative samples may set `expectedStatus` to `400`.

## Staging Replay

1. Point Control API at a staging database.
2. Apply schema and run P0 first:

```powershell
$env:CONTROL_API_BASE_URL = "http://127.0.0.1:4100"
$env:INTERNAL_API_TOKEN = "<staging internal token>"
D:\code\XiaoLouAI\.runtime\app\scripts\windows\verify-control-plane-p0.ps1
```

3. Run pre-replay audit:

```powershell
D:\code\XiaoLouAI\.runtime\app\scripts\windows\audit-wallet-ledger.ps1 -FailOnMismatch
```

4. Dry-run parse the capture file:

```powershell
D:\code\XiaoLouAI\.runtime\app\scripts\windows\replay-payment-callbacks.ps1 `
  -InputFile D:\code\XiaoLouAI\.runtime\xiaolou-replay\payment-callbacks-20260502.jsonl
```

5. Execute replay:

```powershell
D:\code\XiaoLouAI\.runtime\app\scripts\windows\replay-payment-callbacks.ps1 `
  -InputFile D:\code\XiaoLouAI\.runtime\xiaolou-replay\payment-callbacks-20260502.jsonl `
  -Execute `
  -StopOnFailure
```

6. Execute the exact same replay a second time. Successful callbacks should
return idempotent duplicate responses and must not change wallet balances.

7. Run post-replay audit and dry-run rebuild:

```powershell
D:\code\XiaoLouAI\.runtime\app\scripts\windows\audit-wallet-ledger.ps1 -FailOnMismatch
D:\code\XiaoLouAI\.runtime\app\scripts\windows\rebuild-wallet-balances-from-ledger.ps1
```

The full staging sequence can also be run through the guarded wrapper:

```powershell
D:\code\XiaoLouAI\.runtime\app\scripts\windows\stage-payment-provider-replay.ps1 `
  -InputFile D:\code\XiaoLouAI\.runtime\xiaolou-replay\payment-callbacks-20260502.jsonl `
  -Execute `
  -StopOnFailure
```

Without `-Execute`, the wrapper only runs the audit and dry-run parse.
The wrapper writes JSON reports under `D:\code\XiaoLouAI\.runtime\xiaolou-logs`.
With `-Execute`, the wrapper refuses sample/test/fixture-looking captures,
captures outside `.runtime\xiaolou-replay`, and captures without a verified
sidecar manifest. Local smoke exceptions require explicit switches such as
`-AllowSampleInput`, `-AllowInputOutsideReplayRoot`, or
`-AllowUnverifiedCapture`; do not use those as production evidence.
If no capture has been provided yet, run the wrapper without `-InputFile` to
write a discovery report. Discovery only treats `.jsonl` and `.ndjson` files as
candidate provider captures and marks bundled samples as non-evidence:

```powershell
D:\code\XiaoLouAI\.runtime\app\scripts\windows\stage-payment-provider-replay.ps1
```

## Gray Release

1. Keep `/api/internal/*`, `/api/schema/*`, and `/api/providers/health` blocked
at IIS/Caddy.
2. Route only the provider callback path to Control API:
   `/api/payments/callbacks/{provider}`.
3. Start with one provider and one merchant app/account.
4. Enable the payment callback account gate for that single canary account:
   `PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT=true` plus either
   `PAYMENT_CALLBACK_ALLOWED_ACCOUNT_IDS` or
   `PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS`. Do not use wildcard grants.
5. Watch:
   - payment callback HTTP 4xx/5xx count
   - rejected/conflict callbacks
   - `wallet_ledger` insert count
   - `wallet_balances` audit mismatch count
   - outbox pending age
6. Run wallet audit after each gray window.

## Rollback Conditions

Rollback immediately if any of these happen:

- wallet audit mismatch appears
- duplicate replay changes balance
- valid provider signatures are rejected unexpectedly
- callback conflicts grow beyond the approved manual review queue
- outbox pending age exceeds the release threshold

Rollback action:

```powershell
D:\code\XiaoLouAI\.runtime\app\scripts\windows\stop-services.ps1
```

Then restore previous reverse proxy routing for payment callbacks, keep
PostgreSQL data intact, and run:

```powershell
D:\code\XiaoLouAI\.runtime\app\scripts\windows\audit-wallet-ledger.ps1 -FailOnMismatch
D:\code\XiaoLouAI\.runtime\app\scripts\windows\rebuild-wallet-balances-from-ledger.ps1
```

Only run `rebuild-wallet-balances-from-ledger.ps1 -Execute` after explicit
operator approval.
