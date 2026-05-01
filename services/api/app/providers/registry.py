from __future__ import annotations

from typing import Any

from app.config import Settings, get_settings
from app.providers.base import BaseProvider, UnsupportedProviderError
from app.providers.cloud_image import CloudImageProvider
from app.providers.cloud_video import CloudVideoProvider
from app.providers.local_image import LocalImageProvider
from app.providers.local_video import LocalVideoProvider


def parse_model_id(model_id: str) -> tuple[str, str, str]:
    parts = [part.strip().lower() for part in model_id.split(":") if part.strip()]
    if len(parts) < 3:
        raise UnsupportedProviderError("model_id must use '<backend>:<kind>:<name>' format")
    backend, kind = parts[0], parts[1]
    name = ":".join(parts[2:])
    if backend not in {"cloud", "local"}:
        raise UnsupportedProviderError(f"unsupported provider backend '{backend}'")
    if kind not in {"video", "image"}:
        raise UnsupportedProviderError(f"unsupported provider kind '{kind}'")
    return backend, kind, name


def resolve_provider(model_id: str, settings: Settings | None = None) -> BaseProvider:
    resolved_settings = settings or get_settings()
    backend, kind, _ = parse_model_id(model_id)
    if backend == "cloud" and kind == "video":
        return CloudVideoProvider(resolved_settings)
    if backend == "local" and kind == "video":
        return LocalVideoProvider(resolved_settings)
    if backend == "cloud" and kind == "image":
        return CloudImageProvider(resolved_settings)
    if backend == "local" and kind == "image":
        return LocalImageProvider(resolved_settings)
    raise UnsupportedProviderError(f"unsupported model_id '{model_id}'")


def infer_model_id(
    *,
    task_type: str,
    payload: dict[str, Any] | None,
    settings: Settings | None = None,
) -> str | None:
    resolved_settings = settings or get_settings()
    payload = payload or {}
    explicit = payload.get("model_id") or payload.get("modelId")
    if explicit:
        return str(explicit).strip()

    normalized_task_type = task_type.strip().lower().replace("-", "_")
    if "video" in normalized_task_type:
        return resolved_settings.provider_default_video_model
    if "image" in normalized_task_type or "canvas" in normalized_task_type:
        return resolved_settings.provider_default_image_model
    return None


def queue_for_model(model_id: str, settings: Settings | None = None) -> str:
    del settings
    backend, kind, _ = parse_model_id(model_id)
    if backend == "local" and kind == "video":
        return "video_local_gpu"
    if backend == "cloud" and kind == "video":
        return "video_cloud_api"
    return "default"
