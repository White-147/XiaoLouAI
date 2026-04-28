import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { NodeData, NodeType } from '../../../types';
import type { BridgeMediaModelCapability } from '../../../types';
import {
    normalizeCanvasVideoModelId,
} from '../../../config/canvasVideoModels';
import { useVideoCapabilities } from '../../../hooks/useMediaCapabilities';

export const VIDEO_RESOLUTIONS = ['720p', '480p'];
export const VIDEO_ASPECT_RATIOS = ['16:9', '9:16'];
export const VIDEO_DURATIONS = [5, 6, 8, 10];

type VideoModelCompat = {
    id: string;
    name: string;
    provider: string;
    supportsTextToVideo: boolean;
    supportsImageToVideo: boolean;
    supportsMultiImage: boolean;
    supportsStartEndFrame?: boolean;
    recommended?: boolean;
    durations: number[];
    resolutions: string[];
    aspectRatios: string[];
};

function capabilityToVideoModel(cap: BridgeMediaModelCapability, capsMode?: string): VideoModelCompat {
    const se = cap.inputModes.start_end_frame;
    const textMode = cap.inputModes.text_to_video;
    const singleMode = cap.inputModes.single_reference;
    const multiMode = cap.inputModes.multi_param;

    let primaryMode = singleMode || textMode || multiMode || se;
    if (capsMode === 'start_end_frame' && se) {
        primaryMode = se;
    } else if (capsMode === 'multi_param' && multiMode) {
        primaryMode = multiMode;
    } else if (capsMode === 'text_to_video' && textMode) {
        primaryMode = textMode;
    } else if (capsMode === 'image_to_video' && singleMode) {
        primaryMode = singleMode;
    }

    const durationStrings = primaryMode?.supportedDurations || [];
    const durations = durationStrings
        .map(d => parseInt(String(d), 10))
        .filter(n => !isNaN(n));
    return {
        id: cap.id,
        name: cap.label,
        provider: cap.provider,
        supportsTextToVideo: !!textMode?.supported,
        supportsImageToVideo: !!singleMode?.supported,
        supportsMultiImage: !!multiMode?.supported,
        supportsStartEndFrame: !!(se && se.supported !== false),
        recommended: cap.recommended,
        durations: durations.length > 0 ? durations : [5],
        resolutions: primaryMode?.supportedResolutions || ['720p'],
        aspectRatios: primaryMode?.supportedAspectRatios || ['16:9'],
    };
}

export type VideoGenerationMode = 'text-to-video' | 'image-to-video' | 'frame-to-frame' | 'multi-reference' | 'motion-control';
export type ReferenceType = 'reference' | 'video-edit' | 'first-last-frame';

const VIDEO_MODE_TO_CAPS_MODE: Record<VideoGenerationMode, string> = {
    'text-to-video': 'text_to_video',
    'image-to-video': 'image_to_video',
    'frame-to-frame': 'start_end_frame',
    'multi-reference': 'multi_param',
    'motion-control': 'image_to_video',
};

interface UseVideoSettingsProps {
    data: NodeData;
    inputUrl?: string;
    connectedImageNodes: { id: string; url: string; type?: NodeType }[];
    onUpdate: (id: string, updates: Partial<NodeData>) => void;
}

export function useVideoSettings({ data, inputUrl, connectedImageNodes, onUpdate }: UseVideoSettingsProps) {
    const isFrameToFrame = data.videoMode === 'frame-to-frame';
    const isMotionControl = data.videoMode === 'motion-control';
    const imageInputCount = connectedImageNodes.filter(n => n.type === NodeType.IMAGE || n.type === NodeType.VIDEO).length;

    const videoGenerationMode: VideoGenerationMode = isMotionControl ? 'motion-control'
        : isFrameToFrame ? 'frame-to-frame'
            : imageInputCount >= 2 ? 'multi-reference'
                : (inputUrl || imageInputCount > 0) ? 'image-to-video'
                    : 'text-to-video';

    const capsMode = VIDEO_MODE_TO_CAPS_MODE[videoGenerationMode];
    const {
        capabilities: videoCaps,
        defaultModel: videoDefaultModel,
        source: capsSource,
        loading: capsLoading,
    } = useVideoCapabilities(capsMode);

    const [localPrompt, setLocalPrompt] = useState(data.prompt || '');
    const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastSentPromptRef = useRef<string | undefined>(data.prompt);

    const referenceType: ReferenceType =
        data.videoMode === 'frame-to-frame' ? 'first-last-frame'
            : data.videoMode === 'video-edit' ? 'video-edit'
                : 'reference';

    const effectiveVideoModels: VideoModelCompat[] = useMemo(() => {
        if (videoCaps.length > 0) {
            return videoCaps.map((c) => capabilityToVideoModel(c, capsMode));
        }
        return [];
    }, [videoCaps, capsMode]);

    const normalizedVideoModelId = normalizeCanvasVideoModelId(data.videoModel);

    const currentVideoModel = effectiveVideoModels.find(m => m.id === normalizedVideoModelId) || effectiveVideoModels[0];

    const availableVideoModels = useMemo(() => effectiveVideoModels.filter(model => {
        if (videoGenerationMode === 'text-to-video') return model.supportsTextToVideo;
        if (videoGenerationMode === 'image-to-video') return model.supportsImageToVideo;
        if (videoGenerationMode === 'multi-reference') return model.supportsMultiImage;
        if (videoGenerationMode === 'frame-to-frame') return model.supportsStartEndFrame === true;
        return true;
    }), [effectiveVideoModels, videoGenerationMode]);

    useEffect(() => {
        if (capsLoading) return;
        if (data.type !== NodeType.VIDEO) return;
        if (data.videoModel !== normalizedVideoModelId) {
            onUpdate(data.id, { videoModel: normalizedVideoModelId });
        }
    }, [capsLoading, data.id, data.type, data.videoModel, normalizedVideoModelId, onUpdate]);

    useEffect(() => {
        if (capsLoading) return;
        if (data.type !== NodeType.VIDEO) return;
        const isCurrentModelAvailable = availableVideoModels.some(m => m.id === normalizedVideoModelId);
        if (!isCurrentModelAvailable && availableVideoModels.length > 0) {
            const normalizedDefaultModelId = normalizeCanvasVideoModelId(videoDefaultModel);
            const preferredModelId =
                availableVideoModels.find(m => m.id === normalizedDefaultModelId)?.id ||
                availableVideoModels[0].id;
            onUpdate(data.id, { videoModel: preferredModelId });
        }
    }, [capsLoading, videoGenerationMode, normalizedVideoModelId, data.type, data.id, availableVideoModels, onUpdate, videoDefaultModel]);

    useEffect(() => {
        if (data.prompt !== lastSentPromptRef.current) {
            setLocalPrompt(data.prompt || '');
            lastSentPromptRef.current = data.prompt;
        }
    }, [data.prompt]);

    useEffect(() => {
        return () => {
            if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
        };
    }, []);

    const availableDurations = currentVideoModel?.durations || [5];
    const currentDuration = data.videoDuration || availableDurations[0];

    const getAvailableResolutions = useCallback(() => {
        const model = currentVideoModel as any;
        if (model?.durationResolutionMap && currentDuration) {
            return model.durationResolutionMap[currentDuration] || model?.resolutions || VIDEO_RESOLUTIONS;
        }
        return model?.resolutions || VIDEO_RESOLUTIONS;
    }, [currentVideoModel, currentDuration]);

    const availableResolutions = getAvailableResolutions();
    const availableAspectRatios = currentVideoModel?.aspectRatios || VIDEO_ASPECT_RATIOS;

    const handlePromptChange = useCallback((value: string) => {
        setLocalPrompt(value);
        lastSentPromptRef.current = value;
        if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
        updateTimeoutRef.current = setTimeout(() => {
            onUpdate(data.id, { prompt: value });
        }, 300);
    }, [data.id, onUpdate]);

    const handlePromptBlur = useCallback((nextValue = localPrompt) => {
        if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
        if (nextValue !== data.prompt) {
            onUpdate(data.id, { prompt: nextValue });
        }
    }, [data.id, data.prompt, localPrompt, onUpdate]);

    const handleModelChange = useCallback((modelId: string) => {
        const newModel = effectiveVideoModels.find(m => m.id === modelId);
        const updates: Partial<NodeData> = { videoModel: modelId };

        if (newModel?.durations && data.videoDuration && !newModel.durations.includes(data.videoDuration)) {
            updates.videoDuration = newModel.durations[0];
        }

        if (newModel?.resolutions && data.resolution) {
            const currentRes = data.resolution.toLowerCase();
            const supportedRes = newModel.resolutions.map(r => r.toLowerCase());
            if (!supportedRes.includes(currentRes)) {
                updates.resolution = newModel.resolutions[0];
            }
        }

        onUpdate(data.id, updates);
    }, [data.id, data.videoDuration, data.resolution, effectiveVideoModels, onUpdate]);

    const handleDurationChange = useCallback((duration: number) => {
        const model = currentVideoModel as any;
        const updates: Partial<NodeData> = { videoDuration: duration };

        if (model?.durationResolutionMap) {
            const allowedResolutions = model.durationResolutionMap[duration] || model.resolutions;
            if (data.resolution && !allowedResolutions.includes(data.resolution.toLowerCase())) {
                updates.resolution = allowedResolutions[0];
            }
        }

        onUpdate(data.id, updates);
    }, [currentVideoModel, data.id, data.resolution, onUpdate]);

    const handleAspectRatioChange = useCallback((value: string) => {
        onUpdate(data.id, { aspectRatio: value });
    }, [data.id, onUpdate]);

    const handleResolutionChange = useCallback((value: string) => {
        onUpdate(data.id, { resolution: value });
    }, [data.id, onUpdate]);

    const handleAudioToggle = useCallback(() => {
        onUpdate(data.id, { generateAudio: !(data.generateAudio !== false) });
    }, [data.id, data.generateAudio, onUpdate]);

    const handleNetworkSearchToggle = useCallback(() => {
        onUpdate(data.id, { networkSearch: !data.networkSearch });
    }, [data.id, data.networkSearch, onUpdate]);

    const handleReferenceTypeChange = useCallback((type: ReferenceType) => {
        if (type === 'first-last-frame') {
            onUpdate(data.id, { videoMode: 'frame-to-frame' });
        } else if (type === 'video-edit') {
            onUpdate(data.id, { videoMode: 'video-edit' });
        } else {
            onUpdate(data.id, { videoMode: undefined });
        }
    }, [data.id, onUpdate]);

    const handleFrameReorder = useCallback((fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex || connectedImageNodes.length < 2) return;
        const node1 = connectedImageNodes[0];
        const node2 = connectedImageNodes[1];
        const current1Order = data.frameInputs?.find(f => f.nodeId === node1.id)?.order || 'start';
        const current2Order = data.frameInputs?.find(f => f.nodeId === node2.id)?.order || 'end';
        const updatedFrameInputs = [
            { nodeId: node1.id, order: current1Order === 'start' ? 'end' : 'start' as 'start' | 'end' },
            { nodeId: node2.id, order: current2Order === 'start' ? 'end' : 'start' as 'start' | 'end' }
        ];
        onUpdate(data.id, { frameInputs: updatedFrameInputs });
    }, [connectedImageNodes, data.frameInputs, data.id, onUpdate]);

    const maxInputs = videoGenerationMode === 'multi-reference' ? connectedImageNodes.length : 2;
    const frameInputsWithUrls = useMemo(() => {
        return connectedImageNodes.slice(0, maxInputs).map((node, idx) => {
            const existingInput = data.frameInputs?.find(f => f.nodeId === node.id);
            return {
                nodeId: node.id,
                url: node.url,
                type: node.type,
                order: existingInput?.order || (idx === 0 ? 'start' : 'end') as 'start' | 'end'
            };
        }).sort((a, b) => {
            if (videoGenerationMode === 'multi-reference') return 0;
            if (a.order === 'start' && b.order === 'end') return -1;
            if (a.order === 'end' && b.order === 'start') return 1;
            return 0;
        });
    }, [connectedImageNodes, maxInputs, data.frameInputs, videoGenerationMode]);

    const ratioLabel = data.aspectRatio === 'adaptive' ? '自适应' : (data.aspectRatio || '自动');
    const configSummary = `${ratioLabel} · ${currentDuration}秒 · ${data.resolution || '720p'}`;

    return {
        localPrompt,
        videoGenerationMode,
        referenceType,
        currentVideoModel,
        availableVideoModels,
        effectiveVideoModels,
        useXiaolouVideoModels: capsSource === 'bridge',
        availableDurations,
        currentDuration,
        availableResolutions,
        availableAspectRatios,
        frameInputsWithUrls,
        configSummary,
        imageInputCount,
        handlePromptChange,
        handlePromptBlur,
        handleModelChange,
        handleDurationChange,
        handleAspectRatioChange,
        handleResolutionChange,
        handleAudioToggle,
        handleNetworkSearchToggle,
        handleReferenceTypeChange,
        handleFrameReorder,
    };
}
