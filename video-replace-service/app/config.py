"""Settings loaded from environment / .env.local via pydantic-settings."""
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="VR_",
        env_file=(".env.local", ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── API server (LEGACY 4200 FastAPI variant only) ─────────────────
    # The default architecture is core-api 4100-native. These fields are
    # consumed only by run_api.py / app/main.py, which are gated behind
    # VR_LEGACY_STANDALONE=1. See ./app/main.py top-of-file banner.
    host: str = "127.0.0.1"
    port: int = 4201  # moved off 4200 so a misconfigured debug run can't
                      # quietly occupy the historical sidecar port and
                      # confuse operators into thinking it's "the service".
    cors_origins: str = "http://localhost:4100,http://127.0.0.1:4100"

    # ── Storage ────────────────────────────────────────────────────────
    storage_root: Path = Path("./data")
    weights_root: Path = Path("./weights")
    max_upload_mb: int = 200

    # ── Task database ──────────────────────────────────────────────────
    database_url: str = "postgres://root:root@127.0.0.1:5432/xiaolou"

    # ── Video limits ───────────────────────────────────────────────────
    max_video_seconds: int = 15

    # ── External service origins (for URL imports) ────────────────────
    core_api_base_url: str = "http://127.0.0.1:4100"

    # ── YOLOv8 detection ───────────────────────────────────────────────
    yolo_weights: str = "yolov8n.pt"
    yolo_conf_default: float = 0.40
    yolo_device: str = "cpu"
    detection_keyframe: str = "middle"
    candidate_preview_short_edge: int = 240

    # ── SAM2 ───────────────────────────────────────────────────────────
    sam2_size_default: str = "tiny"
    sam2_checkpoint_tiny: Path | None = None
    sam2_checkpoint_small: Path | None = None
    sam2_checkpoint_base_plus: Path | None = None
    sam2_auto_download: bool = True

    # ── VACE / Wan2.1 ──────────────────────────────────────────────────
    vace_model_dir: Path | None = None
    # Directory containing a clone of https://github.com/Wan-Video/Wan2.1
    wan2_repo_dir: Path | None = None

    # ── Pipeline mode ──────────────────────────────────────────────────
    # full = require SAM2 + VACE, fail clearly on missing deps / weights.
    # lite = legacy fallback (OpenCV CSRT + OpenCV compositor), explicit only.
    # auto = prefer full; if full prerequisites are missing, mark job as
    #        succeeded-in-lite but with the mode="lite" flag surfaced so the
    #        UI shows it was NOT a real deep-learning run.
    replace_mode: Literal["full", "lite", "auto"] = "full"

    # Finalization (browser-compat transcode + audio mux)
    finalize_video_preset: str = "veryfast"
    finalize_video_crf: int = 20

    # ── Subprocess safety rails (VACE / Wan2.1 generate.py) ────────────
    # auto  = try fast non-offload first; retry with offload on OOM/stall.
    # true  = always offload (recommended for 12 GB GPUs).
    # false = never offload (fastest, but easy to OOM on 12 GB GPUs).
    vace_offload_model: Literal["auto", "true", "false"] = "auto"

    # Hard wall clock the VACE subprocess is allowed to run before we
    # forcefully tear the whole process tree down. 0 = disabled (not
    # recommended; previous bug was exactly an unbounded wait).
    vace_subprocess_timeout_s: int = 3600  # 1 hour
    # If the subprocess produces no stdout/stderr for this many seconds we
    # treat it as hung and kill the tree. VACE prints per-step progress, so
    # silence for 10 minutes reliably indicates a dead loop or GPU hang.
    vace_subprocess_idle_timeout_s: int = 600

    # ── Derived paths ──────────────────────────────────────────────────
    @property
    def upload_dir(self) -> Path:
        return self.storage_root / "uploads"

    @property
    def thumbnail_dir(self) -> Path:
        return self.storage_root / "thumbnails"

    @property
    def candidate_dir(self) -> Path:
        return self.storage_root / "candidates"

    @property
    def keyframe_dir(self) -> Path:
        return self.storage_root / "keyframes"

    @property
    def reference_dir(self) -> Path:
        return self.storage_root / "references"

    @property
    def mask_dir(self) -> Path:
        return self.storage_root / "masks"

    @property
    def result_dir(self) -> Path:
        return self.storage_root / "results"

    @property
    def final_dir(self) -> Path:
        return self.storage_root / "finals"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    for d in (
        settings.upload_dir,
        settings.thumbnail_dir,
        settings.candidate_dir,
        settings.keyframe_dir,
        settings.reference_dir,
        settings.mask_dir,
        settings.result_dir,
        settings.final_dir,
        settings.weights_root,
    ):
        d.mkdir(parents=True, exist_ok=True)
    return settings
