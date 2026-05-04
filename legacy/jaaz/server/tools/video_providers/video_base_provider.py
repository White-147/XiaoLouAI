from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, List, Type
from models.config_model import ModelInfo


class VideoProviderBase(ABC):
    """Video generation provider base class"""

    # Class attribute: provider registry
    _providers: Dict[str, Type['VideoProviderBase']] = {}

    def __init_subclass__(cls, provider_name: Optional[str] = None, **kwargs: Any):
        """Auto-register provider"""
        super().__init_subclass__(**kwargs)
        if provider_name:
            cls._providers[provider_name] = cls

    @classmethod
    def create_provider(cls, provider_name: str) -> 'VideoProviderBase':
        """Factory method: create provider instance"""
        if provider_name not in cls._providers:
            raise ValueError(f"Unknown provider: {provider_name}")

        provider_class = cls._providers[provider_name]
        return provider_class()  # Let each provider handle its own configuration

    @classmethod
    def get_available_providers(cls) -> List[str]:
        """Get all available providers"""
        return list(cls._providers.keys())

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        model: str,
        resolution: str = "480p",
        duration: int = 5,
        aspect_ratio: str = "16:9",
        input_images: Optional[list[str]] = None,
        camera_fixed: bool = True,
        **kwargs: Any
    ) -> str:
        """
        Generate video and return video URL

        Args:
            prompt: Video generation prompt
            model: Model name to use for generation
            resolution: Video resolution (480p, 1080p)
            duration: Video duration in seconds (5, 10)
            aspect_ratio: Video aspect ratio (1:1, 16:9, 4:3, 21:9)
            input_images: Optional input images for reference
            camera_fixed: Whether to keep camera fixed
            **kwargs: Additional provider-specific parameters

        Returns:
            str: Video URL for download
        """
        pass


def get_default_provider(model_info_list: Optional[List[ModelInfo]] = None) -> str:
    """Get default provider for video generation

    Args:
        model_info_list: List of model info dictionaries. If provided,
                        will prioritize jaaz provider if available, otherwise use first one.
                        If not provided, returns 'jaaz' as default.

    Returns:
        str: Provider name
    """
    if model_info_list:
        # Prioritize Jaaz provider if available
        for model_info in model_info_list:
            if model_info.get('provider') == 'jaaz':
                return 'jaaz'

        # If no jaaz provider, use the first available one
        if model_info_list:
            return model_info_list[0].get('provider', 'jaaz')

    # Default fallback
    return "jaaz"
