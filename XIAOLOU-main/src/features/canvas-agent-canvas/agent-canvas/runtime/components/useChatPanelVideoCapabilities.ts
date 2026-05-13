import { useMemo, type ReactNode } from 'react';

import { buildVideoSlotDefinitions } from './ChatPanelVideoAttachmentSlots';
import {
    getVideoModelIdForTool,
    type ComposerModelOption,
} from './chatPanelModelOptions';
import type { AttachedMedia } from './chatPanelMediaAttachments';
import {
    isSeedanceVideoModelId,
    type VideoApiMode,
    type VideoComposerMode,
} from './useChatPanelVideoGeneration';
import type { BridgeMediaCapabilitySet, BridgeMediaModelCapability } from '../types';

type VideoModeOption = {
    value: VideoComposerMode;
    label: string;
    apiMode: VideoApiMode;
};

type UseChatPanelVideoCapabilitiesParams = {
    selectedVideoTool: string;
    videoModelOptions: ComposerModelOption[];
    videoCapabilities: Record<string, BridgeMediaModelCapability[]>;
    videoComposerMode: VideoComposerMode;
    videoEditMode: string;
    videoAspectRatio: string;
    videoResolution: string;
    videoDuration: string;
    attachedMedia: AttachedMedia[];
    videoModeOptions: VideoModeOption[];
    primaryVideoComposerModes: ReadonlySet<VideoComposerMode>;
    getRatioIcon: (ratio: string) => ReactNode;
};

function capabilityOptions(values?: string[]) {
    return Array.from(new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean)));
}

function sortByPreferredOrder(values: string[], order: string[]) {
    const orderMap = new Map(order.map((value, index) => [value.toLowerCase(), index]));
    return [...values].sort((a, b) => {
        const aOrder = orderMap.get(a.toLowerCase());
        const bOrder = orderMap.get(b.toLowerCase());
        if (aOrder != null || bOrder != null) {
            return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
        }
        return a.localeCompare(b, 'zh-CN', { numeric: true });
    });
}

function sortVideoAspectRatios(values?: string[]) {
    return sortByPreferredOrder(capabilityOptions(values), [
        'Auto',
        'adaptive',
        '16:9',
        '4:3',
        '1:1',
        '3:4',
        '9:16',
        '2:3',
        '3:2',
        '21:9',
    ]);
}

function sortVideoResolutions(values?: string[]) {
    return capabilityOptions(values).sort((a, b) => {
        const aNumber = Number.parseInt(a.replace(/[^\d]/g, ''), 10);
        const bNumber = Number.parseInt(b.replace(/[^\d]/g, ''), 10);
        if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;
        if (Number.isFinite(aNumber)) return -1;
        if (Number.isFinite(bNumber)) return 1;
        return a.localeCompare(b, 'zh-CN', { numeric: true });
    });
}

function sortVideoDurations(values?: string[]) {
    return capabilityOptions(values).sort((a, b) => {
        const aNumber = Number.parseInt(a.replace(/[^\d]/g, ''), 10);
        const bNumber = Number.parseInt(b.replace(/[^\d]/g, ''), 10);
        if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;
        return a.localeCompare(b, 'zh-CN', { numeric: true });
    });
}

function getVideoApiModesForComposerMode(mode: VideoComposerMode, videoModeOptions: VideoModeOption[]): VideoApiMode[] {
    if (mode === 'reference') return ['image_to_video', 'multi_param'];
    if (mode === 'video_edit') return ['video_edit', 'video_extend'];
    return [videoModeOptions.find((item) => item.value === mode)?.apiMode || 'image_to_video'];
}

export function isVideoCapabilitySetAvailable(capability?: BridgeMediaCapabilitySet | null) {
    return Boolean(capability && capability.supported !== false);
}

function isVideoComposerModeSupportedByCapability(
    mode: VideoComposerMode,
    capability: BridgeMediaModelCapability,
    videoModeOptions: VideoModeOption[],
) {
    if (mode === 'reference') {
        return isVideoCapabilitySetAvailable(capability.inputModes.text_to_video) ||
            isVideoCapabilitySetAvailable(capability.inputModes.single_reference) ||
            isVideoCapabilitySetAvailable(capability.inputModes.multi_param);
    }
    if (mode === 'video_edit') {
        return isVideoCapabilitySetAvailable(capability.inputModes.video_edit) ||
            isVideoCapabilitySetAvailable(capability.inputModes.video_extend);
    }
    const apiMode = getVideoApiModesForComposerMode(mode, videoModeOptions)[0];
    return isVideoCapabilitySetAvailable(capability.inputModes[apiMode as keyof typeof capability.inputModes]);
}

function mergeVideoCapabilityItems(items: BridgeMediaModelCapability[]) {
    const merged = new Map<string, BridgeMediaModelCapability>();
    items.forEach((item) => {
        const existing = merged.get(item.id);
        if (!existing) {
            merged.set(item.id, item);
            return;
        }
        merged.set(item.id, {
            ...existing,
            ...item,
            inputModes: {
                ...existing.inputModes,
                ...item.inputModes,
            },
            maxReferenceImages: Math.max(existing.maxReferenceImages || 0, item.maxReferenceImages || 0) || undefined,
            maxReferenceVideos: Math.max(existing.maxReferenceVideos || 0, item.maxReferenceVideos || 0) || undefined,
            maxReferenceAudios: Math.max(existing.maxReferenceAudios || 0, item.maxReferenceAudios || 0) || undefined,
        });
    });
    return Array.from(merged.values());
}

function chooseCapabilityValue(current: string, values: string[] | undefined, fallback = '') {
    const options = capabilityOptions(values);
    if (current && options.includes(current)) return current;
    return options[0] || fallback;
}

function getCapabilityStatusLabel(status?: string) {
    if (status === 'stable') return 'stable';
    if (status === 'experimental') return 'experimental';
    if (status === 'untested') return 'untested';
    if (status === 'preview') return 'preview';
    return status || '';
}

function isVideoAudioGenerationSupported(
    modelId: string,
    modelCapability?: BridgeMediaModelCapability | null,
    capabilitySet?: BridgeMediaCapabilitySet | null,
) {
    if (capabilitySet?.supportsGenerateAudio || modelCapability?.supportsGenerateAudio) return true;
    if (modelId.startsWith('vertex:veo-3.1')) return true;
    if (isSeedanceVideoModelId(modelId)) return true;
    return modelId === 'kling-omni-video' || modelId === 'kling-v3-omni';
}

function isVideoMultiReferenceSupported(capability?: BridgeMediaModelCapability | null) {
    return isVideoCapabilitySetAvailable(capability?.inputModes.multi_param);
}

function getVideoMultiReferenceImageLimit(
    modelId: string,
    capability: BridgeMediaModelCapability | null | undefined,
    rawMax: number,
) {
    const fallback = rawMax > 0 ? rawMax : 3;
    if (capability?.provider === 'google-vertex' || isSeedanceVideoModelId(modelId)) {
        return fallback;
    }
    return Math.min(fallback, 3);
}

export function useChatPanelVideoCapabilities({
    selectedVideoTool,
    videoModelOptions,
    videoCapabilities,
    videoComposerMode,
    videoEditMode,
    videoAspectRatio,
    videoResolution,
    videoDuration,
    attachedMedia,
    videoModeOptions,
    primaryVideoComposerModes,
    getRatioIcon,
}: UseChatPanelVideoCapabilitiesParams) {
    const selectedVideoOption = useMemo(
        () => videoModelOptions.find((option) => option.id === selectedVideoTool),
        [selectedVideoTool, videoModelOptions],
    );
    const allVideoCapabilityItems = useMemo(
        () => Object.values(videoCapabilities).flat(),
        [videoCapabilities],
    );
    const allMergedVideoCapabilityItems = useMemo(
        () => mergeVideoCapabilityItems(allVideoCapabilityItems),
        [allVideoCapabilityItems],
    );
    const currentVideoModelId = useMemo(
        () => getVideoModelIdForTool(selectedVideoTool, selectedVideoOption?.label, allVideoCapabilityItems),
        [allVideoCapabilityItems, selectedVideoOption?.label, selectedVideoTool],
    );
    const currentFullVideoModelCapability = useMemo(
        () => allMergedVideoCapabilityItems.find((item) => item.id === currentVideoModelId) || null,
        [allMergedVideoCapabilityItems, currentVideoModelId],
    );
    const availableVideoModeOptions = useMemo(
        () => {
            if (!currentVideoModelId) return [];
            return videoModeOptions.filter((mode) => {
                const isVisiblePrimaryMode = primaryVideoComposerModes.has(mode.value);
                const isVisibleEditMode = mode.value === 'video_edit' && getVideoApiModesForComposerMode(mode.value, videoModeOptions).some((apiMode) =>
                    (videoCapabilities[apiMode] || []).some((item) =>
                        item.id === currentVideoModelId &&
                        isVideoComposerModeSupportedByCapability(mode.value, item, videoModeOptions),
                    ),
                );
                if (!isVisiblePrimaryMode && !isVisibleEditMode) return false;
                return getVideoApiModesForComposerMode(mode.value, videoModeOptions).some((apiMode) =>
                    (videoCapabilities[apiMode] || []).some((item) =>
                        item.id === currentVideoModelId &&
                        isVideoComposerModeSupportedByCapability(mode.value, item, videoModeOptions),
                    ),
                );
            });
        },
        [currentVideoModelId, primaryVideoComposerModes, videoCapabilities, videoModeOptions],
    );
    const videoApiMode = getVideoApiModesForComposerMode(videoComposerMode, videoModeOptions)[0] || 'image_to_video';
    const currentVideoModeCapabilities = useMemo(
        () => mergeVideoCapabilityItems(
            getVideoApiModesForComposerMode(videoComposerMode, videoModeOptions)
                .flatMap((mode) => videoCapabilities[mode] || []),
        ),
        [videoCapabilities, videoComposerMode, videoModeOptions],
    );
    const currentVideoModelCapability = useMemo(
        () => currentVideoModeCapabilities.find((item) => item.id === currentVideoModelId) || null,
        [currentVideoModeCapabilities, currentVideoModelId],
    );
    const videoImages = useMemo(
        () => attachedMedia.filter((item) => item.type === 'image'),
        [attachedMedia],
    );
    const videoRefs = useMemo(
        () => attachedMedia.filter((item) => item.type === 'video'),
        [attachedMedia],
    );
    const videoAudioRefs = useMemo(
        () => attachedMedia.filter((item) => item.type === 'audio'),
        [attachedMedia],
    );
    const currentVideoCapabilitySet = useMemo<BridgeMediaCapabilitySet | null>(() => {
        if (!currentVideoModelCapability) return null;
        if (videoApiMode === 'image_to_video') {
            const multiReference = currentFullVideoModelCapability?.inputModes.multi_param ||
                currentVideoModelCapability.inputModes.multi_param ||
                null;
            if (
                isVideoCapabilitySetAvailable(multiReference) &&
                (videoImages.length > 1 || (!currentVideoModelCapability.inputModes.single_reference && !currentVideoModelCapability.inputModes.text_to_video))
            ) {
                return multiReference;
            }
            const imageRefs = videoImages.length > 0;
            return imageRefs
                ? currentVideoModelCapability.inputModes.single_reference || currentVideoModelCapability.inputModes.text_to_video || null
                : currentVideoModelCapability.inputModes.text_to_video || currentVideoModelCapability.inputModes.single_reference || null;
        }
        if (videoComposerMode === 'video_edit') {
            if (videoEditMode === 'extend') {
                return currentVideoModelCapability.inputModes.video_extend ||
                    currentVideoModelCapability.inputModes.video_edit ||
                    null;
            }
            return currentVideoModelCapability.inputModes.video_edit ||
                currentVideoModelCapability.inputModes.video_extend ||
                null;
        }
        return currentVideoModelCapability.inputModes[videoApiMode as keyof typeof currentVideoModelCapability.inputModes] || null;
    }, [
        currentFullVideoModelCapability,
        currentVideoModelCapability,
        videoApiMode,
        videoComposerMode,
        videoEditMode,
        videoImages.length,
    ]);
    const videoEditModeOptions = useMemo(
        () => capabilityOptions([
            ...(currentVideoModelCapability?.inputModes.video_edit?.editModes || []),
            ...(currentVideoModelCapability?.inputModes.video_extend?.editModes || []),
        ]),
        [currentVideoModelCapability],
    );
    const videoAspectRatioOptions = useMemo(
        () => sortVideoAspectRatios(currentVideoCapabilitySet?.supportedAspectRatios),
        [currentVideoCapabilitySet],
    );
    const videoResolutionOptions = useMemo(
        () => sortVideoResolutions(currentVideoCapabilitySet?.supportedResolutions),
        [currentVideoCapabilitySet],
    );
    const videoDurationOptions = useMemo(
        () => sortVideoDurations(currentVideoCapabilitySet?.supportedDurations),
        [currentVideoCapabilitySet],
    );
    const currentVideoAspectRatio = chooseCapabilityValue(videoAspectRatio, videoAspectRatioOptions, '16:9');
    const currentVideoResolution = chooseCapabilityValue(videoResolution, videoResolutionOptions, '720p');
    const currentVideoDuration = chooseCapabilityValue(videoDuration, videoDurationOptions, '5s');
    const videoAspectRatioMenuOptions = useMemo(
        () => videoAspectRatioOptions.map((ratio) => {
            const normalized = ratio.toLowerCase();
            const isAuto = normalized === 'auto' || normalized === 'adaptive';
            return {
                value: ratio,
                label: isAuto ? 'Auto' : ratio,
                icon: isAuto ? undefined : getRatioIcon(ratio),
            };
        }),
        [getRatioIcon, videoAspectRatioOptions],
    );
    const videoQualityModeOptions = useMemo(
        () => capabilityOptions(currentVideoCapabilitySet?.qualityModes),
        [currentVideoCapabilitySet],
    );
    const effectiveVideoEditModeOptions = useMemo(
        () => videoComposerMode === 'video_edit'
            ? videoEditModeOptions
            : capabilityOptions(currentVideoCapabilitySet?.editModes),
        [currentVideoCapabilitySet, videoComposerMode, videoEditModeOptions],
    );
    const videoStatusLabel = getCapabilityStatusLabel(currentVideoModelCapability?.status || currentVideoCapabilitySet?.status);
    const supportsVideoMultiReferenceImages = isVideoMultiReferenceSupported(currentFullVideoModelCapability) ||
        isVideoMultiReferenceSupported(currentVideoModelCapability);
    const rawVideoMaxReferenceImages = Math.max(
        currentVideoCapabilitySet?.maxReferenceImages || 0,
        currentVideoModelCapability?.maxReferenceImages || 0,
        currentFullVideoModelCapability?.maxReferenceImages || 0,
        currentVideoModelCapability?.inputModes.single_reference?.supported ? 1 : 0,
        currentVideoModelCapability?.inputModes.start_end_frame?.supported ? 2 : 0,
    );
    const currentVideoMaxReferenceImages = videoComposerMode === 'start_end_frame'
        ? 2
        : supportsVideoMultiReferenceImages
            ? getVideoMultiReferenceImageLimit(
                currentVideoModelId,
                currentFullVideoModelCapability || currentVideoModelCapability,
                rawVideoMaxReferenceImages,
            )
            : Math.min(Math.max(rawVideoMaxReferenceImages, videoComposerMode === 'reference' ? 1 : 0), 1);
    const currentVideoMaxReferenceVideos = Math.max(
        currentVideoCapabilitySet?.maxReferenceVideos || 0,
        currentVideoModelCapability?.maxReferenceVideos || 0,
        currentFullVideoModelCapability?.maxReferenceVideos || 0,
        isSeedanceVideoModelId(currentVideoModelId) ? 3 : 0,
    );
    const currentVideoMaxReferenceAudios = Math.max(
        currentVideoCapabilitySet?.maxReferenceAudios || 0,
        currentVideoModelCapability?.maxReferenceAudios || 0,
        currentFullVideoModelCapability?.maxReferenceAudios || 0,
        isSeedanceVideoModelId(currentVideoModelId) ? 3 : 0,
    );
    const supportsVideoAudioOutput = isVideoAudioGenerationSupported(
        currentVideoModelId,
        currentFullVideoModelCapability || currentVideoModelCapability,
        currentVideoCapabilitySet,
    );
    const showVideoReferenceSlot = videoComposerMode !== 'start_end_frame' && currentVideoMaxReferenceVideos > 0;
    const showImageReferenceSlot = currentVideoMaxReferenceImages > 0 || videoComposerMode === 'start_end_frame' || videoComposerMode === 'reference';
    const showAudioReferenceSlot = currentVideoMaxReferenceAudios > 0;
    const videoSlotDefinitions = useMemo(
        () => buildVideoSlotDefinitions({
            videoComposerMode,
            videoImages,
            videoRefs,
            videoAudioRefs,
            showImageReferenceSlot,
            showVideoReferenceSlot,
            showAudioReferenceSlot,
            currentVideoMaxReferenceImages,
        }),
        [
            currentVideoMaxReferenceImages,
            showAudioReferenceSlot,
            showImageReferenceSlot,
            showVideoReferenceSlot,
            videoAudioRefs,
            videoComposerMode,
            videoImages,
            videoRefs,
        ],
    );
    const hasVideoCapability = Boolean(currentVideoModelCapability && currentVideoCapabilitySet?.supported !== false);

    return {
        selectedVideoOption,
        currentVideoModelId,
        availableVideoModeOptions,
        currentVideoModelCapability,
        currentVideoCapabilitySet,
        videoEditModeOptions,
        effectiveVideoEditModeOptions,
        videoAspectRatioOptions,
        videoResolutionOptions,
        videoDurationOptions,
        currentVideoAspectRatio,
        currentVideoResolution,
        currentVideoDuration,
        videoAspectRatioMenuOptions,
        videoQualityModeOptions,
        videoStatusLabel,
        videoImages,
        videoRefs,
        supportsVideoMultiReferenceImages,
        currentVideoMaxReferenceImages,
        currentVideoMaxReferenceVideos,
        currentVideoMaxReferenceAudios,
        supportsVideoAudioOutput,
        showVideoReferenceSlot,
        showAudioReferenceSlot,
        videoSlotDefinitions,
        hasVideoCapability,
    };
}
