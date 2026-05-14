import { type ChangeEvent, type DragEvent } from "react";
import { LoaderCircle, X } from "lucide-react";
import {
  REFERENCE_ASSET_MIME,
  ReferenceAssetPicker,
  type ReferenceAssetSelection,
} from "../../assets-media-projects/reference-assets/ReferenceAssetPicker";
import { getGeneratedMediaUrl } from "../../assets-media-projects/media/GenerationPlaceholder";
import { cn } from "../../../lib/utils";
import type {
  VideoMultiReferenceImages,
  VideoMultiReferenceKey,
} from "./api/create-video";

export type ReferenceImageState = {
  id: string;
  url: string;
  originalName: string;
  source: "upload" | "asset";
  assetId?: string | null;
};

export const MULTI_REF_ORDER: VideoMultiReferenceKey[] = [
  "scene",
  "character",
  "prop",
  "pose",
  "expression",
  "effect",
  "sketch",
];

export const MULTI_REF_LABELS: Record<VideoMultiReferenceKey, string> = {
  scene: "场景",
  character: "角色",
  prop: "道具",
  pose: "姿态图",
  expression: "表情图",
  effect: "特效图",
  sketch: "手绘稿",
};

export type MultiRefSlotState = Record<VideoMultiReferenceKey, ReferenceImageState[]>;

export function createEmptyMultiRefSlots(): MultiRefSlotState {
  return {
    scene: [],
    character: [],
    prop: [],
    pose: [],
    expression: [],
    effect: [],
    sketch: [],
  };
}

export function buildMultiReferencePayload(
  slots: MultiRefSlotState,
): VideoMultiReferenceImages | undefined {
  const out: VideoMultiReferenceImages = {};
  for (const key of MULTI_REF_ORDER) {
    const urls = slots[key].map((item) => item.url).filter(Boolean);
    if (urls.length) out[key] = urls;
  }
  return Object.keys(out).length ? out : undefined;
}

export function appendMultiRefItems(
  current: ReferenceImageState[],
  incoming: ReferenceImageState[],
) {
  const next = [...current];
  const seen = new Set(current.map((item) => `${item.source}:${item.assetId || item.id}:${item.url}`));
  for (const item of incoming) {
    const key = `${item.source}:${item.assetId || item.id}:${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(item);
  }
  return next;
}

type ReferencePreviewState = {
  url: string;
  title: string;
};

type MultiReferenceSlotsProps = {
  projectId: string;
  isActive: boolean;
  slots: MultiRefSlotState;
  assetTarget: VideoMultiReferenceKey | null;
  dropSlot: VideoMultiReferenceKey | null;
  uploadingSlot: VideoMultiReferenceKey | null;
  onSetAssetTarget: (slot: VideoMultiReferenceKey) => void;
  onClearSlot: (slot: VideoMultiReferenceKey) => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>, slot: VideoMultiReferenceKey) => void | Promise<void>;
  onDragOver: (slot: VideoMultiReferenceKey) => (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (slot: VideoMultiReferenceKey) => (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (slot: VideoMultiReferenceKey) => (event: DragEvent<HTMLDivElement>) => void;
  onPreview: (preview: ReferencePreviewState) => void;
  onApplyAsset: (slot: VideoMultiReferenceKey, asset: ReferenceAssetSelection) => void;
  onRemoveAsset: (slot: VideoMultiReferenceKey, assetId: string) => void;
};

export function MultiReferenceSlots({
  projectId,
  isActive,
  slots,
  assetTarget,
  dropSlot,
  uploadingSlot,
  onSetAssetTarget,
  onClearSlot,
  onUpload,
  onDragOver,
  onDragLeave,
  onDrop,
  onPreview,
  onApplyAsset,
  onRemoveAsset,
}: MultiReferenceSlotsProps) {
  const renderSlotRow = (slot: VideoMultiReferenceKey, importVerb: string) => {
    const items = slots[slot];
    const st = items[0] || null;
    const isTarget = assetTarget === slot;
    const dropActive = dropSlot === slot;

    return (
      <div
        key={slot}
        onDragOver={isActive ? onDragOver(slot) : undefined}
        onDragLeave={isActive ? onDragLeave(slot) : undefined}
        onDrop={isActive ? onDrop(slot) : undefined}
        className={cn(
          "rounded-xl border border-border/80 bg-background/30 p-2.5 transition-colors",
          isTarget ? "border-primary/50 ring-1 ring-primary/25" : "",
          dropActive ? "border-primary/70 bg-primary/10 ring-1 ring-primary/30" : "",
        )}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-foreground">{MULTI_REF_LABELS[slot]}</span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onSetAssetTarget(slot)}
              className={cn(
                "rounded-md border px-2 py-1 text-[10px] font-medium transition-colors",
                isTarget
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40",
              )}
            >
              {importVerb}
            </button>
            <label className="cursor-pointer rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary">
              {uploadingSlot === slot ? <LoaderCircle className="inline h-3 w-3 animate-spin" /> : "上传"}
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => void onUpload(event, slot)}
              />
            </label>
            {st ? (
              <button
                type="button"
                onClick={() => onClearSlot(slot)}
                className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title="清除"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
        {st ? (
          <div className="overflow-hidden rounded-lg border border-border">
            <img
              src={getGeneratedMediaUrl(st.url) || undefined}
              alt={st.originalName}
              className="aspect-video w-full cursor-zoom-in object-cover"
              referrerPolicy="no-referrer"
              onDoubleClick={() =>
                onPreview({
                  url: getGeneratedMediaUrl(st.url) || st.url,
                  title: `${MULTI_REF_LABELS[slot]}：${st.originalName || "参考图"}`,
                })
              }
              title="双击放大查看原图"
            />
            <div className="truncate border-t border-border bg-muted/20 px-2 py-1 text-[10px] text-muted-foreground">
              {st.originalName}
              {items.length > 1 ? ` 等${items.length}张` : ""}
            </div>
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground/80">
            {dropActive ? "松开即可填入该分类" : "未选择"}
          </p>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">主设定</p>
        <div className="space-y-2">
          {renderSlotRow("scene", "导入场景")}
          {renderSlotRow("character", "导入角色")}
          {renderSlotRow("prop", "导入道具")}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">其他参考</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {renderSlotRow("pose", "导入")}
          {renderSlotRow("expression", "导入")}
          {renderSlotRow("effect", "导入")}
          {renderSlotRow("sketch", "导入")}
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-border/60 bg-muted/10 p-2">
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          可将资产库中的素材卡片<strong className="font-medium text-foreground">拖拽</strong>到上方任意分类框；也可点击「导入」后在下方点选。
        </p>
        {assetTarget ? (
          <>
            <p className="text-[11px] text-primary">
              正在为「{MULTI_REF_LABELS[assetTarget]}」选择资产，点选下方缩略图即可填入。
            </p>
            <ReferenceAssetPicker
              projectId={projectId}
              selectedAssetId={null}
              selectedAssetIds={slots[assetTarget].flatMap((item) =>
                item.source === "asset" ? [item.assetId || item.id] : [],
              )}
              onSelect={(asset) => onApplyAsset(assetTarget, asset)}
              onToggleSelect={(asset, selected) => {
                if (selected) {
                  onApplyAsset(assetTarget, asset);
                  return;
                }
                onRemoveAsset(assetTarget, asset.id);
              }}
            />
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            点击某一类旁的「导入…」后，在下方资产库中选择图片。
          </p>
        )}
      </div>
    </>
  );
}

export { REFERENCE_ASSET_MIME };
