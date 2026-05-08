"""API-level Pydantic models (request & response envelopes).

Revised 2026-04-19 per 《rtx_4070_本地mvp方案》 Section 十:
- Removed placeholder fields: fusion_strength / motion_smoothing / lighting_match
- Added real parameters that map 1:1 to YOLOv8 / SAM2 / Wan2.1-VACE:
    yolo_conf, sam2_size, mask_dilation_px, mask_blur_px,
    sample_steps, sample_size, base_seed
"""
from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Core enums
# ---------------------------------------------------------------------------
class JobStage(str, Enum):
    UPLOADED = "uploaded"
    DETECTING = "detecting"
    DETECTED = "detected"
    QUEUED = "queued"          # user pressed generate; awaits full pipeline
    TRACKING = "tracking"
    MASK_READY = "mask_ready"
    REPLACING = "replacing"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


Sam2Size = Literal["tiny", "small", "base_plus"]
# Wan2.1 `--size` convention is `width*height`.
# 480P default:  horizontal 832*480, vertical 480*832
SampleSize = Literal["832*480", "480*832"]


# ---------------------------------------------------------------------------
# Upload (source video)
# ---------------------------------------------------------------------------
class VideoMeta(BaseModel):
    duration_seconds: float
    width: int
    height: int
    fps: float
    frame_count: int
    codec: str | None = None


class UploadResponse(BaseModel):
    job_id: str
    video_url: str
    thumbnail_url: str | None = None
    meta: VideoMeta


# ---------------------------------------------------------------------------
# Reference image upload (replacement character)
# ---------------------------------------------------------------------------
class ReferenceUploadResponse(BaseModel):
    url: str
    filename: str
    content_type: str
    size_bytes: int


# ---------------------------------------------------------------------------
# Import an existing video/image from core-api (or any HTTP URL)
# ---------------------------------------------------------------------------
class ImportJobRequest(BaseModel):
    """Create a new job from an already-hosted video (e.g. a project asset)."""

    video_url: str = Field(
        ...,
        description="Either a relative /uploads/… path on core-api, or an absolute http(s) URL",
    )
    original_filename: str | None = None


class ImportReferenceRequest(BaseModel):
    """Pin an existing image (e.g. a project asset) as the replacement character."""

    image_url: str = Field(..., description="Relative /uploads/… path or absolute URL")
    original_filename: str | None = None


# ---------------------------------------------------------------------------
# Detection invocation
# ---------------------------------------------------------------------------
class DetectRequest(BaseModel):
    """Optional override for per-call YOLO confidence threshold."""

    yolo_conf: float | None = Field(default=None, ge=0.05, le=0.95)


# ---------------------------------------------------------------------------
# Detection — real YOLOv8 results, NOT hardcoded
# ---------------------------------------------------------------------------
class PersonCandidate(BaseModel):
    """Represents one detected person on the keyframe.

    Always derived from a real detector pass. `preview_url` points to a JPEG
    crop persisted under /thumbnails/. `mask_preview_url` is reserved for a
    future SAM2 segmentation step; while unimplemented it stays None.
    """

    person_id: str
    bbox: list[float]               # [x1, y1, x2, y2] in pixel coords on the keyframe
    confidence: float
    preview_url: str
    mask_preview_url: str | None = None


class DetectionResult(BaseModel):
    job_id: str
    keyframe_index: int
    keyframe_url: str
    candidates: list[PersonCandidate]


# ---------------------------------------------------------------------------
# Generate
# ---------------------------------------------------------------------------
class GenerateRequest(BaseModel):
    """
    Submitted when the user has:
      - selected a source person from DetectionResult.candidates
      - chosen a replacement character (a reference image already uploaded)
      - picked real advanced parameters whose each field maps 1:1
        to a backend pipeline consumer.
    """

    source_person_id: str
    target_reference_url: str
    prompt: str | None = Field(
        default=None,
        description="Optional free-form prompt appended to the VACE condition.",
    )

    # ── Real advanced parameters (each must be consumed by the pipeline) ──
    # YOLOv8 person-detection confidence threshold (Ultralytics `conf`).
    yolo_conf: float = Field(default=0.40, ge=0.05, le=0.95)

    # SAM2 checkpoint size (tracking precision vs. VRAM tradeoff).
    sam2_size: Sam2Size = "tiny"

    # Mask morphological post-processing (cv2.dilate kernel, px).
    mask_dilation_px: int = Field(default=5, ge=0, le=64)

    # Mask edge feathering (Gaussian blur sigma, px).
    mask_blur_px: int = Field(default=4, ge=0, le=64)

    # Wan2.1 `--sample_steps` — denoising steps.
    sample_steps: int = Field(default=12, ge=10, le=60)

    # Wan2.1 `--size`. 720p intentionally not listed — RTX 4070 cannot host it.
    sample_size: SampleSize = "832*480"

    # Input video is uniformly sampled before VACE to reduce temporal VRAM.
    inference_fps: Literal[15, 30, 60] = 15

    # Wan2.1 temporal length cap. Values must ultimately be snapped to 4n+1.
    max_frame_num: int = Field(default=21, ge=5, le=21)

    # Wan2.1 `--base_seed`. None = let the model sample randomly.
    base_seed: int | None = None


class GenerateResponse(BaseModel):
    job_id: str
    stage: JobStage
    message: str | None = None


# ---------------------------------------------------------------------------
# Job status
# ---------------------------------------------------------------------------
class JobStatus(BaseModel):
    job_id: str
    stage: JobStage
    progress: float = 0.0
    message: str | None = None
    error: str | None = None
    created_at: datetime
    updated_at: datetime

    # Populated progressively:
    source_video_url: str | None = None
    thumbnail_url: str | None = None
    meta: VideoMeta | None = None
    detection: DetectionResult | None = None

    # User selections (after POST /generate):
    source_person_id: str | None = None
    target_reference_url: str | None = None
    advanced: dict[str, Any] | None = None

    # Final outputs (populated only if full pipeline completes):
    mask_preview_url: str | None = None
    # `result_video_url` and `result_download_url` intentionally alias the
    # final (browser-compat, audio-muxed) deliverable so existing UI code
    # keeps working. `raw_result_video_url` exposes the un-transcoded
    # pipeline artifact for debugging.
    result_video_url: str | None = None
    result_download_url: str | None = None
    raw_result_video_url: str | None = None
    final_result_video_url: str | None = None
    final_result_download_url: str | None = None

    # Which pipeline actually ran. "full" = SAM2 + VACE, "lite" = OpenCV
    # fallback (advisory — the UI must flag this to the user). None until
    # the pipeline finishes.
    mode: Literal["full", "lite"] | None = None
    tracker_backend: str | None = None
    replacer_backend: str | None = None


# ---------------------------------------------------------------------------
# Generic envelope (mirrors core-api style)
# ---------------------------------------------------------------------------
class Envelope(BaseModel):
    success: bool = True
    data: Any | None = None
    error: dict | None = None


def ok(data: Any) -> dict:
    # FastAPI auto-serialises dicts faster than BaseModel for the envelope.
    return {"success": True, "data": data, "error": None}


def fail(code: str, message: str, status: int = 400) -> dict:
    return {
        "success": False,
        "data": None,
        "error": {"code": code, "message": message, "status": status},
    }


# ---------------------------------------------------------------------------
# SSE event payload
# ---------------------------------------------------------------------------
class JobEvent(BaseModel):
    type: Literal["progress", "stage", "error", "complete"]
    job_id: str
    stage: JobStage
    progress: float = 0.0
    message: str | None = None
    payload: dict | None = None
