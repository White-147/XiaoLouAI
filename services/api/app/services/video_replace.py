from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import signal
import subprocess
import sys
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.models import ProviderJob, Task, VideoReplaceJob

TERMINAL_VIDEO_REPLACE_STATUSES = {"succeeded", "failed", "cancelled"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm", ".mkv"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
STATIC_PREFIX_TO_DIR = {
    "/vr-uploads": "uploads",
    "/vr-thumbnails": "thumbnails",
    "/vr-candidates": "candidates",
    "/vr-keyframes": "keyframes",
    "/vr-references": "references",
    "/vr-masks": "masks",
    "/vr-results": "results",
    "/vr-finals": "finals",
}


class VideoReplaceError(RuntimeError):
    status_code = 400
    code = "VIDEO_REPLACE_ERROR"


class VideoReplaceNotFound(VideoReplaceError):
    status_code = 404
    code = "VIDEO_REPLACE_NOT_FOUND"


class VideoReplaceStateError(VideoReplaceError):
    status_code = 409
    code = "VIDEO_REPLACE_STATE_ERROR"


class VideoReplaceEnqueueError(VideoReplaceError):
    status_code = 503
    code = "VIDEO_REPLACE_ENQUEUE_ERROR"


class VideoReplaceValidationError(VideoReplaceError):
    status_code = 400
    code = "VIDEO_REPLACE_VALIDATION_ERROR"


class VideoReplaceRuntimeError(VideoReplaceError):
    status_code = 500
    code = "VIDEO_REPLACE_RUNTIME_ERROR"


def video_replace_service_dir(settings: Settings | None = None) -> Path:
    resolved_settings = settings or get_settings()
    path = Path(resolved_settings.video_replace_service_dir)
    if not path.is_absolute():
        path = Path.cwd() / path
    return path.resolve()


def video_replace_data_dir(settings: Settings | None = None) -> Path:
    return video_replace_service_dir(settings) / "data"


def video_replace_static_dirs(settings: Settings | None = None) -> dict[str, Path]:
    root = video_replace_data_dir(settings)
    return {prefix: root / dirname for prefix, dirname in STATIC_PREFIX_TO_DIR.items()}


def ensure_video_replace_dirs(settings: Settings | None = None) -> None:
    root = video_replace_data_dir(settings)
    for dirname in (*STATIC_PREFIX_TO_DIR.values(), "_tmp"):
        (root / dirname).mkdir(parents=True, exist_ok=True)


def new_stored_name(extension: str) -> str:
    ext = extension.lower()
    if not ext.startswith("."):
        ext = f".{ext}"
    return f"{uuid.uuid4().hex}{ext}"


def vr_url(prefix: str, stored_name: str) -> str:
    return f"{prefix}/{stored_name}"


def video_replace_python_path(settings: Settings | None = None) -> Path:
    resolved_settings = settings or get_settings()
    if resolved_settings.video_replace_python_path:
        return Path(resolved_settings.video_replace_python_path).resolve()
    service_dir = video_replace_service_dir(resolved_settings)
    candidate = (
        service_dir / ".venv" / "Scripts" / "python.exe"
        if os.name == "nt"
        else service_dir / ".venv" / "bin" / "python"
    )
    if candidate.exists():
        return candidate
    return Path(sys.executable).resolve()


async def create_video_replace_job_from_file(
    session: AsyncSession,
    *,
    source_path: Path,
    original_filename: str,
    actor_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    source_origin: str | None = None,
    source_original_url: str | None = None,
    settings: Settings | None = None,
) -> VideoReplaceJob:
    resolved_settings = settings or get_settings()
    ensure_video_replace_dirs(resolved_settings)
    extension = source_path.suffix.lower()
    if extension not in VIDEO_EXTENSIONS:
        raise VideoReplaceValidationError(
            f"unsupported video extension {extension or '<none>'}; allowed: {', '.join(sorted(VIDEO_EXTENSIONS))}"
        )

    thumb_name = new_stored_name(".jpg")
    thumb_path = video_replace_data_dir(resolved_settings) / "thumbnails" / thumb_name
    probe = await run_video_replace_cli(
        "vr_probe_cli.py",
        [str(source_path), str(thumb_path)],
        timeout_seconds=30,
        settings=resolved_settings,
    )
    if not probe.get("ok"):
        raise VideoReplaceValidationError(str(probe.get("error") or "video probe failed"))

    meta = probe.get("meta") or {}
    duration_seconds = float(meta.get("duration_seconds") or 0)
    if duration_seconds > resolved_settings.video_replace_max_video_seconds:
        raise VideoReplaceValidationError(
            f"video is {duration_seconds:.1f}s; max is {resolved_settings.video_replace_max_video_seconds}s"
        )

    upload_name = source_path.name
    job = VideoReplaceJob(
        id=uuid.uuid4(),
        status="uploaded",
        progress=Decimal("0"),
        queue_name="video_local_gpu",
        payload={
            "actor_id": str(actor_id) if actor_id else None,
            "project_id": str(project_id) if project_id else None,
            "video_url": vr_url("/vr-uploads", upload_name),
            "video_abs_path": str(source_path),
            "video_stored_name": upload_name,
            "thumbnail_url": vr_url("/vr-thumbnails", thumb_name) if probe.get("thumb_ok") else None,
            "meta": meta,
            "original_filename": original_filename,
            "source_origin": source_origin,
            "source_original_url": source_original_url,
        },
    )
    session.add(job)
    await session.flush()
    await notify_video_replace_job_changed(session, str(job.id))
    return job


async def run_video_replace_detection_cli(
    session: AsyncSession,
    *,
    job_id: str,
    yolo_conf: float | None = None,
    settings: Settings | None = None,
) -> VideoReplaceJob:
    resolved_settings = settings or get_settings()
    job = await get_video_replace_job(session, job_id)
    if job.status == "detecting":
        raise VideoReplaceStateError("video replace detection is already running")
    result = await run_video_replace_cli(
        "vr_detect_cli.py",
        [str(job.id), "--conf", str(yolo_conf if yolo_conf is not None else 0.4)],
        timeout_seconds=resolved_settings.video_replace_detect_timeout_seconds,
        settings=resolved_settings,
    )
    if not result.get("ok"):
        raise VideoReplaceRuntimeError(str(result.get("error") or "video detection failed"))
    await session.refresh(job)
    return job


async def run_video_replace_cli(
    script_name: str,
    args: list[str],
    *,
    timeout_seconds: int,
    settings: Settings | None = None,
) -> dict[str, Any]:
    resolved_settings = settings or get_settings()
    service_dir = video_replace_service_dir(resolved_settings)
    script_path = service_dir / script_name
    if not script_path.exists():
        raise VideoReplaceRuntimeError(f"video replace CLI not found: {script_path}")

    proc = await asyncio.create_subprocess_exec(
        str(video_replace_python_path(resolved_settings)),
        str(script_path),
        *args,
        cwd=str(service_dir),
        env=video_replace_env(resolved_settings),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_seconds)
    except TimeoutError as exc:
        _kill_process_tree(proc.pid or 0, reason=f"{script_name} timeout")
        raise VideoReplaceRuntimeError(f"{script_name} timed out after {timeout_seconds}s") from exc

    stdout_text = stdout.decode("utf-8", errors="replace").strip()
    stderr_text = stderr.decode("utf-8", errors="replace").strip()
    parsed = _parse_last_json_line(stdout_text) or {}
    if proc.returncode not in (0, None):
        return {
            "ok": False,
            "error": parsed.get("error") or stderr_text or stdout_text or f"{script_name} exited with {proc.returncode}",
            "stdout": stdout_text,
            "stderr": stderr_text,
        }
    return {"ok": True, **parsed, "stdout": stdout_text, "stderr": stderr_text}


def video_replace_env(settings: Settings | None = None) -> dict[str, str]:
    resolved_settings = settings or get_settings()
    env = os.environ.copy()
    env["DATABASE_URL"] = resolved_settings.database_url
    env["VR_DATABASE_URL"] = resolved_settings.database_url
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def video_replace_job_to_status(job: VideoReplaceJob) -> dict[str, Any]:
    payload = job.payload or {}
    queue_ahead = None
    return {
        "job_id": str(job.id),
        "legacy_id": job.legacy_id,
        "stage": job.status,
        "progress": float(job.progress or 0),
        "message": job.message,
        "error": job.error,
        "queue_ahead": queue_ahead,
        "queue_position": None,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "updated_at": job.updated_at.isoformat() if job.updated_at else None,
        "source_video_url": payload.get("video_url"),
        "thumbnail_url": payload.get("thumbnail_url"),
        "meta": payload.get("meta"),
        "detection": payload.get("detection"),
        "source_person_id": payload.get("source_person_id"),
        "target_reference_url": payload.get("target_reference_url"),
        "advanced": payload.get("advanced"),
        "mask_preview_url": payload.get("mask_preview_url"),
        "result_video_url": payload.get("result_video_url"),
        "result_download_url": payload.get("result_download_url"),
        "raw_result_video_url": payload.get("raw_result_video_url"),
        "final_result_video_url": payload.get("final_result_video_url"),
        "final_result_download_url": payload.get("final_result_download_url"),
        "mode": payload.get("mode"),
        "tracker_backend": payload.get("tracker_backend"),
        "replacer_backend": payload.get("replacer_backend"),
        "actor_id": payload.get("actor_id"),
        "project_id": payload.get("project_id"),
        "project_asset_id": payload.get("project_asset_id"),
    }


def content_type_for_path(path: Path) -> str:
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def parse_video_replace_job_id(value: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


async def get_video_replace_job_for_update(
    session: AsyncSession,
    job_id: str,
) -> VideoReplaceJob:
    parsed_id = parse_video_replace_job_id(job_id)
    conditions = [VideoReplaceJob.legacy_id == job_id]
    if parsed_id:
        conditions.append(VideoReplaceJob.id == parsed_id)
    job = await session.scalar(
        select(VideoReplaceJob).where(or_(*conditions)).with_for_update().limit(1)
    )
    if job is None:
        raise VideoReplaceNotFound("video replace job not found")
    return job


async def get_video_replace_job(session: AsyncSession, job_id: str) -> VideoReplaceJob:
    parsed_id = parse_video_replace_job_id(job_id)
    conditions = [VideoReplaceJob.legacy_id == job_id]
    if parsed_id:
        conditions.append(VideoReplaceJob.id == parsed_id)
    job = await session.scalar(select(VideoReplaceJob).where(or_(*conditions)).limit(1))
    if job is None:
        raise VideoReplaceNotFound("video replace job not found")
    return job


async def enqueue_video_replace_job(
    session: AsyncSession,
    *,
    job_id: str,
    actor_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
    force: bool = False,
    metadata: dict[str, Any] | None = None,
    settings: Settings | None = None,
) -> tuple[VideoReplaceJob, Task, ProviderJob | None, str | None, str | None]:
    resolved_settings = settings or get_settings()
    provider_job: ProviderJob | None = None

    job = await get_video_replace_job_for_update(session, job_id)
    if job.status in TERMINAL_VIDEO_REPLACE_STATUSES and not force:
        raise VideoReplaceStateError(f"video replace job is already {job.status}")
    if job.status not in {"queued", "enqueue_failed"} and not force:
        raise VideoReplaceStateError(f"video replace job must be queued, got {job.status}")

    task = await _get_or_create_video_replace_task(
        session,
        job=job,
        actor_id=actor_id,
        project_id=project_id,
        task_id=task_id,
        settings=resolved_settings,
        metadata=metadata or {},
    )
    provider_job = await _get_or_create_provider_job(
        session,
        job=job,
        task=task,
        settings=resolved_settings,
    )

    job.task_id = task.id
    job.provider_job_id = provider_job.id
    job.queue_name = "video_local_gpu"
    job.status = "queued"
    job.error = None
    job.message = "video replace job queued for Celery GPU worker"
    job.payload = {
        **(job.payload or {}),
        "actor_id": str(actor_id) if actor_id else (job.payload or {}).get("actor_id"),
        "project_id": str(project_id) if project_id else (job.payload or {}).get("project_id"),
        "task_id": str(task.id),
        "provider_job_id": str(provider_job.id),
        "queue_name": "video_local_gpu",
        "enqueue_metadata": metadata or {},
    }
    task.status = "queued"
    task.queue_name = "video_local_gpu"
    task.error = None
    task.payload = {
        **(task.payload or {}),
        "video_replace_job_id": str(job.id),
        "legacy_video_replace_job_id": job.legacy_id,
        "provider_job_id": str(provider_job.id),
        "enqueue_metadata": metadata or {},
    }
    provider_job.status = "queued"
    provider_job.payload = {
        **(provider_job.payload or {}),
        "video_replace_job_id": str(job.id),
    }
    await session.flush()
    await notify_video_replace_job_changed(session, str(job.id))

    if not resolved_settings.task_publish_enabled:
        return job, task, provider_job, None, "task publishing is disabled"

    try:
        from app.workers.tasks import run_video_replace_pipeline

        celery_result = run_video_replace_pipeline.apply_async(
            args=[str(job.id)],
            queue="video_local_gpu",
        )
    except Exception as exc:
        message = f"failed to publish video replace pipeline: {exc}"
        job.status = "enqueue_failed"
        job.error = message
        task.status = "enqueue_failed"
        task.error = message
        provider_job.status = "failed"
        provider_job.payload = {**(provider_job.payload or {}), "error": message}
        await session.flush()
        await notify_video_replace_job_changed(session, str(job.id))
        if resolved_settings.task_publish_fail_fast:
            raise VideoReplaceEnqueueError(message) from exc
        return job, task, provider_job, None, message

    job.payload = {
        **(job.payload or {}),
        "celery_task_id": str(celery_result.id),
    }
    task.payload = {
        **(task.payload or {}),
        "enqueue": {
            "published": True,
            "celery_task_id": str(celery_result.id),
            "queue": "video_local_gpu",
        },
    }
    provider_job.payload = {
        **(provider_job.payload or {}),
        "celery_task_id": str(celery_result.id),
    }
    await session.flush()
    await notify_video_replace_job_changed(session, str(job.id))
    return job, task, provider_job, str(celery_result.id), None


async def cancel_video_replace_job(
    session: AsyncSession,
    *,
    job_id: str,
    reason: str = "cancelled by user",
    settings: Settings | None = None,
) -> VideoReplaceJob:
    resolved_settings = settings or get_settings()
    job = await get_video_replace_job_for_update(session, job_id)
    if job.status in TERMINAL_VIDEO_REPLACE_STATUSES:
        return job

    payload_before_cancel = job.payload or {}
    revoke_error = _revoke_video_replace_celery_task(payload_before_cancel, reason=reason)
    if resolved_settings.video_replace_kill_on_cancel:
        _kill_recorded_processes(payload_before_cancel, reason=reason)

    job.status = "cancelled"
    job.message = reason
    job.payload = {
        **payload_before_cancel,
        "pipeline_pid": None,
        "subprocess_pid": None,
        "cancelled_at": datetime.now(tz=UTC).isoformat(),
        "celery_revoke_error": revoke_error,
    }

    if job.task_id:
        task = await session.get(Task, job.task_id)
        if task:
            task.status = "cancelled"
            task.error = reason
    if job.provider_job_id:
        provider_job = await session.get(ProviderJob, job.provider_job_id)
        if provider_job:
            provider_job.status = "cancelled"
            provider_job.payload = {**(provider_job.payload or {}), "cancel_reason": reason}

    await session.flush()
    await notify_video_replace_job_changed(session, str(job.id))
    return job


async def sync_video_replace_task_status(
    session: AsyncSession,
    *,
    job_id: str,
) -> VideoReplaceJob | None:
    job = await session.get(VideoReplaceJob, parse_video_replace_job_id(job_id))
    if job is None:
        return None

    task = await session.get(Task, job.task_id) if job.task_id else None
    provider_job = await session.get(ProviderJob, job.provider_job_id) if job.provider_job_id else None
    normalized_progress = _task_progress(job.progress)

    if task:
        task.progress = normalized_progress
        task.payload = {
            **(task.payload or {}),
            "video_replace": {
                "job_id": str(job.id),
                "stage": job.status,
                "message": job.message,
                "result_video_url": (job.payload or {}).get("result_video_url"),
                "final_result_video_url": (job.payload or {}).get("final_result_video_url"),
            },
        }
        if job.status == "succeeded":
            task.status = "succeeded"
            task.progress = 100
            task.error = None
        elif job.status in {"failed", "cancelled", "enqueue_failed"}:
            task.status = job.status
            task.error = job.error or job.message
        else:
            task.status = "running"
            task.error = None

    if provider_job:
        if job.status == "succeeded":
            provider_job.status = "succeeded"
        elif job.status in {"failed", "cancelled", "enqueue_failed"}:
            provider_job.status = "failed" if job.status == "failed" else job.status
        else:
            provider_job.status = "running"
        provider_job.payload = {
            **(provider_job.payload or {}),
            "video_replace_stage": job.status,
            "video_replace_progress": str(job.progress),
            "result": {
                "result_video_url": (job.payload or {}).get("result_video_url"),
                "final_result_video_url": (job.payload or {}).get("final_result_video_url"),
            },
            "error": job.error,
        }

    await session.flush()
    return job


async def mark_video_replace_worker_started(
    session: AsyncSession,
    *,
    job_id: str,
    pid: int,
) -> None:
    job = await session.get(VideoReplaceJob, parse_video_replace_job_id(job_id))
    if job is None:
        return
    job.status = "queued" if job.status == "queued" else job.status
    job.message = f"video replace pipeline process started (pid={pid})"
    job.payload = {
        **(job.payload or {}),
        "pipeline_pid": int(pid),
    }
    if job.task_id:
        task = await session.get(Task, job.task_id)
        if task:
            task.status = "running"
            task.error = None
    if job.provider_job_id:
        provider_job = await session.get(ProviderJob, job.provider_job_id)
        if provider_job:
            provider_job.status = "running"
            provider_job.attempts = (provider_job.attempts or 0) + 1
    await session.flush()
    await notify_video_replace_job_changed(session, str(job.id))


async def mark_video_replace_worker_failed(
    session: AsyncSession,
    *,
    job_id: str,
    error: str,
) -> None:
    job = await session.get(VideoReplaceJob, parse_video_replace_job_id(job_id))
    if job is None:
        return
    if job.status not in TERMINAL_VIDEO_REPLACE_STATUSES:
        job.status = "failed"
        job.error = error
        job.message = "video replace worker failed"
        job.payload = {
            **(job.payload or {}),
            "pipeline_pid": None,
            "subprocess_pid": None,
        }
    await sync_video_replace_task_status(session, job_id=str(job.id))
    await notify_video_replace_job_changed(session, str(job.id))


async def notify_video_replace_job_changed(session: AsyncSession, job_id: str) -> None:
    await session.execute(text("SELECT pg_notify('video_replace_job_changed', :job_id)"), {"job_id": job_id})


async def _get_or_create_video_replace_task(
    session: AsyncSession,
    *,
    job: VideoReplaceJob,
    actor_id: uuid.UUID | None,
    project_id: uuid.UUID | None,
    task_id: uuid.UUID | None,
    settings: Settings,
    metadata: dict[str, Any],
) -> Task:
    existing_task_id = task_id or job.task_id
    if existing_task_id:
        task = await session.get(Task, existing_task_id)
        if task:
            return task

    task = Task(
        project_id=project_id,
        actor_id=actor_id,
        task_type="video_replace",
        queue_name="video_local_gpu",
        status="queued",
        progress=0,
        payload={
            "model_id": settings.video_replace_model_id,
            "video_replace_job_id": str(job.id),
            "legacy_video_replace_job_id": job.legacy_id,
            "metadata": metadata,
        },
    )
    session.add(task)
    await session.flush()
    return task


async def _get_or_create_provider_job(
    session: AsyncSession,
    *,
    job: VideoReplaceJob,
    task: Task,
    settings: Settings,
) -> ProviderJob:
    if job.provider_job_id:
        provider_job = await session.get(ProviderJob, job.provider_job_id)
        if provider_job:
            return provider_job

    provider_job = ProviderJob(
        task_id=task.id,
        provider="local_video",
        model_id=settings.video_replace_model_id,
        status="queued",
        timeout_at=datetime.now(tz=UTC)
        + timedelta(seconds=settings.video_replace_pipeline_timeout_seconds),
        payload={
            "video_replace_job_id": str(job.id),
            "legacy_video_replace_job_id": job.legacy_id,
        },
    )
    session.add(provider_job)
    await session.flush()
    return provider_job


def _task_progress(value: Decimal | int | float | None) -> int:
    if value is None:
        return 0
    progress = float(value)
    if progress <= 1:
        return max(0, min(100, round(progress * 100)))
    return max(0, min(100, round(progress)))


def _kill_recorded_processes(payload: dict[str, Any], *, reason: str) -> None:
    for key in ("subprocess_pid", "pipeline_pid"):
        raw_pid = payload.get(key)
        if raw_pid in (None, ""):
            continue
        try:
            pid = int(raw_pid)
        except (TypeError, ValueError):
            continue
        _kill_process_tree(pid, reason=reason)


def _revoke_video_replace_celery_task(payload: dict[str, Any], *, reason: str) -> str | None:
    del reason
    celery_task_id = payload.get("celery_task_id")
    if not celery_task_id and isinstance(payload.get("enqueue"), dict):
        celery_task_id = payload["enqueue"].get("celery_task_id")
    if not celery_task_id:
        return None

    try:
        from app.workers.celery_app import celery_app

        celery_app.control.revoke(
            str(celery_task_id),
            terminate=True,
            signal="SIGTERM",
            reply=False,
        )
    except Exception as exc:  # noqa: BLE001
        return f"failed to revoke celery task {celery_task_id}: {exc}"
    return None


def _kill_process_tree(pid: int, *, reason: str) -> None:
    if pid <= 0:
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


def _parse_last_json_line(value: str) -> dict[str, Any] | None:
    for line in reversed([item.strip() for item in value.splitlines() if item.strip()]):
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        return parsed if isinstance(parsed, dict) else None
    return None
