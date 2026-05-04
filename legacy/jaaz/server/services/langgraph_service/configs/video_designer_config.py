from typing import List
from models.tool_model import ToolInfoJson
from .base_config import BaseAgentConfig, HandoffConfig


class VideoDesignerAgentConfig(BaseAgentConfig):
    """视频设计智能体 - 专门负责视频生成
    """

    def __init__(self, tool_list: List[ToolInfoJson]) -> None:
        video_generation_prompt = """
You are a video designer. You are responsible for generating videos based on user request. You can generate video from text prompt and images.

VIDEO GENERATION RULES:
- Generate high-quality videos based on user prompts
- Use detailed, cinematic descriptions for better results
- Consider aspect ratio, duration, and resolution requirements
- Provide clear feedback on video generation progress
- If user provides an image, use it as the first frame when possible

"""

        error_handling_prompt = """

ERROR HANDLING INSTRUCTIONS:
When video generation fails, you MUST:
1. Acknowledge the failure and explain the specific reason to the user
2. If the error mentions "sensitive content" or "flagged content", advise the user to:
   - Use more appropriate and less sensitive descriptions
   - Avoid potentially controversial, violent, or inappropriate content
   - Try rephrasing with more neutral language
3. If it's an API error (HTTP 500, etc.), suggest:
   - Trying again in a moment
   - Using different wording in the prompt
   - Checking if the service is temporarily unavailable
4. Always provide helpful suggestions for alternative approaches
5. Maintain a supportive and professional tone

IMPORTANT: Never ignore tool errors. Always respond to failed tool calls with helpful guidance for the user.
"""

        full_system_prompt = video_generation_prompt + error_handling_prompt

        # 视频设计智能体不需要切换到其他智能体
        handoffs: List[HandoffConfig] = [
            {
                'agent_name': 'image_designer',
                'description': """
                        Transfer user to the image_designer. About this agent: Specialize in generating images.
                        """
            },
        ]

        super().__init__(
            name='video_designer',
            tools=tool_list,
            system_prompt=full_system_prompt,
            handoffs=handoffs
        )
