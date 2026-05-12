import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useState,
} from "react";
import {
  autoGenerateStoryboards,
  getScript,
  listStoryboards,
  rewriteScript,
  type Storyboard,
  type Task,
} from "../../../lib/api";
import {
  BREAKDOWN_MAX_SHOTS,
  STORYBOARD_BREAKDOWN_SYSTEM_PROMPT,
} from "./storyboard-breakdown-prompt";

type SaveScriptSnapshotOptions = {
  contentOverride?: string;
};

type UseScriptAiActionsArgs = {
  currentProjectId: string | null;
  activeEpisode: number;
  content: string;
  episodeScripts: Record<number, string>;
  draftPrompts: Record<string, string>;
  storyboards: Storyboard[];
  pendingTask: string | null;
  setPendingTask: Dispatch<SetStateAction<string | null>>;
  setEpisodeScripts: Dispatch<SetStateAction<Record<number, string>>>;
  seedEpisodeStoryboards: (episodeNo: number, storyboards: Storyboard[]) => void;
  saveScriptSnapshot: (
    snapshot: Record<number, string>,
    options?: SaveScriptSnapshotOptions,
  ) => Promise<unknown>;
  markSaveError: () => void;
  setNotice: (notice: string | null) => void;
  waitForTask: (taskId: string) => Promise<Task | null>;
};

export function useScriptAiActions({
  currentProjectId,
  activeEpisode,
  content,
  episodeScripts,
  draftPrompts,
  storyboards,
  pendingTask,
  setPendingTask,
  setEpisodeScripts,
  seedEpisodeStoryboards,
  saveScriptSnapshot,
  markSaveError,
  setNotice,
  waitForTask,
}: UseScriptAiActionsArgs) {
  const [pendingScriptAction, setPendingScriptAction] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const isBreakingDown = pendingTask === "auto-breakdown";

  useEffect(() => {
    if (!isBreakingDown) {
      setElapsedSeconds(0);
      return;
    }
    setElapsedSeconds(0);
    const id = window.setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(id);
  }, [isBreakingDown]);

  const handleRewrite = async (instruction: string, actionKey: string) => {
    if (!currentProjectId) return;
    if (!content.trim()) {
      window.alert("请先输入剧本内容。");
      return;
    }

    setPendingScriptAction(actionKey);
    const episodeNo = activeEpisode;
    const scriptSnapshot = { ...episodeScripts, [episodeNo]: content };
    try {
      // The rewrite job reads the project-level script, so point it at the active
      // episode temporarily, then restore the canonical episode map after it returns.
      await saveScriptSnapshot(scriptSnapshot, { contentOverride: content });
      await rewriteScript(currentProjectId, instruction);
      await new Promise((resolve) => window.setTimeout(resolve, 2200));
      const updated = await getScript(currentProjectId);
      if (updated.content) {
        const nextScripts = { ...scriptSnapshot, [episodeNo]: updated.content };
        setEpisodeScripts(nextScripts);
        await saveScriptSnapshot(nextScripts);
      }
    } catch {
      markSaveError();
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
    const episodeNo = activeEpisode;
    try {
      const scriptSnapshot = { ...episodeScripts, [episodeNo]: content };
      await saveScriptSnapshot(scriptSnapshot);
      const accepted = await autoGenerateStoryboards(currentProjectId, content, {
        systemPrompt: STORYBOARD_BREAKDOWN_SYSTEM_PROMPT,
        maxShots: BREAKDOWN_MAX_SHOTS,
        episodeNo,
      });
      const finished = await waitForTask(accepted.taskId);
      if (finished?.status === "failed") {
        window.alert(finished.outputSummary || "分镜拆解失败，请稍后重试。");
        return;
      }
      const res = await listStoryboards(currentProjectId, episodeNo);
      seedEpisodeStoryboards(episodeNo, res.items);
    } catch (err) {
      const message = err instanceof Error ? err.message : "分镜拆解失败";
      setNotice(message);
      window.alert("分镜拆解失败，请稍后重试。");
    } finally {
      setPendingTask(null);
    }
  };

  const exportPrompts = () => {
    if (!storyboards.length) return;
    const lines = storyboards.map(
      (storyboard) =>
        `S${String(storyboard.shotNo).padStart(2, "0")} | ${draftPrompts[storyboard.id] ?? storyboard.script}`,
    );
    const blob = new Blob([lines.join("\n\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ep${activeEpisode}-storyboard-prompts.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const breakdownElapsed = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
  const breakdownProgress = Math.min(Math.round((elapsedSeconds / 300) * 100), 99);

  return {
    pendingScriptAction,
    isBreakingDown,
    breakdownElapsed,
    breakdownProgress,
    handleRewrite,
    handleAutoBreakdown,
    exportPrompts,
  };
}
