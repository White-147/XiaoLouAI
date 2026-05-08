"""
SAM2 video predictor-based person tracker — default deep-learning tracker.

This module:
  - auto-downloads the SAM2 checkpoint on first use (from HuggingFace) if
    configured weights are missing;
  - initialises segmentation on the *actual detection keyframe* (not
    hard-coded frame 0);
  - propagates the mask both forward and backward so the detection can sit
    anywhere in the clip (our default is the middle frame).

Required:
  pip install git+https://github.com/facebookresearch/sam2.git
  pip install torch --index-url https://download.pytorch.org/whl/cu124
"""
from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path
from typing import TYPE_CHECKING

import cv2
import numpy as np

from ...services import cv2_io

if TYPE_CHECKING:
    from ...config import Settings

logger = logging.getLogger(__name__)


# ── HuggingFace repo map ──────────────────────────────────────────────────
# Canonical SAM 2.1 checkpoints mirrored on HuggingFace.
_HF_REPOS: dict[str, tuple[str, str]] = {
    # size_key: (repo_id, filename)
    "tiny":      ("facebook/sam2.1-hiera-tiny",      "sam2.1_hiera_tiny.pt"),
    "small":     ("facebook/sam2.1-hiera-small",     "sam2.1_hiera_small.pt"),
    "base_plus": ("facebook/sam2.1-hiera-base-plus", "sam2.1_hiera_base_plus.pt"),
    "large":     ("facebook/sam2.1-hiera-large",     "sam2.1_hiera_large.pt"),
}

_MODEL_CFGS: dict[str, str] = {
    "tiny":      "configs/sam2.1/sam2.1_hiera_t.yaml",
    "small":     "configs/sam2.1/sam2.1_hiera_s.yaml",
    "base_plus": "configs/sam2.1/sam2.1_hiera_b+.yaml",
    "large":     "configs/sam2.1/sam2.1_hiera_l.yaml",
}


# ── Preflight ─────────────────────────────────────────────────────────────


def preflight(settings: "Settings") -> str | None:
    """
    Return an error description if SAM2 cannot be used, else None.
    Called before every tracking job — fast (~10 ms).

    Auto-download is attempted *here* when the weights path is configured
    but the file is missing and auto_download is allowed. That way the very
    first call from the UI still succeeds without a manual setup step.
    """
    try:
        import sam2  # noqa: F401
    except ImportError:
        return (
            "SAM2 未安装。请执行：\n"
            "  pip install git+https://github.com/facebookresearch/sam2.git\n"
            "然后重新提交任务。full mode 需要 SAM2。"
        )

    try:
        import torch  # noqa: F401
    except ImportError:
        return "torch 未安装，SAM2 需要 torch。请安装 CUDA 版 torch。"

    # Resolve the checkpoint: configured path → default weights dir → HF download.
    checkpoint = _ensure_checkpoint(settings)
    if checkpoint is None:
        return (
            "SAM2 权重无法定位，且自动下载失败。\n"
            "请手动执行：\n"
            "  python -m app.workers.models.sam2_tracker --download tiny\n"
            "或在 .env.local 中设置 VR_SAM2_CHECKPOINT_TINY 指向已下载的 .pt 文件。"
        )

    return None


def _resolve_checkpoint(settings: "Settings") -> Path | None:
    """Return the explicitly-configured checkpoint for the current size.

    IMPORTANT: only return the checkpoint when the configured path matches the
    *requested* size. Returning a different size's weights here would be loaded
    against the wrong ``model_cfg`` and blow up with a shape mismatch such as
    "expected 16 blocks, checkpoint has 12 blocks". When no matching explicit
    config is present we return None and let ``_ensure_checkpoint`` look in the
    default weights directory / auto-download the right file.
    """
    size = (getattr(settings, "sam2_size_default", "tiny") or "tiny").lower()
    mapping: dict[str, Path | None] = {
        "tiny": settings.sam2_checkpoint_tiny,
        "small": settings.sam2_checkpoint_small,
        "base_plus": settings.sam2_checkpoint_base_plus,
    }
    ckpt = mapping.get(size)
    if ckpt is not None:
        return Path(ckpt)
    return None


def _weights_dir(settings: "Settings") -> Path:
    root = getattr(settings, "weights_root", None)
    if root:
        return Path(root)
    return Path(settings.storage_root) / "weights"


def _ensure_checkpoint(settings: "Settings") -> Path | None:
    """
    Return a usable SAM2 checkpoint for the currently selected size, downloading
    it from HuggingFace on first use if necessary. Returns None if every
    strategy fails.
    """
    size = (getattr(settings, "sam2_size_default", "tiny") or "tiny").lower()
    if size not in _HF_REPOS:
        size = "tiny"

    # 1. Explicit config pointer.
    explicit = _resolve_checkpoint(settings)
    if explicit and explicit.exists():
        return explicit

    # 2. Default dir + canonical filename.
    target_dir = _weights_dir(settings) / "sam2"
    repo_id, filename = _HF_REPOS[size]
    local_path = target_dir / filename
    if local_path.exists():
        return local_path

    # 3. Try to download via huggingface_hub.
    if not getattr(settings, "sam2_auto_download", True):
        return None

    try:
        from huggingface_hub import hf_hub_download
    except ImportError:
        logger.warning("[sam2-tracker] huggingface_hub not installed; cannot auto-download")
        return None

    target_dir.mkdir(parents=True, exist_ok=True)
    try:
        logger.info("[sam2-tracker] downloading %s/%s → %s", repo_id, filename, target_dir)
        downloaded = hf_hub_download(
            repo_id=repo_id,
            filename=filename,
            local_dir=str(target_dir),
        )
        dp = Path(downloaded)
        if dp != local_path:
            try:
                shutil.copy2(dp, local_path)
            except Exception:
                local_path = dp
        logger.info("[sam2-tracker] checkpoint ready: %s", local_path)
        return local_path
    except Exception as exc:  # noqa: BLE001
        logger.warning("[sam2-tracker] HF auto-download failed: %s", exc)
        return None


# ── Real tracking ─────────────────────────────────────────────────────────


def run_tracking(
    video_path: Path,
    bbox: list[float],
    masks_dir: Path,
    *,
    keyframe_index: int = 0,
    sam2_size: str = "tiny",
    mask_dilation_px: int = 5,
    mask_blur_px: int = 4,
    settings: "Settings | None" = None,
    on_progress=None,
) -> Path:
    """
    Run SAM2 video prediction and write per-frame PNG masks.

    Key differences from the previous revision:
      - `keyframe_index` is the actual detection frame (not 0). The bbox
        prompt is attached to that frame.
      - Propagation runs forward AND backward so the whole video is covered
        even when the detection sits in the middle.
      - Weights are auto-resolved through `_ensure_checkpoint()` — first-use
        downloads come from HuggingFace.
    """
    from sam2.build_sam import build_sam2_video_predictor  # type: ignore

    import torch

    masks_dir.mkdir(parents=True, exist_ok=True)

    if settings is None:
        raise RuntimeError("sam2_tracker.run_tracking requires settings=")

    # Allow per-call size override (user may pick "small" via UI).
    effective_size = (sam2_size or settings.sam2_size_default or "tiny").lower()
    if effective_size not in _HF_REPOS:
        effective_size = "tiny"

    # Temporarily flip the settings size so _ensure_checkpoint picks the right one.
    prior_size = settings.sam2_size_default
    settings.sam2_size_default = effective_size
    try:
        checkpoint = _ensure_checkpoint(settings)
    finally:
        settings.sam2_size_default = prior_size

    if checkpoint is None or not checkpoint.exists():
        raise RuntimeError(
            f"SAM2 checkpoint not ready for size '{effective_size}' — preflight should have caught this"
        )

    model_cfg = _MODEL_CFGS.get(effective_size, _MODEL_CFGS["tiny"])

    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info(
        "[sam2-tracker] device=%s size=%s cfg=%s ckpt=%s",
        device, effective_size, model_cfg, checkpoint,
    )

    predictor = build_sam2_video_predictor(model_cfg, str(checkpoint), device=device)

    # Extract every frame to disk (SAM2 expects a folder of JPEGs).
    frames_dir = masks_dir.parent / f"{masks_dir.name}_frames"
    if frames_dir.exists():
        shutil.rmtree(frames_dir, ignore_errors=True)
    frames_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"无法打开视频: {video_path}")

    total_frames = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frame_path = frames_dir / f"{total_frames:06d}.jpg"
        if not cv2_io.imwrite(frame_path, frame, [cv2.IMWRITE_JPEG_QUALITY, 92]):
            cap.release()
            raise RuntimeError(f"SAM2 帧缓存写入失败（路径编码或磁盘问题）: {frame_path}")
        total_frames += 1
    cap.release()
    if total_frames == 0:
        raise RuntimeError(f"视频没有可读帧: {video_path}")

    sample = cv2_io.imread(frames_dir / "000000.jpg")
    frame_h, frame_w = (sample.shape[0], sample.shape[1]) if sample is not None else (0, 0)

    keyframe_index = max(0, min(int(keyframe_index), total_frames - 1))

    x1, y1, x2, y2 = (float(v) for v in bbox)
    bbox_np = np.array([x1, y1, x2, y2], dtype=np.float32)

    def _mask_postprocess(mask_u8: np.ndarray) -> np.ndarray:
        if mask_dilation_px > 0:
            k = max(3, mask_dilation_px * 2 + 1)
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
            mask_u8 = cv2.dilate(mask_u8, kernel, iterations=1)
        if mask_blur_px > 0:
            blur_k = max(3, mask_blur_px * 2 + 1) | 1
            mask_u8 = cv2.GaussianBlur(mask_u8, (blur_k, blur_k), sigmaX=mask_blur_px)
        return mask_u8

    try:
        with torch.inference_mode():
            inference_state = predictor.init_state(video_path=str(frames_dir))
            predictor.reset_state(inference_state)

            # Attach the bbox prompt on the REAL keyframe, not frame 0.
            predictor.add_new_points_or_box(
                inference_state=inference_state,
                frame_idx=keyframe_index,
                obj_id=1,
                box=bbox_np,
            )

            produced: set[int] = set()

            # Forward propagation from keyframe.
            for out_frame_idx, _, out_mask_logits in predictor.propagate_in_video(
                inference_state,
                start_frame_idx=keyframe_index,
            ):
                mask_bool = (out_mask_logits[0, 0] > 0.0).cpu().numpy()
                mask_u8 = (mask_bool * 255).astype(np.uint8)
                if (frame_h and frame_w) and mask_u8.shape != (frame_h, frame_w):
                    mask_u8 = cv2.resize(mask_u8, (frame_w, frame_h))
                mask_u8 = _mask_postprocess(mask_u8)
                out_path = masks_dir / f"frame_{out_frame_idx + 1:06d}.png"
                cv2_io.imwrite(out_path, mask_u8)
                produced.add(out_frame_idx)
                if on_progress and total_frames > 0:
                    on_progress(
                        (out_frame_idx - keyframe_index + 1) / max(1, total_frames - keyframe_index),
                        f"SAM2 正向 {out_frame_idx + 1}/{total_frames}",
                    )

            # Backward propagation from keyframe (only if keyframe > 0).
            if keyframe_index > 0:
                for out_frame_idx, _, out_mask_logits in predictor.propagate_in_video(
                    inference_state,
                    start_frame_idx=keyframe_index,
                    reverse=True,
                ):
                    if out_frame_idx in produced:
                        continue
                    mask_bool = (out_mask_logits[0, 0] > 0.0).cpu().numpy()
                    mask_u8 = (mask_bool * 255).astype(np.uint8)
                    if (frame_h and frame_w) and mask_u8.shape != (frame_h, frame_w):
                        mask_u8 = cv2.resize(mask_u8, (frame_w, frame_h))
                    mask_u8 = _mask_postprocess(mask_u8)
                    out_path = masks_dir / f"frame_{out_frame_idx + 1:06d}.png"
                    cv2_io.imwrite(out_path, mask_u8)
                    produced.add(out_frame_idx)
                    if on_progress:
                        on_progress(
                            (keyframe_index - out_frame_idx) / max(1, keyframe_index + 1),
                            f"SAM2 反向 {out_frame_idx + 1}/{keyframe_index + 1}",
                        )

            # Any gaps → write an empty mask so the replacement loop doesn't
            # crash; these frames will pass through unchanged.
            for i in range(total_frames):
                out_path = masks_dir / f"frame_{i + 1:06d}.png"
                if not out_path.exists():
                    empty = np.zeros((frame_h or 1, frame_w or 1), dtype=np.uint8)
                    cv2_io.imwrite(out_path, empty)
    finally:
        # Always release GPU memory and frame cache.
        shutil.rmtree(frames_dir, ignore_errors=True)
        try:
            del predictor
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    logger.info("[sam2-tracker] wrote masks to %s (total frames=%d, key=%d)",
                masks_dir, total_frames, keyframe_index)
    return masks_dir


# ── CLI helper: python -m app.workers.models.sam2_tracker --download tiny ──


def _cli_download(size: str) -> None:
    size = size.lower()
    if size not in _HF_REPOS:
        print(f"unknown size: {size}. options: {list(_HF_REPOS)}")
        raise SystemExit(2)
    try:
        from huggingface_hub import hf_hub_download
    except ImportError:
        print("pip install huggingface_hub  # required for --download")
        raise SystemExit(1)
    repo_id, filename = _HF_REPOS[size]
    out_dir = Path(os.environ.get("VR_WEIGHTS_ROOT", "./weights")) / "sam2"
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"downloading {repo_id}/{filename} → {out_dir}")
    hf_hub_download(repo_id=repo_id, filename=filename, local_dir=str(out_dir))
    print(f"done → {out_dir / filename}")


if __name__ == "__main__":
    import sys
    if len(sys.argv) >= 3 and sys.argv[1] == "--download":
        _cli_download(sys.argv[2])
    else:
        print("usage: python -m app.workers.models.sam2_tracker --download {tiny|small|base_plus|large}")
