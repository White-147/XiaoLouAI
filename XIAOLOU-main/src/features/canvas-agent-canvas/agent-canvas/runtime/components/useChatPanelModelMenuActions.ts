import { useCallback, type Dispatch, type SetStateAction } from 'react';

import type { ComposerMenu } from './ChatPanelComposerToolbarTypes';

type UseChatPanelModelMenuActionsParams = {
    setActiveMenu: Dispatch<SetStateAction<ComposerMenu>>;
    setAutoModelPreference: Dispatch<SetStateAction<boolean>>;
};

export function useChatPanelModelMenuActions({
    setActiveMenu,
    setAutoModelPreference,
}: UseChatPanelModelMenuActionsParams) {
    const toggleModelMenu = useCallback(() => {
        setActiveMenu((value) => value === 'model' ? null : 'model');
    }, [setActiveMenu]);

    const toggleAutoModelPreference = useCallback(() => {
        setAutoModelPreference((value) => !value);
    }, [setAutoModelPreference]);

    return {
        toggleModelMenu,
        toggleAutoModelPreference,
    };
}
