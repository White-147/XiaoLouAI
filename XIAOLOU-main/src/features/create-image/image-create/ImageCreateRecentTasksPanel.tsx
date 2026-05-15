import { Clock3, X } from "lucide-react";
import type { DragEvent } from "react";
import { AssetSyncDropzone } from "../../assets-media-projects/asset-sync/AssetSyncControls";
import { cn } from "../../../lib/utils";
import type { Task } from "./api/create-image";

type TaskDisplayHelpers = {
  getTaskFailureReason: (task: Task) => string | null;
  formatTaskStatusLabel: (task: Task) => string;
  getTaskStatusPillClass: (task: Task) => string;
  taskModel: (task: Task) => string | null;
  taskReference: (task: Task) => string | null;
  taskReferenceImages: (task: Task) => string[];
  formatTime: (value: string) => string;
};

type ImageCreateRecentTasksPanelProps = TaskDisplayHelpers & {
  recentTasks: Task[];
  syncDragActive: boolean;
  syncingAsset: boolean;
  syncNotice: string | null;
  onSyncDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onSyncDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onSyncDrop: (event: DragEvent<HTMLDivElement>) => void;
  onOpenClearTasks: () => void;
  onDismissTask: (id: string) => void | Promise<void>;
};

type ImageCreateClearTasksModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
};

export function ImageCreateRecentTasksPanel({
  recentTasks,
  syncDragActive,
  syncingAsset,
  syncNotice,
  onSyncDragOver,
  onSyncDragLeave,
  onSyncDrop,
  onOpenClearTasks,
  onDismissTask,
  getTaskFailureReason,
  formatTaskStatusLabel,
  getTaskStatusPillClass,
  taskModel,
  taskReference,
  taskReferenceImages,
  formatTime,
}: ImageCreateRecentTasksPanelProps) {
  return (
    <aside className="glass-panel rounded-2xl p-4">
      <AssetSyncDropzone
        dragActive={syncDragActive}
        syncing={syncingAsset}
        notice={syncNotice}
        onDragOver={onSyncDragOver}
        onDragLeave={onSyncDragLeave}
        onDrop={onSyncDrop}
      />
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium">最近任务</h3>
        </div>
        {recentTasks.length ? (
          <button
            type="button"
            onClick={onOpenClearTasks}
            className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
          >
            清空
          </button>
        ) : null}
      </div>
      <div className="space-y-3">
        {recentTasks.map((task) => {
          const failureReason = getTaskFailureReason(task);
          return (
            <div
              key={task.id}
              className={cn(
                "rounded-xl border p-3",
                failureReason
                  ? "border-rose-500/30 bg-rose-500/5"
                  : "border-border bg-muted/20",
              )}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium">{task.id}</span>
                <div className="flex items-center gap-1">
                  <span className={getTaskStatusPillClass(task)}>
                    {formatTaskStatusLabel(task)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void onDismissTask(task.id)}
                    className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    title="从列表中移除此任务"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {task.inputSummary || "暂无任务描述"}
              </p>
              {failureReason ? (
                <div className="mt-2 rounded-md border border-rose-600/40 bg-rose-500/15 p-2 text-[11px] leading-5 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                  <div className="mb-0.5 font-semibold text-rose-800 dark:text-rose-300">
                    失败原因
                  </div>
                  <div className="whitespace-pre-wrap break-words">{failureReason}</div>
                </div>
              ) : null}
              {taskModel(task) ? (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  模型：{taskModel(task)}
                </div>
              ) : null}
              {taskReferenceImages(task).length > 1 ? (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  参考图：{taskReferenceImages(task).length} 张
                </div>
              ) : null}
              {taskReference(task) ? (
                <div className="mt-2 flex items-center gap-2">
                  <img
                    src={taskReference(task) || undefined}
                    alt="reference"
                    className="h-8 w-8 rounded object-cover"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                  />
                  <span className="text-[11px] text-muted-foreground">已关联参考图</span>
                </div>
              ) : null}
              <div className="mt-2 text-[11px] text-muted-foreground">
                {formatTime(task.createdAt)}
              </div>
            </div>
          );
        })}
        {!recentTasks.length ? (
          <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            还没有生成任务
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export function ImageCreateClearTasksModal({
  open,
  onClose,
  onConfirm,
}: ImageCreateClearTasksModalProps) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <h3 className="text-base font-semibold">确认清空最近任务？</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          该操作会删除当前账号下的最近任务记录，且不可恢复。
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            className="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground hover:bg-destructive/90"
          >
            确认清空
          </button>
        </div>
      </div>
    </div>
  );
}
