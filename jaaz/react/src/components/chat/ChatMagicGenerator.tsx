import { sendMagicGenerate } from '@/api/magic'
import { useConfigs } from '@/contexts/configs'
import { eventBus, TCanvasMagicGenerateEvent } from '@/lib/event'
import { Message, PendingType } from '@/types/types'
import { useCallback, useEffect } from 'react'
import { DEFAULT_SYSTEM_PROMPT } from '@/constants'
import { useAuth } from '@/contexts/AuthContext'

type ChatMagicGeneratorProps = {
    sessionId: string
    canvasId: string
    messages: Message[]
    setMessages: (messages: Message[]) => void
    setPending: (pending: PendingType) => void
    scrollToBottom: () => void
}

const ChatMagicGenerator: React.FC<ChatMagicGeneratorProps> = ({
    sessionId,
    canvasId,
    messages,
    setMessages,
    setPending,
    scrollToBottom
}) => {
    const { setShowLoginDialog, selectedTools } = useConfigs()
    const { authStatus } = useAuth()

    const handleMagicGenerate = useCallback(
        async (data: TCanvasMagicGenerateEvent) => {
            if (!authStatus.is_logged_in) {
                setShowLoginDialog(true)
                return
            }

            // 设置pending状态为text，表示正在处理
            setPending('text')

            // 创建包含图片的消息
            const magicMessage: Message = {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: '✨ Magic Magic! Wait about 1~2 minutes please...'
                    },
                    {
                        type: 'image_url',
                        image_url: {
                            url: data.base64
                        }
                    },
                ]
            }

            // 更新消息列表
            const newMessages = [...messages, magicMessage]
            setMessages(newMessages)
            scrollToBottom()

            // 发送到后台
            try {
                await sendMagicGenerate({
                    sessionId: sessionId,
                    canvasId: canvasId,
                    newMessages: newMessages,
                    systemPrompt: localStorage.getItem('system_prompt') || DEFAULT_SYSTEM_PROMPT,
                    toolList: selectedTools,
                })

                scrollToBottom()
                console.log('魔法生成消息已发送到后台')
            } catch (error) {
                console.error('发送魔法生成消息失败:', error)
                // 发生错误时重置pending状态
                setPending(false)
            }
        },
        [sessionId, canvasId, messages, setMessages, setPending, scrollToBottom, authStatus.is_logged_in, setShowLoginDialog, selectedTools]
    )

    useEffect(() => {
        // 监听魔法生成事件
        eventBus.on('Canvas::MagicGenerate', handleMagicGenerate)

        return () => {
            eventBus.off('Canvas::MagicGenerate', handleMagicGenerate)
        }
    }, [handleMagicGenerate])

    return null // 这是一个纯逻辑组件，不渲染UI
}

export default ChatMagicGenerator
