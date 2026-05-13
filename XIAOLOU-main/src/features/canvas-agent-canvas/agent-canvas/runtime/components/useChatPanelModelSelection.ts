import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';

import {
    toggleModelPoolId,
    type ComposerModelOption,
    type ModelPreferenceTab,
} from './chatPanelModelOptions';

type ComposerMode = 'agent' | 'image' | 'video';

type UseChatPanelModelSelectionParams = {
    composerMode: ComposerMode;
    modelPreferenceTab: ModelPreferenceTab;
    autoModelPreference: boolean;
    textModelOptions: ComposerModelOption[];
    cotTextModelOptions: ComposerModelOption[];
    imageModelOptions: ComposerModelOption[];
    videoModelOptions: ComposerModelOption[];
    selectedTextModel: string;
    selectedImageTool: string;
    selectedVideoTool: string;
    selectedImageToolIds: string[];
    selectedVideoToolIds: string[];
    setSelectedTextModel: Dispatch<SetStateAction<string>>;
    setSelectedImageTool: Dispatch<SetStateAction<string>>;
    setSelectedVideoTool: Dispatch<SetStateAction<string>>;
    setSelectedImageToolIds: Dispatch<SetStateAction<string[]>>;
    setSelectedVideoToolIds: Dispatch<SetStateAction<string[]>>;
    onActiveModelSelected: () => void;
};

function getPoolLabels(pool: string[], options: ComposerModelOption[]) {
    return pool
        .map((id) => options.find((option) => option.id === id)?.label || id)
        .filter(Boolean);
}

export function useChatPanelModelSelection({
    composerMode,
    modelPreferenceTab,
    autoModelPreference,
    textModelOptions,
    cotTextModelOptions,
    imageModelOptions,
    videoModelOptions,
    selectedTextModel,
    selectedImageTool,
    selectedVideoTool,
    selectedImageToolIds,
    selectedVideoToolIds,
    setSelectedTextModel,
    setSelectedImageTool,
    setSelectedVideoTool,
    setSelectedImageToolIds,
    setSelectedVideoToolIds,
    onActiveModelSelected,
}: UseChatPanelModelSelectionParams) {
    const activeImageToolPool = useMemo(
        () => selectedImageToolIds.length ? selectedImageToolIds : (selectedImageTool ? [selectedImageTool] : []),
        [selectedImageTool, selectedImageToolIds],
    );
    const activeVideoToolPool = useMemo(
        () => selectedVideoToolIds.length ? selectedVideoToolIds : (selectedVideoTool ? [selectedVideoTool] : []),
        [selectedVideoTool, selectedVideoToolIds],
    );
    const selectedImagePoolLabels = useMemo(
        () => getPoolLabels(activeImageToolPool, imageModelOptions),
        [activeImageToolPool, imageModelOptions],
    );
    const selectedVideoPoolLabels = useMemo(
        () => getPoolLabels(activeVideoToolPool, videoModelOptions),
        [activeVideoToolPool, videoModelOptions],
    );
    const activeModelOptions = useMemo(
        () => composerMode === 'image'
            ? imageModelOptions
            : composerMode === 'video'
                ? videoModelOptions
                : textModelOptions,
        [composerMode, imageModelOptions, textModelOptions, videoModelOptions],
    );
    const activeModelId = composerMode === 'image'
        ? selectedImageTool
        : composerMode === 'video'
            ? selectedVideoTool
            : selectedTextModel;
    const activeModelOption = useMemo(
        () => activeModelOptions.find((option) => option.id === activeModelId),
        [activeModelId, activeModelOptions],
    );
    const modelPreferenceOptions = useMemo(
        () => modelPreferenceTab === 'cot'
            ? cotTextModelOptions
            : modelPreferenceTab === 'image'
                ? imageModelOptions
                : modelPreferenceTab === 'video'
                    ? videoModelOptions
                    : [],
        [cotTextModelOptions, imageModelOptions, modelPreferenceTab, videoModelOptions],
    );

    const isModelPreferenceOptionSelected = useCallback((option: ComposerModelOption) => {
        if (option.kind === 'image') return activeImageToolPool.includes(option.id);
        if (option.kind === 'video') return activeVideoToolPool.includes(option.id);
        return option.id === selectedTextModel;
    }, [activeImageToolPool, activeVideoToolPool, selectedTextModel]);

    const handleModelPreferenceOptionSelect = useCallback((option: ComposerModelOption) => {
        if (option.kind === 'image') {
            setSelectedImageTool(option.id);
            setSelectedImageToolIds((prev) => (
                autoModelPreference ? toggleModelPoolId(prev, option.id) : [option.id]
            ));
        } else if (option.kind === 'video') {
            setSelectedVideoTool(option.id);
            setSelectedVideoToolIds((prev) => (
                autoModelPreference ? toggleModelPoolId(prev, option.id) : [option.id]
            ));
        } else if (option.kind === 'text') {
            setSelectedTextModel(option.id);
        }
    }, [
        autoModelPreference,
        setSelectedImageTool,
        setSelectedImageToolIds,
        setSelectedTextModel,
        setSelectedVideoTool,
        setSelectedVideoToolIds,
    ]);

    const handleActiveModelSelect = useCallback((option: ComposerModelOption) => {
        if (composerMode === 'image') {
            setSelectedImageTool(option.id);
            setSelectedImageToolIds([option.id]);
        } else {
            setSelectedVideoTool(option.id);
            setSelectedVideoToolIds([option.id]);
        }
        onActiveModelSelected();
    }, [
        composerMode,
        onActiveModelSelected,
        setSelectedImageTool,
        setSelectedImageToolIds,
        setSelectedVideoTool,
        setSelectedVideoToolIds,
    ]);

    return {
        activeImageToolPool,
        activeVideoToolPool,
        selectedImagePoolLabels,
        selectedVideoPoolLabels,
        activeModelOptions,
        activeModelId,
        activeModelOption,
        modelPreferenceOptions,
        isModelPreferenceOptionSelected,
        handleModelPreferenceOptionSelect,
        handleActiveModelSelect,
    };
}
