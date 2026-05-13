import { useCallback, useMemo } from 'react';

import type { VideoComposerMode } from './useChatPanelVideoGeneration';

export type ComposerActionMode = 'agent' | 'image' | 'video';

type UseChatPanelComposerActionParams = {
    mode: ComposerActionMode;
    isLoading: boolean;
    isGeneratingComposerVideo: boolean;
    isLoadingVideoCapabilities: boolean;
    hasComposerPayload: boolean;
    videoComposerMode: VideoComposerMode;
    videoImageCount: number;
    videoReferenceCount: number;
    hasTextPrompt: boolean;
    attachedMediaCount: number;
    hasVideoCapability: boolean;
    imageActionCreditsLabel: string;
    onCancelGeneration: () => void;
    onFocusComposer: () => void;
    onGenerateVideo: () => void | Promise<void>;
    onSend: () => void | Promise<void>;
};

export type ComposerActionState = {
    mode: ComposerActionMode;
    disabled: boolean;
    tooltip: string;
    ariaLabel: string;
    isAgentGenerating: boolean;
    isBusy: boolean;
    imageActionCreditsLabel: string;
};

function getRequiredVideoPayload({
    hasComposerPayload,
    videoComposerMode,
    videoImageCount,
    videoReferenceCount,
    hasTextPrompt,
    attachedMediaCount,
}: Pick<
    UseChatPanelComposerActionParams,
    | 'hasComposerPayload'
    | 'videoComposerMode'
    | 'videoImageCount'
    | 'videoReferenceCount'
    | 'hasTextPrompt'
    | 'attachedMediaCount'
>) {
    if (!hasComposerPayload) return false;
    if (videoComposerMode === 'start_end_frame') return videoImageCount >= 2;
    if (videoComposerMode === 'multi_param') return videoImageCount > 0;
    if (videoComposerMode === 'video_edit') return videoReferenceCount > 0;
    if (videoComposerMode === 'motion_control') return videoImageCount > 0;
    return hasTextPrompt || attachedMediaCount > 0;
}

function getComposerActionState({
    mode,
    isLoading,
    isGeneratingComposerVideo,
    isLoadingVideoCapabilities,
    hasComposerPayload,
    hasRequiredVideoPayload,
    hasVideoCapability,
    imageActionCreditsLabel,
}: {
    mode: ComposerActionMode;
    isLoading: boolean;
    isGeneratingComposerVideo: boolean;
    isLoadingVideoCapabilities: boolean;
    hasComposerPayload: boolean;
    hasRequiredVideoPayload: boolean;
    hasVideoCapability: boolean;
    imageActionCreditsLabel: string;
}): ComposerActionState {
    const isAgentGenerating = mode === 'agent' && isLoading;
    const disabled = mode === 'agent'
        ? false
        : mode === 'video'
            ? isLoading || isGeneratingComposerVideo || isLoadingVideoCapabilities || !hasRequiredVideoPayload || !hasVideoCapability
            : isLoading || !hasComposerPayload;
    const tooltip = mode === 'agent'
        ? isAgentGenerating ? '停止生成' : '语音输入'
        : mode === 'image'
            ? hasComposerPayload ? '生成图像' : '请输入提示词'
            : !hasVideoCapability
                ? '当前模型无可用视频能力'
                : hasRequiredVideoPayload ? '生成视频' : '请补充视频素材或提示词';
    const ariaLabel = mode === 'agent'
        ? isAgentGenerating ? '停止生成' : '语音输入'
        : mode === 'image'
            ? hasComposerPayload ? `生成图像，消耗 ${imageActionCreditsLabel} 积分` : '请输入提示词'
            : '生成视频';

    return {
        mode,
        disabled,
        tooltip,
        ariaLabel,
        isAgentGenerating,
        isBusy: !isAgentGenerating && (isLoading || isGeneratingComposerVideo),
        imageActionCreditsLabel,
    };
}

export function useChatPanelComposerAction({
    mode,
    isLoading,
    isGeneratingComposerVideo,
    isLoadingVideoCapabilities,
    hasComposerPayload,
    videoComposerMode,
    videoImageCount,
    videoReferenceCount,
    hasTextPrompt,
    attachedMediaCount,
    hasVideoCapability,
    imageActionCreditsLabel,
    onCancelGeneration,
    onFocusComposer,
    onGenerateVideo,
    onSend,
}: UseChatPanelComposerActionParams) {
    const hasRequiredVideoPayload = useMemo(
        () => getRequiredVideoPayload({
            hasComposerPayload,
            videoComposerMode,
            videoImageCount,
            videoReferenceCount,
            hasTextPrompt,
            attachedMediaCount,
        }),
        [
            hasComposerPayload,
            videoComposerMode,
            videoImageCount,
            videoReferenceCount,
            hasTextPrompt,
            attachedMediaCount,
        ],
    );

    const composerAction = useMemo(
        () => getComposerActionState({
            mode,
            isLoading,
            isGeneratingComposerVideo,
            isLoadingVideoCapabilities,
            hasComposerPayload,
            hasRequiredVideoPayload,
            hasVideoCapability,
            imageActionCreditsLabel,
        }),
        [
            mode,
            isLoading,
            isGeneratingComposerVideo,
            isLoadingVideoCapabilities,
            hasComposerPayload,
            hasRequiredVideoPayload,
            hasVideoCapability,
            imageActionCreditsLabel,
        ],
    );

    const handleComposerAction = useCallback(() => {
        if (composerAction.isAgentGenerating) {
            onCancelGeneration();
            return;
        }

        if (mode === 'agent' && !hasComposerPayload) {
            onFocusComposer();
            return;
        }

        if (mode === 'video') {
            void onGenerateVideo();
            return;
        }

        void onSend();
    }, [
        composerAction.isAgentGenerating,
        hasComposerPayload,
        mode,
        onCancelGeneration,
        onFocusComposer,
        onGenerateVideo,
        onSend,
    ]);

    return {
        composerAction,
        handleComposerAction,
        hasRequiredVideoPayload,
    };
}
