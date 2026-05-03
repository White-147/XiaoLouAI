# XiaoLouAI Local Model Worker

Language: [English](README.md) | [简体中文](README.zh-CN.md)

This Windows-native worker is the only place where Python is allowed in the
production architecture. It is for local model adapters and inference runners,
not for the control plane or async foundation.

The worker talks to the `.NET` control API internal job endpoints. PostgreSQL
remains the source of truth through the control API.

```powershell
python -m venv .venv
.\.venv\Scripts\python -m app.worker --control-api http://127.0.0.1:4100 --lane account-media --provider-route local-model
```

Real model integrations should be added behind explicit adapters under `app/`
and must write final job results back through the control API.

For one-shot verification:

```powershell
.\.venv\Scripts\python -m app.worker --control-api http://127.0.0.1:4100 --lane account-media --provider-route local-model --run-once
```

## README Language Policy

Keep this README and `README.zh-CN.md` in sync. Any future README change should
update both language versions.
