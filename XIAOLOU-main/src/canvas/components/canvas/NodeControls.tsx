/**
 * NodeControls.tsx
 * 
 * Lovart-style control panel for canvas nodes (Image / Local Model types).
 * Video nodes use VideoSettingsPanel instead.
 */

import React, { useState, useRef, useEffect, useMemo, memo } from 'react';
import {
    Sparkles, Banana, Check, Image as ImageIcon,
    Expand, Shrink, HardDrive, Paperclip, Layout,
    Loader2, Zap, Info
} from 'lucide-react';
import { NodeData, NodeStatus, NodeType } from '../../types';
import type { BridgeMediaModelCapability } from '../../types';
import { OpenAIIcon, GoogleIcon, KlingIcon } from '../icons/BrandIcons';
import { useFaceDetection } from '../../hooks/useFaceDetection';
import { ChangeAnglePanel } from './ChangeAnglePanel';
import { LocalModel, getLocalModels } from '../../services/localModelService';
import { uploadAsset } from '../../services/assetService';
import { resolveCanvasMediaUrl } from '../../integrations/twitcanvaRuntimePaths';
import {
    CANVAS_IMAGE_MODELS,
    normalizeCanvasImageModelId
} from '../../config/canvasImageModels';
import { useImageCapabilities } from '../../hooks/useMediaCapabilities';

interface NodeControlsProps {
    data: NodeData;
    inputUrl?: string;
    isLoading: boolean;
    isSuccess: boolean;
    connectedImageNodes?: { id: string; url: string; type?: NodeType }[];
    availableCanvasNodes?: { id: string; url: string; type?: NodeType }[];
    onUpdate: (id: string, updates: Partial<NodeData>) => void;
    onGenerate: (id: string) => void;
    onChangeAngleGenerate?: (nodeId: string) => void;
    onSelect: (id: string) => void;
    zoom: number;
    canvasTheme?: 'dark' | 'light';
    allowCameraAngle?: boolean;
}

const IMAGE_RATIOS = [
    "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"
];

type CanvasImageModelCompat = {
    id: string;
    name: string;
    provider: string;
    supportsImageToImage: boolean;
    supportsMultiImage: boolean;
    recommended?: boolean;
    resolutions: string[];
    aspectRatios: string[];
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
        aspectRatios: primaryMode?.supportedAspectRatios || [],
    };
}

const STATIC_IMAGE_MODELS = CANVAS_IMAGE_MODELS;

const RATIO_INFO: Record<string, { w: number; h: number }> = {
    '21:9': { w: 1568, h: 672 }, '16:9': { w: 1456, h: 816 }, '3:2': { w: 1344, h: 896 },
    '4:3': { w: 1232, h: 928 }, '5:4': { w: 1280, h: 1024 }, '1:1': { w: 1024, h: 1024 },
    '4:5': { w: 1024, h: 1280 }, '3:4': { w: 928, h: 1232 }, '2:3': { w: 896, h: 1344 },
    '9:16': { w: 816, h: 1456 },
    '1024x1024': { w: 1024, h: 1024 }, '1536x1024': { w: 1536, h: 1024 }, '1024x1536': { w: 1024, h: 1536 },
};

const RATIO_DISPLAY: Record<string, string> = {
    '1024x1024': '1:1', '1536x1024': '3:2', '1024x1536': '2:3',
};

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

function getClosestAspectRatio(width: number, height: number): string {
    if (!width || !height) return '1:1';

    const ratio = width / height;
    let closest = IMAGE_RATIOS[0];
    let minDiff = Infinity;

    for (const candidate of IMAGE_RATIOS) {
        const [w, h] = candidate.split(':').map(Number);
        if (!w || !h) continue;
        const diff = Math.abs(ratio - w / h);
        if (diff < minDiff) {
            minDiff = diff;
            closest = candidate;
        }
    }

    return closest;
}

function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read image file'));
        reader.readAsDataURL(file);
    });
}

function hasPngExtension(fileName: string) {
    return /\.png$/i.test(fileName.trim());
}

function shouldConvertPngToJpeg(file: File) {
    const normalizedType = String(file.type || '').toLowerCase();
    return normalizedType === 'image/png' || (!normalizedType && hasPngExtension(file.name));
}

function replaceFileExtension(fileName: string, nextExtension: string) {
    const normalizedName = fileName.trim() || 'reference';
    if (/\.[^.]+$/.test(normalizedName)) {
        return normalizedName.replace(/\.[^.]+$/, nextExtension);
    }
    return `${normalizedName}${nextExtension}`;
}

function loadImageElement(objectUrl: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Failed to decode the PNG reference image.'));
        image.src = objectUrl;
    });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('Failed to encode the reference image as JPEG.'));
                return;
            }
            resolve(blob);
        }, type, quality);
    });
}

async function prepareLocalReferenceFile(file: File) {
    if (!shouldConvertPngToJpeg(file)) {
        return { file, convertedFromPng: false };
    }

    const objectUrl = URL.createObjectURL(file);

    try {
        const image = await loadImageElement(objectUrl);
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;

        if (!width || !height) {
            throw new Error('The PNG reference image has invalid dimensions.');
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('The browser could not create a canvas for reference image conversion.');
        }

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);

        const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
        return {
            file: new File([blob], replaceFileExtension(file.name, '.jpg'), {
                type: 'image/jpeg',
                lastModified: file.lastModified,
            }),
            convertedFromPng: true,
        };
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

function mergeReferenceUrls(current: string[] | undefined, next: string[]) {
    const merged = new Set([...(current || []), ...next].filter(Boolean));
    return Array.from(merged);
}

function getImageMetadata(imageUrl: string): Promise<{ resultAspectRatio?: string; aspectRatio: string }> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const resultAspectRatio = `${img.naturalWidth}/${img.naturalHeight}`;
            resolve({
                resultAspectRatio,
                aspectRatio: getClosestAspectRatio(img.naturalWidth, img.naturalHeight),
            });
        };
        img.onerror = () => resolve({ aspectRatio: '1:1' });
        img.src = imageUrl;
    });
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

type PopupType = 'model' | 'ref' | 'resolution' | 'ratio' | null;

const NodeControlsComponent: React.FC<NodeControlsProps> = ({
    data,
    inputUrl,
    isLoading,
    isSuccess,
    connectedImageNodes = [],
    availableCanvasNodes = [],
    onUpdate,
    onGenerate,
    onChangeAngleGenerate,
    onSelect,
    zoom,
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
    const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastSentPromptRef = useRef<string | undefined>(data.prompt);
    const modelRef = useRef<HTMLDivElement>(null);
    const refRef = useRef<HTMLDivElement>(null);
    const resRef = useRef<HTMLDivElement>(null);
    const ratioRef = useRef<HTMLDivElement>(null);
    const localImageInputRef = useRef<HTMLInputElement>(null);

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

    const { detectFaces, isModelLoaded: isFaceModelLoaded } = useFaceDetection();

    useEffect(() => {
        const runFaceDetection = async () => {
            if (
                data.klingReferenceMode === 'face' &&
                data.faceDetectionStatus === 'loading' &&
                connectedImageNodes?.[0]?.url &&
                isFaceModelLoaded
            ) {
                try {
                    const faces = await detectFaces(connectedImageNodes[0].url);
                    onUpdate(data.id, {
                        detectedFaces: faces,
                        faceDetectionStatus: faces.length > 0 ? 'success' : 'error'
                    });
                } catch (err) {
                    console.error('Face detection failed:', err);
                    onUpdate(data.id, { detectedFaces: [], faceDetectionStatus: 'error' });
                }
            }
        };
        runFaceDetection();
    }, [data.klingReferenceMode, data.faceDetectionStatus, connectedImageNodes, isFaceModelLoaded, detectFaces, onUpdate, data.id]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            if (openPopup === 'model' && modelRef.current && !modelRef.current.contains(target)) setOpenPopup(null);
            if (openPopup === 'ref' && refRef.current && !refRef.current.contains(target)) setOpenPopup(null);
            if (openPopup === 'resolution' && resRef.current && !resRef.current.contains(target)) setOpenPopup(null);
            if (openPopup === 'ratio' && ratioRef.current && !ratioRef.current.contains(target)) setOpenPopup(null);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [openPopup]);

    useEffect(() => {
        if (data.prompt !== lastSentPromptRef.current) {
            setLocalPrompt(data.prompt || '');
            lastSentPromptRef.current = data.prompt;
        }
    }, [data.prompt]);

    useEffect(() => {
        return () => { if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current); };
    }, []);

    const handlePromptChange = (value: string) => {
        setLocalPrompt(value);
        lastSentPromptRef.current = value;
        if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
        updateTimeoutRef.current = setTimeout(() => { onUpdate(data.id, { prompt: value }); }, 300);
    };

    const handleSizeSelect = (value: string) => {
        onUpdate(data.id, { aspectRatio: value });
        setOpenPopup(null);
    };

    const normalizedImageModelId = normalizeCanvasImageModelId(data.imageModel);
    const currentImageModel = IMAGE_MODELS.find(m => m.id === normalizedImageModelId) || IMAGE_MODELS[0];
    const imageAspectRatioOptions = currentImageModel.aspectRatios || IMAGE_RATIOS;
    const isImageNode = data.type === NodeType.IMAGE || data.type === NodeType.LOCAL_IMAGE_MODEL;

    const extraUploadedReferenceCount = data.characterReferenceUrls?.length ?? 0;
    const uploadedPrimaryReferenceCount = data.resultUrl && extraUploadedReferenceCount > 0 ? 1 : 0;
    const inputCount = connectedImageNodes.length + extraUploadedReferenceCount + uploadedPrimaryReferenceCount;
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
            updates.aspectRatio = newModel.aspectRatios[0];
        }
        if (newModel?.resolutions && newModel.resolutions.length > 0 && data.resolution && !newModel.resolutions.includes(data.resolution)) {
            updates.resolution = newModel.resolutions[0];
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

    const handleResolutionSelect = (value: string) => {
        onUpdate(data.id, { resolution: value });
        setOpenPopup(null);
    };

    const handleCanvasSelectNode = (nodeId: string) => {
        const currentParentIds = data.parentIds || [];
        if (!currentParentIds.includes(nodeId)) {
            onUpdate(data.id, { parentIds: [...currentParentIds, nodeId] });
        }
    };

    const handleRemoveConnectedNode = (nodeId: string) => {
        const currentParentIds = data.parentIds || [];
        onUpdate(data.id, { parentIds: currentParentIds.filter(pid => pid !== nodeId) });
    };

    const handleLocalFileSelected = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        const selectedFiles = Array.from(files);

        if (selectedFiles.some((candidate) => !candidate.type.startsWith('image/'))) {
            onUpdate(data.id, {
                status: NodeStatus.ERROR,
                errorMessage: '请选择图片文件作为参考图。',
            });
            return;
        }

        onUpdate(data.id, {
            status: NodeStatus.LOADING,
            errorMessage: undefined,
        });

        try {
            const preparedFiles = await Promise.all(selectedFiles.map((candidate) => prepareLocalReferenceFile(candidate)));
            const uploadedItems = await Promise.all(
                preparedFiles.map(async ({ file: preparedFile }) => {
                    const localDataUrl = await readFileAsDataUrl(preparedFile);
                    const uploadedUrl = await uploadAsset(
                        localDataUrl,
                        'image',
                        preparedFile.name || data.prompt || 'reference-image',
                    );

                    return {
                        localDataUrl,
                        resolvedUrl: resolveCanvasMediaUrl(uploadedUrl),
                    };
                })
            );

            const hasPrimaryPreview = Boolean(data.resultUrl);
            const primaryItem = hasPrimaryPreview ? null : uploadedItems[0];
            const extraReferenceItems = hasPrimaryPreview ? uploadedItems : uploadedItems.slice(1);
            const nextCharacterReferenceUrls = mergeReferenceUrls(
                data.characterReferenceUrls,
                extraReferenceItems.map((item) => item.resolvedUrl),
            );

            const updates: Partial<NodeData> = {
                status: primaryItem ? NodeStatus.SUCCESS : data.status,
                errorMessage: undefined,
                characterReferenceUrls: nextCharacterReferenceUrls.length > 0 ? nextCharacterReferenceUrls : undefined,
            };

            if (primaryItem) {
                const metadata = await getImageMetadata(primaryItem.localDataUrl);
                updates.resultUrl = primaryItem.resolvedUrl;
                updates.resultAspectRatio = metadata.resultAspectRatio;
                updates.aspectRatio = metadata.aspectRatio;
            }

            onUpdate(data.id, updates);
        } catch (err) {
            console.error('[NodeControls] Upload failed:', err);
            onUpdate(data.id, {
                status: NodeStatus.ERROR,
                errorMessage: '本地图片上传失败，请重试。',
            });
        }
    };

    const togglePopup = (p: PopupType) => setOpenPopup(prev => prev === p ? null : p);

    const minEffectiveScale = 0.8;
    const effectiveScale = Math.max(zoom, minEffectiveScale);
    const localScale = effectiveScale / zoom;

    const isDark = canvasTheme === 'dark';
    const currentSizeLabel = data.aspectRatio || (imageAspectRatioOptions[0] || '1:1');
    const currentResolution = data.resolution || (currentImageModel.resolutions?.[0] || '2K');

    const handleAngleGenerate = () => {
        if (onChangeAngleGenerate) onChangeAngleGenerate(data.id);
    };

    // ChangeAnglePanel for angle mode
    if (allowCameraAngle && data.angleMode && data.type === NodeType.IMAGE && isSuccess && data.resultUrl) {
        return (
            <div
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

    const isFaceModeBlocked = data.imageModel === 'kling-v1-5' &&
        data.klingReferenceMode === 'face' &&
        (data.faceDetectionStatus === 'error' || data.faceDetectionStatus === 'loading');

    const currentParentIds = data.parentIds || [];
    const connectedSet = new Set(currentParentIds);

    return (
        <div
            className="relative w-full"
            style={{ transform: `scale(${localScale})`, transformOrigin: 'top center', transition: 'transform 0.1s ease-out' }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onSelect(data.id)}
        >
            {/* Main Card */}
            <div className={`rounded-2xl shadow-2xl border ${
                isDark ? 'bg-[#1a1a1a] border-neutral-800' : 'bg-white border-neutral-200'
            }`}>

                {/* Connected Node Thumbnails */}
                {connectedImageNodes.length > 0 && (
                    <div className="px-4 pt-3 pb-1 flex gap-2 overflow-x-auto rounded-t-2xl" onWheel={e => e.stopPropagation()}>
                        {connectedImageNodes.map(node => (
                            <div key={node.id} className={`relative flex-shrink-0 w-[60px] h-[60px] rounded-lg overflow-hidden border group/thumb ${
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
                                    {pickable.map(node => {
                                        const isAdded = connectedSet.has(node.id);
                                        return (
                                            <button
                                                key={node.id}
                                                onClick={() => isAdded ? handleRemoveConnectedNode(node.id) : handleCanvasSelectNode(node.id)}
                                                className={`relative flex-shrink-0 w-[60px] h-[60px] rounded-lg overflow-hidden border-2 transition-all hover:scale-105 ${
                                                    isAdded ? 'border-blue-500 ring-1 ring-blue-500/30'
                                                    : isDark ? 'border-neutral-700 hover:border-neutral-500' : 'border-neutral-200 hover:border-neutral-400'
                                                }`}
                                            >
                                                <img src={node.url} alt="" className="w-full h-full object-cover" />
                                                {isAdded && (
                                                    <div className="absolute top-0.5 right-0.5 rounded-full bg-blue-500 p-0.5">
                                                        <Check size={8} className="text-white" />
                                                    </div>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })()}

                {/* Prompt Textarea */}
                {!(data.prompt && data.prompt.startsWith('Extract panel #')) && (
                    <div className="px-4 pt-3 pb-2">
                        <textarea
                            className={`w-full bg-transparent text-sm outline-none resize-none font-light leading-relaxed ${
                                isDark ? 'text-white placeholder-neutral-600' : 'text-neutral-900 placeholder-neutral-400'
                            }`}
                            placeholder="今天我们要创作什么"
                            rows={data.isPromptExpanded ? 10 : 3}
                            value={localPrompt}
                            onChange={(e) => handlePromptChange(e.target.value)}
                            onWheel={(e) => e.stopPropagation()}
                            onBlur={() => {
                                if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
                                if (localPrompt !== data.prompt) onUpdate(data.id, { prompt: localPrompt });
                            }}
                        />
                    </div>
                )}

                {data.errorMessage && (
                    <div className="mx-4 mb-2 text-red-400 text-xs p-2 bg-red-900/20 rounded-lg border border-red-900/50">
                        {data.errorMessage}
                    </div>
                )}

                {/* Bottom Control Bar */}
                {!(data.prompt && data.prompt.startsWith('Extract panel #')) && (
                    <div className={`px-3 py-2.5 flex items-center justify-between border-t ${
                        isDark ? 'border-neutral-800' : 'border-neutral-100'
                    }`}>
                        {/* Left: Model + Ref */}
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
                                        <span className="max-w-[80px] truncate">{selectedLocalModel?.name || '选择模型'}</span>
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                                    </button>

                                    {openPopup === 'model' && (
                                        <div className={`absolute bottom-full mb-2 left-0 w-56 rounded-xl shadow-2xl overflow-hidden z-50 border max-h-64 overflow-y-auto ${
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
                                        <span className="max-w-[80px] truncate">{currentImageModel.name}</span>
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                                    </button>

                                    {/* Model Dropdown */}
                                    {openPopup === 'model' && (
                                        <div className={`absolute bottom-full mb-2 left-0 w-52 rounded-xl shadow-2xl overflow-hidden z-50 border py-1 ${
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
                                                        {getModelIcon(model, 14)}
                                                        <span>{model.name}</span>
                                                    </span>
                                                    {currentImageModel.id === model.id && <Check size={14} className="text-neutral-400 flex-shrink-0" />}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Reference Image Button */}
                            <div className="relative" ref={refRef}>
                                <button
                                    onClick={() => togglePopup('ref')}
                                    className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
                                        isDark ? 'text-neutral-400 hover:bg-neutral-800 hover:text-white' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
                                    }`}
                                    title="参考图"
                                >
                                    <ImageIcon size={15} />
                                </button>

                                {openPopup === 'ref' && (
                                    <div className={`absolute bottom-full mb-2 left-0 w-auto min-w-[200px] rounded-xl shadow-2xl z-50 border py-1.5 ${
                                        isDark ? 'bg-[#1e1e1e] border-neutral-700' : 'bg-white border-neutral-200'
                                    }`}>
                                        <button
                                            onClick={() => { localImageInputRef.current?.click(); setOpenPopup(null); }}
                                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
                                                isDark ? 'text-neutral-200 hover:bg-neutral-800' : 'text-neutral-700 hover:bg-neutral-50'
                                            }`}
                                        >
                                            <Paperclip size={15} className={isDark ? 'text-neutral-400' : 'text-neutral-500'} />
                                            从本地上传图片
                                        </button>
                                        <button
                                            onClick={() => { setOpenPopup(null); setShowCanvasPicker(true); }}
                                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
                                                isDark ? 'text-neutral-200 hover:bg-neutral-800' : 'text-neutral-700 hover:bg-neutral-50'
                                            }`}
                                        >
                                            <Layout size={15} className={isDark ? 'text-neutral-400' : 'text-neutral-500'} />
                                            从画布选择
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Right: Resolution + Ratio + Generate */}
                        <div className="flex items-center gap-1">
                            {/* Resolution Button */}
                            {currentImageModel.resolutions && currentImageModel.resolutions.length > 0 && (
                                <div className="relative" ref={resRef}>
                                    <button
                                        onClick={() => togglePopup('resolution')}
                                        className={`text-xs font-medium px-2 py-1.5 rounded-lg transition-colors ${
                                            isDark ? 'text-neutral-400 hover:bg-neutral-800 hover:text-white' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
                                        }`}
                                    >
                                        {currentResolution}
                                    </button>

                                    {openPopup === 'resolution' && (
                                        <div className={`absolute bottom-full mb-2 right-0 w-32 rounded-xl shadow-2xl z-50 border py-1 ${
                                            isDark ? 'bg-[#1e1e1e] border-neutral-700' : 'bg-white border-neutral-200'
                                        }`}>
                                            <div className={`px-4 py-2 text-xs font-medium ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                                                分辨率
                                            </div>
                                            {currentImageModel.resolutions.map(res => (
                                                <button
                                                    key={res}
                                                    onClick={() => handleResolutionSelect(res)}
                                                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-colors ${
                                                        isDark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-50'
                                                    } ${currentResolution === res
                                                        ? isDark ? 'text-white' : 'text-neutral-900'
                                                        : isDark ? 'text-neutral-400' : 'text-neutral-500'
                                                    }`}
                                                >
                                                    <span>{res}</span>
                                                    {currentResolution === res && <Check size={14} className="text-neutral-400" />}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Aspect Ratio Button */}
                            <div className="relative" ref={ratioRef}>
                                <button
                                    onClick={() => togglePopup('ratio')}
                                    className={`text-xs font-medium px-2 py-1.5 rounded-lg transition-colors ${
                                        isDark ? 'text-neutral-400 hover:bg-neutral-800 hover:text-white' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
                                    }`}
                                >
                                    {RATIO_DISPLAY[currentSizeLabel] || currentSizeLabel}
                                </button>

                                {openPopup === 'ratio' && (
                                    <div
                                        className={`absolute bottom-full mb-2 right-0 w-[220px] rounded-xl shadow-2xl z-50 border py-1 max-h-[360px] overflow-y-auto ${
                                            isDark ? 'bg-[#1e1e1e] border-neutral-700' : 'bg-white border-neutral-200'
                                        }`}
                                        onWheel={e => e.stopPropagation()}
                                    >
                                        <div className={`px-4 py-2 text-xs font-medium flex items-center gap-1.5 ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                                            格式
                                            <Info size={11} className="opacity-60" />
                                        </div>
                                        {imageAspectRatioOptions.map(option => {
                                            const info = RATIO_INFO[option];
                                            const isSelected = currentSizeLabel === option;
                                            return (
                                                <button
                                                    key={option}
                                                    onClick={() => handleSizeSelect(option)}
                                                    className={`w-full flex items-center gap-3 px-4 py-2 text-sm text-left transition-colors ${
                                                        isDark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-50'
                                                    } ${isSelected
                                                        ? isDark ? 'text-white' : 'text-neutral-900'
                                                        : isDark ? 'text-neutral-400' : 'text-neutral-500'
                                                    }`}
                                                >
                                                    <span className={`flex-shrink-0 w-5 flex items-center justify-center ${
                                                        isSelected ? (isDark ? 'text-white' : 'text-neutral-900') : (isDark ? 'text-neutral-500' : 'text-neutral-400')
                                                    }`}>
                                                        {getRatioIcon(option)}
                                                    </span>
                                                    <span className="flex-1">{RATIO_DISPLAY[option] || option}</span>
                                                    {info && (
                                                        <span className={`text-xs tabular-nums ${
                                                            isSelected ? 'text-blue-400' : isDark ? 'text-neutral-600' : 'text-neutral-300'
                                                        }`}>
                                                            {info.w}*{info.h}
                                                        </span>
                                                    )}
                                                    {isSelected && <Check size={14} className="text-neutral-400 flex-shrink-0 ml-1" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

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
                                        if (isFaceModeBlocked) return;
                                        onGenerate(data.id);
                                    }}
                                    disabled={isFaceModeBlocked}
                                    className={`flex items-center gap-1.5 h-9 px-3.5 rounded-full text-xs font-semibold transition-all duration-200 ${
                                        isFaceModeBlocked
                                            ? isDark ? 'bg-neutral-700/50 text-neutral-500 cursor-not-allowed' : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                                            : 'bg-blue-500 text-white hover:bg-blue-600 active:scale-[0.97] shadow-md shadow-blue-500/25'
                                    }`}
                                    title={isFaceModeBlocked ? '无法生成：参考图中未检测到人脸' : '生成'}
                                >
                                    <Zap size={13} />
                                    <span>14</span>
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Kling V1.5 Reference Settings */}
                {data.imageModel === 'kling-v1-5' && connectedImageNodes.length > 0 && (
                    <div className={`px-4 py-3 border-t ${isDark ? 'border-neutral-800' : 'border-neutral-100'}`}>
                        <div className={`text-[10px] uppercase tracking-wider mb-2 ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>参考设置</div>
                        <div className={`flex gap-1 mb-3 p-1 rounded-lg ${isDark ? 'bg-neutral-800/50' : 'bg-neutral-100'}`}>
                            <button
                                onClick={() => onUpdate(data.id, { klingReferenceMode: 'subject', detectedFaces: undefined, faceDetectionStatus: undefined })}
                                className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
                                    (data.klingReferenceMode || 'subject') === 'subject'
                                        ? isDark ? 'bg-neutral-700 text-white font-medium' : 'bg-white text-neutral-900 font-medium shadow-sm'
                                        : isDark ? 'text-neutral-400 hover:text-white' : 'text-neutral-500 hover:text-neutral-700'
                                }`}
                            >
                                主体参考
                            </button>
                            <button
                                onClick={() => onUpdate(data.id, { klingReferenceMode: 'face', faceDetectionStatus: 'loading', detectedFaces: undefined })}
                                className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
                                    data.klingReferenceMode === 'face'
                                        ? isDark ? 'bg-neutral-700 text-white font-medium' : 'bg-white text-neutral-900 font-medium shadow-sm'
                                        : isDark ? 'text-neutral-400 hover:text-white' : 'text-neutral-500 hover:text-neutral-700'
                                }`}
                            >
                                人脸参考
                            </button>
                        </div>

                        {connectedImageNodes[0]?.url && (
                            <div className="mb-3">
                                <div className="rounded-lg overflow-hidden bg-black relative flex items-center justify-center" style={{ maxHeight: '200px' }}>
                                    <div className="relative">
                                        <img src={connectedImageNodes[0].url} alt="参考图" className="max-h-[200px] w-auto h-auto block object-contain" />
                                        {data.klingReferenceMode === 'face' && data.faceDetectionStatus === 'success' && data.detectedFaces && data.detectedFaces.length > 0 && (
                                            <>
                                                {data.detectedFaces.map((face, idx) => (
                                                    <div key={idx} className="absolute pointer-events-none" style={{ left: `${face.x}%`, top: `${face.y}%`, width: `${face.width}%`, height: `${face.height}%` }}>
                                                        <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-green-400 rounded-tl-xl" style={{ filter: 'drop-shadow(0 0 4px rgba(74, 222, 128, 0.8))' }} />
                                                        <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-green-400 rounded-tr-xl" style={{ filter: 'drop-shadow(0 0 4px rgba(74, 222, 128, 0.8))' }} />
                                                        <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-green-400 rounded-bl-xl" style={{ filter: 'drop-shadow(0 0 4px rgba(74, 222, 128, 0.8))' }} />
                                                        <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-green-400 rounded-br-xl" style={{ filter: 'drop-shadow(0 0 4px rgba(74, 222, 128, 0.8))' }} />
                                                    </div>
                                                ))}
                                            </>
                                        )}
                                        {data.klingReferenceMode === 'face' && data.faceDetectionStatus === 'loading' && (
                                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                                <div className="text-xs text-white">人脸检测中...</div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {data.klingReferenceMode === 'face' && data.faceDetectionStatus === 'success' && data.detectedFaces && data.detectedFaces.length > 0 && (
                                    <div className="flex justify-center mt-3">
                                        <div className="w-14 h-14 rounded-lg border-2 border-green-400 overflow-hidden bg-black">
                                            <img
                                                src={connectedImageNodes[0].url}
                                                alt="检测到的人脸"
                                                className="w-full h-full object-cover"
                                                style={{
                                                    objectPosition: `${data.detectedFaces[0].x + data.detectedFaces[0].width / 2}% ${data.detectedFaces[0].y + data.detectedFaces[0].height / 2}%`,
                                                    transform: `scale(${100 / Math.max(data.detectedFaces[0].width, data.detectedFaces[0].height) * 0.8})`
                                                }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {data.klingReferenceMode === 'face' && data.faceDetectionStatus === 'error' && (
                            <div className="mb-3 p-2 bg-amber-900/20 border border-amber-700/50 rounded-lg">
                                <div className="flex items-start gap-2 text-amber-400 text-xs">
                                    <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                    <span>未检测到人脸，请使用面部更清晰的参考图片。</span>
                                </div>
                            </div>
                        )}

                        {(data.klingReferenceMode || 'subject') === 'subject' && (
                            <>
                                <div className="space-y-1 mb-3">
                                    <div className="flex justify-between text-[10px]">
                                        <span className={isDark ? 'text-neutral-400' : 'text-neutral-500'}>人脸参考强度</span>
                                        <span className={isDark ? 'text-white' : 'text-neutral-900'}>{data.klingFaceIntensity ?? 65}</span>
                                    </div>
                                    <input type="range" min="0" max="100" value={data.klingFaceIntensity ?? 65}
                                        onChange={(e) => onUpdate(data.id, { klingFaceIntensity: parseInt(e.target.value) })}
                                        className="w-full h-1.5 bg-neutral-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer" />
                                </div>
                                <div className="space-y-1">
                                    <div className="flex justify-between text-[10px]">
                                        <span className={isDark ? 'text-neutral-400' : 'text-neutral-500'}>主体参考强度</span>
                                        <span className={isDark ? 'text-white' : 'text-neutral-900'}>{data.klingSubjectIntensity ?? 50}</span>
                                    </div>
                                    <input type="range" min="0" max="100" value={data.klingSubjectIntensity ?? 50}
                                        onChange={(e) => onUpdate(data.id, { klingSubjectIntensity: parseInt(e.target.value) })}
                                        className="w-full h-1.5 bg-neutral-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer" />
                                </div>
                            </>
                        )}

                        {data.klingReferenceMode === 'face' && data.faceDetectionStatus === 'success' && (
                            <div className="space-y-1">
                                <div className="flex justify-between text-[10px]">
                                    <span className={isDark ? 'text-neutral-400' : 'text-neutral-500'}>参考强度</span>
                                    <span className={isDark ? 'text-white' : 'text-neutral-900'}>{data.klingFaceIntensity ?? 42}</span>
                                </div>
                                <input type="range" min="0" max="100" value={data.klingFaceIntensity ?? 42}
                                    onChange={(e) => onUpdate(data.id, { klingFaceIntensity: parseInt(e.target.value) })}
                                    className="w-full h-1.5 bg-neutral-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer" />
                            </div>
                        )}
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
    );
};

export const NodeControls = memo(NodeControlsComponent);
