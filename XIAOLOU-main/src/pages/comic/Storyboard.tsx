import {
  Download,
  RefreshCw,
  Image as ImageIcon,
  ArrowUp,
  ArrowDown,
  Trash2,
  Edit,
  LoaderCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import StoryboardEditor from "./StoryboardEditor";
import {
  GeneratedMediaPlaceholder,
  getGeneratedMediaUrl,
} from "../../components/media/GenerationPlaceholder";
import {
  autoGenerateStoryboards,
  deleteStoryboard,
  generateStoryboardImage,
  getProjectCreditQuote,
  getTask,
  listStoryboards,
  updateStoryboard,
  type CreditQuote,
  type Storyboard as StoryboardItem,
  type Task,
} from "../../lib/api";
import { saveProjectScript } from "../../lib/project-script-store";
import { useCurrentProjectId } from "../../lib/session";

function storyboardCover(item: StoryboardItem) {
  return getGeneratedMediaUrl(item.imageUrl);
}

export default function Storyboard() {
  const [currentProjectId] = useCurrentProjectId();
  const [editingShotId, setEditingShotId] = useState<number | null>(null);
  const [storyboards, setStoryboards] = useState<StoryboardItem[]>([]);
  const [draftScripts, setDraftScripts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [pendingTask, setPendingTask] = useState<string | null>(null);
  const [autoGenerateQuote, setAutoGenerateQuote] = useState<CreditQuote | null>(null);
  const [imageQuote, setImageQuote] = useState<CreditQuote | null>(null);
  const [billingNotice, setBillingNotice] = useState<string | null>(null);

  const loadStoryboards = async () => {
    setLoading(true);
    try {
      const response = await listStoryboards(currentProjectId);
      setStoryboards(response.items);
      setDraftScripts(
        response.items.reduce<Record<string, string>>((acc, item) => {
          acc[item.id] = item.script;
          return acc;
        }, {}),
      );
    } finally {
      setLoading(false);
    }
  };

  const loadQuotes = async () => {
    try {
      const [autoQuote, singleImageQuote] = await Promise.all([
        getProjectCreditQuote(currentProjectId, "storyboard_auto_generate"),
        getProjectCreditQuote(currentProjectId, "storyboard_image_generate"),
      ]);
      setAutoGenerateQuote(autoQuote);
      setImageQuote(singleImageQuote);
    } catch {
      setAutoGenerateQuote(null);
      setImageQuote(null);
    }
  };

  useEffect(() => {
    void loadStoryboards();
    void loadQuotes();
  }, [currentProjectId]);

  const totalShots = useMemo(() => storyboards.length, [storyboards.length]);

  const waitForTaskToSettle = async (taskId: string) => {
    let latestTask: Task | null = null;

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const task = await getTask(taskId);
      latestTask = task;
      if (task.status === "succeeded" || task.status === "failed") {
        return task;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
    }

    return latestTask;
  };

  const handleAutoGenerate = async () => {
    setPendingTask("auto-generate");
    setBillingNotice(null);
    try {
      const sourceText = await saveProjectScript(currentProjectId);
      if (!sourceText.trim()) {
        window.alert("请先在剧本节点填写并保存故事脚本。");
        return;
      }

      const acceptedTask = await autoGenerateStoryboards(currentProjectId, sourceText);
      const finishedTask = await waitForTaskToSettle(acceptedTask.taskId);
      await loadStoryboards();
      await loadQuotes();
      if (finishedTask?.status === "failed") {
        window.alert(finishedTask.outputSummary || "分镜拆分失败，请稍后重试。");
      }
    } catch (error) {
      console.error(error);
      setBillingNotice(error instanceof Error ? error.message : "分镜拆分失败");
      window.alert("分镜拆分失败，请稍后重试。");
    } finally {
      setPendingTask(null);
    }
  };

  const handleGenerateImage = async (item: StoryboardItem) => {
    setPendingTask(item.id);
    setBillingNotice(null);
    try {
      await generateStoryboardImage(item.id, draftScripts[item.id]);
      window.setTimeout(() => void loadStoryboards(), 1800);
      window.setTimeout(() => void loadQuotes(), 1800);
    } catch (error) {
      setBillingNotice(error instanceof Error ? error.message : "分镜出图失败");
    } finally {
      window.setTimeout(() => setPendingTask(null), 1800);
    }
  };

  const handleDelete = async (storyboardId: string) => {
    setPendingTask(storyboardId);
    try {
      await deleteStoryboard(currentProjectId, storyboardId);
      await loadStoryboards();
    } finally {
      setPendingTask(null);
    }
  };

  const handleBlurSave = async (item: StoryboardItem) => {
    const nextScript = draftScripts[item.id];
    if (nextScript === item.script) return;

    await updateStoryboard(currentProjectId, item.id, { script: nextScript });
    await loadStoryboards();
  };

  return (
    <div className="relative flex h-full w-full flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card/30 px-6">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">共 {totalShots} 个分镜</span>
          {loading ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : null}
          {autoGenerateQuote ? (
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
              自动拆分预计 {autoGenerateQuote.credits} 积分
            </span>
          ) : null}
          {billingNotice ? (
            <span className="max-w-[320px] truncate rounded-full bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300">
              {billingNotice}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => void handleAutoGenerate()}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            {pendingTask === "auto-generate" ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            自动拆分分镜
          </button>
          {autoGenerateQuote ? (
            <span className="rounded-md bg-secondary px-2 py-1 text-xs text-muted-foreground">
              冻结后结算
            </span>
          ) : null}
          <button className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent">
            <Download className="h-4 w-4" />
            导出分镜脚本
          </button>
          <button
            onClick={() => void handleAutoGenerate()}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <ImageIcon className="h-4 w-4" />
            自动生成分镜图
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-6 custom-scrollbar">
        {storyboards.map((item) => {
          const coverUrl = storyboardCover(item);

          return (
            <div key={item.id} className="glass-panel group flex gap-6 rounded-xl p-4">
              <div
                className="relative aspect-video w-64 shrink-0 cursor-pointer overflow-hidden rounded-lg bg-muted ring-primary/50 transition-all group-hover:ring-2"
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
                    kind="image"
                    className="h-full w-full"
                    description="生成后会在这里显示分镜图"
                  />
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <button className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                    <Edit className="h-4 w-4" />
                    编辑分镜图
                  </button>
                </div>
                <div className="absolute left-2 top-2 rounded bg-background/80 px-2 py-0.5 text-xs font-mono backdrop-blur">
                  S{String(item.shotNo).padStart(2, "0")}
                </div>
              </div>

              <div className="flex flex-1 flex-col">
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                    {item.imageStatus}
                  </span>
                  <span className="rounded bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                    {item.durationSeconds}s
                  </span>
                </div>

                <textarea
                  value={draftScripts[item.id] ?? item.script}
                  onChange={(event) =>
                    setDraftScripts((current) => ({ ...current, [item.id]: event.target.value }))
                  }
                  onBlur={() => void handleBlurSave(item)}
                  className="flex-1 resize-none rounded-md border border-transparent bg-transparent p-2 -ml-2 text-sm leading-relaxed transition-colors focus:border-border focus:outline-none"
                />

                <div className="mt-2 flex items-center gap-2">
                  <div className="rounded-md bg-primary/10 px-2 py-1 text-xs text-primary">
                    {item.promptSummary}
                  </div>
                </div>
              </div>

              <div className="mt-auto flex w-24 shrink-0 flex-col gap-2 border-l border-border pl-4">
                <button className="flex h-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button className="flex h-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                  <ArrowDown className="h-4 w-4" />
                </button>
                {imageQuote ? (
                  <div className="rounded-md bg-secondary px-2 py-1 text-center text-[11px] text-muted-foreground">
                    {imageQuote.credits} 积分
                  </div>
                ) : null}
                <button
                  onClick={() => void handleGenerateImage(item)}
                  className="rounded-md border border-border px-2 py-2 text-xs font-medium transition-colors hover:bg-accent"
                >
                  {pendingTask === item.id ? "生成中..." : "生成图"}
                </button>
                <button
                  onClick={() => void handleDelete(item.id)}
                  className="mt-auto flex h-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
                >
                  {pendingTask === item.id ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {editingShotId !== null ? (
        <StoryboardEditor shotId={editingShotId} onBack={() => setEditingShotId(null)} />
      ) : null}
    </div>
  );
}
