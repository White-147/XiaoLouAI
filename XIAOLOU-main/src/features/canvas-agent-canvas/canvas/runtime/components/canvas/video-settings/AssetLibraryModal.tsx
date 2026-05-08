import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus, Upload, ChevronRight, Play, Trash2, Loader2, AudioLines } from 'lucide-react';
import {
    canUseXiaolouAssetBridge,
    deleteXiaolouAsset,
    listXiaolouAssets,
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
    frameSlot?: 'start' | 'end';
}

const CATEGORIES = ['全部', '角色', '场景', '道具', '风格', '音效', '其他'];
const CATEGORY_MAP: Record<string, string> = {
    全部: 'All',
    角色: 'Character',
    场景: 'Scene',
    道具: 'Item',
    风格: 'Style',
    音效: 'Sound Effect',
    其他: 'Others',
};
const CATEGORY_REVERSE_MAP: Record<string, string> = {
    All: '全部',
    Character: '角色',
    Scene: '场景',
    Item: '道具',
    Style: '风格',
    'Sound Effect': '音效',
    Others: '其他',
};

function localizeCategory(category: string): string {
    return CATEGORY_REVERSE_MAP[category] || category;
}

function normalizeLocalAsset(asset: any): AssetItem {
    const rawType = String(asset?.type || '').toLowerCase();
    const type: AssetItem['type'] =
        rawType === 'video' ? 'video' : rawType === 'audio' ? 'audio' : 'image';

    return {
        id: String(asset?.id || ''),
        name: String(asset?.name || '素材'),
        category: String(asset?.category || 'Others'),
        url: resolveCanvasMediaUrl(String(asset?.url || '')),
        previewUrl:
            typeof asset?.previewUrl === 'string'
                ? resolveCanvasMediaUrl(asset.previewUrl)
                : undefined,
        type,
        description: typeof asset?.description === 'string' ? asset.description : undefined,
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

function unwrapLocalLibraryAssetResponse(payload: any) {
    if (payload && typeof payload === 'object' && payload.asset && typeof payload.asset === 'object') {
        return payload.asset;
    }
    return payload;
}

async function uploadFileToLibrary(file: File, category: string): Promise<AssetItem | null> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const dataUrl = String(reader.result || '');
                const base64 = dataUrl.split(',')[1];
                if (!base64) throw new Error('Invalid file data');

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

                const created = unwrapLocalLibraryAssetResponse(await response.json());
                resolve(normalizeLocalAsset({ ...created, type: mediaType }));
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

const AssetLibraryModalComponent: React.FC<AssetLibraryModalProps> = ({
    onClose,
    onSelectAsset,
    isDark,
    frameSlot,
}) => {
    const isFrameSlotMode = frameSlot !== undefined;
    const frameSlotLabel = frameSlot === 'start' ? '首帧' : '尾帧';
    const hasProjectAssetBridge = canUseXiaolouAssetBridge();

    const [assetSource, setAssetSource] = useState<AssetSource>('local');
    const [assets, setAssets] = useState<AssetItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState('全部');
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    const imageInputRef = useRef<HTMLInputElement>(null);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);

    const fetchAssets = useCallback(async () => {
        setLoading(true);
        try {
            if (assetSource === 'xiaolou') {
                if (!hasProjectAssetBridge) {
                    setAssets([]);
                    return;
                }
                const bridgeAssets = await listXiaolouAssets();
                setAssets(bridgeAssets.map(normalizeBridgeAsset));
                return;
            }

            const response = await fetch(buildCanvasApiUrl('/library'));
            if (!response.ok) throw new Error('Failed to load library');
            const localAssets = ((await response.json()) as any[]).map(normalizeLocalAsset);
            setAssets(localAssets);
        } catch (error) {
            console.error('[AssetLibraryModal] Load error:', error);
            setAssets([]);
        } finally {
            setLoading(false);
        }
    }, [assetSource, hasProjectAssetBridge]);

    useEffect(() => {
        void fetchAssets();
    }, [fetchAssets]);

    const handleFileUpload = useCallback(async (files: FileList | null, defaultCategory: string) => {
        if (assetSource !== 'local' || !files || files.length === 0) return;

        setUploading(true);
        try {
            const nextAssets: AssetItem[] = [];
            for (const file of Array.from(files)) {
                const asset = await uploadFileToLibrary(file, defaultCategory);
                if (asset) nextAssets.push(asset);
            }
            if (nextAssets.length > 0) {
                setAssets((current) => [...nextAssets, ...current]);
            }
        } catch (error) {
            console.error('[AssetLibraryModal] Upload error:', error);
        } finally {
            setUploading(false);
        }
    }, [assetSource]);

    const handleDelete = useCallback(async (id: string) => {
        try {
            if (assetSource === 'xiaolou') {
                await deleteXiaolouAsset(id);
            } else {
                const response = await fetch(buildCanvasApiUrl(`/library/${id}`), { method: 'DELETE' });
                if (!response.ok) throw new Error('Delete failed');
            }
            setAssets((current) => current.filter((item) => item.id !== id));
        } catch (error) {
            console.error('[AssetLibraryModal] Delete error:', error);
        } finally {
            setDeleteConfirmId(null);
        }
    }, [assetSource]);

    const filterKey = CATEGORY_MAP[selectedCategory] || 'All';
    const filteredAssets = useMemo(
        () => assets.filter((item) => filterKey === 'All' || item.category === filterKey),
        [assets, filterKey],
    );
    const imageAssets = filteredAssets.filter((item) => item.type === 'image');
    const videoAssets = filteredAssets.filter((item) => item.type === 'video');
    const audioAssets = filteredAssets.filter((item) => item.type === 'audio');

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
                    if (isFrameSlotMode) onClose();
                }}
            >
                {asset.type === 'video' ? (
                    <>
                        <video src={previewUrl} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
                            <div className="rounded-full bg-black/55 p-2 text-white">
                                <Play size={16} fill="currentColor" />
                            </div>
                        </div>
                    </>
                ) : asset.type === 'audio' ? (
                    <div className={`flex h-full w-full flex-col items-center justify-center gap-1.5 ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                        <AudioLines size={24} />
                        <span className="max-w-full px-2 text-[10px] truncate">{asset.name}</span>
                    </div>
                ) : (
                    <img
                        src={previewUrl}
                        alt={asset.name}
                        className="h-full w-full object-cover"
                        onError={(event) => {
                            const target = event.target as HTMLImageElement;
                            target.onerror = null;
                            target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMzMzMiIHN0cm9rZS13aWR0aD0iMiI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iMiIvPjxjaXJjbGUgY3g9IjguNSIgY3k9IjguNSIgcj0iMS41Ii8+PHBvbHlsaW5lIHBvaW50cz0iMjEgMTUgMTYgMTAgNSAyMSIvPjwvc3ZnPg==';
                            target.classList.add('p-6', 'opacity-40');
                        }}
                    />
                )}

                <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="truncate text-xs font-medium text-white">{asset.name}</span>
                    <span className="truncate text-[10px] text-neutral-300">{localizeCategory(asset.category)}</span>
                </div>

                {isDeleting ? (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/80" onClick={(event) => event.stopPropagation()}>
                        <span className="text-xs font-medium text-white">确认删除？</span>
                        <div className="flex gap-2">
                            <button
                                className="rounded bg-red-500 px-2 py-1 text-xs text-white hover:bg-red-600"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    void handleDelete(asset.id);
                                }}
                            >
                                删除
                            </button>
                            <button
                                className="rounded bg-neutral-700 px-2 py-1 text-xs text-white hover:bg-neutral-600"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setDeleteConfirmId(null);
                                }}
                            >
                                取消
                            </button>
                        </div>
                    </div>
                ) : (
                    <button
                        className="absolute right-1.5 top-1.5 z-10 rounded-md bg-black/60 p-1.5 text-white opacity-0 transition-opacity hover:bg-red-500/80 group-hover:opacity-100"
                        onClick={(event) => {
                            event.stopPropagation();
                            setDeleteConfirmId(asset.id);
                        }}
                    >
                        <Trash2 size={12} />
                    </button>
                )}
            </div>
        );
    };

    const renderUploadZone = (
        accept: string,
        hint: string,
        inputRef: React.RefObject<HTMLInputElement | null>,
        category: string,
    ) => (
        <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed py-6 transition-colors ${
                isDark
                    ? 'border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300'
                    : 'border-neutral-300 text-neutral-400 hover:border-neutral-400 hover:text-neutral-600'
            } ${uploading ? 'cursor-wait opacity-50' : ''}`}
        >
            {uploading ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} strokeWidth={1.5} />}
            <span className="text-xs">{hint}</span>
            <input
                ref={inputRef}
                type="file"
                accept={accept}
                multiple
                className="hidden"
                onChange={(event) => {
                    void handleFileUpload(event.target.files, category);
                    event.target.value = '';
                }}
            />
        </button>
    );

    const renderEmptyState = (message: string) => (
        <div className={`rounded-xl border border-dashed px-4 py-8 text-center text-xs ${isDark ? 'border-neutral-800 text-neutral-500' : 'border-neutral-200 text-neutral-400'}`}>
            {message}
        </div>
    );

    const renderSection = ({
        title,
        items,
        uploadLabel,
        uploadHint,
        inputRef,
        accept,
        category,
        emptyProjectMessage,
    }: {
        title: string;
        items: AssetItem[];
        uploadLabel: string;
        uploadHint: string;
        inputRef: React.RefObject<HTMLInputElement | null>;
        accept: string;
        category: string;
        emptyProjectMessage: string;
    }) => (
        <div>
            <div className="mb-3 flex items-center justify-between">
                <h3 className={`text-sm font-bold ${isDark ? 'text-white' : 'text-neutral-900'}`}>
                    {title}
                    {items.length > 0 ? <span className="ml-1 font-normal text-neutral-500">({items.length})</span> : null}
                </h3>
                {assetSource === 'local' ? (
                    <button
                        onClick={() => inputRef.current?.click()}
                        className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                            isDark ? 'border-neutral-700 text-neutral-300 hover:bg-neutral-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                        }`}
                    >
                        <Plus size={12} />
                        {uploadLabel}
                    </button>
                ) : null}
            </div>

            {items.length > 0 ? (
                <div className="grid grid-cols-5 gap-3">
                    {items.map(renderAssetCard)}
                </div>
            ) : assetSource === 'local' ? (
                renderUploadZone(accept, uploadHint, inputRef, category)
            ) : (
                renderEmptyState(emptyProjectMessage)
            )}

            <input
                ref={inputRef}
                type="file"
                accept={accept}
                multiple
                className="hidden"
                onChange={(event) => {
                    void handleFileUpload(event.target.files, category);
                    event.target.value = '';
                }}
            />
        </div>
    );

    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            <div className="absolute inset-0 bg-black/20" onClick={onClose} />

            <div className={`relative flex max-h-[80vh] w-[720px] flex-col rounded-2xl shadow-2xl ${isDark ? 'border border-neutral-700 bg-[#1a1a1a]' : 'border border-neutral-200 bg-white'}`}>
                <div className={`flex items-center justify-between border-b px-6 pt-5 pb-4 ${isDark ? 'border-neutral-800' : 'border-neutral-100'}`}>
                    <div>
                        <h2 className={`text-lg font-bold ${isDark ? 'text-white' : 'text-neutral-900'}`}>
                            {isFrameSlotMode ? `选择${frameSlotLabel}图片` : '素材库'}
                        </h2>
                        <span className={`text-xs ${isDark ? 'text-neutral-500' : 'text-neutral-500'}`}>
                            {isFrameSlotMode
                                ? `仅支持图片，选择后替换${frameSlotLabel}`
                                : assetSource === 'xiaolou'
                                    ? '当前项目素材库'
                                    : '本地素材库'}
                        </span>
                    </div>
                    <button
                        onClick={onClose}
                        className={`rounded-lg p-1 transition-colors ${isDark ? 'text-neutral-400 hover:bg-neutral-800 hover:text-white' : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700'}`}
                    >
                        <X size={20} />
                    </button>
                </div>

                {hasProjectAssetBridge ? (
                    <div className={`border-b px-6 pt-4 pb-1 ${isDark ? 'border-neutral-800' : 'border-neutral-100'}`}>
                        <div className="flex gap-2">
                            {([
                                { id: 'local', label: '本地素材库' },
                                { id: 'xiaolou', label: '项目素材库' },
                            ] as const).map((item) => (
                                <button
                                    key={item.id}
                                    onClick={() => setAssetSource(item.id)}
                                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                                        assetSource === item.id
                                            ? isDark ? 'border-white bg-neutral-100 text-black' : 'border-neutral-900 bg-neutral-900 text-white'
                                            : isDark ? 'border-neutral-700 text-neutral-400 hover:border-neutral-500' : 'border-neutral-200 text-neutral-500 hover:border-neutral-300'
                                    }`}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : null}

                <div className={`flex gap-2 overflow-x-auto border-b px-6 pt-4 pb-2 ${isDark ? 'border-neutral-800' : 'border-neutral-100'}`}>
                    {CATEGORIES.map((category) => (
                        <button
                            key={category}
                            onClick={() => setSelectedCategory(category)}
                            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                                selectedCategory === category
                                    ? isDark ? 'border-white bg-neutral-100 text-black' : 'border-neutral-900 bg-neutral-900 text-white'
                                    : isDark ? 'border-neutral-700 text-neutral-400 hover:border-neutral-500' : 'border-neutral-200 text-neutral-500 hover:border-neutral-300'
                            }`}
                        >
                            {category}
                        </button>
                    ))}
                </div>

                <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5" onWheel={(event) => event.stopPropagation()}>
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 size={24} className={`animate-spin ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`} />
                        </div>
                    ) : (
                        <>
                            {renderSection({
                                title: '图片',
                                items: imageAssets,
                                uploadLabel: '上传图片',
                                uploadHint: 'JPG, PNG, WEBP，拖放或点击上传',
                                inputRef: imageInputRef,
                                accept: 'image/*',
                                category: 'Character',
                                emptyProjectMessage: '当前项目素材库里还没有图片，可先在项目资产库中同步素材。',
                            })}

                            {!isFrameSlotMode ? (
                                <>
                                    {renderSection({
                                        title: '视频',
                                        items: videoAssets,
                                        uploadLabel: '上传视频',
                                        uploadHint: 'MP4, MOV, WEBM，最大 50 MB',
                                        inputRef: videoInputRef,
                                        accept: 'video/*',
                                        category: 'Scene',
                                        emptyProjectMessage: '当前项目素材库里还没有视频，可先在项目资产库中同步素材。',
                                    })}

                                    {renderSection({
                                        title: '音频',
                                        items: audioAssets,
                                        uploadLabel: '上传音频',
                                        uploadHint: 'WAV, MP3, OGG，最大 15 MB',
                                        inputRef: audioInputRef,
                                        accept: 'audio/*',
                                        category: 'Sound Effect',
                                        emptyProjectMessage: '项目素材库暂不提供音频素材，请切换到本地素材库上传。',
                                    })}
                                </>
                            ) : null}
                        </>
                    )}
                </div>

                <div className={`flex items-center justify-between border-t px-6 py-4 ${isDark ? 'border-neutral-800' : 'border-neutral-100'}`}>
                    <button className={`flex items-center gap-1 text-sm transition-colors ${isDark ? 'text-neutral-400 hover:text-neutral-200' : 'text-neutral-500 hover:text-neutral-700'}`}>
                        素材要求说明
                        <ChevronRight size={14} />
                    </button>
                    <button
                        onClick={onClose}
                        className={`rounded-xl px-6 py-2 text-sm font-medium transition-colors ${
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
