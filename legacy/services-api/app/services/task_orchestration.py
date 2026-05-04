from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.models import ProviderJob, Task
from app.providers.base import UnsupportedProviderError
from app.providers.registry import infer_model_id, parse_model_id, queue_for_model
from app.schemas import TaskCreate


@dataclass(frozen=True)
class TaskPublishResult:
    published: bool
    worker_task_id: str | None = None
    error: str | None = None


class TaskPublishError(RuntimeError):
    pass


async def create_task_record(
    session: AsyncSession,
    payload: TaskCreate,
    *,
    settings: Settings | None = None,
) -> tuple[Task, ProviderJob | None]:
    resolved_settings = settings or get_settings()
    task_payload: dict[str, Any] = dict(payload.payload)
    model_id = infer_model_id(
        task_type=payload.task_type,
        payload=task_payload,
        settings=resolved_settings,
    )
    provider_job: ProviderJob | None = None
    provider_name: str | None = None
    queue_name = payload.queue_name

    if model_id:
        backend, kind, _ = parse_model_id(model_id)
        provider_name = f"{backend}_{kind}"
        if queue_name == "default":
            queue_name = queue_for_model(model_id)

    task = Task(
        project_id=payload.project_id,
        actor_id=payload.actor_id,
        task_type=payload.task_type,
        queue_name=queue_name,
        status="queued",
        payload=task_payload,
    )
    session.add(task)
    await session.flush()

    if model_id and provider_name:
        provider_job = ProviderJob(
            task_id=task.id,
            provider=provider_name,
            model_id=model_id,
            status="queued",
            timeout_at=datetime.now(tz=UTC)
            + timedelta(seconds=resolved_settings.provider_job_timeout_seconds),
            payload={
                "input": task_payload,
                "task_type": payload.task_type,
                "queue_name": queue_name,
            },
        )
        session.add(provider_job)
        await session.flush()
        task.payload = {
            **task_payload,
            "model_id": model_id,
            "provider": provider_name,
            "provider_job_id": str(provider_job.id),
        }

    return task, provider_job


def publish_task_dispatch(
    *,
    task_id: UUID,
    queue_name: str,
    settings: Settings | None = None,
) -> TaskPublishResult:
    del task_id, queue_name
    resolved_settings = settings or get_settings()
    if not resolved_settings.task_publish_enabled:
        return TaskPublishResult(published=False, error="task publishing is disabled")

    message = "legacy Celery publishing has been removed from the production path"
    if resolved_settings.task_publish_fail_fast:
        raise TaskPublishError(message)
    return TaskPublishResult(published=False, error=message)


def provider_error_to_detail(exc: UnsupportedProviderError) -> dict[str, str]:
    return {"code": "UNSUPPORTED_PROVIDER", "message": str(exc)}
