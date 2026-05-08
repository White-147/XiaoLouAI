"""
OpenCV-based video replacement compositor (lite mode).

Works without VACE/Wan2.1 or any GPU. For each frame:
  1. Read the binary person mask produced by the tracker.
  2. Determine the bounding rect of the mask.
  3. Resize the reference image to fit that region.
  4. Alpha-blend the resized reference into the source frame using the mask.

The result is a real MP4 (not fake) — quality is lower than deep-learning
based inpainting but demonstrates the full end-to-end pipeline.

Mode label: "lite" — always noted in the job message so users know which
pipeline variant produced the output.
"""
from __future__ import annotations

import logging
from pathlib import Path

import cv2
import numpy as np

from ...services import cv2_io

logger = logging.getLogger(__name__)

# Soften the blending boundary beyond the Gaussian blur already applied to the mask
_BLEND_FEATHER_EXTRA = 3  # additional blur passes on the mask for blending


def run_replacement(
    video_path: Path,
    masks_dir: Path,
    reference_path: Path,
    result_path: Path,
    *,
    on_progress: "Callable[[float, str], None] | None" = None,
) -> Path:
    """
    Composite reference image into the person-masked region of each frame.

    Parameters
    ----------
    video_path: source video (absolute)
    masks_dir: directory containing frame_000001.png … masks
    reference_path: replacement character reference image
    result_path: where to write the output MP4 (parent must exist)
    on_progress: optional callback(fraction, message)

    Returns
    -------
    result_path
    """
    result_path.parent.mkdir(parents=True, exist_ok=True)

    # Load reference image once
    ref_bgr = cv2_io.imread(reference_path)
    if ref_bgr is None:
        raise RuntimeError(f"无法加载参考图: {reference_path}")

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"无法打开源视频: {video_path}")

    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Try mp4v first; some systems may need different fourcc
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(result_path), fourcc, fps, (frame_w, frame_h))
    if not writer.isOpened():
        cap.release()
        raise RuntimeError(f"无法创建输出视频: {result_path}")

    # Tile/pad reference to full frame size (used when mask covers large area)
    ref_full = _tile_to_size(ref_bgr, frame_w, frame_h)

    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frame_idx += 1

        # Load the corresponding mask (graceful degradation if missing)
        mask_path = masks_dir / f"frame_{frame_idx:06d}.png"
        if mask_path.exists():
            mask_gray = cv2_io.imread(mask_path, cv2.IMREAD_GRAYSCALE)
        else:
            mask_gray = None

        if mask_gray is None or mask_gray.shape != (frame_h, frame_w):
            # No mask → write original frame unchanged
            writer.write(frame)
            continue

        # Prepare reference layer: crop to bbox from mask, then resize & place
        ref_layer = _warp_reference_to_mask(ref_bgr, mask_gray, frame_w, frame_h, ref_full)

        # Soft alpha-blend using mask as alpha channel
        alpha = mask_gray.astype(np.float32) / 255.0
        alpha_3 = np.stack([alpha, alpha, alpha], axis=-1)

        blended = (ref_layer.astype(np.float32) * alpha_3 +
                   frame.astype(np.float32) * (1.0 - alpha_3))
        result_frame = np.clip(blended, 0, 255).astype(np.uint8)
        writer.write(result_frame)

        if on_progress and total_frames > 0:
            on_progress(frame_idx / total_frames, f"合成帧 {frame_idx}/{total_frames}")

    cap.release()
    writer.release()

    if not result_path.exists() or result_path.stat().st_size < 1024:
        raise RuntimeError(f"输出视频文件异常（过小或不存在）: {result_path}")

    logger.info("[opencv-replacer] wrote result to %s (%d bytes)",
                result_path, result_path.stat().st_size)
    return result_path


# ── Helpers ────────────────────────────────────────────────────────────


def _tile_to_size(img: np.ndarray, w: int, h: int) -> np.ndarray:
    """Tile img to cover (h, w) exactly."""
    ih, iw = img.shape[:2]
    repeats_y = (h + ih - 1) // ih
    repeats_x = (w + iw - 1) // iw
    tiled = np.tile(img, (repeats_y, repeats_x, 1))
    return tiled[:h, :w]


def _warp_reference_to_mask(
    ref_bgr: np.ndarray,
    mask: np.ndarray,
    frame_w: int,
    frame_h: int,
    ref_full: np.ndarray,
) -> np.ndarray:
    """
    Place the reference image into the bounding box of the mask.
    Outside the bbox the full-frame tiled reference is used (blended with
    mask=0, so it won't actually be visible there).
    """
    # Find bounding rect of the non-zero mask region
    coords = cv2.findNonZero(mask)
    if coords is None:
        return ref_full.copy()

    x, y, w, h = cv2.boundingRect(coords)
    if w <= 0 or h <= 0:
        return ref_full.copy()

    # Resize reference to bbox dimensions
    resized = cv2.resize(ref_bgr, (w, h), interpolation=cv2.INTER_LINEAR)

    # Place on top of the tiled full-frame reference
    layer = ref_full.copy()
    y2 = min(y + h, frame_h)
    x2 = min(x + w, frame_w)
    layer[y:y2, x:x2] = resized[: y2 - y, : x2 - x]
    return layer
