# XiaoLouAI 旧 Python API 参考

语言：[English](README.md) | [简体中文](README.zh-CN.md)

`services/api` 不再是生产控制面。长期路线是：

```text
.NET 8 / ASP.NET Core 控制面
+ PostgreSQL 唯一事实源
+ Windows Service workers
+ Python 仅用于本地模型适配器 / 推理执行器
```

该目录只保留为旧 FastAPI、SQLAlchemy、支付、上传和 video-replace 代码的迁移
参考。不要把该服务、Celery、RabbitMQ、Redis、Docker 或 Linux 容器作为生产
异步基础。

## 仅限本地参考

如果开发者需要对照旧路由，可以本地检查或运行：

```powershell
cd D:\code\XiaoLouAI\services\api
Copy-Item .env.example .env
python -m venv .venv
.\.venv\Scripts\python -m pip install -e .[dev]
.\.venv\Scripts\alembic upgrade head
.\.venv\Scripts\uvicorn app.main:app --host 127.0.0.1 --port 8000
```

`TASK_PUBLISH_ENABLED` 默认是 `false`。Celery worker 模块和 Docker 启动文件
已经从仓库生产路径移除。

不要把 RabbitMQ、Redis、Celery、Docker Compose 或容器启动步骤重新加入生产
文档。新工作应放在 `control-plane-dotnet/` 和 Windows 原生服务脚本中。

## README 语言维护规则

请保持本文件与 `README.md` 同步。后续修改 README 时必须同时更新中英文版本。
