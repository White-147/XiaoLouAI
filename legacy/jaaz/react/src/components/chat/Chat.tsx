import { getChatSession, sendMessages } from '@/api/chat'
import Blur from '@/components/common/Blur'
import { ScrollArea } from '@/components/ui/scroll-area'
import { eventBus, TEvents } from '@/lib/event'
import ChatMagicGenerator from './ChatMagicGenerator'
import {
  AssistantMessage,
  Message,
  Model,
  PendingType,
  Session,
} from '@/types/types'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { produce } from 'immer'
import { motion } from 'motion/react'
import { nanoid } from 'nanoid'
import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { PhotoProvider } from 'react-photo-view'
import { toast } from 'sonner'
import ShinyText from '../ui/shiny-text'
import ChatTextarea from './ChatTextarea'
import MessageRegular from './Message/Regular'
import { ToolCallContent } from './Message/ToolCallContent'
import ToolCallTag from './Message/ToolCallTag'
import SessionSelector from './SessionSelector'
import ChatSpinner from './Spinner'
import ToolcallProgressUpdate from './ToolcallProgressUpdate'
import ShareTemplateDialog from './ShareTemplateDialog'

import { useConfigs } from '@/contexts/configs'
import 'react-photo-view/dist/react-photo-view.css'
import { DEFAULT_SYSTEM_PROMPT } from '@/constants'
import { ModelInfo, ToolInfo } from '@/api/model'
import { Button } from '@/components/ui/button'
import {
  BrainCircuit,
  CheckCircle2,
  CircleAlert,
  Loader2,
  Share2,
  Wrench,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useQueryClient } from '@tanstack/react-query'
import MixedContent, { MixedContentImages, MixedContentText } from './Message/MixedContent'

const CHAT_HISTORY_PAGE_SIZE = 80

type AgentProcessPhase = 'thinking' | 'tool' | 'done' | 'error'
type AgentProcessStatus = 'active' | 'done' | 'error'

type AgentProcessEvent = {
  id: string
  phase: AgentProcessPhase
  title: string
  detail?: string
  status: AgentProcessStatus
}

function createAgentProcessEvent(
  phase: AgentProcessPhase,
  title: string,
  detail?: string,
  status: AgentProcessStatus = 'active'
): AgentProcessEvent {
  return {
    id: `agent-process-${Date.now()}-${nanoid(6)}`,
    phase,
    title,
    detail,
    status,
  }
}

function completeActiveProcessEvents(events: AgentProcessEvent[]) {
  return events.map((event) =>
    event.status === 'active' ? { ...event, status: 'done' as const } : event
  )
}

function getAgentProcessCaption(phase: AgentProcessPhase) {
  if (phase === 'tool') return '工具调用'
  if (phase === 'done') return '完成'
  if (phase === 'error') return '中断'
  return '模型思考'
}

function AgentProcessPanel({
  events,
  pending,
}: {
  events: AgentProcessEvent[]
  pending: PendingType
}) {
  if (!pending && events.length === 0) return null

  const currentEvent =
    [...events].reverse().find((event) => event.status === 'active') ||
    events.at(-1) ||
    createAgentProcessEvent('thinking', '模型正在思考...', undefined, 'active')
  const visibleEvents = events.slice(-8)
  const CurrentIcon =
    currentEvent.status === 'active'
      ? Loader2
      : currentEvent.status === 'error'
        ? CircleAlert
        : currentEvent.phase === 'tool'
          ? Wrench
          : currentEvent.phase === 'done'
            ? CheckCircle2
            : BrainCircuit

  return (
    <div className='mt-2 rounded-2xl border border-violet-100 bg-white/92 px-3 py-3 shadow-sm backdrop-blur dark:border-violet-400/15 dark:bg-slate-900/92'>
      <div className='flex items-center gap-2'>
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
            currentEvent.status === 'error'
              ? 'bg-red-50 text-red-500 dark:bg-red-500/10'
              : currentEvent.phase === 'tool'
                ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10'
                : 'bg-violet-50 text-violet-600 dark:bg-violet-500/10'
          }`}
        >
          <CurrentIcon
            className={`h-3.5 w-3.5 ${
              currentEvent.status === 'active' ? 'animate-spin' : ''
            }`}
          />
        </span>
        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 items-center gap-2'>
            <span className='truncate text-sm font-medium text-slate-950 dark:text-slate-100'>
              {currentEvent.title}
            </span>
            <span className='shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400'>
              {getAgentProcessCaption(currentEvent.phase)}
            </span>
          </div>
          {currentEvent.detail && (
            <div className='mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400'>
              {currentEvent.detail}
            </div>
          )}
        </div>
      </div>

      {visibleEvents.length > 0 && (
        <div className='mt-3 space-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800'>
          {visibleEvents.map((event) => (
            <div key={event.id} className='flex min-w-0 items-start gap-2'>
              <span
                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                  event.status === 'active'
                    ? 'bg-violet-500'
                    : event.status === 'error'
                      ? 'bg-red-500'
                      : 'bg-emerald-500'
                }`}
              />
              <div className='min-w-0 flex-1'>
                <div className='truncate text-xs font-medium text-slate-700 dark:text-slate-200'>
                  {event.title}
                </div>
                {event.detail && (
                  <div className='line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400'>
                    {event.detail}
                  </div>
                )}
              </div>
              <span className='shrink-0 text-[11px] text-slate-400'>
                {getAgentProcessCaption(event.phase)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

type ChatInterfaceProps = {
  canvasId: string
  sessionList: Session[]
  setSessionList: Dispatch<SetStateAction<Session[]>>
  sessionId: string
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  canvasId,
  sessionList,
  setSessionList,
  sessionId: searchSessionId,
}) => {
  const { t } = useTranslation()
  const [session, setSession] = useState<Session | null>(null)
  const { initCanvas, setInitCanvas } = useConfigs()
  const { authStatus } = useAuth()
  const [showShareDialog, setShowShareDialog] = useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  useEffect(() => {
    if (sessionList.length > 0) {
      let _session = null
      if (searchSessionId) {
        _session = sessionList.find((s) => s.id === searchSessionId) || null
      } else {
        _session = sessionList[0]
      }
      setSession(_session)
    } else {
      setSession(null)
    }
  }, [sessionList, searchSessionId])

  const [messages, setMessages] = useState<Message[]>([])
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [nextBeforeMessageId, setNextBeforeMessageId] = useState<number | null>(
    null
  )
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [pending, setPending] = useState<PendingType>(
    initCanvas ? 'text' : false
  )
  const [processEvents, setProcessEvents] = useState<AgentProcessEvent[]>([])
  const mergedToolCallIds = useRef<string[]>([])
  const hasOutputStartedRef = useRef(false)
  const argumentStartedToolIdsRef = useRef<Set<string>>(new Set())

  const sessionId = session?.id ?? searchSessionId

  const sessionIdRef = useRef<string>(session?.id || nanoid())
  const [expandingToolCalls, setExpandingToolCalls] = useState<string[]>([])
  const [pendingToolConfirmations, setPendingToolConfirmations] = useState<
    string[]
  >([])

  const scrollRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(false)

  const scrollToBottom = useCallback(() => {
    if (!isAtBottomRef.current) {
      return
    }
    setTimeout(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current!.scrollHeight,
        behavior: 'smooth',
      })
    }, 200)
  }, [])

  const mergeToolCallResult = useCallback((messages: Message[]) => {
    const messagesWithToolCallResult = messages.map((message, index) => {
      if (message.role === 'assistant' && message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          // From the next message, find the tool call result
          for (let i = index + 1; i < messages.length; i++) {
            const nextMessage = messages[i]
            if (
              nextMessage.role === 'tool' &&
              nextMessage.tool_call_id === toolCall.id
            ) {
              toolCall.result = nextMessage.content
              mergedToolCallIds.current.push(toolCall.id)
            }
          }
        }
      }
      return message
    })

    return messagesWithToolCallResult
  }, [])

  const pushProcessEvent = useCallback(
    (
      phase: AgentProcessPhase,
      title: string,
      detail?: string,
      status: AgentProcessStatus = 'active'
    ) => {
      setProcessEvents((current) => [
        ...completeActiveProcessEvents(current),
        createAgentProcessEvent(phase, title, detail, status),
      ].slice(-12))
    },
    []
  )

  const handleDelta = useCallback(
    (data: TEvents['Socket::Session::Delta']) => {
      if (data.session_id && data.session_id !== sessionId) {
        return
      }

      setPending('text')
      if (!hasOutputStartedRef.current) {
        hasOutputStartedRef.current = true
        pushProcessEvent('thinking', '模型开始输出回复', undefined, 'done')
      }
      setMessages(
        produce((prev) => {
          const last = prev.at(-1)
          if (
            last?.role === 'assistant' &&
            last.content != null &&
            last.tool_calls == null
          ) {
            if (typeof last.content === 'string') {
              last.content += data.text
            } else if (
              last.content &&
              last.content.at(-1) &&
              last.content.at(-1)!.type === 'text'
            ) {
              ;(last.content.at(-1) as { text: string }).text += data.text
            }
          } else {
            prev.push({
              role: 'assistant',
              content: data.text,
            })
          }
        })
      )
      scrollToBottom()
    },
    [sessionId, scrollToBottom, pushProcessEvent]
  )

  const handleToolCall = useCallback(
    (data: TEvents['Socket::Session::ToolCall']) => {
      if (data.session_id && data.session_id !== sessionId) {
        return
      }

      const existToolCall = messages.find(
        (m) =>
          m.role === 'assistant' &&
          m.tool_calls &&
          m.tool_calls.find((t) => t.id == data.id)
      )

      if (existToolCall) {
        return
      }

      pushProcessEvent(
        'tool',
        `准备调用工具：${data.name}`,
        `工具 ID：${data.id}`
      )
      setMessages(
        produce((prev) => {
          console.log('👇tool_call event get', data)
          setPending('tool')
          prev.push({
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                type: 'function',
                function: {
                  name: data.name,
                  arguments: '',
                },
                id: data.id,
              },
            ],
          })
        })
      )

      setExpandingToolCalls(
        produce((prev) => {
          prev.push(data.id)
        })
      )
    },
    [sessionId, pushProcessEvent, messages]
  )

  const handleToolCallPendingConfirmation = useCallback(
    (data: TEvents['Socket::Session::ToolCallPendingConfirmation']) => {
      if (data.session_id && data.session_id !== sessionId) {
        return
      }

      const existToolCall = messages.find(
        (m) =>
          m.role === 'assistant' &&
          m.tool_calls &&
          m.tool_calls.find((t) => t.id == data.id)
      )

      if (existToolCall) {
        return
      }

      pushProcessEvent(
        'tool',
        `等待确认工具：${data.name}`,
        data.arguments ? data.arguments.slice(0, 300) : undefined
      )
      setMessages(
        produce((prev) => {
          console.log('👇tool_call_pending_confirmation event get', data)
          setPending('tool')
          prev.push({
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                type: 'function',
                function: {
                  name: data.name,
                  arguments: data.arguments,
                },
                id: data.id,
              },
            ],
          })
        })
      )

      setPendingToolConfirmations(
        produce((prev) => {
          prev.push(data.id)
        })
      )

      // 自动展开需要确认的工具调用
      setExpandingToolCalls(
        produce((prev) => {
          if (!prev.includes(data.id)) {
            prev.push(data.id)
          }
        })
      )
    },
    [sessionId, pushProcessEvent, messages]
  )

  const handleToolCallConfirmed = useCallback(
    (data: TEvents['Socket::Session::ToolCallConfirmed']) => {
      if (data.session_id && data.session_id !== sessionId) {
        return
      }

      setPendingToolConfirmations(
        produce((prev) => {
          return prev.filter((id) => id !== data.id)
        })
      )

      setExpandingToolCalls(
        produce((prev) => {
          if (!prev.includes(data.id)) {
            prev.push(data.id)
          }
        })
      )
    },
    [sessionId]
  )

  const handleToolCallCancelled = useCallback(
    (data: TEvents['Socket::Session::ToolCallCancelled']) => {
      if (data.session_id && data.session_id !== sessionId) {
        return
      }

      setPendingToolConfirmations(
        produce((prev) => {
          return prev.filter((id) => id !== data.id)
        })
      )

      // 更新工具调用的状态
      setMessages(
        produce((prev) => {
          prev.forEach((msg) => {
            if (msg.role === 'assistant' && msg.tool_calls) {
              msg.tool_calls.forEach((tc) => {
                if (tc.id === data.id) {
                  // 添加取消状态标记
                  tc.result = '工具调用已取消'
                }
              })
            }
          })
        })
      )
    },
    [sessionId]
  )

  const handleToolCallArguments = useCallback(
    (data: TEvents['Socket::Session::ToolCallArguments']) => {
      if (data.session_id && data.session_id !== sessionId) {
        return
      }

      if (!argumentStartedToolIdsRef.current.has(data.id)) {
        argumentStartedToolIdsRef.current.add(data.id)
        pushProcessEvent(
          'tool',
          '正在接收工具参数',
          data.text ? data.text.slice(0, 300) : `工具 ID：${data.id}`,
          'done'
        )
      }

      setMessages(
        produce((prev) => {
          setPending('tool')
          const lastMessage = prev.find(
            (m) =>
              m.role === 'assistant' &&
              m.tool_calls &&
              m.tool_calls.find((t) => t.id == data.id)
          ) as AssistantMessage

          if (lastMessage) {
            const toolCall = lastMessage.tool_calls!.find(
              (t) => t.id == data.id
            )
            if (toolCall) {
              // 检查是否是待确认的工具调用，如果是则跳过参数追加
              if (pendingToolConfirmations.includes(data.id)) {
                return
              }
              toolCall.function.arguments += data.text
            }
          }
        })
      )
      scrollToBottom()
    },
    [sessionId, scrollToBottom, pendingToolConfirmations, pushProcessEvent]
  )

  const handleToolCallResult = useCallback(
    (data: TEvents['Socket::Session::ToolCallResult']) => {
      console.log('😘🖼️tool_call_result event get', data)
      if (data.session_id && data.session_id !== sessionId) {
        return
      }
      // TODO: support other non string types of returning content like image_url
      pushProcessEvent(
        'tool',
        '工具返回结果',
        data.message.content
          ? String(data.message.content).slice(0, 300)
          : `工具 ID：${data.id}`,
        'done'
      )
      if (data.message.content) {
        setMessages(
          produce((prev) => {
            prev.forEach((m) => {
              if (m.role === 'assistant' && m.tool_calls) {
                m.tool_calls.forEach((t) => {
                  if (t.id === data.id) {
                    t.result = data.message.content
                  }
                })
              }
            })
          })
        )
      }
    },
    [sessionId, pushProcessEvent]
  )

  const handleImageGenerated = useCallback(
    (data: TEvents['Socket::Session::ImageGenerated']) => {
      if (
        data.canvas_id &&
        data.canvas_id !== canvasId &&
        data.session_id !== sessionId
      ) {
        return
      }

      console.log('⭐️dispatching image_generated', data)
      setPending('image')
      pushProcessEvent('tool', '图片生成完成', data.image_url, 'done')
    },
    [canvasId, sessionId, pushProcessEvent]
  )

  const handleToolCallProgress = useCallback(
    (data: TEvents['Socket::Session::ToolCallProgress']) => {
      if (data.session_id && data.session_id !== sessionId) {
        return
      }
      pushProcessEvent('tool', '工具执行进度', data.update, 'active')
    },
    [sessionId, pushProcessEvent]
  )

  const handleAllMessages = useCallback(
    (data: TEvents['Socket::Session::AllMessages']) => {
      if (data.session_id && data.session_id !== sessionId) {
        return
      }

      setMessages(() => {
        console.log('👇all_messages', data.messages)
        return data.messages
      })
      setMessages(mergeToolCallResult(data.messages))
      scrollToBottom()
    },
    [sessionId, scrollToBottom, mergeToolCallResult]
  )

  const handleDone = useCallback(
    (data: TEvents['Socket::Session::Done']) => {
      if (data.session_id && data.session_id !== sessionId) {
        return
      }

      setPending(false)
      setProcessEvents((current) => [
        ...completeActiveProcessEvents(current),
        createAgentProcessEvent('done', 'Agent 执行完成', undefined, 'done'),
      ].slice(-12))
      scrollToBottom()

      // 聊天输出完毕后更新余额
      if (authStatus.is_logged_in) {
        queryClient.invalidateQueries({ queryKey: ['balance'] })
      }
    },
    [sessionId, scrollToBottom, authStatus.is_logged_in, queryClient]
  )

  const handleError = useCallback((data: TEvents['Socket::Session::Error']) => {
    setPending(false)
    setProcessEvents((current) => [
      ...completeActiveProcessEvents(current),
      createAgentProcessEvent('error', 'Agent 执行失败', data.error, 'error'),
    ].slice(-12))
    toast.error('Error: ' + data.error, {
      closeButton: true,
      duration: 3600 * 1000,
      style: { color: 'red' },
    })
  }, [])

  const handleInfo = useCallback(
    (data: TEvents['Socket::Session::Info']) => {
      if (data.session_id && data.session_id !== sessionId) {
        return
      }
      pushProcessEvent('thinking', 'Agent 状态', data.info, 'done')
      toast.info(data.info, {
        closeButton: true,
        duration: 10 * 1000,
      })
    },
    [sessionId, pushProcessEvent]
  )

  useEffect(() => {
    const handleScroll = () => {
      if (scrollRef.current) {
        isAtBottomRef.current =
          scrollRef.current.scrollHeight - scrollRef.current.scrollTop <=
          scrollRef.current.clientHeight + 1
      }
    }
    const scrollEl = scrollRef.current
    scrollEl?.addEventListener('scroll', handleScroll)

    eventBus.on('Socket::Session::Delta', handleDelta)
    eventBus.on('Socket::Session::ToolCall', handleToolCall)
    eventBus.on(
      'Socket::Session::ToolCallPendingConfirmation',
      handleToolCallPendingConfirmation
    )
    eventBus.on('Socket::Session::ToolCallConfirmed', handleToolCallConfirmed)
    eventBus.on('Socket::Session::ToolCallCancelled', handleToolCallCancelled)
    eventBus.on('Socket::Session::ToolCallArguments', handleToolCallArguments)
    eventBus.on('Socket::Session::ToolCallResult', handleToolCallResult)
    eventBus.on('Socket::Session::ToolCallProgress', handleToolCallProgress)
    eventBus.on('Socket::Session::ImageGenerated', handleImageGenerated)
    eventBus.on('Socket::Session::AllMessages', handleAllMessages)
    eventBus.on('Socket::Session::Done', handleDone)
    eventBus.on('Socket::Session::Error', handleError)
    eventBus.on('Socket::Session::Info', handleInfo)
    return () => {
      scrollEl?.removeEventListener('scroll', handleScroll)

      eventBus.off('Socket::Session::Delta', handleDelta)
      eventBus.off('Socket::Session::ToolCall', handleToolCall)
      eventBus.off(
        'Socket::Session::ToolCallPendingConfirmation',
        handleToolCallPendingConfirmation
      )
      eventBus.off(
        'Socket::Session::ToolCallConfirmed',
        handleToolCallConfirmed
      )
      eventBus.off(
        'Socket::Session::ToolCallCancelled',
        handleToolCallCancelled
      )
      eventBus.off(
        'Socket::Session::ToolCallArguments',
        handleToolCallArguments
      )
      eventBus.off('Socket::Session::ToolCallResult', handleToolCallResult)
      eventBus.off('Socket::Session::ToolCallProgress', handleToolCallProgress)
      eventBus.off('Socket::Session::ImageGenerated', handleImageGenerated)
      eventBus.off('Socket::Session::AllMessages', handleAllMessages)
      eventBus.off('Socket::Session::Done', handleDone)
      eventBus.off('Socket::Session::Error', handleError)
      eventBus.off('Socket::Session::Info', handleInfo)
    }
  })

  const initChat = useCallback(async () => {
    if (!sessionId) {
      return
    }

    sessionIdRef.current = sessionId

    const page = await getChatSession(sessionId, {
      limit: CHAT_HISTORY_PAGE_SIZE,
    })
    const msgs = page.messages?.length ? page.messages : []

    mergedToolCallIds.current = []
    hasOutputStartedRef.current = false
    argumentStartedToolIdsRef.current = new Set()
    setProcessEvents([])
    setMessages(mergeToolCallResult(msgs))
    setHasOlderMessages(page.hasMore)
    setNextBeforeMessageId(page.nextBeforeId)
    if (msgs.length > 0) {
      setInitCanvas(false)
    }

    scrollToBottom()
  }, [mergeToolCallResult, sessionId, scrollToBottom, setInitCanvas])

  useEffect(() => {
    initChat()
  }, [sessionId, initChat])

  const loadOlderMessages = useCallback(async () => {
    if (
      !sessionId ||
      !hasOlderMessages ||
      !nextBeforeMessageId ||
      loadingOlderMessages
    ) {
      return
    }

    const scrollEl = scrollRef.current
    const previousScrollHeight = scrollEl?.scrollHeight || 0
    const previousScrollTop = scrollEl?.scrollTop || 0

    setLoadingOlderMessages(true)
    try {
      const page = await getChatSession(sessionId, {
        limit: CHAT_HISTORY_PAGE_SIZE,
        beforeId: nextBeforeMessageId,
      })
      setMessages((current) => {
        mergedToolCallIds.current = []
        return mergeToolCallResult([...page.messages, ...current])
      })
      setHasOlderMessages(page.hasMore)
      setNextBeforeMessageId(page.nextBeforeId)
      requestAnimationFrame(() => {
        if (!scrollRef.current) return
        scrollRef.current.scrollTop =
          scrollRef.current.scrollHeight - previousScrollHeight + previousScrollTop
      })
    } finally {
      setLoadingOlderMessages(false)
    }
  }, [
    hasOlderMessages,
    loadingOlderMessages,
    mergeToolCallResult,
    nextBeforeMessageId,
    sessionId,
  ])

  useEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return

    const handleLoadOlderOnTop = () => {
      if (scrollEl.scrollTop <= 80) {
        void loadOlderMessages()
      }
    }

    scrollEl.addEventListener('scroll', handleLoadOlderOnTop)
    return () => scrollEl.removeEventListener('scroll', handleLoadOlderOnTop)
  }, [loadOlderMessages])

  const onSelectSession = (sessionId: string) => {
    setSession(sessionList.find((s) => s.id === sessionId) || null)
    navigate({
      to: '/canvas/$id',
      params: { id: canvasId },
      search: { sessionId },
    })
  }

  const onClickNewChat = () => {
    const newSession: Session = {
      id: nanoid(),
      title: t('chat:newChat'),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      model: session?.model || 'gpt-4o',
      provider: session?.provider || 'openai',
    }

    setSessionList((prev) => [...prev, newSession])
    onSelectSession(newSession.id)
  }

  const onSendMessages = useCallback(
    (data: Message[], configs: { textModel: Model; toolList: ToolInfo[] }) => {
      setPending('text')
      hasOutputStartedRef.current = false
      argumentStartedToolIdsRef.current = new Set()
      setProcessEvents([
        createAgentProcessEvent(
          'thinking',
          '模型正在思考...',
          '已收到用户输入，正在规划下一步',
          'active'
        ),
      ])
      setMessages(data)

      sendMessages({
        sessionId: sessionId!,
        canvasId: canvasId,
        newMessages: data,
        textModel: configs.textModel,
        toolList: configs.toolList,
        systemPrompt:
          localStorage.getItem('system_prompt') || DEFAULT_SYSTEM_PROMPT,
      })

      if (searchSessionId !== sessionId) {
        navigate({
          to: '/canvas/$id',
          params: { id: canvasId },
          search: { sessionId },
        })
      }

      scrollToBottom()
    },
    [canvasId, sessionId, searchSessionId, scrollToBottom, navigate]
  )

  const handleCancelChat = useCallback(() => {
    setPending(false)
    setProcessEvents((current) => [
      ...completeActiveProcessEvents(current),
      createAgentProcessEvent('error', '已停止生成', '用户手动终止当前任务', 'error'),
    ].slice(-12))
  }, [])

  return (
    <PhotoProvider>
      <div className='relative flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-b from-white via-[#f8fafc] to-[#f5f7fb] dark:from-slate-950 dark:via-slate-950 dark:to-slate-900'>
        {/* Chat messages */}

        <header className='absolute top-0 z-10 flex w-full items-center border-b border-slate-200/70 bg-white/[0.82] px-3 py-2 shadow-[0_8px_24px_rgba(15,23,42,0.04)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/[0.82]'>
          <div className='flex-1 min-w-0'>
            <SessionSelector
              session={session}
              sessionList={sessionList}
              onClickNewChat={onClickNewChat}
              onSelectSession={onSelectSession}
            />
          </div>

          {/* Share Template Button */}
          {/* {authStatus.is_logged_in && (
            <Button
              variant="outline"
              size="sm"
              className="ml-2 shrink-0"
              onClick={() => setShowShareDialog(true)}
            >
              <Share2 className="h-4 w-4 mr-1" />
            </Button>
          )} */}

          <Blur className='absolute top-0 left-0 right-0 h-full -z-1' bgOpacity={45} />
        </header>

        <ScrollArea className='min-h-0 flex-1' viewportRef={scrollRef}>
          {messages.length > 0 ? (
            <div className='flex flex-1 flex-col px-4 pb-50 pt-16'>
              {hasOlderMessages && (
                <div className='flex justify-center pb-3'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    disabled={loadingOlderMessages}
                    onClick={() => void loadOlderMessages()}
                    className='text-xs text-muted-foreground'
                  >
                    {loadingOlderMessages ? '加载中...' : '加载更早对话'}
                  </Button>
                </div>
              )}
              {/* Messages */}
              {messages.map((message, idx) => (
                <div key={`${idx}`} className='mb-3 flex flex-col gap-3'>
                  {/* Regular message content */}
                  {typeof message.content == 'string' &&
                    (message.role !== 'tool' ? (
                      <MessageRegular
                        message={message}
                        content={message.content}
                      />
                    ) : message.tool_call_id &&
                      mergedToolCallIds.current.includes(
                        message.tool_call_id
                      ) ? (
                      <></>
                    ) : (
                      <ToolCallContent
                        expandingToolCalls={expandingToolCalls}
                        message={message}
                      />
                    ))}

                  {/* 混合内容消息的文本部分 - 显示在聊天框内 */}
                  {Array.isArray(message.content) && (
                    <>
                      <MixedContentImages
                        contents={message.content}
                      />
                      <MixedContentText
                        message={message}
                        contents={message.content}
                      />
                    </>
                  )}

                  {message.role === 'assistant' &&
                    message.tool_calls &&
                    message.tool_calls.at(-1)?.function.name != 'finish' &&
                    message.tool_calls.map((toolCall, i) => {
                      return (
                        <ToolCallTag
                          key={toolCall.id}
                          toolCall={toolCall}
                          isExpanded={expandingToolCalls.includes(toolCall.id)}
                          onToggleExpand={() => {
                            if (expandingToolCalls.includes(toolCall.id)) {
                              setExpandingToolCalls((prev) =>
                                prev.filter((id) => id !== toolCall.id)
                              )
                            } else {
                              setExpandingToolCalls((prev) => [
                                ...prev,
                                toolCall.id,
                              ])
                            }
                          }}
                          requiresConfirmation={pendingToolConfirmations.includes(
                            toolCall.id
                          )}
                          onConfirm={() => {
                            // 发送确认事件到后端
                            fetch('/api/tool_confirmation', {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                              },
                              body: JSON.stringify({
                                session_id: sessionId,
                                tool_call_id: toolCall.id,
                                confirmed: true,
                              }),
                            })
                          }}
                          onCancel={() => {
                            // 发送取消事件到后端
                            fetch('/api/tool_confirmation', {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                              },
                              body: JSON.stringify({
                                session_id: sessionId,
                                tool_call_id: toolCall.id,
                                confirmed: false,
                              }),
                            })
                          }}
                        />
                      )
                    })}
                </div>
              ))}
              {(pending || processEvents.length > 0) && (
                <AgentProcessPanel events={processEvents} pending={pending} />
              )}
              {pending && <ChatSpinner pending={pending} />}
              {pending && sessionId && (
                <ToolcallProgressUpdate sessionId={sessionId} />
              )}
            </div>
          ) : (
            <motion.div className='flex flex-col h-full p-4 items-start justify-start pt-16 select-none'>
              <motion.span
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className='text-muted-foreground text-3xl'
              >
                <ShinyText text='Hello, Jaaz!' />
              </motion.span>
              <motion.span
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className='text-muted-foreground text-2xl'
              >
                <ShinyText text='How can I help you today?' />
              </motion.span>
              {(pending || processEvents.length > 0) && (
                <div className='mt-6 w-full'>
                  <AgentProcessPanel events={processEvents} pending={pending} />
                  {pending && (
                    <div className='mt-3'>
                      <ChatSpinner pending={pending} />
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </ScrollArea>

        <div className='sticky bottom-0 gap-2 border-t border-slate-200/50 bg-white/[0.72] p-2 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/[0.72]'>
          <ChatTextarea
            sessionId={sessionId!}
            pending={!!pending}
            messages={messages}
            onSendMessages={onSendMessages}
            onCancelChat={handleCancelChat}
          />

          {/* 魔法生成组件 */}
          <ChatMagicGenerator
            sessionId={sessionId || ''}
            canvasId={canvasId}
            messages={messages}
            setMessages={setMessages}
            setPending={setPending}
            scrollToBottom={scrollToBottom}
          />
        </div>
      </div>

      {/* Share Template Dialog */}
      <ShareTemplateDialog
        open={showShareDialog}
        onOpenChange={setShowShareDialog}
        canvasId={canvasId}
        sessionId={sessionId || ''}
        messages={messages}
      />
    </PhotoProvider>
  )
}

export default ChatInterface
