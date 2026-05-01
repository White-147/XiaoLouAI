import pytest
from pathlib import Path

from app.config import Settings
from app.providers import (
    UnsupportedProviderError,
    infer_model_id,
    parse_model_id,
    queue_for_model,
    resolve_provider,
)
from app.providers.cloud_image import CloudImageProvider
from app.providers.cloud_video import CloudVideoProvider
from app.providers.local_video import LocalVideoProvider


def test_parse_model_id_requires_backend_kind_and_name() -> None:
    assert parse_model_id("cloud:video:default") == ("cloud", "video", "default")
    with pytest.raises(UnsupportedProviderError):
        parse_model_id("video:default")


def test_resolve_provider_maps_model_ids_to_provider_classes() -> None:
    settings = Settings(cloud_provider_base_url="https://provider.example")

    assert isinstance(resolve_provider("cloud:video:default", settings), CloudVideoProvider)
    assert isinstance(resolve_provider("cloud:image:default", settings), CloudImageProvider)
    assert isinstance(resolve_provider("local:video:default", settings), LocalVideoProvider)


def test_queue_for_model_does_not_require_provider_credentials() -> None:
    assert queue_for_model("cloud:video:default") == "video_cloud_api"
    assert queue_for_model("local:video:default") == "video_local_gpu"
    assert queue_for_model("cloud:image:default") == "default"


def test_infer_model_id_uses_explicit_payload_before_task_defaults() -> None:
    settings = Settings(
        provider_default_video_model="cloud:video:default",
        provider_default_image_model="cloud:image:default",
    )

    assert (
        infer_model_id(
            task_type="video_replace",
            payload={"model_id": "local:video:gpu"},
            settings=settings,
        )
        == "local:video:gpu"
    )
    assert infer_model_id(task_type="video_replace", payload={}, settings=settings) == (
        "cloud:video:default"
    )
    assert infer_model_id(task_type="image_generate", payload={}, settings=settings) == (
        "cloud:image:default"
    )


def test_video_replace_service_dir_resolves_relative_path() -> None:
    resolved = (Path.cwd() / "../../video-replace-service").resolve()
    assert resolved.name == "video-replace-service"
