export type ModelInfo = {
  provider: string
  model: string
  display_name?: string | null
  type: 'text' | 'image' | 'tool' | 'video'
  url: string
}

export type ToolInfo = {
  provider: string
  id: string
  display_name?: string | null
  type?: 'image' | 'tool' | 'video'
}

export function getSafeDefaultTools(tools: ToolInfo[]): ToolInfo[] {
  if (!tools.length || tools.some((tool) => tool.provider !== 'xiaolou')) {
    return tools
  }

  const preferredImage =
    tools.find((tool) => tool.id === 'xiaolou_image_doubao_seedream_5_0_260128') ||
    tools.find((tool) => tool.type === 'image')
  const preferredVideo =
    tools.find((tool) => tool.id === 'xiaolou_video_doubao_seedance_2_0_260128') ||
    tools.find((tool) => tool.type === 'video')

  return [preferredImage, preferredVideo].filter(Boolean) as ToolInfo[]
}

export async function listModels(): Promise<{
  llm: ModelInfo[]
  tools: ToolInfo[]
}> {
  const modelsResp = await fetch('/api/list_models')
    .then((res) => res.json())
    .catch((err) => {
      console.error(err)
      return []
    })
  const toolsResp = await fetch('/api/list_tools')
    .then((res) => res.json())
    .catch((err) => {
      console.error(err)
      return []
    })

  return {
    llm: modelsResp,
    tools: toolsResp,
  }
}
