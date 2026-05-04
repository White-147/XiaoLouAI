from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import Task
from app.schemas import TaskCreate, TaskRead
from app.services.task_orchestration import (
    TaskPublishError,
    create_task_record,
    provider_error_to_detail,
    publish_task_dispatch,
)
from app.providers.base import UnsupportedProviderError

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _uuid_or_none(value: str) -> UUID | None:
    try:
        return UUID(value)
    except ValueError:
        return None


@router.get("", response_model=list[TaskRead])
async def list_tasks(session: AsyncSession = Depends(get_session)) -> list[Task]:
    result = await session.scalars(select(Task).order_by(Task.created_at.desc()).limit(100))
    return list(result)


@router.post("", response_model=TaskRead, status_code=status.HTTP_202_ACCEPTED)
async def create_task(payload: TaskCreate, session: AsyncSession = Depends(get_session)) -> Task:
    settings = get_settings()
    try:
        async with session.begin():
            task, _ = await create_task_record(session, payload, settings=settings)
    except UnsupportedProviderError as exc:
        raise HTTPException(status_code=400, detail=provider_error_to_detail(exc)) from exc

    try:
        publish_result = publish_task_dispatch(
            task_id=task.id,
            queue_name=task.queue_name,
            settings=settings,
        )
    except TaskPublishError as exc:
        task = await _mark_publish_result(
            session,
            task.id,
            published=False,
            error=str(exc),
            mark_failed=True,
        )
        raise HTTPException(status_code=503, detail=task.error) from exc

    return await _mark_publish_result(
        session,
        task.id,
        published=publish_result.published,
        worker_task_id=publish_result.worker_task_id,
        error=publish_result.error,
        mark_failed=bool(publish_result.error and settings.task_publish_enabled),
    )


@router.get("/{task_id}", response_model=TaskRead)
async def get_task(task_id: str, session: AsyncSession = Depends(get_session)) -> Task:
    parsed_id = _uuid_or_none(task_id)
    conditions = [Task.legacy_id == task_id]
    if parsed_id:
        conditions.append(Task.id == parsed_id)
    task = await session.scalar(select(Task).where(or_(*conditions)).limit(1))
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    return task


@router.post("/{task_id}/cancel", response_model=TaskRead)
async def cancel_task(task_id: str, session: AsyncSession = Depends(get_session)) -> Task:
    parsed_id = _uuid_or_none(task_id)
    conditions = [Task.legacy_id == task_id]
    if parsed_id:
        conditions.append(Task.id == parsed_id)
    task = await session.scalar(select(Task).where(or_(*conditions)).limit(1))
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    if task.status not in {"succeeded", "failed", "cancelled"}:
        task.status = "cancelled"
        task.error = "cancelled by user"
        await session.commit()
        await session.refresh(task)
    return task


async def _mark_publish_result(
    session: AsyncSession,
    task_id: UUID,
    *,
    published: bool,
    worker_task_id: str | None = None,
    error: str | None = None,
    mark_failed: bool = False,
) -> Task:
    task = await session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")

    task.payload = {
        **(task.payload or {}),
        "enqueue": {
            "published": published,
            "worker_task_id": worker_task_id,
            "error": error,
        },
    }
    if mark_failed:
        task.status = "enqueue_failed"
        task.error = error
    await session.commit()
    await session.refresh(task)
    return task
