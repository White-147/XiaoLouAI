import os
import random
import json
import sys
import copy
import traceback
from typing import Optional, Any
from pydantic import BaseModel
from .image_base_provider import ImageProviderBase
from ..utils.image_utils import get_image_info_and_save, generate_image_id
from services.config_service import FILES_DIR, config_service
from routers.comfyui_execution import execute


class ComfyUIResponse(BaseModel):
    """ComfyUI API response format"""
    outputs: list[str]
    status: str


def get_asset_path(filename: str) -> str:
    """
    To get the correct path for pyinstaller bundled application
    """
    if getattr(sys, "frozen", False):
        # If the application is run as a bundle, the path is relative to the executable
        base_path = getattr(sys, "_MEIPASS", "")
    else:
        # If the application is run in a normal Python environment
        base_path = os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )

    return os.path.join(str(base_path), "asset", filename)


class ComfyUIProvider(ImageProviderBase, provider_name="comfyui"):
    """ComfyUI image generation provider implementation"""

    def __init__(self):
        # Load workflows
        asset_dir = get_asset_path("flux_comfy_workflow.json")
        basic_comfy_t2i_workflow = get_asset_path(
            "default_comfy_t2i_workflow.json")

        self.flux_comfy_workflow = None
        self.basic_comfy_t2i_workflow = None

        try:
            self.flux_comfy_workflow = json.load(open(asset_dir, "r"))
            self.basic_comfy_t2i_workflow = json.load(
                open(basic_comfy_t2i_workflow, "r")
            )
        except Exception:
            traceback.print_exc()

    def _calculate_dimensions(self, aspect_ratio: str, model: str) -> tuple[int, int]:
        """Calculate width and height based on aspect ratio and model"""
        if "flux" in model:
            # Flux generate images around 1M pixel (1024x1024)
            pixel_count = 1024**2
        else:
            # sd 1.5, basic is 512, but accept 768 for better quality
            pixel_count = 768**2

        w_ratio, h_ratio = map(int, aspect_ratio.split(":"))
        factor = (pixel_count / (w_ratio * h_ratio)) ** 0.5

        width = int((factor * w_ratio) / 64) * 64
        height = int((factor * h_ratio) / 64) * 64

        return width, height

    def _build_workflow(self, prompt: str, model: str, width: int, height: int) -> dict[str, Any]:
        """Build workflow based on model type"""
        if "flux" in model:
            if not self.flux_comfy_workflow:
                raise FileNotFoundError("Flux workflow json not found")

            workflow = copy.deepcopy(self.flux_comfy_workflow)
            workflow["6"]["inputs"]["text"] = prompt
            workflow["30"]["inputs"]["ckpt_name"] = model
            workflow["27"]["inputs"]["width"] = width
            workflow["27"]["inputs"]["height"] = height
            workflow["31"]["inputs"]["seed"] = random.randint(1, 2**32)
        else:
            if not self.basic_comfy_t2i_workflow:
                raise FileNotFoundError(
                    "Basic ComfyUI workflow json not found")

            workflow = copy.deepcopy(self.basic_comfy_t2i_workflow)
            workflow["6"]["inputs"]["text"] = prompt
            workflow["4"]["inputs"]["ckpt_name"] = model
            workflow["5"]["inputs"]["width"] = width
            workflow["5"]["inputs"]["height"] = height
            workflow["3"]["inputs"]["seed"] = random.randint(1, 2**32)

        return workflow

    async def generate(
        self,
        prompt: str,
        model: str,
        aspect_ratio: str = "1:1",
        input_images: Optional[list[str]] = None,
        **kwargs: Any
    ) -> tuple[str, int, int, str]:
        """
        Generate image using ComfyUI API service

        Args:
            prompt: Image generation prompt
            model: Model name to use for generation
            aspect_ratio: Image aspect ratio (1:1, 16:9, 4:3, 3:4, 9:16)
            input_images: Optional input images for reference or editing
            **kwargs: Additional provider-specific parameters

        Returns:
            tuple[str, int, int, str]: (mime_type, width, height, filename)
        """
        try:
            # Get context from kwargs
            ctx = kwargs.get("ctx", {})

            api_url = str(
                config_service.app_config.get("comfyui", {}).get("url", "")
            ).rstrip("/")

            # Calculate dimensions
            width, height = self._calculate_dimensions(aspect_ratio, model)

            # Build workflow
            workflow = self._build_workflow(prompt, model, width, height)

            # Execute workflow
            execution = await execute(workflow, api_url, ctx=ctx)
            print("🦄image execution outputs", execution.outputs)
            url = execution.outputs[0]

            # Save the image
            image_id = generate_image_id()
            mime_type, width, height, extension = await get_image_info_and_save(
                url, os.path.join(FILES_DIR, f"{image_id}")
            )
            filename = f"{image_id}.{extension}"
            return mime_type, width, height, filename

        except Exception as e:
            print('Error generating image with ComfyUI:', e)
            traceback.print_exc()
            raise e


class ComfyUIWorkflowProvider(ImageProviderBase, provider_name="comfyui_workflow"):
    """ComfyUI workflow runner provider implementation"""

    def __init__(self, workflow_dict: dict[str, Any], base_url: str):
        self.workflow = workflow_dict
        self.base_url = base_url

    async def generate(
        self,
        prompt: str,
        model: str,
        aspect_ratio: str = "1:1",
        input_images: Optional[list[str]] = None,
        **kwargs: Any
    ) -> tuple[str, int, int, str]:
        """
        Run a workflow by calling official ComfyUI Client

        Args:
            prompt: Image generation prompt (not used in workflow mode)
            model: Model name (not used in workflow mode)
            aspect_ratio: Image aspect ratio (not used in workflow mode)
            input_images: Optional input images (not used in workflow mode)
            **kwargs: Additional provider-specific parameters

        Returns:
            tuple[str, int, int, str]: (mime_type, width, height, filename)
        """
        try:
            # Get context from kwargs
            ctx = kwargs.get("ctx", {})

            execution = await execute(
                self.workflow, self.base_url, local_paths=True, ctx=ctx
            )
            print("🦄workflow execution outputs", execution.outputs)

            url = execution.outputs[0]

            # Save the image
            image_id = generate_image_id()
            mime_type, width, height, extension = await get_image_info_and_save(
                url, os.path.join(FILES_DIR, f"{image_id}")
            )

            filename = f"{image_id}.{extension}"
            return mime_type, width, height, filename

        except Exception as e:
            print('Error generating image with ComfyUI Workflow:', e)
            traceback.print_exc()
            raise e
