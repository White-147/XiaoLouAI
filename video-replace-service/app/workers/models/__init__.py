"""Model runners used by the replace pipeline.

Each submodule exposes:
  - preflight(settings) -> str | None     (None means "ready")
  - run_tracking(...) or run_replacement_*  (real inference)

Runners are imported on demand from replace_runner.py so that the FastAPI
process can boot even when optional deep-learning dependencies (sam2,
Wan2.1/VACE) are still being installed.
"""
from . import opencv_replacer, opencv_tracker, sam2_tracker, vace_replacer, yolo_detector

__all__ = [
    "opencv_replacer",
    "opencv_tracker",
    "sam2_tracker",
    "vace_replacer",
    "yolo_detector",
]
