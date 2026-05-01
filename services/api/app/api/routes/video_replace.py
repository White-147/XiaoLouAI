from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import httpx
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_session
from app.models import VideoReplaceJob
from app.schemas import (
    VideoReplaceDetectRequest,
    VideoReplaceEnqueueRequest,
    VideoReplaceEnqueueResponse,
    VideoReplaceImportRequest,
    VideoReplaceJobRead,
    VideoReplaceReferenceImportRequest,
)
from app.services.video_replace import (
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    VideoReplaceError,
    VideoReplaceValidationError,
    cancel_video_replace_job,
    content_type_for_path,
    create_video_replace_job_from_file,
    ensure_video_replace_dirs,
    enqueue_video_replace_job,
    get_video_replace_job,
    new_stored_name,
    run_video_replace_detection_cli,
    video_replace_data_dir,
    video_replace_job_to_status,
    vr_url,
)

router = APIRouter(prefix="/api/video-replace", tags=["video-replace"])


def _video_replace_http_error(exc: VideoReplaceError) -> HTTPException:
    return HTTPException(
        status_code=exc.status_code,
        detail={"code": exc.code, "message": str(exc)},
    )


def _vr_ok(data: dict[str, Any]) -> dict[str, Any]:
    return {"success": True, "data": data}


@router.get("/jobs", response_model=list[VideoReplaceJobRead])
async def list_video_replace_jobs(
    limit: int = 100,
    session: AsyncSession = Depends(get_session),
) -> list[VideoReplaceJob]:
    capped_limit = max(1, min(limit, 500))
    result = await session.scalars(
        select(VideoReplaceJob).order_by(VideoReplaceJob.updated_at.desc()).limit(capped_limit)
    )
    return list(result)


@router.post("/upload")
async def upload_video_replace_file(
    file: UploadFile = File(...),
    actor_id: uuid.UUID | None = Form(default=None),
    project_id: uuid.UUID | None = Form(default=None),
    x_actor_id: uuid.UUID | None = Header(default=None, alias="x-actor-id"),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    settings = get_settings()
    ensure_video_replace_dirs(settings)
    stored_path = await _save_upload_file(
        file=file,
        target_dir=video_replace_data_dir(settings) / "uploads",
        max_bytes=settings.video_replace_max_upload_mb * 1024 * 1024,
        allowed_extensions=VIDEO_EXTENSIONS,
        default_filename="upload.mp4",
    )
    try:
        async with session.begin():
            job = await create_video_replace_job_from_file(
                session,
                source_path=stored_path,
                original_filename=file.filename or stored_path.name,
                actor_id=actor_id or x_actor_id,
                project_id=project_id,
                settings=settings,
            )
    except VideoReplaceError as exc:
        _unlink_quietly(stored_path)
        raise _video_replace_http_error(exc) from exc

    await session.refresh(job)
    return _vr_ok(_created_job_response(job))


@router.post("/reference")
async def upload_video_replace_reference(
    file: UploadFile = File(...),
) -> dict[str, Any]:
    settings = get_settings()
    ensure_video_replace_dirs(settings)
    stored_path = await _save_upload_file(
        file=file,
        target_dir=video_replace_data_dir(settings) / "references",
        max_bytes=settings.video_replace_reference_max_mb * 1024 * 1024,
        allowed_extensions=IMAGE_EXTENSIONS,
        default_filename="ref.jpg",
    )
    return _vr_ok(_reference_response(stored_path, file.filename))


@router.post("/jobs")
async def import_video_replace_job(
    payload: VideoReplaceImportRequest,
    x_actor_id: uuid.UUID | None = Header(default=None, alias="x-actor-id"),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    settings = get_settings()
    ensure_video_replace_dirs(settings)
    source_url = _resolve_external_url(payload.video_url, settings=settings)
    extension = _guess_extension(source_url, payload.original_filename)
    if extension not in VIDEO_EXTENSIONS:
        raise _video_replace_http_error(
            VideoReplaceValidationError(
                f"unsupported video extension {extension or '<none>'}; "
                f"allowed: {', '.join(sorted(VIDEO_EXTENSIONS))}"
            )
        )

    stored_path = video_replace_data_dir(settings) / "uploads" / new_stored_name(extension)
    try:
        await _download_to_file(
            url=source_url,
            destination=stored_path,
            max_bytes=settings.video_replace_max_upload_mb * 1024 * 1024,
        )
        async with session.begin():
            job = await create_video_replace_job_from_file(
                session,
                source_path=stored_path,
                original_filename=payload.original_filename or _basename_from_url(source_url),
                actor_id=payload.actor_id or x_actor_id,
                project_id=payload.project_id,
                source_origin="asset-import",
                source_original_url=payload.video_url,
                settings=settings,
            )
    except VideoReplaceError as exc:
        _unlink_quietly(stored_path)
        raise _video_replace_http_error(exc) from exc
    except httpx.HTTPError as exc:
        _unlink_quietly(stored_path)
        raise HTTPException(
            status_code=502,
            detail={
                "code": "IMPORT_FETCH_FAILED",
                "message": str(exc),
            },
        ) from exc

    await session.refresh(job)
    return _vr_ok(_created_job_response(job))


@router.post("/reference-import")
async def import_video_replace_reference(
    payload: VideoReplaceReferenceImportRequest,
) -> dict[str, Any]:
    settings = get_settings()
    ensure_video_replace_dirs(settings)
    source_url = _resolve_external_url(payload.image_url, settings=settings)
    extension = _guess_extension(source_url, payload.original_filename)
    if extension not in IMAGE_EXTENSIONS:
        raise _video_replace_http_error(
            VideoReplaceValidationError(
                f"unsupported image extension {extension or '<none>'}; "
                f"allowed: {', '.join(sorted(IMAGE_EXTENSIONS))}"
            )
        )

    stored_path = video_replace_data_dir(settings) / "references" / new_stored_name(extension)
    try:
        await _download_to_file(
            url=source_url,
            destination=stored_path,
            max_bytes=settings.video_replace_reference_max_mb * 1024 * 1024,
        )
    except httpx.HTTPError as exc:
        _unlink_quietly(stored_path)
        raise HTTPException(
            status_code=502,
            detail={
                "code": "IMPORT_FETCH_FAILED",
                "message": str(exc),
            },
        ) from exc
    except VideoReplaceError as exc:
        _unlink_quietly(stored_path)
        raise _video_replace_http_error(exc) from exc

    return _vr_ok(_reference_response(stored_path, payload.original_filename))


@router.get("/jobs/{job_id}", response_model=VideoReplaceJobRead)
async def read_video_replace_job(
    job_id: str,
    session: AsyncSession = Depends(get_session),
) -> VideoReplaceJob:
    try:
        return await get_video_replace_job(session, job_id)
    except VideoReplaceError as exc:
        raise _video_replace_http_error(exc) from exc


@router.post(
    "/jobs/{job_id}/enqueue",
    response_model=VideoReplaceEnqueueResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def enqueue_video_replace_pipeline(
    job_id: str,
    payload: VideoReplaceEnqueueRequest,
    session: AsyncSession = Depends(get_session),
) -> VideoReplaceEnqueueResponse:
    settings = get_settings()
    try:
        async with session.begin():
            job, task, _, celery_task_id, error = await enqueue_video_replace_job(
                session,
                job_id=job_id,
                actor_id=payload.actor_id,
                project_id=payload.project_id,
                task_id=payload.task_id,
                force=payload.force,
                metadata=payload.metadata,
                settings=settings,
            )
    except VideoReplaceError as exc:
        raise _video_replace_http_error(exc) from exc

    await session.refresh(job)
    await session.refresh(task)
    return VideoReplaceEnqueueResponse(
        job=VideoReplaceJobRead.model_validate(job),
        task_id=task.id,
        celery_task_id=celery_task_id,
        published=bool(celery_task_id),
        error=error,
    )


@router.post("/jobs/{job_id}/detect")
async def detect_video_replace_people(
    job_id: str,
    payload: VideoReplaceDetectRequest | None = None,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    settings = get_settings()
    try:
        job = await run_video_replace_detection_cli(
            session,
            job_id=job_id,
            yolo_conf=payload.yolo_conf if payload else None,
            settings=settings,
        )
    except VideoReplaceError as exc:
        raise _video_replace_http_error(exc) from exc
    return _vr_ok(video_replace_job_to_status(job))


@router.post("/jobs/{job_id}/cancel", response_model=VideoReplaceJobRead)
async def cancel_video_replace_pipeline(
    job_id: str,
    session: AsyncSession = Depends(get_session),
) -> VideoReplaceJob:
    try:
        async with session.begin():
            return await cancel_video_replace_job(session, job_id=job_id)
    except VideoReplaceError as exc:
        raise _video_replace_http_error(exc) from exc


async def _save_upload_file(
    *,
    file: UploadFile,
    target_dir: Path,
    max_bytes: int,
    allowed_extensions: set[str],
    default_filename: str,
) -> Path:
    original_name = file.filename or default_filename
    extension = Path(original_name).suffix.lower()
    if extension not in allowed_extensions:
        raise _video_replace_http_error(
            VideoReplaceValidationError(
                f"unsupported file extension {extension or '<none>'}; "
                f"allowed: {', '.join(sorted(allowed_extensions))}"
            )
        )
    target_dir.mkdir(parents=True, exist_ok=True)
    destination = target_dir / new_stored_name(extension)

    total = 0
    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > max_bytes:
                    raise VideoReplaceValidationError(
                        f"uploaded file exceeds {max_bytes // (1024 * 1024)}MB"
                    )
                output.write(chunk)
    except VideoReplaceError as exc:
        _unlink_quietly(destination)
        raise _video_replace_http_error(exc) from exc
    except OSError as exc:
        _unlink_quietly(destination)
        raise _video_replace_http_error(
            VideoReplaceValidationError(f"failed to store upload: {exc}")
        ) from exc
    if total <= 0:
        _unlink_quietly(destination)
        raise _video_replace_http_error(VideoReplaceValidationError("multipart field 'file' is empty"))
    return destination


async def _download_to_file(*, url: str, destination: Path, max_bytes: int) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    async with httpx.AsyncClient(follow_redirects=True, timeout=60) as client:
        async with client.stream("GET", url, headers={"User-Agent": "xiaolou-vr/1.0"}) as response:
            response.raise_for_status()
            with destination.open("wb") as output:
                async for chunk in response.aiter_bytes():
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > max_bytes:
                        raise VideoReplaceValidationError(
                            f"remote resource exceeds {max_bytes // (1024 * 1024)}MB"
                        )
                    output.write(chunk)
    if total <= 0:
        raise VideoReplaceValidationError("remote resource is empty")


def _created_job_response(job: VideoReplaceJob) -> dict[str, Any]:
    status_payload = video_replace_job_to_status(job)
    return {
        "job_id": str(job.id),
        "video_url": status_payload["source_video_url"],
        "thumbnail_url": status_payload["thumbnail_url"],
        "meta": status_payload["meta"],
        "status": status_payload,
    }


def _reference_response(stored_path: Path, original_filename: str | None) -> dict[str, Any]:
    return {
        "url": vr_url("/vr-references", stored_path.name),
        "filename": original_filename or stored_path.name,
        "content_type": content_type_for_path(stored_path),
        "size_bytes": stored_path.stat().st_size,
    }


def _resolve_external_url(raw_url: str, *, settings: Settings) -> str:
    value = raw_url.strip()
    if value.startswith(("http://", "https://")):
        return value
    if value.startswith("/"):
        return f"{settings.video_replace_core_api_base_url.rstrip('/')}{value}"
    raise _video_replace_http_error(VideoReplaceValidationError(f"unsupported asset url: {raw_url}"))


def _guess_extension(url: str, fallback_name: str | None) -> str:
    for candidate in (urlparse(url).path, fallback_name or ""):
        extension = Path(unquote(candidate)).suffix.lower()
        if extension:
            return extension
    return ""


def _basename_from_url(url: str) -> str:
    parsed_path = unquote(urlparse(url).path)
    return os.path.basename(parsed_path) or "imported-video"


def _unlink_quietly(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass
