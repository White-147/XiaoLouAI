import { useCallback, type MouseEvent } from 'react';

import type { ChatMessage as ChatMessageType } from '../hooks/useChatAgent';

type UseChatPanelHeaderActionsParams = {
    messages: ChatMessageType[];
    topicTitle: string;
    startNewChat: () => void;
    loadSession: (sessionId: string) => void | Promise<void>;
    deleteSession: (sessionId: string) => void | Promise<void>;
    onNewChatReset: () => void;
    onSessionLoaded: () => void;
    onShareMenuClose: () => void;
};

export function useChatPanelHeaderActions({
    messages,
    topicTitle,
    startNewChat,
    loadSession,
    deleteSession,
    onNewChatReset,
    onSessionLoaded,
    onShareMenuClose,
}: UseChatPanelHeaderActionsParams) {
    const copyCurrentConversationLink = useCallback(async () => {
        try {
            await navigator.clipboard?.writeText(window.location.href);
        } catch {
            // Clipboard permission is optional; sharing will become a server action later.
        }
    }, []);

    const handleNewChat = useCallback(() => {
        startNewChat();
        onNewChatReset();
    }, [onNewChatReset, startNewChat]);

    const handleLoadSession = useCallback(async (sessionId: string) => {
        await loadSession(sessionId);
        onSessionLoaded();
    }, [loadSession, onSessionLoaded]);

    const handleDeleteSession = useCallback(async (event: MouseEvent, sessionId: string) => {
        event.stopPropagation();
        await deleteSession(sessionId);
    }, [deleteSession]);

    const handleCopyShareLink = useCallback(async () => {
        await copyCurrentConversationLink();
        onShareMenuClose();
    }, [copyCurrentConversationLink, onShareMenuClose]);

    const handleShareConversationImage = useCallback(async () => {
        try {
            const body = messages
                .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`)
                .join('\n\n');
            const text = `【${topicTitle}】\n\n${body}`;
            await navigator.clipboard?.writeText(text);
        } catch {
            /* optional */
        }
        onShareMenuClose();
    }, [messages, onShareMenuClose, topicTitle]);

    const handlePublishConversation = useCallback(async () => {
        const url = window.location.href;
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
            try {
                await navigator.share({
                    title: topicTitle,
                    text: '查看对话',
                    url,
                });
                onShareMenuClose();
                return;
            } catch {
                /* user cancelled or share failed */
            }
        }
        await copyCurrentConversationLink();
        onShareMenuClose();
    }, [copyCurrentConversationLink, onShareMenuClose, topicTitle]);

    return {
        handleNewChat,
        handleLoadSession,
        handleDeleteSession,
        handleCopyShareLink,
        handleShareConversationImage,
        handlePublishConversation,
    };
}
