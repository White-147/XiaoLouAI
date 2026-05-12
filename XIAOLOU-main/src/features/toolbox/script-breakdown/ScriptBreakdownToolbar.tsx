import {
  Download,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";

type ScriptBreakdownToolbarProps = {
  activeEpisode: number;
  storyboardCount: number;
  loadingShots: boolean;
  notice: string | null;
  isBreakingDown: boolean;
  noProject: boolean;
  onAutoBreakdown: () => void | Promise<void>;
  onExportPrompts: () => void;
};

export function ScriptBreakdownToolbar({
  activeEpisode,
  storyboardCount,
  loadingShots,
  notice,
  isBreakingDown,
  noProject,
  onAutoBreakdown,
  onExportPrompts,
}: ScriptBreakdownToolbarProps) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border bg-card/30 px-6 py-4">
      <div className="flex items-start gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <span className="text-primary">合成工具箱：</span>剧本拆解提示词
          </h1>
          <p className="mt-1.5 text-xs text-muted-foreground">
            粘贴剧本 → 点击&quot;AI 自动拆解分镜&quot;，系统将自动输出逐镜头中文提示词，可随时编辑、导出或重生。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {loadingShots && <LoaderCircle className="h-4 w-4 animate-spin text-primary" />}
          {storyboardCount > 0 && (
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary">
              第 {activeEpisode} 集 · 共 {storyboardCount} 个分镜
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
          onClick={() => void onAutoBreakdown()}
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
          onClick={onExportPrompts}
          disabled={storyboardCount === 0}
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" />
          导出提示词
        </button>
      </div>
    </div>
  );
}
