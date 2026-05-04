from app.config import Settings
from app.providers.base import HTTPModelProvider


class LocalImageProvider(HTTPModelProvider):
    def __init__(self, settings: Settings) -> None:
        super().__init__(
            name="local_image",
            kind="image",
            queue_name="default",
            base_url=settings.local_provider_base_url,
        )
