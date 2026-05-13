import { useCallback } from 'react';

export const THINKING_CONFIRM_SKIP_STORAGE_KEY = 'xiaolou.agentCanvas.skipThinkingConfirm';

type UseChatPanelThinkingModeParams = {
    thinkingConfirmNeverAsk: boolean;
    setThinkingModeEnabled: (enabled: boolean) => void;
    setComposerMode: (mode: 'agent') => void;
    setThinkingConfirmOpen: (open: boolean) => void;
    onNewChat: () => void;
};

export function useChatPanelThinkingMode({
    thinkingConfirmNeverAsk,
    setThinkingModeEnabled,
    setComposerMode,
    setThinkingConfirmOpen,
    onNewChat,
}: UseChatPanelThinkingModeParams) {
    const handleThinkingClick = useCallback(() => {
        if (thinkingConfirmNeverAsk) {
            setThinkingModeEnabled(true);
            setComposerMode('agent');
            onNewChat();
            return;
        }
        setThinkingConfirmOpen(true);
    }, [onNewChat, setComposerMode, setThinkingConfirmOpen, setThinkingModeEnabled, thinkingConfirmNeverAsk]);

    const confirmThinkingNewChat = useCallback(() => {
        if (thinkingConfirmNeverAsk && typeof window !== 'undefined') {
            window.localStorage.setItem(THINKING_CONFIRM_SKIP_STORAGE_KEY, 'true');
        }
        setThinkingModeEnabled(true);
        setComposerMode('agent');
        setThinkingConfirmOpen(false);
        onNewChat();
    }, [onNewChat, setComposerMode, setThinkingConfirmOpen, setThinkingModeEnabled, thinkingConfirmNeverAsk]);

    return {
        handleThinkingClick,
        confirmThinkingNewChat,
    };
}
