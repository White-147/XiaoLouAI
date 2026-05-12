import {
  LoaderCircle,
  Sparkles,
  Users,
  Wand2,
} from "lucide-react";
import { EpisodeTabsBar, type EpisodeTabsBarProps } from "./EpisodeTabsBar";

export type ScriptEditorPaneProps = {
  activeEpisode: number;
  episodeTabs: Omit<EpisodeTabsBarProps, "content">;
  content: string;
  pendingScriptAction: string | null;
  onContentChange: (value: string) => void;
  onRewrite: (instruction: string, actionKey: string) => void | Promise<void>;
};

export function ScriptEditorPane({
  activeEpisode,
  episodeTabs,
  content,
  pendingScriptAction,
  onContentChange,
  onRewrite,
}: ScriptEditorPaneProps) {
  return (
    <div className="flex w-[44%] min-w-0 flex-col border-r border-border">
      <EpisodeTabsBar {...episodeTabs} content={content} />

      <div className="min-h-0 flex-1 p-5">
        <textarea
          key={`script-ep${activeEpisode}`}
          value={content}
          onChange={(event) => onContentChange(event.target.value)}
          className="h-full w-full resize-none bg-transparent text-sm leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none"
          placeholder={`第 ${activeEpisode} 集剧本\n\n粘贴或输入故事剧本后，点击顶部「AI 自动拆解分镜」生成分镜提示词。`}
        />
      </div>

      <div className="shrink-0 border-t border-border bg-card/30 p-4">
        <p className="mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <Wand2 className="h-3.5 w-3.5 text-primary" />
          AI 剧本辅助
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void onRewrite("扩写并润色当前剧本", "polish")}
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
            type="button"
            onClick={() => void onRewrite("提炼人物关系并补充人物动机", "relations")}
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
  );
}
