import React, { memo, useState, useEffect, useCallback, useRef } from 'react';
import { X, Plus, Upload, ChevronRight, Play, Trash2, Loader2, AudioLines } from 'lucide-react';
import {
    canUseXiaolouAssetBridge,
    listXiaolouAssets,
    deleteXiaolouAsset,
    type XiaolouAssetLibraryItem,
} from '../../../integrations/xiaolouAssetBridge';
import {
    buildCanvasApiUrl,
    resolveCanvasMediaUrl,
} from '../../../integrations/twitcanvaRuntimePaths';

type AssetItem = {
    id: string;
    name: string;
    category: string;
    url: string;
    previewUrl?: string;
    type: 'image' | 'video' | 'audio';
    description?: string;
};

type AssetSource = 'local' | 'xiaolou';

interface AssetLibraryModalProps {
    onClose: () => void;
    onSelectAsset?: (url: string, type: 'image' | 'video' | 'audio') => void;
    isDark: boolean;
    /** When set, the modal is in single-slot mode: only images, single-select, close on pick */
    frameSlot?: 'start' | 'end';
}

const CATEGORIES = ['全部', '角色', '场景', '道具', '风格', '音效', '其他'];
const CATEGORY_MAP: Record<string, string> = {
    '全部': 'All', '角色': 'Character', '场景': 'Scene',
    '道具': 'Item', '风格': 'Style', '音效': 'Sound Effect', '其他': 'Others',
};
const CATEGORY_REVERSE_MAP: Record<string, string> = {
    'All': '全部', 'Character': '角色', 'Scene': '场景',
    'Item': '道具', 'Style': '风格', 'Sound Effect': '音效', 'Others': '其他',
};
function localizeCategory(cat: string): string {
    return CATEGORY_REVERSE_MAP[cat] || cat;
}

function normalizeLocalAsset(asset: any): AssetItem {
    const rawType = String(asset.type || '').toLowerCase();
    let type: AssetItem['type'] = 'image';
    if (rawType === 'video') type = 'video';
    else if (rawType === 'audio') type = 'audio';

    return {
        id: String(asset.id),
        name: String(asset.name || '素材'),
        category: String(asset.category || '其他'),
        url: resolveCanvasMediaUrl(String(asset.url || '')),
        previewUrl: typeof asset.previewUrl === 'string' ? resolveCanvasMediaUrl(asset.previewUrl) : undefined,
        type,
        description: typeof asset.description === 'string' ? asset.description : undefined,
    };
}

function normalizeBridgeAsset(asset: XiaolouAssetLibraryItem): AssetItem {
    return {
        id: asset.id,
        name: asset.name,
        category: asset.category,
        url: asset.url,
        previewUrl: asset.previewUrl,
        type: asset.type as AssetItem['type'],
        description: asset.description,
    };
}

async function uploadFileToLibrary(file: File, category: string): Promise<AssetItem | null> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const base64 = (reader.result as string).split(',')[1];
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
                resolve(normalizeLocalAsset({ ...created, type: mediaType }));
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

const AssetLibraryModalComponent: React.FC<AssetLibraryModalProps> = ({ onClose, onSelectAsset, isDark, frameSlot }) => {
    const isFrameSlotMode = frameSlot !== undefined;
    const frameSlotLabel = frameSlot === 'start' ? '首帧' : '尾帧';
    const [assets, setAssets] = useState<AssetItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [assetSource, setAssetSource] = useState<AssetSource>('local');
    const [selectedCategory, setSelectedCategory] = useState('全部');
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    const imageInputRef = useRef<HTMLInputElement>(null);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);

    const fetchAssets = useCallback(async () => {
        setLoading(true);
        try {
            if (canUseXiaolouAssetBridge()) {
                try {
                    const bridgeAssets = await listXiaolouAssets();
                    setAssets(bridgeAssets.map(normalizeBridgeAsset));
                    setAssetSource('xiaolou');
                    return;
                } catch {
                    console.warn('[AssetLibraryModal] Bridge fallback to local');
                }
            }

            const response = await fetch(buildCanvasApiUrl('/library'));
            if (!response.ok) throw new Error('Failed to load library');
            const localAssets = ((await response.json()) as any[]).map(normalizeLocalAsset);
            setAssets(localAssets);
            setAssetSource('local');
        } catch (error) {
            console.error('[AssetLibraryModal] Load error:', error);
            setAssets([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void fetchAssets(); }, [fetchAssets]);

    const handleFileUpload = useCallback(async (files: FileList | null, defaultCategory: string) => {
        if (!files || files.length === 0) return;
        setUploading(true);
        try {
            const newAssets: AssetItem[] = [];
            for (const file of Array.from(files)) {
                const asset = await uploadFileToLibrary(file, defaultCategory);
                if (asset) newAssets.push(asset);
            }
            if (newAssets.length > 0) {
                setAssets(prev => [...newAssets, ...prev]);
            }
        } catch (error) {
            console.error('[AssetLibraryModal] Upload error:', error);
        } finally {
            setUploading(false);
        }
    }, []);

    const handleDelete = useCallback(async (id: string) => {
        try {
            if (assetSource === 'xiaolou') {
                await deleteXiaolouAsset(id);
            } else {
                const resp = await fetch(buildCanvasApiUrl(`/library/${id}`), { method: 'DELETE' });
                if (!resp.ok) throw new Error('Delete failed');
            }
            setAssets(prev => prev.filter(a => a.id !== id));
        } catch (error) {
            console.error('[AssetLibraryModal] Delete error:', error);
        }
        setDeleteConfirmId(null);
    }, [assetSource]);

    const filterKey = CATEGORY_MAP[selectedCategory] || 'All';
    const imageAssets = assets.filter(a => a.type === 'image' && (filterKey === 'All' || a.category === filterKey));
    const videoAssets = assets.filter(a => a.type === 'video' && (filterKey === 'All' || a.category === filterKey));
    const audioAssets = assets.filter(a => a.type === 'audio' || (filterKey === 'All' && a.category === 'Sound Effect'));

    const renderAssetCard = (asset: AssetItem) => {
        const previewUrl = asset.previewUrl || asset.url;
        const isDeleting = deleteConfirmId === asset.id;

        return (
            <div
                key={asset.id}
                className={`group relative aspect-square cursor-pointer overflow-hidden rounded-xl border transition-colors ${
                    isDark ? 'border-neutral-800 bg-neutral-900 hover:border-neutral-600' : 'border-neutral-200 bg-neutral-50 hover:border-neutral-300'
                }`}
                onClick={() => {
                    onSelectAsset?.(asset.url, asset.type);
                    // In frame-slot mode, close immediately after selection
                    if (isFrameSlotMode) onClose();
                }}
            >
                {asset.type === 'video' ? (
                    <>
                        <video src={previewUrl} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
                            <div className="rounded-full bg-black/55 p-2 text-white"><Play size={16} fill="currentColor" /></div>
                        </div>
                    </>
                ) : asset.type === 'audio' ? (
                    <div className={`h-full w-full flex flex-col items-center justify-center gap-1.5 ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                        <AudioLines size={24} />
                        <span className="text-[10px] max-w-full px-2 truncate">{asset.name}</span>
                    </div>
                ) : (
                    <img
                        src={previewUrl}
                        alt={asset.name}
                        className="h-full w-full object-cover"
                        onError={(e) => {
                            const t = e.target as HTMLImageElement;
                            t.onerror = null;
                            t.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMzMzMiIHN0cm9rZS13aWR0aD0iMiI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iMiIvPjxjaXJjbGUgY3g9IjguNSIgY3k9IjguNSIgcj0iMS41Ii8+PHBvbHlsaW5lIHBvaW50cz0iMjEgMTUgMTYgMTAgNSAyMSIvPjwvc3ZnPg==';
                            t.classList.add('p-6', 'opacity-40');
                        }}
                    />
                )}

                <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="truncate text-xs font-medium text-white">{asset.name}</span>
                    <span className="truncate text-[10px] text-neutral-300">{localizeCategory(asset.category)}</span>
                </div>

                {isDeleting ? (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/80" onClick={e => e.stopPropagation()}>
                        <span className="text-xs font-medium text-white">确认删除？</span>
                        <div className="flex gap-2">
                            <button className="rounded bg-red-500 px-2 py-1 text-xs text-white hover:bg-red-600" onClick={e => { e.stopPropagation(); void handleDelete(asset.id); }}>删除</button>
                            <button className="rounded bg-neutral-700 px-2 py-1 text-xs text-white hover:bg-neutral-600" onClick={e => { e.stopPropagation(); setDeleteConfirmId(null); }}>取消</button>
                        </div>
                    </div>
                ) : (
                    <button
                        className="absolute right-1.5 top-1.5 z-10 rounded-md bg-black/60 p-1.5 text-white opacity-0 transition-opacity hover:bg-red-500/80 group-hover:opacity-100"
                        onClick={e => { e.stopPropagation(); setDeleteConfirmId(asset.id); }}
                    >
                        <Trash2 size={12} />
                    </button>
                )}
            </div>
        );
    };

    const renderUploadZone = (
        label: string,
        accept: string,
        hint: string,
        inputRef: React.RefObject<HTMLInputElement | null>,
        category: string,
    ) => (
        <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className={`w-full py-6 rounded-xl border-[1.5px] border-dashed transition-colors flex flex-col items-center justify-center gap-2 ${
                isDark
                    ? 'border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300'
                    : 'border-neutral-300 text-neutral-400 hover:border-neutral-400 hover:text-neutral-600'
            } ${uploading ? 'opacity-50 cursor-wait' : ''}`}
        >
            {uploading ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} strokeWidth={1.5} />}
            <span className="text-xs">{hint}</span>
            <input
                ref={inputRef}
                type="file"
                accept={accept}
                multiple
                className="hidden"
                onChange={e => { void handleFileUpload(e.target.files, category); e.target.value = ''; }}
            />
        </button>
    );

    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
        >
            <div className="absolute inset-0 bg-black/20" onClick={onClose} />

            <div className={`relative w-[720px] max-h-[80vh] rounded-2xl shadow-2xl flex flex-col ${
                isDark ? 'bg-[#1a1a1a] border border-neutral-700' : 'bg-white border border-neutral-200'
            }`}>
                {/* Header */}
                <div className={`flex items-center justify-between px-6 pt-5 pb-4 border-b ${isDark ? 'border-neutral-800' : 'border-neutral-100'}`}>
                    <div>
                        <h2 className={`text-lg font-bold ${isDark ? 'text-white' : 'text-neutral-900'}`}>
                            {isFrameSlotMode ? `选择${frameSlotLabel}图片` : '素材库'}
                        </h2>
                        <span className={`text-xs ${isDark ? 'text-neutral-500' : 'text-neutral-500'}`}>
                            {isFrameSlotMode
                                ? `仅支持图片 · 选择后替换${frameSlotLabel}槽位`
                                : assetSource === 'xiaolou' ? '已连接小楼项目素材' : '本地素材库'}
                        </span>
                    </div>
                    <button onClick={onClose} className={`p-1 rounded-lg transition-colors ${isDark ? 'text-neutral-400 hover:bg-neutral-800 hover:text-white' : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700'}`}>
                        <X size={20} />
                    </button>
                </div>

                {/* Category Tabs */}
                <div className={`px-6 pt-4 pb-2 flex gap-2 overflow-x-auto border-b ${isDark ? 'border-neutral-800' : 'border-neutral-100'}`}>
                    {CATEGORIES.map(cat => (
                        <button
                            key={cat}
                            onClick={() => setSelectedCategory(cat)}
                            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                                selectedCategory === cat
                                    ? isDark ? 'border-white bg-neutral-100 text-black' : 'border-neutral-900 bg-neutral-900 text-white'
                                    : isDark ? 'border-neutral-700 text-neutral-400 hover:border-neutral-500' : 'border-neutral-200 text-neutral-500 hover:border-neutral-300'
                            }`}
                        >
                            {cat}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6" onWheel={e => e.stopPropagation()}>
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 size={24} className={`animate-spin ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`} />
                        </div>
                    ) : (
                        <>
                            {/* 图片 Section */}
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className={`text-sm font-bold ${isDark ? 'text-white' : 'text-neutral-900'}`}>
                                        图片 {imageAssets.length > 0 && <span className="font-normal text-neutral-500 ml-1">({imageAssets.length})</span>}
                                    </h3>
                                    <button
                                        onClick={() => imageInputRef.current?.click()}
                                        className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors border ${
                                            isDark ? 'text-neutral-300 hover:bg-neutral-800 border-neutral-700' : 'text-neutral-600 hover:bg-neutral-50 border-neutral-200'
                                        }`}
                                    >
                                        <Plus size={12} /> 上传图片
                                    </button>
                                </div>
                                {imageAssets.length > 0 ? (
                                    <div className="grid grid-cols-5 gap-3">
                                        {imageAssets.map(renderAssetCard)}
                                    </div>
                                ) : (
                                    renderUploadZone('上传图片', 'image/*', 'JPG, PNG, WEBP · 拖放或点击上传', imageInputRef, 'Character')
                                )}
                                <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { void handleFileUpload(e.target.files, 'Character'); e.target.value = ''; }} />
                            </div>

                            {/* 视频/音频 Sections — hidden in frame-slot mode */}
                            {!isFrameSlotMode && (
                                <>
                                    {/* 视频 Section */}
                                    <div>
                                        <div className="flex items-center justify-between mb-3">
                                            <h3 className={`text-sm font-bold ${isDark ? 'text-white' : 'text-neutral-900'}`}>
                                                视频 {videoAssets.length > 0 && <span className="font-normal text-neutral-500 ml-1">({videoAssets.length})</span>}
                                            </h3>
                                            <button
                                                onClick={() => videoInputRef.current?.click()}
                                                className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors border ${
                                                    isDark ? 'text-neutral-300 hover:bg-neutral-800 border-neutral-700' : 'text-neutral-600 hover:bg-neutral-50 border-neutral-200'
                                                }`}
                                            >
                                                <Plus size={12} /> 上传视频
                                            </button>
                                        </div>
                                        {videoAssets.length > 0 ? (
                                            <div className="grid grid-cols-5 gap-3">
                                                {videoAssets.map(renderAssetCard)}
                                            </div>
                                        ) : (
                                            renderUploadZone('上传视频', 'video/*', 'MP4, MOV, WEBM · 最大 50 MB', videoInputRef, 'Scene')
                                        )}
                                        <input ref={videoInputRef} type="file" accept="video/*" multiple className="hidden" onChange={e => { void handleFileUpload(e.target.files, 'Scene'); e.target.value = ''; }} />
                                    </div>

                                    {/* 音频 Section */}
                                    <div>
                                        <div className="flex items-center justify-between mb-3">
                                            <h3 className={`text-sm font-bold ${isDark ? 'text-white' : 'text-neutral-900'}`}>
                                                音频 {audioAssets.length > 0 && <span className="font-normal text-neutral-500 ml-1">({audioAssets.length})</span>}
                                            </h3>
                                            <button
                                                onClick={() => audioInputRef.current?.click()}
                                                className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors border ${
                                                    isDark ? 'text-neutral-300 hover:bg-neutral-800 border-neutral-700' : 'text-neutral-600 hover:bg-neutral-50 border-neutral-200'
                                                }`}
                                            >
                                                <Plus size={12} /> 上传音频
                                            </button>
                                        </div>
                                        {audioAssets.length > 0 ? (
                                            <div className="grid grid-cols-5 gap-3">
                                                {audioAssets.map(renderAssetCard)}
                                            </div>
                                        ) : (
                                            renderUploadZone('上传音频', 'audio/*', 'WAV, MP3, OGG · 最大 15 MB', audioInputRef, 'Sound Effect')
                                        )}
                                        <input ref={audioInputRef} type="file" accept="audio/*" multiple className="hidden" onChange={e => { void handleFileUpload(e.target.files, 'Sound Effect'); e.target.value = ''; }} />
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className={`flex items-center justify-between px-6 py-4 border-t ${isDark ? 'border-neutral-800' : 'border-neutral-100'}`}>
                    <button className={`flex items-center gap-1 text-sm transition-colors ${isDark ? 'text-neutral-400 hover:text-neutral-200' : 'text-neutral-500 hover:text-neutral-700'}`}>
                        素材要求说明
                        <ChevronRight size={14} />
                    </button>
                    <button
                        onClick={onClose}
                        className={`px-6 py-2 rounded-xl text-sm font-medium transition-colors ${
                            isDark ? 'bg-white text-black hover:bg-neutral-200' : 'bg-neutral-900 text-white hover:bg-neutral-800'
                        }`}
                    >
                        完成
                    </button>
                </div>
            </div>
        </div>
    );
};

export const AssetLibraryModal = memo(AssetLibraryModalComponent);
