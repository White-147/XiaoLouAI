"""
Revision-2 smoke test: verifies the new routes added in this pass.

  1. POST /api/video-replace/upload (baseline still works)
  2. POST /api/video-replace/jobs with video_url pointing to the same
     file served back via the /vr-uploads/ static endpoint (proves the
     asset-library-import path works end to end with an HTTP URL).
  3. POST /api/video-replace/jobs/{id}/detect  with custom yolo_conf
  4. POST /api/video-replace/reference-import
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import cv2
import numpy as np

import os
BASE = os.environ.get("VR_LEGACY_BASE", "http://127.0.0.1:4201")
# NOTE: this script targets the LEGACY standalone FastAPI path, not the
# default 4100-native core-api stack. See e2e_smoke.py header.


def build_test_video(out: Path) -> Path:
    """Reuse bus.jpg (ultralytics test image)."""
    import shutil
    import tempfile

    photo_path = out.parent / "bus.jpg"
    if not photo_path.exists():
        print(f"    downloading bus.jpg …")
        with urllib.request.urlopen(
            "https://ultralytics.com/images/bus.jpg", timeout=30
        ) as resp:
            photo_path.write_bytes(resp.read())

    photo = cv2.imdecode(
        np.frombuffer(photo_path.read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR
    )
    ph, pw = photo.shape[:2]
    target_w, target_h = 640, 480
    scale = min(target_w / pw, target_h / ph)
    resized = cv2.resize(photo, (int(pw * scale), int(ph * scale)))
    canvas = np.full((target_h, target_w, 3), 32, dtype=np.uint8)
    nh, nw = resized.shape[:2]
    py, px = (target_h - nh) // 2, (target_w - nw) // 2
    canvas[py : py + nh, px : px + nw] = resized

    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="vrsv2_") as td:
        ascii_out = Path(td) / "vid.mp4"
        wr = cv2.VideoWriter(
            str(ascii_out), cv2.VideoWriter_fourcc(*"mp4v"), 24.0, (target_w, target_h)
        )
        for i in range(48):
            shift = int((i / 47 - 0.5) * 12)
            M = np.float32([[1, 0, shift], [0, 1, 0]])
            wr.write(cv2.warpAffine(canvas, M, (target_w, target_h)))
        wr.release()
        shutil.copy2(ascii_out, out)
    return out


def build_test_image(out: Path) -> Path:
    img = np.zeros((256, 256, 3), dtype=np.uint8)
    cv2.rectangle(img, (0, 0), (256, 256), (40, 80, 150), -1)
    cv2.putText(img, "REF2", (40, 140), cv2.FONT_HERSHEY_DUPLEX, 2.0, (255, 255, 255), 3)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    out.write_bytes(buf.tobytes())
    return out


def multipart_post(url: str, file_path: Path, content_type: str):
    boundary = "----VRB" + str(int(time.time() * 1000))
    body = bytearray()
    body += f"--{boundary}\r\n".encode()
    body += (
        f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"\r\n'
    ).encode()
    body += f"Content-Type: {content_type}\r\n\r\n".encode()
    body += file_path.read_bytes()
    body += f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        url,
        data=bytes(body),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def json_post(url: str, payload: dict):
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            return json.loads(raw)
        except Exception:
            raise RuntimeError(f"HTTP {e.code}: {raw}") from e


def main() -> int:
    work = Path(__file__).resolve().parent / "_tmp"
    work.mkdir(exist_ok=True)
    vid_path = work / "v2_video.mp4"
    ref_path = work / "v2_ref.jpg"
    build_test_video(vid_path)
    build_test_image(ref_path)

    print("── 1. POST /upload …")
    up = multipart_post(f"{BASE}/api/video-replace/upload", vid_path, "video/mp4")
    assert up["success"], up
    video_url_rel = up["data"]["video_url"]  # e.g. /vr-uploads/abc.mp4
    print(f"    video_url_rel = {video_url_rel}")

    print("\n── 2. POST /jobs  (import from URL using full HTTP URL) …")
    import_abs_url = f"{BASE}{video_url_rel}"  # video-replace static also serves it
    imp = json_post(
        f"{BASE}/api/video-replace/jobs",
        {"video_url": import_abs_url, "original_filename": "imported.mp4"},
    )
    assert imp["success"], imp
    imp_job_id = imp["data"]["job_id"]
    print(f"    imported job_id = {imp_job_id}")
    print(f"    imported video_url = {imp['data']['video_url']}")

    print("\n── 3. POST /jobs/{id}/detect with yolo_conf=0.55 …")
    det = json_post(
        f"{BASE}/api/video-replace/jobs/{imp_job_id}/detect",
        {"yolo_conf": 0.55},
    )
    assert det["success"], det
    candidates = det["data"]["detection"]["candidates"]
    print(f"    candidates (conf=0.55) = {len(candidates)}")
    for c in candidates:
        print(
            f"       {c['person_id']}  conf={c['confidence']:.3f}  bbox={[round(x) for x in c['bbox']]}"
        )
    assert all(c["confidence"] >= 0.55 for c in candidates), "yolo_conf not enforced!"

    print("\n── 4. POST /jobs/{id}/detect with yolo_conf=0.25 (should widen net) …")
    det2 = json_post(
        f"{BASE}/api/video-replace/jobs/{imp_job_id}/detect",
        {"yolo_conf": 0.25},
    )
    candidates2 = det2["data"]["detection"]["candidates"]
    print(f"    candidates (conf=0.25) = {len(candidates2)}")
    assert len(candidates2) >= len(candidates), (
        "lower yolo_conf should yield >= candidates vs higher"
    )

    print("\n── 5. POST /reference-import (import image from URL) …")
    # Upload a ref first so we have an absolute URL to round-trip
    ref = multipart_post(
        f"{BASE}/api/video-replace/reference", ref_path, "image/jpeg"
    )
    assert ref["success"], ref
    abs_ref_url = f"{BASE}{ref['data']['url']}"
    imp_ref = json_post(
        f"{BASE}/api/video-replace/reference-import",
        {"image_url": abs_ref_url, "original_filename": "asset-ref.jpg"},
    )
    assert imp_ref["success"], imp_ref
    print(f"    imported-ref url = {imp_ref['data']['url']}")
    assert imp_ref["data"]["url"].startswith("/vr-references/")

    print("\nOK — revision-2 endpoints verified.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
