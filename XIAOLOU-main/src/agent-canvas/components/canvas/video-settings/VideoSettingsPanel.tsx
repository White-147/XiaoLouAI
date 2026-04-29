import React, { memo, useState, useRef, useEffect, useMemo } from 'react';
import {
    Upload, ChevronDown, ChevronUp, Check, Zap, Loader2,
    Film, Image as ImageIcon, AudioLines, Video, X, Play,
    Paperclip, Layout, PenLine, Mic, Users, AlertCircle,
    Maximize2, Minimize2, SlidersHorizontal,
} from 'lucide-react';
import { NodeData, NodeType } from '../../../types';
import { useVideoSettings, ReferenceType, type VideoMaterialTabId } from './useVideoSettings';
import { AssetLibraryModal } from './AssetLibraryModal';
import { GoogleIcon, KlingIcon, HailuoIcon } from '../../icons/BrandIcons';
import { buildCanvasApiUrl, resolveCanvasMediaUrl } from '../../../integrations/twitcanvaRuntimePaths';
import { useFloatingPanelOffset } from '../../../hooks/useFloatingPanelOffset';
import { ReferencePromptInput, type PromptImageReference } from '../ReferencePromptInput';

export interface VideoSettingsPanelProps {
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
    onAttachAsset?: (targetNodeId: string, url: string, type: 'image' | 'video' | 'audio') => void;
    /** Frame-slot specific handlers (first-last-frame mode) */
    onSetFrameSlot?: (targetNodeId: string, url: string, slot: 'start' | 'end') => void;
    onClearFrameSlot?: (targetNodeId: string, slot: 'start' | 'end') => void;
    onSetCanvasNodeAsFrameSlot?: (targetNodeId: string, canvasNodeId: string, slot: 'start' | 'end') => void;
    onSelect: (id: string) => void;
    zoom: number;
    canvasTheme?: 'dark' | 'light';
}

type MaterialTab = VideoMaterialTabId;
type PopupType = 'refType' | 'settings' | 'model' | 'cameraShot' | null;

const CAMERA_SHOTS = [
    '环绕主体运镜', '固定镜头',
    '手持镜头', '拉远缩放', '推进',
    '跟随拍摄', '向右摇摄', '向左摇摄',
    '向上摇摄', '向下摇摄', '环绕拍摄',
];

function SeedanceIcon({ size = 16, className }: { size?: number; className?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className}>
            <rect x="2" y="8" width="3" height="6" rx="1" />
            <rect x="6.5" y="4" width="3" height="10" rx="1" />
            <rect x="11" y="1" width="3" height="13" rx="1" />
        </svg>
    );
}

function getModelIcon(provider: string, size = 16) {
    switch (provider) {
        case 'google':
        case 'google-vertex':
            return <GoogleIcon size={size} />;
        case 'kling': return <KlingIcon size={size} />;
        case 'hailuo': return <HailuoIcon size={size} />;
        case 'bytedance': return <SeedanceIcon size={size} />;
        default: return <Film size={size} />;
    }
}

function getReferenceTypeIcon(type: ReferenceType, size = 14) {
    switch (type) {
        case 'video-edit': return <PenLine size={size} />;
        case 'first-last-frame': return <Layout size={size} />;
        case 'multi-reference': return <ImageIcon size={size} />;
        case 'motion-control': return <SlidersHorizontal size={size} />;
        default: return <ImageIcon size={size} />;
    }
}

function getMaterialTabIcon(type: MaterialTab, size = 18) {
    if (type === 'video') return <Film size={size} />;
    if (type === 'audio') return <AudioLines size={size} />;
    return <ImageIcon size={size} />;
}

function getNodeMediaLabel(type: 'video' | 'image' | 'audio') {
    if (type === 'video') return '视频';
    if (type === 'audio') return '音频';
    return '图片';
}

const VideoSettingsPanelComponent: React.FC<VideoSettingsPanelProps> = ({
    data,
    inputUrl,
    isLoading,
    connectedImageNodes = [],
    availableCanvasNodes = [],
    onUpdate,
    onGenerate,
    canGenerate = true,
    generateDisabledReason,
    onAttachAsset,
    onSetFrameSlot,
    onClearFrameSlot,
    onSetCanvasNodeAsFrameSlot,
    onSelect,
    zoom,
    canvasTheme = 'dark',
}) => {
    const isDark = canvasTheme === 'dark';
    const settings = useVideoSettings({ data, inputUrl, connectedImageNodes, onUpdate });

    const isFirstLastFrame = settings.referenceType === 'first-last-frame';
    const visibleTabs = isFirstLastFrame ? [] : settings.visibleMaterialTabs;

    const [activeTab, setActiveTab] = useState<MaterialTab>(visibleTabs[0]?.id ?? 'image');
    const [openPopup, setOpenPopup] = useState<PopupType>(null);
    const [openTabDropdown, setOpenTabDropdown] = useState<MaterialTab | null>(null);
    const [showAssetLibrary, setShowAssetLibrary] = useState(false);
    const [selectedCameraShot, setSelectedCameraShot] = useState<string | null>(null);
    const [showCanvasPicker, setShowCanvasPicker] = useState(false);
    const [canvasPickerType, setCanvasPickerType] = useState<'video' | 'image' | 'audio'>('image');
    const [isPanelExpanded, setIsPanelExpanded] = useState(false);

    // Frame-slot state (first-last-frame mode)
    const [frameSlotForLibrary, setFrameSlotForLibrary] = useState<'start' | 'end' | null>(null);
    const [frameSlotForCanvasPicker, setFrameSlotForCanvasPicker] = useState<'start' | 'end' | null>(null);
    const [frameSlotUploading, setFrameSlotUploading] = useState<'start' | 'end' | null>(null);

    const refTypeRef = useRef<HTMLDivElement>(null);       // dropdown
    const refTypeButtonRef = useRef<HTMLDivElement>(null); // trigger button
    const settingsRef = useRef<HTMLDivElement>(null);
    const modelRef = useRef<HTMLDivElement>(null);
    const cameraShotRef = useRef<HTMLDivElement>(null);
    const tabAreaRef = useRef<HTMLDivElement>(null);
    const localVideoInputRef = useRef<HTMLInputElement>(null);
    const localImageInputRef = useRef<HTMLInputElement>(null);
    const localAudioInputRef = useRef<HTMLInputElement>(null);
    // Dedicated single-file inputs for frame slots
    const startFrameInputRef = useRef<HTMLInputElement>(null);
    const endFrameInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!isFirstLastFrame) {
            setActiveTab((current) => (
                visibleTabs.some((tab) => tab.id === current) ? current : visibleTabs[0]?.id ?? 'image'
            ));
        }
        setOpenTabDropdown(null);
    }, [isFirstLastFrame, settings.referenceType, visibleTabs]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;

            if (openPopup !== null) {
                // For refType, check both the dropdown div AND the trigger button
                if (openPopup === 'refType') {
                    const insideDropdown = refTypeRef.current?.contains(target) ?? false;
                    const insideButton = refTypeButtonRef.current?.contains(target) ?? false;
                    if (!insideDropdown && !insideButton) {
                        setOpenPopup(null);
                    }
                } else {
                    const refs: Record<string, React.RefObject<HTMLDivElement | null>> = { settings: settingsRef, model: modelRef, cameraShot: cameraShotRef };
                    const activeRef = refs[openPopup];
                    if (activeRef?.current && !activeRef.current.contains(target)) {
                        setOpenPopup(null);
                    }
                }
            }

            if (openTabDropdown !== null && tabAreaRef.current && !tabAreaRef.current.contains(target)) {
                setOpenTabDropdown(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [openPopup, openTabDropdown]);

    const togglePopup = (type: PopupType) => {
        setOpenTabDropdown(null);
        setOpenPopup(prev => prev === type ? null : type);
    };

    const handleTabClick = (tabId: MaterialTab) => {
        setOpenPopup(null);
        if (activeTab === tabId && openTabDropdown === tabId) {
            setOpenTabDropdown(null);
        } else {
            setActiveTab(tabId);
            setOpenTabDropdown(tabId);
        }
    };

    const handleUploadClick = () => {
        setOpenPopup(null);
        setOpenTabDropdown(null);
        setShowAssetLibrary(true);
    };

    const handleLocalUploadClick = (type: 'video' | 'image' | 'audio') => {
        setOpenTabDropdown(null);
        if (type === 'video') localVideoInputRef.current?.click();
        else if (type === 'audio') localAudioInputRef.current?.click();
        else localImageInputRef.current?.click();
    };

    const handleLocalFileSelected = async (files: FileList | null, category: string) => {
        if (!files || files.length === 0) return;
        for (const file of Array.from(files)) {
            try {
                const reader = new FileReader();
                const base64 = await new Promise<string>((resolve, reject) => {
                    reader.onload = () => resolve((reader.result as string).split(',')[1]);
                    reader.onerror = () => reject(new Error('Read failed'));
                    reader.readAsDataURL(file);
                });
                const ext = file.name.split('.').pop()?.toLowerCase() || '';
                const isVideo = ['mp4', 'mov', 'webm', 'avi'].includes(ext);
                const isAudio = ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'].includes(ext);
                const mediaType = isVideo ? 'video' : isAudio ? 'audio' : 'image';

                const response = await fetch(buildCanvasApiUrl('/library'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: file.name,
                        category,
                        sourceUrl: `data:${file.type};base64,${base64}`,
                        meta: { type: mediaType },
                    }),
                });

                if (!response.ok) {
                    throw new Error(`Upload failed: ${response.status}`);
                }

                const created = await response.json();
                const createdAsset = (created && typeof created === 'object' && created.asset) ? created.asset : created;
                const assetUrl = resolveCanvasMediaUrl(String(createdAsset?.url || ''));
                if (assetUrl) {
                    onAttachAsset?.(data.id, assetUrl, mediaType);
                }
            } catch (err) {
                console.error('[VideoSettings] Upload failed:', err);
            }
        }
    };

    // Frame slot upload accepts a single image.
    const handleFrameSlotFileSelected = async (files: FileList | null, slot: 'start' | 'end') => {
        if (!files || files.length === 0) return;
        const file = files[0]; // Only ever use the first file
        if (files.length > 1) {
            console.warn(`[VideoSettings] Frame slot ${slot}: only 1 image accepted; using first file.`);
        }
        if (!file.type.startsWith('image/')) {
            alert('首尾帧只支持图片格式（JPG、PNG、WEBP 等），请重新选择。');
            return;
        }
        setFrameSlotUploading(slot);
        try {
            const reader = new FileReader();
            const base64 = await new Promise<string>((resolve, reject) => {
                reader.onload = () => resolve((reader.result as string).split(',')[1]);
                reader.onerror = () => reject(new Error('Read failed'));
                reader.readAsDataURL(file);
            });
            const response = await fetch(buildCanvasApiUrl('/library'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: file.name,
                    category: slot === 'start' ? 'FirstFrame' : 'LastFrame',
                    sourceUrl: `data:${file.type};base64,${base64}`,
                    meta: { type: 'image' },
                }),
            });
            if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
            const created = await response.json();
            const createdAsset = (created && typeof created === 'object' && created.asset) ? created.asset : created;
            const assetUrl = resolveCanvasMediaUrl(String(createdAsset?.url || ''));
            if (assetUrl) {
                onSetFrameSlot?.(data.id, assetUrl, slot);
            }
        } catch (err) {
            console.error(`[VideoSettings] Frame slot ${slot} upload failed:`, err);
        } finally {
            setFrameSlotUploading(null);
        }
    };

    const handleOpenLibraryFromDropdown = () => {
        setOpenTabDropdown(null);
        setShowAssetLibrary(true);
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

    const handleCanvasSelectClick = (type: 'video' | 'image' | 'audio') => {
        setOpenTabDropdown(null);
        setCanvasPickerType(type);
        setShowCanvasPicker(true);
    };

    // Render the settings panel at screen-1x across the canvas zoom range. The
    // outer canvas layer already applies `scale(zoom)`, so `scale(1/zoom)`
    // cancels it and keeps the prompt area readable even at 0.1x zoom.
    const safeZoom = Math.max(zoom, 0.1);
    const localScale = 1 / safeZoom;
    const { ref: panelRef, transform: floatingPanelTransform } = useFloatingPanelOffset({
        localScale,
        deps: [
            data.id,
            data.status,
            openPopup,
            openTabDropdown,
            showAssetLibrary,
            showCanvasPicker,
            frameSlotForLibrary,
            frameSlotForCanvasPicker,
            frameSlotUploading,
            connectedImageNodes.length,
            availableCanvasNodes.length,
            settings.referenceType,
            activeTab,
            isLoading,
            canGenerate,
            isPanelExpanded,
        ],
    });

    const currentRefType =
        settings.availableReferenceTypeOptions.find(r => r.id === settings.referenceType) ||
        settings.availableReferenceTypeOptions[0] ||
        { id: 'reference' as ReferenceType, label: '参考图/视频' };

    // Compute frame slot states
    const startFrame = settings.frameInputsWithUrls.find(f => f.order === 'start');
    const endFrame = settings.frameInputsWithUrls.find(f => f.order === 'end');
    const bothFramesFilled = !!startFrame && !!endFrame;
    const isFrameSlotMissing = isFirstLastFrame && !bothFramesFilled;
    const generateDisabled = isLoading || isFrameSlotMissing || !canGenerate;
    const promptReferenceOptions = useMemo<PromptImageReference[]>(
        () => connectedImageNodes.filter((node) => node.type !== NodeType.AUDIO).map((node, index) => ({
            id: node.id,
            url: node.url,
            label: `参考图${index + 1}`,
        })),
        [connectedImageNodes],
    );

    // Frame slots UI.
    const renderFrameSlot = (slot: 'start' | 'end', frameData: typeof startFrame) => {
        const label = slot === 'start' ? '首帧' : '尾帧';
        const hasFrame = !!frameData;
        const isUploading = frameSlotUploading === slot;
        const inputRef = slot === 'start' ? startFrameInputRef : endFrameInputRef;

        return (
            <div
                key={slot}
                className={`flex-1 rounded-xl border overflow-hidden ${
                    isDark ? 'border-neutral-700 bg-neutral-900' : 'border-neutral-200 bg-neutral-50'
                }`}
            >
                {/* Slot header */}
                <div className={`flex items-center justify-between px-2.5 py-1.5 border-b text-xs font-medium ${
                    isDark ? 'border-neutral-700 text-neutral-300' : 'border-neutral-200 text-neutral-700'
                }`}>
                    <span className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${hasFrame ? 'bg-green-500' : 'bg-amber-500'}`} />
                        {label}
                        {!hasFrame && (
                            <span className={`text-[10px] ${isDark ? 'text-neutral-600' : 'text-neutral-400'}`}>（必填）</span>
                        )}
                    </span>
                    {hasFrame && (
                        <button
                            onClick={() => onClearFrameSlot?.(data.id, slot)}
                            title={`移除${label}`}
                            className={`rounded p-0.5 transition-colors ${isDark ? 'text-neutral-500 hover:text-red-400 hover:bg-neutral-800' : 'text-neutral-400 hover:text-red-500 hover:bg-neutral-100'}`}
                        >
                            <X size={12} />
                        </button>
                    )}
                </div>

                {/* Slot content */}
                {hasFrame ? (
                    <div className="relative" style={{ aspectRatio: '4/3' }}>
                        <img
                            src={frameData.url}
                            alt={label}
                            className="w-full h-full object-cover"
                        />
                        {/* Replace actions overlay */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/60 opacity-0 hover:opacity-100 transition-opacity">
                            <button
                                onClick={() => inputRef.current?.click()}
                                className="rounded-lg bg-white/20 hover:bg-white/35 text-white text-[10px] px-2.5 py-1 transition-colors backdrop-blur-sm flex items-center gap-1"
                            >
                                <Upload size={10} />
                                替换图片
                            </button>
                            <button
                                onClick={() => setFrameSlotForLibrary(slot)}
                                className="rounded-lg bg-white/20 hover:bg-white/35 text-white text-[10px] px-2.5 py-1 transition-colors backdrop-blur-sm flex items-center gap-1"
                            >
                                <Users size={10} />
                                从素材库
                            </button>
                            <button
                                onClick={() => setFrameSlotForCanvasPicker(slot)}
                                className="rounded-lg bg-white/20 hover:bg-white/35 text-white text-[10px] px-2.5 py-1 transition-colors backdrop-blur-sm flex items-center gap-1"
                            >
                                <Layout size={10} />
                                从画布
                            </button>
                        </div>
                    </div>
                ) : (
                    <div
                        className="flex flex-col items-center justify-center gap-2 py-5 px-3"
                        style={{ minHeight: '110px' }}
                    >
                        {isUploading ? (
                            <Loader2 size={16} className={`animate-spin ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`} />
                        ) : (
                            <>
                                <button
                                    onClick={() => inputRef.current?.click()}
                                    className={`flex items-center gap-1.5 text-[11px] w-full justify-center px-3 py-1.5 rounded-lg border transition-colors ${
                                        isDark
                                            ? 'border-neutral-700 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                                            : 'border-neutral-300 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
                                    }`}
                                >
                                    <Upload size={11} />
                                    上传图片
                                </button>
                                <button
                                    onClick={() => setFrameSlotForLibrary(slot)}
                                    className={`flex items-center gap-1.5 text-[11px] w-full justify-center px-3 py-1.5 rounded-lg border transition-colors ${
                                        isDark
                                            ? 'border-neutral-700 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                                            : 'border-neutral-300 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
                                    }`}
                                >
                                    <Users size={11} />
                                    从素材库
                                </button>
                                <button
                                    onClick={() => setFrameSlotForCanvasPicker(slot)}
                                    className={`flex items-center gap-1.5 text-[11px] w-full justify-center px-3 py-1.5 rounded-lg border transition-colors ${
                                        isDark
                                            ? 'border-neutral-700 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                                            : 'border-neutral-300 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
                                    }`}
                                >
                                    <Layout size={11} />
                                    从画布
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>
        );
    };

    const renderTabDropdown = () => {
        if (!openTabDropdown) return null;

        const dropdownClasses = `absolute bottom-full mb-1.5 left-0 rounded-xl shadow-2xl z-50 py-1.5 border ${
            isDark ? 'bg-[#1e1e1e] border-neutral-700' : 'bg-white border-neutral-200'
        }`;
        const itemClasses = `w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
            isDark ? 'text-neutral-200 hover:bg-neutral-800' : 'text-neutral-700 hover:bg-neutral-50'
        }`;
        const itemStartClasses = `w-full flex items-start gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
            isDark ? 'text-neutral-200 hover:bg-neutral-800' : 'text-neutral-700 hover:bg-neutral-50'
        }`;
        const iconClasses = isDark ? 'text-neutral-400' : 'text-neutral-500';
        const subtitleClasses = `text-[11px] mt-0.5 leading-snug whitespace-nowrap ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`;

        if (openTabDropdown === 'audio') {
            return (
                <div className={`${dropdownClasses} w-auto min-w-[240px]`}>
                    <button onClick={() => handleLocalUploadClick('audio')} className={itemClasses}>
                        <Mic size={15} className={iconClasses} />
                        上传音频
                    </button>
                    <button onClick={handleOpenLibraryFromDropdown} className={itemStartClasses}>
                        <Users size={15} className={`mt-0.5 flex-shrink-0 ${iconClasses}`} />
                        <div>
                            <div>从素材库选择</div>
                            <div className={subtitleClasses}>
                                角色素材需通过素材库审核后方可使用
                            </div>
                        </div>
                    </button>
                    <button onClick={() => handleCanvasSelectClick('audio')} className={itemClasses}>
                        <Layout size={15} className={iconClasses} />
                        从画布选择
                    </button>
                </div>
            );
        }

        const isVideoTab = openTabDropdown === 'video';
        const uploadLabel = isVideoTab ? '从本地上传视频' : '从本地上传图片';
        const uploadType = isVideoTab ? 'video' as const : 'image' as const;

        return (
            <div className={`${dropdownClasses} w-auto min-w-[240px]`}>
                <button onClick={() => handleLocalUploadClick(uploadType)} className={itemClasses}>
                    <Paperclip size={15} className={iconClasses} />
                    <span className="whitespace-nowrap">{uploadLabel}</span>
                </button>
                <button onClick={handleOpenLibraryFromDropdown} className={itemStartClasses}>
                    <Users size={15} className={`mt-0.5 flex-shrink-0 ${iconClasses}`} />
                    <div>
                        <div>从素材库选择</div>
                        <div className={subtitleClasses}>
                            角色素材需通过素材库审核后方可使用
                        </div>
                    </div>
                </button>
                <button onClick={() => handleCanvasSelectClick(uploadType)} className={itemClasses}>
                    <Layout size={15} className={iconClasses} />
                    从画布选择
                </button>
            </div>
        );
    };

    return (
        <div
            ref={panelRef}
            data-node-panel="video-controls"
            data-node-owner-id={data.id}
            className="relative w-full"
            style={{
                width: isPanelExpanded ? 'min(920px, calc(100vw - 176px))' : '100%',
                transform: floatingPanelTransform,
                transformOrigin: 'top center',
                transition: 'width 0.18s ease, transform 0.1s ease-out',
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onSelect(data.id)}
        >
            {/* Floating video settings popover. */}
            {openPopup === 'settings' && (
                <div
                    ref={settingsRef}
                    className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 z-50"
                >
                    <div className={`w-[430px] rounded-2xl shadow-2xl p-5 border ${
                        isDark ? 'bg-[#1a1a1a] border-neutral-700' : 'bg-white border-neutral-200'
                    }`}>
                        <h3 className={`text-sm font-medium mb-4 ${isDark ? 'text-neutral-200' : 'text-neutral-700'}`}>
                            Generate method
                        </h3>
                        {settings.availableReferenceTypeOptions.length > 1 && (
                            <div className={`mb-5 grid gap-1 rounded-xl p-1 ${
                                isDark ? 'bg-neutral-900' : 'bg-neutral-100'
                            }`} style={{ gridTemplateColumns: `repeat(${settings.availableReferenceTypeOptions.length}, minmax(0, 1fr))` }}>
                                {settings.availableReferenceTypeOptions.map((type) => (
                                    <button
                                        key={type.id}
                                        type="button"
                                        onClick={() => settings.handleReferenceTypeChange(type.id)}
                                        className={`h-9 rounded-lg px-2 text-sm transition-colors whitespace-nowrap ${
                                            settings.referenceType === type.id
                                                ? isDark
                                                    ? 'bg-neutral-700 text-white'
                                                    : 'bg-white text-neutral-900 shadow-sm'
                                                : isDark
                                                    ? 'text-neutral-400 hover:text-neutral-200'
                                                    : 'text-neutral-500 hover:text-neutral-800'
                                        }`}
                                    >
                                        {type.label}
                                    </button>
                                ))}
                            </div>
                        )}
                        <div className="space-y-5">
                            {settings.availableAspectRatios.length > 0 && (
                                <div>
                                    <div className={`mb-2 text-sm ${isDark ? 'text-neutral-300' : 'text-neutral-600'}`}>Size</div>
                                    <div className="grid grid-cols-3 gap-3">
                                        {settings.availableAspectRatios.map((ratio) => (
                                            <button
                                                key={ratio}
                                                type="button"
                                                onClick={() => settings.handleAspectRatioChange(ratio)}
                                                className={`h-14 rounded-xl border text-sm transition-colors ${
                                                    settings.currentAspectRatio === ratio
                                                        ? isDark ? 'border-neutral-500 bg-neutral-700 text-white' : 'border-neutral-300 bg-neutral-200 text-neutral-900'
                                                        : isDark ? 'border-neutral-700 text-neutral-300 hover:bg-neutral-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                                                }`}
                                            >
                                                {ratio}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {settings.availableResolutions.length > 0 && (
                                <div>
                                    <div className={`mb-2 text-sm ${isDark ? 'text-neutral-300' : 'text-neutral-600'}`}>Resolution</div>
                                    <div className="grid grid-cols-3 gap-3">
                                        {settings.availableResolutions.map((resolution) => (
                                            <button
                                                key={resolution}
                                                type="button"
                                                onClick={() => settings.handleResolutionChange(resolution)}
                                                className={`h-12 rounded-xl border text-sm transition-colors ${
                                                    settings.currentResolution === resolution
                                                        ? isDark ? 'border-neutral-500 bg-neutral-700 text-white' : 'border-neutral-300 bg-neutral-200 text-neutral-900'
                                                        : isDark ? 'border-neutral-700 text-neutral-300 hover:bg-neutral-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                                                }`}
                                            >
                                                {resolution}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {settings.availableDurations.length > 0 && (
                                <div>
                                    <div className={`mb-2 text-sm ${isDark ? 'text-neutral-300' : 'text-neutral-600'}`}>Duration</div>
                                    <div className="grid grid-cols-4 gap-3">
                                        {settings.availableDurations.map((duration) => (
                                            <button
                                                key={duration}
                                                type="button"
                                                onClick={() => settings.handleDurationChange(duration)}
                                                className={`h-12 rounded-xl border text-sm transition-colors ${
                                                    settings.currentDuration === duration
                                                        ? isDark ? 'border-neutral-500 bg-neutral-700 text-white' : 'border-neutral-300 bg-neutral-200 text-neutral-900'
                                                        : isDark ? 'border-neutral-700 text-neutral-300 hover:bg-neutral-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                                                }`}
                                            >
                                                {duration}s
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {settings.qualityModeOptions.length > 0 && (
                                <div>
                                    <div className={`mb-2 text-sm ${isDark ? 'text-neutral-300' : 'text-neutral-600'}`}>Mode</div>
                                    <div className="grid grid-cols-2 gap-3">
                                        {settings.qualityModeOptions.map((mode) => (
                                            <button
                                                key={mode}
                                                type="button"
                                                onClick={() => settings.handleQualityModeChange(mode)}
                                                className={`h-11 rounded-xl border text-sm transition-colors ${
                                                    settings.currentQualityMode === mode
                                                        ? isDark ? 'border-neutral-500 bg-neutral-700 text-white' : 'border-neutral-300 bg-neutral-200 text-neutral-900'
                                                        : isDark ? 'border-neutral-700 text-neutral-300 hover:bg-neutral-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                                                }`}
                                            >
                                                {mode}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {settings.referenceType === 'video-edit' && settings.editModeOptions.length > 0 && (
                                <div>
                                    <div className={`mb-2 text-sm ${isDark ? 'text-neutral-300' : 'text-neutral-600'}`}>Edit mode</div>
                                    <div className="grid grid-cols-2 gap-3">
                                        {settings.editModeOptions.map((mode) => (
                                            <button
                                                key={mode}
                                                type="button"
                                                onClick={() => settings.handleEditModeChange(mode)}
                                                className={`h-11 rounded-xl border text-sm transition-colors ${
                                                    settings.currentEditMode === mode
                                                        ? isDark ? 'border-neutral-500 bg-neutral-700 text-white' : 'border-neutral-300 bg-neutral-200 text-neutral-900'
                                                        : isDark ? 'border-neutral-700 text-neutral-300 hover:bg-neutral-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                                                }`}
                                            >
                                                {mode}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {settings.supportsAudioOutput && (
                                <div className="flex items-center justify-between">
                                    <span className={`text-sm ${isDark ? 'text-neutral-300' : 'text-neutral-600'}`}>音频</span>
                                    <button
                                        type="button"
                                        onClick={settings.handleAudioToggle}
                                        className={`relative h-7 w-12 rounded-full transition-colors ${
                                            data.generateAudio !== false
                                                ? 'bg-neutral-900'
                                                : isDark ? 'bg-neutral-700' : 'bg-neutral-200'
                                        }`}
                                    >
                                        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${
                                            data.generateAudio !== false ? 'translate-x-5' : 'translate-x-1'
                                        }`} />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Asset library modal. */}
            {showAssetLibrary && (
                <AssetLibraryModal
                    onClose={() => setShowAssetLibrary(false)}
                    onSelectAsset={(url, type) => {
                        onAttachAsset?.(data.id, url, type);
                        setShowAssetLibrary(false);
                    }}
                    isDark={isDark}
                />
            )}
            {frameSlotForLibrary !== null && (
                <AssetLibraryModal
                    onClose={() => setFrameSlotForLibrary(null)}
                    onSelectAsset={(url) => {
                        onSetFrameSlot?.(data.id, url, frameSlotForLibrary);
                        setFrameSlotForLibrary(null);
                    }}
                    isDark={isDark}
                    frameSlot={frameSlotForLibrary}
                />
            )}

            {/* Main card */}
            <div className={`relative rounded-[28px] shadow-2xl cursor-default transition-colors duration-200 overflow-visible ${
                isDark
                    ? 'bg-[#1a1a1a] border border-neutral-800'
                    : 'bg-white border border-neutral-200'
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
                {/* Notice + Upload Row (hidden in first-last-frame mode) */}
                {!isFirstLastFrame && (
                    <div className={`mx-3 mt-3 h-[52px] rounded-2xl px-4 pr-3 flex items-center justify-between gap-3 ${
                        isDark ? 'bg-neutral-900/80' : 'bg-neutral-100/80'
                    }`}>
                        <span className={`text-sm whitespace-nowrap ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                            角色素材需通过素材库审核后方可使用
                        </span>
                        <button
                            onClick={handleUploadClick}
                            className={`flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl transition-colors flex-shrink-0 border ${
                                isDark
                                    ? 'text-neutral-300 hover:bg-neutral-800 border-neutral-700'
                                    : 'text-neutral-800 bg-white hover:bg-neutral-50 border-neutral-200'
                            }`}
                        >
                            <Upload size={13} strokeWidth={2} />
                            上传
                        </button>
                    </div>
                )}

                {/* First-last-frame slots */}
                {isFirstLastFrame ? (
                    <div className="px-4 pt-3.5 pb-3 pr-12">
                        <p className={`text-[11px] mb-2.5 leading-snug ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                            设置首帧和尾帧图片以生成视频。两帧均为必填，每个槽位仅支持 1 张图片。
                        </p>
                        <div className="flex gap-3">
                            {renderFrameSlot('start', startFrame)}
                            {renderFrameSlot('end', endFrame)}
                        </div>

                        {/* Frame-slot canvas picker */}
                        {frameSlotForCanvasPicker !== null && (() => {
                            const pickerSlot = frameSlotForCanvasPicker;
                            const slotLabel = pickerSlot === 'start' ? '首帧' : '尾帧';
                            const imageOnlyNodes = availableCanvasNodes.filter(n => n.type === NodeType.IMAGE);
                            const currentSlotNodeId = data.frameInputs?.find(f => f.order === pickerSlot)?.nodeId;

                            return (
                                <div className={`mt-3 rounded-xl border p-3 ${isDark ? 'border-neutral-700 bg-neutral-900' : 'border-neutral-200 bg-neutral-50'}`}>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className={`text-xs font-medium ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
                                            为 <strong>{slotLabel}</strong> 选择画布图片节点
                                        </span>
                                        <button
                                            onClick={() => setFrameSlotForCanvasPicker(null)}
                                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                                                isDark ? 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600' : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300'
                                            }`}
                                        >
                                            关闭
                                        </button>
                                    </div>
                                    {imageOnlyNodes.length === 0 ? (
                                        <div className={`text-xs py-3 text-center ${isDark ? 'text-neutral-600' : 'text-neutral-400'}`}>
                                            画布中暂无可用的图片节点
                                        </div>
                                    ) : (
                                        <div className="flex gap-2 overflow-x-auto pb-1" onWheel={e => e.stopPropagation()}>
                                            {imageOnlyNodes.map(node => {
                                                const isSelected = currentSlotNodeId === node.id;
                                                return (
                                                    <button
                                                        key={node.id}
                                                        onClick={() => {
                                                            onSetCanvasNodeAsFrameSlot?.(data.id, node.id, pickerSlot);
                                                            setFrameSlotForCanvasPicker(null);
                                                        }}
                                                        className={`relative flex-shrink-0 w-[72px] h-[90px] rounded-xl overflow-hidden border-2 transition-all hover:scale-105 ${
                                                            isSelected
                                                                ? 'border-blue-500 ring-1 ring-blue-500/30'
                                                                : isDark ? 'border-neutral-700 hover:border-neutral-500' : 'border-neutral-200 hover:border-neutral-400'
                                                        }`}
                                                    >
                                                        <img src={node.url} alt="" className="w-full h-full object-cover" />
                                                        {isSelected && (
                                                            <div className="absolute top-1 right-1 rounded-full bg-blue-500 p-0.5">
                                                                <Check size={10} className="text-white" />
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
                    </div>
                ) : (
                    <>
                        {/* Tab Bar (with dropdown positioning container) */}
                        <div className="relative px-3 pt-3 pb-2" ref={tabAreaRef}>
                            {/* Tab Dropdown (positioned above tabs) */}
                            {renderTabDropdown()}

                            {/* Tab Buttons */}
                            <div className="flex flex-wrap gap-2">
                                {visibleTabs.map(tab => (
                                    <button
                                        key={tab.id}
                                        onClick={() => handleTabClick(tab.id)}
                                        title={tab.required ? `${tab.label}为必填素材` : tab.label}
                                        className={`flex h-16 w-16 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-2xl text-xs font-medium leading-tight transition-all duration-150
                                            ${activeTab === tab.id
                                                ? isDark
                                                    ? 'bg-neutral-800 text-white ring-1 ring-neutral-600'
                                                    : 'bg-neutral-100 text-neutral-700 shadow-sm'
                                                : isDark
                                                    ? 'text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300'
                                                    : 'bg-neutral-100/70 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600'
                                            }`}
                                    >
                                        {getMaterialTabIcon(tab.id, 16)}
                                        <span className="max-w-[3.5rem] text-center leading-tight">{tab.label}</span>
                                        {tab.maxItems > 1 && (
                                            <span className={isDark ? 'text-[9px] text-neutral-500' : 'text-[9px] text-neutral-400'}>
                                                最多 {tab.maxItems}
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Connected Node Thumbnails */}
                        {connectedImageNodes.length > 0 && (
                            <div className="px-4 py-2 flex gap-2 overflow-x-auto" onWheel={e => e.stopPropagation()}>
                                {connectedImageNodes.map(node => (
                                    <div key={node.id} className={`relative flex-shrink-0 w-[72px] h-[90px] rounded-xl overflow-hidden border group/thumb ${
                                        isDark ? 'border-neutral-700 bg-neutral-900' : 'border-neutral-200 bg-neutral-100'
                                    }`}>
                                        {node.type === NodeType.AUDIO ? (
                                            <div className={`flex h-full w-full flex-col items-center justify-center gap-2 ${
                                                isDark ? 'bg-neutral-900 text-neutral-500' : 'bg-neutral-100 text-neutral-400'
                                            }`}>
                                                <AudioLines size={18} />
                                                <span className="text-[11px]">音频</span>
                                            </div>
                                        ) : node.type === NodeType.VIDEO ? (
                                            <>
                                                <img src={node.url} alt="" className="w-full h-full object-cover" />
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                    <div className="rounded-full bg-black/50 p-1"><Play size={12} fill="white" className="text-white" /></div>
                                                </div>
                                            </>
                                        ) : (
                                            <img src={node.url} alt="" className="w-full h-full object-cover" />
                                        )}
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleRemoveConnectedNode(node.id); }}
                                            className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity hover:bg-red-500/80"
                                        >
                                            <X size={10} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Canvas Node Picker (general mode) */}
                        {showCanvasPicker && (() => {
                            const currentParentIds = data.parentIds || [];
                            const connectedSet = new Set(currentParentIds);
                            const targetType = canvasPickerType === 'video'
                                ? NodeType.VIDEO
                                : canvasPickerType === 'audio'
                                    ? NodeType.AUDIO
                                    : NodeType.IMAGE;
                            const pickable = availableCanvasNodes.filter(
                                n => n.type === targetType && n.id !== data.id
                            );
                            const pickerLabel = getNodeMediaLabel(canvasPickerType);
                            return (
                                <div className={`px-4 py-2 border-t ${isDark ? 'border-neutral-800' : 'border-neutral-100'}`}>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className={`text-xs font-medium ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>
                                            点击选择画布中的{pickerLabel}节点
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
                                            画布中暂无可用的{pickerLabel}节点
                                        </div>
                                    ) : (
                                        <div className="flex gap-2 overflow-x-auto pb-1" onWheel={e => e.stopPropagation()}>
                                            {pickable.map(node => {
                                                const isAdded = connectedSet.has(node.id);
                                                return (
                                                    <button
                                                        key={node.id}
                                                        onClick={() => {
                                                            if (isAdded) {
                                                                handleRemoveConnectedNode(node.id);
                                                            } else {
                                                                handleCanvasSelectNode(node.id);
                                                            }
                                                        }}
                                                        className={`relative flex-shrink-0 w-[72px] h-[90px] rounded-xl overflow-hidden border-2 transition-all hover:scale-105 ${
                                                            isAdded
                                                                ? 'border-blue-500 ring-1 ring-blue-500/30'
                                                                : isDark ? 'border-neutral-700 hover:border-neutral-500' : 'border-neutral-200 hover:border-neutral-400'
                                                        }`}
                                                    >
                                                        {node.type === NodeType.AUDIO ? (
                                                            <div className={`flex h-full w-full flex-col items-center justify-center gap-2 ${
                                                                isDark ? 'bg-neutral-900 text-neutral-500' : 'bg-neutral-100 text-neutral-400'
                                                            }`}>
                                                                <AudioLines size={18} />
                                                                <span className="text-[11px]">音频</span>
                                                            </div>
                                                        ) : node.type === NodeType.VIDEO ? (
                                                            <>
                                                                <img src={node.url} alt="" className="w-full h-full object-cover" />
                                                                <div className="absolute inset-0 flex items-center justify-center">
                                                                    <div className="rounded-full bg-black/50 p-1"><Play size={12} fill="white" className="text-white" /></div>
                                                                </div>
                                                            </>
                                                        ) : (
                                                            <img src={node.url} alt="" className="w-full h-full object-cover" />
                                                        )}
                                                        {isAdded && (
                                                            <div className="absolute top-1 right-1 rounded-full bg-blue-500 p-0.5">
                                                                <Check size={10} className="text-white" />
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
                    </>
                )}

                {/* Prompt Area (with inline camera shot tag) */}
                <div className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                        {selectedCameraShot && (
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border flex-shrink-0 ${
                                isDark
                                    ? 'border-neutral-700 bg-neutral-800 text-neutral-300'
                                    : 'border-neutral-200 bg-neutral-50 text-neutral-600'
                            }`}>
                                {selectedCameraShot}
                                <button
                                    onClick={() => setSelectedCameraShot(null)}
                                    className={`ml-0.5 rounded-sm transition-colors ${
                                        isDark ? 'hover:text-white' : 'hover:text-neutral-900'
                                    }`}
                                >
                                    <X size={12} />
                                </button>
                            </span>
                        )}
                        <div className="min-w-[160px] flex-1">
                            <ReferencePromptInput
                                value={settings.localPrompt}
                                references={promptReferenceOptions}
                                isDark={isDark}
                                placeholder="今天我们要创作什么"
                                minHeight={isPanelExpanded ? 270 : 28}
                                maxHeight={isPanelExpanded ? 630 : 180}
                                onChange={settings.handlePromptChange}
                                onWheel={(e) => e.stopPropagation()}
                                onBlur={settings.handlePromptBlur}
                            />
                        </div>
                    </div>
                </div>

                {/* Missing-frame warning */}
                {isFrameSlotMissing && (
                    <div className={`mx-4 mb-2 flex items-center gap-1.5 text-[11px] rounded-lg px-2.5 py-1.5 ${
                        isDark ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-50 text-amber-600'
                    }`}>
                        <AlertCircle size={12} className="flex-shrink-0" />
                        {!startFrame && !endFrame
                            ? '请设置首帧和尾帧图片后再生成'
                            : !startFrame
                                ? '首帧图片未设置'
                                : '尾帧图片未设置'}
                    </div>
                )}

                {/* Bottom bar */}
                {!canGenerate && generateDisabledReason && (
                    <div className={`mx-4 mb-2 flex items-center gap-1.5 text-[11px] rounded-lg px-2.5 py-1.5 ${
                        isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600'
                    }`}>
                        <AlertCircle size={12} className="flex-shrink-0" />
                        {generateDisabledReason}
                    </div>
                )}
                {/*
                  * NOTE on overflow: the bottom bar uses `relative` here so the absolutely-
                  * positioned dropdowns (refType, cameraShot) can escape upward without being
                  * clipped by any overflow:hidden ancestor. The left group intentionally does
                  * NOT have overflow:hidden to allow those dropdowns to be visible.
                  */}
                <div className={`relative flex items-center gap-1 px-2.5 py-2 border-t ${
                    isDark ? 'border-neutral-800' : 'border-neutral-100'
                }`}>
                    {/* Reference Type dropdown rendered here so it can escape the bottom bar. */}
                    {openPopup === 'refType' && (
                        <div
                            ref={refTypeRef}
                            className={`absolute bottom-full mb-1.5 left-2.5 w-52 rounded-xl shadow-2xl z-50 py-1.5 border ${
                                isDark ? 'bg-[#1e1e1e] border-neutral-700' : 'bg-white border-neutral-200'
                            }`}
                        >
                            {settings.availableReferenceTypeOptions.map(type => (
                                <button
                                    key={type.id}
                                    onClick={() => {
                                        settings.handleReferenceTypeChange(type.id);
                                        setOpenPopup(null);
                                    }}
                                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors
                                        ${isDark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-50'}
                                        ${settings.referenceType === type.id
                                            ? isDark ? 'text-white' : 'text-neutral-900'
                                            : isDark ? 'text-neutral-300' : 'text-neutral-600'
                                        }`}
                                >
                                    <span className="flex items-center gap-2.5">
                                        {getReferenceTypeIcon(type.id)}
                                        {type.label}
                                    </span>
                                    {settings.referenceType === type.id && (
                                        <Check size={14} className="text-blue-500 flex-shrink-0" />
                                    )}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Left group keeps dropdown anchors visible. */}
                    <div className="flex items-center gap-0.5 flex-1 min-w-0">
                        {/* Reference Type Selector button */}
                        <div className="relative flex-shrink-0" ref={refTypeButtonRef}>
                            <button
                                onClick={() => togglePopup('refType')}
                                className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg transition-colors ${
                                    isDark
                                        ? 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                                        : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
                                }`}
                            >
                                {getReferenceTypeIcon(currentRefType.id)}
                                <span className="font-medium whitespace-nowrap">{currentRefType.label}</span>
                                {openPopup === 'refType'
                                    ? <ChevronUp size={11} className="opacity-60" />
                                    : <ChevronDown size={11} className="opacity-60" />}
                            </button>
                        </div>

                        {/* Settings Summary Button */}
                        <button
                            onClick={() => togglePopup('settings')}
                            className={`flex-shrink-0 flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg transition-colors ${
                                isDark
                                    ? 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                                    : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
                            }`}
                        >
                            <span className="font-medium tabular-nums whitespace-nowrap">{settings.configSummary}</span>
                            {openPopup === 'settings'
                                ? <ChevronUp size={11} className="opacity-60" />
                                : <ChevronDown size={11} className="opacity-60" />}
                        </button>

                        {/* Camera Shot Selector */}
                        <div className="relative flex-shrink-0" ref={cameraShotRef}>
                            <button
                                onClick={() => togglePopup('cameraShot')}
                                className={`p-1.5 rounded-lg transition-colors ${
                                    isDark
                                        ? 'text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300'
                                        : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600'
                                }`}
                            >
                                <Video size={14} />
                            </button>

                            {openPopup === 'cameraShot' && (
                                <div className={`absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 w-[320px] rounded-xl shadow-2xl z-50 p-4 border ${
                                    isDark ? 'bg-[#1e1e1e] border-neutral-700' : 'bg-white border-neutral-200'
                                }`}>
                                    <h4 className={`text-sm font-semibold mb-3 ${isDark ? 'text-white' : 'text-neutral-900'}`}>
                                        鍩虹闀滃ご
                                    </h4>
                                    <div className="flex flex-wrap gap-2">
                                        {CAMERA_SHOTS.map(shot => (
                                            <button
                                                key={shot}
                                                onClick={() => {
                                                    setSelectedCameraShot(shot);
                                                    setOpenPopup(null);
                                                }}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-150
                                                    ${selectedCameraShot === shot
                                                        ? isDark
                                                            ? 'border-neutral-500 bg-neutral-700 text-white'
                                                            : 'border-neutral-400 bg-neutral-100 text-neutral-900'
                                                        : isDark
                                                            ? 'border-neutral-700 text-neutral-300 hover:bg-neutral-800 hover:border-neutral-600'
                                                            : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50 hover:border-neutral-300'
                                                    }`}
                                            >
                                                {shot}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right group: model selector + generate button */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                        {/* Model Selector */}
                        <div className="relative" ref={modelRef}>
                            <button
                                onClick={() => togglePopup('model')}
                                className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg transition-colors ${
                                    isDark
                                        ? 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                                        : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
                                }`}
                            >
                                {getModelIcon(settings.currentVideoModel.provider, 14)}
                                <span className="font-medium max-w-[72px] truncate">
                                    {settings.currentVideoModel.name}
                                </span>
                                {openPopup === 'model'
                                    ? <ChevronUp size={11} className="opacity-60" />
                                    : <ChevronDown size={11} className="opacity-60" />}
                            </button>

                            {openPopup === 'model' && (
                                <div
                                    className={`absolute bottom-full mb-1.5 right-0 w-72 rounded-xl shadow-2xl z-50 py-1.5 max-h-80 overflow-y-auto border ${
                                        isDark ? 'bg-[#1e1e1e] border-neutral-700' : 'bg-white border-neutral-200'
                                    }`}
                                    onWheel={(e) => e.stopPropagation()}
                                >
                                    {settings.availableVideoModels.map(model => (
                                        <button
                                            key={model.id}
                                            onClick={() => {
                                                settings.handleModelChange(model.id);
                                                setOpenPopup(null);
                                            }}
                                            className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors
                                                ${isDark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-50'}
                                                ${settings.currentVideoModel.id === model.id
                                                    ? isDark ? 'text-white' : 'text-neutral-900'
                                                    : isDark ? 'text-neutral-300' : 'text-neutral-600'
                                                }`}
                                        >
                                            {getModelIcon(model.provider, 16)}
                                            <span className="flex-1 text-left font-medium">{model.name}</span>
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${
                                                isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-50 text-blue-500'
                                            }`}>
                                                会员专属
                                            </span>
                                            {settings.currentVideoModel.id === model.id && (
                                                <Check size={14} className="flex-shrink-0" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Generate Button */}
                        <button
                            onClick={(e) => { e.stopPropagation(); onGenerate(data.id); }}
                            disabled={generateDisabled}
                            title={isFrameSlotMissing ? '请先设置首帧和尾帧图片' : undefined}
                            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-200
                                ${generateDisabled
                                    ? isDark
                                        ? 'bg-neutral-700 text-neutral-500 cursor-not-allowed'
                                        : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                                    : 'bg-blue-500 text-white hover:bg-blue-600 active:scale-[0.97] shadow-md shadow-blue-500/25'
                                }`}
                        >
                            {isLoading
                                ? <Loader2 size={13} className="animate-spin" />
                                : <Zap size={13} />}
                            <span>90</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Hidden file inputs for general upload */}
            <input ref={localVideoInputRef} type="file" accept="video/*" className="hidden"
                onChange={e => { void handleLocalFileSelected(e.target.files, 'Scene'); e.target.value = ''; }} />
            <input ref={localImageInputRef} type="file" accept="image/*" className="hidden"
                onChange={e => { void handleLocalFileSelected(e.target.files, 'Character'); e.target.value = ''; }} />
            <input ref={localAudioInputRef} type="file" accept="audio/*" className="hidden"
                onChange={e => { void handleLocalFileSelected(e.target.files, 'Sound Effect'); e.target.value = ''; }} />

            {/* Dedicated single-image inputs for frame slots */}
            <input ref={startFrameInputRef} type="file" accept="image/*" className="hidden"
                onChange={e => { void handleFrameSlotFileSelected(e.target.files, 'start'); e.target.value = ''; }} />
            <input ref={endFrameInputRef} type="file" accept="image/*" className="hidden"
                onChange={e => { void handleFrameSlotFileSelected(e.target.files, 'end'); e.target.value = ''; }} />
        </div>
    );
};

export const VideoSettingsPanel = memo(VideoSettingsPanelComponent);
