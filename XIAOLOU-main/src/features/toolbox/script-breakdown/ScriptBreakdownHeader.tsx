import { BreakdownProgressBanner } from "./BreakdownProgressBanner";
import { ScriptBreakdownToolbar } from "./ScriptBreakdownToolbar";

type ScriptBreakdownHeaderProps = {
  activeEpisode: number;
  storyboardCount: number;
  loadingShots: boolean;
  notice: string | null;
  isBreakingDown: boolean;
  noProject: boolean;
  breakdownElapsed: string;
  breakdownProgress: number;
  onAutoBreakdown: () => void | Promise<void>;
  onExportPrompts: () => void;
};

export function ScriptBreakdownHeader({
  activeEpisode,
  storyboardCount,
  loadingShots,
  notice,
  isBreakingDown,
  noProject,
  breakdownElapsed,
  breakdownProgress,
  onAutoBreakdown,
  onExportPrompts,
}: ScriptBreakdownHeaderProps) {
  return (
    <>
      <ScriptBreakdownToolbar
        activeEpisode={activeEpisode}
        storyboardCount={storyboardCount}
        loadingShots={loadingShots}
        notice={notice}
        isBreakingDown={isBreakingDown}
        noProject={noProject}
        onAutoBreakdown={onAutoBreakdown}
        onExportPrompts={onExportPrompts}
      />

      {isBreakingDown && (
        <BreakdownProgressBanner elapsed={breakdownElapsed} progress={breakdownProgress} />
      )}
    </>
  );
}
