import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, Trash2, X } from 'lucide-react';
import {
  canUseXiaolouAssetBridge,
  deleteXiaolouAsset,
  listXiaolouAssets,
  type XiaolouAssetLibraryItem,
} from '../integrations/xiaolouAssetBridge';
import { buildCanvasApiUrl, resolveCanvasMediaUrl } from '../integrations/twitcanvaRuntimePaths';

type LibraryAsset = {
  id: string;
  name: string;
  category: string;
  url: string;
  previewUrl?: string;
  type: 'image' | 'video';
  description?: string;
};

type AssetLibrarySource = 'local' | 'xiaolou';

interface AssetLibraryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectAsset: (url: string, type: 'image' | 'video') => void;
  panelY?: number;
  variant?: 'panel' | 'modal';
  canvasTheme?: 'dark' | 'light';
}

const CATEGORIES = ['All', 'Character', 'Scene', 'Item', 'Style', 'Sound Effect', 'Others'];

function normalizeLocalAsset(asset: any): LibraryAsset {
  return {
    id: String(asset?.id || ''),
    name: String(asset?.name || 'Asset'),
    category: String(asset?.category || 'Others'),
    url: resolveCanvasMediaUrl(String(asset?.url || '')),
    previewUrl:
      typeof asset?.previewUrl === 'string' ? resolveCanvasMediaUrl(asset.previewUrl) : undefined,
    type: asset?.type === 'video' ? 'video' : 'image',
    description: typeof asset?.description === 'string' ? asset.description : undefined,
  };
}

function normalizeBridgeAsset(asset: XiaolouAssetLibraryItem): LibraryAsset {
  return {
    id: asset.id,
    name: asset.name,
    category: asset.category,
    url: asset.url,
    previewUrl: asset.previewUrl,
    type: asset.type,
    description: asset.description,
  };
}

export const AssetLibraryPanel: React.FC<AssetLibraryPanelProps> = ({
  isOpen,
  onClose,
  onSelectAsset,
  panelY = 100,
  variant = 'panel',
  canvasTheme = 'dark',
}) => {
  const isDark = canvasTheme === 'dark';
  const hasProjectAssetBridge = canUseXiaolouAssetBridge();

  const [selectedCategory, setSelectedCategory] = useState('All');
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [assetSource, setAssetSource] = useState<AssetLibrarySource>('local');

  const fetchLibrary = useCallback(async () => {
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
      if (!response.ok) {
        throw new Error('Failed to load local library assets.');
      }

      const localAssets = ((await response.json()) as any[]).map(normalizeLocalAsset);
      setAssets(localAssets);
    } catch (error) {
      console.error('Failed to load library assets:', error);
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, [assetSource, hasProjectAssetBridge]);

  useEffect(() => {
    if (!isOpen) return;
    void fetchLibrary();
  }, [fetchLibrary, isOpen]);

  const handleDeleteAsset = useCallback(async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();

    try {
      if (assetSource === 'xiaolou') {
        await deleteXiaolouAsset(id);
      } else {
        const response = await fetch(buildCanvasApiUrl(`/library/${id}`), {
          method: 'DELETE',
        });

        if (!response.ok) {
          throw new Error('Failed to delete local library asset.');
        }
      }

      setAssets((current) => current.filter((asset) => asset.id !== id));
    } catch (error) {
      console.error('Delete error:', error);
    }
  }, [assetSource]);

  if (!isOpen) {
    return null;
  }

  const headerTitle = assetSource === 'xiaolou' ? '项目素材库' : '本地素材库';
  const headerSubtitle =
    assetSource === 'xiaolou' ? '选择当前项目中已同步的素材' : '选择画布本地素材库中的素材';

  const body = (
    <AssetLibraryContent
      selectedCategory={selectedCategory}
      setSelectedCategory={setSelectedCategory}
      assets={assets}
      loading={loading}
      assetSource={assetSource}
      hasProjectAssetBridge={hasProjectAssetBridge}
      onSourceChange={setAssetSource}
      onSelectAsset={onSelectAsset}
      onDeleteAsset={handleDeleteAsset}
      canvasTheme={canvasTheme}
    />
  );

  if (variant === 'modal') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
        <div
          className={`flex h-[600px] w-[800px] flex-col overflow-hidden rounded-2xl border shadow-2xl transition-colors duration-300 ${isDark ? 'border-neutral-800 bg-[#0a0a0a]' : 'border-neutral-200 bg-white'}`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className={`flex items-center justify-between border-b p-4 ${isDark ? 'border-neutral-800' : 'border-neutral-200'}`}>
            <div className="pl-2">
              <h2 className={`text-lg font-medium ${isDark ? 'text-white' : 'text-neutral-900'}`}>
                {headerTitle}
              </h2>
              <div className="text-xs text-neutral-500">{headerSubtitle}</div>
            </div>
            <button
              onClick={onClose}
              className={`rounded-lg p-2 transition-colors ${isDark ? 'text-neutral-400 hover:bg-neutral-800 hover:text-white' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900'}`}
            >
              <X size={20} />
            </button>
          </div>
          {body}
        </div>
        <div className="absolute inset-0 -z-10" onClick={onClose} />
      </div>
    );
  }

  return (
    <div
      className={`fixed z-[55] flex flex-col overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-xl transition-colors duration-200 ${isDark ? 'border-neutral-800 bg-[#0a0a0a]/95' : 'border-neutral-200 bg-white/95'}`}
      style={{
        bottom: '5.5rem',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(700px, calc(100vw - 2rem))',
        maxHeight: 'min(500px, calc(100vh - 7rem))',
      }}
    >
      <div className={`flex items-start justify-between gap-3 border-b px-4 py-3 ${isDark ? 'border-neutral-800' : 'border-neutral-200'}`}>
        <div className="min-w-0">
          <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-neutral-900'}`}>
            {headerTitle}
          </div>
          <div className="text-xs text-neutral-500">{headerSubtitle}</div>
        </div>
        <button
          type="button"
          aria-label="关闭素材库"
          onClick={onClose}
          className={`shrink-0 rounded-lg p-2 transition-colors ${isDark ? 'text-neutral-400 hover:bg-neutral-800 hover:text-white' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900'}`}
        >
          <X size={18} />
        </button>
      </div>
      {body}
    </div>
  );
};

type AssetLibraryContentProps = {
  selectedCategory: string;
  setSelectedCategory: React.Dispatch<React.SetStateAction<string>>;
  assets: LibraryAsset[];
  loading: boolean;
  assetSource: AssetLibrarySource;
  hasProjectAssetBridge: boolean;
  onSourceChange: React.Dispatch<React.SetStateAction<AssetLibrarySource>>;
  onSelectAsset: (url: string, type: 'image' | 'video') => void;
  onDeleteAsset: (id: string, event: React.MouseEvent) => Promise<void>;
  canvasTheme?: 'dark' | 'light';
};

const AssetLibraryContent: React.FC<AssetLibraryContentProps> = ({
  selectedCategory,
  setSelectedCategory,
  assets,
  loading,
  assetSource,
  hasProjectAssetBridge,
  onSourceChange,
  onSelectAsset,
  onDeleteAsset,
  canvasTheme = 'dark',
}) => {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const isDark = canvasTheme === 'dark';

  const filteredAssets = useMemo(
    () => assets.filter((asset) => selectedCategory === 'All' || asset.category === selectedCategory),
    [assets, selectedCategory],
  );

  const handleDeleteClick = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    setDeleteConfirmId(id);
  };

  const handleConfirmDelete = (event: React.MouseEvent, id: string) => {
    void onDeleteAsset(id, event);
    setDeleteConfirmId(null);
  };

  const handleCancelDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    setDeleteConfirmId(null);
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-4">
      {hasProjectAssetBridge ? (
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto pb-1">
          {([
            { id: 'local', label: '本地素材库' },
            { id: 'xiaolou', label: '项目素材库' },
          ] as const).map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => onSourceChange(item.id)}
              className={`inline-flex h-8 min-w-[104px] shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-4 text-center text-xs font-medium leading-none transition-colors ${
                assetSource === item.id
                  ? isDark
                    ? 'border-white bg-neutral-100 text-black'
                    : 'border-neutral-900 bg-neutral-900 text-white'
                  : isDark
                    ? 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-600'
                    : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex shrink-0 gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {CATEGORIES.map((category) => (
          <button
            key={category}
            onClick={() => setSelectedCategory(category)}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              selectedCategory === category
                ? isDark
                  ? 'border-white bg-neutral-100 text-black'
                  : 'border-neutral-900 bg-neutral-900 text-white'
                : isDark
                  ? 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-600'
                  : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'
            }`}
          >
            {category}
          </button>
        ))}
      </div>

      <div
        className="grid flex-1 grid-cols-4 content-start gap-3 overflow-y-auto pb-4 pr-2"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: isDark ? '#525252 #171717' : '#d4d4d4 #fafafa',
        }}
      >
        {loading ? (
          <div className="col-span-full py-10 text-center text-neutral-500">加载中...</div>
        ) : filteredAssets.length === 0 ? (
          <div className="col-span-full py-10 text-center text-sm text-neutral-500">
            {assetSource === 'xiaolou' ? '当前项目素材库里还没有可用素材。' : '本地素材库当前分类下暂无素材。'}
          </div>
        ) : (
          filteredAssets.map((asset) => {
            const previewUrl = asset.previewUrl || asset.url;

            return (
              <div
                key={asset.id}
                className={`group relative aspect-square cursor-pointer overflow-hidden rounded-lg border ${
                  isDark
                    ? 'border-neutral-800 bg-neutral-900 hover:border-neutral-600'
                    : 'border-neutral-200 bg-neutral-50 hover:border-neutral-300'
                }`}
                onClick={() => onSelectAsset(asset.url, asset.type)}
              >
                {asset.type === 'video' ? (
                  <>
                    <video
                      src={previewUrl}
                      className="h-full w-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                    />
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
                      <div className="rounded-full bg-black/55 p-2 text-white">
                        <Play size={16} fill="currentColor" />
                      </div>
                    </div>
                  </>
                ) : (
                  <img
                    src={previewUrl}
                    alt={asset.name}
                    className="h-full w-full object-cover"
                    onError={(event) => {
                      const target = event.target as HTMLImageElement;
                      target.onerror = null;
                      target.src =
                        'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMzMzMiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cmVjdCB4PSIzIiB5PSIzIiB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHJ4PSIyIiByeT0iMiI+PC9yZWN0PjxjaXJjbGUgY3g9IjguNSIgY3k9IjguNSIgcj0iMS41Ij48L2NpcmNsZT48cG9seWxpbmUgcG9pbnRzPSIyMSAxNSAxNiAxMCA1IDIxIj48L3BvbHlsaW5lPjwvc3ZnPg==';
                      target.classList.add('p-8', 'opacity-50');
                    }}
                  />
                )}

                <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="truncate text-xs font-medium text-white">{asset.name}</span>
                  <span className="truncate text-[10px] text-neutral-300">{asset.category}</span>
                </div>

                {deleteConfirmId === asset.id ? (
                  <div
                    className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/80"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="text-xs text-white">删除该素材？</div>
                    <div className="flex gap-2">
                      <button
                        className="rounded bg-red-500 px-2 py-1 text-xs text-white hover:bg-red-600"
                        onClick={(event) => handleConfirmDelete(event, asset.id)}
                      >
                        删除
                      </button>
                      <button
                        className="rounded bg-neutral-700 px-2 py-1 text-xs text-white hover:bg-neutral-600"
                        onClick={handleCancelDelete}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="absolute right-1.5 top-1.5 z-10 rounded-md bg-black/60 p-1.5 text-white opacity-0 transition-opacity hover:bg-red-500/80 group-hover:opacity-100"
                    onClick={(event) => handleDeleteClick(event, asset.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
