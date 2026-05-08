"""
Pipeline orchestration for the video-replace MVP.

Only stage currently implemented end-to-end:
  uploaded → detecting → detected   (real YOLOv8 person detection)

After /generate is called we transition to `queued` and stop. SAM2 tracking
and VACE replacement are out of scope for the MVP deliverable and are not
faked to `succeeded` — the UI shows the true queued state.
"""
from __future__ import annotations

import asyncio
import uuid
from pathlib import Path

from ..config import Settings
from ..schemas import JobStage, PersonCandidate
from ..services.storage import Storage
from ..services.tasks_db import TasksDB
from ..services.video import (
    VideoError,
    choose_keyframe_index,
    crop_and_save,
    extract_frame,
)
from ..workers.models.yolo_detector import YOLODetector, YOLODetectorError


class DetectionRunner:
    """Runs real YOLOv8 detection on the stored source video for a job.

    Single-machine policy: only one detection runs at a time. Callers must
    acquire the `gpu_lock` before invoking `run()`.
    """

    def __init__(self, settings: Settings, storage: Storage, db: TasksDB) -> None:
        self.settings = settings
        self.storage = storage
        self.db = db

    async def run(self, job_id: str, yolo_conf: float | None = None) -> list[PersonCandidate]:
        job = await self.db.get(job_id)
        if not job:
            raise LookupError(f"job {job_id} not found")

        data = job.get("data") or {}
        video_abs = data.get("video_abs_path")
        meta = data.get("meta") or {}
        if not video_abs or not Path(video_abs).exists():
            raise VideoError("源视频文件已丢失，请重新上传")

        await self.db.update(
            job_id,
            stage=JobStage.DETECTING,
            progress=0.1,
            message="正在提取关键帧",
        )

        frame_count = int(meta.get("frame_count") or 0)
        kf_idx = choose_keyframe_index(frame_count, self.settings.detection_keyframe)

        kf_name = self.storage.new_name(".jpg")
        kf_path = self.storage.keyframe_path(kf_name)
        try:
            extract_frame(Path(video_abs), kf_idx, kf_path)
        except VideoError as exc:
            await self.db.update(
                job_id, stage=JobStage.FAILED, error=str(exc), message="关键帧提取失败"
            )
            raise

        await self.db.update(
            job_id,
            progress=0.35,
            message="正在运行 YOLOv8 人物检测",
            data_patch={"keyframe_url": self.storage.keyframe_url(kf_name)},
        )

        # Real YOLOv8 inference (blocking — runs in threadpool).
        try:
            boxes = await asyncio.to_thread(
                _run_yolo_sync,
                kf_path,
                self.settings.yolo_weights,
                self.settings.yolo_device,
                float(yolo_conf if yolo_conf is not None else self.settings.yolo_conf_default),
            )
        except YOLODetectorError as exc:
            await self.db.update(
                job_id,
                stage=JobStage.FAILED,
                error=str(exc),
                message="YOLOv8 检测失败",
            )
            raise

        # Crop each detection as a preview thumbnail
        candidates: list[PersonCandidate] = []
        for box in boxes:
            person_id = f"p_{uuid.uuid4().hex[:8]}"
            crop_name = self.storage.new_name(".jpg")
            crop_path = self.storage.candidate_path(crop_name)
            try:
                crop_and_save(
                    kf_path,
                    (box.x1, box.y1, box.x2, box.y2),
                    crop_path,
                    short_edge=self.settings.candidate_preview_short_edge,
                )
            except VideoError:
                # Skip unreadable crops rather than failing the whole job
                continue

            candidates.append(
                PersonCandidate(
                    person_id=person_id,
                    bbox=[box.x1, box.y1, box.x2, box.y2],
                    confidence=round(box.confidence, 4),
                    preview_url=self.storage.candidate_url(crop_name),
                    mask_preview_url=None,
                )
            )

        await self.db.update(
            job_id,
            stage=JobStage.DETECTED,
            progress=1.0,
            message=(
                f"已识别 {len(candidates)} 位候选人物"
                if candidates
                else "未在关键帧中检测到人物，请更换视频或降低检测阈值"
            ),
            data_patch={
                "detection": {
                    "job_id": job_id,
                    "keyframe_index": kf_idx,
                    "keyframe_url": self.storage.keyframe_url(kf_name),
                    "candidates": [c.model_dump() for c in candidates],
                }
            },
        )

        return candidates


def _run_yolo_sync(
    image_path: Path,
    weights: str,
    device: str,
    conf: float,
):
    det = YOLODetector(weights=weights, device=device)
    try:
        det.load()
        return det.detect(image_path, conf=conf)
    finally:
        det.unload()
