import asyncio
import os
import re
from typing import Annotated, Any, Callable, Dict, Iterable, List, Optional

import httpx
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import BaseTool, InjectedToolCallId, tool  # type: ignore
from pydantic import BaseModel, Field


XIAOLOU_ACTOR_ID = os.getenv("XIAOLOU_AGENT_ACTOR_ID", "root_demo_001")
DEFAULT_CORE_API_BASE_URL = "http://127.0.0.1:4100"

IMAGE_CAPABILITY_MODES = ("text_to_image", "image_to_image", "multi_image")
VIDEO_CAPABILITY_MODES = (
    "text_to_video",
    "image_to_video",
    "start_end_frame",
    "multi_param",
)


class XiaolouImageInput(BaseModel):
    prompt: str = Field(description="Required. Prompt for image generation.")
    aspect_ratio: str = Field(
        default="1:1",
        description="Optional. Aspect ratio, such as 1:1, 16:9, 9:16, 4:3, 3:4, 21:9.",
    )
    resolution: Optional[str] = Field(
        default=None,
        description="Optional. Resolution supported by the selected XiaoLou image model.",
    )
    input_images: Optional[List[str]] = Field(
        default=None,
        description="Optional. Reference image URLs or Jaaz image identifiers.",
    )
    count: int = Field(default=1, description="Optional. Number of images, 1 to 4.")
    tool_call_id: Annotated[str, InjectedToolCallId]


class XiaolouVideoInput(BaseModel):
    prompt: str = Field(description="Required. Prompt for video generation.")
    aspect_ratio: str = Field(
        default="16:9",
        description="Optional. Aspect ratio, such as 16:9, 9:16, 1:1, 4:3, 3:4, 21:9.",
    )
    resolution: str = Field(default="720p", description="Optional. Video resolution.")
    duration: int = Field(default=5, description="Optional. Duration in seconds.")
    video_mode: Optional[str] = Field(
        default=None,
        description="Optional. text_to_video, image_to_video, start_end_frame, or multi_param.",
    )
    input_images: Optional[List[str]] = Field(
        default=None,
        description="Optional. Reference image URLs or Jaaz image identifiers.",
    )
    first_frame_url: Optional[str] = Field(
        default=None,
        description="Optional. First frame URL for start/end-frame video models.",
    )
    last_frame_url: Optional[str] = Field(
        default=None,
        description="Optional. Last frame URL for start/end-frame video models.",
    )
    generate_audio: bool = Field(default=False, description="Optional. Generate audio when supported.")
    tool_call_id: Annotated[str, InjectedToolCallId]


def _workspace_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


def _read_env_file(path: str) -> Dict[str, str]:
    values: Dict[str, str] = {}
    if not os.path.exists(path):
        return values

    try:
        with open(path, "r", encoding="utf-8") as fh:
            for raw_line in fh:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key:
                    values[key] = value
    except OSError:
        return {}
    return values


def get_xiaolou_env() -> Dict[str, str]:
    configured = os.getenv("XIAOLOU_CORE_API_ENV_FILE", "").strip()
    candidates = [
        configured,
        os.path.join(_workspace_root(), "core-api", ".env.local"),
        os.path.join(_workspace_root(), "core-api", ".env"),
    ]
    merged: Dict[str, str] = {}
    for candidate in candidates:
        if candidate:
            merged.update(_read_env_file(candidate))
    return merged


def get_xiaolou_core_api_base_url() -> str:
    env = get_xiaolou_env()
    return (
        os.getenv("XIAOLOU_CORE_API_BASE_URL")
        or env.get("XIAOLOU_CORE_API_BASE_URL")
        or DEFAULT_CORE_API_BASE_URL
    ).rstrip("/")


def get_xiaolou_dashscope_api_key() -> str:
    env = get_xiaolou_env()
    return os.getenv("DASHSCOPE_API_KEY") or env.get("DASHSCOPE_API_KEY", "")


def build_xiaolou_provider_defaults() -> Dict[str, Dict[str, Any]]:
    core_api_base = get_xiaolou_core_api_base_url()
    return {
        "xiaolou-vertex": {
            "models": {
                "vertex:gemini-3-flash-preview": {"type": "text", "display_name": "Gemini 3"},
                "vertex:gemini-3.1-pro-preview": {"type": "text", "display_name": "Gemini 3.1"},
            },
            "url": f"{core_api_base}/api/vertex-openai/v1/",
            "api_key": os.getenv("XIAOLOU_VERTEX_LOCAL_API_KEY", "xiaolou-local"),
            "max_tokens": 8192,
        },
        "xiaolou-dashscope": {
            "models": {
                "qwen-plus": {"type": "text", "display_name": "QWEN3.6PLUS"},
            },
            "url": os.getenv(
                "XIAOLOU_DASHSCOPE_BASE_URL",
                "https://dashscope.aliyuncs.com/compatible-mode/v1/",
            ),
            "api_key": get_xiaolou_dashscope_api_key(),
            "max_tokens": 8192,
        },
        "xiaolou": {
            "models": {},
            "url": core_api_base,
            "api_key": os.getenv("XIAOLOU_LOCAL_TOOL_API_KEY", "xiaolou-local"),
        },
    }


def _core_headers() -> Dict[str, str]:
    return {
        "Content-Type": "application/json",
        "X-Actor-Id": XIAOLOU_ACTOR_ID,
    }


def _unwrap_response(payload: Any) -> Any:
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


async def _get_json(path: str, timeout: float = 20.0) -> Any:
    base_url = get_xiaolou_core_api_base_url()
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.get(f"{base_url}{path}", headers=_core_headers())
        response.raise_for_status()
        return _unwrap_response(response.json())


async def _post_json(path: str, body: Dict[str, Any], timeout: float = 30.0) -> Any:
    base_url = get_xiaolou_core_api_base_url()
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(f"{base_url}{path}", headers=_core_headers(), json=body)
        response.raise_for_status()
        return _unwrap_response(response.json())


def _tool_safe_id(value: str) -> str:
    normalized = re.sub(r"[^0-9a-zA-Z_]+", "_", value).strip("_").lower()
    return normalized or "model"


def _merge_capability_items(target: Dict[str, Dict[str, Any]], items: Iterable[Dict[str, Any]], mode: str) -> None:
    for item in items:
        model_id = str(item.get("id") or "").strip()
        if not model_id:
            continue
        entry = target.setdefault(
            model_id,
            {
                "id": model_id,
                "label": str(item.get("label") or model_id),
                "provider": str(item.get("provider") or "xiaolou"),
                "kind": str(item.get("kind") or ""),
                "recommended": bool(item.get("recommended")),
                "modes": [],
            },
        )
        if mode not in entry["modes"]:
            entry["modes"].append(mode)


async def list_xiaolou_media_models(kind: str) -> List[Dict[str, Any]]:
    if kind == "image":
        modes = IMAGE_CAPABILITY_MODES
        path = "/api/create/images/capabilities"
    elif kind == "video":
        modes = VIDEO_CAPABILITY_MODES
        path = "/api/create/videos/capabilities"
    else:
        return []

    by_id: Dict[str, Dict[str, Any]] = {}
    for mode in modes:
        try:
            data = await _get_json(f"{path}?mode={mode}")
            _merge_capability_items(by_id, data.get("items", []), mode)
        except Exception as exc:
            print(f"[xiaolou_adapter] failed to load {kind} capabilities for {mode}: {exc}")

    return list(by_id.values())


async def _wait_for_xiaolou_task(task_id: str, timeout_seconds: int) -> Dict[str, Any]:
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    last_task: Dict[str, Any] = {}

    while asyncio.get_running_loop().time() < deadline:
        data = await _get_json(f"/api/tasks/{task_id}", timeout=20)
        task = data if isinstance(data, dict) else {}
        last_task = task
        status = str(task.get("status") or "")
        if status == "succeeded":
            return task
        if status == "failed":
            raise RuntimeError(str(task.get("outputSummary") or "XiaoLou generation task failed"))
        await asyncio.sleep(1.5)

    raise TimeoutError(f"XiaoLou generation task {task_id} timed out. Last status: {last_task.get('status')}")


def _extract_task_id(data: Any) -> str:
    if isinstance(data, dict):
        for key in ("id", "taskId"):
            value = data.get(key)
            if value:
                return str(value)
    raise RuntimeError("XiaoLou task response did not include a task id")


def _absolute_core_url(value: str) -> str:
    url = str(value or "").strip()
    if not url or re.match(r"^https?://", url, flags=re.I):
        return url
    if url.startswith("/"):
        return f"{get_xiaolou_core_api_base_url()}{url}"
    return url


def _absolute_jaaz_file_url(value: str) -> str:
    ref = str(value or "").strip()
    if not ref or ref.startswith("data:") or re.match(r"^https?://", ref, flags=re.I):
        return ref

    from common import DEFAULT_PORT

    if ref.startswith("/"):
        return f"http://127.0.0.1:{DEFAULT_PORT}{ref}"
    return f"http://127.0.0.1:{DEFAULT_PORT}/api/file/{ref}"


def _resolve_input_references(input_images: Optional[List[str]]) -> List[str]:
    return [
        _absolute_jaaz_file_url(item)
        for item in (input_images or [])
        if str(item or "").strip()
    ]


def _get_canvas_context(config: Optional[RunnableConfig]) -> tuple[str, str]:
    ctx = {}
    if config:
        ctx = config.get("configurable", {}) or {}
    session_id = str(ctx.get("session_id") or "")
    canvas_id = str(ctx.get("canvas_id") or "")
    return session_id, canvas_id


async def _save_image_url_to_canvas(
    *,
    image_url: str,
    label: str,
    model_id: str,
    prompt: str,
    task_id: str,
    config: Optional[RunnableConfig],
) -> Optional[str]:
    session_id, canvas_id = _get_canvas_context(config)
    if not session_id or not canvas_id or not image_url:
        return None

    try:
        from common import DEFAULT_PORT
        from services.config_service import FILES_DIR
        from tools.utils.image_canvas_utils import save_image_to_canvas
        from tools.utils.image_utils import generate_image_id, get_image_info_and_save

        image_id = generate_image_id()
        metadata = {
            "prompt": prompt,
            "model": model_id,
            "provider": "xiaolou",
            "xiaolou_task_id": task_id,
        }
        mime_type, width, height, extension = await get_image_info_and_save(
            image_url,
            os.path.join(FILES_DIR, image_id),
            metadata=metadata,
        )
        filename = f"{image_id}.{extension}"
        canvas_url = await save_image_to_canvas(
            session_id,
            canvas_id,
            filename,
            mime_type,
            width,
            height,
        )
        return f"image generated successfully ![image_id: {filename}](http://localhost:{DEFAULT_PORT}{canvas_url})"
    except Exception as exc:
        print(f"[xiaolou_adapter] generated {label} image but failed to save it to Jaaz canvas: {exc}")
        return None


async def _save_video_url_to_canvas(
    *,
    video_url: str,
    label: str,
    config: Optional[RunnableConfig],
) -> Optional[str]:
    session_id, canvas_id = _get_canvas_context(config)
    if not session_id or not canvas_id or not video_url:
        return None

    try:
        from tools.video_generation.video_canvas_utils import process_video_result

        return await process_video_result(
            video_url=video_url,
            session_id=session_id,
            canvas_id=canvas_id,
            provider_name=f"{label} (xiaolou)",
        )
    except Exception as exc:
        print(f"[xiaolou_adapter] generated {label} video but failed to save it to Jaaz canvas: {exc}")
        return None


async def _find_created_media(kind: str, task_id: str) -> Optional[Dict[str, Any]]:
    path = "/api/create/images" if kind == "image" else "/api/create/videos"
    data = await _get_json(path)
    items = data.get("items", []) if isinstance(data, dict) else []
    for item in items:
        if str(item.get("taskId") or "") == task_id:
            return item
    return None


async def submit_xiaolou_image_generation(
    *,
    model_id: str,
    label: str,
    prompt: str,
    aspect_ratio: str,
    resolution: Optional[str],
    input_images: Optional[List[str]],
    count: int,
    config: Optional[RunnableConfig] = None,
) -> str:
    body: Dict[str, Any] = {
        "prompt": prompt,
        "model": model_id,
        "aspectRatio": aspect_ratio or "1:1",
        "count": max(1, min(int(count or 1), 4)),
    }
    if resolution:
        body["resolution"] = resolution
    references = _resolve_input_references(input_images)
    if references:
        body["referenceImageUrls"] = references

    task_id = _extract_task_id(await _post_json("/api/create/images/generate", body))
    await _wait_for_xiaolou_task(task_id, timeout_seconds=300)
    item = await _find_created_media("image", task_id)
    image_url = _absolute_core_url(str((item or {}).get("imageUrl") or ""))
    canvas_message = await _save_image_url_to_canvas(
        image_url=image_url,
        label=label,
        model_id=model_id,
        prompt=prompt,
        task_id=task_id,
        config=config,
    )
    if canvas_message:
        return canvas_message
    if not image_url:
        return f"Image generated with XiaoLou {label}. Task id: {task_id}"
    return f"Image generated with XiaoLou {label}: ![image_id: {task_id}]({image_url})"


async def submit_xiaolou_video_generation(
    *,
    model_id: str,
    label: str,
    prompt: str,
    aspect_ratio: str,
    resolution: str,
    duration: int,
    video_mode: Optional[str],
    input_images: Optional[List[str]],
    first_frame_url: Optional[str],
    last_frame_url: Optional[str],
    generate_audio: bool,
    config: Optional[RunnableConfig] = None,
) -> str:
    references = _resolve_input_references(input_images)
    resolved_mode = video_mode or ("image_to_video" if references else "text_to_video")
    body: Dict[str, Any] = {
        "prompt": prompt,
        "model": model_id,
        "videoMode": resolved_mode,
        "aspectRatio": aspect_ratio or "16:9",
        "resolution": resolution or "720p",
        "duration": f"{int(duration or 5)}s",
        "generateAudio": bool(generate_audio),
    }
    if references:
        body["referenceImageUrl"] = references[0]
        body["referenceImageUrls"] = references
    if first_frame_url:
        body["firstFrameUrl"] = _absolute_jaaz_file_url(first_frame_url)
    if last_frame_url:
        body["lastFrameUrl"] = _absolute_jaaz_file_url(last_frame_url)

    task_id = _extract_task_id(await _post_json("/api/create/videos/generate", body))
    await _wait_for_xiaolou_task(task_id, timeout_seconds=900)
    item = await _find_created_media("video", task_id)
    video_url = _absolute_core_url(str((item or {}).get("videoUrl") or ""))
    canvas_message = await _save_video_url_to_canvas(
        video_url=video_url,
        label=label,
        config=config,
    )
    if canvas_message:
        return canvas_message
    if not video_url:
        return f"Video generated with XiaoLou {label}. Task id: {task_id}"
    return f"Video generated with XiaoLou {label}: [video_id: {task_id}]({video_url})"


def _make_image_tool(model: Dict[str, Any]) -> BaseTool:
    model_id = str(model["id"])
    label = str(model.get("label") or model_id)
    modes = ", ".join(model.get("modes") or IMAGE_CAPABILITY_MODES)
    tool_id = f"xiaolou_image_{_tool_safe_id(model_id)}"

    @tool(
        tool_id,
        description=(
            f"Generate images through XiaoLou Chuangjing Tianmu model {label} "
            f"({model_id}). Supported modes: {modes}."
        ),
        args_schema=XiaolouImageInput,
    )
    async def run_xiaolou_image_tool(
        prompt: str,
        config: RunnableConfig,
        tool_call_id: Annotated[str, InjectedToolCallId],
        aspect_ratio: str = "1:1",
        resolution: Optional[str] = None,
        input_images: Optional[List[str]] = None,
        count: int = 1,
    ) -> str:
        _ = config, tool_call_id
        return await submit_xiaolou_image_generation(
            model_id=model_id,
            label=label,
            prompt=prompt,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            input_images=input_images,
            count=count,
            config=config,
        )

    return run_xiaolou_image_tool


def _make_video_tool(model: Dict[str, Any]) -> BaseTool:
    model_id = str(model["id"])
    label = str(model.get("label") or model_id)
    modes = ", ".join(model.get("modes") or VIDEO_CAPABILITY_MODES)
    tool_id = f"xiaolou_video_{_tool_safe_id(model_id)}"

    @tool(
        tool_id,
        description=(
            f"Generate videos through XiaoLou Chuangjing Tianmu model {label} "
            f"({model_id}). Supported modes: {modes}."
        ),
        args_schema=XiaolouVideoInput,
    )
    async def run_xiaolou_video_tool(
        prompt: str,
        config: RunnableConfig,
        tool_call_id: Annotated[str, InjectedToolCallId],
        aspect_ratio: str = "16:9",
        resolution: str = "720p",
        duration: int = 5,
        video_mode: Optional[str] = None,
        input_images: Optional[List[str]] = None,
        first_frame_url: Optional[str] = None,
        last_frame_url: Optional[str] = None,
        generate_audio: bool = False,
    ) -> str:
        _ = config, tool_call_id
        return await submit_xiaolou_video_generation(
            model_id=model_id,
            label=label,
            prompt=prompt,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            duration=duration,
            video_mode=video_mode,
            input_images=input_images,
            first_frame_url=first_frame_url,
            last_frame_url=last_frame_url,
            generate_audio=generate_audio,
            config=config,
        )

    return run_xiaolou_video_tool


async def register_xiaolou_tools(register_tool: Callable[[str, Dict[str, Any]], None]) -> None:
    image_models, video_models = await asyncio.gather(
        list_xiaolou_media_models("image"),
        list_xiaolou_media_models("video"),
    )

    for model in image_models:
        tool_fn = _make_image_tool(model)
        register_tool(
            tool_fn.name,
            {
                "display_name": str(model.get("label") or model["id"]),
                "type": "image",
                "provider": "xiaolou",
                "tool_function": tool_fn,
            },
        )

    for model in video_models:
        tool_fn = _make_video_tool(model)
        register_tool(
            tool_fn.name,
            {
                "display_name": str(model.get("label") or model["id"]),
                "type": "video",
                "provider": "xiaolou",
                "tool_function": tool_fn,
            },
        )
