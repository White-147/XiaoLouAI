import { useState } from 'react';

import type { CanvasAgentAction } from '../hooks/useChatAgent';
import {
    generateVideoWithXiaolou,
    type XiaolouGenerateVideoPayload,
} from '../integrations/xiaolouGenerationBridge';
import type { BridgeMediaCapabilitySet, BridgeMediaModelCapability } from '../types';
import {
    mediaUrlForPayload,
    type AttachedMedia,
} from './chatPanelMediaAttachments';

export type VideoComposerMode = 'reference' | 'start_end_frame' | 'multi_param' | 'video_edit' | 'motion_control';
export type VideoApiMode = 'image_to_video' | 'start_end_frame' | 'multi_param' | 'video_edit' | 'motion_control' | 'video_extend';

type VideoNodeMode =
    | 'standard'
    | 'frame-to-frame'
    | 'multi-reference'
    | 'video-edit'
    | 'video-extend'
    | 'motion-control';

type BuildChatPanelVideoPayloadParams = {
    currentMessage: string;
    currentMedia: AttachedMedia[];
    selectedVideoShot: string;
    currentVideoDuration: string;
    currentVideoModelId: string;
    currentVideoAspectRatio: string;
    currentVideoResolution: string;
    currentVideoMaxReferenceImages: number;
    currentVideoMaxReferenceVideos: number;
    currentVideoMaxReferenceAudios: number;
    currentVideoCapabilitySet: BridgeMediaCapabilitySet | null;
    currentVideoModelCapability: BridgeMediaModelCapability | null;
    supportsVideoMultiReferenceImages: boolean;
    supportsVideoAudioOutput: boolean;
    videoGenerateAudio: boolean;
    webSearchEnabled: boolean;
    videoQualityMode: string;
    showAudioReferenceSlot: boolean;
    videoComposerMode: VideoComposerMode;
    videoEditMode: string;
    videoCapabilities: Record<string, BridgeMediaModelCapability[]>;
};

type ChatPanelVideoPayloadRequest = {
    payload: XiaolouGenerateVideoPayload;
    nodeMode: VideoNodeMode;
};

type UseChatPanelVideoGenerationParams = Omit<
    BuildChatPanelVideoPayloadParams,
    'currentMessage' | 'currentMedia'
> & {
    isLoading: boolean;
    message: string;
    attachedMedia: AttachedMedia[];
    onApplyActions?: (actions: CanvasAgentAction[]) => Promise<void> | void;
    onFallbackSend: () => void | Promise<void>;
    onCapabilityError: (message: string) => void;
    onGenerationStarted: () => void;
};

export function isSeedanceVideoModelId(modelId?: string | null) {
    return String(modelId || '').startsWith('doubao-seedance');
}

function parseVideoDuration(duration: string) {
    return Number.parseInt(duration.replace(/[^\d]/g, ''), 10) || 5;
}

export function buildChatPanelVideoPayload({
    currentMessage,
    currentMedia,
    selectedVideoShot,
    currentVideoDuration,
    currentVideoModelId,
    currentVideoAspectRatio,
    currentVideoResolution,
    currentVideoMaxReferenceImages,
    currentVideoMaxReferenceVideos,
    currentVideoMaxReferenceAudios,
    currentVideoCapabilitySet,
    currentVideoModelCapability,
    supportsVideoMultiReferenceImages,
    supportsVideoAudioOutput,
    videoGenerateAudio,
    webSearchEnabled,
    videoQualityMode,
    showAudioReferenceSlot,
    videoComposerMode,
    videoEditMode,
    videoCapabilities,
}: BuildChatPanelVideoPayloadParams): ChatPanelVideoPayloadRequest {
    const images = currentMedia.filter((item) => item.type === 'image');
    const videos = currentMedia.filter((item) => item.type === 'video');
    const audios = currentMedia.filter((item) => item.type === 'audio');
    const promptBase = currentMessage || 'Generate a video';
    const prompt = selectedVideoShot
        ? `${promptBase}\n基础镜头：${selectedVideoShot}`
        : promptBase;
    const durationSeconds = parseVideoDuration(currentVideoDuration);
    const maxReferenceImages = currentVideoMaxReferenceImages || currentVideoCapabilitySet?.maxReferenceImages || currentVideoModelCapability?.maxReferenceImages || 3;
    const referenceAudioUrls = showAudioReferenceSlot
        ? audios.slice(0, currentVideoMaxReferenceAudios || 3).map(mediaUrlForPayload)
        : [];
    const firstFrame = images.find((item) => item.frameRole === 'firstFrame') || images[0] || null;
    const lastFrame = images.find((item) => item.frameRole === 'lastFrame') ||
        images.find((item) => item.nodeId !== firstFrame?.nodeId) ||
        null;
    const shouldUseMultiReferenceImages = images.length > 0 &&
        videos.length === 0 &&
        supportsVideoMultiReferenceImages &&
        (
            images.length > 1 ||
            (!currentVideoModelCapability?.inputModes.single_reference && !currentVideoModelCapability?.inputModes.text_to_video)
        );
    const basePayload = {
        prompt,
        model: currentVideoModelId,
        aspectRatio: currentVideoAspectRatio,
        resolution: currentVideoResolution,
        duration: durationSeconds,
        generateAudio: supportsVideoAudioOutput ? videoGenerateAudio : false,
        networkSearch: webSearchEnabled,
        qualityMode: videoQualityMode,
        referenceAudioUrls: referenceAudioUrls.length ? referenceAudioUrls : undefined,
    };

    if (videoComposerMode === 'start_end_frame') {
        if (!firstFrame || !lastFrame) throw new Error('首尾帧模式需要上传首帧和尾帧两张图片。');
        return {
            payload: {
                ...basePayload,
                videoMode: 'start_end_frame',
                firstFrameUrl: mediaUrlForPayload(firstFrame),
                lastFrameUrl: mediaUrlForPayload(lastFrame),
            },
            nodeMode: 'frame-to-frame',
        };
    }

    if (videoComposerMode === 'multi_param' || shouldUseMultiReferenceImages) {
        if (!images.length) throw new Error('多图参考模式需要至少一张参考图。');
        return {
            payload: {
                ...basePayload,
                videoMode: 'multi_param',
                multiReferenceImageUrls: images.slice(0, maxReferenceImages).map(mediaUrlForPayload),
            },
            nodeMode: 'multi-reference',
        };
    }

    if (videoComposerMode === 'video_edit') {
        const effectiveVideoMode = videoEditMode === 'extend' && currentVideoModelCapability?.inputModes.video_extend
            ? 'video_extend'
            : 'video_edit';
        if (!videos.length) throw new Error('视频编辑模式需要上传参考视频。');
        return {
            payload: {
                ...basePayload,
                videoMode: effectiveVideoMode,
                referenceVideoUrls: videos.slice(0, currentVideoCapabilitySet?.maxReferenceVideos || 1).map(mediaUrlForPayload),
                referenceImageUrl: images[0] ? mediaUrlForPayload(images[0]) : undefined,
                editMode: videoEditMode,
            },
            nodeMode: effectiveVideoMode === 'video_extend' ? 'video-extend' : 'video-edit',
        };
    }

    if (videoComposerMode === 'motion_control') {
        if (!images.length) throw new Error('动作控制模式需要上传角色参考图。');
        return {
            payload: {
                ...basePayload,
                videoMode: 'motion_control',
                motionReferenceVideoUrl: videos[0] ? mediaUrlForPayload(videos[0]) : undefined,
                referenceVideoUrls: videos.length ? videos.slice(0, currentVideoCapabilitySet?.maxReferenceVideos || 1).map(mediaUrlForPayload) : undefined,
                characterReferenceImageUrl: mediaUrlForPayload(images[0]),
                referenceImageUrl: mediaUrlForPayload(images[0]),
            },
            nodeMode: 'motion-control',
        };
    }

    if (videos.length) {
        if (isSeedanceVideoModelId(currentVideoModelId)) {
            return {
                payload: {
                    ...basePayload,
                    videoMode: images[0] ? 'image_to_video' : 'text_to_video',
                    referenceImageUrl: images[0] ? mediaUrlForPayload(images[0]) : undefined,
                    referenceVideoUrls: videos.slice(0, currentVideoMaxReferenceVideos || 3).map(mediaUrlForPayload),
                },
                nodeMode: 'standard',
            };
        }
        const editCap = ['video_edit', 'video_extend'].some((mode) =>
            (videoCapabilities[mode as VideoApiMode] || []).some((item) => item.id === currentVideoModelId),
        );
        const fallbackVideoMode = (videoCapabilities.video_edit || []).some((item) => item.id === currentVideoModelId)
            ? 'video_edit'
            : 'video_extend';
        if (!editCap) throw new Error('当前模型没有开放视频参考输入，请切换到支持视频编辑/参考的模型。');
        return {
            payload: {
                ...basePayload,
                videoMode: fallbackVideoMode,
                referenceVideoUrls: videos.slice(0, 1).map(mediaUrlForPayload),
                referenceImageUrl: images[0] ? mediaUrlForPayload(images[0]) : undefined,
                editMode: fallbackVideoMode === 'video_extend' ? 'extend' : 'modify',
            },
            nodeMode: fallbackVideoMode === 'video_extend' ? 'video-extend' : 'video-edit',
        };
    }

    return {
        payload: {
            ...basePayload,
            videoMode: images[0] ? 'image_to_video' : 'text_to_video',
            referenceImageUrl: images[0] ? mediaUrlForPayload(images[0]) : undefined,
        },
        nodeMode: 'standard',
    };
}

export function useChatPanelVideoGeneration({
    isLoading,
    message,
    attachedMedia,
    onApplyActions,
    onFallbackSend,
    onCapabilityError,
    onGenerationStarted,
    ...payloadParams
}: UseChatPanelVideoGenerationParams) {
    const [isGeneratingComposerVideo, setIsGeneratingComposerVideo] = useState(false);

    const handleDirectVideoGenerate = async () => {
        if (isGeneratingComposerVideo || isLoading) return;
        if (!onApplyActions) {
            await onFallbackSend();
            return;
        }

        const currentMessage = message.trim();
        const currentMedia = attachedMedia;
        let videoRequest: ChatPanelVideoPayloadRequest;
        try {
            videoRequest = buildChatPanelVideoPayload({
                ...payloadParams,
                currentMessage,
                currentMedia,
            });
        } catch (err) {
            onCapabilityError(err instanceof Error ? err.message : '视频参数不完整');
            return;
        }

        const nodeId = `agent-video-${Date.now()}`;
        onGenerationStarted();
        setIsGeneratingComposerVideo(true);

        try {
            const videoPayload = videoRequest.payload;
            await onApplyActions([{
                type: 'create_node',
                node: {
                    id: nodeId,
                    type: 'video',
                    title: '视频',
                    prompt: videoPayload.prompt,
                    status: 'loading',
                    model: payloadParams.currentVideoModelId,
                    videoModel: payloadParams.currentVideoModelId,
                    aspectRatio: payloadParams.currentVideoAspectRatio,
                    resolution: payloadParams.currentVideoResolution,
                    videoDuration: parseVideoDuration(payloadParams.currentVideoDuration),
                    videoMode: videoRequest.nodeMode,
                    generateAudio: payloadParams.supportsVideoAudioOutput ? payloadParams.videoGenerateAudio : false,
                    networkSearch: payloadParams.webSearchEnabled,
                    inputUrl: videoPayload.referenceImageUrl || videoPayload.firstFrameUrl,
                    lastFrame: videoPayload.lastFrameUrl,
                    referenceVideoUrls: videoPayload.referenceVideoUrls,
                    referenceAudioUrls: videoPayload.referenceAudioUrls,
                    motionReferenceVideoUrl: videoPayload.motionReferenceVideoUrl,
                    characterReferenceImageUrl: videoPayload.characterReferenceImageUrl,
                    editMode: videoPayload.editMode,
                    qualityMode: videoPayload.qualityMode,
                },
            } as CanvasAgentAction]);

            const result = await generateVideoWithXiaolou({
                ...videoPayload,
                onTaskIdAssigned: (taskId) => {
                    void onApplyActions([{
                        type: 'update_node',
                        nodeId,
                        updates: { taskId },
                    } as CanvasAgentAction]);
                },
            });

            await onApplyActions([{
                type: 'update_node',
                nodeId,
                updates: {
                    status: 'success',
                    resultUrl: result.resultUrl,
                    taskId: result.taskId,
                    model: result.model || payloadParams.currentVideoModelId,
                    videoModel: result.model || payloadParams.currentVideoModelId,
                },
            } as CanvasAgentAction]);
        } catch (err) {
            await onApplyActions([{
                type: 'update_node',
                nodeId,
                updates: {
                    status: 'error',
                    errorMessage: err instanceof Error ? err.message : '视频生成失败',
                },
            } as CanvasAgentAction]);
        } finally {
            setIsGeneratingComposerVideo(false);
        }
    };

    return {
        isGeneratingComposerVideo,
        handleDirectVideoGenerate,
    };
}
