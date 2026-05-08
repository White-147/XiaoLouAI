"""
OpenCV-based person mask tracker (lite fallback).

Used only when SAM2 is unavailable or when the caller explicitly requests
the lite pipeline for debugging. The deep-learning default is SAM2.

Algorithm
---------
1. Read the *keyframe* frame (the one YOLOv8 used to detect the person),
   not hard-coded frame 0.
2. Initialise a CSRT tracker from that frame with the detection bbox.
3. Propagate forward through the end of the video.
4. Re-initialise a second tracker at the keyframe and propagate backward
   to frame 0. This keeps mask alignment valid when the detection keyframe
   is in the middle of the clip (our default).
5. Build a binary mask inside each tracked bbox, applied with dilation
   and Gaussian feathering.

Quality: lower than SAM2 — the mask is a tracked bounding rect with soft
edges rather than a pixel-perfect silhouette. Primarily useful for quick
sanity checks while SAM2 weights / venv are still being provisioned.
"""
from __future__ import annotations

import logging
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger(__name__)


def _create_tracker():
    """Create a cv2 tracker, preferring CSRT (higher quality) over MIL."""
    candidates = []
    # Preferred: CSRT from the legacy namespace (opencv-contrib-python).
    if hasattr(cv2, "legacy") and hasattr(cv2.legacy, "TrackerCSRT_create"):
        candidates.append(lambda: cv2.legacy.TrackerCSRT_create())
    if hasattr(cv2, "TrackerCSRT_create"):
        candidates.append(lambda: cv2.TrackerCSRT_create())  # older API
    if hasattr(cv2, "TrackerCSRT") and hasattr(cv2.TrackerCSRT, "create"):
        candidates.append(lambda: cv2.TrackerCSRT.create())
    # Fallback: KCF (faster, slightly lower quality).
    if hasattr(cv2, "TrackerKCF") and hasattr(cv2.TrackerKCF, "create"):
        candidates.append(lambda: cv2.TrackerKCF.create())
    # Last resort: MIL (always present in base opencv).
    if hasattr(cv2, "TrackerMIL") and hasattr(cv2.TrackerMIL, "create"):
        candidates.append(lambda: cv2.TrackerMIL.create())
    if hasattr(cv2, "TrackerMIL_create"):
        candidates.append(lambda: cv2.TrackerMIL_create())

    for factory in candidates:
        try:
            t = factory()
            if t is not None:
                return t
        except (AttributeError, cv2.error):
            continue
    raise RuntimeError(
        "未找到可用的 OpenCV Tracker (CSRT/KCF/MIL 都不可用)。"
        "请安装 opencv-contrib-python 以获得 CSRT 支持。"
    )


def _clip_bbox(bbox: tuple[int, int, int, int], frame_w: int, frame_h: int) -> tuple[int, int, int, int]:
    x, y, w, h = bbox
    x = max(0, min(int(x), frame_w - 1))
    y = max(0, min(int(y), frame_h - 1))
    w = max(1, min(int(w), frame_w - x))
    h = max(1, min(int(h), frame_h - y))
    return x, y, w, h


def run_tracking(
    video_path: Path,
    bbox: list[float],                # [x1, y1, x2, y2] from detection keyframe
    masks_dir: Path,
    *,
    keyframe_index: int = 0,
    mask_dilation_px: int = 5,
    mask_blur_px: int = 4,
    on_progress=None,
) -> Path:
    """Track the person from `keyframe_index` outwards and write per-frame masks.

    Parameters
    ----------
    video_path: absolute path to the source video
    bbox: detection bbox on the keyframe [x1, y1, x2, y2]
    masks_dir: directory where frame_NNNNNN.png masks are written
    keyframe_index: zero-based frame index the detection bbox belongs to.
        Propagation goes forward from this frame AND backward to frame 0.
    mask_dilation_px: cv2 dilate kernel radius
    mask_blur_px: Gaussian feather sigma
    on_progress: optional callback(fraction, message)

    Returns
    -------
    masks_dir (same value, now populated).
    """
    masks_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"无法打开视频文件: {video_path}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    keyframe_index = max(0, min(int(keyframe_index), max(0, total_frames - 1)))
    logger.info(
        "[opencv-tracker] %d frames @ %.1f fps, %dx%d, keyframe=%d",
        total_frames, fps, frame_w, frame_h, keyframe_index,
    )

    # Read and cache every frame (memory cost is modest for ≤15s clips)
    frames: list[np.ndarray] = []
    while True:
        ret, fr = cap.read()
        if not ret:
            break
        frames.append(fr)
    cap.release()

    total = len(frames)
    if total == 0:
        raise RuntimeError(f"视频无可读帧: {video_path}")
    keyframe_index = min(keyframe_index, total - 1)

    # Convert bbox → (x, y, w, h) in keyframe coords
    x1, y1, x2, y2 = (int(round(v)) for v in bbox)
    init_rect = _clip_bbox((x1, y1, x2 - x1, y2 - y1), frame_w, frame_h)

    dil_kernel = None
    if mask_dilation_px > 0:
        k = max(3, mask_dilation_px * 2 + 1)
        dil_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))

    def make_mask(rect: tuple[int, int, int, int]) -> np.ndarray:
        mx, my, mw, mh = _clip_bbox(rect, frame_w, frame_h)
        mask = np.zeros((frame_h, frame_w), dtype=np.uint8)
        mask[my: my + mh, mx: mx + mw] = 255
        if dil_kernel is not None:
            mask = cv2.dilate(mask, dil_kernel, iterations=1)
        if mask_blur_px > 0:
            bk = max(3, mask_blur_px * 2 + 1) | 1
            mask = cv2.GaussianBlur(mask, (bk, bk), sigmaX=mask_blur_px)
        return mask

    masks: list[np.ndarray | None] = [None] * total

    # ── 1. Keyframe itself ─────────────────────────────────────────────
    masks[keyframe_index] = make_mask(init_rect)

    # ── 2. Forward propagation (keyframe → end) ────────────────────────
    if keyframe_index + 1 < total:
        fwd = _create_tracker()
        fwd.init(frames[keyframe_index], init_rect)
        current = init_rect
        for idx in range(keyframe_index + 1, total):
            ok_track, tracked_rect = fwd.update(frames[idx])
            if ok_track:
                current = (
                    int(tracked_rect[0]), int(tracked_rect[1]),
                    int(tracked_rect[2]), int(tracked_rect[3]),
                )
            masks[idx] = make_mask(current)
            if on_progress:
                on_progress(
                    0.5 + 0.5 * (idx - keyframe_index) / max(1, total - keyframe_index),
                    f"正向追踪 {idx + 1}/{total}",
                )

    # ── 3. Backward propagation (keyframe → 0) ─────────────────────────
    if keyframe_index > 0:
        bwd = _create_tracker()
        bwd.init(frames[keyframe_index], init_rect)
        current = init_rect
        for idx in range(keyframe_index - 1, -1, -1):
            ok_track, tracked_rect = bwd.update(frames[idx])
            if ok_track:
                current = (
                    int(tracked_rect[0]), int(tracked_rect[1]),
                    int(tracked_rect[2]), int(tracked_rect[3]),
                )
            masks[idx] = make_mask(current)
            if on_progress:
                on_progress(
                    0.5 * (keyframe_index - idx) / max(1, keyframe_index),
                    f"反向追踪 {keyframe_index - idx}/{keyframe_index}",
                )

    # ── 4. Persist masks — 1-based filename indexing to match SAM2 ─────
    written = 0
    for i, m in enumerate(masks):
        if m is None:
            m = np.zeros((frame_h, frame_w), dtype=np.uint8)
        out_path = masks_dir / f"frame_{i + 1:06d}.png"
        out_path.write_bytes(cv2.imencode(".png", m)[1].tobytes())
        written += 1

    logger.info("[opencv-tracker] wrote %d masks to %s", written, masks_dir)
    return masks_dir
