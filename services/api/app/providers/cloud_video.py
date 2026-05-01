from app.config import Settings
from app.providers.base import HTTPModelProvider, ProviderConfigurationError


class CloudVideoProvider(HTTPModelProvider):
    def __init__(self, settings: Settings) -> None:
        base_url = str(settings.cloud_provider_base_url or "").strip()
        if not base_url:
            raise ProviderConfigurationError("CLOUD_PROVIDER_BASE_URL is required for cloud video")
        super().__init__(
            name="cloud_video",
            kind="video",
            queue_name="video_cloud_api",
            base_url=base_url,
            api_key=settings.cloud_provider_api_key,
        )
