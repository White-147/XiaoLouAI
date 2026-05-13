import { useEffect } from 'react';

type UseChatPanelOutsideDismissParams = {
    isActiveMenuOpen: boolean;
    isConversationMenuOpen: boolean;
    isThinkingConfirmOpen: boolean;
    onDismissActiveMenu: () => void;
    onDismissConversationMenu: () => void;
    onDismissThinkingConfirm: () => void;
};

export function useChatPanelOutsideDismiss({
    isActiveMenuOpen,
    isConversationMenuOpen,
    isThinkingConfirmOpen,
    onDismissActiveMenu,
    onDismissConversationMenu,
    onDismissThinkingConfirm,
}: UseChatPanelOutsideDismissParams) {
    useEffect(() => {
        if (!isActiveMenuOpen && !isConversationMenuOpen && !isThinkingConfirmOpen) return;

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Element)) return;

            if (!target.closest('[data-agent-active-menu-root]')) {
                onDismissActiveMenu();
            }
            if (!target.closest('[data-agent-conversation-menu-root]')) {
                onDismissConversationMenu();
            }
            if (!target.closest('[data-agent-thinking-menu-root]')) {
                onDismissThinkingConfirm();
            }
        };

        document.addEventListener('pointerdown', handlePointerDown, true);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
        };
    }, [
        isActiveMenuOpen,
        isConversationMenuOpen,
        isThinkingConfirmOpen,
        onDismissActiveMenu,
        onDismissConversationMenu,
        onDismissThinkingConfirm,
    ]);
}
