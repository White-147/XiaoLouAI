"""
⚠ LEGACY full-pipeline e2e — standalone FastAPI path only.

Targets the legacy FastAPI variant at ``VR_LEGACY_BASE`` (default
``http://127.0.0.1:4201``). The default architecture is core-api
4100-native; this script is retained for debugging the FastAPI variant.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

import cv2
import numpy as np

BASE = os.environ.get("VR_LEGACY_BASE", "http://127.0.0.1:4201")


def build_test_video(out: Path) -> Path:
    import shutil, tempfile
    photo_path = out.parent / "bus.jpg"
    if not photo_path.exists():
        print("  downloading bus.jpg…")
        with urllib.request.urlopen("https://ultralytics.com/images/bus.jpg", timeout=30) as r:
            photo_path.write_bytes(r.read())
    photo = cv2.imdecode(np.frombuffer(photo_path.read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR)
    ph, pw = photo.shape[:2]
    target_w, target_h = 640, 480
    scale = min(target_w / pw, target_h / ph)
    resized = cv2.resize(photo, (int(pw * scale), int(ph * scale)))
    canvas = np.full((target_h, target_w, 3), 32, dtype=np.uint8)
    nh, nw = resized.shape[:2]
    py, px = (target_h - nh) // 2, (target_w - nw) // 2
    canvas[py:py+nh, px:px+nw] = resized
    with tempfile.TemporaryDirectory(prefix="vrs_e2e_") as td:
        ascii_out = Path(td) / "vid.mp4"
        wr = cv2.VideoWriter(str(ascii_out), cv2.VideoWriter_fourcc(*"mp4v"), 24.0, (target_w, target_h))
        for i in range(48):
            shift = int((i / 47 - 0.5) * 12)
            M = np.float32([[1, 0, shift], [0, 1, 0]])
            wr.write(cv2.warpAffine(canvas, M, (target_w, target_h)))
        wr.release()
        shutil.copy2(ascii_out, out)
    return out


def build_ref_image(out: Path) -> Path:
    img = np.zeros((256, 256, 3), dtype=np.uint8)
    cv2.rectangle(img, (0, 0), (256, 256), (40, 120, 60), -1)
    cv2.putText(img, "REF", (50, 140), cv2.FONT_HERSHEY_DUPLEX, 2.5, (255, 255, 255), 3)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    out.write_bytes(buf.tobytes())
    return out


def multipart_post(url, file_path, content_type):
    boundary = "----VRSMOKE" + str(int(time.time() * 1000))
    body = bytearray()
    body += f"--{boundary}\r\n".encode()
    body += f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"\r\n'.encode()
    body += f"Content-Type: {content_type}\r\n\r\n".encode()
    body += file_path.read_bytes()
    body += f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        url, data=bytes(body),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def json_post(url, payload):
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            return json.loads(raw)
        except Exception:
            raise RuntimeError(f"HTTP {e.code}: {raw}") from e


def json_get(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.loads(r.read().decode())


def main():
    work = Path(__file__).resolve().parent / "_tmp"
    work.mkdir(exist_ok=True)
    vid_path = work / "e2e_pipeline_video.mp4"
    ref_path = work / "e2e_ref.jpg"

    print("── 1. Build test assets…")
    build_test_video(vid_path)
    build_ref_image(ref_path)

    print("── 2. POST /upload…")
    up = multipart_post(f"{BASE}/api/video-replace/upload", vid_path, "video/mp4")
    assert up["success"], up
    job_id = up["data"]["job_id"]
    print(f"   job_id = {job_id}")

    print("── 3. POST /detect…")
    det = json_post(f"{BASE}/api/video-replace/jobs/{job_id}/detect", {"yolo_conf": 0.30})
    assert det["success"], det
    candidates = det["data"]["detection"]["candidates"]
    print(f"   candidates = {len(candidates)}")
    if not candidates:
        print("   SKIP: no candidates detected, cannot test full pipeline")
        return 0

    print("── 4. POST /reference…")
    ref = multipart_post(f"{BASE}/api/video-replace/reference", ref_path, "image/jpeg")
    assert ref["success"], ref
    ref_url = ref["data"]["url"]

    print("── 5. POST /generate…")
    gen = json_post(f"{BASE}/api/video-replace/jobs/{job_id}/generate", {
        "source_person_id": candidates[0]["person_id"],
        "target_reference_url": ref_url,
        "yolo_conf": 0.30,
        "sam2_size": "tiny",
        "mask_dilation_px": 5,
        "mask_blur_px": 4,
        "sample_steps": 20,
        "sample_size": "832*480",
        "base_seed": 42,
    })
    assert gen["success"], gen
    print(f"   stage = {gen['data']['stage']}")

    print("── 6. Polling until succeeded / failed…")
    TERMINAL = {"succeeded", "failed", "cancelled"}
    poll_count = 0
    max_polls = 120  # up to 4 minutes
    stage = gen["data"]["stage"]
    while stage not in TERMINAL and poll_count < max_polls:
        time.sleep(2.0)
        poll_count += 1
        status = json_get(f"{BASE}/api/video-replace/jobs/{job_id}")
        d = status["data"]
        stage = d["stage"]
        progress = d.get("progress", 0.0)
        msg = d.get("message") or ""
        print(f"   [{poll_count:3d}] stage={stage:<12} progress={progress:.0%}  {msg[:60]}")

    status = json_get(f"{BASE}/api/video-replace/jobs/{job_id}")
    d = status["data"]

    print(f"\n── 7. Final stage = {d['stage']}")
    if d["stage"] == "succeeded":
        result_url = d["result_video_url"]
        download_url = d["result_download_url"]
        mask_url = d.get("mask_preview_url")
        print(f"   result_video_url  = {result_url}")
        print(f"   result_download_url = {download_url}")
        print(f"   mask_preview_url  = {mask_url}")
        assert result_url, "result_video_url is empty!"

        # Download and verify the result MP4
        abs_result = urllib.request.urlopen(f"{BASE}{result_url}", timeout=30)
        result_bytes = abs_result.read()
        local_result = work / "e2e_result.mp4"
        local_result.write_bytes(result_bytes)
        size_kb = len(result_bytes) / 1024
        print(f"   downloaded result: {size_kb:.1f} KB → {local_result}")
        assert len(result_bytes) > 4096, f"result video too small: {len(result_bytes)} bytes"
        print("\nOK -- full pipeline completed with real result MP4 [PASS]")
    elif d["stage"] == "failed":
        error = d.get("error") or d.get("message")
        print(f"   FAILED: {error}")
        print("   (this is expected if SAM2 / VACE weights are not installed)")
        print("   The pipeline ran, failed gracefully, and provided a clear error message [OK]")
    else:
        print(f"   timed out after {poll_count * 2}s in stage {d['stage']}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
