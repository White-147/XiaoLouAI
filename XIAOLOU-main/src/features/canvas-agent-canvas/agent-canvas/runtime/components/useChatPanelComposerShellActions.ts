import { useCallback, type Dispatch, type SetStateAction } from 'react';

import type { AgentCanvasSkill } from '../config/agentCanvasSkills';

type UseChatPanelComposerShellActionsParams = {
    setSelectedSkill: Dispatch<SetStateAction<AgentCanvasSkill | null>>;
    setShowChineseTip: Dispatch<SetStateAction<boolean>>;
    setShowThinkingConfirm: Dispatch<SetStateAction<boolean>>;
    setThinkingConfirmNeverAsk: Dispatch<SetStateAction<boolean>>;
};

export function useChatPanelComposerShellActions({
    setSelectedSkill,
    setShowChineseTip,
    setShowThinkingConfirm,
    setThinkingConfirmNeverAsk,
}: UseChatPanelComposerShellActionsParams) {
    const removeSelectedSkill = useCallback(() => {
        setSelectedSkill(null);
    }, [setSelectedSkill]);

    const closeChineseReplyTip = useCallback(() => {
        setShowChineseTip(false);
    }, [setShowChineseTip]);

    const toggleThinkingConfirmNeverAsk = useCallback(() => {
        setThinkingConfirmNeverAsk((value) => !value);
    }, [setThinkingConfirmNeverAsk]);

    const cancelThinkingConfirm = useCallback(() => {
        setShowThinkingConfirm(false);
    }, [setShowThinkingConfirm]);

    return {
        removeSelectedSkill,
        closeChineseReplyTip,
        toggleThinkingConfirmNeverAsk,
        cancelThinkingConfirm,
    };
}
