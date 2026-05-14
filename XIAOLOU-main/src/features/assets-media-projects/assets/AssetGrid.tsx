import { type ReactNode } from "react";
import { LoaderCircle, Pencil, Play, Sparkles, Trash2 } from "lucide-react";
import { GeneratedMediaPlaceholder } from "../media/GenerationPlaceholder";
import type { Asset } from "./api/assets";
import type { DateGroup } from "./assetCache";
import {
  assetMediaUrl,
  assetPreviewUrl,
  getAgentCanvasProjectMeta,
  imageAssetTypeLabel,
  isVideoAsset,
  isVideoReplaceAsset,
  videoAssetSubLabel,
} from "./assetDisplay";

type AssetGridVariant = "assets" | "agent-canvas-assets" | "legacy-agent-canvas-project-assets";

type AssetGridProps = {
  dateGroups: DateGroup<Asset>[];
  deletingId: string | null;
  variant: AssetGridVariant;
  renderDateLine: (dateKey: string) => ReactNode;
  onPreviewAsset: (asset: Asset) => void;
  onEditAsset: (asset: Asset) => void;
  onDeleteAsset: (assetId: string) => void | Promise<void>;
  onOpenVideoReplace: (asset: Asset) => void;
  onOpenAgentCanvas: () => void;
};

export function AssetGrid({
  dateGroups,
  deletingId,
  variant,
  renderDateLine,
  onPreviewAsset,
  onEditAsset,
  onDeleteAsset,
  onOpenVideoReplace,
  onOpenAgentCanvas,
}: AssetGridProps) {
  return (
    <div className="space-y-8">
      {dateGroups.map((group) => (
        <section key={group.dateKey} className="space-y-3">
          {renderDateLine(group.dateKey)}
          <div className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-5">
            {group.items.map((asset) =>
              variant === "legacy-agent-canvas-project-assets" ? (
                <LegacyAgentCanvasAssetCard
                  key={asset.id}
                  asset={asset}
                  pendingDelete={deletingId === asset.id}
                  onDeleteAsset={onDeleteAsset}
                  onOpenAgentCanvas={onOpenAgentCanvas}
                />
              ) : (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  pendingDelete={deletingId === asset.id}
                  variant={variant}
                  onPreviewAsset={onPreviewAsset}
                  onEditAsset={onEditAsset}
                  onDeleteAsset={onDeleteAsset}
                  onOpenVideoReplace={onOpenVideoReplace}
                />
              ),
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

type AssetCardProps = {
  asset: Asset;
  pendingDelete: boolean;
  variant: Exclude<AssetGridVariant, "legacy-agent-canvas-project-assets">;
  onPreviewAsset: (asset: Asset) => void;
  onEditAsset: (asset: Asset) => void;
  onDeleteAsset: (assetId: string) => void | Promise<void>;
  onOpenVideoReplace: (asset: Asset) => void;
};

function AssetCard({
  asset,
  pendingDelete,
  variant,
  onPreviewAsset,
  onEditAsset,
  onDeleteAsset,
  onOpenVideoReplace,
}: AssetCardProps) {
  const previewUrl = assetPreviewUrl(asset);

  return (
    <article className="glass-panel group flex flex-col overflow-hidden rounded-xl">
      <div className="relative aspect-square bg-muted">
        <button
          onClick={() => onPreviewAsset(asset)}
          className="absolute inset-0 block h-full w-full overflow-hidden text-left"
        >
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={asset.name}
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
            />
          ) : isVideoAsset(asset) && assetMediaUrl(asset) ? (
            <video
              src={assetMediaUrl(asset) || undefined}
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            <GeneratedMediaPlaceholder
              kind={isVideoAsset(asset) ? "video" : "image"}
              className="h-full w-full"
              description="生成后会在这里显示预览"
            />
          )}
        </button>

        {variant === "agent-canvas-assets" ? (
          <div className="absolute left-2 top-2 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur">
            {isVideoAsset(asset) ? "视频" : "图片"}
          </div>
        ) : isVideoAsset(asset) ? (
          <div className="absolute left-2 top-2 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur">
            {videoAssetSubLabel(asset)}
          </div>
        ) : null}

        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={() => onPreviewAsset(asset)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
            title="预览"
          >
            <Play className="h-4 w-4" />
          </button>
          {isVideoAsset(asset) ? (
            <button
              onClick={() => onOpenVideoReplace(asset)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
              title={isVideoReplaceAsset(asset) ? "继续人物替换" : "人物替换"}
            >
              <Sparkles className="h-4 w-4" />
            </button>
          ) : null}
          <button
            onClick={() => onEditAsset(asset)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
            title="编辑"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => void onDeleteAsset(asset.id)}
            disabled={pendingDelete}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
            title="删除"
          >
            {pendingDelete ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="truncate text-sm font-medium">{asset.name}</h3>
          <span className="rounded bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
            {variant === "agent-canvas-assets"
              ? "智能画布"
              : isVideoAsset(asset)
                ? videoAssetSubLabel(asset)
                : imageAssetTypeLabel(asset.assetType)}
          </span>
        </div>
        <p className="line-clamp-2 flex-1 text-xs text-muted-foreground">
          {asset.description || "暂无描述"}
        </p>
      </div>
    </article>
  );
}

type LegacyAgentCanvasAssetCardProps = {
  asset: Asset;
  pendingDelete: boolean;
  onDeleteAsset: (assetId: string) => void | Promise<void>;
  onOpenAgentCanvas: () => void;
};

function LegacyAgentCanvasAssetCard({
  asset,
  pendingDelete,
  onDeleteAsset,
  onOpenAgentCanvas,
}: LegacyAgentCanvasAssetCardProps) {
  const previewUrl = assetPreviewUrl(asset);
  const metadata = getAgentCanvasProjectMeta(asset);
  const canvasId = typeof metadata.canvasId === "string" ? metadata.canvasId : "";
  const sessionId = typeof metadata.sessionId === "string" ? metadata.sessionId : "";

  return (
    <article className="glass-panel group flex flex-col overflow-hidden rounded-xl">
      <div className="relative aspect-video bg-muted">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={asset.name}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
          />
        ) : (
          <GeneratedMediaPlaceholder
            kind="image"
            label="历史工程"
            className="h-full w-full"
            description="旧入口退役，工程仅保留为资产记录"
          />
        )}

        <div className="absolute left-2 top-2 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur">
          可编辑工程
        </div>

        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={(event) => {
              event.stopPropagation();
              onOpenAgentCanvas();
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
            title="新建智能画布"
          >
            <Sparkles className="h-4 w-4" />
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              void onDeleteAsset(asset.id);
            }}
            disabled={pendingDelete}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
            title="从项目管理中移除"
          >
            {pendingDelete ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="truncate text-sm font-medium">{asset.name}</h3>
          <span className="rounded bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
            历史工程
          </span>
        </div>
        <p className="line-clamp-2 flex-1 text-xs text-muted-foreground">
          {asset.description || "旧入口保存的画布、对话和可编辑工程记录"}
        </p>
        <div className="mt-2 space-y-1 text-[11px] text-muted-foreground/80">
          {canvasId ? <p className="truncate">Canvas: {canvasId}</p> : null}
          {sessionId ? <p className="truncate">Session: {sessionId}</p> : null}
          <p>{new Date(asset.updatedAt || asset.createdAt).toLocaleString("zh-CN")}</p>
        </div>
      </div>
    </article>
  );
}
