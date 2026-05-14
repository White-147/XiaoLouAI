import { type Dispatch, type DragEvent, type ReactNode, type SetStateAction } from "react";
import { Download, LoaderCircle, Play, RefreshCw, Search, Trash2 } from "lucide-react";
import {
  GeneratedMediaPlaceholder,
} from "../../assets-media-projects/media/GenerationPlaceholder";
import { downloadMediaFile, guessMediaFilename } from "../../../lib/download-media";
import { cn } from "../../../lib/utils";
import type { CreateVideoResult } from "./api/create-video";
import { MULTI_REF_LABELS, MULTI_REF_ORDER } from "./MultiReferenceSlots";
import { formatVideoResultModelDisplay } from "./videoCapabilities";
import {
  derivedResultCover,
  displayedAspectRatio,
  displayedDuration,
  displayedResolution,
  formatTime,
  hasMultiReferenceImages,
  playableVideoUrl,
  resultMultiReferenceUrl,
  resultReferenceUrl,
  videoCoverReason,
  videoPreviewReason,
  type VideoOutputMetadata,
} from "./videoResultHelpers";

type VideoResultsGridProps = {
  historyQuery: string;
  historyModel: string;
  modelOptions: string[];
  loading: boolean;
  pagedResults: CreateVideoResult[];
  filteredResultCount: number;
  videoPageSize: number;
  currentPage: number;
  totalPages: number;
  derivedVideoMetadata: Record<string, VideoOutputMetadata>;
  draggingItemId: string | null;
  taskHistory: ReactNode;
  onHistoryQueryChange: (value: string) => void;
  onHistoryModelChange: (value: string) => void;
  onRefresh: () => void;
  onPageChange: Dispatch<SetStateAction<number>>;
  onResultDragStart: (event: DragEvent<HTMLElement>, item: CreateVideoResult) => void;
  onResultDragEnd: () => void;
  onPreview: (item: CreateVideoResult) => void;
  onAssetSync: (item: CreateVideoResult) => void;
  onDelete: (id: string) => void | Promise<void>;
};

export function VideoResultsGrid({
  historyQuery,
  historyModel,
  modelOptions,
  loading,
  pagedResults,
  filteredResultCount,
  videoPageSize,
  currentPage,
  totalPages,
  derivedVideoMetadata,
  draggingItemId,
  taskHistory,
  onHistoryQueryChange,
  onHistoryModelChange,
  onRefresh,
  onPageChange,
  onResultDragStart,
  onResultDragEnd,
  onPreview,
  onAssetSync,
  onDelete,
}: VideoResultsGridProps) {
  return (
    <>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h3 className="text-sm font-medium">生成结果</h3>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={historyQuery}
              onChange={(event) => onHistoryQueryChange(event.target.value)}
              placeholder="搜索提示词、时长或任务 ID"
              className="w-full rounded-lg border border-border bg-input py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <select
            value={historyModel}
            onChange={(event) => onHistoryModelChange(event.target.value)}
            className="rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {modelOptions.map((item) => (
              <option key={item} value={item}>
                {item === "all" ? "全部模型" : formatVideoResultModelDisplay(item)}
              </option>
            ))}
          </select>
          <button
            onClick={onRefresh}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
          {loading ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : null}
        </div>
      </div>

      <div className="grid grid-cols-1 items-stretch gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
          {pagedResults.map((item) => {
          const videoUrl = playableVideoUrl(item);
          const videoMetadata = videoUrl ? derivedVideoMetadata[videoUrl] : null;
          const coverUrl = derivedResultCover(item, videoMetadata);

          return (
            <article
              key={item.id}
              draggable
              onDragStart={(event) => onResultDragStart(event, item)}
              onDragEnd={onResultDragEnd}
              className={cn(
                "glass-panel group flex h-full min-h-0 flex-col overflow-hidden rounded-xl transition-transform",
                draggingItemId === item.id ? "scale-[0.98] opacity-70" : "",
              )}
            >
              <button
                onClick={() => onPreview(item)}
                className="relative block aspect-video w-full shrink-0 overflow-hidden bg-black text-left"
              >
                {coverUrl ? (
                  <img
                    src={coverUrl}
                    alt={item.prompt}
                    className="h-full w-full object-cover opacity-85"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                  />
                ) : videoUrl ? (
                  <video
                    src={videoUrl}
                    className="h-full w-full object-cover opacity-90"
                    muted
                    autoPlay
                    loop
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <GeneratedMediaPlaceholder
                    kind="video"
                    label="暂无封面"
                    className="h-full w-full bg-black text-zinc-300"
                    description={videoCoverReason(item)}
                  />
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                  <div className="rounded-full bg-primary/90 p-3 text-primary-foreground">
                    <Play className="ml-0.5 h-5 w-5" />
                  </div>
                </div>
              </button>

              <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
                <p className="line-clamp-2 shrink-0 text-sm text-foreground">{item.prompt}</p>
                <div className="flex shrink-0 flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  {modeLabel(item.videoMode) ? (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
                      {modeLabel(item.videoMode)}
                    </span>
                  ) : null}
                  <span>{formatVideoResultModelDisplay(item.model)}</span>
                  <span>{displayedDuration(item, videoMetadata)}</span>
                  <span>{displayedAspectRatio(item, videoMetadata)}</span>
                  <span>{displayedResolution(item)}</span>
                  {item.taskId ? <span>{item.taskId}</span> : null}
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-3">
                  {hasMultiReferenceImages(item) ? (
                    <div className="flex flex-col gap-2">
                      <div className="rounded-lg border border-border bg-muted/20 p-2">
                        <div className="flex flex-wrap gap-2">
                          {MULTI_REF_ORDER.map((key) => {
                            const u = resultMultiReferenceUrl(item, key);
                            if (!u) return null;
                            return (
                              <div key={key} className="flex flex-col items-center gap-0.5">
                                <img
                                  src={u}
                                  alt={MULTI_REF_LABELS[key]}
                                  className="h-10 w-10 rounded object-cover"
                                  loading="lazy"
                                  decoding="async"
                                  referrerPolicy="no-referrer"
                                />
                                <span className="max-w-[3.5rem] truncate text-center text-[9px] text-muted-foreground">
                                  {MULTI_REF_LABELS[key]}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">多参参考图</div>
                      </div>
                      {item.resolvedReferenceImageUrl ? (
                        <div className="rounded-lg border border-border/70 bg-background/70 p-2">
                          <div className="mb-1 text-[10px] text-muted-foreground">主参考图</div>
                          <img
                            src={resultReferenceUrl(item.resolvedReferenceImageUrl) || undefined}
                            alt="主参考图"
                            className="h-10 w-10 rounded object-cover"
                            loading="lazy"
                            decoding="async"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : item.referenceImageUrl || item.firstFrameUrl ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 p-2">
                      {item.firstFrameUrl ? (
                        <img
                          src={resultReferenceUrl(item.firstFrameUrl) || undefined}
                          alt="首帧"
                          className="h-10 w-10 rounded object-cover"
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                        />
                      ) : null}
                      {item.lastFrameUrl ? (
                        <img
                          src={resultReferenceUrl(item.lastFrameUrl) || undefined}
                          alt="尾帧"
                          className="h-10 w-10 rounded object-cover"
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                        />
                      ) : null}
                      {item.referenceImageUrl && !item.firstFrameUrl ? (
                        <img
                          src={resultReferenceUrl(item.referenceImageUrl) || undefined}
                          alt="reference"
                          className="h-10 w-10 rounded object-cover"
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                        />
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        {item.videoMode === "start_end_frame"
                          ? "首尾帧"
                          : item.referenceImageUrl || item.firstFrameUrl
                            ? "参考输入"
                            : ""}
                      </span>
                    </div>
                  ) : null}

                  {!videoUrl ? (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-[11px] leading-5 text-amber-100">
                      {videoPreviewReason(item)}
                    </div>
                  ) : null}
                </div>

                <div className="mt-auto flex shrink-0 items-center justify-between border-t border-border/50 pt-3">
                  <span className="text-[11px] text-muted-foreground">
                    {formatTime(item.createdAt)}
                  </span>
                  <div className="flex items-center gap-2">
                    {videoUrl ? (
                      <button
                        onClick={() => onAssetSync(item)}
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                      >
                        同步资产
                      </button>
                    ) : null}
                    <button
                      onClick={() => onPreview(item)}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                    >
                      预览
                    </button>
                    {videoUrl ? (
                      <button
                        type="button"
                        onClick={() =>
                          void downloadMediaFile(
                            videoUrl,
                            guessMediaFilename(videoUrl, item.id, "video"),
                          )
                        }
                        className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                      >
                        <Download className="h-3.5 w-3.5" />
                        下载
                      </button>
                    ) : null}
                    <button
                      onClick={() => void onDelete(item.id)}
                      title="删除此结果"
                      className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
          })}
          {filteredResultCount > videoPageSize ? (
            <div className="col-span-full mt-2 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => onPageChange((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="flex h-8 items-center justify-center rounded border border-border px-3 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              上一页
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, index) => {
                const pageNumber = index + 1;
                return (
                  <button
                    key={pageNumber}
                    type="button"
                    onClick={() => onPageChange(pageNumber)}
                    className={cn(
                      "flex h-8 min-w-[2rem] items-center justify-center rounded border px-2 text-xs",
                      pageNumber === currentPage
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {pageNumber}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => onPageChange((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="flex h-8 items-center justify-center rounded border border-border px-3 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              下一页
            </button>
            </div>
          ) : null}
        </div>
        {taskHistory}
      </div>
    </>
  );
}

function modeLabel(mode: string | null | undefined) {
  if (mode === "start_end_frame") return "首尾帧";
  if (mode === "multi_param") return "多参";
  if (mode === "image_to_video") return "图生";
  return null;
}
