import React, { memo, useState, useRef, useEffect } from 'react';
import {
    Upload, ChevronDown, ChevronUp, Check, Zap, Loader2,
    Film, Image as ImageIcon, AudioLines, Video, X, Play,
    Paperclip, Layout, PenLine, Mic, Users, AlertCircle,
} from 'lucide-react';
import { NodeData, NodeType } from '../../../types';
import { useVideoSettings, ReferenceType } from './useVideoSettings';
import { AspectRatioSelector } from './AspectRatioSelector';
import { DurationSlider } from './DurationSlider';
import { QualitySelector } from './QualitySelector';
import { AudioToggle } from './AudioToggle';
import { AssetLibraryModal } from './AssetLibraryModal';
import { GoogleIcon, KlingIcon, HailuoIcon } from '../../icons/BrandIcons';
import { buildCanvasApiUrl, resolveCanvasMediaUrl } from '../../../integrations/twitcanvaRuntimePaths';

export interface VideoSettingsPanelProps {
    data: NodeData;
    inputUrl?: string;
    isLoading: boolean;
    isSuccess: boolean;
    connectedImageNodes?: { id: string; url: string; type?: NodeType }[];
    availableCanvasNodes?: { id: string; url: string; type?: NodeType }[];
    onUpdate: (id: string, updates: Partial<NodeData>) => void;
    onGenerate: (id: string) => void;
    onAttachAsset?: (targetNodeId: string, url: string, type: 'image' | 'video' | 'audio') => void;
    /** Frame-slot specific handlers (first-last-frame mode) */
    onSetFrameSlot?: (targetNodeId: string, url: string, slot: 'start' | 'end') => void;
    onClearFrameSlot?: (targetNodeId: string, slot: 'start' | 'end') => void;
    onSetCanvasNodeAsFrameSlot?: (targetNodeId: string, canvasNodeId: string, slot: 'start' | 'end') => void;
    onSelect: (id: string) => void;
    zoom: number;
    canvasTheme?: 'dark' | 'light';
}

type MaterialTab = 'video' | 'image' | 'audio' | 'first-frame' | 'last-frame';
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
        case 'google': return <GoogleIcon size={size} />;
        case 'kling': return <KlingIcon size={size} />;
        case 'hailuo': return <HailuoIcon size={size} />;
        case 'bytedance': return <SeedanceIcon size={size} />;
        default: return <Film size={size} />;
    }
}

const REF_TYPES: { id: ReferenceType; label: string; icon: React.ReactNode }[] = [
    { id: 'reference', label: '参考图/视频', icon: <ImageIcon size={14} /> },
    { id: 'video-edit', label: '视频编辑', icon: <PenLine size={14} /> },
    { id: 'first-last-frame', label: '首尾帧', icon: <Layout size={14} /> },
];

type TabDef = { id: MaterialTab; label: string; icon: React.ReactNode };

const TABS_REFERENCE: TabDef[] = [
    { id: 'video', label: '视频', icon: <Film size={16} /> },
    { id: 'image', label: '图片', icon: <ImageIcon size={16} /> },
    { id: 'audio', label: '音频', icon: <AudioLines size={16} /> },
];

const TABS_VIDEO_EDIT: TabDef[] = [
    { id: 'video', label: '视频', icon: <Film size={16} /> },
    { id: 'image', label: '图片', icon: <ImageIcon size={16} /> },
];

function getTabsForRefType(refType: ReferenceType): TabDef[] {
    switch (refType) {
        case 'video-edit': return TABS_VIDEO_EDIT;
        default: return TABS_REFERENCE;
    }
}

const VideoSettingsPanelComponent: React.FC<VideoSettingsPanelProps> = ({
    data,
    inputUrl,
    isLoading,
    connectedImageNodes = [],
    availableCanvasNodes = [],
    onUpdate,
    onGenerate,
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
    const visibleTabs = isFirstLastFrame ? [] : getTabsForRefType(settings.referenceType);

    const [activeTab, setActiveTab] = useState<MaterialTab>(visibleTabs[0]?.id ?? 'image');
    const [openPopup, setOpenPopup] = useState<PopupType>(null);
    const [openTabDropdown, setOpenTabDropdown] = useState<MaterialTab | null>(null);
    const [showAssetLibrary, setShowAssetLibrary] = useState(false);
    const [selectedCameraShot, setSelectedCameraShot] = useState<string | null>(null);
    const [showCanvasPicker, setShowCanvasPicker] = useState(false);
    const [canvasPickerType, setCanvasPickerType] = useState<'video' | 'image'>('image');

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
            const tabs = getTabsForRefType(settings.referenceType);
            setActiveTab(tabs[0]?.id ?? 'image');
        }
        setOpenTabDropdown(null);
    }, [settings.referenceType, isFirstLastFrame]);

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
                const assetUrl = resolveCanvasMediaUrl(String(created?.url || ''));
                if (assetUrl) {
                    onAttachAsset?.(data.id, assetUrl, mediaType);
                }
            } catch (err) {
                console.error('[VideoSettings] Upload failed:', err);
            }
        }
    };

    // ─── Frame slot upload (single image only) ───────────────────────────────
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
            const assetUrl = resolveCanvasMediaUrl(String(created?.url || ''));
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

    const handleCanvasSelectClick = (type: 'video' | 'image') => {
        setOpenTabDropdown(null);
        setCanvasPickerType(type);
        setShowCanvasPicker(true);
    };

    const minEffectiveScale = 0.8;
    const effectiveScale = Math.max(zoom, minEffectiveScale);
    const localScale = effectiveScale / zoom;

    const currentRefType = REF_TYPES.find(r => r.id === settings.referenceType) || REF_TYPES[0];

    // Compute frame slot states
    const startFrame = settings.frameInputsWithUrls.find(f => f.order === 'start');
    const endFrame = settings.frameInputsWithUrls.find(f => f.order === 'end');
    const bothFramesFilled = !!startFrame && !!endFrame;
    const isFrameSlotMissing = isFirstLastFrame && !bothFramesFilled;
    const generateDisabled = isLoading || isFrameSlotMissing;

    // ─── Frame Slots UI (Lovart-style explicit slots) ──────────────────────────
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
                        音频
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
            className="relative w-full"
            style={{
                transform: `scale(${localScale})`,
                transformOrigin: 'top center',
                transition: 'transform 0.1s ease-out',
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onSelect(data.id)}
        >
            {/* ─── Floating Video Settings Popover (above card) ─── */}
            {openPopup === 'settings' && (
                <div
                    ref={settingsRef}
                    className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 z-50"
                >
                    <div className={`w-[340px] rounded-2xl shadow-2xl p-6 border ${
                        isDark ? 'bg-[#1a1a1a] border-neutral-700' : 'bg-white border-neutral-200'
                    }`}>
                        <h3 className={`text-base font-bold mb-5 ${isDark ? 'text-white' : 'text-neutral-900'}`}>
                            视频设置
                        </h3>
                        <div className="space-y-6">
                            <AspectRatioSelector
                                options={settings.availableAspectRatios}
                                value={data.aspectRatio || 'Auto'}
                                onChange={settings.handleAspectRatioChange}
                                isDark={isDark}
                            />
                            <DurationSlider
                                availableDurations={settings.availableDurations}
                                value={settings.currentDuration}
                                onChange={settings.handleDurationChange}
                                isDark={isDark}
                            />
                            <QualitySelector
                                options={settings.availableResolutions}
                                value={data.resolution || '720p'}
                                onChange={settings.handleResolutionChange}
                                isDark={isDark}
                            />
                            <AudioToggle
                                audioEnabled={data.generateAudio !== false}
                                onAudioToggle={settings.handleAudioToggle}
                                isDark={isDark}
                                networkSearchEnabled={data.networkSearch === true}
                                onNetworkSearchToggle={settings.handleNetworkSearchToggle}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Asset Library Modal (general or frame-slot mode) ─── */}
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

            {/* ─── Main Card ─── */}
            <div className={`rounded-2xl shadow-xl cursor-default transition-colors duration-200 ${
                isDark
                    ? 'bg-[#1a1a1a] border border-neutral-800'
                    : 'bg-white border border-neutral-200'
            }`}>
                {/* Notice + Upload Row (hidden in first-last-frame mode) */}
                {!isFirstLastFrame && (
                    <div className="px-4 pt-3.5 pb-2 flex items-center justify-between gap-3">
                        <span className={`text-xs whitespace-nowrap ${isDark ? 'text-neutral-500' : 'text-neutral-500'}`}>
                            角色素材需通过素材库审核后方可使用
                        </span>
                        <button
                            onClick={handleUploadClick}
                            className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors flex-shrink-0 border ${
                                isDark
                                    ? 'text-neutral-300 hover:bg-neutral-800 border-neutral-700'
                                    : 'text-neutral-700 hover:bg-neutral-50 border-neutral-200'
                            }`}
                        >
                            <Upload size={13} strokeWidth={2} />
                            上传
                        </button>
                    </div>
                )}

                {/* ─── First-Last-Frame Slots UI ─── */}
                {isFirstLastFrame ? (
                    <div className="px-4 pt-3.5 pb-3">
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
                        <div className="relative px-4 pb-1" ref={tabAreaRef}>
                            {/* Tab Dropdown (positioned above tabs) */}
                            {renderTabDropdown()}

                            {/* Tab Buttons */}
                            <div className="flex gap-2">
                                {visibleTabs.map(tab => (
                                    <button
                                        key={tab.id}
                                        onClick={() => handleTabClick(tab.id)}
                                        className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium border transition-all duration-150
                                            ${activeTab === tab.id
                                                ? isDark
                                                    ? 'border-neutral-500 bg-neutral-800 text-white'
                                                    : 'border-neutral-300 bg-white text-neutral-800 shadow-sm'
                                                : isDark
                                                    ? 'border-transparent text-neutral-500 hover:text-neutral-300'
                                                    : 'border-transparent text-neutral-400 hover:text-neutral-600'
                                            }`}
                                    >
                                        {tab.icon}
                                        {tab.label}
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
                                        {node.type === NodeType.VIDEO ? (
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
                            const targetType = canvasPickerType === 'video' ? NodeType.VIDEO : NodeType.IMAGE;
                            const pickable = availableCanvasNodes.filter(
                                n => n.type === targetType && n.id !== data.id
                            );
                            return (
                                <div className={`px-4 py-2 border-t ${isDark ? 'border-neutral-800' : 'border-neutral-100'}`}>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className={`text-xs font-medium ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>
                                            点击选择画布中的{canvasPickerType === 'video' ? '视频' : '图片'}节点
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
                                            画布中暂无可用的{canvasPickerType === 'video' ? '视频' : '图片'}节点
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
                                                        {node.type === NodeType.VIDEO ? (
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
                        <textarea
                            className={`flex-1 min-w-[120px] bg-transparent text-sm outline-none resize-none leading-relaxed min-h-[28px] text-left ${
                                isDark
                                    ? 'text-white placeholder-neutral-500'
                                    : 'text-neutral-900 placeholder-neutral-400'
                            }`}
                            placeholder="今天我们要创作什么"
                            rows={1}
                            value={settings.localPrompt}
                            onChange={(e) => settings.handlePromptChange(e.target.value)}
                            onWheel={(e) => e.stopPropagation()}
                            onBlur={settings.handlePromptBlur}
                        />
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

                {/* ─── Bottom Bar ─── */}
                {/*
                  * NOTE on overflow: the bottom bar uses `relative` here so the absolutely-
                  * positioned dropdowns (refType, cameraShot) can escape upward without being
                  * clipped by any overflow:hidden ancestor. The left group intentionally does
                  * NOT have overflow:hidden to allow those dropdowns to be visible.
                  */}
                <div className={`relative flex items-center gap-1 px-2.5 py-2 border-t ${
                    isDark ? 'border-neutral-800' : 'border-neutral-100'
                }`}>
                    {/* Reference Type dropdown — rendered here (outside any overflow:hidden), anchored to refTypeRef button */}
                    {openPopup === 'refType' && (
                        <div
                            ref={refTypeRef}
                            className={`absolute bottom-full mb-1.5 left-2.5 w-52 rounded-xl shadow-2xl z-50 py-1.5 border ${
                                isDark ? 'bg-[#1e1e1e] border-neutral-700' : 'bg-white border-neutral-200'
                            }`}
                        >
                            {REF_TYPES.map(type => (
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
                                        {type.icon}
                                        {type.label}
                                    </span>
                                    {settings.referenceType === type.id && (
                                        <Check size={14} className="text-blue-500 flex-shrink-0" />
                                    )}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Left group — no overflow:hidden so dropdowns aren't clipped */}
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
                                {currentRefType.icon}
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
                                        基础镜头
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
