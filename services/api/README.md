# XiaoLouAI Legacy Python API Reference

`services/api` is no longer the production control plane. The long-term route is:

```text
.NET 8 / ASP.NET Core control plane
+ PostgreSQL as the only source of truth
+ Windows Service workers
+ Python only for local model adapters / inference runners
```

Keep this directory only as a migration reference for older FastAPI, SQLAlchemy,
payment, upload, and video-replace code. Do not use this service, Celery,
RabbitMQ, Redis, Docker, or Linux containers as the production async foundation.

## Local Reference Only

If a developer needs to inspect or run legacy routes for comparison:

```powershell
cd D:\code\XiaoLouAI\services\api
Copy-Item .env.example .env
python -m venv .venv
.\.venv\Scripts\python -m pip install -e .[dev]
.\.venv\Scripts\alembic upgrade head
.\.venv\Scripts\uvicorn app.main:app --host 127.0.0.1 --port 8000
```

`TASK_PUBLISH_ENABLED` defaults to `false`. Celery worker modules and Docker
startup files have been removed from the repository production path.

Do not add RabbitMQ, Redis, Celery, Docker Compose, or container startup steps
back into production documentation. New work belongs under
`control-plane-dotnet/` and the Windows-native service scripts.
