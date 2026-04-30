import {
  Download,
  LoaderCircle,
  Mic,
  Pause,
  Play,
  RefreshCw,
  Volume2,
  WandSparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import {
  GeneratedMediaPlaceholder,
  getGeneratedMediaUrl,
} from "../../components/media/GenerationPlaceholder";
import {
  generateDubbing,
  getProjectOverview,
  updateDubbing,
  type Dubbing as DubbingItem,
  type Storyboard,
  type Task,
} from "../../lib/api";
import { useCurrentProjectId } from "../../lib/session";

type ShotEntry = {
  storyboard: Storyboard;
  dubbing?: DubbingItem;
  latestDubbingTask?: Task;
  latestLipSyncTask?: Task;
};

const LIP_SYNC_NOTICE = "口型功能二期开放";

const VOICE_OPTIONS = [
  {
    value: "longanyang",
    label: "通用中文",
    description: "当前已验证可用，适合节点六稳定生成。",
  },
];

const VOICE_ALIAS_MAP: Record<string, string> = {
  female_story_01: "longanyang",
  female_calm_01: "longanyang",
  male_story_01: "longanyang",
  narrator_01: "longanyang",
};

function normalizeVoicePreset(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) return "longanyang";
  if (normalized.startsWith("long")) return normalized;
  return VOICE_ALIAS_MAP[normalized] || "longanyang";
}

function taskStatusLabel(status: string | null | undefined) {
  if (status === "queued") return "排队中";
  if (status === "running") return "生成中";
  if (status === "succeeded" || status === "ready") return "已完成";
  if (status === "failed") return "失败";
  if (status === "draft") return "未生成";
  return "待生成";
}

function shotCover(storyboard: Storyboard) {
  return getGeneratedMediaUrl(storyboard.imageUrl);
}

function playableAudioUrl(dubbing?: DubbingItem) {
  if (!dubbing?.audioUrl) return null;
  return dubbing.audioUrl.includes("mock.assets.local") ? null : dubbing.audioUrl;
}

function hasActiveTask(task?: Task) {
  return task?.status === "queued" || task?.status === "running";
}

export default function Dubbing() {
  const [currentProjectId] = useCurrentProjectId();
  const [entries, setEntries] = useState<ShotEntry[]>([]);
  const [activeStoryboardId, setActiveStoryboardId] = useState<string>("");
  const [dialogue, setDialogue] = useState("");
  const [speakerName, setSpeakerName] = useState("旁白");
  const [voicePreset, setVoicePreset] = useState("longanyang");
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const overview = await getProjectOverview(currentProjectId);
      const nextEntries = overview.storyboards.map((storyboard) => ({
        storyboard,
        dubbing: overview.dubbings.find((item) => item.storyboardId === storyboard.id),
        latestDubbingTask: overview.tasks.find(
          (task) => task.type === "dubbing_generate" && task.storyboardId === storyboard.id,
        ),
        latestLipSyncTask: overview.tasks.find(
          (task) => task.type === "lipsync_generate" && task.storyboardId === storyboard.id,
        ),
      }));

      setEntries(nextEntries);

      const nextActiveId =
        activeStoryboardId && nextEntries.some((item) => item.storyboard.id === activeStoryboardId)
          ? activeStoryboardId
          : nextEntries[0]?.storyboard.id;

      if (nextActiveId) {
        const activeEntry = nextEntries.find((item) => item.storyboard.id === nextActiveId) ?? null;
        setActiveStoryboardId(nextActiveId);
        setDialogue(activeEntry?.dubbing?.text || activeEntry?.storyboard.script || "");
        setSpeakerName(activeEntry?.dubbing?.speakerName || "旁白");
        setVoicePreset(normalizeVoicePreset(activeEntry?.dubbing?.voicePreset));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [currentProjectId]);

  const activeEntry = useMemo(
    () => entries.find((item) => item.storyboard.id === activeStoryboardId) ?? null,
    [activeStoryboardId, entries],
  );

  const activeAudioUrl = useMemo(
    () => playableAudioUrl(activeEntry?.dubbing),
    [activeEntry?.dubbing],
  );

  const hasActiveTasks = useMemo(
    () =>
      entries.some(
        (entry) => hasActiveTask(entry.latestDubbingTask) || hasActiveTask(entry.latestLipSyncTask),
      ),
    [entries],
  );

  useEffect(() => {
    if (!hasActiveTasks && !pendingAction) return;

    const timer = window.setInterval(() => {
      void loadData();
    }, 3500);

    return () => window.clearInterval(timer);
  }, [currentProjectId, hasActiveTasks, pendingAction]);

  useEffect(() => {
    setIsAudioPlaying(false);
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
  }, [activeStoryboardId, activeAudioUrl]);

  const handleSelect = (entry: ShotEntry) => {
    setActiveStoryboardId(entry.storyboard.id);
    setDialogue(entry.dubbing?.text || entry.storyboard.script || "");
    setSpeakerName(entry.dubbing?.speakerName || "旁白");
    setVoicePreset(normalizeVoicePreset(entry.dubbing?.voicePreset));
  };

  const handleSaveDraft = async () => {
    if (!activeEntry?.dubbing) return;

    setPendingAction("save");
    try {
      await updateDubbing(currentProjectId, activeEntry.dubbing.id, {
        text: dialogue.trim(),
        speakerName: speakerName.trim() || "旁白",
        voicePreset: normalizeVoicePreset(voicePreset),
      });
      await loadData();
    } finally {
      setPendingAction(null);
    }
  };

  const handleGenerateDubbing = async () => {
    if (!activeEntry || !dialogue.trim()) return;

    setPendingAction("dubbing");
    try {
      await generateDubbing(activeEntry.storyboard.id, {
        text: dialogue.trim(),
        speakerName: speakerName.trim() || "旁白",
        voicePreset: normalizeVoicePreset(voicePreset),
      });
      await loadData();
    } finally {
      setPendingAction(null);
    }
  };

  const handleToggleAudio = async () => {
    if (!audioRef.current || !activeAudioUrl) return;

    if (audioRef.current.paused) {
      await audioRef.current.play();
      return;
    }

    audioRef.current.pause();
  };

  const activeDubbingStatus = activeEntry?.latestDubbingTask?.status || activeEntry?.dubbing?.status || "draft";

  const selectableVoiceOptions = useMemo(() => {
    const normalizedCurrent = normalizeVoicePreset(voicePreset);
    if (VOICE_OPTIONS.some((item) => item.value === normalizedCurrent)) {
      return VOICE_OPTIONS;
    }

    return [
      {
        value: normalizedCurrent,
        label: normalizedCurrent,
        description: "当前项目使用的自定义声线 ID。",
      },
      ...VOICE_OPTIONS,
    ];
  }, [voicePreset]);

  return (
    <div className="flex h-full w-full">
      <aside className="flex w-80 flex-col border-r border-border bg-card/30">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <span className="text-sm font-medium">镜头列表</span>
          {loading ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : null}
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-2 custom-scrollbar">
          {entries.map((entry) => {
            const dubbingStatus =
              entry.latestDubbingTask?.status || entry.dubbing?.status || "draft";
            const coverUrl = shotCover(entry.storyboard);

            return (
              <button
                key={entry.storyboard.id}
                onClick={() => handleSelect(entry)}
                className={cn(
                  "w-full rounded-lg border p-3 text-left transition-colors",
                  activeStoryboardId === entry.storyboard.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-accent",
                )}
              >
                <div className="mb-2 flex items-center gap-3">
                  <div className="aspect-video w-16 shrink-0 overflow-hidden rounded bg-muted">
                    {coverUrl ? (
                      <img
                        src={coverUrl}
                        alt="Shot"
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <GeneratedMediaPlaceholder kind="image" compact className="h-full w-full" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 text-xs font-mono">
                      S{String(entry.storyboard.shotNo).padStart(2, "0")}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {entry.dubbing?.text || entry.storyboard.script}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
                    配音: {taskStatusLabel(dubbingStatus)}
                  </span>
                  <span className="rounded bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
                    口型: {LIP_SYNC_NOTICE}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="flex flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center justify-end gap-3 border-b border-border bg-card/30 px-6">
          <button
            onClick={() => void loadData()}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
          <button
            disabled
            className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            title={LIP_SYNC_NOTICE}
          >
            <WandSparkles className="h-4 w-4" />
            口型功能二期开放
          </button>
          <button
            onClick={() => void handleGenerateDubbing()}
            disabled={!activeEntry || !dialogue.trim() || pendingAction === "dubbing"}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pendingAction === "dubbing" ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
            生成配音
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="mx-auto max-w-4xl space-y-8">
            <div className="overflow-hidden rounded-2xl border border-border bg-card/40">
              <div className="relative flex aspect-video items-center justify-center bg-black">
                {activeEntry && shotCover(activeEntry.storyboard) ? (
                  <img
                    src={shotCover(activeEntry.storyboard) ?? undefined}
                    alt="Preview"
                    className="h-full w-full object-cover opacity-55"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <GeneratedMediaPlaceholder
                    kind="image"
                    className="h-full w-full bg-black text-zinc-300"
                    description="分镜图生成后会在这里显示"
                  />
                )}
                <button
                  onClick={() => void handleToggleAudio()}
                  disabled={!activeAudioUrl}
                  className="absolute flex h-16 w-16 items-center justify-center rounded-full bg-primary/90 text-primary-foreground transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isAudioPlaying ? <Pause className="h-8 w-8" /> : <Play className="ml-1 h-8 w-8" />}
                </button>
              </div>

              <div className="space-y-4 border-t border-border px-6 py-5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground">
                    配音状态：{taskStatusLabel(activeDubbingStatus)}
                  </span>
                  <span className="rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground">
                    口型状态：{LIP_SYNC_NOTICE}
                  </span>
                  {activeEntry?.dubbing ? (
                    <span className="rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground">
                      声线：{normalizeVoicePreset(activeEntry.dubbing.voicePreset)}
                    </span>
                  ) : null}
                </div>

                {activeEntry?.latestDubbingTask?.status === "failed" ? (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {activeEntry.latestDubbingTask.outputSummary || "配音生成失败，请调整台词或声线后重试。"}
                  </div>
                ) : null}

                {activeAudioUrl ? (
                  <div className="space-y-3">
                    <audio
                      ref={audioRef}
                      src={activeAudioUrl}
                      controls
                      preload="metadata"
                      className="w-full"
                      onPlay={() => setIsAudioPlaying(true)}
                      onPause={() => setIsAudioPlaying(false)}
                      onEnded={() => setIsAudioPlaying(false)}
                    />
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => void handleToggleAudio()}
                        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
                      >
                        <Volume2 className="h-4 w-4" />
                        {isAudioPlaying ? "暂停试听" : "播放试听"}
                      </button>
                      <a
                        href={activeAudioUrl}
                        download
                        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
                      >
                        <Download className="h-4 w-4" />
                        下载音频
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                    当前镜头还没有可播放的真实音频。生成完成后会在这里直接预览。
                  </div>
                )}

                <div className="rounded-xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
                  {LIP_SYNC_NOTICE}，本期仅开放配音生成、试听和下载。
                </div>
              </div>
            </div>

            <div className="glass-panel space-y-6 rounded-2xl p-6">
              <div className="space-y-3">
                <label className="text-sm font-medium">台词文本</label>
                <textarea
                  value={dialogue}
                  onChange={(event) => setDialogue(event.target.value)}
                  className="h-28 w-full resize-none rounded-lg border border-border bg-input px-4 py-3 transition-shadow focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="space-y-3">
                  <label className="text-sm font-medium">角色 / 说话人</label>
                  <input
                    value={speakerName}
                    onChange={(event) => setSpeakerName(event.target.value)}
                    className="w-full rounded-lg border border-border bg-input px-4 py-2.5 transition-shadow focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div className="space-y-3">
                  <label className="text-sm font-medium">声线</label>
                  <select
                    value={normalizeVoicePreset(voicePreset)}
                    onChange={(event) => setVoicePreset(event.target.value)}
                    className="w-full rounded-lg border border-border bg-input px-4 py-2.5 transition-shadow focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    {selectableVoiceOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {selectableVoiceOptions.find(
                      (item) => item.value === normalizeVoicePreset(voicePreset),
                    )?.description || "当前会自动归一到已验证可用的声线 ID。"}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 border-t border-border pt-4">
                <button
                  onClick={() => void handleSaveDraft()}
                  disabled={!activeEntry?.dubbing || pendingAction === "save"}
                  className="rounded-lg border border-primary px-4 py-2.5 font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pendingAction === "save" ? "保存中..." : "保存草稿"}
                </button>
                <button
                  onClick={() => void handleGenerateDubbing()}
                  disabled={!activeEntry || !dialogue.trim() || pendingAction === "dubbing"}
                  className="rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pendingAction === "dubbing" ? "生成配音中..." : "重新生成配音"}
                </button>
                <button
                  disabled
                  className="rounded-lg border border-border px-4 py-2.5 font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  title={LIP_SYNC_NOTICE}
                >
                  口型功能二期开放
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
