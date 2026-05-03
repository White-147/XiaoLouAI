# XiaoLouAI 本地模型 Worker

语言：[English](README.md) | [简体中文](README.zh-CN.md)

这个 Windows 原生 worker 是生产架构中唯一允许使用 Python 的位置。它只用于
本地模型适配器和推理执行器，不用于控制面或异步基础设施。

该 worker 通过 `.NET` Control API 的 internal jobs endpoint 工作。PostgreSQL
仍然通过 Control API 作为唯一事实源。

```powershell
python -m venv .venv
.\.venv\Scripts\python -m app.worker --control-api http://127.0.0.1:4100 --lane account-media --provider-route local-model
```

真实模型集成应放在 `app/` 下的显式 adapter 后面，并必须通过 Control API 把最终
任务结果写回。

单次验证：

```powershell
.\.venv\Scripts\python -m app.worker --control-api http://127.0.0.1:4100 --lane account-media --provider-route local-model --run-once
```

## README 语言维护规则

请保持本文件与 `README.md` 同步。后续修改 README 时必须同时更新中英文版本。
