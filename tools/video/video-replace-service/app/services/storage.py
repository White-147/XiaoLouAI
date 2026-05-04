"""
Filesystem-backed object storage abstraction.

All writes land under `Settings.storage_root`. Each accessor returns the
absolute on-disk path; URL mapping goes through the matching `*_url` helper
(e.g. /uploads/ab.mp4) which is served via StaticFiles in app/main.py.
"""
from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import BinaryIO

from ..config import Settings


class Storage:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    # ── Paths ─────────────────────────────────────────────────────────
    def upload_path(self, name: str) -> Path:
        return self.settings.upload_dir / name

    def thumbnail_path(self, name: str) -> Path:
        return self.settings.thumbnail_dir / name

    def candidate_path(self, name: str) -> Path:
        return self.settings.candidate_dir / name

    def keyframe_path(self, name: str) -> Path:
        return self.settings.keyframe_dir / name

    def reference_path(self, name: str) -> Path:
        return self.settings.reference_dir / name

    # ── Writers ───────────────────────────────────────────────────────
    def save_stream(self, src: BinaryIO, dst: Path) -> Path:
        dst.parent.mkdir(parents=True, exist_ok=True)
        with dst.open("wb") as f:
            while True:
                chunk = src.read(1 << 20)  # 1 MiB
                if not chunk:
                    break
                f.write(chunk)
        return dst

    def copy_into(self, src: Path, dst: Path) -> Path:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        return dst

    # ── Name generators ───────────────────────────────────────────────
    @staticmethod
    def new_name(ext: str) -> str:
        return f"{uuid.uuid4().hex}{ext if ext.startswith('.') else '.' + ext}"

    # ── URL helpers (must match StaticFiles mounts in app/main.py) ────
    # Prefix is `/vr-*` to avoid colliding with core-api's `/uploads/`
    # when both services are proxied from the same frontend origin.
    @staticmethod
    def upload_url(name: str) -> str:
        return f"/vr-uploads/{name}"

    @staticmethod
    def thumbnail_url(name: str) -> str:
        return f"/vr-thumbnails/{name}"

    @staticmethod
    def candidate_url(name: str) -> str:
        return f"/vr-candidates/{name}"

    @staticmethod
    def keyframe_url(name: str) -> str:
        return f"/vr-keyframes/{name}"

    @staticmethod
    def reference_url(name: str) -> str:
        return f"/vr-references/{name}"

    def mask_path(self, name: str) -> Path:
        return self.settings.mask_dir / name

    def result_path(self, name: str) -> Path:
        return self.settings.result_dir / name

    def final_path(self, name: str) -> Path:
        return self.settings.final_dir / name

    @staticmethod
    def mask_url(name: str) -> str:
        return f"/vr-masks/{name}"

    @staticmethod
    def result_url(name: str) -> str:
        return f"/vr-results/{name}"

    @staticmethod
    def final_url(name: str) -> str:
        return f"/vr-finals/{name}"
