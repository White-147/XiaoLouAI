import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { Storyboard } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { EpisodeSettingsPopover, type EpisodeSettingsMode } from "./EpisodeSettingsPopover";

export type ScriptSaveState = "idle" | "saving" | "saved" | "error";

export type EpisodeTabsBarProps = {
  episodeTabsRef: RefObject<HTMLDivElement | null>;
  episodeSettingsRef: RefObject<HTMLDivElement | null>;
  episodes: number[];
  activeEpisode: number;
  editingEpisode: number | null;
  editingEpisodeInput: string;
  episodeScripts: Record<number, string>;
  episodeStoryboards: Record<number, Storyboard[]>;
  canScrollEpisodes: boolean;
  episodeScrollThumbLeft: number;
  episodeScrollThumbWidth: number;
  isEpisodeTabDragging: boolean;
  episodeSettingsOpen: boolean;
  episodeSettingsMode: EpisodeSettingsMode;
  episodeAddStartInput: string;
  episodeAddStepInput: string;
  episodeAddPreview: number[];
  saveState: ScriptSaveState;
  content: string;
  onScrollEpisodeTabs: (direction: -1 | 1) => void;
  onSyncEpisodeScrollMetrics: () => void;
  onSelectEpisode: (episodeNo: number) => void;
  onStartEpisodeEdit: (episodeNo: number) => void;
  onEditingEpisodeInputChange: (value: string) => void;
  onCommitEpisodeEdit: () => void;
  onCancelEpisodeEdit: () => void;
  onDeleteEpisode: (episodeNo: number) => void;
  onEpisodeScrollRailPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onEpisodeScrollRailPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onEpisodeScrollRailPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onAddEpisode: () => void;
  onToggleEpisodeSettings: () => void;
  onEpisodeSettingsModeChange: (mode: EpisodeSettingsMode) => void;
  onEpisodeAddStartInputChange: (value: string) => void;
  onEpisodeAddStepInputChange: (value: string) => void;
  onCommitEpisodeAddSettings: () => void;
  onApplyEpisodeSettings: () => void;
};

export function EpisodeTabsBar({
  episodeTabsRef,
  episodeSettingsRef,
  episodes,
  activeEpisode,
  editingEpisode,
  editingEpisodeInput,
  episodeScripts,
  episodeStoryboards,
  canScrollEpisodes,
  episodeScrollThumbLeft,
  episodeScrollThumbWidth,
  isEpisodeTabDragging,
  episodeSettingsOpen,
  episodeSettingsMode,
  episodeAddStartInput,
  episodeAddStepInput,
  episodeAddPreview,
  saveState,
  content,
  onScrollEpisodeTabs,
  onSyncEpisodeScrollMetrics,
  onSelectEpisode,
  onStartEpisodeEdit,
  onEditingEpisodeInputChange,
  onCommitEpisodeEdit,
  onCancelEpisodeEdit,
  onDeleteEpisode,
  onEpisodeScrollRailPointerDown,
  onEpisodeScrollRailPointerMove,
  onEpisodeScrollRailPointerUp,
  onAddEpisode,
  onToggleEpisodeSettings,
  onEpisodeSettingsModeChange,
  onEpisodeAddStartInputChange,
  onEpisodeAddStepInputChange,
  onCommitEpisodeAddSettings,
  onApplyEpisodeSettings,
}: EpisodeTabsBarProps) {
  return (
    <div className="flex h-14 shrink-0 items-start gap-1.5 border-b border-border bg-card/30 px-3 py-1.5">
      <button
        type="button"
        onClick={() => onScrollEpisodeTabs(-1)}
        title="向左滚动集数"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <div
          ref={episodeTabsRef}
          data-episode-tabs-scroll
          className="flex h-8 min-w-0 select-none items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={onSyncEpisodeScrollMetrics}
        >
          {episodes.map((episodeNo) => (
            <div
              key={episodeNo}
              className="group/tab relative flex shrink-0 items-center"
              data-episode-tab={episodeNo}
            >
              {editingEpisode === episodeNo && (
                <input
                  data-episode-edit-input
                  autoFocus
                  type="number"
                  min={1}
                  step={1}
                  value={editingEpisodeInput}
                  onChange={(event) => onEditingEpisodeInputChange(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onBlur={onCommitEpisodeEdit}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onCommitEpisodeEdit();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      onCancelEpisodeEdit();
                    }
                  }}
                  className="absolute inset-0 z-10 h-8 w-[4.75rem] rounded-md border border-primary/50 bg-background px-2 text-center text-xs font-medium text-foreground outline-none ring-2 ring-primary/20"
                />
              )}
              <button
                type="button"
                onClick={() => onSelectEpisode(episodeNo)}
                onDoubleClick={() => onStartEpisodeEdit(episodeNo)}
                title="双击编辑集数"
                className={cn(
                  "flex h-8 min-w-[4.75rem] items-center justify-center whitespace-nowrap rounded-md py-1.5 text-xs font-medium transition-colors",
                  activeEpisode === episodeNo
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  episodes.length > 1 ? "pl-3 pr-6" : "px-3",
                  editingEpisode === episodeNo && "pointer-events-none opacity-0",
                )}
              >
                第 {episodeNo} 集
                {(episodeScripts[episodeNo] || (episodeStoryboards[episodeNo]?.length ?? 0) > 0) && (
                  <span
                    className={cn(
                      "ml-1.5 inline-block h-1.5 w-1.5 rounded-full",
                      activeEpisode === episodeNo ? "bg-primary" : "bg-muted-foreground/50",
                    )}
                  />
                )}
              </button>
              {episodes.length > 1 && (
                <button
                  type="button"
                  data-episode-delete
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteEpisode(episodeNo);
                  }}
                  title="删除此集"
                  className="absolute right-1 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded opacity-0 transition-opacity hover:bg-destructive/20 hover:text-destructive group-hover/tab:opacity-100"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          ))}
        </div>

        <div
          data-episode-scroll-rail
          className={cn("relative h-1.5 rounded-full bg-border/50", !canScrollEpisodes && "opacity-30")}
          onPointerDown={onEpisodeScrollRailPointerDown}
          onPointerMove={onEpisodeScrollRailPointerMove}
          onPointerUp={onEpisodeScrollRailPointerUp}
          onPointerCancel={onEpisodeScrollRailPointerUp}
        >
          <div
            className={cn(
              "absolute inset-y-0 rounded-full transition-colors",
              isEpisodeTabDragging ? "bg-primary/70" : "bg-primary/40",
            )}
            style={{
              left: `${episodeScrollThumbLeft}%`,
              width: `${episodeScrollThumbWidth}%`,
            }}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => onScrollEpisodeTabs(1)}
        title="向右滚动集数"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      <button
        type="button"
        data-episode-add
        onClick={onAddEpisode}
        title="添加新一集"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        +
      </button>

      <div ref={episodeSettingsRef} className="relative shrink-0">
        <button
          type="button"
          data-episode-settings
          onClick={onToggleEpisodeSettings}
          title="集数设置"
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
            episodeSettingsOpen && "bg-accent text-accent-foreground",
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>

        {episodeSettingsOpen && (
          <EpisodeSettingsPopover
            mode={episodeSettingsMode}
            startInput={episodeAddStartInput}
            stepInput={episodeAddStepInput}
            previewEpisodes={episodeAddPreview}
            onModeChange={onEpisodeSettingsModeChange}
            onStartInputChange={onEpisodeAddStartInputChange}
            onStepInputChange={onEpisodeAddStepInputChange}
            onCommitSettings={onCommitEpisodeAddSettings}
            onApply={onApplyEpisodeSettings}
          />
        )}
      </div>

      <div className="flex h-8 min-w-[5rem] shrink-0 items-start justify-start text-xs">
        {saveState === "saving" && (
          <span className="inline-flex h-8 items-center gap-1 rounded-full bg-primary/10 px-3 text-primary">
            <LoaderCircle className="h-3 w-3 animate-spin" />
            保存中
          </span>
        )}
        {saveState === "saved" && content && (
          <span className="inline-flex h-8 items-center gap-1 rounded-full bg-indigo-500/10 px-3 text-indigo-400">
            <CheckCircle2 className="h-3 w-3" />
            已保存
          </span>
        )}
        {saveState === "error" && (
          <span className="inline-flex h-8 items-center gap-1 rounded-full bg-destructive/10 px-3 text-destructive">
            <AlertCircle className="h-3 w-3" />
            保存失败
          </span>
        )}
      </div>
    </div>
  );
}
