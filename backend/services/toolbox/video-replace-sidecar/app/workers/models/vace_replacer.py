"""
VACE / Wan2.1 video replacement — full deep-learning path.

Spawns Wan2.1's official `generate.py` as a subprocess so GPU memory is
released cleanly after each job. The generator needs a clone of the Wan2.1
repository (for code), plus the Wan-AI/Wan2.1-VACE-1.3B weights.

Environment:
  VR_WAN2_REPO_DIR        absolute path to a `git clone https://github.com/Wan-Video/Wan2.1`
  VR_VACE_MODEL_DIR       absolute path to Wan-AI/Wan2.1-VACE-1.3B weight directory
  VR_VACE_OFFLOAD_MODEL   auto (default) | true | false
                          auto = try with --offload_model False first; if CUDA OOM is detected
                          in the log, transparently retry with --offload_model True.
                          true = always offload (safe on ≤12 GB GPUs, ~75 s/step).
                          false = never offload (fastest, may OOM on ≤12 GB GPUs).

A lite fallback exists in opencv_replacer.py; replace_runner picks whichever
path preflight() allows.
"""
from __future__ import annotations

import asyncio
import logging
import math
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import TYPE_CHECKING, Awaitable, Callable

import numpy as np

# Matches tqdm / generate.py step lines like "  3%|▎  | 1/30 [00:45<…]"
_STEP_RE = re.compile(r"\b(\d+)/(\d+)\s*\[")

# Matches the explicit per-step output added by our vace.py patch: "vace_step 3/20"
_VACE_STEP_RE = re.compile(r"vace_step\s+(\d+)/(\d+)")

# CUDA out-of-memory indicators in subprocess stdout/stderr
_OOM_RE = re.compile(
    r"out of memory|cuda out of memory|torch\.cuda\.OutOfMemoryError|"
    r"RuntimeError.*CUDA.*memory|CUDA error.*out of memory",
    re.IGNORECASE,
)

_DISTRIBUTED_ENV_KEYS = (
    "LOCAL_RANK",
    "RANK",
    "WORLD_SIZE",
    "LOCAL_WORLD_SIZE",
    "GROUP_RANK",
    "ROLE_RANK",
    "ROLE_WORLD_SIZE",
    "MASTER_ADDR",
    "MASTER_PORT",
    "NPROC_PER_NODE",
)

from ..proc_utils import kill_process_tree
from ...services import cv2_io
from .yolo_detector import YOLODetector, YOLODetectorError

if TYPE_CHECKING:
    from ...config import Settings

logger = logging.getLogger(__name__)


# Default safety rails in case the caller doesn't thread settings through.
_DEFAULT_TIMEOUT_S = 3600
_DEFAULT_IDLE_TIMEOUT_S = 600
_ALLOWED_INFERENCE_FPS = {15, 30, 60}
_DEFAULT_INFERENCE_FPS = 15
_DEFAULT_MAX_FRAME_NUM = 21
_DEFAULT_PERSON_REPLACE_PROMPT = (
    "Replace the masked person with the same person shown in the reference "
    "image board. Strongly match the reference face, hairstyle, body shape, "
    "outfit colors, and identity. Preserve the original video motion, camera, "
    "lighting, background, and composition."
)


def _snap_wan_frame_num(frame_num: int) -> int:
    """Wan temporal lengths are 4n+1; use the largest valid length <= input."""
    n = max(1, int(frame_num))
    if n < 5:
        return 1
    return n - ((n - 1) % 4)


def _safe_int(value, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _normalize_inference_fps(value) -> int:
    fps = _safe_int(value, _DEFAULT_INFERENCE_FPS)
    return fps if fps in _ALLOWED_INFERENCE_FPS else _DEFAULT_INFERENCE_FPS


def _probe_video_stats(video_path: Path) -> tuple[float, int, float]:
    """Return (duration_s, frame_count, fps). Falls back safely if OpenCV fails."""
    import cv2

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return 0.0, 0, 0.0
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    cap.release()
    duration_s = (frame_count / fps) if fps > 0 and frame_count > 0 else 0.0
    return duration_s, frame_count, fps


# ── OOM detection helper ──────────────────────────────────────────────────


def _probe_video_size(video_path: Path) -> tuple[int, int]:
    """Return (width, height) for target reference-board sizing."""
    import cv2

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return 0, 0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    cap.release()
    return width, height


def _parse_sample_area(sample_size: str) -> int:
    try:
        w_raw, h_raw = str(sample_size).lower().split("*", 1)
        return max(1, int(w_raw) * int(h_raw))
    except Exception:
        return 832 * 480


def _estimate_vace_ref_canvas(video_path: Path, sample_size: str) -> tuple[int, int]:
    """Estimate the actual VACE condition size as (width, height)."""
    source_w, source_h = _probe_video_size(video_path)
    if source_w <= 0 or source_h <= 0:
        return (832, 480) if "832*480" in str(sample_size) else (480, 832)

    ratio = source_h / max(1, source_w)
    latent_area = max(1, _parse_sample_area(sample_size) // (16 * 16))
    h_units = max(1, int(round(math.sqrt(latent_area * ratio))))
    w_units = max(1, int(latent_area / h_units))
    return w_units * 16, h_units * 16


def _clip_box(box: tuple[float, float, float, float], width: int, height: int) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = box
    ix1 = max(0, min(width - 1, int(round(x1))))
    iy1 = max(0, min(height - 1, int(round(y1))))
    ix2 = max(ix1 + 1, min(width, int(round(x2))))
    iy2 = max(iy1 + 1, min(height, int(round(y2))))
    return ix1, iy1, ix2, iy2


def _expand_box(
    box: tuple[float, float, float, float],
    width: int,
    height: int,
    *,
    pad_x: float,
    pad_y: float,
) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = box
    bw = max(1.0, x2 - x1)
    bh = max(1.0, y2 - y1)
    return _clip_box(
        (x1 - bw * pad_x, y1 - bh * pad_y, x2 + bw * pad_x, y2 + bh * pad_y),
        width,
        height,
    )


def _center_box(width: int, height: int) -> tuple[int, int, int, int]:
    box_w = width * 0.72
    box_h = height * 0.86
    return _clip_box(
        (
            (width - box_w) / 2,
            (height - box_h) / 2,
            (width + box_w) / 2,
            (height + box_h) / 2,
        ),
        width,
        height,
    )


def _resolve_yolo_weights(settings: "Settings") -> str:
    weights = Path(str(getattr(settings, "yolo_weights", "yolov8n.pt")))
    if weights.is_absolute() or weights.exists():
        return str(weights)
    service_root = Path(__file__).resolve().parents[3]
    candidate = service_root / weights
    return str(candidate if candidate.exists() else weights)


def _detect_reference_person_box(reference_path: Path, settings: "Settings") -> tuple[float, float, float, float] | None:
    try:
        detector = YOLODetector(weights=_resolve_yolo_weights(settings), device="cpu")
        detector.load()
        boxes = detector.detect(reference_path, conf=0.25, max_detections=3)
        detector.unload()
    except YOLODetectorError as exc:
        logger.warning("[vace-reference] YOLO reference crop skipped: %s", exc)
        return None
    except Exception as exc:  # noqa: BLE001
        logger.warning("[vace-reference] reference crop detection failed: %s", exc)
        return None

    if not boxes:
        return None
    best = boxes[0]
    return best.x1, best.y1, best.x2, best.y2


def _crop(img: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    x1, y1, x2, y2 = box
    return img[y1:y2, x1:x2].copy()


def _square_box_from_center(
    cx: float,
    cy: float,
    side: float,
    width: int,
    height: int,
) -> tuple[int, int, int, int]:
    return _clip_box(
        (
            cx - side / 2,
            cy - side / 2,
            cx + side / 2,
            cy + side / 2,
        ),
        width,
        height,
    )


def _paste_fit(
    canvas: np.ndarray,
    crop: np.ndarray,
    rect: tuple[int, int, int, int],
    *,
    mode: str,
) -> None:
    import cv2

    x, y, w, h = rect
    if crop.size == 0 or w <= 0 or h <= 0:
        return
    ch, cw = crop.shape[:2]
    if mode == "cover":
        scale = max(w / max(1, cw), h / max(1, ch))
    else:
        scale = min(w / max(1, cw), h / max(1, ch))
    nw = max(1, int(round(cw * scale)))
    nh = max(1, int(round(ch * scale)))
    interpolation = cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
    resized = cv2.resize(crop, (nw, nh), interpolation=interpolation)
    if mode == "cover":
        sx = max(0, (nw - w) // 2)
        sy = max(0, (nh - h) // 2)
        canvas[y:y + h, x:x + w] = resized[sy:sy + h, sx:sx + w]
        return

    px = x + (w - nw) // 2
    py = y + (h - nh) // 2
    canvas[py:py + nh, px:px + nw] = resized


def _build_reference_board(
    reference_path: Path,
    video_path: Path,
    out_path: Path,
    *,
    sample_size: str,
    settings: "Settings",
) -> Path:
    """Create a VACE-ready reference board with enlarged identity cues."""
    ref = cv2_io.imread(reference_path)
    if ref is None:
        raise RuntimeError(f"Could not read reference image: {reference_path}")

    import cv2

    src_h, src_w = ref.shape[:2]
    person_box = _detect_reference_person_box(reference_path, settings)
    if person_box is None:
        person_box = _center_box(src_w, src_h)

    x1, y1, x2, y2 = person_box
    body_h = max(1.0, y2 - y1)
    body_w = max(1.0, x2 - x1)
    body_box = _expand_box(person_box, src_w, src_h, pad_x=0.10, pad_y=0.04)
    upper_box = _expand_box((x1, y1, x2, y1 + body_h * 0.62), src_w, src_h, pad_x=0.22, pad_y=0.10)
    outfit_box = _expand_box(
        (x1, y1 + body_h * 0.22, x2, y1 + body_h * 0.68),
        src_w,
        src_h,
        pad_x=0.18,
        pad_y=0.08,
    )

    head_cx = (x1 + x2) / 2
    # Face identity is the weakest part when the reference is a full-body photo.
    # Use a generous head crop so hair, face outline, and chin are all visible.
    head_cy = y1 + body_h * 0.15
    head_side = max(body_w * 1.12, body_h * 0.26)
    face_box = _square_box_from_center(head_cx, head_cy, head_side, src_w, src_h)

    canvas_w, canvas_h = _estimate_vace_ref_canvas(video_path, sample_size)
    canvas = np.full((canvas_h, canvas_w, 3), 245, dtype=np.uint8)

    gap = max(8, int(canvas_w * 0.014))
    margin = max(10, int(canvas_w * 0.018))
    panel_h = canvas_h - margin * 2
    left_w = int(canvas_w * 0.27)
    mid_w = int(canvas_w * 0.36)
    right_w = canvas_w - margin * 2 - gap * 2 - left_w - mid_w
    left = (margin, margin, left_w, panel_h)
    middle = (margin + left_w + gap, margin, mid_w, panel_h)
    right_x = margin + left_w + gap + mid_w + gap
    face_h = min(right_w, int(panel_h * 0.62))
    right_face = (right_x, margin, right_w, face_h)
    right_outfit = (
        right_x,
        margin + face_h + gap,
        right_w,
        max(1, panel_h - face_h - gap),
    )

    for rect in (left, middle, right_face, right_outfit):
        x, y, w, h = rect
        cv2.rectangle(canvas, (x, y), (x + w - 1, y + h - 1), (232, 232, 232), 1)

    _paste_fit(canvas, _crop(ref, body_box), left, mode="contain")
    _paste_fit(canvas, _crop(ref, upper_box), middle, mode="cover")
    _paste_fit(canvas, _crop(ref, face_box), right_face, mode="cover")
    _paste_fit(canvas, _crop(ref, outfit_box), right_outfit, mode="cover")

    if not cv2_io.imwrite(out_path, canvas, [int(cv2.IMWRITE_JPEG_QUALITY), 94]):
        raise RuntimeError(f"Could not write VACE reference board: {out_path}")
    return out_path


def _build_effective_prompt(prompt: str | None) -> str:
    user_prompt = (prompt or "").strip()
    if not user_prompt:
        return _DEFAULT_PERSON_REPLACE_PROMPT
    return f"{_DEFAULT_PERSON_REPLACE_PROMPT} User prompt: {user_prompt}"


def _log_has_oom(log_path: Path) -> bool:
    """Return True if the subprocess log contains any CUDA OOM indicator."""
    try:
        text = log_path.read_bytes().decode("utf-8", errors="replace")
        return bool(_OOM_RE.search(text))
    except Exception:
        return False


def _sanitize_single_gpu_env(env: dict[str, str]) -> None:
    """Force Wan2.1's generate.py onto a known-good single-GPU launch shape."""
    for key in _DISTRIBUTED_ENV_KEYS:
        env.pop(key, None)

    # Wan2.1 reads these variables directly and uses LOCAL_RANK as the CUDA
    # device id. A stale torchrun/accelerate environment can make a one-GPU
    # machine attempt cuda:1, which later fails as "Invalid device id".
    env["RANK"] = "0"
    env["WORLD_SIZE"] = "1"
    env["LOCAL_RANK"] = "0"
    env["LOCAL_WORLD_SIZE"] = "1"

    # This app targets a single local RTX 4070-class GPU. Allow an explicit
    # override for advanced setups, otherwise expose only physical GPU 0 so
    # Wan2.1's cuda:0 always maps to an actual visible device.
    env["CUDA_VISIBLE_DEVICES"] = str(os.getenv("VR_CUDA_VISIBLE_DEVICES") or "0")


def _detect_flash_attn_build_hints(torch_module) -> list[str]:
    hints: list[str] = []

    if os.name == "nt":
        hints.append("当前环境为 Windows，flash-attn 通常需要本地编译。")

    if shutil.which("cl") is None:
        hints.append("未检测到 MSVC 编译器 cl.exe。")
    if shutil.which("ninja") is None:
        hints.append("未检测到 ninja 可执行文件。")

    torch_cuda = getattr(getattr(torch_module, "version", None), "cuda", None)
    nvcc_path = shutil.which("nvcc")
    if nvcc_path is None:
        hints.append("未检测到 CUDA toolkit 的 nvcc。")
    else:
        try:
            run_kwargs = {
                "check": False,
                "capture_output": True,
                "text": True,
                "timeout": 10,
            }
            if os.name == "nt":
                run_kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            result = subprocess.run([nvcc_path, "--version"], **run_kwargs)
            output = f"{result.stdout}\n{result.stderr}"
            match = re.search(r"release\s+(\d+\.\d+)", output)
            if match and torch_cuda and match.group(1) != str(torch_cuda):
                hints.append(
                    f"检测到 CUDA toolkit {match.group(1)}，但当前 torch 编译版本是 cu{torch_cuda}。"
                )
        except Exception:
            hints.append("检测 nvcc 版本失败。")

    py_ver = f"{sys.version_info.major}.{sys.version_info.minor}"
    hints.append(f"当前 Python 版本为 {py_ver}。")
    return hints


# ── Preflight ─────────────────────────────────────────────────────────────


def preflight(settings: "Settings") -> str | None:
    """Return a human-readable error string if VACE cannot run, else None."""
    repo_dir = _resolve_repo_dir(settings)
    if repo_dir is None:
        return (
            "Wan2.1 仓库未配置。请 git clone https://github.com/Wan-Video/Wan2.1.git\n"
            "然后在 .env.local 里设置：\n"
            "  VR_WAN2_REPO_DIR=<Wan2.1 仓库路径>\n"
            "或在 VR_WEIGHTS_ROOT/wan2 下完成 clone。"
        )
    gen_script = repo_dir / "generate.py"
    if not gen_script.exists():
        return (
            f"Wan2.1 仓库不完整，找不到 generate.py:\n  {gen_script}\n"
            "请重新 git clone。"
        )

    if not settings.vace_model_dir:
        return (
            "VACE 权重路径未配置。请在 .env.local 中设置：\n"
            "  VR_VACE_MODEL_DIR=<Wan2.1-VACE-1.3B 权重目录>\n"
            "HuggingFace 仓库: Wan-AI/Wan2.1-VACE-1.3B"
        )

    model_dir = settings.vace_model_dir
    if not model_dir.exists():
        return f"VACE 权重目录不存在: {model_dir}"

    weight_files = list(model_dir.rglob("*.safetensors")) + list(model_dir.rglob("*.pt"))
    if not weight_files:
        return (
            f"VACE 权重目录存在但无权重文件: {model_dir}\n"
            "请执行：\n"
            "  huggingface-cli download Wan-AI/Wan2.1-VACE-1.3B --local-dir <目录>"
        )

    try:
        import torch
    except ImportError:
        return "torch 未安装，VACE 需要带 CUDA 的 torch。"
    if not torch.cuda.is_available():
        return (
            "torch 未检测到 CUDA 设备。VACE 需要 GPU。\n"
            "请安装 CUDA 版 torch：\n"
            "  pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124"
        )

    try:
        import flash_attn  # noqa: F401
    except ImportError:
        hints = _detect_flash_attn_build_hints(torch)
        hint_text = "\n".join(f"  - {item}" for item in hints)
        return (
            "当前 Wan2.1 VACE 环境缺少 flash-attn，官方 VACE 全量路径无法正常运行。\n"
            "请先在 video-replace-service 虚拟环境中补齐 flash-attn，或切换到 "
            "VR_REPLACE_MODE=lite 调试模式。\n"
            "当前环境诊断：\n"
            f"{hint_text}"
        )

    return None


def _resolve_venv_python() -> str:
    """Return the correct Python interpreter for subprocess launches."""
    prefix = Path(sys.prefix)
    candidate_win = prefix / "Scripts" / "python.exe"
    if candidate_win.exists():
        return str(candidate_win)
    candidate_posix = prefix / "bin" / "python"
    if candidate_posix.exists():
        return str(candidate_posix)
    return sys.executable


def _resolve_repo_dir(settings: "Settings") -> Path | None:
    """Return the Wan2.1 repo path if discoverable."""
    if settings.wan2_repo_dir:
        p = Path(settings.wan2_repo_dir)
        if p.exists():
            return p

    auto = Path(settings.weights_root) / "wan2" / "Wan2.1"
    if (auto / "generate.py").exists():
        return auto

    if settings.vace_model_dir:
        legacy = settings.vace_model_dir
        if legacy.exists() and (legacy / "generate.py").exists():
            return legacy

    return None


# ── Real replacement ───────────────────────────────────────────────────────


async def run_replacement_async(
    video_path: Path,
    masks_dir: Path,
    reference_path: Path,
    result_path: Path,
    *,
    settings: "Settings",
    sample_steps: int = 12,
    sample_size: str = "832*480",
    inference_fps: int = _DEFAULT_INFERENCE_FPS,
    max_frame_num: int = _DEFAULT_MAX_FRAME_NUM,
    base_seed: int | None = None,
    prompt: str | None = None,
    on_progress=None,
    on_pid: Callable[[int], Awaitable[None] | None] | None = None,
    on_message=None,
) -> Path:
    """Run VACE via Wan2.1's generate.py subprocess.

    Attempts to run with --offload_model False by default (VR_VACE_OFFLOAD_MODEL=auto).
    If the subprocess exits with a non-zero returncode and the log contains a
    CUDA OOM signature, the job is automatically retried WITH --offload_model True
    so it can finish at the cost of slower per-step speed.
    """
    repo_dir = _resolve_repo_dir(settings)
    if repo_dir is None:
        raise RuntimeError("Wan2.1 repo unresolved — preflight should have caught this")

    repo_dir_abs = repo_dir.resolve()
    gen_script = (repo_dir_abs / "generate.py").resolve()
    if not gen_script.exists():
        raise RuntimeError(f"Wan2.1 generate.py missing: {gen_script}")

    ckpt_dir = settings.vace_model_dir
    if ckpt_dir is None or not ckpt_dir.exists():
        raise RuntimeError("VACE ckpt_dir missing — preflight should have caught this")
    ckpt_dir_abs = Path(ckpt_dir).resolve()

    video_path_abs = Path(video_path).resolve()
    reference_path_abs = Path(reference_path).resolve()
    result_path_abs = Path(result_path).resolve()
    result_path_abs.parent.mkdir(parents=True, exist_ok=True)

    mask_video_path = result_path_abs.parent / f"_mask_{result_path_abs.stem}.mp4"
    await asyncio.to_thread(_frames_to_video, masks_dir, mask_video_path, video_path_abs)

    python_exe = _resolve_venv_python()
    effective_prompt = prompt or "将视频中的人物替换为参考图中的人物，保持动作流畅自然，背景不变。"

    effective_prompt = _build_effective_prompt(prompt)

    inference_fps = _normalize_inference_fps(inference_fps)
    max_frame_num = min(
        _DEFAULT_MAX_FRAME_NUM,
        _safe_int(max_frame_num, _DEFAULT_MAX_FRAME_NUM),
    )
    max_frame_num = _snap_wan_frame_num(max_frame_num)

    duration_s, source_frame_count, source_fps = await asyncio.to_thread(
        _probe_video_stats, video_path_abs
    )
    if duration_s > 0:
        frame_target = max(1, int(round(duration_s * inference_fps)))
    elif source_frame_count > 0:
        frame_target = source_frame_count
    else:
        frame_target = max_frame_num

    frame_candidates = [max_frame_num, frame_target]
    if source_frame_count > 0:
        frame_candidates.append(source_frame_count)
    effective_frame_num = _snap_wan_frame_num(min(frame_candidates))
    if effective_frame_num < 5 and (source_frame_count == 0 or source_frame_count >= 5):
        effective_frame_num = 5

    output_fps = (
        effective_frame_num / duration_s
        if duration_s > 0
        else float(inference_fps)
    )
    if not math.isfinite(output_fps) or output_fps <= 0:
        output_fps = float(inference_fps)

    frame_msg = (
        f"VACE 输入降帧：源 {source_frame_count or '?'} 帧"
        f" @ {source_fps:.2f}fps，推理 {effective_frame_num} 帧，"
        f"输出 {output_fps:.2f}fps"
    )
    logger.info("[vace-replacer] %s", frame_msg)
    if on_message is not None:
        try:
            res = on_message(frame_msg)
            if asyncio.iscoroutine(res):
                await res
        except Exception as cb_exc:  # noqa: BLE001
            logger.debug("[vace-replacer] on_message raised: %s", cb_exc)

    reference_for_vace_path = reference_path_abs
    reference_board_path = result_path_abs.parent / f"_ref_{result_path_abs.stem}.jpg"
    try:
        reference_for_vace_path = await asyncio.to_thread(
            _build_reference_board,
            reference_path_abs,
            video_path_abs,
            reference_board_path,
            sample_size=str(sample_size),
            settings=settings,
        )
        logger.info("[vace-replacer] prepared VACE reference board: %s", reference_for_vace_path)
        if on_message is not None:
            res = on_message("VACE reference image optimized: face, upper body, and full body crops enlarged.")
            if asyncio.iscoroutine(res):
                await res
    except Exception as exc:  # noqa: BLE001
        logger.warning("[vace-replacer] reference board preprocessing failed; using original image: %s", exc)

    env = os.environ.copy()
    env["PYTHONPATH"] = str(repo_dir_abs) + os.pathsep + env.get("PYTHONPATH", "")
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
    _sanitize_single_gpu_env(env)

    logger.info("[vace-replacer] cwd=%s python=%s", repo_dir_abs, python_exe)

    timeout_s = int(getattr(settings, "vace_subprocess_timeout_s", _DEFAULT_TIMEOUT_S) or 0)
    idle_timeout_s = int(getattr(settings, "vace_subprocess_idle_timeout_s", _DEFAULT_IDLE_TIMEOUT_S) or 0)

    spawn_kwargs: dict = {}
    if os.name == "nt":
        spawn_kwargs["creationflags"] = (
            subprocess.CREATE_NEW_PROCESS_GROUP
            | getattr(subprocess, "CREATE_NO_WINDOW", 0)
        )
    else:
        spawn_kwargs["start_new_session"] = True

    # ── Build command ────────────────────────────────────────────────────
    def _make_cmd(use_offload: bool) -> list[str]:
        cmd = [
            python_exe,
            str(gen_script),
            "--task", "vace-1.3B",
            "--ckpt_dir", str(ckpt_dir_abs),
            "--sample_steps", str(sample_steps),
            "--frame_num", str(effective_frame_num),
            "--output_fps", f"{output_fps:.6f}",
            "--size", str(sample_size),
            "--src_video", str(video_path_abs),
            "--src_mask", str(mask_video_path),
            "--src_ref_images", str(reference_for_vace_path),
            "--save_file", str(result_path_abs),
            "--t5_cpu",
        ]
        # Wan2.1 defaults to offload_model=True for single-GPU runs when the
        # flag is omitted. Always pass an explicit value so our watchdog logic
        # matches the mode the subprocess actually runs with.
        cmd += ["--offload_model", "True" if use_offload else "False"]
        if base_seed is not None:
            cmd += ["--base_seed", str(base_seed)]
        cmd += ["--prompt", effective_prompt]
        return cmd

    # ── Subprocess runner (inner coroutine, may be called twice) ────────
    async def _run_proc(
        cmd: list[str],
        log_fp,
        use_offload: bool,
        attempt: int,
    ):
        """Spawn generate.py once and supervise it.

        Returns (proc, killed_reason, killed_tag, saw_first_step).
        """

        # Per-step ETA tracking — timestamps when each vace_step line arrived.
        _step_arrivals: list[float] = []

        last_activity = time.monotonic()
        generation_started_at: float | None = None

        async def _tee(stream):
            """Stream subprocess stdout+stderr to log and parse progress/ETA."""
            nonlocal generation_started_at, last_activity
            if stream is None:
                return
            buf = b""
            while True:
                try:
                    chunk = await stream.read(512)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    logger.warning("[vace-replacer] tee read error: %s", exc)
                    break
                if not chunk:
                    if buf:
                        chunk = buf + b"\n"
                        buf = b""
                    else:
                        break

                buf += chunk
                parts = re.split(rb"[\r\n]", buf)
                complete_parts, buf = parts[:-1], parts[-1]

                for part in complete_parts:
                    if not part:
                        continue
                    last_activity = time.monotonic()
                    try:
                        log_fp.write(part + b"\n")
                        log_fp.flush()
                    except Exception:
                        pass
                    try:
                        text = part.decode("utf-8", errors="replace").strip()
                    except Exception:
                        text = repr(part)
                    if not text:
                        continue
                    logger.info("[vace] %s", text)

                    if "Generating video..." in text and generation_started_at is None:
                        generation_started_at = time.monotonic()
                        logger.info(
                            "[vace-replacer] attempt=%d entered sampling phase; first-step watchdog starts now",
                            attempt,
                        )

                    # ── Primary: parse explicit vace_step X/N output ───────
                    step_m = _VACE_STEP_RE.search(text)
                    if step_m:
                        cur_step = int(step_m.group(1))
                        tot_steps = int(step_m.group(2))
                        _step_arrivals.append(time.monotonic())
                        completed_steps = max(0, cur_step - 1)

                        # Compute real-time ETA from average of last ≤5 steps.
                        if len(_step_arrivals) >= 2:
                            n = min(5, len(_step_arrivals) - 1)
                            avg_secs = (_step_arrivals[-1] - _step_arrivals[-1 - n]) / n
                            remaining = tot_steps - cur_step
                            eta_secs = max(0.0, remaining * avg_secs)
                            mm = int(eta_secs // 60)
                            ss = int(eta_secs % 60)
                            eta_str = f"{mm}分{ss}秒" if mm > 0 else f"{ss}秒"
                            msg = f"VACE 推理：步 {cur_step}/{tot_steps}，预计还需 {eta_str}"
                        else:
                            msg = f"VACE 推理：步 {cur_step}/{tot_steps}…"

                        if completed_steps <= 0:
                            msg = "VACE 首步推理中：模型已进入第一步，12GB 显卡可能需要较长时间，请耐心等待。"

                        if on_message is not None:
                            try:
                                res = on_message(msg)
                                if asyncio.iscoroutine(res):
                                    await res
                            except Exception as cb_exc:
                                logger.warning("[vace-replacer] on_message raised: %s", cb_exc)

                        if on_progress is not None and tot_steps > 0:
                            mapped = 0.56 + (completed_steps / tot_steps) * 0.33
                            try:
                                res = on_progress(min(mapped, 0.89))
                                if asyncio.iscoroutine(res):
                                    await res
                            except Exception as cb_exc:
                                logger.warning("[vace-replacer] on_progress raised: %s", cb_exc)

                    elif on_progress is not None and sample_steps > 0:
                        # ── Fallback: parse tqdm progress bar ─────────────
                        m = _STEP_RE.search(text)
                        if m:
                            cur, tot = int(m.group(1)), int(m.group(2))
                            if tot == sample_steps and 0 < cur <= tot:
                                mapped = 0.56 + (cur / tot) * 0.33
                                try:
                                    res = on_progress(min(mapped, 0.89))
                                    if asyncio.iscoroutine(res):
                                        await res
                                except Exception as cb_exc:
                                    logger.warning("[vace-replacer] on_progress raised: %s", cb_exc)

        # ── Spawn subprocess ─────────────────────────────────────────────
        logger.info("[vace-replacer] cmd=%s", " ".join(cmd))
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(repo_dir_abs),
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            **spawn_kwargs,
        )
        child_pid = proc.pid
        logger.info(
            "[vace-replacer] subprocess pid=%s attempt=%d (timeout=%ss idle=%ss offload=%s)",
            child_pid, attempt, timeout_s, idle_timeout_s, use_offload,
        )

        if on_pid is not None:
            try:
                res = on_pid(child_pid)
                if asyncio.iscoroutine(res):
                    await res
            except Exception as cb_exc:
                logger.warning("[vace-replacer] on_pid callback raised: %s", cb_exc)

        # ── Heartbeat ────────────────────────────────────────────────────
        # Resets last_activity every 15 s to prevent idle-timeout misfires
        # while the GPU is running silently. Also provides time-based progress
        # estimates during model loading (before the first vace_step line).
        _heartbeat_start = time.monotonic()
        # Without --offload_model, RTX 4070 does ~3-5 s/step.
        # With    --offload_model, RTX 4070 does ~75-120 s/step.
        _secs_per_step = 75.0 if use_offload else 5.0
        _load_secs = 60.0
        _first_step_timeout_s = 1200.0 if use_offload else 420.0
        logger.info(
            "[vace-replacer] attempt=%d will use first-step watchdog %ss",
            attempt,
            _first_step_timeout_s,
        )

        async def _heartbeat() -> None:
            while proc.returncode is None:
                await asyncio.sleep(15)
                if proc.returncode is not None:
                    break
                if on_progress is not None:
                    elapsed = time.monotonic() - _heartbeat_start
                    denoising_elapsed = max(0.0, elapsed - _load_secs)
                    estimated_total = sample_steps * _secs_per_step
                    frac = (
                        min(denoising_elapsed / estimated_total, 0.98)
                        if estimated_total > 0
                        else 0.0
                    )
                    # Only push forward if real step tracking hasn't overtaken us
                    hb_mapped = 0.56 + frac * 0.33
                    if not _step_arrivals:
                        try:
                            cb = on_progress(min(hb_mapped, 0.89))
                            if asyncio.iscoroutine(cb):
                                await cb
                        except Exception as hb_exc:
                            logger.debug("[vace-replacer] heartbeat on_progress raised: %s", hb_exc)

        tee_task = asyncio.create_task(_tee(proc.stdout), name=f"vace-tee-{attempt}")
        heartbeat_task = asyncio.create_task(_heartbeat(), name=f"vace-heartbeat-{attempt}")
        killed_reason: str | None = None
        killed_tag: str | None = None

        try:
            deadline = time.monotonic() + timeout_s if timeout_s > 0 else None
            while proc.returncode is None:
                now = time.monotonic()
                if deadline is not None and now >= deadline:
                    killed_tag = "hard_timeout"
                    killed_reason = f"hard timeout ({timeout_s}s)"
                    break
                if (
                    not _step_arrivals
                    and generation_started_at is not None
                    and (now - generation_started_at) > _first_step_timeout_s
                ):
                    killed_tag = "first_step_timeout"
                    killed_reason = (
                        f"首个 VACE 采样步在 {_first_step_timeout_s:.0f}s 内未输出"
                    )
                    break
                if idle_timeout_s > 0 and (now - last_activity) > idle_timeout_s:
                    killed_tag = "idle_timeout"
                    killed_reason = f"子进程在 {idle_timeout_s}s 内没有新的 stdout/stderr 输出"
                    break

                slice_s = 15.0
                if deadline is not None:
                    slice_s = min(slice_s, max(1.0, deadline - now))
                try:
                    await asyncio.wait_for(asyncio.shield(proc.wait()), timeout=slice_s)
                except asyncio.TimeoutError:
                    continue
        except asyncio.CancelledError:
            killed_tag = "cancelled"
            killed_reason = "coroutine cancelled (shutdown/cancel)"
            raise
        finally:
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except BaseException:
                pass
            if killed_reason:
                logger.error("[vace-replacer] %s — killing tree pid=%s", killed_reason, child_pid)
                kill_process_tree(child_pid, reason=f"vace {killed_reason}")
            if proc.returncode is None:
                kill_process_tree(child_pid, reason="vace final-cleanup")
                try:
                    await asyncio.wait_for(proc.wait(), timeout=15)
                except Exception:
                    pass
            try:
                await asyncio.wait_for(tee_task, timeout=3)
            except Exception:
                tee_task.cancel()
                try:
                    await tee_task
                except BaseException:
                    pass

        return proc, killed_reason, killed_tag, bool(_step_arrivals)

    # ── Determine offload strategy ────────────────────────────────────────
    # auto  → try with --offload_model False first (faster on GPUs with enough VRAM).
    #         If CUDA OOM is detected in the log, transparently retry WITH offload.
    # true  → always use --offload_model (safe on ≤12 GB GPUs, slower).
    # false → never use --offload_model (fastest; may OOM on ≤12 GB GPUs).
    offload_env = str(getattr(settings, "vace_offload_model", "auto") or "auto").strip().lower()
    if offload_env not in {"auto", "true", "false"}:
        logger.warning(
            "[vace-replacer] invalid VR_VACE_OFFLOAD_MODEL=%r, falling back to auto",
            offload_env,
        )
        offload_env = "auto"
    use_offload_first = offload_env == "true"

    log_path = result_path_abs.parent / f"_vace_{result_path_abs.stem}.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logger.info("[vace-replacer] subprocess log: %s", log_path)

    # ── Attempt 1 ────────────────────────────────────────────────────────
    with open(log_path, "wb") as log_fp:
        proc, killed_reason, killed_tag, saw_first_step = await _run_proc(
            _make_cmd(use_offload_first), log_fp, use_offload_first, 1
        )

    # ── OOM auto-retry (attempt 2) ────────────────────────────────────────
    # Conditions: auto mode, first attempt failed cleanly (not killed by
    # watchdog), and the log actually contains an OOM signature.
    first_attempt_oom = _log_has_oom(log_path)
    retry_for_early_stall = (
        not saw_first_step and killed_tag in {"first_step_timeout", "idle_timeout"}
    )
    if (
        proc.returncode != 0
        and offload_env == "auto"
        and not use_offload_first
        and (first_attempt_oom or retry_for_early_stall)
    ):
        if first_attempt_oom:
            logger.warning(
                "[vace-replacer] attempt 1 exited with CUDA OOM — "
                "retrying with --offload_model True (slower but safe on ≤12 GB GPUs)"
            )
        else:
            logger.warning(
                "[vace-replacer] attempt 1 stalled before the first sampling step "
                "(tag=%s) — retrying with --offload_model True",
                killed_tag,
            )
        # Clear any partial output before the retry.
        if result_path_abs.exists():
            try:
                result_path_abs.unlink()
            except Exception:
                pass

        # Signal UI that we're retrying.
        if on_progress is not None:
            try:
                res = on_progress(0.56)
                if asyncio.iscoroutine(res):
                    await res
            except Exception:
                pass
        if on_message is not None:
            try:
                if first_attempt_oom:
                    retry_msg = "显存不足，切换到节省显存模式重试，速度较慢请耐心等待…"
                else:
                    retry_msg = "首个采样步长时间未输出，已自动切换到节省显存模式重试，请耐心等待…"
                res = on_message(retry_msg)
                if asyncio.iscoroutine(res):
                    await res
            except Exception:
                pass

        log_path = result_path_abs.parent / f"_vace_{result_path_abs.stem}_r2.log"
        logger.info("[vace-replacer] retry log: %s", log_path)
        with open(log_path, "wb") as log_fp:
            proc, killed_reason, killed_tag, saw_first_step = await _run_proc(
                _make_cmd(True), log_fp, True, 2
            )

    # ── Cleanup mask video ────────────────────────────────────────────────
    try:
        mask_video_path.unlink(missing_ok=True)
    except Exception:
        pass

    # ── Result validation ─────────────────────────────────────────────────
    if killed_reason is not None:
        raise RuntimeError(
            f"VACE 子进程被强制终止：{killed_reason}。\n"
            f"这通常意味着模型推理卡死或显存耗尽。\n"
            f"详细日志：{log_path}"
        )

    if proc.returncode != 0:
        tail_lines: list[str] = []
        try:
            raw = log_path.read_bytes()
            text = raw.decode("utf-8", errors="replace")
            tail_lines = text.splitlines()[-20:]
        except Exception:
            pass
        tail_text = (
            "\n".join(tail_lines).strip()
            or "(subprocess produced no output — likely a CUDA OOM / segfault)"
        )
        raise RuntimeError(
            f"Wan2.1 generate.py failed (returncode={proc.returncode}).\n"
            f"Last output lines:\n{tail_text}\n"
            f"Full log: {log_path}"
        )
    if not result_path_abs.exists() or result_path_abs.stat().st_size < 1024:
        raise RuntimeError(f"VACE 未生成输出文件: {result_path_abs}")

    logger.info(
        "[vace-replacer] wrote %s (%d bytes)",
        result_path_abs, result_path_abs.stat().st_size,
    )
    return result_path_abs


def _frames_to_video(
    frames_dir: Path,
    output_path: Path,
    source_video_path: Path,
) -> None:
    """Convert per-frame PNG masks into a grayscale-encoded mp4 for VACE."""
    import cv2

    from ...services import cv2_io

    cap = cv2.VideoCapture(str(source_video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(output_path), fourcc, fps, (frame_w, frame_h))

    mask_files = sorted(frames_dir.glob("frame_*.png"))
    for mf in mask_files:
        mask = cv2_io.imread(mf, cv2.IMREAD_GRAYSCALE)
        if mask is None:
            continue
        if mask.shape != (frame_h, frame_w):
            mask = cv2.resize(mask, (frame_w, frame_h))
        mask_bgr = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
        writer.write(mask_bgr)

    writer.release()
