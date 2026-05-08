"""
Real YOLOv8 person detector (Ultralytics).

Contract:
  detector = YOLODetector(weights="yolov8n.pt", device="cpu")
  detector.load()                # imports ultralytics lazily; downloads weights on first call
  boxes = detector.detect(image_path, conf=0.4)
  detector.unload()              # frees memory + (if cuda) vram; safe to re-call load()

On import the module does NOT load ultralytics; all heavy work is deferred
until `load()`. This keeps service startup fast and lets us test non-GPU
paths even if ultralytics isn't installed yet — the first call will fail
with a clear actionable error.
"""
from __future__ import annotations

import gc
from dataclasses import dataclass
from pathlib import Path


@dataclass
class DetectedBox:
    x1: float
    y1: float
    x2: float
    y2: float
    confidence: float
    class_id: int


class YOLODetectorError(RuntimeError):
    pass


class YOLODetector:
    """Lazy wrapper around ultralytics.YOLO('yolov8n.pt')."""

    # The 'person' class ID in COCO is 0 — don't change unless you switch to a custom model.
    PERSON_CLASS_ID = 0

    def __init__(self, weights: str = "yolov8n.pt", device: str = "cpu") -> None:
        self.weights = weights
        self.device = device
        self._model: "YOLO | None" = None  # noqa: F821  (forward string ref)

    # ── Lifecycle ────────────────────────────────────────────────────
    def load(self) -> None:
        if self._model is not None:
            return
        try:
            from ultralytics import YOLO  # type: ignore
        except ImportError as exc:
            raise YOLODetectorError(
                "ultralytics is not installed. Run: pip install ultralytics"
            ) from exc

        try:
            self._model = YOLO(self.weights)
        except Exception as exc:  # noqa: BLE001 — network / disk / weights errors
            raise YOLODetectorError(
                f"加载 YOLO 权重失败 (weights={self.weights}): {exc}"
            ) from exc

    def unload(self) -> None:
        self._model = None
        try:
            import torch  # type: ignore

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass
        gc.collect()

    # ── Inference ─────────────────────────────────────────────────────
    def detect(
        self,
        image_path: Path,
        *,
        conf: float = 0.40,
        iou: float = 0.45,
        max_detections: int = 10,
    ) -> list[DetectedBox]:
        """Run YOLOv8 on a single image and return person-class boxes sorted by confidence."""
        if self._model is None:
            raise YOLODetectorError("detector not loaded; call load() first")

        # Ultralytics returns a Results list; for a single image we get one result.
        results = self._model.predict(
            source=str(image_path),
            conf=float(conf),
            iou=float(iou),
            classes=[self.PERSON_CLASS_ID],
            device=self.device,
            verbose=False,
        )

        if not results:
            return []

        r0 = results[0]
        boxes_attr = getattr(r0, "boxes", None)
        if boxes_attr is None or len(boxes_attr) == 0:
            return []

        xyxy = boxes_attr.xyxy.cpu().numpy()
        confs = boxes_attr.conf.cpu().numpy()
        cls = boxes_attr.cls.cpu().numpy().astype(int)

        out: list[DetectedBox] = []
        for (x1, y1, x2, y2), c, k in zip(xyxy, confs, cls, strict=False):
            if int(k) != self.PERSON_CLASS_ID:
                continue
            out.append(
                DetectedBox(
                    x1=float(x1),
                    y1=float(y1),
                    x2=float(x2),
                    y2=float(y2),
                    confidence=float(c),
                    class_id=int(k),
                )
            )

        out.sort(key=lambda b: b.confidence, reverse=True)
        return out[:max_detections]
