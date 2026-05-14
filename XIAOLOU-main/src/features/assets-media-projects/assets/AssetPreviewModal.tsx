import { Sparkles, X } from "lucide-react";
import { GeneratedMediaPlaceholder } from "../media/GenerationPlaceholder";
import type { Asset } from "./api/assets";
import {
  assetMediaUrl,
  assetPreviewUrl,
  canPreviewAssetVideo,
  imageAssetTypeLabel,
  isVideoAsset,
  isVideoReplaceAsset,
  videoAssetSubLabel,
} from "./assetDisplay";

type AssetPreviewModalProps = {
  asset: Asset;
  onClose: () => void;
  onOpenVideoReplace: (asset: Asset) => void;
};

export function AssetPreviewModal({
  asset,
  onClose,
  onOpenVideoReplace,
}: AssetPreviewModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-4xl rounded-2xl border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold">{asset.name}</h3>
            <p className="text-xs text-muted-foreground">
              {isVideoAsset(asset)
                ? `视频资产 · 来源：${videoAssetSubLabel(asset)}`
                : `图片资产 · ${imageAssetTypeLabel(asset.assetType)}`}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-2 transition-colors hover:bg-accent">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="overflow-hidden rounded-xl border border-border bg-black">
            {canPreviewAssetVideo(asset) ? (
              <video
                src={assetMediaUrl(asset) || undefined}
                poster={assetPreviewUrl(asset) || undefined}
                controls
                className="h-full min-h-[320px] w-full object-contain"
              />
            ) : assetPreviewUrl(asset) ? (
              <img
                src={assetPreviewUrl(asset) || undefined}
                alt={asset.name}
                className="h-full min-h-[320px] w-full object-contain"
                referrerPolicy="no-referrer"
              />
            ) : (
              <GeneratedMediaPlaceholder
                kind={isVideoAsset(asset) ? "video" : "image"}
                className="h-full min-h-[320px] w-full bg-black text-zinc-300"
                description="当前资产还没有可预览的真实媒体"
              />
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-border p-4">
              <div className="text-xs text-muted-foreground">资产类型</div>
              <div className="mt-1 font-medium">
                {isVideoAsset(asset) ? "视频素材" : imageAssetTypeLabel(asset.assetType)}
              </div>
            </div>
            {isVideoAsset(asset) ? (
              <div className="rounded-lg border border-border p-4">
                <div className="text-xs text-muted-foreground">来源模块</div>
                <div className="mt-1 font-medium">{videoAssetSubLabel(asset)}</div>
              </div>
            ) : null}
            <div className="rounded-lg border border-border p-4">
              <div className="text-xs text-muted-foreground">描述</div>
              <div className="mt-1 text-sm leading-6">{asset.description || "暂无描述"}</div>
            </div>
            {isVideoAsset(asset) ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenVideoReplace(asset);
                }}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
              >
                <Sparkles className="h-4 w-4" />
                {isVideoReplaceAsset(asset) ? "继续人物替换" : "人物替换"}
              </button>
            ) : null}
            {assetMediaUrl(asset) ? (
              <a
                href={assetMediaUrl(asset) || undefined}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                打开原始文件
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
