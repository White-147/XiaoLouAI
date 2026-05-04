from typing import Any, Dict, List, Optional
import asyncio

from langchain_core.runnables import RunnableConfig

from models.tool_model import ToolInfoJson
from services.xiaolou_adapter import (
    _tool_safe_id,
    list_xiaolou_media_models,
    submit_xiaolou_image_generation,
)


MAGIC_IMAGE_PROMPT = (
    "Use the reference image as the source and generate one polished, high quality image. "
    "Preserve the main subject and composition, improve visual quality, lighting, texture, "
    "and overall finish. Return only the generated image result."
)


def _extract_input_image(messages: List[Dict[str, Any]]) -> str:
    if not messages:
        return ""

    user_message = messages[-1]
    content = user_message.get("content")
    if not isinstance(content, list):
        return ""

    for content_item in content:
        if not isinstance(content_item, dict):
            continue
        if content_item.get("type") != "image_url":
            continue
        image_url = content_item.get("image_url")
        if isinstance(image_url, dict):
            value = image_url.get("url")
            if value:
                return str(value)

    return ""


async def _resolve_xiaolou_image_model(
    tool_list: Optional[List[ToolInfoJson]],
) -> Optional[Dict[str, Any]]:
    models = await list_xiaolou_media_models("image")
    if not models:
        return None

    selected_tool_ids = {
        str(tool.get("id") or "")
        for tool in (tool_list or [])
        if isinstance(tool, dict)
        if str(tool.get("provider") or "") == "xiaolou"
    }
    for model in models:
        model_id = str(model.get("id") or "")
        if f"xiaolou_image_{_tool_safe_id(model_id)}" in selected_tool_ids:
            return model

    for model in models:
        modes = model.get("modes") or []
        if "image_to_image" in modes:
            return model

    return models[0]


async def create_jaaz_response(
    messages: List[Dict[str, Any]],
    session_id: str = "",
    canvas_id: str = "",
    tool_list: Optional[List[ToolInfoJson]] = None,
) -> Dict[str, Any]:
    try:
        image_content = _extract_input_image(messages)
        if not image_content:
            return {
                "role": "assistant",
                "content": [{"type": "text", "text": "Magic generation failed: no input image was found."}],
            }

        model = await _resolve_xiaolou_image_model(tool_list)
        if not model:
            return {
                "role": "assistant",
                "content": [{"type": "text", "text": "Magic generation failed: no XiaoLou image model is available."}],
            }

        model_id = str(model.get("id") or "")
        label = str(model.get("label") or model_id)
        config: RunnableConfig = {
            "configurable": {
                "session_id": session_id,
                "canvas_id": canvas_id,
            }
        }
        content = await submit_xiaolou_image_generation(
            model_id=model_id,
            label=label,
            prompt=MAGIC_IMAGE_PROMPT,
            aspect_ratio="1:1",
            resolution=None,
            input_images=[image_content],
            count=1,
            config=config,
        )

        return {
            "role": "assistant",
            "content": content,
        }

    except asyncio.TimeoutError:
        return {
            "role": "assistant",
            "content": [{"type": "text", "text": "Magic generation timed out. Please try again later."}],
        }
    except Exception as exc:
        print(f"Magic generation failed through XiaoLou image model: {exc}")
        return {
            "role": "assistant",
            "content": [{"type": "text", "text": f"Magic generation failed: {exc}"}],
        }


if __name__ == "__main__":
    asyncio.run(create_jaaz_response([]))
