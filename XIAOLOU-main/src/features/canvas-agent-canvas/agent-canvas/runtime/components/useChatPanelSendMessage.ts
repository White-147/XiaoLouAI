import { useCallback } from 'react';

import type {
    AgentAttachment,
    AgentChatOptions,
} from '../hooks/useChatAgent';
import type { AgentCanvasSkill } from '../config/agentCanvasSkills';
import {
    buildChatPanelComposerInstruction,
    type BuildChatPanelComposerInstructionParams,
} from './chatPanelComposerInstruction';
import type { AttachedMedia } from './chatPanelMediaAttachments';

type ComposerMode = 'agent' | 'image' | 'video';

type SendMessageFn = (
    content: string,
    media?: AgentAttachment[],
    chatOptions?: AgentChatOptions,
) => Promise<void>;

type UseChatPanelSendMessageParams = Omit<BuildChatPanelComposerInstructionParams, 'skill'> & {
    message: string;
    attachedMedia: AttachedMedia[];
    selectedSkill: AgentCanvasSkill | null;
    isLoading: boolean;
    sendMessage: SendMessageFn;
    onComposerSent: () => void;
    selectedTextModel: string;
    selectedImageTool: string;
    activeModelLabel?: string;
    activeImageToolPool: string[];
    activeVideoToolPool: string[];
    canvasFilesEnabled: boolean;
    composerMode: ComposerMode;
};

function toAgentAttachments(media: AttachedMedia[]): AgentAttachment[] | undefined {
    if (media.length === 0) return undefined;
    return media.map((item) => ({
        type: item.type,
        url: item.url,
        nodeId: item.nodeId,
        base64: item.base64,
    }));
}

function getSelectedToolId({
    autoModelPreference,
    composerMode,
    selectedImageTool,
    selectedVideoTool,
}: Pick<
    UseChatPanelSendMessageParams,
    'autoModelPreference' | 'composerMode' | 'selectedImageTool' | 'selectedVideoTool'
>) {
    if (autoModelPreference) return undefined;
    if (composerMode === 'image') return selectedImageTool;
    if (composerMode === 'video') return selectedVideoTool;
    return undefined;
}

function getSelectedToolType(composerMode: ComposerMode) {
    if (composerMode === 'image' || composerMode === 'video') return composerMode;
    return undefined;
}

export function useChatPanelSendMessage({
    message,
    attachedMedia,
    selectedSkill,
    isLoading,
    sendMessage,
    onComposerSent,
    selectedTextModel,
    selectedImageTool,
    selectedVideoTool,
    activeModelLabel,
    activeImageToolPool,
    activeVideoToolPool,
    canvasFilesEnabled,
    composerMode,
    thinkingModeEnabled,
    autoModelPreference,
    selectedImagePoolLabels,
    selectedImageLabel,
    defaultImageLabel,
    selectedVideoPoolLabels,
    selectedVideoLabel,
    currentVideoModelId,
    showImageResolutionSettings,
    currentImageResolution,
    currentImageAspectRatioLabel,
    showImageDimensionSettings,
    hasCurrentImageSize,
    currentImageSizeLabel,
    showImageOutputCountSettings,
    currentImageBatchCount,
    videoComposerMode,
    videoModeOptions,
    currentVideoAspectRatio,
    showVideoResolution,
    currentVideoResolution,
    showVideoDuration,
    currentVideoDuration,
    supportsVideoAudioOutput,
    videoGenerateAudio,
    webSearchEnabled,
    selectedVideoShot,
}: UseChatPanelSendMessageParams) {
    return useCallback(async () => {
        if ((!message.trim() && attachedMedia.length === 0 && !selectedSkill) || isLoading) return;

        const currentMessage = message.trim();
        const currentMedia = attachedMedia;
        const currentSkill = selectedSkill;
        const outgoingMessage = currentMessage || (currentSkill ? `使用 Skill：${currentSkill.title}` : '');

        onComposerSent();

        const selectedToolId = getSelectedToolId({
            autoModelPreference,
            composerMode,
            selectedImageTool,
            selectedVideoTool,
        });
        const selectedToolType = getSelectedToolType(composerMode);
        const allowedImageToolIds = composerMode === 'video' ? undefined : activeImageToolPool;
        const allowedVideoToolIds = composerMode === 'image' ? undefined : activeVideoToolPool;

        await sendMessage(
            outgoingMessage,
            toAgentAttachments(currentMedia),
            {
                mode: 'agent',
                model: selectedTextModel || 'auto',
                modelLabel: activeModelLabel || selectedTextModel || 'Auto',
                toolId: selectedToolId,
                toolType: selectedToolType,
                preferredImageToolId: selectedImageTool,
                preferredVideoToolId: selectedVideoTool,
                allowedImageToolIds,
                allowedVideoToolIds,
                autoModelPreference,
                webSearch: webSearchEnabled,
                includeCanvasFiles: canvasFilesEnabled,
                instruction: buildChatPanelComposerInstruction({
                    skill: currentSkill,
                    composerMode,
                    thinkingModeEnabled,
                    autoModelPreference,
                    selectedImagePoolLabels,
                    selectedImageLabel,
                    defaultImageLabel,
                    selectedVideoPoolLabels,
                    selectedVideoLabel,
                    currentVideoModelId,
                    selectedVideoTool,
                    showImageResolutionSettings,
                    currentImageResolution,
                    currentImageAspectRatioLabel,
                    showImageDimensionSettings,
                    hasCurrentImageSize,
                    currentImageSizeLabel,
                    showImageOutputCountSettings,
                    currentImageBatchCount,
                    videoComposerMode,
                    videoModeOptions,
                    currentVideoAspectRatio,
                    showVideoResolution,
                    currentVideoResolution,
                    showVideoDuration,
                    currentVideoDuration,
                    supportsVideoAudioOutput,
                    videoGenerateAudio,
                    webSearchEnabled,
                    selectedVideoShot,
                }),
                skillId: currentSkill?.id,
                skillTitle: currentSkill?.title,
                skillInstruction: currentSkill?.hiddenInstruction,
                maxTokens: currentSkill?.maxTokens,
            },
        );
    }, [
        activeImageToolPool,
        activeModelLabel,
        activeVideoToolPool,
        attachedMedia,
        autoModelPreference,
        canvasFilesEnabled,
        composerMode,
        currentImageAspectRatioLabel,
        currentImageBatchCount,
        currentImageResolution,
        currentImageSizeLabel,
        currentVideoAspectRatio,
        currentVideoDuration,
        currentVideoModelId,
        currentVideoResolution,
        defaultImageLabel,
        hasCurrentImageSize,
        isLoading,
        message,
        onComposerSent,
        selectedImageLabel,
        selectedImagePoolLabels,
        selectedImageTool,
        selectedSkill,
        selectedTextModel,
        selectedVideoLabel,
        selectedVideoPoolLabels,
        selectedVideoShot,
        selectedVideoTool,
        sendMessage,
        showImageDimensionSettings,
        showImageOutputCountSettings,
        showImageResolutionSettings,
        showVideoDuration,
        showVideoResolution,
        supportsVideoAudioOutput,
        thinkingModeEnabled,
        videoComposerMode,
        videoGenerateAudio,
        videoModeOptions,
        webSearchEnabled,
    ]);
}
