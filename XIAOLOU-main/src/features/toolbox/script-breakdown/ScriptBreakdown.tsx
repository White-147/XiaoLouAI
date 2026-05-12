import { useRef, useState } from "react";
import { useCurrentProjectId } from "../../../lib/session";
import { NoProjectEmptyState } from "./NoProjectEmptyState";
import { ScriptBreakdownHeader } from "./ScriptBreakdownHeader";
import { ScriptBreakdownOverlays } from "./ScriptBreakdownOverlays";
import { ScriptBreakdownWorkspace } from "./ScriptBreakdownWorkspace";
import type { ScriptEditorPaneProps } from "./ScriptEditorPane";
import type { StoryboardShotListProps } from "./StoryboardShotList";
import { waitForTask } from "./task-polling";
import { useEpisodeTabScroll } from "./useEpisodeTabScroll";
import { useEpisodeTabsViewProps } from "./useEpisodeTabsViewProps";
import { useScriptAiActions } from "./useScriptAiActions";
import { useScriptBreakdownLightbox } from "./useScriptBreakdownLightbox";
import { useScriptBreakdownProject } from "./useScriptBreakdownProject";
import { useScriptEpisodes } from "./useScriptEpisodes";
import { useStoryboardActions } from "./useStoryboardActions";

// ─── component ──────────────────────────────────────────────────────────────

export default function ScriptBreakdown() {
  const [currentProjectId] = useCurrentProjectId();
  const episodeSettingsRef = useRef<HTMLDivElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const {
    activeEpisode,
    applyEpisodeSettingsToCurrentEpisodes,
    cancelEpisodeEdit,
    commitEpisodeAddSettings,
    commitEpisodeEdit,
    content,
    deleteEpisode,
    deleteEpisodeCandidate,
    draftPrompts,
    editingEpisode,
    editingEpisodeInput,
    episodeAddPreview,
    episodeAddStartInput,
    episodeAddStepInput,
    episodeScripts,
    episodeSettingsMode,
    episodeSettingsOpen,
    episodeStoryboards,
    episodes,
    handleAddEpisode,
    handleDeleteEpisode,
    hydrateEpisodeWorkspace,
    patchActiveShot,
    reorderConflictEpisodes,
    resetEpisodeWorkspace,
    scriptsHydrated,
    seedEpisodeStoryboards,
    selectEpisode,
    setContent,
    setDeleteEpisodeCandidate,
    setEditingEpisodeInput,
    setEpisodeAddStartInput,
    setEpisodeAddStepInput,
    setEpisodeDraftPrompts,
    setEpisodeScripts,
    setEpisodeSettingsMode,
    setEpisodeSettingsOpen,
    setEpisodeStoryboards,
    setReorderConflictEpisodes,
    skipNextScriptSaveRef,
    startEpisodeEdit,
    storyboards,
  } = useScriptEpisodes({
    currentProjectId,
    setNotice,
  });
  const {
    episodeTabsRef,
    canScrollEpisodes,
    episodeScrollThumbLeft,
    episodeScrollThumbWidth,
    isEpisodeTabDragging,
    scrollEpisodeTabs,
    syncEpisodeScrollMetrics,
    handleEpisodeScrollRailPointerDown,
    handleEpisodeScrollRailPointerMove,
    finishEpisodeScrollRailDrag,
  } = useEpisodeTabScroll(activeEpisode, episodes);

  // UI state
  const [pendingTask, setPendingTask] = useState<string | null>(null);

  const { lightbox, openLightbox, closeLightbox } = useScriptBreakdownLightbox();

  const {
    uploadInputRef,
    resetStoryboardActionState,
    getShotActionState,
    shotActions,
    handleFileSelected,
  } = useStoryboardActions({
    currentProjectId,
    activeEpisode,
    draftPrompts,
    pendingTask,
    patchActiveShot,
    setEpisodeStoryboards,
    setEpisodeDraftPrompts,
    setPendingTask,
    setNotice,
    waitForTask,
    onOpenLightbox: openLightbox,
  });

  const {
    loadingShots,
    saveState,
    saveScriptSnapshot,
    markSaveError,
  } = useScriptBreakdownProject({
    currentProjectId,
    episodeScripts,
    scriptsHydrated,
    skipNextScriptSaveRef,
    resetEpisodeWorkspace,
    resetStoryboardActionState,
    hydrateEpisodeWorkspace,
    setNotice,
  });

  const {
    pendingScriptAction,
    isBreakingDown,
    breakdownElapsed,
    breakdownProgress,
    handleRewrite,
    handleAutoBreakdown,
    exportPrompts,
  } = useScriptAiActions({
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
  });

  const noProject = !currentProjectId;
  const episodeTabs = useEpisodeTabsViewProps({
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
    onScrollEpisodeTabs: scrollEpisodeTabs,
    onSyncEpisodeScrollMetrics: syncEpisodeScrollMetrics,
    onSelectEpisode: selectEpisode,
    onStartEpisodeEdit: startEpisodeEdit,
    onEditingEpisodeInputChange: setEditingEpisodeInput,
    onCommitEpisodeEdit: commitEpisodeEdit,
    onCancelEpisodeEdit: cancelEpisodeEdit,
    onDeleteEpisode: handleDeleteEpisode,
    onEpisodeScrollRailPointerDown: handleEpisodeScrollRailPointerDown,
    onEpisodeScrollRailPointerMove: handleEpisodeScrollRailPointerMove,
    onEpisodeScrollRailPointerUp: finishEpisodeScrollRailDrag,
    onAddEpisode: handleAddEpisode,
    onEpisodeSettingsModeChange: setEpisodeSettingsMode,
    onEpisodeAddStartInputChange: setEpisodeAddStartInput,
    onEpisodeAddStepInputChange: setEpisodeAddStepInput,
    onCommitEpisodeAddSettings: commitEpisodeAddSettings,
    setEpisodeSettingsOpen,
    applyEpisodeSettingsToCurrentEpisodes,
    commitEpisodeAddSettings,
  });
  const editorPane = {
    activeEpisode,
    episodeTabs,
    content,
    pendingScriptAction,
    onContentChange: setContent,
    onRewrite: handleRewrite,
  } satisfies ScriptEditorPaneProps;
  const shotList = {
    currentProjectId,
    activeEpisode,
    content,
    storyboards,
    loadingShots,
    isBreakingDown,
    getShotActionState,
    onAutoBreakdown: handleAutoBreakdown,
    shotActions,
  } satisfies StoryboardShotListProps;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col bg-background">
      <ScriptBreakdownOverlays
        uploadInputRef={uploadInputRef}
        onFileSelected={handleFileSelected}
        deleteEpisodeCandidate={deleteEpisodeCandidate}
        onCancelDeleteEpisode={() => setDeleteEpisodeCandidate(null)}
        onConfirmDeleteEpisode={deleteEpisode}
        reorderConflictEpisodes={reorderConflictEpisodes}
        onCloseReorderConflict={() => setReorderConflictEpisodes([])}
        lightbox={lightbox}
        onCloseLightbox={closeLightbox}
      />

      <ScriptBreakdownHeader
        activeEpisode={activeEpisode}
        storyboardCount={storyboards.length}
        loadingShots={loadingShots}
        notice={notice}
        isBreakingDown={isBreakingDown}
        noProject={noProject}
        breakdownElapsed={breakdownElapsed}
        breakdownProgress={breakdownProgress}
        onAutoBreakdown={handleAutoBreakdown}
        onExportPrompts={exportPrompts}
      />

      {noProject ? (
        <NoProjectEmptyState />
      ) : (
        <ScriptBreakdownWorkspace editorPane={editorPane} shotList={shotList} />
      )}

    </div>
  );
}
