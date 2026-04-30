from typing import Annotated
from langchain_core.tools import tool, InjectedToolCallId  # type: ignore
from langchain_core.runnables import RunnableConfig
from tools.utils.image_generation_core import generate_image_with_provider
from tools.generate_image_by_imagen_4_jaaz import GenerateImageByImagen4InputSchema


@tool("generate_image_by_imagen_4_replicate",
      description="Generate an image by Google Imagen-4 model using text prompt. This model does NOT support input images for reference or editing. Use this model for high-quality image generation with Google's advanced AI through Replicate platform.",
      args_schema=GenerateImageByImagen4InputSchema)
async def generate_image_by_imagen_4_replicate(
    prompt: str,
    aspect_ratio: str,
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
) -> str:
    ctx = config.get('configurable', {})
    canvas_id = ctx.get('canvas_id', '')
    session_id = ctx.get('session_id', '')
    print(f'🛠️ canvas_id {canvas_id} session_id {session_id}')
    return await generate_image_with_provider(
        canvas_id=canvas_id,
        session_id=session_id,
        provider='replicate',
        model='google/imagen-4',
        prompt=prompt,
        aspect_ratio=aspect_ratio,
    )


# Export the tool for easy import
__all__ = ["generate_image_by_imagen_4_replicate"]
