import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Download,
  Image as ImageIcon,
  LoaderCircle,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  Users,
  Wand2,
  X,
  ZoomIn,
} from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import {
  ReferenceAssetPicker,
  type ReferenceAssetSelection,
} from "../../components/create/ReferenceAssetPicker";
import {
  GeneratedMediaPlaceholder,
  getGeneratedMediaUrl,
} from "../../components/media/GenerationPlaceholder";
import {
  autoGenerateStoryboards,
  deleteStoryboard,
  generateStoryboardImage,
  getScript,
  getStoryboard,
  getTask,
  listStoryboards,
  rewriteScript,
  updateScript,
  updateStoryboard,
  uploadFile,
  type Storyboard,
  type Task,
} from "../../lib/api";
import { useCurrentProjectId } from "../../lib/session";
import { cn } from "../../lib/utils";
import {
  DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID,
  XIAOLOU_TEXT_TO_IMAGE_MODELS,
} from "../../canvas/config/canvasImageModels";
import {
  BREAKDOWN_MAX_SHOTS,
  STORYBOARD_BREAKDOWN_SYSTEM_PROMPT,
} from "../../lib/storyboard-breakdown-prompt";

// ─── helpers ────────────────────────────────────────────────────────────────

function shotCoverUrl(item: Storyboard) {
  return getGeneratedMediaUrl(item.imageUrl);
}

async function waitForTask(taskId: string): Promise<Task | null> {
  // Expert-mode breakdown calls qwen-plus with a large token budget, which
  // can take 100–250 s for a full-length script. Backend timeout is 300 s,
  // so poll for up to 330 s (165 × 2000 ms) to stay safely above it.
  for (let i = 0; i < 165; i++) {
    const task = await getTask(taskId);
    if (task.status === "succeeded" || task.status === "failed") return task;
    await new Promise((r) => window.setTimeout(r, 2000));
  }
  return null;
}

// ─── component ──────────────────────────────────────────────────────────────

export default function ScriptBreakdown() {
  const [currentProjectId] = useCurrentProjectId();

  // ── Episode tabs ──
  const [episodes, setEpisodes] = useState([1, 2]);
  const [activeEpisode, setActiveEpisode] = useState(1);

  const handleAddEpisode = () => {
    const next = episodes[episodes.length - 1] + 1;
    setEpisodes((prev) => [...prev, next]);
    setActiveEpisode(next);
    // Load any pre-existing storyboards for the new episode
    if (currentProjectId) {
      void listStoryboards(currentProjectId, next)
        .then((res) => { if (res.items.length > 0) seedEpisodeStoryboards(next, res.items); })
        .catch(() => {});
    }
  };

  const handleDeleteEpisode = (ep: number) => {
    if (episodes.length <= 1) return;
    const next = episodes.filter((e) => e !== ep);
    setEpisodes(next);
    if (activeEpisode === ep) {
      const idx = episodes.indexOf(ep);
      setActiveEpisode(next[Math.max(0, idx - 1)] ?? next[0]);
    }
  };

  // ── Per-episode independent state ──
  // Each episode keeps its own script text, storyboard list and draft prompts.
  const [episodeScripts, setEpisodeScripts] = useState<Record<number, string>>({});
  const [episodeStoryboards, setEpisodeStoryboards] = useState<Record<number, Storyboard[]>>({});
  const [episodeDraftPrompts, setEpisodeDraftPrompts] = useState<
    Record<number, Record<string, string>>
  >({});

  // Derived: data for the currently active episode
  const content = episodeScripts[activeEpisode] ?? "";
  const storyboards = episodeStoryboards[activeEpisode] ?? [];
  const draftPrompts = episodeDraftPrompts[activeEpisode] ?? {};

  const setContent = (text: string) =>
    setEpisodeScripts((prev) => ({ ...prev, [activeEpisode]: text }));

  /** Seed a fresh storyboard list for `ep` – preserves existing prompt edits. */
  const seedEpisodeStoryboards = (ep: number, items: Storyboard[]) => {
    setEpisodeStoryboards((prev) => ({ ...prev, [ep]: items }));
    setEpisodeDraftPrompts((prev) => {
      const existing = prev[ep] ?? {};
      const seeds = items.reduce<Record<string, string>>((acc, item) => {
        if (existing[item.id] === undefined) acc[item.id] = item.script;
        return acc;
      }, {});
      return { ...prev, [ep]: { ...seeds, ...existing } };
    });
  };

  /** Replace a single storyboard entry in the active episode's list. */
  const patchActiveShot = (updated: Storyboard) => {
    setEpisodeStoryboards((prev) => ({
      ...prev,
      [activeEpisode]: (prev[activeEpisode] ?? []).map((s) =>
        s.id === updated.id ? updated : s,
      ),
    }));
  };

  // ── UI state ──
  const [refImages, setRefImages] = useState<Record<string, ReferenceAssetSelection[]>>({});
  const [showRefPicker, setShowRefPicker] = useState<string | null>(null);
  const [pendingTask, setPendingTask] = useState<string | null>(null);
  const [loadingShots, setLoadingShots] = useState(false);
  const [pendingScriptAction, setPendingScriptAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("saved");

  // ── Per-shot model selection ──
  const [shotModels, setShotModels] = useState<Record<string, string>>({});
  const [showModelPicker, setShowModelPicker] = useState<string | null>(null);

  // ── Breakdown elapsed timer ──
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // ── Lightbox ──
  const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(null);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  // ── Local file upload ──
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploadingForShot, setUploadingForShot] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // ── Initial load: seed episode 1 script, then load each episode's storyboards ──
  useEffect(() => {
    if (!currentProjectId) return;
    void getScript(currentProjectId)
      .then((s) => {
        setEpisodeScripts((prev) => ({ ...prev, 1: prev[1] ?? s.content ?? "" }));
      })
      .catch(() => {});

    // Load storyboards for all known episodes in parallel
    setLoadingShots(true);
    const epNums = episodes; // capture current episodes list
    void Promise.allSettled(
      epNums.map((ep) =>
        listStoryboards(currentProjectId, ep).then((res) => ({ ep, items: res.items })),
      ),
    )
      .then((results) => {
        for (const r of results) {
          if (r.status === "fulfilled") seedEpisodeStoryboards(r.value.ep, r.value.items);
        }
      })
      .finally(() => setLoadingShots(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId]);

  // Close model picker on outside click
  useEffect(() => {
    const close = () => setShowModelPicker(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleRewrite = async (instruction: string, actionKey: string) => {
    if (!currentProjectId) return;
    if (!content.trim()) {
      window.alert("请先输入剧本内容。");
      return;
    }
    setPendingScriptAction(actionKey);
    setSaveState("saving");
    try {
      // Save current episode's text to the project script store
      await updateScript(currentProjectId, content);
      setSaveState("saved");
      await rewriteScript(currentProjectId, instruction);
      // Wait for AI rewrite to complete then read back
      await new Promise((r) => window.setTimeout(r, 2200));
      const updated = await getScript(currentProjectId);
      if (updated.content) {
        setEpisodeScripts((prev) => ({ ...prev, [activeEpisode]: updated.content }));
      }
    } catch {
      setSaveState("error");
      setNotice("AI 改写失败，请稍后重试");
    } finally {
      setPendingScriptAction(null);
    }
  };

  const handleAutoBreakdown = async () => {
    if (!currentProjectId) {
      window.alert("请先在首页选择一个项目，再使用剧本拆解工具。");
      return;
    }
    if (!content.trim()) {
      window.alert("请先在左侧输入故事剧本。");
      return;
    }
    setPendingTask("auto-breakdown");
    setNotice(null);
    const ep = activeEpisode;
    try {
      const accepted = await autoGenerateStoryboards(currentProjectId, content, {
        systemPrompt: STORYBOARD_BREAKDOWN_SYSTEM_PROMPT,
        maxShots: BREAKDOWN_MAX_SHOTS,
        episodeNo: ep,
      });
      const finished = await waitForTask(accepted.taskId);
      if (finished?.status === "failed") {
        window.alert(finished.outputSummary || "分镜拆解失败，请稍后重试。");
        return;
      }
      // Load the freshly-created storyboards for this episode only
      const res = await listStoryboards(currentProjectId, ep);
      seedEpisodeStoryboards(ep, res.items);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "分镜拆解失败";
      setNotice(msg);
      window.alert("分镜拆解失败，请稍后重试。");
    } finally {
      setPendingTask(null);
    }
  };

  const getShotModel = (shotId: string) =>
    shotModels[shotId] ?? DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID;

  const handleGenerateImage = async (item: Storyboard) => {
    if (!currentProjectId) return;
    setPendingTask(`img-${item.id}`);
    setNotice(null);
    try {
      const prompt = draftPrompts[item.id] ?? item.script;
      const urls = (refImages[item.id] ?? []).map((a) => a.url);
      const model = getShotModel(item.id);
      const accepted = await generateStoryboardImage(item.id, prompt, urls, model);
      const finished = await waitForTask(accepted.taskId);
      if (finished?.status === "succeeded") {
        // Fetch only this storyboard to get the updated imageUrl
        const updated = await getStoryboard(currentProjectId, item.id);
        patchActiveShot(updated);
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "生成参考图失败");
    } finally {
      setPendingTask((p) => (p === `img-${item.id}` ? null : p));
    }
  };

  const handleBlurSave = async (item: Storyboard) => {
    if (!currentProjectId) return;
    const nextScript = draftPrompts[item.id];
    if (!nextScript || nextScript === item.script) return;
    try {
      await updateStoryboard(currentProjectId, item.id, { script: nextScript });
      // Update local copy so comparisons stay accurate
      setEpisodeStoryboards((prev) => ({
        ...prev,
        [activeEpisode]: (prev[activeEpisode] ?? []).map((s) =>
          s.id === item.id ? { ...s, script: nextScript } : s,
        ),
      }));
    } catch {
      /* non-critical, keep draft */
    }
  };

  const handleDeleteShot = async (item: Storyboard) => {
    if (!currentProjectId) return;
    setPendingTask(`del-${item.id}`);
    try {
      await deleteStoryboard(currentProjectId, item.id);
      // Remove from this episode's local list only
      setEpisodeStoryboards((prev) => ({
        ...prev,
        [activeEpisode]: (prev[activeEpisode] ?? []).filter((s) => s.id !== item.id),
      }));
    } finally {
      setPendingTask(null);
    }
  };

  const toggleRefImage = (
    shotId: string,
    asset: ReferenceAssetSelection,
    selected: boolean,
  ) => {
    setRefImages((prev) => {
      const current = prev[shotId] ?? [];
      return {
        ...prev,
        [shotId]: selected
          ? [...current.filter((a) => a.id !== asset.id), asset]
          : current.filter((a) => a.id !== asset.id),
      };
    });
  };

  const handleLocalUploadClick = (shotId: string) => {
    setUploadingForShot(shotId);
    uploadInputRef.current?.click();
  };

  const handleFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !uploadingForShot) return;
    const targetShot = uploadingForShot;
    setUploading(true);
    try {
      const uploaded = await uploadFile(file, "image");
      const asset: ReferenceAssetSelection = {
        id: uploaded.id,
        name: uploaded.originalName,
        url: uploaded.url,
        previewUrl: uploaded.url,
        assetType: "upload",
        description: "",
        mediaKind: "image",
      };
      toggleRefImage(targetShot, asset, true);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "上传失败，请重试");
    } finally {
      setUploading(false);
      setUploadingForShot(null);
    }
  };

  const exportPrompts = () => {
    if (!storyboards.length) return;
    const lines = storyboards.map(
      (s) => `S${String(s.shotNo).padStart(2, "0")} | ${draftPrompts[s.id] ?? s.script}`,
    );
    const blob = new Blob([lines.join("\n\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ep${activeEpisode}-storyboard-prompts.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const noProject = !currentProjectId;
  const isBreakingDown = pendingTask === "auto-breakdown";

  // ── Breakdown elapsed timer effect (must be after isBreakingDown) ──
  useEffect(() => {
    if (!isBreakingDown) {
      setElapsedSeconds(0);
      return;
    }
    setElapsedSeconds(0);
    const id = window.setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [isBreakingDown]);

  const breakdownElapsed = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
  const breakdownProgress = Math.min(Math.round((elapsedSeconds / 300) * 100), 99);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Hidden file input */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleFileSelected(e)}
      />

      {/* ── Toolbar — 与 /create/video-replace 统一视觉风格 ── */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-card/30 px-6 py-4">
        <div className="flex items-start gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
              <span className="text-primary">合成工具箱：</span>剧本拆解提示词
            </h1>
            <p className="mt-1.5 text-xs text-muted-foreground">
              粘贴剧本 → 点击"AI 自动拆解分镜"，系统将自动输出逐镜头中文提示词，可随时编辑、导出或重生。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {loadingShots && <LoaderCircle className="h-4 w-4 animate-spin text-primary" />}
            {storyboards.length > 0 && (
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary">
                第 {activeEpisode} 集 · 共 {storyboards.length} 个分镜
              </span>
            )}
            {notice && (
              <span className="max-w-xs truncate rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                {notice}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleAutoBreakdown()}
            disabled={isBreakingDown || noProject}
            className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm shadow-primary/20 transition-all hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            {isBreakingDown ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {isBreakingDown ? "拆解中..." : "AI 自动拆解分镜"}
          </button>
          <button
            onClick={exportPrompts}
            disabled={storyboards.length === 0}
            className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            导出提示词
          </button>
        </div>
      </div>

      {/* ── Breakdown progress banner ── */}
      {isBreakingDown && (
        <div className="relative shrink-0 overflow-hidden border-b border-amber-600/40 bg-amber-500/15 px-6 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          {/* animated progress bar */}
          <div
            className="absolute bottom-0 left-0 h-0.5 bg-amber-600 transition-all duration-1000 dark:bg-amber-400/60"
            style={{ width: `${breakdownProgress}%` }}
          />
          <div className="flex items-center gap-3">
            <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-amber-700 dark:text-amber-400" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                AI 正在拆解分镜，请勿关闭或刷新页面
              </p>
              <p className="mt-0.5 text-[11px] text-amber-900/75 dark:text-amber-300/70">
                电影级文字分镜需要大模型深度推理，通常需要 <span className="font-medium text-amber-800 dark:text-amber-300">2–5 分钟</span>，最长等待约 <span className="font-medium text-amber-800 dark:text-amber-300">5 分 30 秒</span>。关闭页面将导致本次拆解结果丢失。
              </p>
            </div>
            <div className="shrink-0 rounded-lg border border-amber-600/40 bg-amber-500/20 px-3 py-1.5 text-center dark:border-amber-500/30 dark:bg-amber-500/10">
              <p className="font-mono text-base font-bold tabular-nums text-amber-800 dark:text-amber-300">{breakdownElapsed}</p>
              <p className="text-[10px] text-amber-700/80 dark:text-amber-400/60">已等待</p>
            </div>
          </div>
        </div>
      )}

      {noProject ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/8">
              <Wand2 className="h-7 w-7 text-primary/50" />
            </div>
            <p className="text-sm font-medium text-foreground">请先选择一个项目</p>
            <p className="mt-1 text-xs text-muted-foreground">
              返回首页选择或创建项目后，再使用剧本拆解工具。
            </p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* ── Left: Script editor ── */}
          <div className="flex w-[40%] min-w-0 flex-col border-r border-border">
            {/* Episode tabs */}
            <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-card/30 px-3">
              {episodes.map((ep) => (
                <div key={ep} className="group/tab relative flex items-center">
                  <button
                    onClick={() => setActiveEpisode(ep)}
                    className={cn(
                      "rounded-md py-1.5 text-xs font-medium transition-colors",
                      activeEpisode === ep
                        ? "bg-secondary text-secondary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      episodes.length > 1 ? "pl-3 pr-6" : "px-3",
                    )}
                  >
                    第 {ep} 集
                    {/* dot indicator when episode has content */}
                    {(episodeScripts[ep] || (episodeStoryboards[ep]?.length ?? 0) > 0) && (
                      <span className={cn(
                        "ml-1.5 inline-block h-1.5 w-1.5 rounded-full",
                        activeEpisode === ep ? "bg-primary" : "bg-muted-foreground/50",
                      )} />
                    )}
                  </button>
                  {episodes.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteEpisode(ep);
                      }}
                      title="删除此集"
                      className="absolute right-1 top-1/2 -translate-y-1/2 flex h-4 w-4 items-center justify-center rounded opacity-0 transition-opacity hover:bg-destructive/20 hover:text-destructive group-hover/tab:opacity-100"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={handleAddEpisode}
                title="添加新一集"
                className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                +
              </button>

              {/* Save status */}
              <div className="ml-auto flex items-center gap-1.5 text-[11px]">
                {saveState === "saving" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                    <LoaderCircle className="h-3 w-3 animate-spin" />
                    保存中
                  </span>
                )}
                {saveState === "saved" && content && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-0.5 text-indigo-400">
                    <CheckCircle2 className="h-3 w-3" />
                    已保存
                  </span>
                )}
                {saveState === "error" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    保存失败
                  </span>
                )}
              </div>
            </div>

            {/* Textarea — key forces remount on episode change for clean undo history */}
            <div className="min-h-0 flex-1 p-5">
              <textarea
                key={`script-ep${activeEpisode}`}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="h-full w-full resize-none bg-transparent text-sm leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none"
                placeholder={`第 ${activeEpisode} 集剧本\n\n粘贴或输入故事剧本后，点击顶部「AI 自动拆解分镜」生成分镜提示词。`}
              />
            </div>

            {/* AI toolbar */}
            <div className="shrink-0 border-t border-border bg-card/30 p-4">
              <p className="mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <Wand2 className="h-3.5 w-3.5 text-primary" />
                AI 剧本辅助
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void handleRewrite("扩写并润色当前剧本", "polish")}
                  disabled={!!pendingScriptAction}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium transition-all hover:border-primary/40 hover:bg-primary/5 disabled:pointer-events-none disabled:opacity-50"
                >
                  {pendingScriptAction === "polish" ? (
                    <LoaderCircle className="h-3 w-3 animate-spin text-primary" />
                  ) : (
                    <Sparkles className="h-3 w-3 text-primary" />
                  )}
                  扩写润色
                </button>
                <button
                  onClick={() => void handleRewrite("提炼人物关系并补充人物动机", "relations")}
                  disabled={!!pendingScriptAction}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium transition-all hover:border-blue-500/40 hover:bg-blue-500/5 disabled:pointer-events-none disabled:opacity-50"
                >
                  {pendingScriptAction === "relations" ? (
                    <LoaderCircle className="h-3 w-3 animate-spin text-blue-500" />
                  ) : (
                    <Users className="h-3 w-3 text-blue-500" />
                  )}
                  提炼人物关系
                </button>
              </div>
            </div>
          </div>

          {/* ── Right: Storyboard shots ── */}
          <div className="flex min-w-0 flex-1 flex-col">
            {storyboards.length === 0 && !loadingShots ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/8">
                  <ImageIcon className="h-7 w-7 text-primary/50" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">第 {activeEpisode} 集暂无分镜提示词</p>
                  <p className="mt-1.5 max-w-[260px] text-xs leading-5 text-muted-foreground">
                    在左侧编辑器中输入第 {activeEpisode}{" "}
                    集剧本，然后点击顶部「AI 自动拆解分镜」按钮生成逐镜头提示词。
                  </p>
                </div>
                <button
                  onClick={() => void handleAutoBreakdown()}
                  disabled={isBreakingDown || !content.trim()}
                  className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 transition-all hover:bg-primary/90 disabled:opacity-50"
                >
                  {isBreakingDown ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  开始拆解
                </button>
              </div>
            ) : (
              <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-5">
                {storyboards.map((item, idx) => {
                  const cover = shotCoverUrl(item);
                  const isImgPending = pendingTask === `img-${item.id}`;
                  const isDelPending = pendingTask === `del-${item.id}`;
                  const selectedRefs = refImages[item.id] ?? [];
                  const isPickerOpen = showRefPicker === item.id;
                  const isModelOpen = showModelPicker === item.id;
                  const currentModel =
                    XIAOLOU_TEXT_TO_IMAGE_MODELS.find((m) => m.id === getShotModel(item.id)) ??
                    XIAOLOU_TEXT_TO_IMAGE_MODELS[0];
                  const prevItem = storyboards[idx - 1];
                  const isNewPart = item.partNo != null && item.partNo !== prevItem?.partNo;

                  return (
                    <div key={item.id}>
                      {/* Part header (expert mode) */}
                      {isNewPart && item.partTitle && (
                        <div className="mb-3 mt-1 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-primary/20 px-2.5 py-0.5 text-[10px] font-bold text-primary">
                              第 {item.partNo} 部分
                            </span>
                            {item.weather && (
                              <span className="text-[10px] text-muted-foreground">{item.weather}</span>
                            )}
                          </div>
                          <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/80">
                            {item.partTitle}
                          </p>
                          {item.blocking && (
                            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/70">
                              {item.blocking}
                            </p>
                          )}
                          {item.camera && (
                            <p className="mt-0.5 text-[10px] text-indigo-300/70">{item.camera}</p>
                          )}
                        </div>
                      )}

                      <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-4 transition-shadow hover:shadow-lg hover:shadow-black/10">
                        <div className="flex gap-4">
                          {/* Image preview */}
                          <div
                            className="group/img relative aspect-video w-52 shrink-0 overflow-hidden rounded-lg bg-muted"
                            onDoubleClick={() =>
                              cover &&
                              setLightbox({
                                url: cover,
                                label: `S${String(item.shotNo).padStart(2, "0")}`,
                              })
                            }
                          >
                            {cover ? (
                              <img
                                src={cover}
                                alt={item.title}
                                className="h-full w-full object-cover transition-transform duration-300 group-hover/img:scale-[1.03]"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <GeneratedMediaPlaceholder
                                kind="image"
                                className="h-full w-full"
                                description="生成后展示"
                              />
                            )}
                            <div className="absolute left-2 top-2 rounded bg-background/80 px-1.5 py-0.5 font-mono text-[10px] backdrop-blur">
                              S{String(item.shotNo).padStart(2, "0")}
                            </div>
                            {cover && (
                              <button
                                type="button"
                                onClick={() =>
                                  setLightbox({
                                    url: cover,
                                    label: `S${String(item.shotNo).padStart(2, "0")}`,
                                  })
                                }
                                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-background/70 text-foreground opacity-0 backdrop-blur transition-opacity hover:bg-background/90 group-hover/img:opacity-100"
                                title="放大查看（双击也可放大）"
                              >
                                <ZoomIn className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {item.durationSeconds ? (
                              <div className="absolute bottom-2 right-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] backdrop-blur">
                                {item.durationSeconds}s
                              </div>
                            ) : null}
                          </div>

                          {/* Prompt + controls */}
                          <div className="flex min-w-0 flex-1 flex-col gap-3">
                            <textarea
                              value={draftPrompts[item.id] ?? item.script}
                              onChange={(e) =>
                                setEpisodeDraftPrompts((prev) => ({
                                  ...prev,
                                  [activeEpisode]: {
                                    ...(prev[activeEpisode] ?? {}),
                                    [item.id]: e.target.value,
                                  },
                                }))
                              }
                              onBlur={() => void handleBlurSave(item)}
                              rows={4}
                              className="w-full resize-none rounded-lg border border-transparent bg-white/[0.04] p-2.5 text-xs leading-relaxed transition-colors placeholder:text-muted-foreground/40 focus:border-border focus:outline-none"
                              placeholder="分镜提示词..."
                            />

                            {/* Reference images row + model selector */}
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
                                    onClick={() => toggleRefImage(item.id, asset, false)}
                                    className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover/ref:opacity-100"
                                  >
                                    <X className="h-3 w-3 text-white" />
                                  </button>
                                </div>
                              ))}

                              {/* + 资产库 */}
                              <button
                                type="button"
                                onClick={() => setShowRefPicker(isPickerOpen ? null : item.id)}
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

                              {/* 本地上传 */}
                              <button
                                type="button"
                                onClick={() => handleLocalUploadClick(item.id)}
                                disabled={uploading && uploadingForShot === item.id}
                                className="flex h-9 items-center gap-1 rounded-md border border-dashed border-white/20 px-2 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:pointer-events-none disabled:opacity-50"
                                title="从本地上传参考图"
                              >
                                {uploading && uploadingForShot === item.id ? (
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

                              {/* Model selector */}
                              <div
                                className="relative ml-auto"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setShowModelPicker(isModelOpen ? null : item.id)
                                  }
                                  className={cn(
                                    "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                                    isModelOpen
                                      ? "border-primary/50 bg-primary/10 text-primary"
                                      : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-primary/5",
                                  )}
                                >
                                  <ImageIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                                  {currentModel?.name ?? "选择模型"}
                                  <ChevronDown
                                    className={cn(
                                      "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
                                      isModelOpen && "rotate-180",
                                    )}
                                  />
                                </button>

                                {isModelOpen && (
                                  <div className="absolute right-0 top-full z-20 mt-1.5 w-52 rounded-xl border border-border bg-card shadow-2xl shadow-black/20">
                                    <div className="border-b border-border px-3 py-2">
                                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                        选择生成模型
                                      </p>
                                    </div>
                                    <div className="p-1.5">
                                      {XIAOLOU_TEXT_TO_IMAGE_MODELS.map((model) => {
                                        const isSelected = getShotModel(item.id) === model.id;
                                        return (
                                          <button
                                            key={model.id}
                                            type="button"
                                            onClick={() => {
                                              setShotModels((prev) => ({
                                                ...prev,
                                                [item.id]: model.id,
                                              }));
                                              setShowModelPicker(null);
                                            }}
                                            className={cn(
                                              "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors",
                                              isSelected
                                                ? "bg-primary/10 text-primary"
                                                : "text-foreground hover:bg-accent",
                                            )}
                                          >
                                            <span className="font-medium">{model.name}</span>
                                            {model.recommended && !isSelected && (
                                              <span className="rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-300">
                                                推荐
                                              </span>
                                            )}
                                            {isSelected && (
                                              <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                                            )}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Asset picker dropdown */}
                            {isPickerOpen && currentProjectId && (
                              <div className="rounded-xl border border-border bg-card p-4 shadow-2xl shadow-black/20">
                                <div className="mb-3 flex items-center justify-between">
                                  <span className="text-xs font-medium text-foreground">
                                    选择参考图（角色 / 场景 / 道具）
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setShowRefPicker(null)}
                                    className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                                <ReferenceAssetPicker
                                  projectId={currentProjectId}
                                  selectedAssetIds={selectedRefs.map((a) => a.id)}
                                  mediaKind="image"
                                  hint="选择角色、场景或道具参考图，生成分镜图时作为风格参考"
                                  onSelect={(asset) => toggleRefImage(item.id, asset, true)}
                                  onToggleSelect={(asset, selected) =>
                                    toggleRefImage(item.id, asset, selected)
                                  }
                                />
                              </div>
                            )}
                          </div>

                          {/* Action column */}
                          <div className="flex w-20 shrink-0 flex-col gap-2 border-l border-border pl-3">
                            <button
                              type="button"
                              onClick={() => void handleGenerateImage(item)}
                              disabled={isImgPending || isDelPending}
                              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-2 text-[11px] font-medium text-primary-foreground shadow-sm shadow-primary/20 transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                            >
                              {isImgPending ? (
                                <LoaderCircle className="h-3 w-3 animate-spin" />
                              ) : (
                                <ImageIcon className="h-3 w-3" />
                              )}
                              {isImgPending ? "生成中" : "生成图"}
                            </button>

                            {item.imageStatus && item.imageStatus !== "pending" && (
                              <div className="rounded-md bg-secondary px-1.5 py-1 text-center text-[10px] text-muted-foreground">
                                {item.imageStatus}
                              </div>
                            )}

                            <button
                              type="button"
                              onClick={() => void handleDeleteShot(item)}
                              disabled={isImgPending || isDelPending}
                              className="mt-auto flex h-8 w-full items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
                              title="删除此分镜"
                            >
                              {isDelPending ? (
                                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Lightbox ── */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <div className="absolute left-5 top-5 rounded-lg bg-background/70 px-3 py-1.5 font-mono text-sm font-medium text-foreground backdrop-blur">
            {lightbox.label}
          </div>
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-background/70 text-foreground backdrop-blur transition-colors hover:bg-background/90"
          >
            <X className="h-4 w-4" />
          </button>
          <img
            src={lightbox.url}
            alt={lightbox.label}
            referrerPolicy="no-referrer"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[88vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl shadow-black/60 ring-1 ring-white/10"
          />
        </div>
      )}
    </div>
  );
}
