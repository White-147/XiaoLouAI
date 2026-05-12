import {
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import type { Storyboard } from "../../../lib/api";
import type { StoryboardShotActionState, StoryboardShotCardActions } from "./storyboard-shot-types";
import { StoryboardShotCard } from "./StoryboardShotCard";

export type StoryboardShotListProps = {
  currentProjectId: string | null;
  activeEpisode: number;
  content: string;
  storyboards: Storyboard[];
  loadingShots: boolean;
  isBreakingDown: boolean;
  getShotActionState: (item: Storyboard) => StoryboardShotActionState;
  onAutoBreakdown: () => void | Promise<void>;
  shotActions: StoryboardShotCardActions;
};

export function StoryboardShotList({
  currentProjectId,
  activeEpisode,
  content,
  storyboards,
  loadingShots,
  isBreakingDown,
  getShotActionState,
  onAutoBreakdown,
  shotActions,
}: StoryboardShotListProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {storyboards.length === 0 && !loadingShots ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/8">
            <ImageIcon className="h-7 w-7 text-primary/50" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              第 {activeEpisode} 集暂无分镜提示词
            </p>
            <p className="mt-1.5 max-w-[260px] text-xs leading-5 text-muted-foreground">
              在左侧编辑器中输入第 {activeEpisode} 集剧本，然后点击顶部「AI 自动拆解分镜」按钮生成逐镜头提示词。
            </p>
          </div>
          <button
            onClick={() => void onAutoBreakdown()}
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
          {storyboards.map((item, index) => (
            <StoryboardShotCard
              key={item.id}
              item={item}
              previousItem={storyboards[index - 1]}
              currentProjectId={currentProjectId}
              shotState={getShotActionState(item)}
              shotActions={shotActions}
            />
          ))}
        </div>
      )}
    </div>
  );
}
