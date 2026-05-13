import { useCallback, type Dispatch, type SetStateAction } from 'react';

type UseChatPanelToolbarSettingsActionsParams = {
    normalizeImageBatchCount: (count: number) => number;
    setCanvasFilesEnabled: Dispatch<SetStateAction<boolean>>;
    setImageBatchCount: Dispatch<SetStateAction<number>>;
    setVideoGenerateAudio: Dispatch<SetStateAction<boolean>>;
    setWebSearchEnabled: Dispatch<SetStateAction<boolean>>;
};

export function useChatPanelToolbarSettingsActions({
    normalizeImageBatchCount,
    setCanvasFilesEnabled,
    setImageBatchCount,
    setVideoGenerateAudio,
    setWebSearchEnabled,
}: UseChatPanelToolbarSettingsActionsParams) {
    const toggleCanvasFiles = useCallback(() => {
        setCanvasFilesEnabled((value) => !value);
    }, [setCanvasFilesEnabled]);

    const toggleWebSearch = useCallback(() => {
        setWebSearchEnabled((value) => !value);
    }, [setWebSearchEnabled]);

    const setNormalizedImageBatchCount = useCallback((count: number) => {
        setImageBatchCount(normalizeImageBatchCount(count));
    }, [normalizeImageBatchCount, setImageBatchCount]);

    const toggleVideoGenerateAudio = useCallback(() => {
        setVideoGenerateAudio((value) => !value);
    }, [setVideoGenerateAudio]);

    return {
        toggleCanvasFiles,
        toggleWebSearch,
        setNormalizedImageBatchCount,
        toggleVideoGenerateAudio,
    };
}
