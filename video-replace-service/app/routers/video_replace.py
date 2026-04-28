"""
Video Replace API — real endpoints, no mock responses.

Routes (mounted under /api/video-replace):
  POST   /upload                 upload source video, probe, create job
  POST   /reference              upload replacement character reference image
  POST   /jobs/{id}/detect       run real YOLOv8 person detection on keyframe
  POST   /jobs/{id}/generate     accept source_person_id + target_reference_url
                                 + real advanced params; persist; transition to queued
  GET    /jobs/{id}              return full JobStatus snapshot
  GET    /jobs/{id}/stream       SSE stream of JobStatus (polls DB every 1s)
"""
from __future__ import annotations

import asyncio
import json
import mimetypes
import uuid
from pathlib import Path
from typing import Annotated
from urllib.parse import urljoin

import httpx
from fastapi import APIRouter, Body, Depends, File, HTTPException, Response, UploadFile
from sse_starlette.sse import EventSourceResponse

from ..config import Settings, get_settings
from ..deps import get_storage, get_tasks_db
from ..schemas import (
    DetectRequest,
    GenerateRequest,
    ImportJobRequest,
    ImportReferenceRequest,
    JobStage,
    JobStatus,
    fail,
    ok,
)
from ..services.job_runner import DetectionRunner
from ..services.storage import Storage
from ..services.tasks_db import TasksDB
from ..services.video import VideoError, make_thumbnail, probe
from ..workers.queue import enqueue as enqueue_replace


router = APIRouter(prefix="/api/video-replace", tags=["video-replace"])


# ── Allowed upload types ─────────────────────────────────────────────
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm", ".mkv"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

# Only one detection job runs at a time on the shared GPU resource.
_detect_lock = asyncio.Lock()


def _ext_of(upload: UploadFile) -> str:
    name = upload.filename or ""
    return Path(name).suffix.lower()


class _RemoteFetchError(RuntimeError):
    pass


def _resolve_external_url(raw: str, core_api_base: str) -> str | None:
    """Accept either an absolute http(s) URL or a core-api relative path."""
    s = (raw or "").strip()
    if not s:
        return None
    if s.startswith(("http://", "https://")):
        return s
    if s.startswith("/"):
        # Treat as a core-api relative path; resolve against core-api base.
        return urljoin(core_api_base.rstrip("/") + "/", s.lstrip("/"))
    return None


async def _fetch_remote_bytes(url: str, max_bytes: int) -> bytes:
    """Fetch URL with httpx; enforce max-size; raise _RemoteFetchError on failure."""
    try:
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            resp = await client.get(url)
            if resp.status_code // 100 != 2:
                raise _RemoteFetchError(
                    f"远端资源返回 {resp.status_code}: {url}"
                )
            content = resp.content
            if len(content) > max_bytes:
                raise _RemoteFetchError(
                    f"远端资源大小 {len(content)} 超过上限 {max_bytes}: {url}"
                )
            return content
    except httpx.RequestError as exc:
        raise _RemoteFetchError(f"抓取远端资源失败: {exc}") from exc


def _guess_ext(url: str, fallback_name: str | None) -> str:
    """Pick extension from URL path, then from original filename, lowercased."""
    for candidate in (url, fallback_name or ""):
        if not candidate:
            continue
        try:
            path = candidate.split("?", 1)[0].rsplit("#", 1)[0]
            suffix = Path(path).suffix.lower()
            if suffix:
                return suffix
        except Exception:
            continue
    return ""


def _envelope_response(payload: dict, status_code: int = 200) -> Response:
    return Response(
        content=json.dumps(payload),
        status_code=status_code,
        media_type="application/json",
    )


# ═══════════════════════════════════════════════════════════════════════
# 1. Upload source video
# ═══════════════════════════════════════════════════════════════════════
@router.post("/upload")
async def upload_source_video(
    file: Annotated[UploadFile, File(..., description="Source video (mp4/mov/webm)")],
    settings: Annotated[Settings, Depends(get_settings)],
    storage: Annotated[Storage, Depends(get_storage)],
    db: Annotated[TasksDB, Depends(get_tasks_db)],
):
    ext = _ext_of(file)
    if ext not in VIDEO_EXTS:
        return _envelope_response(
            fail("UNSUPPORTED_VIDEO_FORMAT",
                 f"仅支持 {', '.join(sorted(VIDEO_EXTS))}，收到 {ext or '未知'}", 400),
            400,
        )

    # Persist video
    stored_name = storage.new_name(ext)
    stored_path = storage.upload_path(stored_name)

    # Stream to disk while bounding total size
    max_bytes = settings.max_upload_mb * 1024 * 1024
    stored_path.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with stored_path.open("wb") as out:
        while True:
            chunk = await file.read(1 << 20)
            if not chunk:
                break
            written += len(chunk)
            if written > max_bytes:
                out.close()
                stored_path.unlink(missing_ok=True)
                return _envelope_response(
                    fail("UPLOAD_TOO_LARGE",
                         f"单个视频不能超过 {settings.max_upload_mb}MB", 413),
                    413,
                )
            out.write(chunk)
    await file.close()

    # Probe
    try:
        meta = probe(stored_path)
    except VideoError as exc:
        stored_path.unlink(missing_ok=True)
        return _envelope_response(fail("PROBE_FAILED", str(exc), 400), 400)

    if meta.duration_seconds > settings.max_video_seconds:
        stored_path.unlink(missing_ok=True)
        return _envelope_response(
            fail(
                "VIDEO_TOO_LONG",
                f"当前单机 MVP 默认支持不超过 {settings.max_video_seconds} 秒视频，实际 {meta.duration_seconds:.1f} 秒",
                400,
            ),
            400,
        )

    # Thumbnail
    thumb_name = storage.new_name(".jpg")
    thumb_path = storage.thumbnail_path(thumb_name)
    try:
        make_thumbnail(stored_path, thumb_path, short_edge=360)
        thumbnail_url = storage.thumbnail_url(thumb_name)
    except VideoError:
        thumbnail_url = None

    # Create job
    job_id = f"vr_{uuid.uuid4().hex[:10]}"
    video_url = storage.upload_url(stored_name)
    await db.create(
        job_id,
        data={
            "video_url": video_url,
            "video_abs_path": str(stored_path),
            "video_stored_name": stored_name,
            "thumbnail_url": thumbnail_url,
            "meta": meta.model_dump(),
            "original_filename": file.filename,
        },
        stage=JobStage.UPLOADED,
    )

    return ok({
        "job_id": job_id,
        "video_url": video_url,
        "thumbnail_url": thumbnail_url,
        "meta": meta.model_dump(),
    })


# ═══════════════════════════════════════════════════════════════════════
# 2. Upload replacement character reference image
# ═══════════════════════════════════════════════════════════════════════
@router.post("/reference")
async def upload_reference_image(
    file: Annotated[UploadFile, File(..., description="Reference image for the replacement character")],
    settings: Annotated[Settings, Depends(get_settings)],
    storage: Annotated[Storage, Depends(get_storage)],
):
    ext = _ext_of(file)
    if ext not in IMAGE_EXTS:
        return _envelope_response(
            fail("UNSUPPORTED_IMAGE_FORMAT",
                 f"参考图仅支持 {', '.join(sorted(IMAGE_EXTS))}", 400),
            400,
        )

    stored_name = storage.new_name(ext)
    stored_path = storage.reference_path(stored_name)
    stored_path.parent.mkdir(parents=True, exist_ok=True)

    max_bytes = 25 * 1024 * 1024  # 25 MB for a reference image
    written = 0
    with stored_path.open("wb") as out:
        while True:
            chunk = await file.read(1 << 20)
            if not chunk:
                break
            written += len(chunk)
            if written > max_bytes:
                out.close()
                stored_path.unlink(missing_ok=True)
                return _envelope_response(
                    fail("UPLOAD_TOO_LARGE", "参考图不能超过 25MB", 413), 413
                )
            out.write(chunk)
    await file.close()

    return ok({
        "url": storage.reference_url(stored_name),
        "filename": file.filename or stored_name,
        "content_type": file.content_type or f"image/{ext.lstrip('.')}",
        "size_bytes": written,
    })


# ═══════════════════════════════════════════════════════════════════════
# 2b. Import an existing video (e.g. project asset) as a new job
# ═══════════════════════════════════════════════════════════════════════
@router.post("/jobs")
async def import_job_from_url(
    payload: ImportJobRequest,
    settings: Annotated[Settings, Depends(get_settings)],
    storage: Annotated[Storage, Depends(get_storage)],
    db: Annotated[TasksDB, Depends(get_tasks_db)],
):
    """Fetch a video from a core-api asset URL (or any HTTP URL) and
    create the job exactly like /upload would."""
    abs_url = _resolve_external_url(payload.video_url, settings.core_api_base_url)
    if not abs_url:
        return _envelope_response(
            fail("INVALID_URL", f"不支持的资产地址: {payload.video_url}", 400), 400
        )

    try:
        body = await _fetch_remote_bytes(abs_url, settings.max_upload_mb * 1024 * 1024)
    except _RemoteFetchError as exc:
        return _envelope_response(fail("IMPORT_FETCH_FAILED", str(exc), 502), 502)

    ext = _guess_ext(abs_url, payload.original_filename)
    if ext not in VIDEO_EXTS:
        return _envelope_response(
            fail(
                "UNSUPPORTED_VIDEO_FORMAT",
                f"资产扩展名 {ext or '未知'} 不在受支持列表: {sorted(VIDEO_EXTS)}",
                400,
            ),
            400,
        )

    stored_name = storage.new_name(ext)
    stored_path = storage.upload_path(stored_name)
    stored_path.parent.mkdir(parents=True, exist_ok=True)
    stored_path.write_bytes(body)

    try:
        meta = probe(stored_path)
    except VideoError as exc:
        stored_path.unlink(missing_ok=True)
        return _envelope_response(fail("PROBE_FAILED", str(exc), 400), 400)

    if meta.duration_seconds > settings.max_video_seconds:
        stored_path.unlink(missing_ok=True)
        return _envelope_response(
            fail(
                "VIDEO_TOO_LONG",
                f"当前单机 MVP 默认支持不超过 {settings.max_video_seconds} 秒视频，实际 {meta.duration_seconds:.1f} 秒",
                400,
            ),
            400,
        )

    thumb_name = storage.new_name(".jpg")
    thumb_path = storage.thumbnail_path(thumb_name)
    try:
        make_thumbnail(stored_path, thumb_path, short_edge=360)
        thumbnail_url = storage.thumbnail_url(thumb_name)
    except VideoError:
        thumbnail_url = None

    job_id = f"vr_{uuid.uuid4().hex[:10]}"
    video_url = storage.upload_url(stored_name)
    await db.create(
        job_id,
        data={
            "video_url": video_url,
            "video_abs_path": str(stored_path),
            "video_stored_name": stored_name,
            "thumbnail_url": thumbnail_url,
            "meta": meta.model_dump(),
            "original_filename": payload.original_filename or Path(abs_url).name,
            "source_origin": "asset-import",
            "source_original_url": payload.video_url,
        },
        stage=JobStage.UPLOADED,
    )

    return ok({
        "job_id": job_id,
        "video_url": video_url,
        "thumbnail_url": thumbnail_url,
        "meta": meta.model_dump(),
    })


# ═══════════════════════════════════════════════════════════════════════
# 2c. Import an existing image (e.g. project asset) as the replacement character
# ═══════════════════════════════════════════════════════════════════════
@router.post("/reference-import")
async def import_reference_from_url(
    payload: ImportReferenceRequest,
    settings: Annotated[Settings, Depends(get_settings)],
    storage: Annotated[Storage, Depends(get_storage)],
):
    abs_url = _resolve_external_url(payload.image_url, settings.core_api_base_url)
    if not abs_url:
        return _envelope_response(
            fail("INVALID_URL", f"不支持的资产地址: {payload.image_url}", 400), 400
        )

    try:
        body = await _fetch_remote_bytes(abs_url, 25 * 1024 * 1024)
    except _RemoteFetchError as exc:
        return _envelope_response(fail("IMPORT_FETCH_FAILED", str(exc), 502), 502)

    ext = _guess_ext(abs_url, payload.original_filename)
    if ext not in IMAGE_EXTS:
        return _envelope_response(
            fail(
                "UNSUPPORTED_IMAGE_FORMAT",
                f"资产扩展名 {ext or '未知'} 不在受支持列表: {sorted(IMAGE_EXTS)}",
                400,
            ),
            400,
        )

    stored_name = storage.new_name(ext)
    stored_path = storage.reference_path(stored_name)
    stored_path.parent.mkdir(parents=True, exist_ok=True)
    stored_path.write_bytes(body)

    return ok({
        "url": storage.reference_url(stored_name),
        "filename": payload.original_filename or Path(abs_url).name or stored_name,
        "content_type": mimetypes.guess_type(stored_name)[0] or "image/jpeg",
        "size_bytes": len(body),
    })


# ═══════════════════════════════════════════════════════════════════════
# 3. Run real YOLOv8 detection
# ═══════════════════════════════════════════════════════════════════════
@router.post("/jobs/{job_id}/detect")
async def run_detection(
    job_id: str,
    settings: Annotated[Settings, Depends(get_settings)],
    storage: Annotated[Storage, Depends(get_storage)],
    db: Annotated[TasksDB, Depends(get_tasks_db)],
    payload: DetectRequest = Body(default_factory=DetectRequest),
):
    job = await db.get(job_id)
    if not job:
        return _envelope_response(fail("JOB_NOT_FOUND", "任务不存在", 404), 404)
    if job["stage"] == JobStage.DETECTING.value:
        return _envelope_response(
            fail("DETECTION_ALREADY_RUNNING", "检测正在进行中", 409), 409
        )

    yolo_conf = payload.yolo_conf

    runner = DetectionRunner(settings, storage, db)
    async with _detect_lock:
        try:
            await runner.run(job_id, yolo_conf=yolo_conf)
        except VideoError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"检测执行失败: {exc}")

    updated = await db.get(job_id)
    return ok(_job_to_status(updated))


# ═══════════════════════════════════════════════════════════════════════
# 4. Submit generate — persists user selections; does NOT fake completion
# ═══════════════════════════════════════════════════════════════════════
@router.post("/jobs/{job_id}/generate")
async def submit_generate(
    job_id: str,
    payload: GenerateRequest,
    db: Annotated[TasksDB, Depends(get_tasks_db)],
):
    job = await db.get(job_id)
    if not job:
        return _envelope_response(fail("JOB_NOT_FOUND", "任务不存在", 404), 404)

    if job["stage"] != JobStage.DETECTED.value:
        return _envelope_response(
            fail(
                "INVALID_STAGE",
                f"只有 detected 状态的任务才能提交生成，当前 {job['stage']}",
                400,
            ),
            400,
        )

    data = job.get("data") or {}
    candidates = ((data.get("detection") or {}).get("candidates")) or []
    valid_ids = {c.get("person_id") for c in candidates}
    if payload.source_person_id not in valid_ids:
        return _envelope_response(
            fail("INVALID_SOURCE_PERSON", "source_person_id 不在候选列表中", 400),
            400,
        )

    if not payload.target_reference_url:
        return _envelope_response(
            fail("MISSING_REFERENCE", "必须先上传 replacement character 参考图", 400),
            400,
        )

    await db.update(
        job_id,
        stage=JobStage.QUEUED,
        progress=0.0,
        message="任务参数已保存，正在入队等待执行…",
        data_patch={
            "source_person_id": payload.source_person_id,
            "target_reference_url": payload.target_reference_url,
            "advanced": {
                "yolo_conf": payload.yolo_conf,
                "sam2_size": payload.sam2_size,
                "mask_dilation_px": payload.mask_dilation_px,
                "mask_blur_px": payload.mask_blur_px,
                "sample_steps": payload.sample_steps,
                "sample_size": payload.sample_size,
                "inference_fps": payload.inference_fps,
                "max_frame_num": payload.max_frame_num,
                "base_seed": payload.base_seed,
            },
            "prompt": payload.prompt,
        },
    )

    # Enqueue the actual replacement pipeline — the worker loop will pick it up.
    await enqueue_replace(job_id)

    updated = await db.get(job_id)
    return ok(_job_to_status(updated))


# ═══════════════════════════════════════════════════════════════════════
# 5. Job status query
# ═══════════════════════════════════════════════════════════════════════
@router.get("/jobs/{job_id}")
async def get_job(
    job_id: str,
    db: Annotated[TasksDB, Depends(get_tasks_db)],
):
    job = await db.get(job_id)
    if not job:
        return _envelope_response(fail("JOB_NOT_FOUND", "任务不存在", 404), 404)
    return ok(_job_to_status(job))


# ═══════════════════════════════════════════════════════════════════════
# 6. SSE stream
# ═══════════════════════════════════════════════════════════════════════
@router.get("/jobs/{job_id}/stream")
async def stream_job(
    job_id: str,
    db: Annotated[TasksDB, Depends(get_tasks_db)],
):
    async def event_gen():
        last_snapshot = None
        while True:
            job = await db.get(job_id)
            if not job:
                yield {"event": "error", "data": json.dumps({"message": "job not found"})}
                return

            status = _job_to_status(job)
            serialised = json.dumps(status, default=str)
            if serialised != last_snapshot:
                yield {"event": "status", "data": serialised}
                last_snapshot = serialised

            if job["stage"] in (
                JobStage.SUCCEEDED.value,
                JobStage.FAILED.value,
                JobStage.CANCELLED.value,
            ):
                yield {"event": "complete", "data": serialised}
                return

            await asyncio.sleep(1.2)

    return EventSourceResponse(event_gen())


# ──────────────────────────────────────────────────────────────────────
# helpers
# ──────────────────────────────────────────────────────────────────────
def _job_to_status(job_row: dict) -> dict:
    data = job_row.get("data") or {}
    return JobStatus(
        job_id=job_row["job_id"],
        stage=job_row["stage"],
        progress=float(job_row.get("progress") or 0.0),
        message=job_row.get("message"),
        error=job_row.get("error"),
        created_at=job_row["created_at"],
        updated_at=job_row["updated_at"],
        source_video_url=data.get("video_url"),
        thumbnail_url=data.get("thumbnail_url"),
        meta=data.get("meta"),
        detection=data.get("detection"),
        source_person_id=data.get("source_person_id"),
        target_reference_url=data.get("target_reference_url"),
        advanced=data.get("advanced"),
        mask_preview_url=data.get("mask_preview_url"),
        result_video_url=data.get("result_video_url"),
        result_download_url=data.get("result_download_url"),
        raw_result_video_url=data.get("raw_result_video_url"),
        final_result_video_url=data.get("final_result_video_url"),
        final_result_download_url=data.get("final_result_download_url"),
        mode=data.get("mode"),
        tracker_backend=data.get("tracker_backend"),
        replacer_backend=data.get("replacer_backend"),
    ).model_dump(mode="json")
