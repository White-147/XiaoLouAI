from app.config import Settings
from app.providers.base import HTTPModelProvider


class LocalVideoProvider(HTTPModelProvider):
    def __init__(self, settings: Settings) -> None:
        super().__init__(
            name="local_video",
            kind="video",
            queue_name="video_local_gpu",
            base_url=settings.local_provider_base_url,
        )
