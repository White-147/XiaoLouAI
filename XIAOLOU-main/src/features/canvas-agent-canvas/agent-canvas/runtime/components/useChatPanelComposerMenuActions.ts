import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';

import type {
    ComposerMenu,
    ComposerMode,
} from './ChatPanelComposerToolbarTypes';
import type {
    AssetLibraryMediaFilter,
    VideoAttachSlot,
} from './chatPanelMediaAttachments';
import type { ModelPreferenceTab } from './chatPanelModelOptions';
import type { AgentCanvasSkill } from '../config/agentCanvasSkills';

type UseChatPanelComposerMenuActionsParams = {
    activeMenu: ComposerMenu;
    activeVideoAttachSlotId: string | null;
    fileInputRef: RefObject<HTMLInputElement | null>;
    setActiveMenu: Dispatch<SetStateAction<ComposerMenu>>;
    setActiveVideoAttachSlotId: Dispatch<SetStateAction<string | null>>;
    setAssetLibraryMediaFilter: Dispatch<SetStateAction<AssetLibraryMediaFilter | null>>;
    setComposerMode: Dispatch<SetStateAction<ComposerMode>>;
    setModelPreferenceTab: Dispatch<SetStateAction<ModelPreferenceTab>>;
    setSelectedSkill: Dispatch<SetStateAction<AgentCanvasSkill | null>>;
    setSelectedVideoShot: Dispatch<SetStateAction<string>>;
    setShowAssetLibrary: Dispatch<SetStateAction<boolean>>;
    focusComposer: () => void;
    updatePendingVideoAttachSlot: (slot: VideoAttachSlot | null) => void;
};

export function useChatPanelComposerMenuActions({
    activeMenu,
    activeVideoAttachSlotId,
    fileInputRef,
    setActiveMenu,
    setActiveVideoAttachSlotId,
    setAssetLibraryMediaFilter,
    setComposerMode,
    setModelPreferenceTab,
    setSelectedSkill,
    setSelectedVideoShot,
    setShowAssetLibrary,
    focusComposer,
    updatePendingVideoAttachSlot,
}: UseChatPanelComposerMenuActionsParams) {
    const handleSkillSelect = useCallback((skill: AgentCanvasSkill) => {
        setSelectedSkill(skill);
        setComposerMode('agent');
        setActiveMenu(null);
        focusComposer();
    }, [focusComposer, setActiveMenu, setComposerMode, setSelectedSkill]);

    const toggleSkillsMenu = useCallback(() => {
        setActiveMenu((value) => value === 'skills' ? null : 'skills');
    }, [setActiveMenu]);

    const toggleImageAttachMenu = useCallback(() => {
        setActiveMenu((value) => value === 'imageAttach' ? null : 'imageAttach');
    }, [setActiveMenu]);

    const openLocalUploadForImageAttachment = useCallback(() => {
        setActiveMenu(null);
        updatePendingVideoAttachSlot(null);
        window.setTimeout(() => fileInputRef.current?.click(), 0);
    }, [fileInputRef, setActiveMenu, updatePendingVideoAttachSlot]);

    const openAssetLibraryForImageAttachment = useCallback(() => {
        setActiveMenu(null);
        updatePendingVideoAttachSlot(null);
        setAssetLibraryMediaFilter('image');
        setShowAssetLibrary(true);
    }, [setActiveMenu, setAssetLibraryMediaFilter, setShowAssetLibrary, updatePendingVideoAttachSlot]);

    const toggleAgentMoreMenu = useCallback(() => {
        setActiveMenu((value) => value === 'more' ? null : 'more');
    }, [setActiveMenu]);

    const openLocalUploadFromAgentMoreMenu = useCallback(() => {
        updatePendingVideoAttachSlot(null);
        setAssetLibraryMediaFilter(null);
        window.setTimeout(() => fileInputRef.current?.click(), 0);
    }, [fileInputRef, setAssetLibraryMediaFilter, updatePendingVideoAttachSlot]);

    const openAssetLibraryFromAgentMoreMenu = useCallback(() => {
        setActiveMenu(null);
        updatePendingVideoAttachSlot(null);
        setAssetLibraryMediaFilter(null);
        setShowAssetLibrary(true);
    }, [setActiveMenu, setAssetLibraryMediaFilter, setShowAssetLibrary, updatePendingVideoAttachSlot]);

    const toggleModeMenu = useCallback(() => {
        setActiveMenu((value) => value === 'mode' ? null : 'mode');
    }, [setActiveMenu]);

    const selectComposerMode = useCallback((mode: ComposerMode) => {
        setComposerMode(mode);
        if (mode === 'agent') {
            setModelPreferenceTab('cot');
        } else {
            setModelPreferenceTab(mode);
        }
        setActiveMenu(null);
    }, [setActiveMenu, setComposerMode, setModelPreferenceTab]);

    const toggleImageSettingsMenu = useCallback(() => {
        setActiveMenu((value) => value === 'imageSettings' ? null : 'imageSettings');
    }, [setActiveMenu]);

    const toggleVideoSettingsMenu = useCallback(() => {
        setActiveMenu((value) => value === 'videoSettings' ? null : 'videoSettings');
    }, [setActiveMenu]);

    const toggleVideoShotMenu = useCallback(() => {
        setActiveMenu((value) => value === 'videoShot' ? null : 'videoShot');
    }, [setActiveMenu]);

    const selectVideoShot = useCallback((shot: string) => {
        setSelectedVideoShot(shot);
        setActiveMenu(null);
    }, [setActiveMenu, setSelectedVideoShot]);

    const toggleVideoAttachMenu = useCallback((slotId: string, slot: VideoAttachSlot, disabled?: boolean) => {
        if (disabled) return;
        const isSameSlot = activeMenu === 'videoAttach' && activeVideoAttachSlotId === slotId;
        updatePendingVideoAttachSlot(isSameSlot ? null : slot);
        setActiveVideoAttachSlotId(isSameSlot ? null : slotId);
        setActiveMenu(isSameSlot ? null : 'videoAttach');
    }, [
        activeMenu,
        activeVideoAttachSlotId,
        setActiveMenu,
        setActiveVideoAttachSlotId,
        updatePendingVideoAttachSlot,
    ]);

    return {
        handleSkillSelect,
        toggleSkillsMenu,
        toggleImageAttachMenu,
        openLocalUploadForImageAttachment,
        openAssetLibraryForImageAttachment,
        toggleAgentMoreMenu,
        openLocalUploadFromAgentMoreMenu,
        openAssetLibraryFromAgentMoreMenu,
        toggleModeMenu,
        selectComposerMode,
        toggleImageSettingsMenu,
        toggleVideoSettingsMenu,
        toggleVideoShotMenu,
        selectVideoShot,
        toggleVideoAttachMenu,
    };
}
