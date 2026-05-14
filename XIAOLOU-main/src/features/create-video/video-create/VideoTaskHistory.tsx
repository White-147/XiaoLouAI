import { type DragEvent } from "react";
import { Clock3, X } from "lucide-react";
import { AssetSyncDropzone } from "../../assets-media-projects/asset-sync/AssetSyncControls";
import {
  formatTaskStatusLabel,
  getTaskFailureReason,
  getTaskStatusPillClass,
} from "../../../lib/task-status";
import { cn } from "../../../lib/utils";
import type { Task } from "./api/create-video";
import {
  formatTime,
  resolvedTaskReferenceCaption,
  taskLastFrame,
  taskReference,
} from "./videoResultHelpers";

type VideoTaskHistoryProps = {
  recentTasks: Task[];
  syncDragActive: boolean;
  syncingAsset: boolean;
  syncNotice: string | null;
  onSyncDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onSyncDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onSyncDrop: (event: DragEvent<HTMLDivElement>) => void;
  onRequestClearTasks: () => void;
  onDismissTask: (id: string) => void | Promise<void>;
};

export function VideoTaskHistory({
  recentTasks,
  syncDragActive,
  syncingAsset,
  syncNotice,
  onSyncDragOver,
  onSyncDragLeave,
  onSyncDrop,
  onRequestClearTasks,
  onDismissTask,
}: VideoTaskHistoryProps) {
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
            onClick={onRequestClearTasks}
            className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
          >
            清空
          </button>
        ) : null}
      </div>
      <div className="space-y-3">
        {recentTasks.map((task) => {
          const failureReason = getTaskFailureReason(task);
          const reference = taskReference(task);
          const lastFrame = taskLastFrame(task);

          return (
            <div
              key={task.id}
              className={cn(
                "rounded-xl border p-3",
                failureReason ? "border-rose-500/30 bg-rose-500/5" : "border-border bg-muted/20",
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
                  <div className="mb-0.5 font-semibold text-rose-800 dark:text-rose-300">失败原因</div>
                  <div className="whitespace-pre-wrap break-words">{failureReason}</div>
                </div>
              ) : null}
              {reference ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <img
                    src={reference}
                    alt="reference"
                    className="h-8 w-8 rounded object-cover"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                  />
                  {lastFrame ? (
                    <img
                      src={lastFrame}
                      alt="尾帧"
                      className="h-8 w-8 rounded object-cover"
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                    />
                  ) : null}
                  <span className="text-[11px] text-muted-foreground">
                    已关联{resolvedTaskReferenceCaption(task)}
                  </span>
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
