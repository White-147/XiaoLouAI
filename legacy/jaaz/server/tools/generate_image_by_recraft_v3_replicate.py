from typing import Annotated
from langchain_core.tools import tool, InjectedToolCallId  # type: ignore
from langchain_core.runnables import RunnableConfig
from tools.utils.image_generation_core import generate_image_with_provider
from tools.generate_image_by_recraft_v3_jaaz import GenerateImageByRecraftV3InputSchema


@tool("generate_image_by_recraft_v3_replicate",
      description="Generate an image by Recraft V3 model using text prompt. This model does NOT support input images for reference or editing. Use this model for high-quality image generation with Recraft's advanced AI. Supports multiple providers with automatic fallback.",
      args_schema=GenerateImageByRecraftV3InputSchema)
async def generate_image_by_recraft_v3_replicate(
    prompt: str,
    aspect_ratio: str,
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
) -> str:
    """
    Generate an image using Recraft V3 model via the Replicate provider framework
    """
    ctx = config.get('configurable', {})
    canvas_id = ctx.get('canvas_id', '')
    session_id = ctx.get('session_id', '')
    return await generate_image_with_provider(
        canvas_id=canvas_id,
        session_id=session_id,
        provider='replicate',
        model="recraft-ai/recraft-v3",
        prompt=prompt,
        aspect_ratio=aspect_ratio,
        input_images=None,
    )


# Export the tool for easy import
__all__ = ["generate_image_by_recraft_v3_replicate"]
