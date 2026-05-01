from __future__ import annotations

import asyncio
import os
import signal
import subprocess
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models import ProviderJob, Task, WalletRechargeOrder
from app.providers.base import ProviderError, ProviderJobRequest, ProviderJobStatus
from app.providers.registry import infer_model_id, parse_model_id, queue_for_model, resolve_provider
from app.services.video_replace import (
    mark_video_replace_worker_failed,
    mark_video_replace_worker_started,
    sync_video_replace_task_status,
)
from app.workers.celery_app import celery_app

TERMINAL_STATUSES = {"succeeded", "failed", "cancelled"}


def _run_async(coro: Any) -> Any:
    return asyncio.run(coro)


@celery_app.task(name="app.workers.tasks.dispatch_task", bind=True)
def dispatch_task(self: Any, task_id: str) -> dict[str, Any]:
    del self
    result = _run_async(_dispatch_task(task_id))
    provider_job_id = result.get("provider_job_id")
    queue_name = result.get("queue_name")
    if provider_job_id and queue_name:
        submit_provider_job.apply_async(args=[provider_job_id], queue=queue_name)
    return result


@celery_app.task(name="app.workers.tasks.submit_provider_job", bind=True)
def submit_provider_job(self: Any, provider_job_id: str) -> dict[str, Any]:
    del self
    result = _run_async(_submit_provider_job(provider_job_id))
    if result.get("poll"):
        settings = get_settings()
        poll_provider_job.apply_async(
            args=[provider_job_id],
            countdown=settings.provider_poll_interval_seconds,
            queue="provider_polling",
        )
    return result


@celery_app.task(name="app.workers.tasks.poll_provider_job", bind=True)
def poll_provider_job(self: Any, provider_job_id: str) -> dict[str, Any]:
    del self
    result = _run_async(_poll_provider_job(provider_job_id))
    if result.get("poll"):
        settings = get_settings()
        poll_provider_job.apply_async(
            args=[provider_job_id],
            countdown=settings.provider_poll_interval_seconds,
            queue="provider_polling",
        )
    return result


@celery_app.task(name="app.workers.tasks.reconcile_recharge_order", bind=True)
def reconcile_recharge_order(self: Any, order_id: str) -> dict[str, Any]:
    del self
    return _run_async(_read_recharge_order(order_id))


@celery_app.task(
    name="app.workers.tasks.run_video_replace_detection",
    bind=True,
    acks_late=True,
    autoretry_for=(Exception,),
    reject_on_worker_lost=True,
    retry_backoff=True,
    retry_kwargs={"max_retries": 1},
)
def run_video_replace_detection(self: Any, job_id: str, yolo_conf: float = 0.4) -> dict[str, Any]:
    del self
    settings = get_settings()
    return _run_async(
        _run_video_replace_cli(
            job_id=job_id,
            script_name="vr_detect_cli.py",
            args=[job_id, "--conf", str(yolo_conf)],
            timeout_seconds=settings.video_replace_detect_timeout_seconds,
        )
    )


@celery_app.task(
    name="app.workers.tasks.run_video_replace_pipeline",
    bind=True,
    acks_late=True,
    autoretry_for=(Exception,),
    reject_on_worker_lost=True,
    retry_backoff=True,
    retry_kwargs={"max_retries": 1},
)
def run_video_replace_pipeline(self: Any, job_id: str) -> dict[str, Any]:
    del self
    settings = get_settings()
    return _run_async(
        _run_video_replace_cli(
            job_id=job_id,
            script_name="vr_pipeline_cli.py",
            args=[job_id],
            timeout_seconds=settings.video_replace_pipeline_timeout_seconds,
        )
    )


async def _dispatch_task(task_id: str) -> dict[str, Any]:
    settings = get_settings()
    parsed_task_id = uuid.UUID(task_id)

    async with SessionLocal() as session:
        async with session.begin():
            task = await session.scalar(
                select(Task).where(Task.id == parsed_task_id).with_for_update()
            )
            if task is None:
                return {"status": "missing", "task_id": task_id}
            if task.status in TERMINAL_STATUSES or task.status == "cancelled":
                return {"status": task.status, "task_id": str(task.id)}

            provider_job = await session.scalar(
                select(ProviderJob)
                .where(ProviderJob.task_id == task.id)
                .order_by(ProviderJob.created_at.desc())
                .limit(1)
            )
            if provider_job is None:
                model_id = infer_model_id(
                    task_type=task.task_type,
                    payload=task.payload,
                    settings=settings,
                )
                if not model_id:
                    task.status = "failed"
                    task.error = "no provider model configured for task"
                    return {"status": task.status, "task_id": str(task.id)}

                backend, kind, _ = parse_model_id(model_id)
                queue_name = queue_for_model(model_id)
                provider_job = ProviderJob(
                    task_id=task.id,
                    provider=f"{backend}_{kind}",
                    model_id=model_id,
                    status="queued",
                    timeout_at=datetime.now(tz=UTC)
                    + timedelta(seconds=settings.provider_job_timeout_seconds),
                    payload={
                        "input": task.payload or {},
                        "task_type": task.task_type,
                        "queue_name": queue_name,
                    },
                )
                session.add(provider_job)
                await session.flush()
                task.queue_name = queue_name
                task.payload = {
                    **(task.payload or {}),
                    "model_id": model_id,
                    "provider": provider_job.provider,
                    "provider_job_id": str(provider_job.id),
                }
            else:
                queue_name = queue_for_model(provider_job.model_id)

            if provider_job.status in TERMINAL_STATUSES:
                return {
                    "status": provider_job.status,
                    "task_id": str(task.id),
                    "provider_job_id": str(provider_job.id),
                }

            task.status = "running"
            task.error = None
            provider_job.status = "queued"
            return {
                "status": "queued",
                "task_id": str(task.id),
                "provider_job_id": str(provider_job.id),
                "queue_name": queue_name,
            }


async def _submit_provider_job(provider_job_id: str) -> dict[str, Any]:
    settings = get_settings()
    parsed_job_id = uuid.UUID(provider_job_id)
    async with SessionLocal() as session:
        async with session.begin():
            provider_job = await session.scalar(
                select(ProviderJob).where(ProviderJob.id == parsed_job_id).with_for_update()
            )
            if provider_job is None:
                return {"status": "missing", "provider_job_id": provider_job_id}
            if provider_job.status in TERMINAL_STATUSES:
                return {"status": provider_job.status, "provider_job_id": str(provider_job.id)}
            if _is_timed_out(provider_job.timeout_at):
                provider_job.status = "failed"
                provider_job.payload = _merge_payload(
                    provider_job.payload,
                    {"error": "provider job timed out before submit"},
                )
                await _mark_task_terminal(
                    session,
                    provider_job.task_id,
                    status="failed",
                    error="provider job timed out before submit",
                )
                return {"status": "failed", "provider_job_id": str(provider_job.id)}

            task = await session.scalar(
                select(Task).where(Task.id == provider_job.task_id).with_for_update()
            )
            provider_job.status = "running"
            provider_job.attempts = (provider_job.attempts or 0) + 1
            if task:
                task.status = "running"
                task.error = None
            request = ProviderJobRequest(
                task_id=str(provider_job.task_id),
                model_id=provider_job.model_id,
                input=_provider_input(provider_job, task),
                callback_url=f"{settings.public_base_url}/api/tasks/{provider_job.task_id}",
            )
            model_id = provider_job.model_id

    try:
        provider = resolve_provider(model_id, settings=settings)
        status = await provider.submit(request)
    except ProviderError as exc:
        return await _mark_provider_failed(parsed_job_id, str(exc))

    return await _apply_provider_status(parsed_job_id, status)


async def _poll_provider_job(provider_job_id: str) -> dict[str, Any]:
    settings = get_settings()
    parsed_job_id = uuid.UUID(provider_job_id)
    async with SessionLocal() as session:
        async with session.begin():
            provider_job = await session.scalar(
                select(ProviderJob).where(ProviderJob.id == parsed_job_id).with_for_update()
            )
            if provider_job is None:
                return {"status": "missing", "provider_job_id": provider_job_id}
            if provider_job.status in TERMINAL_STATUSES:
                return {"status": provider_job.status, "provider_job_id": str(provider_job.id)}
            if _is_timed_out(provider_job.timeout_at):
                provider_job.status = "failed"
                provider_job.payload = _merge_payload(
                    provider_job.payload,
                    {"error": "provider job timed out"},
                )
                await _mark_task_terminal(
                    session,
                    provider_job.task_id,
                    status="failed",
                    error="provider job timed out",
                )
                return {"status": "failed", "provider_job_id": str(provider_job.id)}
            if not provider_job.external_job_id:
                provider_job.status = "failed"
                provider_job.payload = _merge_payload(
                    provider_job.payload,
                    {"error": "provider job has no external id"},
                )
                await _mark_task_terminal(
                    session,
                    provider_job.task_id,
                    status="failed",
                    error="provider job has no external id",
                )
                return {"status": "failed", "provider_job_id": str(provider_job.id)}

            model_id = provider_job.model_id
            external_job_id = provider_job.external_job_id

    try:
        provider = resolve_provider(model_id, settings=settings)
        status = await provider.poll(external_job_id)
    except ProviderError as exc:
        return await _mark_provider_failed(parsed_job_id, str(exc))

    return await _apply_provider_status(parsed_job_id, status)


async def _apply_provider_status(
    provider_job_id: uuid.UUID,
    status: ProviderJobStatus,
) -> dict[str, Any]:
    async with SessionLocal() as session:
        async with session.begin():
            provider_job = await session.scalar(
                select(ProviderJob).where(ProviderJob.id == provider_job_id).with_for_update()
            )
            if provider_job is None:
                return {"status": "missing", "provider_job_id": str(provider_job_id)}

            provider_job.external_job_id = status.external_job_id or provider_job.external_job_id
            provider_job.status = status.status
            provider_job.payload = _merge_payload(
                provider_job.payload,
                {
                    "last_status": status.raw,
                    "result": status.result,
                    "error": status.error,
                },
            )
            task = await session.scalar(
                select(Task).where(Task.id == provider_job.task_id).with_for_update()
            )
            if task:
                await _apply_task_status_from_provider(task, status)

            return {
                "status": provider_job.status,
                "provider_job_id": str(provider_job.id),
                "external_job_id": provider_job.external_job_id,
                "poll": provider_job.status not in TERMINAL_STATUSES,
            }


async def _mark_provider_failed(provider_job_id: uuid.UUID, error: str) -> dict[str, Any]:
    async with SessionLocal() as session:
        async with session.begin():
            provider_job = await session.scalar(
                select(ProviderJob).where(ProviderJob.id == provider_job_id).with_for_update()
            )
            if provider_job is None:
                return {"status": "missing", "provider_job_id": str(provider_job_id)}
            provider_job.status = "failed"
            provider_job.payload = _merge_payload(provider_job.payload, {"error": error})
            await _mark_task_terminal(
                session,
                provider_job.task_id,
                status="failed",
                error=error,
            )
            return {
                "status": "failed",
                "provider_job_id": str(provider_job.id),
                "error": error,
                "poll": False,
            }


async def _read_recharge_order(order_id: str) -> dict[str, Any]:
    parsed_order_id = uuid.UUID(order_id)
    async with SessionLocal() as session:
        order = await session.get(WalletRechargeOrder, parsed_order_id)
        if order is None:
            return {"status": "missing", "order_id": order_id}
        return {
            "status": order.status,
            "order_id": str(order.id),
            "wallet_id": str(order.wallet_id),
            "provider": order.provider,
            "provider_trade_no": order.provider_trade_no,
        }


async def _run_video_replace_cli(
    *,
    job_id: str,
    script_name: str,
    args: list[str],
    timeout_seconds: int,
) -> dict[str, Any]:
    settings = get_settings()
    service_dir = _video_replace_service_dir(settings.video_replace_service_dir)
    script_path = service_dir / script_name
    if not script_path.exists():
        error = f"video replace CLI not found: {script_path}"
        await _mark_video_replace_failed(job_id, error)
        return {"status": "failed", "job_id": job_id, "error": error}

    python_path = _video_replace_python_path(
        service_dir=service_dir,
        configured_path=settings.video_replace_python_path,
    )
    env = _video_replace_env(settings)
    proc = await asyncio.create_subprocess_exec(
        str(python_path),
        str(script_path),
        *args,
        cwd=str(service_dir),
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        **_subprocess_group_kwargs(),
    )
    async with SessionLocal() as session:
        async with session.begin():
            await mark_video_replace_worker_started(session, job_id=job_id, pid=proc.pid or 0)

    stdout = b""
    stderr = b""
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_seconds)
    except TimeoutError:
        _kill_process_tree(proc.pid)
        error = f"{script_name} timed out after {timeout_seconds}s"
        await _mark_video_replace_failed(job_id, error)
        return {"status": "failed", "job_id": job_id, "error": error}

    stdout_text = stdout.decode("utf-8", errors="replace").strip()
    stderr_text = stderr.decode("utf-8", errors="replace").strip()
    if proc.returncode not in (0, None):
        error = stderr_text or stdout_text or f"{script_name} exited with code {proc.returncode}"
        await _mark_video_replace_failed(job_id, error)
        return {
            "status": "failed",
            "job_id": job_id,
            "returncode": proc.returncode,
            "stdout": stdout_text[-4000:],
            "stderr": stderr_text[-4000:],
            "error": error,
        }

    async with SessionLocal() as session:
        async with session.begin():
            job = await sync_video_replace_task_status(session, job_id=job_id)
            status = job.status if job else "missing"

    return {
        "status": status,
        "job_id": job_id,
        "returncode": proc.returncode,
        "stdout": stdout_text[-4000:],
        "stderr": stderr_text[-4000:],
    }


def _provider_input(provider_job: ProviderJob, task: Task | None) -> dict[str, Any]:
    payload = provider_job.payload or {}
    provider_input = payload.get("input")
    if isinstance(provider_input, dict):
        return provider_input
    if task and isinstance(task.payload, dict):
        return task.payload
    return {}


def _merge_payload(existing: dict[str, Any] | None, patch: dict[str, Any]) -> dict[str, Any]:
    return {**(existing or {}), **patch}


async def _mark_video_replace_failed(job_id: str, error: str) -> None:
    async with SessionLocal() as session:
        async with session.begin():
            await mark_video_replace_worker_failed(session, job_id=job_id, error=error)


def _video_replace_service_dir(value: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        path = Path.cwd() / path
    return path.resolve()


def _video_replace_python_path(*, service_dir: Path, configured_path: str | None) -> Path:
    if configured_path:
        return Path(configured_path).resolve()
    candidate = (
        service_dir / ".venv" / "Scripts" / "python.exe"
        if os.name == "nt"
        else service_dir / ".venv" / "bin" / "python"
    )
    if candidate.exists():
        return candidate
    return Path(sys.executable).resolve()


def _video_replace_env(settings: Any) -> dict[str, str]:
    env = os.environ.copy()
    env["DATABASE_URL"] = settings.database_url
    env["VR_DATABASE_URL"] = settings.database_url
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def _subprocess_group_kwargs() -> dict[str, Any]:
    if os.name == "nt":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


def _kill_process_tree(pid: int | None) -> None:
    if not pid:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            check=False,
            capture_output=True,
            text=True,
        )
        return
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except OSError:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            return


def _is_timed_out(timeout_at: datetime | None) -> bool:
    if timeout_at is None:
        return False
    if timeout_at.tzinfo is None:
        timeout_at = timeout_at.replace(tzinfo=UTC)
    return datetime.now(tz=UTC) > timeout_at


async def _mark_task_terminal(
    session: Any,
    task_id: uuid.UUID | None,
    *,
    status: str,
    error: str | None = None,
) -> None:
    if task_id is None:
        return
    task = await session.scalar(select(Task).where(Task.id == task_id).with_for_update())
    if not task:
        return
    task.status = status
    task.error = error
    if status == "succeeded":
        task.progress = 100


async def _apply_task_status_from_provider(task: Task, status: ProviderJobStatus) -> None:
    task.payload = _merge_payload(
        task.payload,
        {
            "provider_result": status.result,
            "provider_status": status.raw,
        },
    )
    if status.status == "succeeded":
        task.status = "succeeded"
        task.progress = 100
        task.error = None
    elif status.status in {"failed", "cancelled"}:
        task.status = status.status
        task.error = status.error
    else:
        task.status = "running"
        if status.progress is not None:
            task.progress = max(0, min(99, status.progress))
        task.error = None
