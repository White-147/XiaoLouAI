import { AlertCircle } from "lucide-react";

type DeleteEpisodeConfirmDialogProps = {
  episodeNo: number;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteEpisodeConfirmDialog({
  episodeNo,
  onCancel,
  onConfirm,
}: DeleteEpisodeConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-4 shadow-2xl">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
          <AlertCircle className="h-4 w-4 text-destructive" />
          删除第 {episodeNo} 集？
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          当前集数含有已编辑脚本、分镜或提示词内容，删除后这些内容会一并移除。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 rounded-md border border-border px-3 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            取消
          </button>
          <button
            type="button"
            data-episode-delete-confirm
            onClick={onConfirm}
            className="h-8 rounded-md bg-destructive px-3 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
}

type ReorderConflictDialogProps = {
  episodeNumbers: number[];
  onClose: () => void;
};

export function ReorderConflictDialog({ episodeNumbers, onClose }: ReorderConflictDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-4 shadow-2xl">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
          <AlertCircle className="h-4 w-4 text-amber-400" />
          重排存在内容冲突
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          重排后的集数不包含以下已有集数，且这些集数含有已编辑内容。请先处理这些集数的脚本、分镜或提示词后再重排。
        </p>
        <div className="mt-3 flex flex-wrap gap-1">
          {episodeNumbers.map((episodeNo) => (
            <span
              key={episodeNo}
              className="rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-300"
            >
              第 {episodeNo} 集
            </span>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            data-episode-reorder-conflict-close
            onClick={onClose}
            className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  );
}
