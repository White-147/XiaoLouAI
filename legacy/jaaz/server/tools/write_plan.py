from asyncio import sleep
import asyncio
from pydantic import BaseModel, Field
from typing import Optional, Annotated
from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import InjectedToolCallId
from typing import List

class Step(BaseModel):
    title: str
    description: Optional[str] = Field(
        default="",
        description="Description of the step",
    )

class StepsInput(BaseModel):
    steps: List[Step] = Field(
        default_factory=list,
        description="The list of steps, in the order of execution",
    )
    tool_call_id: Annotated[str, InjectedToolCallId]


@tool("write_plan", 
description="""
Write a plan to complete the current task in the order of execution, including the steps and the description of each step. 
The plan should be friendly to showcase to the user.
""",
args_schema=StepsInput)
def write_plan_tool(
    steps: List[Step],
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
) -> str:
    print("write_plan_tool")
    return "<hide_in_user_ui> Plan made. Now you can start executing the plan, or handoff the task to the suitable agent who specializes in the steps of the plan.</hide_from_user>"