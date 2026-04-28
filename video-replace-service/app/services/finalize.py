"""
Finalization pipeline for video-replace outputs.

Every raw video produced by the replacement stage — whether VACE-generated
or composited by the OpenCV lite path — must pass through this module before
being handed to the frontend as a final deliverable. The two concerns it
solves are:

  1. **Browser-compatible mp4** — re-encode to H.264 yuv420p + AAC inside an
     MP4 container with faststart, regardless of what fourcc the raw file used.
     Native OpenCV writers tend to produce MPEG-4 Part 2 / mp4v streams that
     Chrome refuses to play inline.

  2. **Audio re-injection** — the source video's audio track is muxed into
     the final file. If the generated video has a different duration (VACE
     can emit slightly shorter/longer clips due to FPS quantization) the
     audio is trimmed to the shortest stream so playback never stalls.

`locate_ffmpeg()` falls back to `imageio-ffmpeg`'s bundled binary when a
system ffmpeg is not on PATH, so callers never have to worry about "no
ffmpeg installed" outside of this file.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import NamedTuple

logger = logging.getLogger(__name__)


def _run_subprocess_no_window(*args, **kwargs) -> subprocess.CompletedProcess:
    if os.name == "nt" and "creationflags" not in kwargs:
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return subprocess.run(*args, **kwargs)


# ── ffmpeg binary locator ─────────────────────────────────────────────────


_cached_ffmpeg: str | None = None
_cached_ffprobe: str | None = None


def locate_ffmpeg() -> str:
    """
    Return an absolute path (or bare command name) to a usable ffmpeg binary.

    Resolution order:
      1. `VR_FFMPEG_BIN` env var.
      2. System ffmpeg on PATH.
      3. imageio-ffmpeg bundled binary.

    Raises RuntimeError if none are available.
    """
    global _cached_ffmpeg
    if _cached_ffmpeg:
        return _cached_ffmpeg

    env_bin = os.environ.get("VR_FFMPEG_BIN", "").strip()
    if env_bin:
        p = Path(env_bin)
        if p.exists():
            _cached_ffmpeg = str(p)
            return _cached_ffmpeg

    on_path = shutil.which("ffmpeg")
    if on_path:
        _cached_ffmpeg = on_path
        return _cached_ffmpeg

    try:
        import imageio_ffmpeg
        bundled = imageio_ffmpeg.get_ffmpeg_exe()
        if bundled and Path(bundled).exists():
            _cached_ffmpeg = bundled
            return _cached_ffmpeg
    except Exception as exc:  # noqa: BLE001
        logger.debug("imageio-ffmpeg unavailable: %s", exc)

    raise RuntimeError(
        "ffmpeg 未找到。请安装 imageio-ffmpeg 或在 PATH 中放置 ffmpeg。"
        " 推荐：pip install imageio-ffmpeg"
    )


def locate_ffprobe() -> str | None:
    """Return path to ffprobe if available. None if only ffmpeg is."""
    global _cached_ffprobe
    if _cached_ffprobe:
        return _cached_ffprobe

    env_bin = os.environ.get("VR_FFPROBE_BIN", "").strip()
    if env_bin and Path(env_bin).exists():
        _cached_ffprobe = env_bin
        return _cached_ffprobe

    on_path = shutil.which("ffprobe")
    if on_path:
        _cached_ffprobe = on_path
        return _cached_ffprobe

    # imageio-ffmpeg does not ship ffprobe — if the bundled ffmpeg is used,
    # callers will have to derive duration/stream info via ffmpeg itself.
    return None


# ── Stream probing ────────────────────────────────────────────────────────


class StreamInfo(NamedTuple):
    duration: float          # seconds (0.0 if unknown)
    has_audio: bool
    has_video: bool


def probe_streams(video_path: Path) -> StreamInfo:
    """
    Return (duration, has_audio, has_video). Uses ffprobe if present, otherwise
    falls back to ffmpeg stderr parsing — which is good enough for our needs.
    """
    ffprobe = locate_ffprobe()
    if ffprobe:
        try:
            proc = _run_subprocess_no_window(
                [
                    ffprobe, "-v", "error",
                    "-print_format", "json",
                    "-show_streams",
                    "-show_format",
                    str(video_path),
                ],
                capture_output=True, text=True, check=False,
            )
            if proc.returncode == 0 and proc.stdout:
                meta = json.loads(proc.stdout)
                duration = float(meta.get("format", {}).get("duration") or 0.0)
                streams = meta.get("streams") or []
                has_audio = any(s.get("codec_type") == "audio" for s in streams)
                has_video = any(s.get("codec_type") == "video" for s in streams)
                return StreamInfo(duration, has_audio, has_video)
        except Exception as exc:  # noqa: BLE001
            logger.debug("ffprobe failed; falling back to ffmpeg: %s", exc)

    # Fallback: invoke ffmpeg -i and parse stderr for "Stream #0:x: Audio/Video"
    # and "Duration:".
    try:
        ffmpeg = locate_ffmpeg()
        proc = _run_subprocess_no_window(
            [ffmpeg, "-hide_banner", "-i", str(video_path)],
            capture_output=True, text=True, check=False,
        )
        out = proc.stderr or ""
    except Exception as exc:  # noqa: BLE001
        logger.warning("ffmpeg probe failed: %s", exc)
        return StreamInfo(0.0, False, True)

    duration = 0.0
    for line in out.splitlines():
        line_strip = line.strip()
        if line_strip.startswith("Duration:"):
            # e.g. "Duration: 00:00:05.04, start: 0.000000, bitrate: 2024 kb/s"
            tok = line_strip.split(",", 1)[0].removeprefix("Duration:").strip()
            parts = tok.split(":")
            try:
                if len(parts) == 3:
                    h, m, s = parts
                    duration = int(h) * 3600 + int(m) * 60 + float(s)
                    break
            except ValueError:
                continue

    has_audio = "Audio:" in out
    has_video = "Video:" in out
    return StreamInfo(duration, has_audio, has_video)


# ── Finalization (re-encode + audio mux) ──────────────────────────────────


def finalize_result_video(
    *,
    raw_result: Path,
    source_video: Path,
    final_out: Path,
    video_bitrate: str = "6M",
    preset: str = "veryfast",
    crf: int = 20,
) -> Path:
    """
    Produce a browser-friendly H.264/AAC mp4 at `final_out`.

    Logic:
      1. Probe `source_video` for audio track.
      2. If source has audio → re-encode raw_result to h264 + pull aac audio
         from source, mux with shortest stream.
      3. If source has no audio → re-encode raw_result to h264, no audio
         stream.

    All outputs use yuv420p + faststart so Chrome/Safari can play inline.

    Raises RuntimeError on ffmpeg failure.
    """
    ffmpeg = locate_ffmpeg()
    final_out.parent.mkdir(parents=True, exist_ok=True)

    src_info = probe_streams(source_video)
    raw_info = probe_streams(raw_result)

    common_video_opts = [
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", preset,
        "-crf", str(crf),
        "-profile:v", "high",
        "-level", "4.1",
        "-movflags", "+faststart",
    ]

    if src_info.has_audio:
        cmd = [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel", "error",
            "-i", str(raw_result),            # 0 = replaced video (no audio expected)
            "-i", str(source_video),          # 1 = original (for audio)
            "-map", "0:v:0",
            "-map", "1:a:0?",                 # '?' = optional, never fail
            *common_video_opts,
            "-c:a", "aac",
            "-b:a", "160k",
            "-shortest",
            str(final_out),
        ]
    else:
        cmd = [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel", "error",
            "-i", str(raw_result),
            "-map", "0:v:0",
            "-an",
            *common_video_opts,
            str(final_out),
        ]

    logger.info("[finalize] ffmpeg: %s", " ".join(cmd))
    proc = _run_subprocess_no_window(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(
            f"finalize ffmpeg failed ({proc.returncode}):\n"
            f"{(proc.stderr or proc.stdout)[-2000:]}"
        )

    if not final_out.exists() or final_out.stat().st_size < 1024:
        raise RuntimeError(f"finalize 产物异常: {final_out}")

    logger.info(
        "[finalize] wrote %s (%d bytes, src_audio=%s, raw_dur=%.2f, src_dur=%.2f)",
        final_out, final_out.stat().st_size, src_info.has_audio,
        raw_info.duration, src_info.duration,
    )
    return final_out


__all__ = [
    "StreamInfo",
    "finalize_result_video",
    "locate_ffmpeg",
    "locate_ffprobe",
    "probe_streams",
]
