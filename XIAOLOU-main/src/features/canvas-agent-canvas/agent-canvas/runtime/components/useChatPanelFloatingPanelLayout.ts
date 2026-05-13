import {
    useCallback,
    useEffect,
    useState,
    type CSSProperties,
    type RefObject,
} from 'react';

const FLOATING_MENU_PADDING = 16;
const FLOATING_MENU_TRIGGER_GAP = 8;

type FloatingPanelLayout = {
    left: number;
    bottom: number;
    width: number;
    maxHeight: number;
};

type UseChatPanelFloatingPanelLayoutParams = {
    activeMenu: string | null;
    videoSettingsButtonRef: RefObject<HTMLButtonElement>;
    videoShotButtonRef: RefObject<HTMLButtonElement>;
};

function getFloatingPanelLayout(
    trigger: HTMLElement | null,
    preferredWidth: number,
): FloatingPanelLayout | null {
    if (!trigger || typeof window === 'undefined') return null;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(preferredWidth, Math.max(280, viewportWidth - FLOATING_MENU_PADDING * 2));
    const maxLeft = Math.max(FLOATING_MENU_PADDING, viewportWidth - width - FLOATING_MENU_PADDING);
    const left = Math.min(Math.max(rect.right - width, FLOATING_MENU_PADDING), maxLeft);
    const bottom = Math.max(FLOATING_MENU_PADDING, viewportHeight - rect.top + FLOATING_MENU_TRIGGER_GAP);
    const maxHeight = Math.max(220, rect.top - FLOATING_MENU_PADDING - FLOATING_MENU_TRIGGER_GAP);

    return { left, bottom, width, maxHeight };
}

export function useChatPanelFloatingPanelLayout({
    activeMenu,
    videoSettingsButtonRef,
    videoShotButtonRef,
}: UseChatPanelFloatingPanelLayoutParams) {
    const [floatingPanelLayout, setFloatingPanelLayout] = useState<FloatingPanelLayout | null>(null);

    useEffect(() => {
        if (activeMenu !== 'videoSettings' && activeMenu !== 'videoShot') {
            setFloatingPanelLayout(null);
            return;
        }

        const preferredWidth = activeMenu === 'videoSettings' ? 368 : 360;
        const triggerRef = activeMenu === 'videoSettings' ? videoSettingsButtonRef : videoShotButtonRef;
        let frameId = 0;

        const updateLayout = () => {
            window.cancelAnimationFrame(frameId);
            frameId = window.requestAnimationFrame(() => {
                setFloatingPanelLayout(getFloatingPanelLayout(triggerRef.current, preferredWidth));
            });
        };

        updateLayout();
        window.addEventListener('resize', updateLayout);
        window.addEventListener('scroll', updateLayout, true);

        return () => {
            window.cancelAnimationFrame(frameId);
            window.removeEventListener('resize', updateLayout);
            window.removeEventListener('scroll', updateLayout, true);
        };
    }, [activeMenu, videoSettingsButtonRef, videoShotButtonRef]);

    const getVideoFloatingPanelStyle = useCallback((fallbackWidth: number): CSSProperties => {
        if (floatingPanelLayout) {
            return {
                left: floatingPanelLayout.left,
                bottom: floatingPanelLayout.bottom,
                width: floatingPanelLayout.width,
                maxHeight: floatingPanelLayout.maxHeight,
            };
        }

        return {
            right: FLOATING_MENU_PADDING,
            bottom: 72,
            width: `min(${fallbackWidth}px, calc(100vw - ${FLOATING_MENU_PADDING * 2}px))`,
            maxHeight: `calc(100vh - ${FLOATING_MENU_PADDING * 2}px)`,
        };
    }, [floatingPanelLayout]);

    return {
        getVideoFloatingPanelStyle,
    };
}
