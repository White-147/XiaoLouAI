# Payment Provider Replay Checklist

Use this checklist before routing a real payment provider callback to the
Windows-native `.NET` control plane.

## Scope

- Replay real captured callbacks against a staging PostgreSQL database first.
- Preserve the exact raw body bytes and signature headers from the provider.
- Do not replay into production until staging is idempotent and wallet audit is clean.
- Do not manually edit `wallet_balances`; rebuild from `wallet_ledger` only after approval.

## Capture Format

Create a JSONL file inside the repo runtime state directory, for example
`D:\code\XiaoLouAI\.runtime\xiaolou-replay\payment-callbacks-20260502.jsonl`.
Do not count the bundled dry-run sample in `.runtime\xiaolou-temp` as provider
evidence; staging acceptance requires a real provider capture.

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

## Gray Release

1. Keep `/api/internal/*`, `/api/schema/*`, and `/api/providers/health` blocked
at IIS/Caddy.
2. Route only the provider callback path to Control API:
   `/api/payments/callbacks/{provider}`.
3. Start with one provider and one merchant app/account.
4. Watch:
   - payment callback HTTP 4xx/5xx count
   - rejected/conflict callbacks
   - `wallet_ledger` insert count
   - `wallet_balances` audit mismatch count
   - outbox pending age
5. Run wallet audit after each gray window.

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
