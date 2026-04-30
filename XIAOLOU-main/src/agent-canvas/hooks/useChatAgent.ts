import { useCallback, useState } from 'react';
import { API_BASE_URL } from '../../lib/api';
import { getAuthToken, getCurrentActorId } from '../../lib/actor-session';
import {
    createGeneratedMediaAction,
    sendJaazAgentMessage,
    type JaazAgentGeneratedMedia,
} from '../services/jaazAgentBridge';

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    media?: {
        type: 'image' | 'video' | 'audio';
        url: string;
    }[];
    timestamp: Date;
}

export interface ChatSession {
    id: string;
    topic: string;
    createdAt: string;
    updatedAt?: string;
    messageCount: number;
}

export type CanvasAgentAction = {
    type?: string;
    action?: string;
    [key: string]: unknown;
};

export type AgentCanvasSnapshot = {
    title: string;
    nodes: unknown[];
    groups: unknown[];
    viewport: unknown;
    selectedNodeIds: string[];
};

export type AgentAttachment = {
    type: 'image' | 'video' | 'audio';
    url: string;
    nodeId?: string;
    base64?: string;
};

export type AgentChatMode = 'chat' | 'agent';

export type AgentChatOptions = {
    mode?: AgentChatMode;
    model?: string;
    toolId?: string;
    toolType?: 'image' | 'video';
    preferredImageToolId?: string;
    preferredVideoToolId?: string;
    webSearch?: boolean;
    includeCanvasFiles?: boolean;
    instruction?: string;
};

interface UseChatAgentOptions {
    getCanvasSnapshot?: () => AgentCanvasSnapshot;
    onApplyActions?: (actions: CanvasAgentAction[]) => Promise<void> | void;
}

interface UseChatAgentReturn {
    messages: ChatMessage[];
    topic: string | null;
    sessionId: string | null;
    isLoading: boolean;
    error: string | null;
    sessions: ChatSession[];
    isLoadingSessions: boolean;
    sendMessage: (content: string, media?: AgentAttachment[], chatOptions?: AgentChatOptions) => Promise<void>;
    startNewChat: () => void;
    loadSession: (sessionId: string) => Promise<void>;
    deleteSession: (sessionId: string) => Promise<void>;
    refreshSessions: () => Promise<void>;
    hasMessages: boolean;
}

function generateSessionId(): string {
    return `agent-canvas-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function generateMessageId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

async function requestAgentCanvasChat(body: unknown) {
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('X-Actor-Id', getCurrentActorId());
    const token = getAuthToken();
    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(`${API_BASE_URL}/api/agent-canvas/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
        throw new Error(payload?.error?.message || response.statusText || '智能体画布请求失败');
    }
    return payload.data as {
        response?: string;
        actions?: CanvasAgentAction[];
        warnings?: string[];
        topic?: string;
        sessionId?: string | null;
        provider?: string;
        model?: string;
        fallbackFrom?: string;
    };
}

export function useChatAgent(options: UseChatAgentOptions = {}): UseChatAgentReturn {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [topic, setTopic] = useState<string | null>(null);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sessions, setSessions] = useState<ChatSession[]>([]);

    const ensureSession = useCallback(() => {
        if (!sessionId) {
            const nextSessionId = generateSessionId();
            setSessionId(nextSessionId);
            return nextSessionId;
        }
        return sessionId;
    }, [sessionId]);

    const refreshSessions = useCallback(async () => {
        setSessions([]);
    }, []);

    const loadSession = useCallback(async () => {
        setError('当前版本暂未启用智能体画布对话历史。');
    }, []);

    const deleteSession = useCallback(async () => {
        setSessions([]);
    }, []);

    const sendMessage = useCallback(async (content: string, media?: AgentAttachment[], chatOptions?: AgentChatOptions) => {
        const currentSessionId = ensureSession();
        setError(null);
        setIsLoading(true);
        const currentMessages = messages;

        const userMessage: ChatMessage = {
            id: generateMessageId(),
            role: 'user',
            content,
            media: media?.map((item) => ({ type: item.type, url: item.url })),
            timestamp: new Date(),
        };
        setMessages((prev) => [...prev, userMessage]);

        try {
            const instruction = String(chatOptions?.instruction || '').trim();
            const modelContent = instruction
                ? `${instruction}\n\n用户输入：${content || '请根据当前画布和附件继续。'}`
                : content;

            if (chatOptions?.mode === 'agent') {
                const assistantMessageId = generateMessageId();
                let assistantText = '';
                let statusLines: string[] = ['Jaaz Agent 已启动，正在规划任务...'];
                let generatedMedia: JaazAgentGeneratedMedia[] = [];

                const updateAssistantMessage = () => {
                    const statusText = statusLines.length > 0
                        ? statusLines.map((line) => `- ${line}`).join('\n')
                        : '';
                    const contentText = [
                        assistantText.trim(),
                        statusText ? `\n\n${statusText}` : '',
                    ].join('').trim() || 'Jaaz Agent 正在处理...';

                    setMessages((prev) => prev.map((message) => message.id === assistantMessageId
                        ? {
                            ...message,
                            content: contentText,
                            media: generatedMedia.map((item) => ({ type: item.type, url: item.url })),
                        }
                        : message));
                };

                setMessages((prev) => prev.concat({
                    id: assistantMessageId,
                    role: 'assistant',
                    content: 'Jaaz Agent 已启动，正在规划任务...',
                    timestamp: new Date(),
                }));

                const data = await sendJaazAgentMessage({
                    sessionId: currentSessionId,
                    canvasId: `xiaolou-agent-canvas-${currentSessionId}`,
                    content: modelContent,
                    priorMessages: currentMessages.map((message) => ({
                        role: message.role,
                        content: message.content,
                    })),
                    media,
                    model: chatOptions.model || 'auto',
                    toolId: chatOptions.toolId,
                    toolType: chatOptions.toolType,
                    preferredImageToolId: chatOptions.preferredImageToolId,
                    preferredVideoToolId: chatOptions.preferredVideoToolId,
                    canvas: options.getCanvasSnapshot?.(),
                    callbacks: {
                        onDelta: (delta) => {
                            assistantText += delta;
                            updateAssistantMessage();
                        },
                        onStatus: (line) => {
                            const normalized = line.trim();
                            if (!normalized) return;
                            statusLines = [...statusLines, normalized].slice(-6);
                            updateAssistantMessage();
                        },
                        onGeneratedMedia: (item) => {
                            generatedMedia = generatedMedia.concat(item);
                            void options.onApplyActions?.([
                                createGeneratedMediaAction(item, generatedMedia.length - 1),
                            ]);
                            updateAssistantMessage();
                        },
                    },
                });

                if (data.generatedMedia.length > generatedMedia.length) {
                    generatedMedia = data.generatedMedia;
                }
                if (!assistantText.trim()) {
                    assistantText = data.response || 'Jaaz Agent 已完成。';
                }
                statusLines = data.model ? [`模型：${data.model}`] : [];
                updateAssistantMessage();

                if (!topic) {
                    setTopic(content.slice(0, 40) || '智能体画布');
                }
                return;
            }

            const data = await requestAgentCanvasChat({
                sessionId: currentSessionId,
                message: modelContent,
                model: chatOptions?.model || 'auto',
                tools: {
                    webSearch: chatOptions?.webSearch === true,
                    canvasFiles: chatOptions?.includeCanvasFiles !== false,
                },
                canvas: options.getCanvasSnapshot?.(),
                attachments: media?.map((item) => ({
                    type: item.type,
                    url: item.url,
                    nodeId: item.nodeId,
                    base64: item.base64,
                })),
            });

            const actions = Array.isArray(data.actions) ? data.actions : [];
            if (actions.length > 0) {
                await options.onApplyActions?.(actions);
            }

            const warningText = Array.isArray(data.warnings) && data.warnings.length > 0
                ? `\n\n提示：${data.warnings.join(', ')}`
                : '';
            const modelText = data.model
                ? `\n\n模型：${data.model}${data.fallbackFrom ? `（已从 ${data.fallbackFrom} 自动切换）` : ''}`
                : '';
            const assistantMessage: ChatMessage = {
                id: generateMessageId(),
                role: 'assistant',
                content: `${data.response || '完成。'}${warningText}${modelText}`,
                timestamp: new Date(),
            };
            setMessages((prev) => [...prev, assistantMessage]);

            if (data.topic) {
                setTopic(data.topic);
            } else if (!topic) {
                setTopic(content.slice(0, 40) || '智能体画布');
            }
            if (data.sessionId) {
                setSessionId(data.sessionId);
            }
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : '发送失败';
            setError(errorMessage);
            console.error('Agent canvas chat error:', err);
        } finally {
            setIsLoading(false);
        }
    }, [ensureSession, messages, options, topic]);

    const startNewChat = useCallback(() => {
        setMessages([]);
        setTopic(null);
        setSessionId(generateSessionId());
        setError(null);
    }, []);

    return {
        messages,
        topic,
        sessionId,
        isLoading,
        error,
        sessions,
        isLoadingSessions: false,
        sendMessage,
        startNewChat,
        loadSession,
        deleteSession,
        refreshSessions,
        hasMessages: messages.length > 0,
    };
}

export default useChatAgent;
