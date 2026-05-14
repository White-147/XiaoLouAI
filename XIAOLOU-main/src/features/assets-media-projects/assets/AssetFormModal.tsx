import { type Dispatch, type SetStateAction } from "react";
import {
  ASSET_UPLOAD_ACCEPT,
  IMAGE_SUBCATS,
  type AssetFormState,
} from "./assetDisplay";

type AssetFormModalProps = {
  formState: AssetFormState;
  submitting: boolean;
  setFormState: Dispatch<SetStateAction<AssetFormState | null>>;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
};

export function AssetFormModal({
  formState,
  submitting,
  setFormState,
  onClose,
  onSubmit,
}: AssetFormModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-background p-6 shadow-2xl">
        <h3 className="mb-6 text-lg font-semibold">
          {formState.mode === "create" ? "新增资产" : "编辑资产"}
        </h3>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">资产类型</label>
            <select
              value={formState.assetType}
              onChange={(event) =>
                setFormState((current) =>
                  current ? { ...current, assetType: event.target.value } : current,
                )
              }
              className="w-full rounded-lg border border-border bg-input px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {formState.rootCategory === "image"
                ? IMAGE_SUBCATS.filter((item) => item.id !== "all").map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))
                : [
                    <option key="video_ref" value="video_ref">
                      视频素材
                    </option>,
                  ]}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">资产名称</label>
            <input
              value={formState.name}
              onChange={(event) =>
                setFormState((current) =>
                  current ? { ...current, name: event.target.value } : current,
                )
              }
              className="w-full rounded-lg border border-border bg-input px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">本地文件（图片或视频，可选）</label>
            <input
              type="file"
              accept={ASSET_UPLOAD_ACCEPT}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setFormState((current) => {
                  if (!current) return current;
                  if (current.localFilePreviewUrl) {
                    try {
                      URL.revokeObjectURL(current.localFilePreviewUrl);
                    } catch {
                      /* ignore */
                    }
                  }
                  return {
                    ...current,
                    localFile: file,
                    localFilePreviewUrl: file ? URL.createObjectURL(file) : null,
                  };
                });
              }}
              className="w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground hover:file:bg-accent"
            />
            {formState.localFile ? (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">已选择文件：{formState.localFile.name}</p>
                {formState.localFilePreviewUrl && formState.localFile.type.startsWith("image/") ? (
                  <div className="mt-2 inline-flex items-center gap-3 rounded-lg border border-dashed border-border bg-muted/40 p-2">
                    <div className="h-16 w-16 overflow-hidden rounded-md border border-border bg-background">
                      <img
                        src={formState.localFilePreviewUrl}
                        alt={formState.localFile.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      本地图片预览，仅用于确认上传内容。
                    </span>
                  </div>
                ) : formState.localFilePreviewUrl && formState.localFile.type.startsWith("video/") ? (
                  <div className="mt-2 inline-flex items-center gap-3 rounded-lg border border-dashed border-border bg-muted/40 p-2">
                    <div className="h-16 w-16 overflow-hidden rounded-md border border-border bg-background">
                      <video
                        src={formState.localFilePreviewUrl}
                        className="h-full w-full object-cover"
                        muted
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      本地视频预览（静音），用于确认上传内容。
                    </span>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                支持直接上传本地图片或视频文件，系统会自动保存为当前资产的素材。
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">描述</label>
            <textarea
              value={formState.description}
              onChange={(event) =>
                setFormState((current) =>
                  current ? { ...current, description: event.target.value } : current,
                )
              }
              className="h-28 w-full resize-none rounded-lg border border-border bg-input px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            取消
          </button>
          <button
            onClick={() => void onSubmit()}
            disabled={submitting || !formState.name.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "提交中..." : formState.mode === "create" ? "创建资产" : "保存修改"}
          </button>
        </div>
      </div>
    </div>
  );
}
