"""
Video metadata / keyframe / thumbnail helpers based on OpenCV.

We deliberately avoid shelling out to ffmpeg for the MVP because the dev
machine doesn't have ffmpeg on PATH. Every function here reads frames
through cv2.VideoCapture and writes JPEGs via our Unicode-safe ``cv2_io``
helpers (plain ``cv2.imwrite`` silently fails for paths containing non-ASCII
characters on Windows — our repo path contains "小楼WEB").

Returns raw absolute file paths; URL mapping is the caller's responsibility.
"""
from __future__ import annotations

from pathlib import Path

import cv2

from . import cv2_io
from ..schemas import VideoMeta


class VideoError(RuntimeError):
    pass


def probe(video_path: Path) -> VideoMeta:
    """Read width / height / fps / frame_count via cv2.VideoCapture."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise VideoError(f"无法打开视频文件: {video_path}")
    try:
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = float(cap.get(cv2.CAP_PROP_FPS)) or 0.0
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        # FOURCC → codec name
        fourcc_int = int(cap.get(cv2.CAP_PROP_FOURCC))
        codec = (
            "".join([chr((fourcc_int >> (8 * i)) & 0xFF) for i in range(4)]).strip()
            if fourcc_int
            else None
        )

        duration_seconds = frame_count / fps if fps > 0 else 0.0
        return VideoMeta(
            duration_seconds=round(duration_seconds, 3),
            width=width,
            height=height,
            fps=round(fps, 3),
            frame_count=frame_count,
            codec=codec or None,
        )
    finally:
        cap.release()


def choose_keyframe_index(frame_count: int, strategy: str = "middle") -> int:
    """Pick a keyframe index based on strategy.

    Supported values of `strategy`:
    - 'middle' — centre frame
    - 'first'  — frame 0
    - float-str in [0,1] — relative position
    """
    if frame_count <= 0:
        return 0
    s = (strategy or "middle").strip().lower()
    if s == "first":
        return 0
    if s == "middle":
        return frame_count // 2
    try:
        ratio = max(0.0, min(1.0, float(s)))
        return max(0, min(frame_count - 1, int(frame_count * ratio)))
    except ValueError:
        return frame_count // 2


def extract_frame(video_path: Path, frame_index: int, dst: Path) -> Path:
    """Extract a single frame as JPEG. Raises VideoError on failure."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise VideoError(f"无法打开视频文件: {video_path}")
    try:
        cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, frame_index))
        ok, frame = cap.read()
        if not ok or frame is None:
            raise VideoError(f"读取第 {frame_index} 帧失败: {video_path}")
        try:
            wrote = cv2_io.imwrite(dst, frame, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
        except OSError as exc:
            raise VideoError(str(exc)) from exc
        if not wrote:
            raise VideoError(f"cv2.imencode 写入第 {frame_index} 帧失败: {dst}")
        return dst
    finally:
        cap.release()


def make_thumbnail(video_path: Path, dst: Path, *, short_edge: int = 360) -> Path:
    """Save a thumbnail (JPEG) using the middle frame, scaled to short_edge."""
    meta = probe(video_path)
    kf_idx = choose_keyframe_index(meta.frame_count, "middle")

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise VideoError(f"无法打开视频文件: {video_path}")
    try:
        cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, kf_idx))
        ok, frame = cap.read()
        if not ok or frame is None:
            raise VideoError("读取关键帧失败")

        h, w = frame.shape[:2]
        if min(h, w) > short_edge:
            if h < w:
                new_h = short_edge
                new_w = int(round(w * short_edge / h))
            else:
                new_w = short_edge
                new_h = int(round(h * short_edge / w))
            frame = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)

        dst.parent.mkdir(parents=True, exist_ok=True)
        try:
            wrote = cv2_io.imwrite(dst, frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        except OSError as exc:
            raise VideoError(str(exc)) from exc
        if not wrote:
            raise VideoError(f"cv2.imencode 写入缩略图失败: {dst}")
        return dst
    finally:
        cap.release()


def crop_and_save(
    src_image: Path,
    bbox: tuple[float, float, float, float],
    dst: Path,
    *,
    short_edge: int | None = None,
    padding_ratio: float = 0.08,
) -> Path:
    """Crop a bbox region from an image, with a small padding margin, and save as JPEG."""
    img = cv2_io.imread(src_image)
    if img is None:
        raise VideoError(f"无法读取图像: {src_image}")

    h, w = img.shape[:2]
    x1, y1, x2, y2 = bbox
    bx = max(0.0, x2 - x1) * padding_ratio
    by = max(0.0, y2 - y1) * padding_ratio
    cx1 = max(0, int(round(x1 - bx)))
    cy1 = max(0, int(round(y1 - by)))
    cx2 = min(w, int(round(x2 + bx)))
    cy2 = min(h, int(round(y2 + by)))
    if cx2 <= cx1 or cy2 <= cy1:
        raise VideoError(f"无效 bbox {bbox} on image {w}x{h}")

    crop = img[cy1:cy2, cx1:cx2]
    if short_edge is not None and short_edge > 0:
        ch, cw = crop.shape[:2]
        if min(ch, cw) > short_edge:
            if ch < cw:
                nh = short_edge
                nw = int(round(cw * short_edge / ch))
            else:
                nw = short_edge
                nh = int(round(ch * short_edge / cw))
            crop = cv2.resize(crop, (nw, nh), interpolation=cv2.INTER_AREA)

    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        wrote = cv2_io.imwrite(dst, crop, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
    except OSError as exc:
        raise VideoError(str(exc)) from exc
    if not wrote:
        raise VideoError(f"cv2.imencode 写入裁剪图失败: {dst}")
    return dst
