from pydantic import BaseModel
from typing import Literal, NotRequired, TypedDict

class LLMConfig(BaseModel):
    model: str
    base_url: str
    api_key: str
    max_tokens: int
    temperature: float

class ConfigUpdate(BaseModel):
    llm: LLMConfig

class ModelInfo(TypedDict):
    provider: str
    model: str # For tool type, it is the function name
    display_name: NotRequired[str]
    url: str
    type: Literal['text', 'image', 'tool', 'video']
