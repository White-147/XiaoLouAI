import { useRef, useState } from "react";
import {
  deleteStoryboard,
  listStoryboards,
  updateStoryboard,
  type Storyboard,
} from "../../../lib/api";
import {
  DEFAULT_EPISODE_ADD_SETTINGS,
  DEFAULT_EPISODES,
  createDraftPromptsByEpisode,
  groupStoryboardsByEpisode,
  hasEpisodeScript,
  nextFutureEpisodeNumber,
  parseEpisodeScripts,
  previewEpisodeNumbers,
  previewFutureEpisodeNumbers,
  readStoredEpisodeAddSettings,
  readStoredEpisodeScripts,
  sortedEpisodes,
  toEpisodeNumber,
  toPositiveInteger,
  writeStoredEpisodeAddSettings,
  writeStoredEpisodeScripts,
} from "./episode-model";
import type { EpisodeSettingsMode } from "./EpisodeSettingsPopover";

type ProjectScriptSnapshot = {
  content?: string | null;
  episodeScripts?: unknown;
};

type HydrateEpisodeWorkspaceArgs = {
  projectId: string;
  script: ProjectScriptSnapshot | null;
  storyboards: Storyboard[];
};

type UseScriptEpisodesArgs = {
  currentProjectId: string | null;
  setNotice: (notice: string | null) => void;
};

export function useScriptEpisodes({
  currentProjectId,
  setNotice,
}: UseScriptEpisodesArgs) {
  const skipNextScriptSaveRef = useRef(false);
  const [scriptsHydrated, setScriptsHydrated] = useState(false);
  const [episodeSettingsOpen, setEpisodeSettingsOpen] = useState(false);
  const [episodeAddStartInput, setEpisodeAddStartInput] = useState(String(DEFAULT_EPISODE_ADD_SETTINGS.start));
  const [episodeAddStepInput, setEpisodeAddStepInput] = useState(String(DEFAULT_EPISODE_ADD_SETTINGS.step));
  const [episodeSettingsMode, setEpisodeSettingsMode] = useState<EpisodeSettingsMode>("future");
  const [deleteEpisodeCandidate, setDeleteEpisodeCandidate] = useState<number | null>(null);
  const [reorderConflictEpisodes, setReorderConflictEpisodes] = useState<number[]>([]);
  const [editingEpisode, setEditingEpisode] = useState<number | null>(null);
  const [editingEpisodeInput, setEditingEpisodeInput] = useState("");
  const [episodes, setEpisodes] = useState<number[]>([...DEFAULT_EPISODES]);
  const [activeEpisode, setActiveEpisode] = useState(1);
  const [episodeScripts, setEpisodeScripts] = useState<Record<number, string>>({});
  const [episodeStoryboards, setEpisodeStoryboards] = useState<Record<number, Storyboard[]>>({});
  const [episodeDraftPrompts, setEpisodeDraftPrompts] = useState<Record<number, Record<string, string>>>({});

  const content = episodeScripts[activeEpisode] ?? "";
  const storyboards = episodeStoryboards[activeEpisode] ?? [];
  const draftPrompts = episodeDraftPrompts[activeEpisode] ?? {};

  const readEpisodeAddSettingsFromInputs = () => ({
    start: toPositiveInteger(episodeAddStartInput, DEFAULT_EPISODE_ADD_SETTINGS.start),
    step: toPositiveInteger(episodeAddStepInput, DEFAULT_EPISODE_ADD_SETTINGS.step),
  });

  const commitEpisodeAddSettings = () => {
    const nextSettings = readEpisodeAddSettingsFromInputs();
    setEpisodeAddStartInput(String(nextSettings.start));
    setEpisodeAddStepInput(String(nextSettings.step));
    if (currentProjectId) {
      writeStoredEpisodeAddSettings(currentProjectId, nextSettings);
    }
    return nextSettings;
  };

  const resetEpisodeWorkspace = (projectId: string | null) => {
    setScriptsHydrated(false);
    skipNextScriptSaveRef.current = false;
    setEpisodeScripts({});
    setEpisodeStoryboards({});
    setEpisodeDraftPrompts({});
    setEpisodes([...DEFAULT_EPISODES]);
    setActiveEpisode(1);
    setEditingEpisode(null);
    setEditingEpisodeInput("");
    setEpisodeSettingsOpen(false);
    setEpisodeSettingsMode("future");
    setDeleteEpisodeCandidate(null);
    setReorderConflictEpisodes([]);

    const settings = projectId
      ? readStoredEpisodeAddSettings(projectId)
      : DEFAULT_EPISODE_ADD_SETTINGS;
    setEpisodeAddStartInput(String(settings.start));
    setEpisodeAddStepInput(String(settings.step));
  };

  const hydrateEpisodeWorkspace = ({ projectId, script, storyboards: storyboardItems }: HydrateEpisodeWorkspaceArgs) => {
    const localScripts = readStoredEpisodeScripts(projectId);
    let nextScripts: Record<number, string> = { ...localScripts };
    let fallbackScriptContent = "";

    if (script) {
      fallbackScriptContent = script.content ?? "";
      nextScripts = {
        ...parseEpisodeScripts(script.episodeScripts),
        ...localScripts,
      };
    }

    const storyboardGroups = groupStoryboardsByEpisode(storyboardItems);
    const storyboardEpisodes = Object.keys(storyboardGroups).map(Number);
    const fallbackEpisode = storyboardEpisodes.length === 1 ? (storyboardEpisodes[0] ?? 1) : 1;
    if (fallbackScriptContent && !hasEpisodeScript(nextScripts, fallbackEpisode)) {
      nextScripts[fallbackEpisode] = fallbackScriptContent;
    }
    const nextEpisodes = sortedEpisodes([
      ...DEFAULT_EPISODES,
      ...Object.keys(nextScripts).map(Number),
      ...Object.keys(storyboardGroups).map(Number),
    ]);

    writeStoredEpisodeScripts(projectId, nextScripts);
    skipNextScriptSaveRef.current = true;
    setEpisodeScripts(nextScripts);
    setEpisodeStoryboards(storyboardGroups);
    setEpisodeDraftPrompts(createDraftPromptsByEpisode(storyboardGroups));
    setEpisodes(nextEpisodes);
    setActiveEpisode((current) => (nextEpisodes.includes(current) ? current : (nextEpisodes[0] ?? 1)));
    setScriptsHydrated(true);
  };

  const selectEpisode = (episodeNo: number) => {
    setActiveEpisode(episodeNo);
  };

  const startEpisodeEdit = (episodeNo: number) => {
    setActiveEpisode(episodeNo);
    setEditingEpisode(episodeNo);
    setEditingEpisodeInput(String(episodeNo));
  };

  const handleAddEpisode = () => {
    const addSettings = commitEpisodeAddSettings();
    const next = nextFutureEpisodeNumber(episodes, addSettings.start, addSettings.step);
    setEpisodes((prev) => sortedEpisodes([...prev, next]));
    setActiveEpisode(next);
    setEpisodeScripts((prev) => {
      const updated = hasEpisodeScript(prev, next) ? prev : { ...prev, [next]: "" };
      if (currentProjectId) writeStoredEpisodeScripts(currentProjectId, updated);
      return updated;
    });
    if (currentProjectId) {
      void listStoryboards(currentProjectId, next)
        .then((res) => {
          if (res.items.length > 0) seedEpisodeStoryboards(next, res.items);
        })
        .catch(() => {});
    }
  };

  const commitEpisodeEdit = () => {
    if (editingEpisode == null) return;
    const previousEpisode = editingEpisode;
    const nextEpisode = toEpisodeNumber(editingEpisodeInput);
    if (nextEpisode == null) {
      setNotice("请输入有效集数");
      return;
    }
    if (nextEpisode === previousEpisode) {
      setEditingEpisode(null);
      setEditingEpisodeInput("");
      return;
    }
    if (episodes.includes(nextEpisode)) {
      setNotice("该集数已存在");
      return;
    }

    const movedStoryboards = episodeStoryboards[previousEpisode] ?? [];
    setEpisodes((prev) => sortedEpisodes(prev.map((episodeNo) => (
      episodeNo === previousEpisode ? nextEpisode : episodeNo
    ))));
    setActiveEpisode(nextEpisode);
    setEditingEpisode(null);
    setEditingEpisodeInput("");
    setNotice(null);

    setEpisodeScripts((prev) => {
      const updated = { ...prev };
      updated[nextEpisode] = updated[previousEpisode] ?? "";
      delete updated[previousEpisode];
      if (currentProjectId) writeStoredEpisodeScripts(currentProjectId, updated);
      return updated;
    });
    setEpisodeStoryboards((prev) => {
      const updated = { ...prev };
      updated[nextEpisode] = (updated[previousEpisode] ?? []).map((item) => ({
        ...item,
        episodeNo: nextEpisode,
      }));
      delete updated[previousEpisode];
      return updated;
    });
    setEpisodeDraftPrompts((prev) => {
      const updated = { ...prev };
      updated[nextEpisode] = updated[previousEpisode] ?? {};
      delete updated[previousEpisode];
      return updated;
    });

    if (currentProjectId && movedStoryboards.length > 0) {
      void Promise.allSettled(
        movedStoryboards.map((item) => updateStoryboard(currentProjectId, item.id, { episodeNo: nextEpisode })),
      ).then((results) => {
        if (results.some((result) => result.status === "rejected")) {
          setNotice("部分分镜集数同步失败，请稍后重试");
        }
      });
    }
  };

  const cancelEpisodeEdit = () => {
    setEditingEpisode(null);
    setEditingEpisodeInput("");
  };

  const episodeHasContent = (episodeNo: number) => {
    const hasScript = Boolean((episodeScripts[episodeNo] ?? "").trim());
    const hasStoryboards = (episodeStoryboards[episodeNo]?.length ?? 0) > 0;
    const hasDraftPrompts = Object.values(episodeDraftPrompts[episodeNo] ?? {}).some((prompt) => prompt.trim());
    return hasScript || hasStoryboards || hasDraftPrompts;
  };

  const deleteEpisode = (episodeNo: number) => {
    const next = episodes.filter((ep) => ep !== episodeNo);
    setEpisodes(next);
    if (activeEpisode === episodeNo) {
      const idx = episodes.indexOf(episodeNo);
      setActiveEpisode(next[Math.max(0, idx - 1)] ?? next[0] ?? DEFAULT_EPISODE_ADD_SETTINGS.start);
    }
    setDeleteEpisodeCandidate(null);
    setEpisodeScripts((prev) => {
      const updated = { ...prev };
      delete updated[episodeNo];
      if (currentProjectId) writeStoredEpisodeScripts(currentProjectId, updated);
      return updated;
    });
    const deletedStoryboards = episodeStoryboards[episodeNo] ?? [];
    setEpisodeStoryboards((prev) => {
      const updated = { ...prev };
      delete updated[episodeNo];
      return updated;
    });
    setEpisodeDraftPrompts((prev) => {
      const updated = { ...prev };
      delete updated[episodeNo];
      return updated;
    });

    if (currentProjectId && deletedStoryboards.length > 0) {
      void Promise.allSettled(
        deletedStoryboards.map((item) => deleteStoryboard(currentProjectId, item.id)),
      ).then((results) => {
        if (results.some((result) => result.status === "rejected")) {
          setNotice("部分分镜删除失败，请稍后重试");
        }
      });
    }
  };

  const handleDeleteEpisode = (episodeNo: number) => {
    if (episodes.length <= 1) return;
    if (episodeHasContent(episodeNo)) {
      setDeleteEpisodeCandidate(episodeNo);
      return;
    }
    deleteEpisode(episodeNo);
  };

  const applyEpisodeSettingsToCurrentEpisodes = () => {
    const settings = commitEpisodeAddSettings();
    const orderedEpisodes = sortedEpisodes(episodes);
    const episodeMap = new Map<number, number>();
    orderedEpisodes.forEach((episodeNo, index) => {
      episodeMap.set(episodeNo, settings.start + index * settings.step);
    });
    const nextEpisodes = orderedEpisodes.map((episodeNo) => episodeMap.get(episodeNo) ?? episodeNo);
    const nextEpisodeSet = new Set(nextEpisodes);
    const conflicts = orderedEpisodes.filter((episodeNo) => (
      !nextEpisodeSet.has(episodeNo) && episodeHasContent(episodeNo)
    ));
    if (conflicts.length > 0) {
      setReorderConflictEpisodes(conflicts);
      return false;
    }
    const nextActiveEpisode = episodeMap.get(activeEpisode) ?? nextEpisodes[0] ?? settings.start;
    const movedStoryboards = orderedEpisodes.flatMap((episodeNo) =>
      (episodeStoryboards[episodeNo] ?? []).map((item) => ({
        id: item.id,
        episodeNo: episodeMap.get(episodeNo) ?? episodeNo,
      })),
    );

    setEpisodes(nextEpisodes);
    setActiveEpisode(nextActiveEpisode);
    setEditingEpisode(null);
    setEditingEpisodeInput("");
    setNotice(null);
    setEpisodeScripts((prev) => {
      const updated: Record<number, string> = {};
      orderedEpisodes.forEach((episodeNo) => {
        const mappedEpisodeNo = episodeMap.get(episodeNo) ?? episodeNo;
        updated[mappedEpisodeNo] = prev[episodeNo] ?? "";
      });
      if (currentProjectId) writeStoredEpisodeScripts(currentProjectId, updated);
      return updated;
    });
    setEpisodeStoryboards((prev) => {
      const updated: Record<number, Storyboard[]> = {};
      orderedEpisodes.forEach((episodeNo) => {
        const mappedEpisodeNo = episodeMap.get(episodeNo) ?? episodeNo;
        updated[mappedEpisodeNo] = (prev[episodeNo] ?? []).map((item) => ({
          ...item,
          episodeNo: mappedEpisodeNo,
        }));
      });
      return updated;
    });
    setEpisodeDraftPrompts((prev) => {
      const updated: Record<number, Record<string, string>> = {};
      orderedEpisodes.forEach((episodeNo) => {
        const mappedEpisodeNo = episodeMap.get(episodeNo) ?? episodeNo;
        updated[mappedEpisodeNo] = prev[episodeNo] ?? {};
      });
      return updated;
    });

    if (currentProjectId && movedStoryboards.length > 0) {
      void Promise.allSettled(
        movedStoryboards.map((item) => updateStoryboard(currentProjectId, item.id, { episodeNo: item.episodeNo })),
      ).then((results) => {
        if (results.some((result) => result.status === "rejected")) {
          setNotice("部分分镜集数同步失败，请稍后重试");
        }
      });
    }
    return true;
  };

  const seedEpisodeStoryboards = (episodeNo: number, items: Storyboard[]) => {
    setEpisodeStoryboards((prev) => ({ ...prev, [episodeNo]: items }));
    setEpisodeDraftPrompts((prev) => {
      const existing = prev[episodeNo] ?? {};
      const seeds = items.reduce<Record<string, string>>((acc, item) => {
        if (existing[item.id] === undefined) acc[item.id] = item.script;
        return acc;
      }, {});
      return { ...prev, [episodeNo]: { ...seeds, ...existing } };
    });
  };

  const patchActiveShot = (updated: Storyboard) => {
    setEpisodeStoryboards((prev) => ({
      ...prev,
      [activeEpisode]: (prev[activeEpisode] ?? []).map((shot) =>
        shot.id === updated.id ? updated : shot,
      ),
    }));
  };

  const setContent = (text: string) => {
    const episodeNo = activeEpisode;
    setEpisodeScripts((prev) => {
      const updated = { ...prev, [episodeNo]: text };
      if (currentProjectId) writeStoredEpisodeScripts(currentProjectId, updated);
      return updated;
    });
  };

  const episodeAddSettings = readEpisodeAddSettingsFromInputs();
  const episodeAddPreview = episodeSettingsMode === "future"
    ? previewFutureEpisodeNumbers(episodes, episodeAddSettings.start, episodeAddSettings.step)
    : previewEpisodeNumbers(episodeAddSettings.start, episodeAddSettings.step);

  return {
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
    episodeDraftPrompts,
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
    setActiveEpisode,
    setContent,
    setDeleteEpisodeCandidate,
    setEditingEpisode,
    setEditingEpisodeInput,
    setEpisodeAddStartInput,
    setEpisodeAddStepInput,
    setEpisodeDraftPrompts,
    setEpisodeScripts,
    setEpisodeSettingsMode,
    setEpisodeSettingsOpen,
    setEpisodeStoryboards,
    setReorderConflictEpisodes,
    setScriptsHydrated,
    skipNextScriptSaveRef,
    startEpisodeEdit,
    storyboards,
  };
}
