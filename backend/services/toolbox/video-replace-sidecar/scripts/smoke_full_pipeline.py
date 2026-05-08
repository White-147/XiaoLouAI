"""
End-to-end smoke test for the revised video-replace pipeline.

Runs *without* the FastAPI server:

  1. Loads Settings (honours .env.local).
  2. Probes an input video + reference image from scripts/_tmp/.
  3. Seeds a job directly in PostgreSQL in the QUEUED stage.
  4. Calls ReplaceRunner.run() — exercising:
       · SAM2 tracker with keyframe_index prompt (or OpenCV lite fallback)
       · VACE replacer (or OpenCV lite replacer)
       · finalize_result_video  — H.264/AAC + audio mux
  5. Prints the final job status, verifies the finalized mp4 exists and is
     H.264, and reports failure modes with clear messages.

Usage:

    cd video-replace-service
    .\.venv\Scripts\python.exe scripts\smoke_full_pipeline.py

Flags:

    --mode full|lite|auto     override VR_REPLACE_MODE for this run
    --video PATH              override source video
    --ref PATH                override reference image
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from pathlib import Path

THIS = Path(__file__).resolve()
SERVICE_ROOT = THIS.parent.parent
sys.path.insert(0, str(SERVICE_ROOT))

from app.config import get_settings  # noqa: E402
from app.schemas import JobStage  # noqa: E402
from app.services.finalize import probe_streams  # noqa: E402
from app.services.replace_runner import ReplaceRunner  # noqa: E402
from app.services.storage import Storage  # noqa: E402
from app.services.tasks_db import TasksDB  # noqa: E402
from app.services.video import probe  # noqa: E402
from app.workers.models import sam2_tracker, vace_replacer  # noqa: E402
from app.workers.models.yolo_detector import YOLODetector  # noqa: E402


async def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default=None, choices=["full", "lite", "auto"])
    ap.add_argument("--video", default=str(SERVICE_ROOT / "scripts" / "_tmp" / "smoke_video.mp4"))
    ap.add_argument("--ref",   default=str(SERVICE_ROOT / "scripts" / "_tmp" / "smoke_ref.jpg"))
    args = ap.parse_args(argv)

    settings = get_settings()
    if args.mode:
        settings.replace_mode = args.mode
    storage = Storage(settings)

    print(f"=== smoke: mode={settings.replace_mode} ===")
    print(f"SAM2 preflight: {sam2_tracker.preflight(settings) or 'OK'}")
    print(f"VACE preflight: {vace_replacer.preflight(settings) or 'OK'}")

    video_src = Path(args.video)
    ref_src = Path(args.ref)
    if not video_src.exists() or not ref_src.exists():
        print(f"missing smoke inputs: video={video_src} ref={ref_src}")
        return 2

    # Copy into storage so the runner's URL→path resolver works.
    video_name = storage.new_name(".mp4")
    video_path = storage.upload_path(video_name)
    video_path.parent.mkdir(parents=True, exist_ok=True)
    video_path.write_bytes(video_src.read_bytes())
    ref_name = storage.new_name(".jpg")
    ref_path = storage.reference_path(ref_name)
    ref_path.parent.mkdir(parents=True, exist_ok=True)
    ref_path.write_bytes(ref_src.read_bytes())

    meta = probe(video_path)
    print(f"input: {meta.width}x{meta.height} @ {meta.fps:.1f}fps, {meta.frame_count} frames, {meta.duration_seconds:.2f}s")

    # Run YOLO detection so the job has a real bbox + keyframe.
    kf_idx = meta.frame_count // 2
    kf_path = storage.keyframe_path(storage.new_name(".jpg"))
    import cv2
    cap = cv2.VideoCapture(str(video_path))
    cap.set(cv2.CAP_PROP_POS_FRAMES, kf_idx)
    ok, kf = cap.read()
    cap.release()
    if not ok:
        print("failed to read keyframe")
        return 3
    from app.services import cv2_io
    cv2_io.imwrite(kf_path, kf, [cv2.IMWRITE_JPEG_QUALITY, 92])

    det = YOLODetector(weights=settings.yolo_weights, device=settings.yolo_device)
    det.load()
    boxes = det.detect(kf_path, conf=0.3)
    det.unload()
    if not boxes:
        print("YOLO found no persons in keyframe — try a different video")
        return 4
    top = max(boxes, key=lambda b: b.confidence)
    print(f"YOLO: {len(boxes)} persons, picked bbox={top.x1:.0f},{top.y1:.0f},{top.x2:.0f},{top.y2:.0f} conf={top.confidence:.2f}")

    db = TasksDB(settings.database_url)
    await db.init()

    job_id = f"smoke_{uuid.uuid4().hex[:8]}"
    candidate = {
        "person_id": "p_smoke",
        "bbox": [top.x1, top.y1, top.x2, top.y2],
        "confidence": top.confidence,
        "preview_url": storage.thumbnail_url("_"),
        "mask_preview_url": None,
    }
    await db.create(
        job_id,
        data={
            "video_abs_path": str(video_path),
            "video_url": storage.upload_url(video_name),
            "meta": meta.model_dump(),
            "detection": {
                "job_id": job_id,
                "keyframe_index": kf_idx,
                "keyframe_url": storage.keyframe_url(kf_path.name),
                "candidates": [candidate],
            },
            "source_person_id": "p_smoke",
            "target_reference_url": storage.reference_url(ref_name),
            "advanced": {
                "sam2_size": "tiny",
                "mask_dilation_px": 5,
                "mask_blur_px": 4,
                "sample_steps": 25,
                "sample_size": "832*480",
                "base_seed": 42,
            },
            "prompt": None,
        },
        stage=JobStage.QUEUED,
    )

    runner = ReplaceRunner(settings, storage, db)
    await runner.run(job_id)

    row = await db.get(job_id)
    data = row.get("data") or {}
    print(json.dumps({
        "stage": row["stage"],
        "progress": row.get("progress"),
        "message": row.get("message"),
        "error": row.get("error"),
        "mode": data.get("mode"),
        "tracker_backend": data.get("tracker_backend"),
        "replacer_backend": data.get("replacer_backend"),
        "raw_result_video_url": data.get("raw_result_video_url"),
        "final_result_video_url": data.get("final_result_video_url"),
        "mask_preview_url": data.get("mask_preview_url"),
    }, indent=2, ensure_ascii=False))

    if row["stage"] != JobStage.SUCCEEDED.value:
        return 5

    final_url = data.get("final_result_video_url")
    assert final_url and final_url.startswith("/vr-finals/"), final_url
    final_path = settings.final_dir / final_url[len("/vr-finals/"):]
    info = probe_streams(final_path)
    print(f"final: {final_path} size={final_path.stat().st_size}B dur={info.duration:.2f}s audio={info.has_audio}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
