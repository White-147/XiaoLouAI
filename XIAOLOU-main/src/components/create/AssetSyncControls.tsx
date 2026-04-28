import {
  FolderOpen,
  Image as ImageIcon,
  LoaderCircle,
  Video,
  X,
} from "lucide-react";
import {
  type DragEventHandler,
  useEffect,
  useMemo,
  useState,
} from "react";
import { GeneratedMediaPlaceholder } from "../media/GenerationPlaceholder";
import { cn } from "../../lib/utils";
import type { AssetSourceModule, CreateAssetInput } from "../../lib/api";

/**
 * Draft payload fed into the shared AssetSyncDialog. Every product surface
 * (ImageCreate / VideoCreate / Canvas / VideoReplace) fills this in before
 * calling the dialog; the dialog never guesses — it writes what it gets.
 */
export type AssetSyncDraft = {
  id: string;
  mediaKind: "image" | "video";
  previewUrl: string | null;
  mediaUrl: string | null;
  prompt: string;
  model: string;
  aspectRatio: string;
  taskId?: string | null;
  targetProjectId?: string | null;
  referenceImageUrl?: string | null;
  defaultAssetType: string;
  defaultName: string;
  defaultDescription: string;
  /** Required: real product surface that produced this result. */
  sourceModule: AssetSourceModule;
};

type AssetSyncDropzoneProps = {
  dragActive: boolean;
  syncing: boolean;
  notice: string | null;
  onDragOver: DragEventHandler<HTMLDivElement>;
  onDragLeave: DragEventHandler<HTMLDivElement>;
  onDrop: DragEventHandler<HTMLDivElement>;
};

type AssetSyncDialogProps = {
  item: AssetSyncDraft | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (input: CreateAssetInput) => Promise<void> | void;
};

const IMAGE_ASSET_TYPES = [
  { value: "character", label: "角色资产" },
  { value: "scene", label: "场景资产" },
  { value: "prop", label: "道具资产" },
  { value: "style", label: "风格资产" },
];

// Video assets all share a single assetType (`video_ref`); the real source
// surface is carried in `sourceModule`, which drives /assets grouping.
const VIDEO_ASSET_TYPES = [{ value: "video_ref", label: "视频素材" }];

const SOURCE_MODULE_LABEL: Record<AssetSourceModule, string> = {
  image_create: "图片创作",
  video_create: "视频创作",
  canvas: "画布",
  video_replace: "人物替换",
  agent_studio: "智能体画布",
};

export function AssetSyncDropzone({
  dragActive,
  syncing,
  notice,
  onDragOver,
  onDragLeave,
  onDrop,
}: AssetSyncDropzoneProps) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "mb-4 rounded-2xl border border-dashed p-4 transition-all",
        dragActive
          ? "border-primary bg-primary/10 shadow-[0_0_0_1px_rgba(59,130,246,0.25)]"
          : "border-border bg-muted/20",
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        <FolderOpen className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium">同步到当前项目资产库</h3>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        把右侧生成结果卡片拖到这里，即可一键同步到资产库。图片会保留原图，视频会保留缩略图和原始视频地址。
      </p>
      <div
        className={cn(
          "mt-4 rounded-xl border border-dashed px-4 py-6 text-center text-sm",
          dragActive
            ? "border-primary bg-background/80 text-primary"
            : "border-border text-muted-foreground",
        )}
      >
        {syncing ? (
          <span className="inline-flex items-center gap-2">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            正在同步到资产库...
          </span>
        ) : dragActive ? (
          "松开鼠标，同步到资产库"
        ) : (
          "拖拽生成结果到此处"
        )}
      </div>
      {notice ? (
        <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
          {notice}
        </div>
      ) : null}
    </div>
  );
}

export function AssetSyncDialog({
  item,
  submitting,
  onClose,
  onSubmit,
}: AssetSyncDialogProps) {
  const typeOptions = useMemo(
    () => (item?.mediaKind === "video" ? VIDEO_ASSET_TYPES : IMAGE_ASSET_TYPES),
    [item?.mediaKind],
  );
  const [assetType, setAssetType] = useState(typeOptions[0]?.value ?? "style");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!item) return;

    setAssetType(item.defaultAssetType);
    setName(item.defaultName);
    setDescription(item.defaultDescription);
  }, [item]);

  useEffect(() => {
    if (!typeOptions.some((option) => option.value === assetType)) {
      setAssetType(typeOptions[0]?.value ?? "style");
    }
  }, [assetType, typeOptions]);

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-2xl border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold">同步到资产库</h3>
            <p className="text-xs text-muted-foreground">
              先确认资产分类、名称和说明，再写入当前项目资产库。
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 transition-colors hover:bg-accent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="overflow-hidden rounded-xl border border-border bg-black">
            {item.mediaKind === "video" ? (
              item.mediaUrl ? (
                <video
                  src={item.mediaUrl}
                  poster={item.previewUrl || undefined}
                  controls
                  className="h-full min-h-[240px] w-full object-contain"
                />
              ) : (
                <GeneratedMediaPlaceholder
                  kind="video"
                  className="h-full min-h-[240px] w-full bg-black text-zinc-300"
                  description="视频生成完成后才能同步真实媒体"
                />
              )
            ) : (
              item.previewUrl ? (
                <img
                  src={item.previewUrl}
                  alt={item.prompt}
                  className="h-full min-h-[240px] w-full object-contain"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <GeneratedMediaPlaceholder
                  kind="image"
                  className="h-full min-h-[240px] w-full bg-black text-zinc-300"
                  description="图片生成完成后才能同步真实媒体"
                />
              )
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              {item.mediaKind === "video" ? (
                <Video className="h-4 w-4 text-primary" />
              ) : (
                <ImageIcon className="h-4 w-4 text-primary" />
              )}
              {item.mediaKind === "video" ? "视频素材" : "图片素材"}
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
                来源：{SOURCE_MODULE_LABEL[item.sourceModule]}
              </span>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">资产分类</label>
              <select
                value={assetType}
                onChange={(event) => setAssetType(event.target.value)}
                className="w-full rounded-lg border border-border bg-input px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {typeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">资产名称</label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-lg border border-border bg-input px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">说明</label>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="h-32 w-full resize-none rounded-lg border border-border bg-input px-4 py-3 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg border border-border p-3">
                <div className="text-muted-foreground">模型</div>
                <div className="mt-1 font-medium">{item.model}</div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-muted-foreground">比例</div>
                <div className="mt-1 font-medium">{item.aspectRatio}</div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={onClose}
                className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
              >
                取消
              </button>
              <button
                onClick={() =>
                  void onSubmit({
                    assetType,
                    name: name.trim(),
                    description: description.trim(),
                    previewUrl: item.previewUrl,
                    generationPrompt: item.prompt,
                    referenceImageUrls: item.referenceImageUrl
                      ? [item.referenceImageUrl]
                      : [],
                    imageModel: item.model,
                    aspectRatio: item.aspectRatio,
                    mediaKind: item.mediaKind,
                    mediaUrl: item.mediaUrl,
                    sourceTaskId: item.taskId ?? null,
                    sourceModule: item.sourceModule,
                    scope: "manual",
                  })
                }
                disabled={submitting || !name.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : null}
                确认同步
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
