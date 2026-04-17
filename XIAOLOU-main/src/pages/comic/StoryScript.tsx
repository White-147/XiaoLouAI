import {
  AlertCircle,
  CheckCircle2,
  Image as ImageIcon,
  LoaderCircle,
  Sparkles,
  Users,
  Wand2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { extractAssets, rewriteScript } from "../../lib/api";
import { registerNavigationGuard } from "../../lib/navigation-guards";
import {
  getProjectScriptSnapshot,
  reloadProjectScript,
  saveProjectScript,
  useProjectScript,
} from "../../lib/project-script-store";
import { useCurrentProjectId } from "../../lib/session";
import { cn } from "../../lib/utils";

const episodes = [1, 2];

export default function StoryScript() {
  const [currentProjectId] = useCurrentProjectId();
  const [activeEpisode, setActiveEpisode] = useState(1);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const {
    content,
    error,
    hydrated,
    loading,
    savedContent,
    saveState,
    setContent,
    save,
  } = useProjectScript(currentProjectId);

  useEffect(() => {
    return registerNavigationGuard(async () => {
      const snapshot = getProjectScriptSnapshot(currentProjectId);
      if (!snapshot.hydrated || snapshot.content === snapshot.savedContent) {
        return;
      }

      await saveProjectScript(currentProjectId);
    });
  }, [currentProjectId]);

  const handleRewrite = async (instruction: string, actionKey: string) => {
    setPendingAction(actionKey);

    try {
      await save();
      await rewriteScript(currentProjectId, instruction);
      window.setTimeout(() => {
        void reloadProjectScript(currentProjectId);
      }, 1800);
    } finally {
      window.setTimeout(() => setPendingAction(null), 1800);
    }
  };

  const handleExtractAssets = async () => {
    setPendingAction("extract");

    try {
      const sourceText = await save();
      if (!sourceText.trim()) {
        window.alert("请先输入并保存故事剧本。");
        return;
      }

      await extractAssets(currentProjectId, sourceText);
      window.alert("已开始提取角色、场景和道具，请到节点 3 查看结果。");
    } catch (nextError) {
      console.error(nextError);
      window.alert("剧本保存或提取失败，请稍后重试。");
    } finally {
      window.setTimeout(() => setPendingAction(null), 1200);
    }
  };

  return (
    <div className="flex h-full w-full">
      <div className="flex flex-1 flex-col border-r border-border">
        <div className="flex h-12 items-center gap-2 border-b border-border bg-card/30 px-4">
          {episodes.map((episode) => (
            <button
              key={episode}
              onClick={() => setActiveEpisode(episode)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                activeEpisode === episode
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              第 {episode} 集
            </button>
          ))}
          <button className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
            +
          </button>

          <div className="ml-auto flex items-center gap-2 text-xs">
            {saveState === "saving" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-primary">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                保存中
              </span>
            ) : null}
            {saveState === "saved" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-1 text-indigo-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                已自动保存
              </span>
            ) : null}
            {saveState === "idle" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-muted-foreground">
                <LoaderCircle className="h-3.5 w-3.5" />
                待保存
              </span>
            ) : null}
            {saveState === "error" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-1 text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />
                保存失败
              </span>
            ) : null}
            {loading ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : null}
          </div>
        </div>

        <div className="flex-1 p-6">
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onBlur={() => {
              void save().catch(() => {});
            }}
            className="h-full w-full resize-none bg-transparent text-lg leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none"
            placeholder="在这里输入或粘贴你的故事剧本..."
          />
        </div>
      </div>

      <div className="flex w-80 flex-col bg-card/30">
        <div className="border-b border-border p-4">
          <h3 className="flex items-center gap-2 font-medium">
            <Wand2 className="h-4 w-4 text-primary" />
            AI 辅助工具
          </h3>
        </div>
        <div className="space-y-3 p-4">
          <button
            onClick={() =>
              void handleRewrite("扩写并润色当前剧本", "rewrite-polish")
            }
            className="w-full rounded-lg border border-border bg-card p-3 text-left transition-all hover:border-primary/50 hover:bg-primary/5"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
                {pendingAction === "rewrite-polish" ? (
                  <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <Sparkles className="h-4 w-4 text-primary" />
                )}
              </div>
              <div>
                <div className="text-sm font-medium">扩写与润色</div>
                <div className="text-xs text-muted-foreground">调用剧本改写接口</div>
              </div>
            </div>
          </button>

          <button
            onClick={() =>
              void handleRewrite("提炼人物关系并补充人物动机", "rewrite-relationships")
            }
            className="w-full rounded-lg border border-border bg-card p-3 text-left transition-all hover:border-primary/50 hover:bg-primary/5"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-500/10">
                {pendingAction === "rewrite-relationships" ? (
                  <LoaderCircle className="h-4 w-4 animate-spin text-blue-500" />
                ) : (
                  <Users className="h-4 w-4 text-blue-500" />
                )}
              </div>
              <div>
                <div className="text-sm font-medium">提炼人物关系</div>
                <div className="text-xs text-muted-foreground">补充人物动机和冲突</div>
              </div>
            </div>
          </button>

          <button
            onClick={() => void handleExtractAssets()}
            className="w-full rounded-lg border border-border bg-card p-3 text-left transition-all hover:border-primary/50 hover:bg-primary/5"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-purple-500/10">
                {pendingAction === "extract" ? (
                  <LoaderCircle className="h-4 w-4 animate-spin text-purple-500" />
                ) : (
                  <ImageIcon className="h-4 w-4 text-purple-500" />
                )}
              </div>
              <div>
                <div className="text-sm font-medium">提取角色 / 场景 / 道具</div>
                <div className="text-xs text-muted-foreground">
                  会先保存当前剧本，再把这份最新剧本交给节点 3 提取。
                </div>
              </div>
            </div>
          </button>

          {!hydrated && loading ? (
            <div className="rounded-lg border border-border bg-card/60 p-3 text-xs text-muted-foreground">
              正在同步项目剧本...
            </div>
          ) : null}
          {saveState === "error" ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              {error || "剧本保存失败，请稍后重试。"}
            </div>
          ) : null}
          {hydrated && content === savedContent ? (
            <div className="rounded-lg border border-border bg-card/60 p-3 text-xs text-muted-foreground">
              当前页面展示的是已保存版本，切换到节点 3 会继续沿用这份剧本。
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
