from pydantic import BaseModel


class ComfyWorkflow(BaseModel):
    id: int
    name: str
    description: str
    inputs: str
    outputs: str
