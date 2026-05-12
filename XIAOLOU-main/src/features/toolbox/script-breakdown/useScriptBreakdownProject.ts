import { useEffect, useRef, useState } from "react";
import {
  getScript,
  listStoryboards,
  updateScript,
  type Storyboard,
} from "../../../lib/api";
import {
  projectScriptContentFromEpisodes,
  serializeEpisodeScripts,
  writeStoredEpisodeScripts,
} from "./episode-model";

export type ScriptSaveState = "idle" | "saving" | "saved" | "error";

type ProjectScriptSnapshot = {
  content?: string | null;
  episodeScripts?: unknown;
};

type HydrateEpisodeWorkspaceArgs = {
  projectId: string;
  script: ProjectScriptSnapshot | null;
  storyboards: Storyboard[];
};

type UseScriptBreakdownProjectArgs = {
  currentProjectId: string | null;
  episodeScripts: Record<number, string>;
  scriptsHydrated: boolean;
  skipNextScriptSaveRef: { current: boolean };
  resetEpisodeWorkspace: (projectId: string | null) => void;
  resetStoryboardActionState: () => void;
  hydrateEpisodeWorkspace: (args: HydrateEpisodeWorkspaceArgs) => void;
  setNotice: (notice: string | null) => void;
};

type SaveScriptSnapshotOptions = {
  contentOverride?: string;
};

export function useScriptBreakdownProject({
  currentProjectId,
  episodeScripts,
  scriptsHydrated,
  skipNextScriptSaveRef,
  resetEpisodeWorkspace,
  resetStoryboardActionState,
  hydrateEpisodeWorkspace,
  setNotice,
}: UseScriptBreakdownProjectArgs) {
  const projectScriptContentRef = useRef("");
  const [loadingShots, setLoadingShots] = useState(false);
  const [saveState, setSaveState] = useState<ScriptSaveState>("saved");

  const saveScriptSnapshot = async (
    snapshot: Record<number, string>,
    options: SaveScriptSnapshotOptions = {},
  ) => {
    if (!currentProjectId) return null;
    setSaveState("saving");
    writeStoredEpisodeScripts(currentProjectId, snapshot);
    try {
      const saved = await updateScript(
        currentProjectId,
        options.contentOverride ?? projectScriptContentFromEpisodes(snapshot, projectScriptContentRef.current),
        { episodeScripts: serializeEpisodeScripts(snapshot) },
      );
      projectScriptContentRef.current = saved.content ?? projectScriptContentRef.current;
      setSaveState("saved");
      setNotice(null);
      return saved;
    } catch (err) {
      setSaveState("error");
      throw err;
    }
  };

  const markSaveError = () => {
    setSaveState("error");
  };

  useEffect(() => {
    let cancelled = false;
    projectScriptContentRef.current = "";
    resetEpisodeWorkspace(currentProjectId);
    resetStoryboardActionState();
    setNotice(null);
    setSaveState("saved");

    if (!currentProjectId) {
      return () => {
        cancelled = true;
      };
    }

    setLoadingShots(true);
    void Promise.allSettled([getScript(currentProjectId), listStoryboards(currentProjectId)])
      .then((results) => {
        if (cancelled) return;
        const [scriptResult, storyboardsResult] = results;
        const script = scriptResult?.status === "fulfilled" ? scriptResult.value : null;
        projectScriptContentRef.current = script?.content ?? "";
        hydrateEpisodeWorkspace({
          projectId: currentProjectId,
          script,
          storyboards: storyboardsResult?.status === "fulfilled" ? storyboardsResult.value.items : [],
        });
      })
      .finally(() => {
        if (!cancelled) setLoadingShots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentProjectId]);

  useEffect(() => {
    if (!currentProjectId || !scriptsHydrated) return;
    if (skipNextScriptSaveRef.current) {
      skipNextScriptSaveRef.current = false;
      return;
    }

    setSaveState("saving");
    const timer = window.setTimeout(() => {
      const snapshot = { ...episodeScripts };
      writeStoredEpisodeScripts(currentProjectId, snapshot);
      void updateScript(currentProjectId, projectScriptContentFromEpisodes(snapshot, projectScriptContentRef.current), {
        episodeScripts: serializeEpisodeScripts(snapshot),
      })
        .then((script) => {
          projectScriptContentRef.current = script.content ?? projectScriptContentRef.current;
          setSaveState("saved");
          setNotice(null);
        })
        .catch((err) => {
          setSaveState("error");
          setNotice(err instanceof Error ? err.message : "脚本保存失败");
        });
    }, 700);

    return () => window.clearTimeout(timer);
  }, [currentProjectId, episodeScripts, scriptsHydrated]);

  return {
    loadingShots,
    saveState,
    saveScriptSnapshot,
    markSaveError,
  };
}
