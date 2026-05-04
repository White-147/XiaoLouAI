import { PlaySquare, RefreshCw, Filter, Edit, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import VideoEditor from "./VideoEditor";
import {
  GeneratedMediaPlaceholder,
  getGeneratedMediaUrl,
} from "../../components/media/GenerationPlaceholder";
import {
  generateVideo,
  getProjectOverview,
  type Storyboard,
  type Task,
  type VideoItem,
} from "../../lib/api";
import { useCurrentProjectId } from "../../lib/session";

type ShotCard = Storyboard & {
  latestVideo?: VideoItem;
  latestTask?: Task;
};

function videoStatusLabel(status: string | null | undefined) {
  if (status === "queued") return "排队中";
  if (status === "running") return "生成中";
  if (status === "ready") return "已完成";
  if (status === "failed") return "生成失败";
  return "未生成";
}

function hasActiveVideoStatus(item: Pick<ShotCard, "videoStatus" | "latestTask">) {
  return (
    item.videoStatus === "queued" ||
    item.videoStatus === "running" ||
    item.latestTask?.status === "queued" ||
    item.latestTask?.status === "running"
  );
}

function cardCover(item: ShotCard) {
  return getGeneratedMediaUrl(item.latestVideo?.thumbnailUrl);
}

export default function Video() {
  const [currentProjectId] = useCurrentProjectId();
  const [editingShotId, setEditingShotId] = useState<number | null>(null);
  const [cards, setCards] = useState<ShotCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingIds, setPendingIds] = useState<string[]>([]);

  const loadData = async () => {
    setLoading(true);
    try {
      const overview = await getProjectOverview(currentProjectId);
      const nextCards = overview.storyboards.map((storyboard) => ({
        ...storyboard,
        latestVideo: overview.videos.find((video) => video.storyboardId === storyboard.id),
        latestTask: overview.tasks.find(
          (task) => task.type === "video_generate" && task.storyboardId === storyboard.id,
        ),
      }));
      setCards(nextCards);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [currentProjectId]);

  const queuedCount = useMemo(
    () => cards.filter((item) => hasActiveVideoStatus(item)).length,
    [cards],
  );

  useEffect(() => {
    if (!cards.some((item) => hasActiveVideoStatus(item)) && !pendingIds.length) return;

    const timer = window.setInterval(() => {
      void loadData();
    }, 3500);

    return () => window.clearInterval(timer);
  }, [cards, currentProjectId, pendingIds.length]);

  const handleGenerate = async (storyboardId: string) => {
    setPendingIds((current) => [...current, storyboardId]);
    try {
      await generateVideo(storyboardId, { mode: "image_to_video", motionPreset: "默认镜头运动" });
      await loadData();
    } finally {
      setPendingIds((current) => current.filter((item) => item !== storyboardId));
    }
  };

  const handleBatchGenerate = async () => {
    const targets = cards.map((item) => item.id);
    setPendingIds(targets);
    try {
      await Promise.all(
        targets.map((storyboardId) =>
          generateVideo(storyboardId, {
            mode: "image_to_video",
            motionPreset: "默认镜头运动",
          }),
        ),
      );
      await loadData();
    } finally {
      setPendingIds([]);
    }
  };

  return (
    <div className="relative flex h-full w-full flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card/30 px-6">
        <div className="flex items-center gap-4">
          <button className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            <Filter className="h-4 w-4" />
            队列中 {queuedCount}
          </button>
          {loading ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : null}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void loadData()}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
          <button
            onClick={() => void handleBatchGenerate()}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <PlaySquare className="h-4 w-4" />
            批量生成视频
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((item) => {
            const isPending = pendingIds.includes(item.id) || hasActiveVideoStatus(item);
            const coverUrl = cardCover(item);

            return (
              <div key={item.id} className="glass-panel group flex flex-col overflow-hidden rounded-xl">
                <div
                  className="relative aspect-video cursor-pointer bg-muted"
                  onClick={() => setEditingShotId(item.shotNo)}
                >
                  {coverUrl ? (
                    <img
                      src={coverUrl}
                      alt={item.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <GeneratedMediaPlaceholder
                      kind="video"
                      className="h-full w-full"
                      description="视频生成完成后会在这里显示封面"
                    />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    <button className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                      <Edit className="h-4 w-4" />
                      编辑分镜视频
                    </button>
                  </div>
                  <div className="absolute left-2 top-2 rounded bg-background/80 px-2 py-0.5 text-xs font-mono backdrop-blur">
                    S{String(item.shotNo).padStart(2, "0")}
                  </div>
                  {isPending ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur">
                      <LoaderCircle className="mb-2 h-8 w-8 animate-spin text-primary" />
                      <span className="text-xs font-medium text-primary">生成中</span>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-1 flex-col p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {item.latestVideo ? `v${item.latestVideo.version}` : "未生成"}
                    </span>
                    <span className="text-xs font-medium">{item.durationSeconds}s</span>
                  </div>
                  <p className="line-clamp-2 text-sm text-foreground">{item.script}</p>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="rounded-full bg-secondary px-2 py-1 text-[10px] text-secondary-foreground">
                      {videoStatusLabel(item.videoStatus)}
                    </span>
                    <button
                      onClick={() => void handleGenerate(item.id)}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                    >
                      生成视频
                    </button>
                  </div>
                  {item.latestTask?.status === "failed" ? (
                    <p className="mt-3 text-xs text-destructive">
                      {item.latestTask.outputSummary || "视频生成失败，请调整参数后重试。"}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {editingShotId !== null ? (
        <VideoEditor shotId={editingShotId} onBack={() => setEditingShotId(null)} />
      ) : null}
    </div>
  );
}
