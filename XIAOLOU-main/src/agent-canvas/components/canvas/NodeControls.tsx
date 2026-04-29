/**
 * NodeControls.tsx
 * 
 * Lovart-style control panel for canvas nodes (Image / Local Model types).
 * Video nodes use VideoSettingsPanel instead.
 */

import React, { useState, useRef, useEffect, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import {
    Sparkles, Banana, Check, Image as ImageIcon,
    ChevronDown, HardDrive, Paperclip, Layout,
    Loader2, Zap, Info, Library, AlertCircle, Plus, ArrowLeftRight, Maximize2, Minimize2
} from 'lucide-react';
import { CanvasNodeUploadSource, NodeData, NodeStatus, NodeType } from '../../types';
import type { BridgeMediaModelCapability } from '../../types';
import { OpenAIIcon, KlingIcon } from '../icons/BrandIcons';
import { ChangeAnglePanel } from './ChangeAnglePanel';
import { LocalModel, getLocalModels } from '../../services/localModelService';
import {
    CANVAS_IMAGE_MODELS,
    getCanvasImageQualityOptions,
    getCanvasImageResolutionOptions,
    normalizeCanvasImageModelId,
    normalizeCanvasImageOutputCount,
    shouldShowCanvasImageOutputCount,
    shouldShowCanvasImageQuality,
    shouldShowCanvasImageResolution
} from '../../config/canvasImageModels';
import { useImageCapabilities } from '../../hooks/useMediaCapabilities';
import { useFloatingPanelOffset } from '../../hooks/useFloatingPanelOffset';
import { ReferencePromptInput, type PromptImageReference } from './ReferencePromptInput';
import { useCreateCreditQuote } from '../../../lib/useCreateCreditQuote';

interface NodeControlsProps {
    data: NodeData;
    inputUrl?: string;
    isLoading: boolean;
    isSuccess: boolean;
    connectedImageNodes?: { id: string; url: string; type?: NodeType }[];
    availableCanvasNodes?: { id: string; url: string; type?: NodeType }[];
    onUpdate: (id: string, updates: Partial<NodeData>) => void;
    onGenerate: (id: string) => void;
    canGenerate?: boolean;
    generateDisabledReason?: string;
    onChangeAngleGenerate?: (nodeId: string) => void;
    onUpload?: (nodeId: string, imageSource: CanvasNodeUploadSource) => void;
    onAttachReferenceImages?: (nodeId: string, imageSources: CanvasNodeUploadSource[]) => void;
    onPickFromLibrary?: (nodeId: string) => void;
    onSelect: (id: string) => void;
    zoom: number;
    creditQuoteProjectId?: string | null;
    canvasTheme?: 'dark' | 'light';
    allowCameraAngle?: boolean;
}

const IMAGE_RATIOS = [
    "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"
];

const MAX_BATCH_COUNT = 10;

type CanvasImageModelCompat = {
    id: string;
    name: string;
    provider: string;
    supportsImageToImage: boolean;
    supportsMultiImage: boolean;
    recommended?: boolean;
    resolutions: string[];
    resolutionControl?: 'none' | 'fixed' | 'selectable';
    qualities?: string[];
    qualityControl?: 'none' | 'fixed' | 'selectable';
    aspectRatios: string[];
    defaultResolution?: string;
    defaultQuality?: string;
    defaultAspectRatio?: string;
    supportsNativeOutputCount?: boolean;
    maxOutputImages?: number;
    defaultOutputCount?: number;
};

function capabilityToImageModel(cap: BridgeMediaModelCapability): CanvasImageModelCompat {
    const textMode = cap.inputModes.text_to_image;
    const imgMode = cap.inputModes.image_to_image;
    const multiMode = cap.inputModes.multi_image;
    const primaryMode = textMode || imgMode || multiMode;
    return {
        id: cap.id,
        name: cap.label,
        provider: cap.provider,
        supportsImageToImage: !!imgMode?.supported,
        supportsMultiImage: !!multiMode?.supported,
        recommended: cap.recommended,
        resolutions: primaryMode?.supportedResolutions || [],
        resolutionControl: primaryMode?.resolutionControl,
        qualities: primaryMode?.supportedQualities || [],
        qualityControl: primaryMode?.qualityControl,
        aspectRatios: primaryMode?.supportedAspectRatios || [],
        defaultResolution: primaryMode?.defaultResolution || undefined,
        defaultQuality: primaryMode?.defaultQuality || undefined,
        defaultAspectRatio: primaryMode?.defaultAspectRatio || undefined,
        supportsNativeOutputCount: !!primaryMode?.supportsNativeOutputCount,
        maxOutputImages: primaryMode?.maxOutputImages || undefined,
        defaultOutputCount: primaryMode?.defaultOutputCount || undefined,
    };
}

const STATIC_IMAGE_MODELS = CANVAS_IMAGE_MODELS.filter((model) => !model.hiddenUnlessConfigured);

// Lovart-style per-ratio pixel dimensions at the 2K base. Other resolutions
// scale linearly (each output dim multiplied by base/2048), then snapped to
// multiples of 32 so downstream encoders stay happy.
const RATIO_INFO_2K: Record<string, { w: number; h: number }> = {
    '8:1':  { w: 2048, h: 256  },
    '4:1':  { w: 2048, h: 512  },
    '21:9': { w: 3136, h: 1344 },
    '16:9': { w: 2912, h: 1632 },
    '3:2':  { w: 2688, h: 1792 },
    '4:3':  { w: 2464, h: 1856 },
    '5:4':  { w: 2560, h: 2048 },
    '1:1':  { w: 2048, h: 2048 },
    '4:5':  { w: 2048, h: 2560 },
    '3:4':  { w: 1856, h: 2464 },
    '2:3':  { w: 1792, h: 2688 },
    '9:16': { w: 1632, h: 2912 },
    '1:4':  { w: 512,  h: 2048 },
    '1:8':  { w: 256,  h: 2048 },
};

const RESOLUTION_BASE: Record<string, number> = {
    '512': 512, '1K': 1024, '2K': 2048, '3K': 3072, '4K': 4096,
};

const RATIO_DISPLAY: Record<string, string> = {
    '1024x1024': '1:1', '1536x1024': '3:2', '1024x1536': '2:3',
};

function snap32(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 32;
    return Math.max(32, Math.round(value / 32) * 32);
}

function parseRatio(ratio: string): { w: number; h: number } | null {
    if (!ratio) return null;
    // Already a WxH literal like "1024x1024"
    if (ratio.includes('x')) {
        const [w, h] = ratio.split('x').map(Number);
        if (w > 0 && h > 0) return { w, h };
        return null;
    }
    const [rw, rh] = ratio.split(':').map(Number);
    if (!rw || !rh) return null;
    return { w: rw, h: rh };
}

// Compute the pixel dimensions shown next to each ratio in the popover.
// Prefers the Lovart-style hardcoded table (accurate at 2K), scaling to
// other resolutions. Falls back to sqrt-area formula for unseen ratios so
// models advertising exotic ratios still render correctly.
function computeRatioDimensions(ratio: string, resolution: string): { w: number; h: number } | null {
    const base = RESOLUTION_BASE[resolution] ?? RESOLUTION_BASE['2K'];
    const hardcoded = RATIO_INFO_2K[ratio];
    if (hardcoded) {
        const scale = base / 2048;
        return { w: snap32(hardcoded.w * scale), h: snap32(hardcoded.h * scale) };
    }
    const parsed = parseRatio(ratio);
    if (!parsed) return null;
    // Direct WxH literal: rescale both dims so max side ~= base.
    if (ratio.includes('x')) {
        const maxDim = Math.max(parsed.w, parsed.h);
        if (!maxDim) return null;
        const scale = base / Math.max(maxDim, 1);
        return { w: snap32(parsed.w * scale), h: snap32(parsed.h * scale) };
    }
    const aspect = parsed.w / parsed.h;
    return {
        w: snap32(base * Math.sqrt(aspect)),
        h: snap32(base / Math.sqrt(aspect)),
    };
}

function getRatioIcon(ratio: string): React.ReactNode {
    if (ratio.includes('x')) {
        const parts = ratio.split('x').map(Number);
        if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
            const maxDim = 14;
            const scale = maxDim / Math.max(parts[0], parts[1]);
            const rw = Math.max(6, Math.round(parts[0] * scale));
            const rh = Math.max(6, Math.round(parts[1] * scale));
            return <div className="border border-current rounded-[2px]" style={{ width: rw, height: rh }} />;
        }
    }
    const parts = ratio.split(':');
    if (parts.length !== 2) return null;
    const w = parseInt(parts[0]), h = parseInt(parts[1]);
    const maxDim = 14;
    const scale = maxDim / Math.max(w, h);
    const rw = Math.max(6, Math.round(w * scale));
    const rh = Math.max(6, Math.round(h * scale));
    return <div className="border border-current rounded-[2px]" style={{ width: rw, height: rh }} />;
}

/**
 * Build a prompt that includes angle transformation instructions
 */
function buildAnglePrompt(
    basePrompt: string,
    settings: { mode?: 'subject' | 'camera'; rotation: number; tilt: number; scale: number; wideAngle: boolean }
): string {
    const parts: string[] = [];
    parts.push(settings.mode === 'subject'
        ? 'Generate this same image with the subject rotated while the camera remains mostly stable.'
        : 'Generate this same image from a different camera angle.'
    );
    if (settings.rotation !== 0) {
        const direction = settings.rotation > 0 ? 'right' : 'left';
        parts.push(`The camera has rotated ${Math.abs(settings.rotation)}° to the ${direction}.`);
    }
    if (settings.tilt !== 0) {
        const direction = settings.tilt > 0 ? 'upward' : 'downward';
        parts.push(`The camera has tilted ${Math.abs(settings.tilt)}° ${direction}.`);
    }
    if (settings.scale !== 0) {
        if (settings.scale > 50) parts.push('The camera is positioned closer to the subject.');
        else if (settings.scale < 50 && settings.scale > 0) parts.push('The camera is positioned slightly closer.');
    }
    if (settings.wideAngle) parts.push('Use a wide-angle lens perspective with visible distortion at the edges.');
    if (basePrompt.trim()) parts.push(`Original scene description: ${basePrompt}`);
    return parts.join(' ');
}

type PopupType = 'model' | 'imageSource' | 'settings' | null;

const NodeControlsComponent: React.FC<NodeControlsProps> = ({
    data,
    inputUrl,
    isLoading,
    isSuccess,
    connectedImageNodes = [],
    availableCanvasNodes = [],
    onUpdate,
    onGenerate,
    canGenerate = true,
    generateDisabledReason,
    onChangeAngleGenerate,
    onUpload,
    onAttachReferenceImages,
    onPickFromLibrary,
    onSelect,
    zoom,
    creditQuoteProjectId = null,
    canvasTheme = 'dark',
    allowCameraAngle = true
}) => {
    const { capabilities: imageCaps, loading: capsLoading } = useImageCapabilities();
    const IMAGE_MODELS: CanvasImageModelCompat[] = useMemo(() => {
        if (imageCaps.length > 0) {
            return imageCaps.map(capabilityToImageModel);
        }
        return STATIC_IMAGE_MODELS;
    }, [imageCaps]);

    const [openPopup, setOpenPopup] = useState<PopupType>(null);
    const [localPrompt, setLocalPrompt] = useState(data.prompt || '');
    const [showCanvasPicker, setShowCanvasPicker] = useState(false);
    const [isPanelExpanded, setIsPanelExpanded] = useState(false);
    const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastSentPromptRef = useRef<string | undefined>(data.prompt);
    const modelRef = useRef<HTMLDivElement>(null);
    const refRef = useRef<HTMLDivElement>(null);
    const settingsRef = useRef<HTMLDivElement>(null);
    const imageSourcePopupRef = useRef<HTMLDivElement>(null);
    const localImageInputRef = useRef<HTMLInputElement>(null);
    const [imageSourcePopupPosition, setImageSourcePopupPosition] = useState<{ left: number; top: number } | null>(null);
    const promptMinHeight = isPanelExpanded ? 540 : data.isPromptExpanded ? 300 : 96;
    const promptMaxHeight = isPanelExpanded ? 840 : data.isPromptExpanded ? 420 : 224;

    const [localModels, setLocalModels] = useState<LocalModel[]>([]);
    const [isLoadingLocalModels, setIsLoadingLocalModels] = useState(false);
    const isLocalModelNode = data.type === NodeType.LOCAL_IMAGE_MODEL || data.type === NodeType.LOCAL_VIDEO_MODEL;

    useEffect(() => {
        if (!isLocalModelNode) return;
        const fetchModels = async () => {
            setIsLoadingLocalModels(true);
            try {
                const models = await getLocalModels();
                const filtered = data.type === NodeType.LOCAL_VIDEO_MODEL
                    ? models.filter(m => m.type === 'video')
                    : models.filter(m => m.type === 'image' || m.type === 'lora' || m.type === 'controlnet');
                setLocalModels(filtered);
            } catch (error) {
                console.error('Error fetching local models:', error);
            } finally {
                setIsLoadingLocalModels(false);
            }
        };
        fetchModels();
    }, [isLocalModelNode, data.type]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            if (openPopup === 'model' && modelRef.current && !modelRef.current.contains(target)) setOpenPopup(null);
            if (
                openPopup === 'imageSource' &&
                refRef.current &&
                !refRef.current.contains(target) &&
                imageSourcePopupRef.current &&
                !imageSourcePopupRef.current.contains(target)
            ) {
                setOpenPopup(null);
            }
            if (openPopup === 'settings' && settingsRef.current && !settingsRef.current.contains(target)) setOpenPopup(null);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [openPopup]);

    useEffect(() => {
        if (openPopup !== 'imageSource') {
            setImageSourcePopupPosition(null);
            return;
        }

        const updatePosition = () => {
            if (!refRef.current || typeof window === 'undefined') return;
            const rect = refRef.current.getBoundingClientRect();
            const estimatedMenuWidth = 208;
            const estimatedMenuHeight = 152;
            const viewportPadding = 12;

            const nextLeft = Math.min(
                Math.max(viewportPadding, rect.left),
                Math.max(viewportPadding, window.innerWidth - estimatedMenuWidth - viewportPadding),
            );

            const preferBelowTop = rect.bottom + 8;
            const shouldPlaceAbove = preferBelowTop + estimatedMenuHeight > window.innerHeight - viewportPadding;
            const nextTop = shouldPlaceAbove
                ? Math.max(viewportPadding, rect.top - estimatedMenuHeight - 8)
                : preferBelowTop;

            setImageSourcePopupPosition({ left: nextLeft, top: nextTop });
        };

        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [openPopup, zoom, connectedImageNodes.length]);

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

    const handlePromptChange = (value: string) => {
        setLocalPrompt(value);
        lastSentPromptRef.current = value;
        if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
        updateTimeoutRef.current = setTimeout(() => {
            onUpdate(data.id, { prompt: value });
        }, 300);
    };

    const handlePromptBlur = (nextValue: string) => {
        if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
        if (nextValue !== data.prompt) onUpdate(data.id, { prompt: nextValue });
    };

    const normalizedImageModelId = normalizeCanvasImageModelId(data.imageModel);
    const currentImageModel = IMAGE_MODELS.find(m => m.id === normalizedImageModelId) || IMAGE_MODELS[0];
    const isImageNode = data.type === NodeType.IMAGE || data.type === NodeType.LOCAL_IMAGE_MODEL;
    const canAttachReferenceImages = Boolean(onAttachReferenceImages || onUpload);

    const inputCount = connectedImageNodes.length;
    const availableImageModels = IMAGE_MODELS.filter(model => {
        if (inputCount === 0) {
            const cap = imageCaps.find(c => c.id === model.id);
            return cap ? !!cap.inputModes.text_to_image?.supported : true;
        }
        if (inputCount === 1) return model.supportsImageToImage;
        return model.supportsMultiImage;
    });

    useEffect(() => {
        if (capsLoading) return;
        if (data.type !== NodeType.IMAGE && data.type !== NodeType.IMAGE_EDITOR) return;
        if (data.imageModel !== normalizedImageModelId) {
            onUpdate(data.id, { imageModel: normalizedImageModelId });
        }
    }, [capsLoading, data.id, data.imageModel, data.type, normalizedImageModelId, onUpdate]);

    useEffect(() => {
        if (capsLoading) return;
        if (data.type !== NodeType.IMAGE && data.type !== NodeType.IMAGE_EDITOR) return;
        const isCurrentModelAvailable = availableImageModels.some(m => m.id === data.imageModel);
        if (!isCurrentModelAvailable && availableImageModels.length > 0) {
            onUpdate(data.id, { imageModel: availableImageModels[0].id });
        }
    }, [capsLoading, inputCount, data.imageModel, data.type, data.id, availableImageModels, onUpdate]);

    const handleImageModelChange = (modelId: string) => {
        const newModel = IMAGE_MODELS.find(m => m.id === modelId);
        const updates: Partial<typeof data> = { imageModel: modelId };
        if (newModel?.aspectRatios && data.aspectRatio && !newModel.aspectRatios.includes(data.aspectRatio)) {
            updates.aspectRatio = newModel.aspectRatios.includes('1:1') ? '1:1' : newModel.aspectRatios[0];
        }
        if (newModel?.resolutions && newModel.resolutions.length > 0 && data.resolution && !newModel.resolutions.includes(data.resolution)) {
            updates.resolution = newModel.resolutions.includes('2K') ? '2K' : newModel.resolutions[0];
        }
        if (newModel && !shouldShowCanvasImageResolution(newModel)) {
            updates.resolution = '';
        }
        if (newModel) {
            updates.batchCount = normalizeCanvasImageOutputCount(newModel, data.batchCount);
        }
        onUpdate(data.id, updates);
        setOpenPopup(null);
    };

    const handleLocalModelChange = (model: LocalModel) => {
        onUpdate(data.id, {
            localModelId: model.id,
            localModelPath: model.path,
            localModelType: model.type as NodeData['localModelType'],
            localModelArchitecture: model.architecture
        });
        setOpenPopup(null);
    };

    const selectedLocalModel = localModels.find(m => m.id === data.localModelId);

    const imageAspectRatioOptions = useMemo(() => {
        if (isLocalModelNode) {
            return IMAGE_RATIOS;
        }
        return currentImageModel.aspectRatios?.length ? currentImageModel.aspectRatios : IMAGE_RATIOS;
    }, [currentImageModel.aspectRatios, isLocalModelNode]);

    const resolutionOptions = useMemo(() => {
        if (isLocalModelNode) {
            return ['512'];
        }
        return getCanvasImageResolutionOptions(currentImageModel);
    }, [currentImageModel.resolutions, isLocalModelNode]);
    const qualityOptions = useMemo(
        () => getCanvasImageQualityOptions(currentImageModel),
        [currentImageModel],
    );
    const showQualitySettings = !isLocalModelNode && shouldShowCanvasImageQuality(currentImageModel);
    const showResolutionSettings = isLocalModelNode || shouldShowCanvasImageResolution(currentImageModel);
    const showOutputCountSettings = !isLocalModelNode && shouldShowCanvasImageOutputCount(currentImageModel);
    const showDimensionSettings = showQualitySettings && !showResolutionSettings;

    const preferredAspectRatio = useMemo(
        () => currentImageModel.defaultAspectRatio || imageAspectRatioOptions.find((option) => option === '1:1') || imageAspectRatioOptions[0] || '1:1',
        [currentImageModel.defaultAspectRatio, imageAspectRatioOptions],
    );
    const preferredResolution = useMemo(
        () => currentImageModel.defaultResolution || resolutionOptions[0] || '',
        [currentImageModel.defaultResolution, resolutionOptions],
    );

    useEffect(() => {
        if (capsLoading) return;
        if (!isImageNode && !isLocalModelNode && data.type !== NodeType.IMAGE_EDITOR) return;
        if (data.resultUrl || data.status === NodeStatus.LOADING) return;

        const updates: Partial<NodeData> = {};

        if (!data.aspectRatio || data.aspectRatio === 'Auto' || !imageAspectRatioOptions.includes(data.aspectRatio)) {
            updates.aspectRatio = preferredAspectRatio;
        }

        if (
            resolutionOptions.length > 0 &&
            preferredResolution &&
            (!data.resolution || data.resolution === 'Auto' || !resolutionOptions.includes(data.resolution))
        ) {
            updates.resolution = preferredResolution;
        }
        if (resolutionOptions.length === 0 && data.resolution) {
            updates.resolution = '';
        }

        const nextBatchCount = normalizeCanvasImageOutputCount(currentImageModel, data.batchCount);
        if (Number(data.batchCount || 1) !== nextBatchCount) {
            updates.batchCount = nextBatchCount;
        }

        if (Object.keys(updates).length > 0) {
            onUpdate(data.id, updates);
        }
    }, [
        capsLoading,
        data.aspectRatio,
        data.batchCount,
        data.id,
        data.resolution,
        data.resultUrl,
        data.status,
        data.type,
        imageAspectRatioOptions,
        isImageNode,
        isLocalModelNode,
        onUpdate,
        preferredAspectRatio,
        preferredResolution,
        resolutionOptions,
        currentImageModel,
    ]);

    const currentBatchCount = normalizeCanvasImageOutputCount(currentImageModel, data.batchCount);
    const currentSizeLabel = data.aspectRatio || preferredAspectRatio;
    const currentResolution = data.resolution || preferredResolution;
    const currentAspectRatioLabel = RATIO_DISPLAY[currentSizeLabel] || currentSizeLabel;
    const currentResolutionLabel = showResolutionSettings ? (currentResolution || '自动') : '';
    const currentQualityLabel = showQualitySettings ? (qualityOptions[0] || '') : '';
    const maxOutputCount = currentImageModel.maxOutputImages || 1;
    const sizeInfo = computeRatioDimensions(currentSizeLabel, currentResolution || preferredResolution || '1K');
    const shouldQuoteImageGeneration =
        canGenerate &&
        (data.type === NodeType.IMAGE || data.type === NodeType.IMAGE_EDITOR) &&
        !isLocalModelNode;
    const imageGenerationQuote = useCreateCreditQuote(
        shouldQuoteImageGeneration ? 'create_image_generate' : null,
        {
            projectId: creditQuoteProjectId || undefined,
            count: showOutputCountSettings ? currentBatchCount : 1,
            model: normalizedImageModelId,
            aspectRatio: currentSizeLabel,
            resolution: showResolutionSettings ? (currentResolution || undefined) : undefined,
        },
        shouldQuoteImageGeneration,
    );
    const generateCreditLabel = imageGenerationQuote.isLoading
        ? '...'
        : String(imageGenerationQuote.quote?.credits ?? 0);
    const countOptions = useMemo(
        () => Array.from({ length: maxOutputCount }, (_, index) => index + 1),
        [maxOutputCount],
    );
    const isSettingsOpen = openPopup === 'settings';

    const handleAspectRatioSelect = (value: string) => {
        onUpdate(data.id, { aspectRatio: value });
    };

    const handleResolutionSelect = (value: string) => {
        onUpdate(data.id, { resolution: value });
    };

    const handleBatchCountSelect = (value: number) => {
        onUpdate(data.id, { batchCount: normalizeCanvasImageOutputCount(currentImageModel, value) });
    };

    const handleCanvasSelectNode = (nodeId: string) => {
        const selectedNode = availableCanvasNodes.find((node) => node.id === nodeId);
        if (!selectedNode?.url) return;
        if (selectedNode.id === data.id) return;

        const currentParentIds = data.parentIds || [];
        if (!currentParentIds.includes(selectedNode.id)) {
            onUpdate(data.id, { parentIds: [...currentParentIds, selectedNode.id] });
        }

        setShowCanvasPicker(false);
        setOpenPopup(null);
    };

    const handleRemoveConnectedNode = (nodeId: string) => {
        const currentParentIds = data.parentIds || [];
        onUpdate(data.id, { parentIds: currentParentIds.filter(pid => pid !== nodeId) });
    };

    const handleLocalFileSelected = (files: FileList | null) => {
        if (!files || files.length === 0 || !canAttachReferenceImages) return;
        const selectedFiles = Array.from(files);

        if (selectedFiles.some((file) => !file.type.startsWith('image/'))) {
            onUpdate(data.id, {
                status: NodeStatus.ERROR,
                errorMessage: '请选择图片文件作为参考图。',
            });
            return;
        }

        if (onAttachReferenceImages) {
            onAttachReferenceImages(data.id, selectedFiles);
            return;
        }

        if (onUpload) {
            onUpload(data.id, selectedFiles[0]);
        }
    };

    const togglePopup = (p: PopupType) => setOpenPopup(prev => prev === p ? null : p);

    // Render the floating control bar at screen-1x regardless of the canvas
    // zoom level. Because the enclosing canvas layer is `scale(zoom)`, an
    // inner `scale(1/zoom)` exactly cancels it, so the outer text renders at
    // 1:1 device pixels. Clamp to the canvas minimum zoom to avoid runaway
    // child sizes without shrinking the prompt box at 0.1x.
    const safeZoom = Math.max(zoom, 0.1);
    const localScale = 1 / safeZoom;
    const { ref: panelRef, transform: floatingPanelTransform } = useFloatingPanelOffset({
        localScale,
        deps: [
            data.id,
            data.status,
            openPopup,
            showCanvasPicker,
            connectedImageNodes.length,
            availableCanvasNodes.length,
            isLoading,
            canGenerate,
            data.isPromptExpanded,
            isPanelExpanded,
            data.aspectRatio,
            data.resolution,
            data.batchCount,
            generateCreditLabel,
        ],
    });

    const isDark = canvasTheme === 'dark';
    const generationMetaLabel = [
        currentQualityLabel,
        showResolutionSettings ? currentResolutionLabel : null,
        currentAspectRatioLabel,
        showOutputCountSettings ? `${currentBatchCount} img` : null,
    ].filter(Boolean).join(' · ');
    const isGenerateDisabled = isLoading || !canGenerate;
    const generateButtonTitle = !canGenerate
        ? generateDisabledReason || '当前账号暂无创作权限'
        : imageGenerationQuote.quote
            ? `生成，预计消耗 ${imageGenerationQuote.quote.credits} 积分`
            : '生成';
    const shouldShowReferenceStrip = isImageNode && canAttachReferenceImages;
    const promptReferenceOptions = useMemo<PromptImageReference[]>(
        () => connectedImageNodes.map((node, index) => ({
            id: node.id,
            url: node.url,
            label: `参考图${index + 1}`,
        })),
        [connectedImageNodes],
    );

    const handleAngleGenerate = () => {
        if (onChangeAngleGenerate) onChangeAngleGenerate(data.id);
    };

    // ChangeAnglePanel for angle mode
    if (allowCameraAngle && data.angleMode && data.type === NodeType.IMAGE && isSuccess && data.resultUrl) {
        return (
            <div
                data-node-panel="angle"
                data-node-owner-id={data.id}
                style={{ transform: `scale(${localScale})`, transformOrigin: 'top center', transition: 'transform 0.1s ease-out' }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onSelect(data.id)}
            >
                <ChangeAnglePanel
                    imageUrl={data.resultUrl}
                    settings={data.angleSettings || { mode: 'camera', rotation: 0, tilt: 0, scale: 0, wideAngle: false }}
                    onSettingsChange={(settings) => onUpdate(data.id, { angleSettings: settings })}
                    onClose={() => onUpdate(data.id, { angleMode: false })}
                    onGenerate={handleAngleGenerate}
                    isLoading={isLoading}
                    canvasTheme={canvasTheme}
                    errorMessage={data.errorMessage}
                />
            </div>
        );
    }

    const getModelIcon = (model: typeof currentImageModel, size = 14) => {
        if (model.provider === 'volcengine') return <Sparkles size={size} className="text-orange-400" />;
        if (model.provider === 'google') return <Banana size={size} className="text-yellow-400" />;
        if (model.provider === 'openai') return <OpenAIIcon size={size} className="text-green-400" />;
        if (model.provider === 'kling') return <KlingIcon size={size} />;
        return <ImageIcon size={size} className="text-cyan-400" />;
    };

    const imageSourceMenu = openPopup === 'imageSource' && imageSourcePopupPosition && typeof document !== 'undefined'
        ? createPortal(
            <div
                ref={imageSourcePopupRef}
                className={`fixed z-[160] w-auto min-w-[188px] rounded-2xl shadow-2xl border py-1.5 ${
                    isDark ? 'bg-[#1e1e1e] border-neutral-700' : 'bg-white border-neutral-200'
                }`}
                style={{ left: imageSourcePopupPosition.left, top: imageSourcePopupPosition.top }}
                onPointerDown={(e) => e.stopPropagation()}
            >
                <button
                    onClick={() => { localImageInputRef.current?.click(); setOpenPopup(null); }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
                        isDark ? 'text-neutral-200 hover:bg-neutral-800' : 'text-neutral-700 hover:bg-neutral-50'
                    }`}
                >
                    <Paperclip size={15} className={isDark ? 'text-neutral-400' : 'text-neutral-500'} />
                    从本地上传图片
                </button>
                {onPickFromLibrary && (
                    <button
                        onClick={() => { setOpenPopup(null); onPickFromLibrary(data.id); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
                            isDark ? 'text-neutral-200 hover:bg-neutral-800' : 'text-neutral-700 hover:bg-neutral-50'
                        }`}
                    >
                        <Library size={15} className={isDark ? 'text-neutral-400' : 'text-neutral-500'} />
                        从素材库选择
                    </button>
                )}
                <button
                    onClick={() => { setOpenPopup(null); setShowCanvasPicker(true); }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
                        isDark ? 'text-neutral-200 hover:bg-neutral-800' : 'text-neutral-700 hover:bg-neutral-50'
                    }`}
                >
                    <Layout size={15} className={isDark ? 'text-neutral-400' : 'text-neutral-500'} />
                    从画布选择
                </button>
            </div>,
            document.body,
        )
        : null;

    return (
        <>
            <div
                ref={panelRef}
                data-node-panel="image-controls"
                data-node-owner-id={data.id}
                className="relative w-full"
                style={{
                    width: isPanelExpanded ? 'min(860px, calc(100vw - 176px))' : '100%',
                    transform: floatingPanelTransform,
                    transformOrigin: 'top center',
                    transition: 'width 0.18s ease, transform 0.1s ease-out',
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onSelect(data.id)}
            >
                {/* Main Card */}
                <div className={`relative rounded-2xl shadow-2xl border ${
                    isDark ? 'bg-[#1a1a1a] border-neutral-800' : 'bg-white border-neutral-200'
                }`}>
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            setIsPanelExpanded((current) => !current);
                        }}
                        className={`absolute right-2 top-2 z-[15] flex h-8 w-8 items-center justify-center rounded-xl border transition-colors ${
                            isDark
                                ? 'border-white/10 bg-[#202020]/95 text-neutral-400 hover:bg-[#2a2a2a] hover:text-white'
                                : 'border-[#e8dfd2] bg-[#fffdfa]/95 text-[#8f887d] hover:bg-[#f4efe7] hover:text-[#171512]'
                        }`}
                        title={isPanelExpanded ? '收起浮动面板' : '放大浮动面板'}
                        aria-label={isPanelExpanded ? '收起浮动面板' : '放大浮动面板'}
                    >
                        {isPanelExpanded ? (
                            <Minimize2 size={15} strokeWidth={1.9} />
                        ) : (
                            <Maximize2 size={15} strokeWidth={1.9} />
                        )}
                    </button>

                {/* Connected Node Thumbnails */}
                {shouldShowReferenceStrip && (
                    <div className="px-4 pt-3 pb-1 pr-12 rounded-t-2xl">
                        <div className="flex gap-2 overflow-x-auto" onWheel={e => e.stopPropagation()}>
                            {connectedImageNodes.map(node => (
                                <div key={node.id} className={`relative flex-shrink-0 overflow-hidden border group/thumb ${
                                    connectedImageNodes.length === 0
                                        ? 'w-[74px] h-[74px] rounded-[22px]'
                                        : 'w-[60px] h-[60px] rounded-[18px]'
                                } ${
                                    isDark ? 'border-neutral-700 bg-neutral-900' : 'border-neutral-200 bg-neutral-100'
                                }`}>
                                    <img src={node.url} alt="" className="w-full h-full object-cover" />
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleRemoveConnectedNode(node.id); }}
                                        className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity hover:bg-red-500/80"
                                    >
                                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                    </button>
                                </div>
                            ))}
                            <div className="relative flex-shrink-0" ref={refRef}>
                                <button
                                    type="button"
                                    onClick={() => togglePopup('imageSource')}
                                    className={`flex items-center justify-center border transition-all ${
                                        connectedImageNodes.length === 0
                                            ? 'h-[72px] w-[72px] rounded-[22px]'
                                            : 'h-[60px] w-[60px] rounded-[18px]'
                                    } ${
                                        isDark
                                            ? 'border-neutral-700 bg-neutral-900/90 text-neutral-400 hover:border-neutral-500 hover:bg-neutral-800 hover:text-white'
                                            : 'border-[#e5ded4] bg-[#f1efe9] text-[#8f887d] hover:border-[#d7cfbe] hover:bg-[#ece8df] hover:text-[#615d56]'
                                    }`}
                                    title="添加参考图"
                                >
                                    <Plus size={connectedImageNodes.length === 0 ? 24 : 18} strokeWidth={2.2} />
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Canvas Node Picker */}
                {showCanvasPicker && (() => {
                    const pickable = availableCanvasNodes.filter(
                        n => n.type === NodeType.IMAGE && n.id !== data.id
                    );
                    return (
                        <div className={`px-4 py-2 border-b ${isDark ? 'border-neutral-800' : 'border-neutral-100'}`}>
                            <div className="flex items-center justify-between mb-2">
                                <span className={`text-xs font-medium ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>
                                    点击选择画布中的图片节点
                                </span>
                                <button
                                    onClick={() => setShowCanvasPicker(false)}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                                        isDark ? 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600' : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300'
                                    }`}
                                >
                                    完成
                                </button>
                            </div>
                            {pickable.length === 0 ? (
                                <div className={`text-xs py-4 text-center ${isDark ? 'text-neutral-600' : 'text-neutral-400'}`}>
                                    画布中暂无可用的图片节点
                                </div>
                            ) : (
                                <div className="flex gap-2 overflow-x-auto pb-1" onWheel={e => e.stopPropagation()}>
                                    {pickable.map(node => (
                                        <button
                                            key={node.id}
                                            onClick={() => handleCanvasSelectNode(node.id)}
                                            className={`relative flex-shrink-0 w-[60px] h-[60px] rounded-lg overflow-hidden border-2 transition-all hover:scale-105 ${
                                                isDark ? 'border-neutral-700 hover:border-neutral-500' : 'border-neutral-200 hover:border-neutral-400'
                                            }`}
                                        >
                                            <img src={node.url} alt="" className="w-full h-full object-cover" />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })()}

                {/* Prompt Textarea */}
                {!(data.prompt && data.prompt.startsWith('Extract panel #')) && (
                    <div className="px-4 pt-3 pb-2 pr-12">
                        <ReferencePromptInput
                            value={localPrompt}
                            references={promptReferenceOptions}
                            isDark={isDark}
                            placeholder="今天我们要创作什么"
                            minHeight={promptMinHeight}
                            maxHeight={promptMaxHeight}
                            expanded={data.isPromptExpanded}
                            onChange={handlePromptChange}
                            onWheel={(e) => e.stopPropagation()}
                            onBlur={handlePromptBlur}
                        />
                    </div>
                )}

                {data.errorMessage && (
                    <div className="mx-4 mb-2 text-red-400 text-xs p-2 bg-red-900/20 rounded-lg border border-red-900/50">
                        {data.errorMessage}
                    </div>
                )}
                {!canGenerate && generateDisabledReason && !data.errorMessage && (
                    <div
                        className={`mx-4 mb-2 flex items-start gap-2 rounded-xl border px-3 py-2 text-[11px] leading-5 ${
                            isDark
                                ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                                : 'border-amber-600/40 bg-amber-500/15 text-amber-800'
                        }`}
                    >
                        <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                        <span className="min-w-0 whitespace-pre-wrap break-words">{generateDisabledReason}</span>
                    </div>
                )}

                {/* Bottom Control Bar */}
                {!(data.prompt && data.prompt.startsWith('Extract panel #')) && (
                    <div className={`px-3 py-2.5 flex items-center justify-between border-t ${
                        isDark ? 'border-neutral-800' : 'border-neutral-100'
                    }`}>
                        <div className="relative flex min-w-0 items-center" ref={settingsRef}>
                            <button
                                type="button"
                                onClick={() => togglePopup('settings')}
                                className={`inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors ${
                                    isDark
                                        ? 'text-neutral-300 hover:bg-neutral-800'
                                        : 'text-[#605a50] hover:bg-[#f3efe7]'
                                }`}
                            >
                                <span className="truncate">{generationMetaLabel}</span>
                                <ChevronDown
                                    size={13}
                                    className={`flex-shrink-0 transition-transform ${isSettingsOpen ? 'rotate-180' : ''}`}
                                />
                            </button>

                            {isSettingsOpen && (
                                <div
                                    className={`absolute bottom-full left-0 z-50 mb-3 w-[322px] rounded-[28px] border p-4 ${
                                        isDark
                                            ? 'border-neutral-700 bg-[#181818] shadow-[0_18px_40px_rgba(0,0,0,0.42)]'
                                            : 'border-[#e8e1d7] bg-[#fffdfa] shadow-[0_18px_40px_rgba(23,21,18,0.12)]'
                                    }`}
                                    onWheel={(e) => e.stopPropagation()}
                                >
                                    <div className="space-y-5">
                                        <div className={`text-base font-semibold ${isDark ? 'text-white' : 'text-[#171512]'}`}>
                                            图像设置
                                        </div>

                                        {showQualitySettings && (
                                        <div className="space-y-3">
                                            <div className={`text-sm font-medium ${isDark ? 'text-neutral-200' : 'text-[#171512]'}`}>
                                                质量
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {qualityOptions.map((option) => {
                                                    const isSelected = currentQualityLabel === option;
                                                    return (
                                                        <button
                                                            key={option}
                                                            type="button"
                                                            className={`min-w-[64px] rounded-full border px-4 py-2 text-sm transition-colors ${
                                                                isSelected
                                                                    ? (isDark
                                                                        ? 'border-white bg-white text-[#171717]'
                                                                        : 'border-[#171512] bg-white text-[#171512] shadow-[0_6px_18px_rgba(23,21,18,0.08)]')
                                                                    : (isDark
                                                                        ? 'border-neutral-700 bg-[#1f1f1f] text-neutral-300 hover:border-neutral-500'
                                                                        : 'border-[#e9e2d8] bg-white text-[#4e493f] hover:border-[#d7cec2]')
                                                            }`}
                                                        >
                                                            {option}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        )}

                                        {showResolutionSettings && (
                                        <div className="space-y-3">
                                            <div className={`text-sm font-medium ${isDark ? 'text-neutral-200' : 'text-[#171512]'}`}>
                                                分辨率
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {resolutionOptions.map((option) => {
                                                    const isSelected = currentResolution === option;
                                                    return (
                                                        <button
                                                            key={option}
                                                            type="button"
                                                            onClick={() => handleResolutionSelect(option)}
                                                            className={`min-w-[64px] rounded-full border px-4 py-2 text-sm transition-colors ${
                                                                isSelected
                                                                    ? (isDark
                                                                        ? 'border-white bg-white text-[#171717]'
                                                                        : 'border-[#171512] bg-white text-[#171512] shadow-[0_6px_18px_rgba(23,21,18,0.08)]')
                                                                    : (isDark
                                                                        ? 'border-neutral-700 bg-[#1f1f1f] text-neutral-300 hover:border-neutral-500'
                                                                        : 'border-[#e9e2d8] bg-white text-[#4e493f] hover:border-[#d7cec2]')
                                                            }`}
                                                        >
                                                            {option}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        )}

                                        {showDimensionSettings && (
                                        <div className="space-y-3">
                                            <div className={`flex items-center gap-1 text-sm font-medium ${isDark ? 'text-neutral-200' : 'text-[#171512]'}`}>
                                                <span>尺寸</span>
                                                <Info size={13} className={isDark ? 'text-neutral-500' : 'text-[#b5ada2]'} />
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className={`flex h-11 flex-1 items-center gap-2 rounded-xl px-3 ${
                                                    isDark ? 'bg-[#232323] text-white' : 'bg-[#f3f1ec] text-[#171512]'
                                                }`}>
                                                    <span className={`text-sm ${isDark ? 'text-neutral-500' : 'text-[#8f887d]'}`}>W</span>
                                                    <span className="text-sm tabular-nums">{sizeInfo?.w ?? '--'}</span>
                                                </div>
                                                <ArrowLeftRight
                                                    size={14}
                                                    className={`-rotate-90 ${isDark ? 'text-neutral-500' : 'text-[#b5ada2]'}`}
                                                />
                                                <div className={`flex h-11 flex-1 items-center gap-2 rounded-xl px-3 ${
                                                    isDark ? 'bg-[#232323] text-white' : 'bg-[#f3f1ec] text-[#171512]'
                                                }`}>
                                                    <span className={`text-sm ${isDark ? 'text-neutral-500' : 'text-[#8f887d]'}`}>H</span>
                                                    <span className="text-sm tabular-nums">{sizeInfo?.h ?? '--'}</span>
                                                </div>
                                            </div>
                                        </div>
                                        )}

                                        <div className="space-y-3">
                                            <div className={`flex items-center gap-1 text-sm font-medium ${isDark ? 'text-neutral-200' : 'text-[#171512]'}`}>
                                                <span>宽高比</span>
                                                <Info size={13} className={isDark ? 'text-neutral-500' : 'text-[#b5ada2]'} />
                                            </div>
                                            <div className="grid max-h-[152px] grid-cols-3 gap-2 overflow-y-auto pr-1">
                                                {imageAspectRatioOptions.map((option) => {
                                                    const isSelected = currentSizeLabel === option;
                                                    return (
                                                        <button
                                                            key={option}
                                                            type="button"
                                                            onClick={() => handleAspectRatioSelect(option)}
                                                            className={`flex h-[72px] flex-col items-center justify-between rounded-2xl border px-2 py-3 transition-colors ${
                                                                isSelected
                                                                    ? (isDark
                                                                        ? 'border-white bg-[#222222] text-white'
                                                                        : 'border-[#171512] bg-white text-[#171512]')
                                                                    : (isDark
                                                                        ? 'border-neutral-700 bg-[#1f1f1f] text-neutral-300 hover:border-neutral-500'
                                                                        : 'border-[#e9e2d8] bg-white text-[#6c655a] hover:border-[#d7cec2]')
                                                            }`}
                                                        >
                                                            <span className="flex h-6 items-center justify-center">
                                                                {getRatioIcon(option)}
                                                            </span>
                                                            <span className="text-sm">{RATIO_DISPLAY[option] || option}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {showOutputCountSettings && (
                                        <div className="space-y-3">
                                            <div className={`text-sm font-medium ${isDark ? 'text-neutral-200' : 'text-[#171512]'}`}>
                                                生成数量
                                            </div>
                                            <div className="grid grid-cols-4 gap-2">
                                                {countOptions.map((count) => {
                                                    const isSelected = currentBatchCount === count;
                                                    return (
                                                        <button
                                                            key={count}
                                                            type="button"
                                                            onClick={() => handleBatchCountSelect(count)}
                                                            className={`rounded-full border px-0 py-2 text-sm transition-colors ${
                                                                isSelected
                                                                    ? (isDark
                                                                        ? 'border-white bg-white text-[#171717]'
                                                                        : 'border-[#171512] bg-white text-[#171512]')
                                                                    : (isDark
                                                                        ? 'border-neutral-700 bg-[#1f1f1f] text-neutral-300 hover:border-neutral-500'
                                                                        : 'border-[#e9e2d8] bg-white text-[#4e493f] hover:border-[#d7cec2]')
                                                            }`}
                                                        >
                                                            {count} 张
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Right: Model + Generate */}
                        <div className="flex items-center gap-1.5">
                            {/* Model Selector */}
                            {isLocalModelNode ? (
                                <div className="relative" ref={modelRef}>
                                    <button
                                        onClick={() => togglePopup('model')}
                                        className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-lg transition-colors ${
                                            isDark ? 'text-neutral-300 hover:bg-neutral-800' : 'text-neutral-600 hover:bg-neutral-100'
                                        }`}
                                    >
                                        <HardDrive size={13} className="text-purple-400" />
                                        <span className="max-w-[88px] truncate">{selectedLocalModel?.name || '选择模型'}</span>
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                                    </button>

                                    {openPopup === 'model' && (
                                        <div className={`absolute bottom-full mb-2 right-0 w-56 rounded-xl shadow-2xl overflow-hidden z-50 border max-h-64 overflow-y-auto ${
                                            isDark ? 'bg-[#1e1e1e] border-neutral-700' : 'bg-white border-neutral-200'
                                        }`} onWheel={e => e.stopPropagation()}>
                                            {isLoadingLocalModels ? (
                                                <div className="px-4 py-6 text-xs text-neutral-500 text-center">模型加载中...</div>
                                            ) : localModels.length === 0 ? (
                                                <div className="px-4 py-6 text-xs text-neutral-500 text-center">
                                                    <p>未找到模型</p>
                                                    <p className="text-[10px] mt-1">请将 .safetensors 文件放入 models/ 目录</p>
                                                </div>
                                            ) : localModels.map(model => (
                                                <button
                                                    key={model.id}
                                                    onClick={() => handleLocalModelChange(model)}
                                                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-colors ${
                                                        isDark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-50'
                                                    } ${data.localModelId === model.id
                                                        ? isDark ? 'text-white' : 'text-neutral-900'
                                                        : isDark ? 'text-neutral-300' : 'text-neutral-600'
                                                    }`}
                                                >
                                                    <span className="flex items-center gap-2.5">
                                                        <HardDrive size={14} className="text-purple-400 flex-shrink-0" />
                                                        <span className="truncate">{model.name}</span>
                                                    </span>
                                                    {data.localModelId === model.id && <Check size={14} className="text-blue-500 flex-shrink-0" />}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="relative" ref={modelRef}>
                                    <button
                                        onClick={() => togglePopup('model')}
                                        className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-lg transition-colors ${
                                            isDark ? 'text-neutral-300 hover:bg-neutral-800' : 'text-neutral-600 hover:bg-neutral-100'
                                        }`}
                                    >
                                        {getModelIcon(currentImageModel, 13)}
                                        <span className="max-w-[96px] truncate">{currentImageModel.name}</span>
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                                    </button>

                                    {openPopup === 'model' && (
                                        <div className={`absolute bottom-full mb-2 right-0 w-52 rounded-xl shadow-2xl overflow-hidden z-50 border py-1 ${
                                            isDark ? 'bg-[#1e1e1e] border-neutral-700' : 'bg-white border-neutral-200'
                                        }`} onWheel={e => e.stopPropagation()}>
                                            {availableImageModels.map(model => (
                                                <button
                                                    key={model.id}
                                                    onClick={() => handleImageModelChange(model.id)}
                                                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-colors ${
                                                        isDark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-50'
                                                    } ${currentImageModel.id === model.id
                                                        ? isDark ? 'text-white' : 'text-neutral-900'
                                                        : isDark ? 'text-neutral-400' : 'text-neutral-500'
                                                    }`}
                                                >
                                                    <span className="flex items-center gap-2.5">
                                                        <span>{model.name}</span>
                                                    </span>
                                                    {currentImageModel.id === model.id && <Check size={14} className="text-neutral-400 flex-shrink-0" />}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Generate Button */}
                            {isLoading ? (
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center ${
                                    isDark ? 'bg-neutral-700' : 'bg-neutral-200'
                                }`}>
                                    <Loader2 size={14} className="animate-spin text-neutral-400" />
                                </div>
                            ) : (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onGenerate(data.id);
                                    }}
                                    disabled={isGenerateDisabled}
                                    className={`flex items-center gap-1.5 h-9 px-3.5 rounded-full text-xs font-semibold transition-all duration-200 ${
                                        isGenerateDisabled
                                            ? (isDark
                                                ? 'bg-neutral-700 text-neutral-500 cursor-not-allowed'
                                                : 'bg-neutral-200 text-neutral-400 cursor-not-allowed')
                                            : 'bg-blue-500 text-white hover:bg-blue-600 active:scale-[0.97] shadow-md shadow-blue-500/25'
                                    }`}
                                    title={generateButtonTitle}
                                >
                                    <Zap size={13} />
                                    <span className="tabular-nums">{generateCreditLabel}</span>
                                </button>
                            )}
                        </div>
                    </div>
                )}

            </div>

            {/* Hidden File Inputs */}
            <input ref={localImageInputRef} type="file" accept="image/*" multiple className="hidden"
                onChange={(e) => {
                    void handleLocalFileSelected(e.target.files);
                    e.target.value = '';
                }} />
            </div>
            {imageSourceMenu}
        </>
    );
};

export const NodeControls = memo(NodeControlsComponent);
