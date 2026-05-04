from typing import Annotated
from pydantic import BaseModel, Field
from langchain_core.tools import tool, InjectedToolCallId  # type: ignore
from langchain_core.runnables import RunnableConfig
from services.jaaz_service import JaazService
from tools.video_generation.video_canvas_utils import send_video_start_notification, process_video_result
from .utils.image_utils import process_input_image


class GenerateVideoByKlingV2InputSchema(BaseModel):
    prompt: str = Field(
        description="Required. The prompt for video generation. Describe what you want to see in the video."
    )
    negative_prompt: str = Field(
        default="",
        description="Optional. Negative prompt to specify what you don't want in the video."
    )
    guidance_scale: float = Field(
        default=0.5,
        description="Optional. Guidance scale for generation (0.0 to 1.0). Higher values follow the prompt more closely."
    )
    aspect_ratio: str = Field(
        default="16:9",
        description="Optional. The aspect ratio of the video. Allowed values: 1:1, 16:9, 4:3, 21:9"
    )
    duration: int = Field(
        default=5,
        description="Optional. The duration of the video in seconds. Use 5 by default. Allowed values: 5, 10."
    )
    input_images: list[str] = Field(
        description="Required. Images to use as reference or starting frame. Pass a list of image_id here, e.g. ['im_jurheut7.png']. Only the first image will be used as start_image."
    )
    tool_call_id: Annotated[str, InjectedToolCallId]


@tool("generate_video_by_kling_v2_jaaz",
      description="Generate high-quality videos using Kling V2.1 model. Supports image-to-video generation with advanced controls like negative prompts and guidance scale.",
      args_schema=GenerateVideoByKlingV2InputSchema)
async def generate_video_by_kling_v2_jaaz(
    prompt: str,
    input_images: list[str],
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
    negative_prompt: str = "",
    guidance_scale: float = 0.5,
    aspect_ratio: str = "16:9",
    duration: int = 5,
) -> str:
    """
    Generate a video using Kling V2.1 model via Jaaz service
    """
    print(f'🛠️ Kling Video Generation tool_call_id: {tool_call_id}')
    ctx = config.get('configurable', {})
    canvas_id = ctx.get('canvas_id', '')
    session_id = ctx.get('session_id', '')
    print(f'🛠️ canvas_id {canvas_id} session_id {session_id}')

    # Inject the tool call id into the context
    ctx['tool_call_id'] = tool_call_id

    try:
        # Validate input_images is provided and not empty
        if not input_images or len(input_images) == 0:
            raise ValueError(
                "input_images is required and cannot be empty. Please provide at least one image.")

        # Send start notification
        await send_video_start_notification(
            session_id,
            f"Starting Kling video generation..."
        )

        # Process input images (use first image as start_image)
        first_image = input_images[0]
        processed_image = await process_input_image(first_image)
        if not processed_image:
            raise ValueError(
                f"Failed to process input image: {first_image}. Please check if the image exists and is valid.")

        print(
            f"Using first input image as start image for Kling video generation: {first_image}")

        # Create Jaaz service and generate video
        jaaz_service = JaazService()
        result = await jaaz_service.generate_video(
            prompt=prompt,
            model="kling-v2.1-standard",
            duration=duration,
            aspect_ratio=aspect_ratio,
            input_images=[processed_image],
            negative_prompt=negative_prompt,
            guidance_scale=guidance_scale,
        )

        video_url = result.get('result_url')
        if not video_url:
            raise Exception("No video URL returned from generation")

        # Process video result (save, update canvas, notify)
        return await process_video_result(
            video_url=video_url,
            session_id=session_id,
            canvas_id=canvas_id,
            provider_name="jaaz_kling",
        )

    except Exception as e:
        print(f"Error in Kling video generation: {e}")
        raise e


# Export the tool for easy import
__all__ = ["generate_video_by_kling_v2_jaaz"]
