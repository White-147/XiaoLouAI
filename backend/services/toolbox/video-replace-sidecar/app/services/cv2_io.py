"""
cv2_io.py — Unicode-safe wrappers around cv2.imread / cv2.imwrite.

The vanilla ``cv2.imread`` / ``cv2.imwrite`` go through C++ ``fopen()``, which on
Windows uses the ANSI code page and silently fails for paths containing
non-ASCII characters (our repo path contains "小楼WEB"). The failure mode is
particularly nasty — ``imwrite`` returns ``False`` without raising, so callers
that don't inspect the return value (and none of ours did) happily report
success while **no file was written**.

All video-replace code paths should use these helpers instead of cv2.imread /
cv2.imwrite directly. Both work on ASCII paths too, so they are drop-in safe.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import cv2
import numpy as np


def imread(path: str | Path, flags: int = cv2.IMREAD_COLOR) -> np.ndarray | None:
    """Unicode-safe replacement for cv2.imread. Returns None on failure."""
    try:
        buf = np.fromfile(str(path), dtype=np.uint8)
    except (FileNotFoundError, OSError):
        return None
    if buf.size == 0:
        return None
    img = cv2.imdecode(buf, flags)
    return img if img is not None else None


def imwrite(
    path: str | Path,
    image: np.ndarray,
    params: list[int] | None = None,
) -> bool:
    """Unicode-safe replacement for cv2.imwrite.

    Unlike the original, this:
    - Correctly handles non-ASCII paths on Windows.
    - Raises ``OSError`` if encoding succeeded but the file wasn't actually
      written / is 0 bytes (so silent failures become loud).
    """
    p = Path(path)
    ext = p.suffix.lower() or ".jpg"
    p.parent.mkdir(parents=True, exist_ok=True)

    ok, buf = cv2.imencode(ext, image, params or [])
    if not ok or buf is None:
        return False

    # numpy.tofile handles Unicode paths natively via Python's open().
    buf.tofile(str(p))

    # Loud verification — if something still slipped through we want to know.
    if not p.exists() or p.stat().st_size == 0:
        raise OSError(f"cv2_io.imwrite wrote 0 bytes: {p}")

    return True


__all__ = ["imread", "imwrite"]
