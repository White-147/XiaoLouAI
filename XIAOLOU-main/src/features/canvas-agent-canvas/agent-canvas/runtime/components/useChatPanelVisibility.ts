import { useEffect, useMemo, useState, type CSSProperties } from 'react';

const CHAT_PANEL_TRANSITION_MS = 360;
const CHAT_PANEL_OPEN_DELAY_MS = 40;

type UseChatPanelVisibilityParams = {
    isOpen: boolean;
    onPanelClosed: () => void;
};

export function useChatPanelVisibility({
    isOpen,
    onPanelClosed,
}: UseChatPanelVisibilityParams) {
    const [shouldRenderPanel, setShouldRenderPanel] = useState(isOpen);
    const [isPanelVisible, setIsPanelVisible] = useState(isOpen);

    useEffect(() => {
        let unmountDelayId = 0;

        if (isOpen) {
            setIsPanelVisible(false);
            setShouldRenderPanel(true);
        } else {
            setIsPanelVisible(false);
            unmountDelayId = window.setTimeout(() => {
                setShouldRenderPanel(false);
            }, CHAT_PANEL_TRANSITION_MS);
        }

        return () => {
            if (unmountDelayId) window.clearTimeout(unmountDelayId);
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || !shouldRenderPanel || isPanelVisible) {
            return;
        }

        const openDelayId = window.setTimeout(() => {
            setIsPanelVisible(true);
        }, CHAT_PANEL_OPEN_DELAY_MS);

        return () => window.clearTimeout(openDelayId);
    }, [isOpen, isPanelVisible, shouldRenderPanel]);

    useEffect(() => {
        if (isOpen) {
            return;
        }

        onPanelClosed();
    }, [isOpen, onPanelClosed]);

    const panelTransitionStyle = useMemo<CSSProperties>(() => ({
        opacity: isPanelVisible ? 1 : 0,
        transform: isPanelVisible ? 'translate3d(0, 0, 0)' : 'translate3d(100%, 0, 0)',
        transition: `transform ${CHAT_PANEL_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${CHAT_PANEL_TRANSITION_MS}ms ease`,
    }), [isPanelVisible]);

    return {
        shouldRenderPanel,
        isPanelVisible,
        panelTransitionStyle,
    };
}
