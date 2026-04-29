import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { NodeData, NodeType } from '../../../types';
import type { BridgeMediaCapabilitySet, BridgeMediaModelCapability } from '../../../types';
import { normalizeCanvasVideoModelId } from '../../../config/canvasVideoModels';
import { useVideoCapabilities } from '../../../hooks/useMediaCapabilities';

export type VideoGenerationMode =
    | 'text-to-video'
    | 'image-to-video'
    | 'frame-to-frame'
    | 'multi-reference'
    | 'video-edit'
    | 'video-extend'
    | 'motion-control';
export type ReferenceType = 'reference' | 'video-edit' | 'first-last-frame' | 'multi-reference' | 'motion-control';
export type VideoCapabilityMode = 'image_to_video' | 'start_end_frame' | 'multi_param' | 'video_edit' | 'video_extend' | 'motion_control';
export type VideoMaterialTabId = 'video' | 'image' | 'audio';

export type VideoReferenceTypeOption = {
    id: ReferenceType;
    label: string;
};

export type VideoMaterialTabOption = {
    id: VideoMaterialTabId;
    label: string;
    maxItems: number;
    required?: boolean;
};

type ConnectedVideoMaterial = { id: string; url: string; type?: NodeType };

export type VideoModelCompat = {
    id: string;
    name: string;
    provider: string;
    status?: string;
    supportsTextToVideo: boolean;
    supportsImageToVideo: boolean;
    supportsMultiImage: boolean;
    supportsStartEndFrame: boolean;
    supportsVideoEdit: boolean;
    supportsVideoExtend: boolean;
    supportsMotionControl: boolean;
    supportsGenerateAudio: boolean;
    supportsImageInput: boolean;
    supportsVideoInput: boolean;
    supportsAudioInput: boolean;
    maxReferenceImages: number;
    maxReferenceVideos: number;
    maxReferenceAudios: number;
    recommended?: boolean;
    durations: number[];
    durationLabels: string[];
    resolutions: string[];
    aspectRatios: string[];
    editModes: string[];
    qualityModes: string[];
    inputModes: BridgeMediaModelCapability['inputModes'];
};

const CAPABILITY_MODES: VideoCapabilityMode[] = [
    'image_to_video',
    'start_end_frame',
    'multi_param',
    'video_edit',
    'video_extend',
    'motion_control',
];

const REFERENCE_TYPE_ORDER: ReferenceType[] = [
    'reference',
    'video-edit',
    'first-last-frame',
    'multi-reference',
    'motion-control',
];

const REFERENCE_TYPE_TO_CAPABILITY_MODES: Record<ReferenceType, VideoCapabilityMode[]> = {
    reference: ['image_to_video'],
    'video-edit': ['video_edit', 'video_extend'],
    'first-last-frame': ['start_end_frame'],
    'multi-reference': ['multi_param'],
    'motion-control': ['motion_control'],
};

const REFERENCE_TYPE_LABELS: Record<ReferenceType, string> = {
    reference: '参考图/视频',
    'video-edit': '视频编辑',
    'first-last-frame': '首尾帧',
    'multi-reference': '多图参考',
    'motion-control': '动作控制',
};

const EMPTY_VIDEO_MODEL: VideoModelCompat = {
    id: '',
    name: '暂无模型',
    provider: 'other',
    supportsTextToVideo: false,
    supportsImageToVideo: false,
    supportsMultiImage: false,
    supportsStartEndFrame: false,
    supportsVideoEdit: false,
    supportsVideoExtend: false,
    supportsMotionControl: false,
    supportsGenerateAudio: false,
    supportsImageInput: false,
    supportsVideoInput: false,
    supportsAudioInput: false,
    maxReferenceImages: 0,
    maxReferenceVideos: 0,
    maxReferenceAudios: 0,
    durations: [],
    durationLabels: [],
    resolutions: [],
    aspectRatios: [],
    editModes: [],
    qualityModes: [],
    inputModes: {},
};

function isCapabilityAvailable(capability?: BridgeMediaCapabilitySet | null) {
    return Boolean(capability && capability.supported !== false);
}

function uniqueStrings(values: Array<string | null | undefined>) {
    return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function durationLabelToNumber(label: string) {
    const value = Number.parseInt(String(label || '').replace(/[^\d]/g, ''), 10);
    return Number.isFinite(value) && value > 0 ? value : null;
}

function parseDurationLabels(labels?: string[]) {
    return uniqueStrings(labels || []);
}

function getCapabilityModeForReferenceType(
    type: ReferenceType,
    model?: VideoModelCompat | null,
): VideoCapabilityMode {
    if (type === 'video-edit') {
        return model?.supportsVideoEdit ? 'video_edit' : 'video_extend';
    }
    return REFERENCE_TYPE_TO_CAPABILITY_MODES[type][0];
}

function getCapabilitySetForReferenceType(
    type: ReferenceType,
    model?: VideoModelCompat | null,
    connectedMedia: ConnectedVideoMaterial[] = [],
): BridgeMediaCapabilitySet | null {
    if (!model) return null;
    if (type === 'first-last-frame') return model.inputModes.start_end_frame || null;
    if (type === 'multi-reference') return model.inputModes.multi_param || null;
    if (type === 'motion-control') return model.inputModes.motion_control || null;
    if (type === 'video-edit') {
        return model.inputModes.video_edit || model.inputModes.video_extend || null;
    }

    const imageCount = connectedMedia.filter((item) => item.type === NodeType.IMAGE).length;
    if (imageCount > 1 && isCapabilityAvailable(model.inputModes.multi_param)) {
        return model.inputModes.multi_param || null;
    }
    if (imageCount > 0 && isCapabilityAvailable(model.inputModes.single_reference)) {
        return model.inputModes.single_reference || null;
    }
    return model.inputModes.text_to_video || model.inputModes.single_reference || null;
}

function isReferenceTypeSupportedByModel(type: ReferenceType, model?: VideoModelCompat | null) {
    if (!model) return false;
    if (type === 'reference') {
        return model.supportsTextToVideo || model.supportsImageToVideo || model.supportsVideoInput || model.supportsAudioInput;
    }
    if (type === 'first-last-frame') return model.supportsStartEndFrame;
    if (type === 'multi-reference') return model.supportsMultiImage;
    if (type === 'video-edit') return model.supportsVideoEdit || model.supportsVideoExtend;
    if (type === 'motion-control') return model.supportsMotionControl;
    return false;
}

function doesCapabilitySupportReferenceType(type: ReferenceType, cap: BridgeMediaModelCapability) {
    if (type === 'reference') {
        return isCapabilityAvailable(cap.inputModes.text_to_video) ||
            isCapabilityAvailable(cap.inputModes.single_reference) ||
            (cap.maxReferenceVideos || 0) > 0 ||
            (cap.maxReferenceAudios || 0) > 0;
    }
    if (type === 'first-last-frame') return isCapabilityAvailable(cap.inputModes.start_end_frame);
    if (type === 'multi-reference') return isCapabilityAvailable(cap.inputModes.multi_param);
    if (type === 'video-edit') {
        return isCapabilityAvailable(cap.inputModes.video_edit) || isCapabilityAvailable(cap.inputModes.video_extend);
    }
    if (type === 'motion-control') return isCapabilityAvailable(cap.inputModes.motion_control);
    return false;
}

function mergeCapabilityItems(items: BridgeMediaModelCapability[]) {
    const merged = new Map<string, BridgeMediaModelCapability>();
    for (const item of items) {
        const existing = merged.get(item.id);
        if (!existing) {
            merged.set(item.id, {
                ...item,
                inputModes: { ...item.inputModes },
            });
            continue;
        }
        merged.set(item.id, {
            ...existing,
            ...item,
            provider: existing.provider || item.provider,
            label: existing.label || item.label,
            status: existing.status || item.status,
            note: existing.note || item.note,
            recommended: existing.recommended || item.recommended,
            maxReferenceImages: Math.max(existing.maxReferenceImages || 0, item.maxReferenceImages || 0) || undefined,
            maxReferenceVideos: Math.max(existing.maxReferenceVideos || 0, item.maxReferenceVideos || 0) || undefined,
            maxReferenceAudios: Math.max(existing.maxReferenceAudios || 0, item.maxReferenceAudios || 0) || undefined,
            supportsGenerateAudio: existing.supportsGenerateAudio || item.supportsGenerateAudio,
            inputModes: {
                ...existing.inputModes,
                ...item.inputModes,
            },
        });
    }
    return Array.from(merged.values());
}

function capabilityToVideoModel(cap: BridgeMediaModelCapability, primaryMode?: VideoCapabilityMode): VideoModelCompat {
    const primaryCapability =
        primaryMode === 'start_end_frame' ? cap.inputModes.start_end_frame :
            primaryMode === 'multi_param' ? cap.inputModes.multi_param :
                primaryMode === 'video_edit' ? cap.inputModes.video_edit :
                    primaryMode === 'video_extend' ? cap.inputModes.video_extend :
                        primaryMode === 'motion_control' ? cap.inputModes.motion_control :
                            cap.inputModes.single_reference || cap.inputModes.text_to_video || cap.inputModes.multi_param || cap.inputModes.start_end_frame || cap.inputModes.video_extend || cap.inputModes.video_edit || cap.inputModes.motion_control;

    const allModeSets = Object.values(cap.inputModes).filter(Boolean) as BridgeMediaCapabilitySet[];
    const durationLabels = parseDurationLabels(primaryCapability?.supportedDurations);
    const maxReferenceImages = Math.max(
        cap.maxReferenceImages || 0,
        primaryCapability?.maxReferenceImages || 0,
        cap.inputModes.single_reference?.supported ? 1 : 0,
        cap.inputModes.start_end_frame?.supported ? 2 : 0,
        ...allModeSets.map((item) => item.maxReferenceImages || 0),
    );
    const maxReferenceVideos = Math.max(
        cap.maxReferenceVideos || 0,
        primaryCapability?.maxReferenceVideos || 0,
        ...allModeSets.map((item) => item.maxReferenceVideos || 0),
    );
    const maxReferenceAudios = Math.max(
        cap.maxReferenceAudios || 0,
        primaryCapability?.maxReferenceAudios || 0,
        ...allModeSets.map((item) => item.maxReferenceAudios || 0),
    );
    const supportsGenerateAudio = Boolean(
        cap.supportsGenerateAudio ||
        primaryCapability?.supportsGenerateAudio ||
        allModeSets.some((item) => item.supportsGenerateAudio),
    );

    return {
        id: cap.id,
        name: cap.label,
        provider: cap.provider,
        status: cap.status,
        supportsTextToVideo: isCapabilityAvailable(cap.inputModes.text_to_video),
        supportsImageToVideo: isCapabilityAvailable(cap.inputModes.single_reference),
        supportsMultiImage: isCapabilityAvailable(cap.inputModes.multi_param),
        supportsStartEndFrame: isCapabilityAvailable(cap.inputModes.start_end_frame),
        supportsVideoEdit: isCapabilityAvailable(cap.inputModes.video_edit),
        supportsVideoExtend: isCapabilityAvailable(cap.inputModes.video_extend),
        supportsMotionControl: isCapabilityAvailable(cap.inputModes.motion_control),
        supportsGenerateAudio,
        supportsImageInput: isCapabilityAvailable(cap.inputModes.single_reference) ||
            isCapabilityAvailable(cap.inputModes.multi_param) ||
            isCapabilityAvailable(cap.inputModes.start_end_frame) ||
            isCapabilityAvailable(cap.inputModes.motion_control) ||
            maxReferenceImages > 0,
        supportsVideoInput: maxReferenceVideos > 0 ||
            Boolean(cap.inputModes.video_edit?.requires?.includes('reference_video')) ||
            Boolean(cap.inputModes.video_extend?.requires?.includes('reference_video')),
        supportsAudioInput: maxReferenceAudios > 0,
        maxReferenceImages,
        maxReferenceVideos,
        maxReferenceAudios,
        recommended: cap.recommended,
        durations: durationLabels.map(durationLabelToNumber).filter((item): item is number => item !== null),
        durationLabels,
        resolutions: primaryCapability?.supportedResolutions || [],
        aspectRatios: primaryCapability?.supportedAspectRatios || [],
        editModes: uniqueStrings([
            ...(primaryCapability?.editModes || []),
            ...(cap.inputModes.video_edit?.editModes || []),
            ...(cap.inputModes.video_extend?.editModes || []),
        ]),
        qualityModes: uniqueStrings([
            ...(primaryCapability?.qualityModes || []),
            ...(cap.inputModes.motion_control?.qualityModes || []),
        ]),
        inputModes: cap.inputModes,
    };
}

function referenceTypeFromNode(data: NodeData): ReferenceType {
    if (data.videoMode === 'frame-to-frame') return 'first-last-frame';
    if (data.videoMode === 'multi-reference') return 'multi-reference';
    if (data.videoMode === 'video-edit' || data.videoMode === 'video-extend') return 'video-edit';
    if (data.videoMode === 'motion-control') return 'motion-control';
    return 'reference';
}

function nodeVideoModeForReferenceType(type: ReferenceType, currentModel?: VideoModelCompat | null): NodeData['videoMode'] {
    if (type === 'first-last-frame') return 'frame-to-frame';
    if (type === 'multi-reference') return 'multi-reference';
    if (type === 'video-edit') return currentModel?.supportsVideoEdit ? 'video-edit' : 'video-extend';
    if (type === 'motion-control') return 'motion-control';
    return undefined;
}

function formatDurationLabel(duration?: number | string | null) {
    if (typeof duration === 'number' && Number.isFinite(duration)) return `${duration}s`;
    const value = String(duration || '').trim();
    return value || '';
}

function chooseStringValue(current: string | undefined, options: string[]) {
    const normalizedCurrent = String(current || '').trim();
    if (normalizedCurrent && options.includes(normalizedCurrent)) return normalizedCurrent;
    return options[0] || '';
}

function chooseDurationValue(current: number | undefined, options: number[]) {
    if (current && options.includes(current)) return current;
    return options[0];
}

function getModeCapabilities(
    mode: VideoCapabilityMode,
    capabilitiesByMode: Record<VideoCapabilityMode, BridgeMediaModelCapability[]>,
) {
    return capabilitiesByMode[mode] || [];
}

function getMaxReferenceImagesForMode(
    type: ReferenceType,
    model?: VideoModelCompat | null,
    capability?: BridgeMediaCapabilitySet | null,
) {
    if (!model) return 0;
    if (type === 'first-last-frame') return 2;
    if (type === 'reference') {
        return Math.max(
            capability?.maxReferenceImages || 0,
            model.inputModes.single_reference?.supported ? 1 : 0,
            model.inputModes.multi_param?.supported ? model.maxReferenceImages : 0,
        );
    }
    return Math.max(capability?.maxReferenceImages || 0, model.maxReferenceImages || 0);
}

function getMaxReferenceVideosForMode(
    type: ReferenceType,
    model?: VideoModelCompat | null,
    capability?: BridgeMediaCapabilitySet | null,
) {
    if (!model || type === 'first-last-frame' || type === 'multi-reference') return 0;
    const requiresVideo = capability?.requires?.some((item) =>
        item === 'reference_video' || item === 'motion_reference_video',
    );
    return Math.max(capability?.maxReferenceVideos || 0, requiresVideo ? 1 : 0, model.maxReferenceVideos || 0);
}

function getMaxReferenceAudiosForMode(
    type: ReferenceType,
    model?: VideoModelCompat | null,
    capability?: BridgeMediaCapabilitySet | null,
) {
    if (!model || type === 'first-last-frame' || type === 'multi-reference') return 0;
    return Math.max(capability?.maxReferenceAudios || 0, model.maxReferenceAudios || 0);
}

function buildVisibleMaterialTabs(
    type: ReferenceType,
    model?: VideoModelCompat | null,
    capability?: BridgeMediaCapabilitySet | null,
): VideoMaterialTabOption[] {
    if (!model || type === 'first-last-frame') return [];

    const requires = new Set(capability?.requires || []);
    const maxImages = getMaxReferenceImagesForMode(type, model, capability);
    const maxVideos = getMaxReferenceVideosForMode(type, model, capability);
    const maxAudios = getMaxReferenceAudiosForMode(type, model, capability);
    const tabs: VideoMaterialTabOption[] = [];

    const shouldShowImage =
        maxImages > 0 ||
        requires.has('character_reference_image') ||
        requires.has('reference_image') ||
        (type === 'reference' && model.supportsImageInput);
    const shouldShowVideo =
        maxVideos > 0 ||
        requires.has('reference_video') ||
        requires.has('motion_reference_video') ||
        (type === 'reference' && model.supportsVideoInput);
    const shouldShowAudio = maxAudios > 0 || (type === 'reference' && model.supportsAudioInput);

    if (type === 'motion-control') {
        if (shouldShowVideo) {
            tabs.push({
                id: 'video',
                label: '视频',
                maxItems: Math.max(maxVideos, 1),
                required: requires.has('motion_reference_video'),
            });
        }
        if (shouldShowImage) {
            tabs.push({
                id: 'image',
                label: '图片',
                maxItems: Math.max(maxImages, 1),
                required: requires.has('character_reference_image'),
            });
        }
    } else {
        if (shouldShowVideo) {
            tabs.push({
                id: 'video',
                label: '视频',
                maxItems: Math.max(maxVideos, 1),
                required: requires.has('reference_video'),
            });
        }
        if (shouldShowImage) {
            tabs.push({
                id: 'image',
                label: '图片',
                maxItems: Math.max(maxImages, 1),
                required: requires.has('reference_image'),
            });
        }
    }

    if (shouldShowAudio) {
        tabs.push({
            id: 'audio',
            label: '音频',
            maxItems: Math.max(maxAudios, 1),
        });
    }

    return tabs;
}

interface UseVideoSettingsProps {
    data: NodeData;
    inputUrl?: string;
    connectedImageNodes: ConnectedVideoMaterial[];
    onUpdate: (id: string, updates: Partial<NodeData>) => void;
}

export function useVideoSettings({ data, inputUrl, connectedImageNodes, onUpdate }: UseVideoSettingsProps) {
    const imageToVideoCaps = useVideoCapabilities('image_to_video');
    const startEndCaps = useVideoCapabilities('start_end_frame');
    const multiParamCaps = useVideoCapabilities('multi_param');
    const videoEditCaps = useVideoCapabilities('video_edit');
    const videoExtendCaps = useVideoCapabilities('video_extend');
    const motionControlCaps = useVideoCapabilities('motion_control');

    const capabilitiesByMode = useMemo<Record<VideoCapabilityMode, BridgeMediaModelCapability[]>>(() => ({
        image_to_video: imageToVideoCaps.capabilities,
        start_end_frame: startEndCaps.capabilities,
        multi_param: multiParamCaps.capabilities,
        video_edit: videoEditCaps.capabilities,
        video_extend: videoExtendCaps.capabilities,
        motion_control: motionControlCaps.capabilities,
    }), [
        imageToVideoCaps.capabilities,
        startEndCaps.capabilities,
        multiParamCaps.capabilities,
        videoEditCaps.capabilities,
        videoExtendCaps.capabilities,
        motionControlCaps.capabilities,
    ]);

    const capsLoading = [
        imageToVideoCaps.loading,
        startEndCaps.loading,
        multiParamCaps.loading,
        videoEditCaps.loading,
        videoExtendCaps.loading,
        motionControlCaps.loading,
    ].some(Boolean);
    const capsSource = imageToVideoCaps.source;

    const [localPrompt, setLocalPrompt] = useState(data.prompt || '');
    const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastSentPromptRef = useRef<string | undefined>(data.prompt);

    const referenceType = referenceTypeFromNode(data);
    const normalizedVideoModelId = normalizeCanvasVideoModelId(data.videoModel);

    const mergedVideoCapabilities = useMemo(
        () => mergeCapabilityItems(Object.values(capabilitiesByMode).flat()),
        [capabilitiesByMode],
    );
    const allVideoModels = useMemo(
        () => mergedVideoCapabilities.map((cap) => capabilityToVideoModel(cap)),
        [mergedVideoCapabilities],
    );
    const currentVideoModel = allVideoModels.find((model) => model.id === normalizedVideoModelId) || allVideoModels[0] || EMPTY_VIDEO_MODEL;
    const availableReferenceTypes = useMemo(() => {
        const availableByAnyModel = REFERENCE_TYPE_ORDER.filter((type) =>
            REFERENCE_TYPE_TO_CAPABILITY_MODES[type].some((mode) =>
                getModeCapabilities(mode, capabilitiesByMode).some((cap) => doesCapabilitySupportReferenceType(type, cap)),
            ),
        );
        if (!currentVideoModel.id) return availableByAnyModel;
        const currentSupported = availableByAnyModel.filter((type) => isReferenceTypeSupportedByModel(type, currentVideoModel));
        return currentSupported.length ? currentSupported : availableByAnyModel;
    }, [capabilitiesByMode, currentVideoModel]);
    const availableReferenceTypeOptions = useMemo<VideoReferenceTypeOption[]>(
        () => availableReferenceTypes.map((type) => ({ id: type, label: REFERENCE_TYPE_LABELS[type] })),
        [availableReferenceTypes],
    );

    const capabilityMode = getCapabilityModeForReferenceType(referenceType, currentVideoModel);
    const modeMergedCapabilities = useMemo(() => {
        const modes = REFERENCE_TYPE_TO_CAPABILITY_MODES[referenceType];
        return mergeCapabilityItems(modes.flatMap((mode) => capabilitiesByMode[mode] || []));
    }, [capabilitiesByMode, referenceType]);
    const availableVideoModels = useMemo(
        () => allVideoModels,
        [allVideoModels],
    );
    const currentModeVideoModels = useMemo(
        () => modeMergedCapabilities.map((cap) => capabilityToVideoModel(cap, capabilityMode)),
        [capabilityMode, modeMergedCapabilities],
    );
    const currentModeModel = currentModeVideoModels.find((model) => model.id === currentVideoModel.id) || currentModeVideoModels[0] || currentVideoModel;
    const currentCapabilitySet = getCapabilitySetForReferenceType(referenceType, currentModeModel, connectedImageNodes);

    const availableDurations = currentModeModel?.durations || [];
    const availableDurationLabels = currentModeModel?.durationLabels || availableDurations.map(formatDurationLabel);
    const currentDuration = chooseDurationValue(data.videoDuration, availableDurations) || undefined;
    const availableResolutions = currentModeModel?.resolutions || [];
    const currentResolution = chooseStringValue(data.resolution, availableResolutions);
    const availableAspectRatios = currentModeModel?.aspectRatios || [];
    const currentAspectRatio = chooseStringValue(data.aspectRatio, availableAspectRatios);
    const editModeOptions = currentModeModel?.editModes || [];
    const qualityModeOptions = currentModeModel?.qualityModes || [];
    const currentEditMode = chooseStringValue(data.editMode, editModeOptions);
    const currentQualityMode = chooseStringValue(data.qualityMode, qualityModeOptions);
    const supportsAudioOutput = Boolean(currentCapabilitySet?.supportsGenerateAudio || currentModeModel?.supportsGenerateAudio);
    const supportsNetworkSearch = false;
    const visibleMaterialTabs = useMemo(
        () => buildVisibleMaterialTabs(referenceType, currentModeModel, currentCapabilitySet),
        [currentCapabilitySet, currentModeModel, referenceType],
    );

    const imageInputCount = connectedImageNodes.filter((item) => item.type === NodeType.IMAGE).length;
    const videoInputCount = connectedImageNodes.filter((item) => item.type === NodeType.VIDEO).length;
    const audioInputCount = connectedImageNodes.filter((item) => item.type === NodeType.AUDIO).length;

    const videoGenerationMode: VideoGenerationMode =
        referenceType === 'first-last-frame' ? 'frame-to-frame' :
            referenceType === 'multi-reference' ? 'multi-reference' :
                referenceType === 'video-edit' ? (currentModeModel?.supportsVideoEdit ? 'video-edit' : 'video-extend') :
                    referenceType === 'motion-control' ? 'motion-control' :
                        imageInputCount > 0 || inputUrl ? 'image-to-video' : 'text-to-video';

    useEffect(() => {
        if (capsLoading) return;
        if (data.type !== NodeType.VIDEO) return;
        if (currentVideoModel.id && data.videoModel !== currentVideoModel.id) {
            onUpdate(data.id, { videoModel: currentVideoModel.id, model: currentVideoModel.id });
        }
    }, [capsLoading, currentVideoModel, data.id, data.type, data.videoModel, onUpdate]);

    useEffect(() => {
        if (capsLoading) return;
        if (data.type !== NodeType.VIDEO) return;
        if (!availableReferenceTypes.includes(referenceType) && availableReferenceTypes.length > 0) {
            const nextReferenceType = availableReferenceTypes[0];
            onUpdate(data.id, { videoMode: nodeVideoModeForReferenceType(nextReferenceType, currentVideoModel) });
        }
    }, [availableReferenceTypes, capsLoading, currentVideoModel, data.id, data.type, onUpdate, referenceType]);

    useEffect(() => {
        if (capsLoading) return;
        if (data.type !== NodeType.VIDEO) return;
        const updates: Partial<NodeData> = {};
        if (currentDuration && data.videoDuration !== currentDuration) {
            updates.videoDuration = currentDuration;
        }
        if (currentResolution && data.resolution !== currentResolution) {
            updates.resolution = currentResolution;
        }
        if (currentAspectRatio && data.aspectRatio !== currentAspectRatio) {
            updates.aspectRatio = currentAspectRatio;
        }
        if (!supportsAudioOutput && data.generateAudio) {
            updates.generateAudio = false;
        }
        if (currentEditMode && data.editMode !== currentEditMode) {
            updates.editMode = currentEditMode;
        }
        if (currentQualityMode && data.qualityMode !== currentQualityMode) {
            updates.qualityMode = currentQualityMode;
        }
        if (Object.keys(updates).length > 0) {
            onUpdate(data.id, updates);
        }
    }, [
        capsLoading,
        currentAspectRatio,
        currentDuration,
        currentResolution,
        currentEditMode,
        currentQualityMode,
        data.aspectRatio,
        data.editMode,
        data.generateAudio,
        data.id,
        data.qualityMode,
        data.resolution,
        data.type,
        data.videoDuration,
        onUpdate,
        supportsAudioOutput,
    ]);

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
        const newModel = allVideoModels.find((model) => model.id === modelId);
        const updates: Partial<NodeData> = {
            videoModel: modelId,
            model: modelId,
        };
        if (newModel && !isReferenceTypeSupportedByModel(referenceType, newModel)) {
            const nextReferenceType = REFERENCE_TYPE_ORDER.find((type) => isReferenceTypeSupportedByModel(type, newModel));
            updates.videoMode = nextReferenceType ? nodeVideoModeForReferenceType(nextReferenceType, newModel) : undefined;
        }
        onUpdate(data.id, updates);
    }, [allVideoModels, data.id, onUpdate, referenceType]);

    const handleDurationChange = useCallback((duration: number) => {
        onUpdate(data.id, { videoDuration: duration });
    }, [data.id, onUpdate]);

    const handleAspectRatioChange = useCallback((value: string) => {
        onUpdate(data.id, { aspectRatio: value });
    }, [data.id, onUpdate]);

    const handleResolutionChange = useCallback((value: string) => {
        onUpdate(data.id, { resolution: value });
    }, [data.id, onUpdate]);

    const handleAudioToggle = useCallback(() => {
        onUpdate(data.id, { generateAudio: !(data.generateAudio === true) });
    }, [data.id, data.generateAudio, onUpdate]);

    const handleNetworkSearchToggle = useCallback(() => {
        onUpdate(data.id, { networkSearch: !data.networkSearch });
    }, [data.id, data.networkSearch, onUpdate]);

    const handleReferenceTypeChange = useCallback((type: ReferenceType) => {
        const nextVideoMode = nodeVideoModeForReferenceType(type, currentVideoModel);
        const updates: Partial<NodeData> = { videoMode: nextVideoMode };
        if (type !== 'video-edit') {
            updates.editMode = undefined;
        }
        if (type !== 'motion-control') {
            updates.qualityMode = undefined;
        }
        onUpdate(data.id, updates);
    }, [currentVideoModel, data.id, onUpdate]);

    const handleEditModeChange = useCallback((editMode: string) => {
        onUpdate(data.id, { editMode });
    }, [data.id, onUpdate]);

    const handleQualityModeChange = useCallback((qualityMode: string) => {
        onUpdate(data.id, { qualityMode });
    }, [data.id, onUpdate]);

    const handleFrameReorder = useCallback((fromIndex: number, toIndex: number) => {
        const imageNodes = connectedImageNodes.filter((item) => item.type === NodeType.IMAGE);
        if (fromIndex === toIndex || imageNodes.length < 2) return;
        const node1 = imageNodes[0];
        const node2 = imageNodes[1];
        const current1Order = data.frameInputs?.find((frame) => frame.nodeId === node1.id)?.order || 'start';
        const current2Order = data.frameInputs?.find((frame) => frame.nodeId === node2.id)?.order || 'end';
        const updatedFrameInputs = [
            { nodeId: node1.id, order: (current1Order === 'start' ? 'end' : 'start') as 'start' | 'end' },
            { nodeId: node2.id, order: (current2Order === 'start' ? 'end' : 'start') as 'start' | 'end' },
        ];
        onUpdate(data.id, { frameInputs: updatedFrameInputs });
    }, [connectedImageNodes, data.frameInputs, data.id, onUpdate]);

    const maxInputs = referenceType === 'multi-reference'
        ? connectedImageNodes.filter((item) => item.type === NodeType.IMAGE).length
        : 2;
    const frameInputsWithUrls = useMemo(() => {
        return connectedImageNodes
            .filter((item) => item.type === NodeType.IMAGE)
            .slice(0, maxInputs)
            .map((node, idx) => {
                const existingInput = data.frameInputs?.find((frame) => frame.nodeId === node.id);
                return {
                    nodeId: node.id,
                    url: node.url,
                    type: node.type,
                    order: (existingInput?.order || (idx === 0 ? 'start' : 'end')) as 'start' | 'end',
                };
            })
            .sort((a, b) => {
                if (referenceType === 'multi-reference') return 0;
                if (a.order === 'start' && b.order === 'end') return -1;
                if (a.order === 'end' && b.order === 'start') return 1;
                return 0;
            });
    }, [connectedImageNodes, data.frameInputs, maxInputs, referenceType]);

    const ratioLabel = currentAspectRatio || data.aspectRatio || 'Auto';
    const durationLabel = formatDurationLabel(currentDuration || data.videoDuration) || 'Auto';
    const resolutionLabel = currentResolution || data.resolution || 'Auto';
    const configSummary = [ratioLabel, durationLabel, resolutionLabel].filter(Boolean).join(' · ');

    const modeMaxReferenceImages = getMaxReferenceImagesForMode(referenceType, currentModeModel, currentCapabilitySet);
    const modeMaxReferenceVideos = getMaxReferenceVideosForMode(referenceType, currentModeModel, currentCapabilitySet);
    const modeMaxReferenceAudios = getMaxReferenceAudiosForMode(referenceType, currentModeModel, currentCapabilitySet);

    return {
        localPrompt,
        videoGenerationMode,
        referenceType,
        availableReferenceTypes,
        availableReferenceTypeOptions,
        visibleMaterialTabs,
        currentVideoModel,
        availableVideoModels,
        currentModeVideoModels,
        effectiveVideoModels: availableVideoModels,
        currentCapabilitySet,
        capabilityMode,
        capsLoading,
        useXiaolouVideoModels: capsSource === 'bridge',
        availableDurations,
        availableDurationLabels,
        currentDuration,
        availableResolutions,
        currentResolution,
        availableAspectRatios,
        currentAspectRatio,
        frameInputsWithUrls,
        configSummary,
        imageInputCount,
        videoInputCount,
        audioInputCount,
        supportsImageInput: Boolean(currentModeModel?.supportsImageInput),
        supportsVideoInput: Boolean(currentModeModel?.supportsVideoInput),
        supportsAudioInput: Boolean(currentModeModel?.supportsAudioInput),
        supportsAudioOutput,
        supportsNetworkSearch,
        maxReferenceImages: modeMaxReferenceImages,
        maxReferenceVideos: modeMaxReferenceVideos,
        maxReferenceAudios: modeMaxReferenceAudios,
        editModeOptions,
        qualityModeOptions,
        currentEditMode,
        currentQualityMode,
        handlePromptChange,
        handlePromptBlur,
        handleModelChange,
        handleDurationChange,
        handleAspectRatioChange,
        handleResolutionChange,
        handleAudioToggle,
        handleNetworkSearchToggle,
        handleReferenceTypeChange,
        handleEditModeChange,
        handleQualityModeChange,
        handleFrameReorder,
    };
}
