import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../../lib/api';
import { getAuthToken, getCurrentActorId } from '../../lib/actor-session';

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

export type AgentActivityPhase = 'THINKING' | 'USING_TOOLS' | 'DONE' | 'ERROR';
export type AgentStreamDeltaKind = 'reasoning' | 'content';

export interface AgentActivityEvent {
    id: string;
    phase: AgentActivityPhase;
    title: string;
    detail?: string;
    streamKind?: AgentStreamDeltaKind;
    streamText?: string;
    streamMeta?: string;
    status: 'active' | 'done' | 'error';
    timestamp: Date;
}

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
    modelLabel?: string;
    toolId?: string;
    toolType?: 'image' | 'video';
    preferredImageToolId?: string;
    preferredVideoToolId?: string;
    allowedImageToolIds?: string[];
    allowedVideoToolIds?: string[];
    autoModelPreference?: boolean;
    webSearch?: boolean;
    includeCanvasFiles?: boolean;
    instruction?: string;
    skillId?: string;
    skillTitle?: string;
    skillInstruction?: string;
    maxTokens?: number;
};

type AgentCanvasChatResponse = {
    response?: string;
    actions?: CanvasAgentAction[];
    warnings?: string[];
    topic?: string;
    sessionId?: string | null;
    provider?: string;
    model?: string;
    fallbackFrom?: string;
};

type StoredChatMessage = Omit<ChatMessage, 'timestamp'> & {
    timestamp: string;
};

type StoredChatSession = ChatSession & {
    messages: StoredChatMessage[];
};

export type AgentCanvasProjectChatContext = {
    sessionId: string | null;
    topic: string | null;
    messages: StoredChatMessage[];
    updatedAt?: string;
};

type AgentStreamDelta = {
    kind: AgentStreamDeltaKind;
    text: string;
    provider?: string;
    model?: string;
};

class AgentCanvasStreamError extends Error {
    receivedEvent: boolean;

    constructor(message: string, receivedEvent = false) {
        super(message);
        this.name = 'AgentCanvasStreamError';
        this.receivedEvent = receivedEvent;
    }
}

function isAbortError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const record = error as { name?: unknown; message?: unknown };
    const name = typeof record.name === 'string' ? record.name : '';
    const message = typeof record.message === 'string' ? record.message.toLowerCase() : '';
    return name === 'AbortError' || message.includes('aborted') || message.includes('abort');
}

interface UseChatAgentOptions {
    getCanvasSnapshot?: () => AgentCanvasSnapshot;
    onApplyActions?: (actions: CanvasAgentAction[]) => Promise<void> | void;
    restoreProjectContext?: AgentCanvasProjectChatContext | null;
    onProjectContextChange?: (context: AgentCanvasProjectChatContext) => void;
}

interface UseChatAgentReturn {
    messages: ChatMessage[];
    topic: string | null;
    sessionId: string | null;
    isLoading: boolean;
    activityEvents: AgentActivityEvent[];
    error: string | null;
    sessions: ChatSession[];
    isLoadingSessions: boolean;
    sendMessage: (content: string, media?: AgentAttachment[], chatOptions?: AgentChatOptions) => Promise<void>;
    cancelGeneration: () => void;
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

function generateActivityId(): string {
    return `activity-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

const AGENT_CANVAS_HISTORY_LIMIT = 80;

function getAgentCanvasHistoryKey(): string {
    return `xiaolou:agent-canvas:chat-history:${getCurrentActorId()}`;
}

function canUseLocalStorage(): boolean {
    try {
        return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
    } catch {
        return false;
    }
}

function serializeChatMessage(message: ChatMessage): StoredChatMessage {
    const timestamp = message.timestamp instanceof Date
        ? message.timestamp
        : new Date(message.timestamp);
    return {
        ...message,
        timestamp: Number.isNaN(timestamp.getTime()) ? new Date().toISOString() : timestamp.toISOString(),
    };
}

function deserializeChatMessage(message: StoredChatMessage): ChatMessage {
    const timestamp = new Date(message.timestamp);
    return {
        id: String(message.id || generateMessageId()),
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: String(message.content || ''),
        media: Array.isArray(message.media)
            ? message.media
                .filter((item) => item && typeof item.url === 'string')
                .map((item) => ({
                    type: item.type === 'video' || item.type === 'audio' ? item.type : 'image',
                    url: item.url,
                }))
            : undefined,
        timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
    };
}

function getSessionTopic(messages: ChatMessage[], topicHint?: string | null): string {
    const explicit = String(topicHint || '').trim();
    if (explicit) return explicit.slice(0, 80);
    const firstUser = messages.find((message) => message.role === 'user' && message.content.trim());
    return (firstUser?.content || '新的对话').trim().slice(0, 40) || '新的对话';
}

function readAgentCanvasHistory(): StoredChatSession[] {
    if (!canUseLocalStorage()) return [];
    try {
        const raw = window.localStorage.getItem(getAgentCanvasHistoryKey());
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((item): item is StoredChatSession => Boolean(item) && typeof item === 'object' && typeof item.id === 'string')
            .map((item) => ({
                id: item.id,
                topic: String(item.topic || '新的对话').slice(0, 80),
                createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
                updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : item.createdAt,
                messageCount: Number.isFinite(Number(item.messageCount))
                    ? Number(item.messageCount)
                    : (Array.isArray(item.messages) ? item.messages.length : 0),
                messages: Array.isArray(item.messages) ? item.messages : [],
            }))
            .sort((left, right) => Date.parse(right.updatedAt || right.createdAt) - Date.parse(left.updatedAt || left.createdAt))
            .slice(0, AGENT_CANVAS_HISTORY_LIMIT);
    } catch {
        return [];
    }
}

function writeAgentCanvasHistory(items: StoredChatSession[]): void {
    if (!canUseLocalStorage()) return;
    try {
        window.localStorage.setItem(
            getAgentCanvasHistoryKey(),
            JSON.stringify(items.slice(0, AGENT_CANVAS_HISTORY_LIMIT)),
        );
    } catch {
        // History persistence is best-effort; chat should keep working if storage is full.
    }
}

function summarizeStoredSession(session: StoredChatSession): ChatSession {
    return {
        id: session.id,
        topic: session.topic,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messageCount,
    };
}

function persistAgentCanvasSession(sessionId: string, messages: ChatMessage[], topicHint?: string | null): StoredChatSession {
    const history = readAgentCanvasHistory();
    const now = new Date().toISOString();
    const existing = history.find((item) => item.id === sessionId);
    const stored: StoredChatSession = {
        id: sessionId,
        topic: getSessionTopic(messages, topicHint || existing?.topic),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        messageCount: messages.length,
        messages: messages.map(serializeChatMessage),
    };
    writeAgentCanvasHistory([
        stored,
        ...history.filter((item) => item.id !== sessionId),
    ]);
    return stored;
}

function removeAgentCanvasSession(sessionId: string): StoredChatSession[] {
    const next = readAgentCanvasHistory().filter((item) => item.id !== sessionId);
    writeAgentCanvasHistory(next);
    return next;
}

function buildProjectChatContext(
    sessionId: string | null,
    topic: string | null,
    messages: ChatMessage[],
): AgentCanvasProjectChatContext {
    return {
        sessionId,
        topic,
        messages: messages.map(serializeChatMessage),
        updatedAt: new Date().toISOString(),
    };
}

function getProjectChatContextKey(context: AgentCanvasProjectChatContext | null | undefined): string {
    if (!context || typeof context !== 'object') return '';
    const messages = Array.isArray(context.messages) ? context.messages : [];
    const last = messages[messages.length - 1];
    return [
        context.sessionId || '',
        context.topic || '',
        context.updatedAt || '',
        String(messages.length),
        last?.id || '',
        last?.timestamp || '',
    ].join(':');
}

function listAgentCanvasSessions(): ChatSession[] {
    return readAgentCanvasHistory().map(summarizeStoredSession);
}

function createActivityEvent(
    phase: AgentActivityPhase,
    title: string,
    detail?: string,
    status: AgentActivityEvent['status'] = 'active',
): AgentActivityEvent {
    return {
        id: generateActivityId(),
        phase,
        title,
        detail,
        status,
        timestamp: new Date(),
    };
}

function completeActiveEvents(events: AgentActivityEvent[]): AgentActivityEvent[] {
    return events.map((event) => (
        event.status === 'active'
            ? { ...event, status: 'done' as const }
            : event
    ));
}

function waitForAgentActivityReveal(signal?: AbortSignal, delayMs = 220): Promise<void> {
    if (typeof window === 'undefined' || delayMs <= 0 || signal?.aborted) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        let settled = false;
        let timer: number | null = null;
        const finish = () => {
            if (settled) return;
            settled = true;
            if (timer !== null) window.clearTimeout(timer);
            signal?.removeEventListener('abort', finish);
            resolve();
        };

        timer = window.setTimeout(finish, delayMs);
        signal?.addEventListener('abort', finish, { once: true });
    });
}

function buildStreamMeta(delta: AgentStreamDelta): string | undefined {
    const parts = [
        delta.model ? `模型：${delta.model}` : null,
        delta.provider ? `Provider：${delta.provider}` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : undefined;
}

function appendStreamDeltaEvent(events: AgentActivityEvent[], delta: AgentStreamDelta): AgentActivityEvent[] {
    const text = delta.text;
    if (!text) return events;
    const title = delta.kind === 'reasoning' ? '模型思考流' : '模型输出流';
    const streamMeta = buildStreamMeta(delta);
    const existingIndex = (() => {
        for (let index = events.length - 1; index >= 0; index -= 1) {
            const event = events[index];
            if (event.status === 'active' && event.streamKind === delta.kind) return index;
        }
        return -1;
    })();

    if (existingIndex >= 0) {
        return events.map((event, index) => {
            if (index !== existingIndex) return event;
            const streamText = `${event.streamText || event.detail || ''}${text}`.slice(-8000);
            return {
                ...event,
                detail: streamText,
                streamText,
                streamMeta: streamMeta || event.streamMeta,
                timestamp: new Date(),
            };
        });
    }

    return [
        ...completeActiveEvents(events),
        {
            ...createActivityEvent('THINKING', title, text, 'active'),
            streamKind: delta.kind,
            streamText: text,
            streamMeta,
        },
    ];
}

const ACTION_LABELS: Record<string, string> = {
    create_node: '创建节点',
    update_node: '更新节点',
    delete_nodes: '删除节点',
    delete_node: '删除节点',
    connect_nodes: '连接节点',
    connect_node: '连接节点',
    move_nodes: '移动节点',
    move_node: '移动节点',
    layout_nodes: '整理布局',
    layout: '整理布局',
    group_nodes: '分组节点',
    group_node: '分组节点',
    generate_image: '生成图片',
    generate_video: '生成视频',
    save_canvas: '保存画布',
};

function getActionType(action: CanvasAgentAction): string {
    return String(action.type || action.action || 'unknown').trim().toLowerCase() || 'unknown';
}

function summarizeActions(actions: CanvasAgentAction[]): string {
    if (actions.length === 0) return '没有需要执行的画布动作';
    const counts = new Map<string, number>();
    actions.forEach((action) => {
        const type = getActionType(action);
        counts.set(type, (counts.get(type) || 0) + 1);
    });
    return Array.from(counts.entries())
        .map(([type, count]) => `${ACTION_LABELS[type] || type} x${count}`)
        .join('、');
}

function buildContextDetail(
    canvas: AgentCanvasSnapshot | undefined,
    media: AgentAttachment[] | undefined,
    chatOptions: AgentChatOptions | undefined,
): string {
    const parts = [
        `模型：${chatOptions?.modelLabel || chatOptions?.model || 'Auto'}`,
        chatOptions?.skillTitle ? `Skill：${chatOptions.skillTitle}` : null,
        `节点：${Array.isArray(canvas?.nodes) ? canvas.nodes.length : 0}`,
        `选中：${Array.isArray(canvas?.selectedNodeIds) ? canvas.selectedNodeIds.length : 0}`,
        `附件：${Array.isArray(media) ? media.length : 0}`,
    ].filter(Boolean);
    return parts.join(' · ');
}

function buildAgentCanvasHeaders(): Headers {
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('X-Actor-Id', getCurrentActorId());
    const token = getAuthToken();
    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }
    return headers;
}

async function requestAgentCanvasChat(body: unknown, signal?: AbortSignal): Promise<AgentCanvasChatResponse> {
    const headers = buildAgentCanvasHeaders();

    const response = await fetch(`${API_BASE_URL}/api/agent-canvas/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
        throw new Error(payload?.error?.message || response.statusText || 'Agent canvas request failed');
    }
    return payload.data as AgentCanvasChatResponse;
}

function parseSseEvent(block: string): { event: string; data: unknown } | null {
    const lines = block.split(/\r?\n/);
    let event = 'message';
    const dataLines: string[] = [];

    lines.forEach((line) => {
        if (!line || line.startsWith(':')) return;
        const separatorIndex = line.indexOf(':');
        const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
        const rawValue = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : '';
        const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
        if (field === 'event') {
            event = value || 'message';
        } else if (field === 'data') {
            dataLines.push(value);
        }
    });

    if (dataLines.length === 0) {
        return { event, data: null };
    }

    const dataText = dataLines.join('\n');
    try {
        return { event, data: JSON.parse(dataText) };
    } catch {
        return { event, data: dataText };
    }
}

function coerceActivityPhase(value: unknown): AgentActivityPhase {
    if (value === 'USING_TOOLS' || value === 'DONE' || value === 'ERROR') return value;
    return 'THINKING';
}

function coerceActivityStatus(value: unknown): AgentActivityEvent['status'] {
    if (value === 'done' || value === 'error') return value;
    return 'active';
}

function normalizeStreamStatus(data: unknown): AgentActivityEvent | null {
    if (!data || typeof data !== 'object') return null;
    const record = data as Record<string, unknown>;
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    if (!title) return null;
    const detail = typeof record.detail === 'string' && record.detail.trim()
        ? record.detail.trim()
        : undefined;
    return createActivityEvent(
        coerceActivityPhase(record.phase),
        title,
        detail,
        coerceActivityStatus(record.status),
    );
}

function normalizeStreamActions(data: unknown): CanvasAgentAction[] {
    if (Array.isArray(data)) {
        return data.filter((item): item is CanvasAgentAction => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
    }
    if (!data || typeof data !== 'object') return [];
    const actions = (data as Record<string, unknown>).actions;
    if (!Array.isArray(actions)) return [];
    return actions.filter((item): item is CanvasAgentAction => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
}

function normalizeStreamDelta(data: unknown): AgentStreamDelta | null {
    if (!data || typeof data !== 'object') return null;
    const record = data as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text : '';
    if (!text) return null;
    const kind = record.kind === 'reasoning' ? 'reasoning' : 'content';
    return {
        kind,
        text,
        provider: typeof record.provider === 'string' && record.provider.trim() ? record.provider.trim() : undefined,
        model: typeof record.model === 'string' && record.model.trim() ? record.model.trim() : undefined,
    };
}

function getStreamErrorMessage(data: unknown): string {
    if (data && typeof data === 'object') {
        const message = (data as Record<string, unknown>).message;
        if (typeof message === 'string' && message.trim()) return message.trim();
    }
    return 'Agent canvas stream failed';
}

async function requestAgentCanvasChatStream(
    body: unknown,
    callbacks: {
        onStatus?: (status: AgentActivityEvent) => Promise<void> | void;
        onActions?: (actions: CanvasAgentAction[]) => Promise<void> | void;
        onDelta?: (delta: AgentStreamDelta) => Promise<void> | void;
    } = {},
    signal?: AbortSignal,
): Promise<AgentCanvasChatResponse> {
    const response = await fetch(`${API_BASE_URL}/api/agent-canvas/chat/stream`, {
        method: 'POST',
        headers: buildAgentCanvasHeaders(),
        body: JSON.stringify(body),
        signal,
    });

    if (!response.ok || !response.body) {
        throw new AgentCanvasStreamError(response.statusText || 'Agent stream is not available');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: AgentCanvasChatResponse | null = null;
    let receivedEvent = false;

    const handleBlock = async (block: string) => {
        const parsed = parseSseEvent(block);
        if (!parsed) return;
        receivedEvent = true;
        if (parsed.event === 'ready') {
            return;
        }
        if (parsed.event === 'status') {
            const status = normalizeStreamStatus(parsed.data);
            if (status) await callbacks.onStatus?.(status);
            return;
        }
        if (parsed.event === 'actions') {
            const actions = normalizeStreamActions(parsed.data);
            if (actions.length > 0) await callbacks.onActions?.(actions);
            return;
        }
        if (parsed.event === 'delta') {
            const delta = normalizeStreamDelta(parsed.data);
            if (delta) await callbacks.onDelta?.(delta);
            return;
        }
        if (parsed.event === 'result') {
            result = (parsed.data || {}) as AgentCanvasChatResponse;
            await callbacks.onStatus?.(createActivityEvent(
                'THINKING',
                '模型回复已返回',
                '正在解析工具动作并准备写回画布',
                'done',
            ));
            return;
        }
        if (parsed.event === 'done') {
            return;
        }
        if (parsed.event === 'error') {
            throw new AgentCanvasStreamError(getStreamErrorMessage(parsed.data), true);
        }
    };

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split(/\r?\n\r?\n/);
            buffer = parts.pop() || '';
            for (const part of parts) {
                if (part.trim()) await handleBlock(part);
            }
        }
        buffer += decoder.decode();
        if (buffer.trim()) {
            await handleBlock(buffer);
        }
    } catch (error) {
        if (isAbortError(error)) throw error;
        if (error instanceof AgentCanvasStreamError) throw error;
        throw new AgentCanvasStreamError(error instanceof Error ? error.message : 'Agent stream failed', receivedEvent);
    } finally {
        try {
            reader.releaseLock();
        } catch {
            // Some browser streams can throw while releasing after an abort.
        }
    }

    if (!result) {
        throw new AgentCanvasStreamError('Agent stream ended without result', receivedEvent);
    }
    return result;
}

export function useChatAgent(options: UseChatAgentOptions = {}): UseChatAgentReturn {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [topic, setTopic] = useState<string | null>(null);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [activityEvents, setActivityEvents] = useState<AgentActivityEvent[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [isLoadingSessions, setIsLoadingSessions] = useState(false);
    const clearActivityTimerRef = useRef<number | null>(null);
    const activeRequestRef = useRef<AbortController | null>(null);
    const cancelRequestedRef = useRef(false);
    const messagesRef = useRef<ChatMessage[]>([]);
    const restoredProjectContextKeyRef = useRef<string>('');

    const cancelClearActivityTimer = useCallback(() => {
        if (clearActivityTimerRef.current !== null) {
            window.clearTimeout(clearActivityTimerRef.current);
            clearActivityTimerRef.current = null;
        }
    }, []);

    const scheduleClearActivity = useCallback(() => {
        cancelClearActivityTimer();
        setActivityEvents((prev) => completeActiveEvents(prev));
    }, [cancelClearActivityTimer, options]);

    useEffect(() => () => {
        cancelClearActivityTimer();
        activeRequestRef.current?.abort();
        activeRequestRef.current = null;
    }, [cancelClearActivityTimer]);

    useEffect(() => {
        setSessions(listAgentCanvasSessions());
    }, []);

    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    useEffect(() => {
        const context = options.restoreProjectContext;
        const restoreKey = getProjectChatContextKey(context);
        if (!context || !restoreKey || restoredProjectContextKeyRef.current === restoreKey) {
            return;
        }

        restoredProjectContextKeyRef.current = restoreKey;
        activeRequestRef.current?.abort();
        activeRequestRef.current = null;
        cancelRequestedRef.current = false;
        cancelClearActivityTimer();

        const restoredMessages = Array.isArray(context.messages)
            ? context.messages.map(deserializeChatMessage)
            : [];
        const restoredSessionId = context.sessionId || generateSessionId();
        const restoredTopic = restoredMessages.length > 0
            ? (context.topic || getSessionTopic(restoredMessages, context.topic))
            : null;

        messagesRef.current = restoredMessages;
        setMessages(restoredMessages);
        setSessionId(restoredSessionId);
        setTopic(restoredTopic);
        setActivityEvents([]);
        setError(null);
        setIsLoading(false);

        if (restoredMessages.length > 0) {
            persistAgentCanvasSession(restoredSessionId, restoredMessages, restoredTopic);
        }
        setSessions(listAgentCanvasSessions());
        options.onProjectContextChange?.(buildProjectChatContext(restoredSessionId, restoredTopic, restoredMessages));
    }, [cancelClearActivityTimer, options]);

    const cancelGeneration = useCallback(() => {
        const controller = activeRequestRef.current;
        if (!controller) return;
        cancelRequestedRef.current = true;
        controller.abort();
        activeRequestRef.current = null;
        setIsLoading(false);
        setError(null);
        setActivityEvents((prev) => [
            ...completeActiveEvents(prev),
            createActivityEvent('ERROR', '已终止生成', '用户手动停止当前 Agent 请求', 'error'),
        ]);
    }, []);

    const ensureSession = useCallback(() => {
        if (!sessionId) {
            const nextSessionId = generateSessionId();
            setSessionId(nextSessionId);
            return nextSessionId;
        }
        return sessionId;
    }, [sessionId]);

    const refreshSessions = useCallback(async () => {
        setIsLoadingSessions(true);
        try {
            setSessions(listAgentCanvasSessions());
        } finally {
            setIsLoadingSessions(false);
        }
    }, []);

    const loadSession = useCallback(async (nextSessionId: string) => {
        const stored = readAgentCanvasHistory().find((item) => item.id === nextSessionId);
        if (!stored) {
            setError('未找到该历史对话。');
            setSessions(listAgentCanvasSessions());
            return;
        }
        activeRequestRef.current?.abort();
        activeRequestRef.current = null;
        cancelRequestedRef.current = false;
        cancelClearActivityTimer();
        setSessionId(stored.id);
        setTopic(stored.topic || null);
        const restoredMessages = stored.messages.map(deserializeChatMessage);
        messagesRef.current = restoredMessages;
        setMessages(restoredMessages);
        setActivityEvents([]);
        setError(null);
        setIsLoading(false);
        options.onProjectContextChange?.(buildProjectChatContext(stored.id, stored.topic || null, restoredMessages));
    }, [cancelClearActivityTimer]);

    const deleteSession = useCallback(async (deletedSessionId: string) => {
        const next = removeAgentCanvasSession(deletedSessionId);
        setSessions(next.map(summarizeStoredSession));
        if (deletedSessionId === sessionId) {
            activeRequestRef.current?.abort();
            activeRequestRef.current = null;
            cancelRequestedRef.current = false;
            cancelClearActivityTimer();
            messagesRef.current = [];
            setMessages([]);
            setTopic(null);
            setSessionId(generateSessionId());
            setActivityEvents([]);
            setError(null);
            setIsLoading(false);
            options.onProjectContextChange?.(buildProjectChatContext(null, null, []));
        }
    }, [cancelClearActivityTimer, options, sessionId]);

    const sendMessage = useCallback(async (content: string, media?: AgentAttachment[], chatOptions?: AgentChatOptions) => {
        const currentSessionId = ensureSession();
        activeRequestRef.current?.abort();
        const abortController = new AbortController();
        activeRequestRef.current = abortController;
        cancelRequestedRef.current = false;
        cancelClearActivityTimer();
        setError(null);
        setIsLoading(true);

        const canvasSnapshot = options.getCanvasSnapshot?.();
        const contextDetail = buildContextDetail(canvasSnapshot, media, chatOptions);
        setActivityEvents([
            createActivityEvent('THINKING', '模型正在思考...', contextDetail),
        ]);

        const userMessage: ChatMessage = {
            id: generateMessageId(),
            role: 'user',
            content,
            media: media?.map((item) => ({ type: item.type, url: item.url })),
            timestamp: new Date(),
        };
        const userMessages = [...messagesRef.current, userMessage];
        messagesRef.current = userMessages;
        setMessages(userMessages);
        persistAgentCanvasSession(currentSessionId, userMessages, topic || content || '智能体画布');
        setSessions(listAgentCanvasSessions());
        options.onProjectContextChange?.(
            buildProjectChatContext(currentSessionId, topic || content || '智能体画布', userMessages),
        );

        try {
            const instruction = String(chatOptions?.instruction || '').trim();
            const requestBody = {
                sessionId: currentSessionId,
                message: content || '请根据当前画布和附件继续。',
                model: chatOptions?.model || 'auto',
                modelLabel: chatOptions?.modelLabel,
                mode: chatOptions?.mode || 'agent',
                toolId: chatOptions?.toolId,
                toolType: chatOptions?.toolType,
                preferredImageToolId: chatOptions?.preferredImageToolId,
                preferredVideoToolId: chatOptions?.preferredVideoToolId,
                allowedImageToolIds: chatOptions?.allowedImageToolIds,
                allowedVideoToolIds: chatOptions?.allowedVideoToolIds,
                autoModelPreference: chatOptions?.autoModelPreference,
                instruction,
                skillId: chatOptions?.skillId,
                skillTitle: chatOptions?.skillTitle,
                skillInstruction: chatOptions?.skillInstruction,
                maxTokens: chatOptions?.maxTokens,
                tools: {
                    webSearch: chatOptions?.webSearch === true,
                    canvasFiles: chatOptions?.includeCanvasFiles !== false,
                },
                canvas: canvasSnapshot,
                attachments: media?.map((item) => ({
                    type: item.type,
                    url: item.url,
                    nodeId: item.nodeId,
                    base64: item.base64,
                })),
            };

            let data: AgentCanvasChatResponse;
            let streamedActionCount = 0;
            try {
                data = await requestAgentCanvasChatStream(requestBody, {
                    onStatus: async (status) => {
                        setActivityEvents((prev) => [
                            ...completeActiveEvents(prev),
                            status,
                        ]);
                        await waitForAgentActivityReveal(abortController.signal);
                    },
                    onActions: async (actions) => {
                        if (actions.length === 0) return;
                        streamedActionCount += actions.length;
                        setActivityEvents((prev) => [
                            ...completeActiveEvents(prev),
                            createActivityEvent('USING_TOOLS', `正在执行 ${actions.length} 个画布动作`, summarizeActions(actions), 'active'),
                        ]);
                        await waitForAgentActivityReveal(abortController.signal);
                        await options.onApplyActions?.(actions);
                        setActivityEvents((prev) => [
                            ...completeActiveEvents(prev),
                            createActivityEvent('USING_TOOLS', `已执行 ${actions.length} 个画布动作`, summarizeActions(actions), 'done'),
                        ]);
                        await waitForAgentActivityReveal(abortController.signal, 160);
                    },
                    onDelta: (delta) => {
                        setActivityEvents((prev) => appendStreamDeltaEvent(prev, delta));
                    },
                }, abortController.signal);
            } catch (streamError) {
                if (isAbortError(streamError)) throw streamError;
                if (streamError instanceof AgentCanvasStreamError && streamError.receivedEvent) {
                    throw streamError;
                }
                setActivityEvents((prev) => [
                    ...completeActiveEvents(prev),
                    createActivityEvent('THINKING', 'Planner 正在规划画布动作', contextDetail),
                ]);
                data = await requestAgentCanvasChat(requestBody, abortController.signal);
            }

            const finalActions = Array.isArray(data.actions) ? data.actions : [];
            const actions = streamedActionCount > 0 ? [] : finalActions;
            setActivityEvents((prev) => [
                ...completeActiveEvents(prev),
                createActivityEvent(
                    'THINKING',
                    '解析模型动作',
                    actions.length > 0 ? `收到 ${actions.length} 个画布动作` : '没有需要执行的画布动作',
                    actions.length > 0 ? 'done' : 'active',
                ),
            ]);
            if (actions.length > 0) {
                setActivityEvents((prev) => [
                    ...completeActiveEvents(prev),
                    createActivityEvent('USING_TOOLS', `正在执行 ${actions.length} 个画布动作`, summarizeActions(actions)),
                ]);
                await options.onApplyActions?.(actions);
            }
            setActivityEvents((prev) => [
                ...completeActiveEvents(prev),
                createActivityEvent('DONE', actions.length > 0 ? '画布动作已执行' : '回复已生成', actions.length > 0 ? summarizeActions(actions) : undefined, 'done'),
            ]);

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
            const resolvedSessionId = data.sessionId || currentSessionId;
            const resolvedTopic = data.topic || topic || content.slice(0, 40) || '智能体画布';
            if (resolvedSessionId !== currentSessionId) {
                removeAgentCanvasSession(currentSessionId);
            }
            const completedMessages = [...messagesRef.current, assistantMessage];
            messagesRef.current = completedMessages;
            setMessages(completedMessages);
            persistAgentCanvasSession(resolvedSessionId, completedMessages, resolvedTopic);
            setSessions(listAgentCanvasSessions());
            options.onProjectContextChange?.(
                buildProjectChatContext(resolvedSessionId, resolvedTopic, completedMessages),
            );

            if (data.topic) {
                setTopic(data.topic);
            } else if (!topic) {
                setTopic(content.slice(0, 40) || '智能体画布');
            }
            if (resolvedSessionId) {
                setSessionId(resolvedSessionId);
            }
        } catch (err: unknown) {
            if (isAbortError(err)) {
                if (!cancelRequestedRef.current) {
                    setActivityEvents((prev) => [
                        ...completeActiveEvents(prev),
                        createActivityEvent('ERROR', '已终止生成', '当前 Agent 请求已停止', 'error'),
                    ]);
                }
                setError(null);
                return;
            }
            const errorMessage = err instanceof Error ? err.message : '发送失败';
            setActivityEvents((prev) => [
                ...completeActiveEvents(prev),
                createActivityEvent('ERROR', '生成失败', errorMessage, 'error'),
            ]);
            setError(errorMessage);
            console.error('Agent canvas chat error:', err);
        } finally {
            const isCurrentRequest = activeRequestRef.current === abortController;
            const hasNoActiveRequest = activeRequestRef.current === null;
            if (isCurrentRequest) {
                activeRequestRef.current = null;
            }
            if (isCurrentRequest || hasNoActiveRequest) {
                cancelRequestedRef.current = false;
                setIsLoading(false);
                scheduleClearActivity();
            }
        }
    }, [cancelClearActivityTimer, ensureSession, options, scheduleClearActivity, topic]);

    const startNewChat = useCallback(() => {
        activeRequestRef.current?.abort();
        activeRequestRef.current = null;
        cancelRequestedRef.current = false;
        cancelClearActivityTimer();
        messagesRef.current = [];
        setMessages([]);
        setTopic(null);
        setSessionId(generateSessionId());
        setError(null);
        setActivityEvents([]);
        options.onProjectContextChange?.(buildProjectChatContext(null, null, []));
    }, [cancelClearActivityTimer, options]);

    return {
        messages,
        topic,
        sessionId,
        isLoading,
        activityEvents,
        error,
        sessions,
        isLoadingSessions,
        sendMessage,
        cancelGeneration,
        startNewChat,
        loadSession,
        deleteSession,
        refreshSessions,
        hasMessages: messages.length > 0,
    };
}

export default useChatAgent;
