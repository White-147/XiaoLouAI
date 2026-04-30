import { Message, Model } from '@/types/types'
import { ModelInfo, ToolInfo } from './model'
import { readXiaolouPrefetchCache } from '@/lib/xiaolou-prefetch-cache'

export type ChatSessionPage = {
  messages: Message[]
  hasMore: boolean
  nextBeforeId: number | null
}

export const getChatSession = async (
  sessionId: string,
  options: { limit?: number; beforeId?: number | null } = {}
): Promise<ChatSessionPage> => {
  const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : 0
  const beforeId = options.beforeId && options.beforeId > 0 ? Math.floor(options.beforeId) : null
  const useLatestPrefetch = Boolean(limit && !beforeId)
  if (useLatestPrefetch) {
    const prefetched = readXiaolouPrefetchCache<ChatSessionPage | Message[]>(
      `xiaolou:jaaz-prefetch:chat:${sessionId}:latest`
    )
    if (prefetched) {
      return Array.isArray(prefetched)
        ? { messages: prefetched, hasMore: false, nextBeforeId: null }
        : prefetched
    }
  }

  const params = new URLSearchParams()
  if (limit) params.set('limit', String(limit))
  if (beforeId) params.set('before_id', String(beforeId))
  const query = params.toString()
  const response = await fetch(`/api/chat_session/${sessionId}${query ? `?${query}` : ''}`)
  const data = await response.json()
  if (Array.isArray(data)) {
    return { messages: data as Message[], hasMore: false, nextBeforeId: null }
  }
  return {
    messages: (data?.messages || []) as Message[],
    hasMore: Boolean(data?.has_more),
    nextBeforeId:
      typeof data?.next_before_id === 'number' ? data.next_before_id : null,
  }
}

export const sendMessages = async (payload: {
  sessionId: string
  canvasId: string
  newMessages: Message[]
  textModel: Model
  toolList: ToolInfo[]
  systemPrompt: string | null
}) => {
  const response = await fetch(`/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: payload.newMessages,
      canvas_id: payload.canvasId,
      session_id: payload.sessionId,
      text_model: payload.textModel,
      tool_list: payload.toolList,
      system_prompt: payload.systemPrompt,
    }),
  })
  const data = await response.json()
  return data as Message[]
}

export const cancelChat = async (sessionId: string) => {
  const response = await fetch(`/api/cancel/${sessionId}`, {
    method: 'POST',
  })
  return await response.json()
}
