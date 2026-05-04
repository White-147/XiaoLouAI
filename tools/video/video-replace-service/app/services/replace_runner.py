"""
Replacement pipeline: queued → tracking → mask_ready → replacing → finalizing → succeeded.

Mode policy
───────────
`settings.replace_mode` is one of:

  * `"full"` (default) — require SAM2 for tracking *and* VACE/Wan2.1 for
    replacement. If either preflight fails the job fails with a clear error
    message naming the missing dependency / weight. No silent fallback.

  * `"lite"` — explicit debug mode. Forces OpenCV tracker + OpenCV compositor
    regardless of whether the full-mode prerequisites are available. The
    surfaced `mode="lite"` flag lets the UI badge the result so the user is
    never misled into believing this is real deep-learning output.

  * `"auto"` — legacy behaviour. Prefers full; silently falls back to lite
    when prerequisites are missing. Also tags the result `mode="lite"`.

All result videos pass through `finalize.py` for H.264/AAC transcoding and
audio re-injection. The final deliverable lives under /vr-finals/ and is
what the frontend plays/downloads; the raw pipeline output is kept under
/vr-results/ for debugging and exposed via `raw_result_video_url`.
"""
from __future__ import annotations

import asyncio
import gc
import logging
import time
from pathlib import Path

from ..config import Settings
from ..schemas import JobStage
from ..services.finalize import finalize_result_video, locate_ffmpeg
from ..services.storage import Storage
from ..services.tasks_db import TasksDB


def _release_parent_gpu_memory() -> None:
    """Force the FastAPI parent process to release cached CUDA memory before
    spawning a GPU-heavy child (VACE).

    On a 12 GB GPU the VACE cold-start needs ~11 GB, and PyTorch's caching
    allocator holds onto memory from prior SAM2/YOLO stages unless we
    explicitly drop the cache and IPC handles. Without this the child
    subprocess frequently exits with returncode=2 (silent OOM) on Windows.
    """
    try:
        import torch  # local import keeps CPU-only environments happy
        if torch.cuda.is_available():
            gc.collect()
            torch.cuda.empty_cache()
            # ipc_collect releases exported tensors so the CUDA driver can
            # actually reclaim the VRAM. Cheap no-op when nothing is shared.
            try:
                torch.cuda.ipc_collect()
            except Exception:
                pass
    except Exception:
        # Best-effort; never fail the job over bookkeeping.
        pass
from ..workers.gpu_lock import replace_lock
from ..workers.models import opencv_replacer, opencv_tracker, sam2_tracker, vace_replacer
from ..workers.queue import current_state as queue_state

logger = logging.getLogger(__name__)


# ── URL → absolute path helper ────────────────────────────────────────────


def _url_to_abs(url: str, settings: Settings) -> Path | None:
    """Convert a `/vr-*` URL to its absolute filesystem path."""
    mapping = {
        "/vr-uploads/":    settings.upload_dir,
        "/vr-references/": settings.reference_dir,
        "/vr-candidates/": settings.candidate_dir,
        "/vr-keyframes/":  settings.keyframe_dir,
        "/vr-masks/":      settings.mask_dir,
        "/vr-results/":    settings.result_dir,
        "/vr-finals/":     settings.final_dir,
        "/vr-thumbnails/": settings.thumbnail_dir,
    }
    for prefix, base_dir in mapping.items():
        if url.startswith(prefix):
            name = url[len(prefix):]
            return base_dir / name
    if url.startswith("/") and Path(url).exists():
        return Path(url)
    return None


# ── Mask preview (overlay on the detection keyframe) ──────────────────────


def _create_mask_preview(
    keyframe_path: Path,
    masks_dir: Path,
    preview_out: Path,
    keyframe_index: int,
) -> None:
    """Overlay the mask that corresponds to the detection keyframe in red."""
    import cv2
    import numpy as np

    from . import cv2_io

    frame = cv2_io.imread(keyframe_path)
    if frame is None:
        return

    # Prefer the mask for the actual keyframe (1-based filename indexing).
    candidate = masks_dir / f"frame_{keyframe_index + 1:06d}.png"
    if not candidate.exists():
        # Fall back to the first non-empty mask we can find.
        for f in sorted(masks_dir.glob("frame_*.png")):
            if f.stat().st_size > 256:
                candidate = f
                break

    if not candidate.exists():
        return

    mask = cv2_io.imread(candidate, cv2.IMREAD_GRAYSCALE)
    if mask is None:
        return

    h, w = frame.shape[:2]
    if mask.shape != (h, w):
        mask = cv2.resize(mask, (w, h))

    overlay = frame.copy()
    overlay[mask > 127] = overlay[mask > 127] * 0.4 + np.array([0, 0, 180]) * 0.6
    overlay = overlay.astype(np.uint8)
    cv2_io.imwrite(preview_out, overlay, [cv2.IMWRITE_JPEG_QUALITY, 85])


# ── Main runner ───────────────────────────────────────────────────────────


class ReplaceRunner:
    """Orchestrates the full video replacement pipeline for one job at a time."""

    def __init__(self, settings: Settings, storage: Storage, db: TasksDB) -> None:
        self.settings = settings
        self.storage = storage
        self.db = db

    async def run_queued(self, job_id: str) -> None:
        """Drive a job that is in the ``queued`` stage through the full
        tracking → mask_ready → replacing → succeeded pipeline.

        This is the entry point used by both the legacy 4200 worker loop
        (in-process) and the default 4100-native ``vr_pipeline_cli.py``
        subprocess launcher. It used to be called ``run`` — the new name
        makes the contract explicit (only QUEUED jobs are accepted) and
        matches the CLI so the ``AttributeError: no attribute run_queued``
        crash from the previous revision can't come back.
        """
        await self._run(job_id)

    # Legacy alias: the 4200 FastAPI queue worker still calls `.run`.
    # Keep it so the legacy debug path continues to compile. The canonical
    # name is `run_queued`.
    async def run(self, job_id: str) -> None:
        await self._run(job_id)

    async def _run(self, job_id: str) -> None:
        job = await self.db.get(job_id)
        if not job:
            logger.error("[replace-runner] job %s not found", job_id)
            return

        if job["stage"] != JobStage.QUEUED.value:
            logger.warning(
                "[replace-runner] job %s is in stage %s, expected queued — skipping",
                job_id, job["stage"],
            )
            return

        data = job.get("data") or {}

        video_abs_raw = data.get("video_abs_path") or ""
        video_path = Path(video_abs_raw) if video_abs_raw else None
        if video_path is None or not video_path.exists():
            await self._fail(job_id, "源视频文件不存在，请重新上传")
            return

        source_person_id = data.get("source_person_id")
        target_ref_url = data.get("target_reference_url") or ""
        advanced = data.get("advanced") or {}
        detection = data.get("detection") or {}
        candidates = detection.get("candidates") or []
        keyframe_url = detection.get("keyframe_url") or ""
        keyframe_index = int(detection.get("keyframe_index") or 0)

        person = next(
            (c for c in candidates if c.get("person_id") == source_person_id), None,
        )
        if person is None:
            await self._fail(job_id, f"无法找到 source_person_id={source_person_id} 对应的候选人物")
            return

        bbox = person.get("bbox") or []
        if len(bbox) < 4:
            await self._fail(job_id, "候选人物 bbox 数据不完整")
            return

        ref_path = _url_to_abs(target_ref_url, self.settings)
        if ref_path is None or not ref_path.exists():
            if target_ref_url.startswith("/vr-references/"):
                ref_path = self.settings.reference_dir / target_ref_url[len("/vr-references/"):]
            if ref_path is None or not ref_path.exists():
                await self._fail(job_id, f"参考图文件不存在: {target_ref_url}")
                return

        kf_path: Path | None = None
        if keyframe_url:
            kf_path = _url_to_abs(keyframe_url, self.settings)
            if kf_path and not kf_path.exists():
                kf_path = None

        sam2_size = str(advanced.get("sam2_size", self.settings.sam2_size_default))
        mask_dilation_px = int(advanced.get("mask_dilation_px", 5))
        mask_blur_px = int(advanced.get("mask_blur_px", 4))
        sample_steps = int(advanced.get("sample_steps", 12))
        sample_size = str(advanced.get("sample_size", "832*480"))
        inference_fps = int(advanced.get("inference_fps", 15))
        max_frame_num = int(advanced.get("max_frame_num", 21))
        base_seed = advanced.get("base_seed")
        if base_seed is not None:
            base_seed = int(base_seed)
        prompt = data.get("prompt") or None

        async with replace_lock:
            await self._run_pipeline(
                job_id=job_id,
                video_path=video_path,
                bbox=bbox,
                ref_path=ref_path,
                kf_path=kf_path,
                keyframe_index=keyframe_index,
                sam2_size=sam2_size,
                mask_dilation_px=mask_dilation_px,
                mask_blur_px=mask_blur_px,
                sample_steps=sample_steps,
                sample_size=sample_size,
                inference_fps=inference_fps,
                max_frame_num=max_frame_num,
                base_seed=base_seed,
                prompt=prompt,
            )

    # ── Internal pipeline ─────────────────────────────────────────────

    async def _run_pipeline(
        self,
        *,
        job_id: str,
        video_path: Path,
        bbox: list[float],
        ref_path: Path,
        kf_path: Path | None,
        keyframe_index: int,
        sam2_size: str,
        mask_dilation_px: int,
        mask_blur_px: int,
        sample_steps: int,
        sample_size: str,
        inference_fps: int,
        max_frame_num: int,
        base_seed: int | None,
        prompt: str | None,
    ) -> None:
        replace_mode = (self.settings.replace_mode or "full").lower()

        # ── 0. Preflight both backends up front ────────────────────────
        sam2_error = sam2_tracker.preflight(self.settings)
        vace_error = vace_replacer.preflight(self.settings)

        # Decide tracker backend.
        if replace_mode == "full":
            if sam2_error:
                await self._fail(
                    job_id,
                    "full mode 要求 SAM2 可用，但检测到缺失：\n" + sam2_error
                    + "\n\n你可以：\n"
                    "  1) 修复依赖/权重后重试\n"
                    "  2) 在 .env.local 设置 VR_REPLACE_MODE=lite 使用 OpenCV 降级路径（仅调试用）",
                )
                return
            use_lite_track = False
        elif replace_mode == "lite":
            use_lite_track = True
        else:  # auto
            use_lite_track = sam2_error is not None

        if replace_mode == "full":
            if vace_error:
                await self._fail(
                    job_id,
                    "full mode 要求 VACE/Wan2.1 可用，但检测到缺失：\n" + vace_error
                    + "\n\n你可以：\n"
                    "  1) 修复仓库/权重后重试\n"
                    "  2) 在 .env.local 设置 VR_REPLACE_MODE=lite 使用 OpenCV 降级路径（仅调试用）",
                )
                return
            use_lite_replace = False
        elif replace_mode == "lite":
            use_lite_replace = True
        else:  # auto
            use_lite_replace = vace_error is not None

        tracker_label = "OpenCV-CSRT(lite)" if use_lite_track else "SAM2"
        replacer_label = "OpenCV(lite)" if use_lite_replace else "VACE/Wan2.1"
        effective_mode = "lite" if (use_lite_track or use_lite_replace) else "full"

        # ── 1. TRACKING ────────────────────────────────────────────────
        await self.db.update(
            job_id,
            stage=JobStage.TRACKING,
            progress=0.05,
            message=f"开始视频人物追踪 [{tracker_label}] key={keyframe_index}",
            data_patch={
                "mode": effective_mode,
                "tracker_backend": tracker_label,
                "replacer_backend": replacer_label,
            },
        )

        masks_dir = self.settings.mask_dir / job_id
        masks_dir.mkdir(parents=True, exist_ok=True)

        # Progress heartbeat for the blocking tracking thread.
        # SAM2 / OpenCV CSRT run inside asyncio.to_thread and produce no async
        # progress updates themselves. We estimate progress from elapsed wall
        # time against a typical processing duration so the UI stays responsive.
        _track_start = time.monotonic()
        _TRACK_EST_SECS = 90.0  # median for a 10-15 s 480p clip

        async def _tracking_heartbeat() -> None:
            while True:
                await asyncio.sleep(3)
                elapsed = time.monotonic() - _track_start
                frac = min(elapsed / _TRACK_EST_SECS, 0.95)
                # Map 0 → 0.95 to 6 % → 44 % (bucket owned by tracking stage)
                progress = 0.06 + frac * 0.38
                try:
                    await self.db.update(job_id, progress=progress)
                except Exception:
                    pass

        _tracking_hb = asyncio.create_task(
            _tracking_heartbeat(), name="tracking-heartbeat"
        )
        _track_exc: Exception | None = None
        try:
            if use_lite_track:
                await asyncio.to_thread(
                    opencv_tracker.run_tracking,
                    video_path, bbox, masks_dir,
                    keyframe_index=keyframe_index,
                    mask_dilation_px=mask_dilation_px,
                    mask_blur_px=mask_blur_px,
                )
            else:
                await asyncio.to_thread(
                    sam2_tracker.run_tracking,
                    video_path, bbox, masks_dir,
                    keyframe_index=keyframe_index,
                    sam2_size=sam2_size,
                    mask_dilation_px=mask_dilation_px,
                    mask_blur_px=mask_blur_px,
                    settings=self.settings,
                )
        except Exception as exc:  # noqa: BLE001
            _track_exc = exc
        finally:
            _tracking_hb.cancel()
            try:
                await _tracking_hb
            except BaseException:
                pass

        if _track_exc is not None:
            logger.exception("[replace-runner] tracking failed")
            await self._fail(job_id, f"追踪阶段失败 [{tracker_label}]: {_track_exc}")
            return

        mask_files = sorted(masks_dir.glob("frame_*.png"))
        if not mask_files:
            await self._fail(job_id, f"追踪完成但未生成任何 mask 帧: {masks_dir}")
            return

        # ── 2. MASK_READY (build preview using the keyframe's mask) ────
        preview_name = f"{job_id}_preview.jpg"
        preview_path = self.settings.mask_dir / preview_name
        if kf_path and kf_path.exists():
            try:
                await asyncio.to_thread(
                    _create_mask_preview, kf_path, masks_dir, preview_path, keyframe_index,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("[replace-runner] mask preview failed (non-fatal): %s", exc)

        mask_preview_url = self.storage.mask_url(preview_name) if preview_path.exists() else None

        await self.db.update(
            job_id,
            stage=JobStage.MASK_READY,
            progress=0.45,
            message=f"遮罩生成完成，共 {len(mask_files)} 帧 [{tracker_label}]",
            data_patch={"mask_preview_url": mask_preview_url},
        )

        # ── 3. REPLACING (raw output) ──────────────────────────────────
        await self.db.update(
            job_id,
            stage=JobStage.REPLACING,
            progress=0.55,
            message=f"开始生成替换视频 [{replacer_label}]…",
        )

        raw_name = self.storage.new_name(".mp4")
        raw_path = self.settings.result_dir / raw_name

        try:
            if use_lite_replace:
                await asyncio.to_thread(
                    opencv_replacer.run_replacement,
                    video_path, masks_dir, ref_path, raw_path,
                )
            else:
                # Free cached VRAM held by SAM2/YOLO in the parent process so
                # the VACE subprocess can allocate ~11 GB on a 12 GB card.
                await asyncio.to_thread(_release_parent_gpu_memory)
                logger.info("[replace-runner] released parent GPU cache before VACE spawn")

                # Persist the subprocess PID on the job record so a restart
                # of this service (or the lifespan shutdown hook) can kill a
                # hung Wan2.1 grandchild even if this coroutine disappears.
                async def _record_pid(pid: int) -> None:
                    queue_state.set_active_pid(pid)
                    try:
                        await self.db.update(
                            job_id,
                            data_patch={"subprocess_pid": int(pid)},
                            message=f"VACE 子进程已启动 (pid={pid})",
                        )
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("[replace-runner] could not persist pid=%s: %s", pid, exc)

                async def _report_vace_progress(progress_val: float) -> None:
                    """Forward per-step VACE progress to the database."""
                    try:
                        await self.db.update(job_id, progress=progress_val)
                    except Exception as exc:  # noqa: BLE001
                        logger.debug("[replace-runner] progress update failed: %s", exc)

                async def _report_vace_message(msg: str) -> None:
                    """Forward per-step VACE ETA message to the database."""
                    try:
                        await self.db.update(job_id, message=msg)
                    except Exception as exc:  # noqa: BLE001
                        logger.debug("[replace-runner] message update failed: %s", exc)

                await vace_replacer.run_replacement_async(
                    video_path, masks_dir, ref_path, raw_path,
                    settings=self.settings,
                    sample_steps=sample_steps,
                    sample_size=sample_size,
                    inference_fps=inference_fps,
                    max_frame_num=max_frame_num,
                    base_seed=base_seed,
                    prompt=prompt,
                    on_pid=_record_pid,
                    on_progress=_report_vace_progress,
                    on_message=_report_vace_message,
                )

                # Clear the PID now that the subprocess has exited cleanly —
                # otherwise a future restart might try to "reap" a PID that
                # has since been recycled by the OS to an unrelated process.
                try:
                    await self.db.update(job_id, data_patch={"subprocess_pid": None})
                except Exception:
                    pass
        except Exception as exc:  # noqa: BLE001
            logger.exception("[replace-runner] replacement failed")
            try:
                await self.db.update(job_id, data_patch={"subprocess_pid": None})
            except Exception:
                pass
            await self._fail(job_id, f"替换阶段失败 [{replacer_label}]: {exc}")
            return

        raw_url = self.storage.result_url(raw_name)

        # ── 4. FINALIZE (browser-compat transcode + audio mux) ─────────
        await self.db.update(
            job_id,
            stage=JobStage.REPLACING,
            progress=0.90,
            message="后处理：H.264/AAC 转码并回灌原音频…",
        )

        final_name = self.storage.new_name(".mp4")
        final_path = self.settings.final_dir / final_name

        try:
            await asyncio.to_thread(
                finalize_result_video,
                raw_result=raw_path,
                source_video=video_path,
                final_out=final_path,
                preset=self.settings.finalize_video_preset,
                crf=self.settings.finalize_video_crf,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("[replace-runner] finalize failed")
            await self._fail(
                job_id,
                f"最终封装失败 [ffmpeg]: {exc}\n"
                f"ffmpeg binary: {_safe_ffmpeg_path()}",
            )
            return

        final_url = self.storage.final_url(final_name)

        # ── 5. SUCCEEDED ───────────────────────────────────────────────
        if effective_mode == "full":
            final_message = f"视频人物替换完成！[full mode · {tracker_label} + {replacer_label}]"
        else:
            hints = []
            if use_lite_track and sam2_error:
                hints.append(f"SAM2 缺失: {sam2_error.splitlines()[0]}")
            if use_lite_replace and vace_error:
                hints.append(f"VACE 缺失: {vace_error.splitlines()[0]}")
            hint_suffix = ("：" + "；".join(hints)) if hints else ""
            final_message = (
                f"[lite/调试模式] 已生成占位结果（仅演示遮罩追踪 + 贴图合成，非真实深度学习替换）{hint_suffix}"
            )

        await self.db.update(
            job_id,
            stage=JobStage.SUCCEEDED,
            progress=1.0,
            message=final_message,
            data_patch={
                # Legacy fields (aliased to the final deliverable so existing UI works).
                "result_video_url": final_url,
                "result_download_url": final_url,
                # New dual-track fields.
                "raw_result_video_url": raw_url,
                "final_result_video_url": final_url,
                "final_result_download_url": final_url,
                "mask_preview_url": mask_preview_url,
                "mode": effective_mode,
                "tracker_backend": tracker_label,
                "replacer_backend": replacer_label,
            },
        )
        logger.info(
            "[replace-runner] job %s succeeded → %s (mode=%s)",
            job_id, final_url, effective_mode,
        )

    # ── Error helper ──────────────────────────────────────────────────

    async def _fail(self, job_id: str, error: str) -> None:
        logger.error("[replace-runner] job %s FAILED: %s", job_id, error)
        await self.db.update(
            job_id,
            stage=JobStage.FAILED,
            error=error,
            message="任务执行失败，请查看错误详情",
        )


def _safe_ffmpeg_path() -> str:
    try:
        return locate_ffmpeg()
    except Exception as exc:
        return f"<unresolved: {exc}>"
