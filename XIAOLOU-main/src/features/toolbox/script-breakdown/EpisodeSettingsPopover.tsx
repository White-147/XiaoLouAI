import { cn } from "../../../lib/utils";

export type EpisodeSettingsMode = "future" | "current";

type EpisodeSettingsPopoverProps = {
  mode: EpisodeSettingsMode;
  startInput: string;
  stepInput: string;
  previewEpisodes: number[];
  onModeChange: (mode: EpisodeSettingsMode) => void;
  onStartInputChange: (value: string) => void;
  onStepInputChange: (value: string) => void;
  onCommitSettings: () => void;
  onApply: () => void;
};

export function EpisodeSettingsPopover({
  mode,
  startInput,
  stepInput,
  previewEpisodes,
  onModeChange,
  onStartInputChange,
  onStepInputChange,
  onCommitSettings,
  onApply,
}: EpisodeSettingsPopoverProps) {
  return (
    <div className="absolute right-0 top-9 z-40 w-72 rounded-xl border border-border bg-card p-3 text-xs shadow-2xl">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-foreground">集数设置</span>
        <div className="flex rounded-md border border-border bg-background/60 p-0.5 text-[11px]">
          <button
            type="button"
            data-episode-settings-mode="future"
            onClick={() => onModeChange("future")}
            className={cn(
              "h-6 rounded px-2 text-muted-foreground transition-colors",
              mode === "future" && "bg-primary/15 text-primary",
            )}
          >
            后续新增
          </button>
          <button
            type="button"
            data-episode-settings-mode="current"
            onClick={() => onModeChange("current")}
            className={cn(
              "h-6 rounded px-2 text-muted-foreground transition-colors",
              mode === "current" && "bg-primary/15 text-primary",
            )}
          >
            重排现有
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-[11px] text-muted-foreground">起始集数</span>
          <input
            data-episode-start-input
            type="number"
            min={1}
            step={1}
            value={startInput}
            onChange={(event) => onStartInputChange(event.target.value)}
            onBlur={onCommitSettings}
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-primary/60"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] text-muted-foreground">增加步长</span>
          <input
            data-episode-step-input
            type="number"
            min={1}
            step={1}
            value={stepInput}
            onChange={(event) => onStepInputChange(event.target.value)}
            onBlur={onCommitSettings}
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-primary/60"
          />
        </label>
      </div>
      <div className="mt-3 flex h-9 items-center gap-2 overflow-hidden rounded-lg border border-border/70 bg-background/60 px-2">
        <div className="shrink-0 text-[11px] text-muted-foreground">预览</div>
        <div className="flex min-w-0 items-center gap-1 whitespace-nowrap">
          {previewEpisodes.map((episodeNo) => (
            <span
              key={episodeNo}
              className="rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary"
            >
              第 {episodeNo} 集
            </span>
          ))}
        </div>
      </div>
      <button
        type="button"
        data-episode-settings-apply
        onClick={onApply}
        className="mt-3 h-8 w-full rounded-md bg-primary text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        应用
      </button>
    </div>
  );
}
