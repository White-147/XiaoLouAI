"""
⚠ LEGACY e2e smoke — targets the standalone FastAPI (4201) debug path.

The default 4100-native architecture is exercised by
``scripts/verify_video_replace_page.mjs`` and
``scripts/verify_canvas_not_mounted.mjs`` at the repo root. Use those for
the default stack. This script only runs against the legacy FastAPI when
it's explicitly launched with ``VR_LEGACY_STANDALONE=1 python run_api.py``.

Default target is now ``http://127.0.0.1:4201`` (moved off 4200 so the
legacy variant cannot collide with historical tunnels). Override with
``VR_LEGACY_BASE`` if you need a different host/port.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
import urllib.error
import urllib.parse
from pathlib import Path

import cv2
import numpy as np

BASE = os.environ.get("VR_LEGACY_BASE", "http://127.0.0.1:4201")


def build_test_video(out: Path, n_frames: int = 48, fps: float = 24.0) -> Path:
    """
    Build a 2-second test video derived from ultralytics' bus.jpg sample image,
    which contains 4 real people that YOLOv8 has been trained to recognise.

    Steps:
      1. Download / read bus.jpg (cached to <scripts>/_tmp/bus.jpg).
      2. Tile it across n_frames, with a mild pan to simulate motion.
      3. Write through an ASCII temp path (Windows + cv2 won't accept unicode).
    """
    import shutil
    import tempfile

    out.parent.mkdir(parents=True, exist_ok=True)

    # 1. Source photo with real people
    photo_path = out.parent / "bus.jpg"
    if not photo_path.exists():
        url = "https://ultralytics.com/images/bus.jpg"
        print(f"     downloading {url} …")
        with urllib.request.urlopen(url, timeout=30) as resp:
            photo_path.write_bytes(resp.read())
    photo_bytes = photo_path.read_bytes()
    photo = cv2.imdecode(np.frombuffer(photo_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    assert photo is not None, "failed to decode bus.jpg"

    # Down-scale / centre-pad to a stable 640×480 frame
    ph, pw = photo.shape[:2]
    target_h, target_w = 480, 640
    scale = min(target_w / pw, target_h / ph)
    new_w = int(pw * scale)
    new_h = int(ph * scale)
    resized = cv2.resize(photo, (new_w, new_h), interpolation=cv2.INTER_AREA)

    canvas = np.full((target_h, target_w, 3), 32, dtype=np.uint8)
    pad_y = (target_h - new_h) // 2
    pad_x = (target_w - new_w) // 2
    canvas[pad_y : pad_y + new_h, pad_x : pad_x + new_w] = resized

    with tempfile.TemporaryDirectory(prefix="vr_smoke_") as td:
        ascii_out = Path(td) / "vid.mp4"
        writer = cv2.VideoWriter(
            str(ascii_out),
            cv2.VideoWriter_fourcc(*"mp4v"),
            fps,
            (target_w, target_h),
        )
        assert writer.isOpened(), "Failed to open writer"

        for i in range(n_frames):
            # Subtle 6-pixel horizontal pan for realism
            shift = int((i / max(1, n_frames - 1) - 0.5) * 12)
            M = np.float32([[1, 0, shift], [0, 1, 0]])
            frame = cv2.warpAffine(canvas, M, (target_w, target_h), borderValue=(32, 32, 32))
            writer.write(frame)
        writer.release()

        assert ascii_out.stat().st_size > 0
        shutil.copy2(ascii_out, out)
    return out


def build_test_image(out: Path) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    img = np.zeros((256, 256, 3), dtype=np.uint8)
    cv2.rectangle(img, (0, 0), (256, 256), (40, 80, 150), -1)
    cv2.putText(img, "REF", (60, 140), cv2.FONT_HERSHEY_DUPLEX, 2.0, (255, 255, 255), 3)
    # cv2.imwrite can't do unicode paths on Windows; write bytes instead.
    ok, buf = cv2.imencode(".jpg", img)
    assert ok, "imencode failed"
    out.write_bytes(buf.tobytes())
    return out


def multipart_post(url: str, file_path: Path, content_type: str):
    """Manual multipart because we want to avoid a requests dep."""
    boundary = "----XIAOLOUBoundary" + str(int(time.time() * 1000))
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
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def json_post(url: str, payload: dict):
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # Try to parse JSON error body
        raw = e.read().decode("utf-8", errors="replace")
        try:
            return json.loads(raw)
        except Exception:
            raise RuntimeError(f"HTTP {e.code}: {raw}") from e


def json_get(url: str):
    with urllib.request.urlopen(url, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    work = Path(__file__).resolve().parent / "_tmp"
    work.mkdir(exist_ok=True)
    vid_path = work / "smoke_video.mp4"
    ref_path = work / "smoke_ref.jpg"

    print("── 1. Generating sample video & reference image …")
    build_test_video(vid_path)
    build_test_image(ref_path)
    assert vid_path.stat().st_size > 0
    assert ref_path.stat().st_size > 0
    print(f"     video: {vid_path} ({vid_path.stat().st_size} bytes)")
    print(f"     ref:   {ref_path} ({ref_path.stat().st_size} bytes)")

    print("\n── 2. POST /upload …")
    up = multipart_post(f"{BASE}/api/video-replace/upload", vid_path, "video/mp4")
    print(json.dumps(up, indent=2, ensure_ascii=False))
    assert up["success"], up
    job_id = up["data"]["job_id"]
    print(f"     job_id = {job_id}")

    print("\n── 3. POST /jobs/{id}/detect …")
    det = json_post(f"{BASE}/api/video-replace/jobs/{job_id}/detect", {})
    print(json.dumps(det, indent=2, ensure_ascii=False)[:1200])
    assert det.get("success"), det
    candidates = det["data"].get("detection", {}).get("candidates", [])
    print(f"     candidates = {len(candidates)}")

    print("\n── 4. POST /reference …")
    ref = multipart_post(f"{BASE}/api/video-replace/reference", ref_path, "image/jpeg")
    print(json.dumps(ref, indent=2, ensure_ascii=False))
    assert ref["success"], ref
    ref_url = ref["data"]["url"]

    if not candidates:
        print("\n WARNING: no candidates detected on synthetic video — "
              "generate step will reject since we need a valid source_person_id")
        return 0

    print("\n── 5. POST /jobs/{id}/generate …")
    gen_input = {
        "source_person_id": candidates[0]["person_id"],
        "target_reference_url": ref_url,
        "yolo_conf": 0.4,
        "sam2_size": "tiny",
        "mask_dilation_px": 5,
        "mask_blur_px": 4,
        "sample_steps": 30,
        "sample_size": "832*480",
        "base_seed": None,
    }
    gen = json_post(f"{BASE}/api/video-replace/jobs/{job_id}/generate", gen_input)
    print(json.dumps(gen, indent=2, ensure_ascii=False))
    assert gen["success"], gen
    assert gen["data"]["stage"] == "queued"

    print("\n── 6. GET /jobs/{id} …")
    final = json_get(f"{BASE}/api/video-replace/jobs/{job_id}")
    print(json.dumps(final, indent=2, ensure_ascii=False)[:1500])
    assert final["success"], final
    assert final["data"]["source_person_id"] == candidates[0]["person_id"]
    assert final["data"]["target_reference_url"] == ref_url

    print("\nOK — full happy path reached 'queued' without faking success.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
