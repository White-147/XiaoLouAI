import { Message } from '@/types/types'
import { ToolInfo } from './model'

export const sendMagicGenerate = async (payload: {
  sessionId: string
  canvasId: string
  newMessages: Message[]
  systemPrompt: string | null
  toolList?: ToolInfo[]
}) => {
  const response = await fetch(`/api/magic`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: payload.newMessages,
      canvas_id: payload.canvasId,
      session_id: payload.sessionId,
      system_prompt: payload.systemPrompt,
      tool_list: payload.toolList || [],
    }),
  })
  const data = await response.json()
  return data as Message[]
}

export const cancelMagicGenerate = async (sessionId: string) => {
    const response = await fetch(`/api/magic/cancel/${sessionId}`, {
        method: 'POST',
    })
    return await response.json()
}
