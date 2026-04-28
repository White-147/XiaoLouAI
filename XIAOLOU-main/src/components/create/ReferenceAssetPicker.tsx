import { Check, Film, Image as ImageIcon, LoaderCircle, Search } from "lucide-react";
import { type DragEvent, useEffect, useMemo, useState } from "react";
import { listAssets, type Asset } from "../../lib/api";
import {
  GeneratedMediaPlaceholder,
  getGeneratedMediaUrl,
} from "../media/GenerationPlaceholder";
import { cn } from "../../lib/utils";

export const REFERENCE_ASSET_MIME = "application/x-xiaolou-reference-asset";

export type ReferenceAssetMediaKind = "image" | "video";

export type ReferenceAssetSelection = {
  id: string;
  name: string;
  /** The URL used by the caller's pipeline — for video this is mediaUrl,
   *  for image this is previewUrl/mediaUrl. Always absolute or /-relative. */
  url: string;
  previewUrl: string;
  assetType: string;
  description: string;
  mediaKind: ReferenceAssetMediaKind;
};

type ReferenceAssetPickerProps = {
  projectId: string;
  selectedAssetId?: string | null;
  selectedAssetIds?: string[];
  /** 不在列表中展示的资产（例如避免把当前编辑项选为自己的参考图） */
  excludeAssetIds?: string[];
  /** Filter by media kind. Default 'image'. */
  mediaKind?: ReferenceAssetMediaKind;
  /** 区块标题，默认按 mediaKind 推断 */
  heading?: string;
  /** 说明文案 */
  hint?: string;
  onSelect: (asset: ReferenceAssetSelection) => void;
  onToggleSelect?: (asset: ReferenceAssetSelection, selected: boolean) => void;
};

const IMAGE_ASSET_FILTERS = [
  { id: "all", label: "全部" },
  { id: "character", label: "角色" },
  { id: "scene", label: "场景" },
  { id: "prop", label: "道具" },
  { id: "style", label: "风格" },
] as const;

const VIDEO_ASSET_FILTERS = [{ id: "all", label: "全部" }] as const;

function assetPreviewUrl(asset: Asset) {
  return getGeneratedMediaUrl(asset.previewUrl) || getGeneratedMediaUrl(asset.mediaUrl) || null;
}

function assetMediaUrl(asset: Asset) {
  return getGeneratedMediaUrl(asset.mediaUrl) || null;
}

function canUseAsReference(asset: Asset, kind: ReferenceAssetMediaKind): boolean {
  if (kind === "video") {
    // For video references the only hard requirement is a playable mediaUrl.
    // A cover thumbnail (previewUrl) is desirable for display but must NOT be
    // a usability gate: Veo-generated videos frequently have thumbnailUrl=null
    // and would otherwise be silently invisible in the picker.
    return asset.mediaKind === "video" && Boolean(assetMediaUrl(asset));
  }
  // Image mode: we need a displayable preview URL AND the asset must not be a video.
  if (!assetPreviewUrl(asset)) return false;
  return asset.mediaKind !== "video" && asset.assetType !== "video_ref";
}

function toReferenceSelection(
  asset: Asset,
  kind: ReferenceAssetMediaKind,
): ReferenceAssetSelection | null {
  if (kind === "video") {
    const videoUrl = assetMediaUrl(asset);
    if (!videoUrl) return null;
    // previewUrl may be null for Veo-generated videos (thumbnailUrl is often absent).
    // Use the video URL itself as a fallback so the caller always has a non-empty string.
    const preview = assetPreviewUrl(asset) || videoUrl;
    return {
      id: asset.id,
      name: asset.name,
      url: videoUrl,
      previewUrl: preview,
      assetType: asset.assetType,
      description: asset.description,
      mediaKind: kind,
    };
  }

  // Image mode: show a preview, but send the original media URL when available.
  const previewUrl = assetPreviewUrl(asset);
  const imageUrl = assetMediaUrl(asset) || previewUrl;
  if (!imageUrl) return null;
  return {
    id: asset.id,
    name: asset.name,
    url: imageUrl,
    previewUrl: previewUrl || imageUrl,
    assetType: asset.assetType,
    description: asset.description,
    mediaKind: kind,
  };
}

function assetTypeLabel(assetType: string, filters: readonly { id: string; label: string }[]) {
  const match = filters.find((item) => item.id === assetType);
  return match?.label || assetType;
}

export function ReferenceAssetPicker({
  projectId,
  selectedAssetId = null,
  selectedAssetIds = [],
  excludeAssetIds = [],
  mediaKind = "image",
  heading,
  hint,
  onSelect,
  onToggleSelect,
}: ReferenceAssetPickerProps) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const isVideo = mediaKind === "video";
  const assetFilters = isVideo ? VIDEO_ASSET_FILTERS : IMAGE_ASSET_FILTERS;
  const resolvedHeading = heading ?? (isVideo ? "资产库视频" : "资产库参考图");
  const resolvedHint =
    hint ??
    (isVideo
      ? "选中后作为源视频导入本次任务。"
      : "点击缩略图直接设为参考图，也可以拖到上方参考图区。");

  const [filter, setFilter] = useState<string>("all");
  useEffect(() => {
    setFilter("all");
  }, [mediaKind]);

  useEffect(() => {
    let cancelled = false;

    const loadAssets = async () => {
      setLoading(true);
      try {
        const response = await listAssets(projectId);
        if (!cancelled) {
          setAssets(response.items);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadAssets();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const excludeSet = useMemo(() => new Set(excludeAssetIds.filter(Boolean)), [excludeAssetIds]);
  const selectedSet = useMemo(
    () => new Set([selectedAssetId, ...selectedAssetIds].filter(Boolean)),
    [selectedAssetId, selectedAssetIds],
  );

  const referenceAssets = useMemo(
    () =>
      assets.filter(
        (asset) => canUseAsReference(asset, mediaKind) && !excludeSet.has(asset.id),
      ),
    [assets, excludeSet, mediaKind],
  );

  const filteredAssets = useMemo(() => {
    return referenceAssets.filter((asset) => {
      const matchFilter = filter === "all" || asset.assetType === filter;
      const matchQuery =
        !query ||
        asset.name.includes(query) ||
        asset.description.includes(query) ||
        asset.assetType.includes(query);

      return matchFilter && matchQuery;
    });
  }, [filter, query, referenceAssets]);

  const handleSelect = (asset: Asset) => {
    const selection = toReferenceSelection(asset, mediaKind);
    if (!selection) return;
    if (onToggleSelect) {
      onToggleSelect(selection, !selectedSet.has(asset.id));
      return;
    }
    onSelect(selection);
  };

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, asset: Asset) => {
    const selection = toReferenceSelection(asset, mediaKind);
    if (!selection) return;

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(REFERENCE_ASSET_MIME, JSON.stringify(selection));
    event.dataTransfer.setData("text/plain", selection.id);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-foreground">{resolvedHeading}</div>
          <div className="text-[11px] text-muted-foreground">{resolvedHint}</div>
        </div>
        {loading ? (
          <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
        ) : (
          <div className="text-[11px] text-muted-foreground">
            {referenceAssets.length} {isVideo ? "段可用" : "张可用"}
          </div>
        )}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={isVideo ? "搜索视频名称或描述" : "搜索角色、场景、道具"}
          className="w-full rounded-lg border border-border bg-input py-2 pl-9 pr-3 text-sm transition-shadow focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {assetFilters.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              filter === item.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="max-h-72 overflow-y-auto rounded-2xl border border-border bg-card/35 p-2 custom-scrollbar">
        {filteredAssets.length ? (
          <div className="grid grid-cols-2 gap-2">
            {filteredAssets.map((asset) => {
              const previewUrl = assetPreviewUrl(asset);
              const selected = selectedSet.has(asset.id);

              return (
                <button
                  key={asset.id}
                  type="button"
                  draggable
                  onClick={() => handleSelect(asset)}
                  onDragStart={(event) => handleDragStart(event, asset)}
                  className={cn(
                    "group overflow-hidden rounded-xl border text-left transition-all",
                    selected
                      ? "border-primary bg-primary/10 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]"
                      : "border-border bg-background/60 hover:border-primary/35 hover:bg-accent/50",
                  )}
                >
                  <div className="relative aspect-square overflow-hidden bg-muted/30">
                    {previewUrl && !isVideo ? (
                      <img
                        src={previewUrl}
                        alt={asset.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                        referrerPolicy="no-referrer"
                      />
                    ) : isVideo ? (
                      // Video asset: show thumbnail if available, otherwise Film icon placeholder
                      previewUrl && !previewUrl.match(/\.(mp4|webm|mov|mkv|avi)(\?|$)/i) ? (
                        <img
                          src={previewUrl}
                          alt={asset.name}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted/50">
                          <Film className="h-8 w-8 text-muted-foreground/60" />
                          <span className="px-2 text-center text-[10px] leading-tight text-muted-foreground line-clamp-2">
                            {asset.name}
                          </span>
                        </div>
                      )
                    ) : (
                      <GeneratedMediaPlaceholder
                        kind="image"
                        compact
                        className="h-full w-full"
                        description="暂无可用预览"
                      />
                    )}
                    <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
                      {isVideo ? <Film className="h-3 w-3" /> : null}
                      {assetTypeLabel(asset.assetType, assetFilters)}
                    </div>
                    {selected ? (
                      <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
                        <Check className="h-3.5 w-3.5" />
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-1 px-3 py-2">
                    <div className="line-clamp-1 text-xs font-medium text-foreground">{asset.name}</div>
                    <div className="line-clamp-2 min-h-[2rem] text-[11px] leading-4 text-muted-foreground">
                      {asset.description || "点击选中，或拖入参考图区。"}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background/40 px-4 py-6 text-center">
            {isVideo ? (
              <Film className="h-6 w-6 text-muted-foreground" />
            ) : (
              <ImageIcon className="h-6 w-6 text-muted-foreground" />
            )}
            <div className="text-sm font-medium text-foreground">
              {isVideo ? "当前项目暂无可用视频资产" : "没有可用参考图"}
            </div>
            <div className="max-w-[16rem] text-[11px] leading-5 text-muted-foreground">
              {isVideo
                ? "这里只展示当前项目下真实存在的视频资产。也可以继续用本地上传。"
                : "资产库里有真实预览图的角色、场景、道具会显示在这里。你也可以继续用本地上传。"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
