import {
  LoaderCircle,
  Plus,
  Upload,
  X,
} from "lucide-react";
import {
  ReferenceAssetPicker,
  type ReferenceAssetSelection,
} from "../../assets-media-projects/reference-assets/ReferenceAssetPicker";
import { cn } from "../../../lib/utils";
import { StoryboardShotModelPicker } from "./StoryboardShotModelPicker";

type StoryboardShotReferenceControlsProps = {
  currentProjectId: string | null;
  shotId: string;
  selectedRefs: ReferenceAssetSelection[];
  shotModelId: string;
  isPickerOpen: boolean;
  isModelOpen: boolean;
  uploading: boolean;
  uploadingForShot: string | null;
  onToggleRefPicker: (shotId: string) => void;
  onCloseRefPicker: () => void;
  onToggleRefImage: (shotId: string, asset: ReferenceAssetSelection, selected: boolean) => void;
  onLocalUpload: (shotId: string) => void;
  onToggleModelPicker: (shotId: string) => void;
  onSelectShotModel: (shotId: string, modelId: string) => void;
};

export function StoryboardShotReferenceControls({
  currentProjectId,
  shotId,
  selectedRefs,
  shotModelId,
  isPickerOpen,
  isModelOpen,
  uploading,
  uploadingForShot,
  onToggleRefPicker,
  onCloseRefPicker,
  onToggleRefImage,
  onLocalUpload,
  onToggleModelPicker,
  onSelectShotModel,
}: StoryboardShotReferenceControlsProps) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] text-muted-foreground">参考图：</span>
        {selectedRefs.map((asset) => (
          <div
            key={asset.id}
            className="group/ref relative h-9 w-9 shrink-0 overflow-hidden rounded-md border border-border"
            title={asset.name}
          >
            {asset.previewUrl ? (
              <img
                src={asset.previewUrl}
                alt={asset.name}
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-muted text-[10px] text-muted-foreground">
                {asset.name.slice(0, 2)}
              </div>
            )}
            <button
              type="button"
              onClick={() => onToggleRefImage(shotId, asset, false)}
              className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover/ref:opacity-100"
            >
              <X className="h-3 w-3 text-white" />
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => onToggleRefPicker(shotId)}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-xs transition-colors",
            isPickerOpen
              ? "border-primary/50 bg-primary/10 text-primary"
              : "border-dashed border-white/20 text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary",
          )}
          title="从资产库选择参考图"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={() => onLocalUpload(shotId)}
          disabled={uploading && uploadingForShot === shotId}
          className="flex h-9 items-center gap-1 rounded-md border border-dashed border-white/20 px-2 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:pointer-events-none disabled:opacity-50"
          title="从本地上传参考图"
        >
          {uploading && uploadingForShot === shotId ? (
            <LoaderCircle className="h-3 w-3 animate-spin" />
          ) : (
            <Upload className="h-3 w-3" />
          )}
          本地上传
        </button>

        {selectedRefs.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            已选 {selectedRefs.length} 张
          </span>
        )}

        <StoryboardShotModelPicker
          shotId={shotId}
          shotModelId={shotModelId}
          isModelOpen={isModelOpen}
          onToggleModelPicker={onToggleModelPicker}
          onSelectShotModel={onSelectShotModel}
        />
      </div>

      {isPickerOpen && currentProjectId && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-2xl shadow-black/20">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">
              选择参考图（角色 / 场景 / 道具）
            </span>
            <button
              type="button"
              onClick={onCloseRefPicker}
              className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <ReferenceAssetPicker
            projectId={currentProjectId}
            selectedAssetIds={selectedRefs.map((asset) => asset.id)}
            mediaKind="image"
            hint="选择角色、场景或道具参考图，生成分镜图时作为风格参考"
            onSelect={(asset) => onToggleRefImage(shotId, asset, true)}
            onToggleSelect={(asset, selected) => onToggleRefImage(shotId, asset, selected)}
          />
        </div>
      )}
    </>
  );
}
