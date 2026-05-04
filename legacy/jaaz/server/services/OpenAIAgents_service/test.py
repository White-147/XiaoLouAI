from agents import Agent, Runner, set_tracing_disabled, set_default_openai_key
import asyncio
from services.config_service import config_service
config = config_service.get_config()

set_tracing_disabled(True)
api_key = config.get('openai', {}).get('api_key', '')
set_default_openai_key(str(api_key))



async def create_magic_response():
    intent_agent = Agent(
        name="Intent Agent",
        instructions="You are a helpful assistant that can analyze images and provide a summary of the content.",
        model="gpt-4.1-mini",
    )
    result = await Runner.run(intent_agent, input='Hi')
    print(result.final_output)



if __name__ == "__main__":
    asyncio.run(create_magic_response())






