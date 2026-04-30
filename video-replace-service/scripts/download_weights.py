"""
Download helper for SAM2 + Wan2.1-VACE-1.3B weights.

Idempotent — safely resumes partial downloads. Run standalone:

    .\.venv\Scripts\python.exe scripts\download_weights.py --all
    .\.venv\Scripts\python.exe scripts\download_weights.py --sam2
    .\.venv\Scripts\python.exe scripts\download_weights.py --vace
    .\.venv\Scripts\python.exe scripts\download_weights.py --wan2-repo

Uses huggingface_hub snapshot_download, which stores files in a cache and
then hard-links into local_dir. Re-running skips already-downloaded shards.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parent.parent  # .../video-replace-service
DEFAULT_WEIGHTS = ROOT / "weights"


def _hf():
    try:
        from huggingface_hub import hf_hub_download, snapshot_download
        return hf_hub_download, snapshot_download
    except ImportError:
        print("huggingface_hub not installed. run: pip install huggingface_hub", file=sys.stderr)
        sys.exit(2)


def download_sam2(weights_dir: Path, size: str = "tiny") -> Path:
    hf_hub_download, _ = _hf()
    repos = {
        "tiny":      ("facebook/sam2.1-hiera-tiny",      "sam2.1_hiera_tiny.pt"),
        "small":     ("facebook/sam2.1-hiera-small",     "sam2.1_hiera_small.pt"),
        "base_plus": ("facebook/sam2.1-hiera-base-plus", "sam2.1_hiera_base_plus.pt"),
        "large":     ("facebook/sam2.1-hiera-large",     "sam2.1_hiera_large.pt"),
    }
    repo_id, filename = repos[size]
    out_dir = weights_dir / "sam2"
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"[sam2] {repo_id}/{filename} → {out_dir}")
    p = hf_hub_download(repo_id=repo_id, filename=filename, local_dir=str(out_dir))
    print(f"[sam2] done: {p}")
    return Path(p)


def download_vace(weights_dir: Path, model: str = "1.3B") -> Path:
    _, snapshot_download = _hf()
    repos = {
        "1.3B": "Wan-AI/Wan2.1-VACE-1.3B",
        "14B":  "Wan-AI/Wan2.1-VACE-14B",
    }
    repo_id = repos[model]
    out_dir = weights_dir / f"vace-{model}"
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"[vace] {repo_id} → {out_dir} (this can be several GB; resumable)")
    p = snapshot_download(repo_id=repo_id, local_dir=str(out_dir))
    print(f"[vace] done: {p}")
    return Path(p)


def clone_wan2_repo(weights_dir: Path) -> Path:
    target = weights_dir / "wan2" / "Wan2.1"
    if (target / "generate.py").exists():
        print(f"[wan2] already cloned: {target}")
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    print(f"[wan2] cloning https://github.com/Wan-Video/Wan2.1.git → {target}")
    subprocess.check_call([
        "git", "clone", "--depth", "1",
        "https://github.com/Wan-Video/Wan2.1.git",
        str(target),
    ])
    return target


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights-dir", default=str(DEFAULT_WEIGHTS))
    ap.add_argument("--sam2-size", default="tiny",
                    choices=["tiny", "small", "base_plus", "large"])
    ap.add_argument("--vace-size", default="1.3B", choices=["1.3B", "14B"])
    ap.add_argument("--sam2", action="store_true")
    ap.add_argument("--vace", action="store_true")
    ap.add_argument("--wan2-repo", action="store_true", dest="wan2_repo")
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()

    weights_dir = Path(args.weights_dir)
    weights_dir.mkdir(parents=True, exist_ok=True)

    if not (args.sam2 or args.vace or args.wan2_repo or args.all):
        ap.print_help()
        return 1

    if args.all or args.sam2:
        download_sam2(weights_dir, args.sam2_size)
    if args.all or args.wan2_repo:
        clone_wan2_repo(weights_dir)
    if args.all or args.vace:
        download_vace(weights_dir, args.vace_size)
    return 0


if __name__ == "__main__":
    # Avoid the PowerShell progress bar eating terminal width.
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "0")
    sys.exit(main())
