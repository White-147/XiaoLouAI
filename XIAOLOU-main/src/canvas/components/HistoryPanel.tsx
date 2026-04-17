/**
 * HistoryPanel.tsx
 *
 * Panel for browsing generated image and video history.
 * Assets are grouped by date and displayed in a grid.
 * Clicking an asset applies it to the selected node.
 *
 * Uses infinite scroll with pagination for performance.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowUpToLine, Loader2, Trash2, Maximize2, Image as ImageIcon, Video } from 'lucide-react';
import { canUseXiaolouAssetBridge } from '../integrations/xiaolouAssetBridge';
import type { CanvasProjectAssetSyncDraft } from './modals/ProjectAssetSyncModal';
import {
    buildCanvasApiUrl,
    resolveCanvasMediaUrl,
} from '../integrations/twitcanvaRuntimePaths';

const PAGE_SIZE = 18;

interface AssetMetadata {
    id: string;
    filename: string;
    prompt: string;
    createdAt: string;
    type: string;
    url: string;
    model?: string;
    aspectRatio?: string;
    previewUrl?: string;
    sourceTaskId?: string | null;
}

interface HistoryPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectAsset: (type: 'images' | 'videos', url: string, prompt: string, model?: string) => void;
    onOpenProjectAssetSync?: (draft: CanvasProjectAssetSyncDraft) => void;
    canvasTheme?: 'dark' | 'light';
}

export const HistoryPanel: React.FC<HistoryPanelProps> = ({
    isOpen,
    onClose,
    onSelectAsset,
    onOpenProjectAssetSync,
    canvasTheme = 'dark'
}) => {
    const [activeTab, setActiveTab] = useState<'images' | 'videos'>('images');
    const [assets, setAssets] = useState<AssetMetadata[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [offset, setOffset] = useState(0);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [imageTotalCount, setImageTotalCount] = useState(0);
    const [videoTotalCount, setVideoTotalCount] = useState(0);

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const loadMoreTriggerRef = useRef<HTMLDivElement>(null);
    const isDark = canvasTheme === 'dark';

    useEffect(() => {
        if (!isOpen) return;
        setAssets([]);
        setOffset(0);
        setHasMore(true);
        void fetchAssets(0, true);
        void fetchCounts();
    }, [isOpen, activeTab]);

    const fetchCounts = async () => {
        try {
            const [imgRes, vidRes] = await Promise.all([
                fetch(buildCanvasApiUrl('/assets/images?limit=1')),
                fetch(buildCanvasApiUrl('/assets/videos?limit=1')),
            ]);

            if (imgRes.ok) {
                const imgData = await imgRes.json();
                setImageTotalCount(imgData.total || 0);
            }

            if (vidRes.ok) {
                const vidData = await vidRes.json();
                setVideoTotalCount(vidData.total || 0);
            }
        } catch (error) {
            console.error('Failed to fetch asset counts:', error);
        }
    };

    useEffect(() => {
        if (!loadMoreTriggerRef.current || loading) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const target = entries[0];
                if (target.isIntersecting && hasMore && !loadingMore && !loading) {
                    void loadMoreAssets();
                }
            },
            { threshold: 0.1, root: scrollContainerRef.current },
        );

        observer.observe(loadMoreTriggerRef.current);
        return () => observer.disconnect();
    }, [hasMore, loadingMore, loading, offset]);

    const fetchAssets = async (pageOffset: number, isInitial = false) => {
        if (isInitial) {
            setLoading(true);
        } else {
            setLoadingMore(true);
        }

        try {
            const response = await fetch(
                buildCanvasApiUrl(`/assets/${activeTab}?limit=${PAGE_SIZE}&offset=${pageOffset}`),
            );
            if (!response.ok) return;

            const data = await response.json();
            const nextAssets = Array.isArray(data.assets) ? data.assets : [];
            setAssets((prev) => (isInitial ? nextAssets : [...prev, ...nextAssets]));
            setHasMore(Boolean(data.hasMore));
            setOffset(pageOffset + nextAssets.length);

            if (activeTab === 'images') {
                setImageTotalCount(data.total || 0);
            } else {
                setVideoTotalCount(data.total || 0);
            }
        } catch (error) {
            console.error('Failed to fetch assets:', error);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    };

    const loadMoreAssets = useCallback(async () => {
        if (!loadingMore && hasMore) {
            await fetchAssets(offset, false);
        }
    }, [offset, loadingMore, hasMore, activeTab]);

    const handleDelete = async (id: string) => {
        try {
            const response = await fetch(buildCanvasApiUrl(`/assets/${activeTab}/${id}`), {
                method: 'DELETE',
            });
            if (response.ok) {
                setAssets((prev) => prev.filter((asset) => asset.id !== id));
                if (activeTab === 'images') {
                    setImageTotalCount((prev) => prev - 1);
                } else {
                    setVideoTotalCount((prev) => prev - 1);
                }
            }
        } catch (error) {
            console.error('Failed to delete asset:', error);
        }
        setDeleteConfirm(null);
    };

    const handleSelectAsset = (asset: AssetMetadata) => {
        onSelectAsset(activeTab, resolveCanvasMediaUrl(asset.url), asset.prompt || '', asset.model);
    };

    const handleSyncToProjectAssets = (asset: AssetMetadata, event: React.MouseEvent) => {
        event.stopPropagation();
        if (!onOpenProjectAssetSync) return;

        const mediaKind = activeTab === 'images' ? 'image' : 'video';
        const mediaUrl = resolveCanvasMediaUrl(asset.url);
        const previewUrl = mediaKind === 'image'
            ? mediaUrl
            : asset.previewUrl
                ? resolveCanvasMediaUrl(asset.previewUrl)
                : mediaUrl;

        onOpenProjectAssetSync({
            id: asset.id,
            mediaKind,
            previewUrl,
            mediaUrl,
            prompt: asset.prompt || '',
            model: asset.model || '',
            aspectRatio: asset.aspectRatio || 'Auto',
            sourceTaskId: asset.sourceTaskId || null,
            defaultAssetType: mediaKind === 'video' ? 'video_ref' : 'style',
            defaultName: buildAssetName(asset),
            defaultDescription: asset.prompt || '',
        });
    };

    const groupedAssets = assets.reduce((groups, asset) => {
        const date = new Date(asset.createdAt).toLocaleDateString('en-CA');
        if (!groups[date]) {
            groups[date] = [];
        }
        groups[date].push(asset);
        return groups;
    }, {} as Record<string, AssetMetadata[]>);

    const sortedDates = Object.keys(groupedAssets).sort(
        (a, b) => new Date(b).getTime() - new Date(a).getTime(),
    );

    if (!isOpen) return null;

    const showXiaolouSync = canUseXiaolouAssetBridge() && Boolean(onOpenProjectAssetSync);

    return (
        <>
            <div
                className={`fixed z-[55] flex max-h-[min(500px,calc(100vh-7rem))] w-[min(700px,calc(100vw-2rem))] translate-x-[-50%] flex-col overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-xl transition-colors duration-300 ${isDark ? 'border-neutral-800 bg-[#0a0a0a]/95' : 'border-neutral-200 bg-white/95'}`}
                style={{ bottom: '5.5rem', left: '50%' }}
            >
                <div className={`flex items-center justify-between border-b px-5 py-4 ${isDark ? 'border-neutral-800' : 'border-neutral-200'}`}>
                    <div className="flex items-center gap-6">
                        <button
                            className={`flex items-center gap-2 border-b-2 pb-1 text-sm font-medium transition-colors ${activeTab === 'images'
                                ? isDark ? 'border-white text-white' : 'border-neutral-900 text-neutral-900'
                                : isDark ? 'border-transparent text-neutral-500 hover:text-white' : 'border-transparent text-neutral-400 hover:text-neutral-900'}`}
                            onClick={() => setActiveTab('images')}
                        >
                            <ImageIcon size={16} />
                            Image History ({imageTotalCount})
                        </button>
                        <button
                            className={`flex items-center gap-2 border-b-2 pb-1 text-sm font-medium transition-colors ${activeTab === 'videos'
                                ? isDark ? 'border-white text-white' : 'border-neutral-900 text-neutral-900'
                                : isDark ? 'border-transparent text-neutral-500 hover:text-white' : 'border-transparent text-neutral-400 hover:text-neutral-900'}`}
                            onClick={() => setActiveTab('videos')}
                        >
                            <Video size={16} />
                            Video History ({videoTotalCount})
                        </button>
                    </div>
                    <button
                        onClick={onClose}
                        className={`transition-colors ${isDark ? 'text-neutral-500 hover:text-white' : 'text-neutral-400 hover:text-neutral-900'}`}
                    >
                        <Maximize2 size={18} />
                    </button>
                </div>

                <div
                    ref={scrollContainerRef}
                    className="flex-1 overflow-y-auto p-4"
                    style={{
                        scrollbarWidth: 'thin',
                        scrollbarColor: isDark ? '#525252 #171717' : '#d4d4d4 #fafafa',
                    }}
                >
                    {loading ? (
                        <div className="flex h-40 items-center justify-center">
                            <Loader2 className="animate-spin text-neutral-500" size={24} />
                        </div>
                    ) : assets.length === 0 ? (
                        <div className={`flex h-40 flex-col items-center justify-center ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                            <div className={`mb-3 flex h-16 w-16 items-center justify-center rounded-full ${isDark ? 'bg-neutral-800' : 'bg-neutral-100'}`}>
                                {activeTab === 'images' ? <ImageIcon size={24} /> : <Video size={24} />}
                            </div>
                            <p>No {activeTab} found</p>
                            <p className="mt-1 text-xs">Generated {activeTab} will appear here</p>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {sortedDates.map((date) => (
                                <div key={date}>
                                    <h3 className={`mb-3 text-sm ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>{date}</h3>
                                    <div className="grid grid-cols-3 gap-3">
                                        {groupedAssets[date].map((asset) => (
                                            <div
                                                key={asset.id}
                                                onClick={() => handleSelectAsset(asset)}
                                                className={`group relative aspect-square cursor-pointer overflow-hidden rounded-xl transition-all ${isDark ? 'bg-neutral-900' : 'bg-neutral-100'}`}
                                            >
                                                {activeTab === 'images' ? (
                                                    <img
                                                        src={resolveCanvasMediaUrl(asset.url)}
                                                        alt={asset.prompt || 'Generated image'}
                                                        className="h-full w-full object-cover"
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <video
                                                        src={resolveCanvasMediaUrl(asset.url)}
                                                        className="h-full w-full object-cover"
                                                        muted
                                                        preload="metadata"
                                                        onMouseEnter={(event) => event.currentTarget.play()}
                                                        onMouseLeave={(event) => {
                                                            event.currentTarget.pause();
                                                            event.currentTarget.currentTime = 0;
                                                        }}
                                                    />
                                                )}

                                                <button
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        setDeleteConfirm(asset.id);
                                                    }}
                                                    className="absolute right-2 top-2 rounded-lg bg-black/50 p-1.5 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-500"
                                                >
                                                    <Trash2 size={14} className="text-white" />
                                                </button>

                                                {showXiaolouSync ? (
                                                    <button
                                                        onClick={(event) => handleSyncToProjectAssets(asset, event)}
                                                        className="absolute left-2 top-2 flex items-center gap-1 rounded-lg bg-black/55 px-2 py-1.5 text-[11px] font-medium text-white opacity-0 transition-all group-hover:opacity-100 hover:bg-primary"
                                                        title="同步到项目资产库"
                                                    >
                                                        <ArrowUpToLine size={12} />
                                                        同步
                                                    </button>
                                                ) : null}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}

                            {hasMore ? (
                                <div ref={loadMoreTriggerRef} className="flex items-center justify-center py-4">
                                    {loadingMore ? <Loader2 className="animate-spin text-neutral-500" size={20} /> : null}
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>
            </div>

            {deleteConfirm ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className={`w-[340px] rounded-2xl border p-6 shadow-2xl ${isDark ? 'border-neutral-700 bg-[#1a1a1a]' : 'border-neutral-200 bg-white'}`}>
                        <h3 className={`mb-2 text-lg font-semibold ${isDark ? 'text-white' : 'text-neutral-900'}`}>Delete Asset</h3>
                        <p className={`mb-6 text-sm ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
                            Are you sure you want to delete this {activeTab === 'images' ? 'image' : 'video'}? This action cannot be undone.
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setDeleteConfirm(null)}
                                className={`rounded-lg px-4 py-2 text-sm transition-colors ${isDark ? 'bg-neutral-800 text-white hover:bg-neutral-700' : 'bg-neutral-100 text-neutral-900 hover:bg-neutral-200'}`}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => void handleDelete(deleteConfirm)}
                                className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-500"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </>
    );
};

function buildAssetName(asset: AssetMetadata) {
    const source = (asset.prompt || asset.filename || '').replace(/\s+/g, ' ').trim();
    if (!source) {
        return `画布历史素材 ${new Date(asset.createdAt).toLocaleString('zh-CN')}`;
    }
    return source.length > 32 ? `${source.slice(0, 32)}...` : source;
}
