"""Direct streaming downloader for the remaining T5 weight.

Avoids the HF Hub / hf_transfer path that was getting wedged on this box.
Writes a `.partial` file next to the target so it can be resumed by re-running.
"""
from __future__ import annotations

import os
import sys
import time
import urllib.request
from pathlib import Path

URL = "https://huggingface.co/Wan-AI/Wan2.1-VACE-1.3B/resolve/main/models_t5_umt5-xxl-enc-bf16.pth"
OUT = Path(__file__).resolve().parent.parent / "weights" / "vace-1.3B" / "models_t5_umt5-xxl-enc-bf16.pth"


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    partial = OUT.with_suffix(OUT.suffix + ".partial")

    existing = partial.stat().st_size if partial.exists() else 0
    req = urllib.request.Request(URL, headers={"Range": f"bytes={existing}-"} if existing else {})
    req.add_header("User-Agent", "xiaolou-vr/1.0")

    print(f"[t5] resuming at {existing / 1024 / 1024:.1f} MB")
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=60) as resp:
        total_hdr = resp.headers.get("Content-Length")
        remaining = int(total_hdr) if total_hdr else None
        total = (remaining or 0) + existing
        print(f"[t5] total={total / 1024 / 1024:.1f} MB, streaming...")
        mode = "ab" if existing else "wb"
        with partial.open(mode) as f:
            written = existing
            last = time.time()
            while True:
                chunk = resp.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
                written += len(chunk)
                now = time.time()
                if now - last > 5:
                    speed = (written - existing) / max(1e-6, now - t0) / 1024 / 1024
                    pct = (written / total * 100) if total else 0
                    print(f"[t5] {written / 1024 / 1024:>8.0f}/{total / 1024 / 1024:>8.0f} MB  {pct:5.1f}%  {speed:4.1f} MB/s")
                    sys.stdout.flush()
                    last = now
    partial.replace(OUT)
    print(f"[t5] DONE → {OUT}  ({OUT.stat().st_size / 1024 / 1024:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
