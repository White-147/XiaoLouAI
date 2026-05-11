import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Image as ImageIcon,
  LoaderCircle,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  Users,
  Wand2,
  X,
  ZoomIn,
} from "lucide-react";
import { type ChangeEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import {
  ReferenceAssetPicker,
  type ReferenceAssetSelection,
} from "../../assets-media-projects/reference-assets/ReferenceAssetPicker";
import {
  GeneratedMediaPlaceholder,
  getGeneratedMediaUrl,
} from "../../assets-media-projects/media/GenerationPlaceholder";
import {
  autoGenerateStoryboards,
  deleteStoryboard,
  generateStoryboardImage,
  getScript,
  getStoryboard,
  getTask,
  listStoryboards,
  rewriteScript,
  updateScript,
  updateStoryboard,
  uploadFile,
  type Storyboard,
  type Task,
} from "../../../lib/api";
import { useCurrentProjectId } from "../../../lib/session";
import { cn } from "../../../lib/utils";
import {
  DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID,
  XIAOLOU_TEXT_TO_IMAGE_MODELS,
} from "../../canvas-agent-canvas/canvas/runtime/config/canvasImageModels";
import {
  BREAKDOWN_MAX_SHOTS,
  STORYBOARD_BREAKDOWN_SYSTEM_PROMPT,
} from "./storyboard-breakdown-prompt";

// ─── helpers ────────────────────────────────────────────────────────────────

function shotCoverUrl(item: Storyboard) {
  return getGeneratedMediaUrl(item.imageUrl);
}

async function waitForTask(taskId: string): Promise<Task | null> {
  // Expert-mode breakdown calls qwen-plus with a large token budget, which
  // can take 100–250 s for a full-length script. Backend timeout is 300 s,
  // so poll for up to 330 s (165 × 2000 ms) to stay safely above it.
  for (let i = 0; i < 165; i++) {
    const task = await getTask(taskId);
    if (task.status === "succeeded" || task.status === "failed") return task;
    await new Promise((r) => window.setTimeout(r, 2000));
  }
  return null;
}

const DEFAULT_EPISODES = [1, 2] as const;
const EPISODE_SCRIPT_STORAGE_PREFIX = "xiaolou:script-breakdown:episode-scripts:v1";
const EPISODE_ADD_SETTINGS_STORAGE_PREFIX = "xiaolou:script-breakdown:episode-add-settings:v1";
const DEFAULT_EPISODE_ADD_SETTINGS = { start: 1, step: 1 };

function episodeScriptStorageKey(projectId: string) {
  return `${EPISODE_SCRIPT_STORAGE_PREFIX}:${projectId}`;
}

function episodeAddSettingsStorageKey(projectId: string) {
  return `${EPISODE_ADD_SETTINGS_STORAGE_PREFIX}:${projectId}`;
}

function toEpisodeNumber(value: unknown) {
  const episodeNo = Number(value);
  return Number.isSafeInteger(episodeNo) && episodeNo > 0 ? episodeNo : null;
}

function toPositiveInteger(value: unknown, fallback: number) {
  return toEpisodeNumber(value) ?? fallback;
}

function hasEpisodeScript(scripts: Record<number, string>, episodeNo: number) {
  return Object.prototype.hasOwnProperty.call(scripts, episodeNo);
}

function sortedEpisodes(values: Iterable<number>) {
  const episodes = Array.from(new Set(Array.from(values).filter((value) => toEpisodeNumber(value) != null))).sort(
    (a, b) => a - b,
  );
  return episodes.length > 0 ? episodes : [...DEFAULT_EPISODES];
}

function parseEpisodeScripts(value: unknown): Record<number, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value).reduce<Record<number, string>>((acc, [key, script]) => {
    const episodeNo = toEpisodeNumber(key);
    if (episodeNo != null && typeof script === "string") {
      acc[episodeNo] = script;
    }
    return acc;
  }, {});
}

function serializeEpisodeScripts(scripts: Record<number, string>) {
  return Object.entries(scripts).reduce<Record<string, string>>((acc, [episodeNo, script]) => {
    const normalizedEpisodeNo = toEpisodeNumber(episodeNo);
    if (normalizedEpisodeNo != null && typeof script === "string") {
      acc[String(normalizedEpisodeNo)] = script;
    }
    return acc;
  }, {});
}

function readStoredEpisodeScripts(projectId: string): Record<number, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(episodeScriptStorageKey(projectId));
    return raw ? parseEpisodeScripts(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function writeStoredEpisodeScripts(projectId: string, scripts: Record<number, string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      episodeScriptStorageKey(projectId),
      JSON.stringify(serializeEpisodeScripts(scripts)),
    );
  } catch {
    // Browser storage is a best-effort draft cache; server persistence still runs.
  }
}

function readStoredEpisodeAddSettings(projectId: string) {
  if (typeof window === "undefined") return DEFAULT_EPISODE_ADD_SETTINGS;
  try {
    const raw = window.localStorage.getItem(episodeAddSettingsStorageKey(projectId));
    if (!raw) return DEFAULT_EPISODE_ADD_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<typeof DEFAULT_EPISODE_ADD_SETTINGS>;
    return {
      start: toPositiveInteger(parsed.start, DEFAULT_EPISODE_ADD_SETTINGS.start),
      step: toPositiveInteger(parsed.step, DEFAULT_EPISODE_ADD_SETTINGS.step),
    };
  } catch {
    return DEFAULT_EPISODE_ADD_SETTINGS;
  }
}

function writeStoredEpisodeAddSettings(projectId: string, settings: typeof DEFAULT_EPISODE_ADD_SETTINGS) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(episodeAddSettingsStorageKey(projectId), JSON.stringify(settings));
  } catch {
    // Browser storage is best-effort; the controls still use in-memory settings.
  }
}

function previewEpisodeNumbers(start: number, step: number, count = 3) {
  const preview: number[] = [];
  let next = start;
  while (preview.length < count && next <= Number.MAX_SAFE_INTEGER - step) {
    preview.push(next);
    next += step;
  }
  return preview;
}

function previewFutureEpisodeNumbers(episodes: number[], start: number, step: number, count = 3) {
  const used = new Set(episodes);
  const preview: number[] = [];
  let next = episodes.length > 0 ? Math.max(...episodes) + step : start;
  while (preview.length < count && next <= Number.MAX_SAFE_INTEGER - step) {
    while (used.has(next)) {
      next += step;
    }
    preview.push(next);
    used.add(next);
    next += step;
  }
  return preview;
}

function nextFutureEpisodeNumber(episodes: number[], start: number, step: number) {
  return previewFutureEpisodeNumbers(episodes, start, step, 1)[0] ?? start;
}

function groupStoryboardsByEpisode(items: Storyboard[]) {
  return items.reduce<Record<number, Storyboard[]>>((acc, item) => {
    const episodeNo = toEpisodeNumber(item.episodeNo) ?? 1;
    (acc[episodeNo] ??= []).push(item);
    return acc;
  }, {});
}

function createDraftPromptsByEpisode(groups: Record<number, Storyboard[]>) {
  return Object.entries(groups).reduce<Record<number, Record<string, string>>>(
    (acc, [episodeNo, items]) => {
      const normalizedEpisodeNo = toEpisodeNumber(episodeNo);
      if (normalizedEpisodeNo == null) return acc;
      acc[normalizedEpisodeNo] = items.reduce<Record<string, string>>((prompts, item) => {
        prompts[item.id] = item.script;
        return prompts;
      }, {});
      return acc;
    },
    {},
  );
}

function projectScriptContentFromEpisodes(scripts: Record<number, string>, fallback: string) {
  if (hasEpisodeScript(scripts, 1)) {
    return scripts[1] ?? "";
  }

  const firstEpisodeNo = sortedEpisodes(Object.keys(scripts).map(Number))[0];
  return firstEpisodeNo != null && hasEpisodeScript(scripts, firstEpisodeNo)
    ? (scripts[firstEpisodeNo] ?? "")
    : fallback;
}

// ─── component ──────────────────────────────────────────────────────────────

export default function ScriptBreakdown() {
  const [currentProjectId] = useCurrentProjectId();
  const episodeTabsRef = useRef<HTMLDivElement | null>(null);
  const episodeSettingsRef = useRef<HTMLDivElement | null>(null);
  const episodeTabDragRef = useRef({
    pointerId: -1,
    startX: 0,
    startScrollLeft: 0,
    railWidth: 1,
  });
  const [isEpisodeTabDragging, setIsEpisodeTabDragging] = useState(false);
  const [episodeScrollMetrics, setEpisodeScrollMetrics] = useState({
    scrollLeft: 0,
    scrollWidth: 0,
    clientWidth: 0,
  });
  const [episodeSettingsOpen, setEpisodeSettingsOpen] = useState(false);
  const [episodeAddStartInput, setEpisodeAddStartInput] = useState(String(DEFAULT_EPISODE_ADD_SETTINGS.start));
  const [episodeAddStepInput, setEpisodeAddStepInput] = useState(String(DEFAULT_EPISODE_ADD_SETTINGS.step));
  const [episodeSettingsMode, setEpisodeSettingsMode] = useState<"future" | "current">("future");
  const [deleteEpisodeCandidate, setDeleteEpisodeCandidate] = useState<number | null>(null);
  const [reorderConflictEpisodes, setReorderConflictEpisodes] = useState<number[]>([]);
  const [editingEpisode, setEditingEpisode] = useState<number | null>(null);
  const [editingEpisodeInput, setEditingEpisodeInput] = useState("");

  // ── Episode tabs ──
  const [episodes, setEpisodes] = useState<number[]>([...DEFAULT_EPISODES]);
  const [activeEpisode, setActiveEpisode] = useState(1);

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

  const scrollEpisodeTabs = (direction: -1 | 1) => {
    const container = episodeTabsRef.current;
    if (!container) return;
    container.scrollBy({
      left: direction * Math.max(180, container.clientWidth * 0.7),
      behavior: "smooth",
    });
  };

  const syncEpisodeScrollMetrics = () => {
    const container = episodeTabsRef.current;
    if (!container) return;
    const nextMetrics = {
      scrollLeft: container.scrollLeft,
      scrollWidth: container.scrollWidth,
      clientWidth: container.clientWidth,
    };
    setEpisodeScrollMetrics((current) => (
      current.scrollLeft === nextMetrics.scrollLeft &&
      current.scrollWidth === nextMetrics.scrollWidth &&
      current.clientWidth === nextMetrics.clientWidth
        ? current
        : nextMetrics
    ));
  };

  const selectEpisode = (episodeNo: number) => {
    setActiveEpisode(episodeNo);
  };

  const startEpisodeEdit = (episodeNo: number) => {
    setActiveEpisode(episodeNo);
    setEditingEpisode(episodeNo);
    setEditingEpisodeInput(String(episodeNo));
  };

  const updateEpisodeScrollFromRailPointer = (clientX: number) => {
    const container = episodeTabsRef.current;
    if (!container || container.scrollWidth <= container.clientWidth) return;
    const drag = episodeTabDragRef.current;
    const scrollRange = container.scrollWidth - container.clientWidth;
    const thumbWidth = Math.max(12, (container.clientWidth / container.scrollWidth) * drag.railWidth);
    const trackRange = Math.max(drag.railWidth - thumbWidth, 1);
    const scrollDelta = (clientX - drag.startX) * (scrollRange / trackRange);
    container.scrollLeft = Math.min(Math.max(drag.startScrollLeft + scrollDelta, 0), scrollRange);
    syncEpisodeScrollMetrics();
  };

  const handleEpisodeScrollRailPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const container = episodeTabsRef.current;
    if (!container || container.scrollWidth <= container.clientWidth) return;
    const rail = event.currentTarget;
    const rect = rail.getBoundingClientRect();
    episodeTabDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: container.scrollLeft,
      railWidth: Math.max(rect.width, 1),
    };
    container.style.scrollBehavior = "auto";
    rail.setPointerCapture(event.pointerId);
    setIsEpisodeTabDragging(true);
    event.preventDefault();
  };

  const handleEpisodeScrollRailPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = episodeTabDragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    updateEpisodeScrollFromRailPointer(event.clientX);
    event.preventDefault();
  };

  const finishEpisodeScrollRailDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = episodeTabDragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    const rail = event.currentTarget;
    if (rail.hasPointerCapture(event.pointerId)) {
      rail.releasePointerCapture(event.pointerId);
    }
    episodeTabDragRef.current = {
      pointerId: -1,
      startX: 0,
      startScrollLeft: 0,
      railWidth: 1,
    };
    const container = episodeTabsRef.current;
    if (container) {
      container.style.scrollBehavior = "";
    }
    setIsEpisodeTabDragging(false);
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
    // Load any pre-existing storyboards for the new episode
    if (currentProjectId) {
      void listStoryboards(currentProjectId, next)
        .then((res) => { if (res.items.length > 0) seedEpisodeStoryboards(next, res.items); })
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

  const handleDeleteEpisode = (ep: number) => {
    if (episodes.length <= 1) return;
    if (episodeHasContent(ep)) {
      setDeleteEpisodeCandidate(ep);
      return;
    }
    deleteEpisode(ep);
  };

  // ── Per-episode independent state ──
  // Each episode keeps its own script text, storyboard list and draft prompts.
  const [episodeScripts, setEpisodeScripts] = useState<Record<number, string>>({});
  const [episodeStoryboards, setEpisodeStoryboards] = useState<Record<number, Storyboard[]>>({});
  const [episodeDraftPrompts, setEpisodeDraftPrompts] = useState<
    Record<number, Record<string, string>>
  >({});

  // Derived: data for the currently active episode
  const content = episodeScripts[activeEpisode] ?? "";
  const storyboards = episodeStoryboards[activeEpisode] ?? [];
  const draftPrompts = episodeDraftPrompts[activeEpisode] ?? {};

  const setContent = (text: string) => {
    const episodeNo = activeEpisode;
    setEpisodeScripts((prev) => {
      const updated = { ...prev, [episodeNo]: text };
      if (currentProjectId) writeStoredEpisodeScripts(currentProjectId, updated);
      return updated;
    });
  };

  /** Seed a fresh storyboard list for `ep` – preserves existing prompt edits. */
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

  const seedEpisodeStoryboards = (ep: number, items: Storyboard[]) => {
    setEpisodeStoryboards((prev) => ({ ...prev, [ep]: items }));
    setEpisodeDraftPrompts((prev) => {
      const existing = prev[ep] ?? {};
      const seeds = items.reduce<Record<string, string>>((acc, item) => {
        if (existing[item.id] === undefined) acc[item.id] = item.script;
        return acc;
      }, {});
      return { ...prev, [ep]: { ...seeds, ...existing } };
    });
  };

  /** Replace a single storyboard entry in the active episode's list. */
  const patchActiveShot = (updated: Storyboard) => {
    setEpisodeStoryboards((prev) => ({
      ...prev,
      [activeEpisode]: (prev[activeEpisode] ?? []).map((s) =>
        s.id === updated.id ? updated : s,
      ),
    }));
  };

  // ── UI state ──
  const [refImages, setRefImages] = useState<Record<string, ReferenceAssetSelection[]>>({});
  const [showRefPicker, setShowRefPicker] = useState<string | null>(null);
  const [pendingTask, setPendingTask] = useState<string | null>(null);
  const [loadingShots, setLoadingShots] = useState(false);
  const [pendingScriptAction, setPendingScriptAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("saved");
  const [scriptsHydrated, setScriptsHydrated] = useState(false);
  const projectScriptContentRef = useRef("");
  const skipNextScriptSaveRef = useRef(false);

  // ── Per-shot model selection ──
  const [shotModels, setShotModels] = useState<Record<string, string>>({});
  const [showModelPicker, setShowModelPicker] = useState<string | null>(null);

  // ── Breakdown elapsed timer ──
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // ── Lightbox ──
  const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(null);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  // ── Local file upload ──
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploadingForShot, setUploadingForShot] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // ── Initial load: restore episode scripts and storyboards ──
  useEffect(() => {
    let cancelled = false;
    setScriptsHydrated(false);
    projectScriptContentRef.current = "";
    setEpisodeScripts({});
    setEpisodeStoryboards({});
    setEpisodeDraftPrompts({});
    setRefImages({});
    setShotModels({});
    setShowRefPicker(null);
    setShowModelPicker(null);
    setNotice(null);
    setSaveState("saved");
    setEpisodes([...DEFAULT_EPISODES]);
    setActiveEpisode(1);
    setEditingEpisode(null);
    setEditingEpisodeInput("");
    setEpisodeSettingsOpen(false);
    setEpisodeSettingsMode("future");
    setReorderConflictEpisodes([]);

    if (!currentProjectId) {
      setEpisodeAddStartInput(String(DEFAULT_EPISODE_ADD_SETTINGS.start));
      setEpisodeAddStepInput(String(DEFAULT_EPISODE_ADD_SETTINGS.step));
      return () => {
        cancelled = true;
      };
    }

    const storedAddSettings = readStoredEpisodeAddSettings(currentProjectId);
    setEpisodeAddStartInput(String(storedAddSettings.start));
    setEpisodeAddStepInput(String(storedAddSettings.step));

    setLoadingShots(true);
    void Promise.allSettled(
      [
        getScript(currentProjectId),
        listStoryboards(currentProjectId),
      ],
    )
      .then((results) => {
        if (cancelled) return;
        const [scriptResult, storyboardsResult] = results;
        const localScripts = readStoredEpisodeScripts(currentProjectId);
        let nextScripts: Record<number, string> = { ...localScripts };
        let fallbackScriptContent = "";

        if (scriptResult?.status === "fulfilled") {
          fallbackScriptContent = scriptResult.value.content ?? "";
          projectScriptContentRef.current = fallbackScriptContent;
          nextScripts = {
            ...parseEpisodeScripts(scriptResult.value.episodeScripts),
            ...localScripts,
          };
        }

        const storyboardGroups =
          storyboardsResult?.status === "fulfilled"
            ? groupStoryboardsByEpisode(storyboardsResult.value.items)
            : {};
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

        writeStoredEpisodeScripts(currentProjectId, nextScripts);
        skipNextScriptSaveRef.current = true;
        setEpisodeScripts(nextScripts);
        setEpisodeStoryboards(storyboardGroups);
        setEpisodeDraftPrompts(createDraftPromptsByEpisode(storyboardGroups));
        setEpisodes(nextEpisodes);
        setActiveEpisode((current) => (nextEpisodes.includes(current) ? current : (nextEpisodes[0] ?? 1)));
        setScriptsHydrated(true);
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

  useEffect(() => {
    const container = episodeTabsRef.current;
    const activeTab = container?.querySelector<HTMLElement>(`[data-episode-tab="${activeEpisode}"]`);
    activeTab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    const frame = window.requestAnimationFrame(syncEpisodeScrollMetrics);
    return () => window.cancelAnimationFrame(frame);
  }, [activeEpisode, episodes]);

  useEffect(() => {
    const container = episodeTabsRef.current;
    if (!container) return;
    syncEpisodeScrollMetrics();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(syncEpisodeScrollMetrics);
    observer.observe(container);
    return () => observer.disconnect();
  }, [episodes.length]);

  useEffect(() => {
    if (!episodeSettingsOpen) return;
    const close = (event: MouseEvent) => {
      if (!episodeSettingsRef.current?.contains(event.target as Node)) {
        setEpisodeSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [episodeSettingsOpen]);

  // Close model picker on outside click
  useEffect(() => {
    const close = () => setShowModelPicker(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleRewrite = async (instruction: string, actionKey: string) => {
    if (!currentProjectId) return;
    if (!content.trim()) {
      window.alert("请先输入剧本内容。");
      return;
    }
    setPendingScriptAction(actionKey);
    setSaveState("saving");
    const ep = activeEpisode;
    const scriptSnapshot = { ...episodeScripts, [ep]: content };
    try {
      writeStoredEpisodeScripts(currentProjectId, scriptSnapshot);
      // The rewrite job reads the project-level script, so point it at the active
      // episode temporarily, then restore the canonical episode map after it returns.
      await updateScript(currentProjectId, content, {
        episodeScripts: serializeEpisodeScripts(scriptSnapshot),
      });
      setSaveState("saved");
      await rewriteScript(currentProjectId, instruction);
      // Wait for AI rewrite to complete then read back
      await new Promise((r) => window.setTimeout(r, 2200));
      const updated = await getScript(currentProjectId);
      if (updated.content) {
        const nextScripts = { ...scriptSnapshot, [ep]: updated.content };
        writeStoredEpisodeScripts(currentProjectId, nextScripts);
        setEpisodeScripts(nextScripts);
        const saved = await updateScript(
          currentProjectId,
          projectScriptContentFromEpisodes(nextScripts, projectScriptContentRef.current),
          { episodeScripts: serializeEpisodeScripts(nextScripts) },
        );
        projectScriptContentRef.current = saved.content ?? projectScriptContentRef.current;
      }
    } catch {
      setSaveState("error");
      setNotice("AI 改写失败，请稍后重试");
    } finally {
      setPendingScriptAction(null);
    }
  };

  const handleAutoBreakdown = async () => {
    if (!currentProjectId) {
      window.alert("请先在首页选择一个项目，再使用剧本拆解工具。");
      return;
    }
    if (!content.trim()) {
      window.alert("请先在左侧输入故事剧本。");
      return;
    }
    setPendingTask("auto-breakdown");
    setNotice(null);
    const ep = activeEpisode;
    try {
      const scriptSnapshot = { ...episodeScripts, [ep]: content };
      writeStoredEpisodeScripts(currentProjectId, scriptSnapshot);
      setSaveState("saving");
      const saved = await updateScript(
        currentProjectId,
        projectScriptContentFromEpisodes(scriptSnapshot, projectScriptContentRef.current),
        { episodeScripts: serializeEpisodeScripts(scriptSnapshot) },
      );
      projectScriptContentRef.current = saved.content ?? projectScriptContentRef.current;
      setSaveState("saved");
      const accepted = await autoGenerateStoryboards(currentProjectId, content, {
        systemPrompt: STORYBOARD_BREAKDOWN_SYSTEM_PROMPT,
        maxShots: BREAKDOWN_MAX_SHOTS,
        episodeNo: ep,
      });
      const finished = await waitForTask(accepted.taskId);
      if (finished?.status === "failed") {
        window.alert(finished.outputSummary || "分镜拆解失败，请稍后重试。");
        return;
      }
      // Load the freshly-created storyboards for this episode only
      const res = await listStoryboards(currentProjectId, ep);
      seedEpisodeStoryboards(ep, res.items);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "分镜拆解失败";
      setNotice(msg);
      window.alert("分镜拆解失败，请稍后重试。");
    } finally {
      setPendingTask(null);
    }
  };

  const getShotModel = (shotId: string) =>
    shotModels[shotId] ?? DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID;

  const handleGenerateImage = async (item: Storyboard) => {
    if (!currentProjectId) return;
    setPendingTask(`img-${item.id}`);
    setNotice(null);
    try {
      const prompt = draftPrompts[item.id] ?? item.script;
      const urls = (refImages[item.id] ?? []).map((a) => a.url);
      const model = getShotModel(item.id);
      const accepted = await generateStoryboardImage(item.id, prompt, urls, model);
      const finished = await waitForTask(accepted.taskId);
      if (finished?.status === "succeeded") {
        // Fetch only this storyboard to get the updated imageUrl
        const updated = await getStoryboard(currentProjectId, item.id);
        patchActiveShot(updated);
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "生成参考图失败");
    } finally {
      setPendingTask((p) => (p === `img-${item.id}` ? null : p));
    }
  };

  const handleBlurSave = async (item: Storyboard) => {
    if (!currentProjectId) return;
    const nextScript = draftPrompts[item.id];
    if (!nextScript || nextScript === item.script) return;
    try {
      await updateStoryboard(currentProjectId, item.id, { script: nextScript });
      // Update local copy so comparisons stay accurate
      setEpisodeStoryboards((prev) => ({
        ...prev,
        [activeEpisode]: (prev[activeEpisode] ?? []).map((s) =>
          s.id === item.id ? { ...s, script: nextScript } : s,
        ),
      }));
    } catch {
      /* non-critical, keep draft */
    }
  };

  const handleDeleteShot = async (item: Storyboard) => {
    if (!currentProjectId) return;
    setPendingTask(`del-${item.id}`);
    try {
      await deleteStoryboard(currentProjectId, item.id);
      // Remove from this episode's local list only
      setEpisodeStoryboards((prev) => ({
        ...prev,
        [activeEpisode]: (prev[activeEpisode] ?? []).filter((s) => s.id !== item.id),
      }));
    } finally {
      setPendingTask(null);
    }
  };

  const toggleRefImage = (
    shotId: string,
    asset: ReferenceAssetSelection,
    selected: boolean,
  ) => {
    setRefImages((prev) => {
      const current = prev[shotId] ?? [];
      return {
        ...prev,
        [shotId]: selected
          ? [...current.filter((a) => a.id !== asset.id), asset]
          : current.filter((a) => a.id !== asset.id),
      };
    });
  };

  const handleLocalUploadClick = (shotId: string) => {
    setUploadingForShot(shotId);
    uploadInputRef.current?.click();
  };

  const handleFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !uploadingForShot) return;
    const targetShot = uploadingForShot;
    setUploading(true);
    try {
      const uploaded = await uploadFile(file, "image");
      const asset: ReferenceAssetSelection = {
        id: uploaded.id,
        name: uploaded.originalName,
        url: uploaded.url,
        previewUrl: uploaded.url,
        assetType: "upload",
        description: "",
        mediaKind: "image",
      };
      toggleRefImage(targetShot, asset, true);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "上传失败，请重试");
    } finally {
      setUploading(false);
      setUploadingForShot(null);
    }
  };

  const exportPrompts = () => {
    if (!storyboards.length) return;
    const lines = storyboards.map(
      (s) => `S${String(s.shotNo).padStart(2, "0")} | ${draftPrompts[s.id] ?? s.script}`,
    );
    const blob = new Blob([lines.join("\n\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ep${activeEpisode}-storyboard-prompts.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const noProject = !currentProjectId;
  const isBreakingDown = pendingTask === "auto-breakdown";

  // ── Breakdown elapsed timer effect (must be after isBreakingDown) ──
  useEffect(() => {
    if (!isBreakingDown) {
      setElapsedSeconds(0);
      return;
    }
    setElapsedSeconds(0);
    const id = window.setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [isBreakingDown]);

  const breakdownElapsed = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
  const breakdownProgress = Math.min(Math.round((elapsedSeconds / 300) * 100), 99);
  const canScrollEpisodes = episodeScrollMetrics.scrollWidth > episodeScrollMetrics.clientWidth + 1;
  const episodeScrollThumbWidth = canScrollEpisodes && episodeScrollMetrics.scrollWidth > 0
    ? Math.max(12, (episodeScrollMetrics.clientWidth / episodeScrollMetrics.scrollWidth) * 100)
    : 100;
  const episodeScrollThumbLeft = canScrollEpisodes
    ? (episodeScrollMetrics.scrollLeft /
        Math.max(episodeScrollMetrics.scrollWidth - episodeScrollMetrics.clientWidth, 1)) *
      (100 - episodeScrollThumbWidth)
    : 0;
  const episodeAddSettings = readEpisodeAddSettingsFromInputs();
  const episodeAddPreview = episodeSettingsMode === "future"
    ? previewFutureEpisodeNumbers(episodes, episodeAddSettings.start, episodeAddSettings.step)
    : previewEpisodeNumbers(episodeAddSettings.start, episodeAddSettings.step);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Hidden file input */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleFileSelected(e)}
      />

      {deleteEpisodeCandidate != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-4 shadow-2xl">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
              <AlertCircle className="h-4 w-4 text-destructive" />
              删除第 {deleteEpisodeCandidate} 集？
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              当前集数含有已编辑脚本、分镜或提示词内容，删除后这些内容会一并移除。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteEpisodeCandidate(null)}
                className="h-8 rounded-md border border-border px-3 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                取消
              </button>
              <button
                type="button"
                data-episode-delete-confirm
                onClick={() => deleteEpisode(deleteEpisodeCandidate)}
                className="h-8 rounded-md bg-destructive px-3 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toolbar — 与 /create/video-replace 统一视觉风格 ── */}
      {reorderConflictEpisodes.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-4 shadow-2xl">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
              <AlertCircle className="h-4 w-4 text-amber-400" />
              重排存在内容冲突
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              重排后的集数不包含以下已有集数，且这些集数含有已编辑内容。请先处理这些集数的脚本、分镜或提示词后再重排。
            </p>
            <div className="mt-3 flex flex-wrap gap-1">
              {reorderConflictEpisodes.map((episodeNo) => (
                <span
                  key={episodeNo}
                  className="rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-300"
                >
                  第 {episodeNo} 集
                </span>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                data-episode-reorder-conflict-close
                onClick={() => setReorderConflictEpisodes([])}
                className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex shrink-0 items-center justify-between border-b border-border bg-card/30 px-6 py-4">
        <div className="flex items-start gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
              <span className="text-primary">合成工具箱：</span>剧本拆解提示词
            </h1>
            <p className="mt-1.5 text-xs text-muted-foreground">
              粘贴剧本 → 点击"AI 自动拆解分镜"，系统将自动输出逐镜头中文提示词，可随时编辑、导出或重生。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {loadingShots && <LoaderCircle className="h-4 w-4 animate-spin text-primary" />}
            {storyboards.length > 0 && (
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary">
                第 {activeEpisode} 集 · 共 {storyboards.length} 个分镜
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
            onClick={() => void handleAutoBreakdown()}
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
            onClick={exportPrompts}
            disabled={storyboards.length === 0}
            className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            导出提示词
          </button>
        </div>
      </div>

      {/* ── Breakdown progress banner ── */}
      {isBreakingDown && (
        <div className="relative shrink-0 overflow-hidden border-b border-amber-600/40 bg-amber-500/15 px-6 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          {/* animated progress bar */}
          <div
            className="absolute bottom-0 left-0 h-0.5 bg-amber-600 transition-all duration-1000 dark:bg-amber-400/60"
            style={{ width: `${breakdownProgress}%` }}
          />
          <div className="flex items-center gap-3">
            <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-amber-700 dark:text-amber-400" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                AI 正在拆解分镜，请勿关闭或刷新页面
              </p>
              <p className="mt-0.5 text-[11px] text-amber-900/75 dark:text-amber-300/70">
                电影级文字分镜需要大模型深度推理，通常需要 <span className="font-medium text-amber-800 dark:text-amber-300">2–5 分钟</span>，最长等待约 <span className="font-medium text-amber-800 dark:text-amber-300">5 分 30 秒</span>。关闭页面将导致本次拆解结果丢失。
              </p>
            </div>
            <div className="shrink-0 rounded-lg border border-amber-600/40 bg-amber-500/20 px-3 py-1.5 text-center dark:border-amber-500/30 dark:bg-amber-500/10">
              <p className="font-mono text-base font-bold tabular-nums text-amber-800 dark:text-amber-300">{breakdownElapsed}</p>
              <p className="text-[10px] text-amber-700/80 dark:text-amber-400/60">已等待</p>
            </div>
          </div>
        </div>
      )}

      {noProject ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/8">
              <Wand2 className="h-7 w-7 text-primary/50" />
            </div>
            <p className="text-sm font-medium text-foreground">请先选择一个项目</p>
            <p className="mt-1 text-xs text-muted-foreground">
              返回首页选择或创建项目后，再使用剧本拆解工具。
            </p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* ── Left: Script editor ── */}
          <div className="flex w-[44%] min-w-0 flex-col border-r border-border">
            {/* Episode tabs */}
            <div className="flex h-14 shrink-0 items-start gap-1.5 border-b border-border bg-card/30 px-3 py-1.5">
              <button
                type="button"
                onClick={() => scrollEpisodeTabs(-1)}
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
                  onScroll={syncEpisodeScrollMetrics}
                >
                {episodes.map((ep) => (
                  <div key={ep} className="group/tab relative flex shrink-0 items-center" data-episode-tab={ep}>
                    {editingEpisode === ep && (
                      <input
                        data-episode-edit-input
                        autoFocus
                        type="number"
                        min={1}
                        step={1}
                        value={editingEpisodeInput}
                        onChange={(event) => setEditingEpisodeInput(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        onBlur={commitEpisodeEdit}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitEpisodeEdit();
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            cancelEpisodeEdit();
                          }
                        }}
                        className="absolute inset-0 z-10 h-8 w-[4.75rem] rounded-md border border-primary/50 bg-background px-2 text-center text-xs font-medium text-foreground outline-none ring-2 ring-primary/20"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => selectEpisode(ep)}
                      onDoubleClick={() => startEpisodeEdit(ep)}
                      title="双击编辑集数"
                      className={cn(
                        "flex h-8 min-w-[4.75rem] items-center justify-center whitespace-nowrap rounded-md py-1.5 text-xs font-medium transition-colors",
                        activeEpisode === ep
                          ? "bg-secondary text-secondary-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                        episodes.length > 1 ? "pl-3 pr-6" : "px-3",
                        editingEpisode === ep && "pointer-events-none opacity-0",
                      )}
                    >
                      第 {ep} 集
                      {/* dot indicator when episode has content */}
                      {(episodeScripts[ep] || (episodeStoryboards[ep]?.length ?? 0) > 0) && (
                        <span className={cn(
                          "ml-1.5 inline-block h-1.5 w-1.5 rounded-full",
                          activeEpisode === ep ? "bg-primary" : "bg-muted-foreground/50",
                        )} />
                      )}
                    </button>
                    {episodes.length > 1 && (
                      <button
                        type="button"
                        data-episode-delete
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteEpisode(ep);
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
                  className={cn(
                    "relative h-1.5 rounded-full bg-border/50",
                    !canScrollEpisodes && "opacity-30",
                  )}
                  onPointerDown={handleEpisodeScrollRailPointerDown}
                  onPointerMove={handleEpisodeScrollRailPointerMove}
                  onPointerUp={finishEpisodeScrollRailDrag}
                  onPointerCancel={finishEpisodeScrollRailDrag}
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
                onClick={() => scrollEpisodeTabs(1)}
                title="向右滚动集数"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </button>

              <button
                type="button"
                data-episode-add
                onClick={handleAddEpisode}
                title="添加新一集"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                +
              </button>

              <div ref={episodeSettingsRef} className="relative shrink-0">
                <button
                  type="button"
                  data-episode-settings
                  onClick={() => setEpisodeSettingsOpen((open) => !open)}
                  title="集数设置"
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                    episodeSettingsOpen && "bg-accent text-accent-foreground",
                  )}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </button>

                {episodeSettingsOpen && (
                  <div className="absolute right-0 top-9 z-40 w-72 rounded-xl border border-border bg-card p-3 text-xs shadow-2xl">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-foreground">集数设置</span>
                      <div className="flex rounded-md border border-border bg-background/60 p-0.5 text-[11px]">
                        <button
                          type="button"
                          data-episode-settings-mode="future"
                          onClick={() => setEpisodeSettingsMode("future")}
                          className={cn(
                            "h-6 rounded px-2 text-muted-foreground transition-colors",
                            episodeSettingsMode === "future" && "bg-primary/15 text-primary",
                          )}
                        >
                          后续新增
                        </button>
                        <button
                          type="button"
                          data-episode-settings-mode="current"
                          onClick={() => setEpisodeSettingsMode("current")}
                          className={cn(
                            "h-6 rounded px-2 text-muted-foreground transition-colors",
                            episodeSettingsMode === "current" && "bg-primary/15 text-primary",
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
                          value={episodeAddStartInput}
                          onChange={(event) => setEpisodeAddStartInput(event.target.value)}
                          onBlur={commitEpisodeAddSettings}
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
                          value={episodeAddStepInput}
                          onChange={(event) => setEpisodeAddStepInput(event.target.value)}
                          onBlur={commitEpisodeAddSettings}
                          className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-primary/60"
                        />
                      </label>
                    </div>
                    <div className="mt-3 flex h-9 items-center gap-2 overflow-hidden rounded-lg border border-border/70 bg-background/60 px-2">
                      <div className="shrink-0 text-[11px] text-muted-foreground">预览</div>
                      <div className="flex min-w-0 items-center gap-1 whitespace-nowrap">
                        {episodeAddPreview.map((episodeNo) => (
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
                      onClick={() => {
                        if (episodeSettingsMode === "current") {
                          if (!applyEpisodeSettingsToCurrentEpisodes()) return;
                        } else {
                          commitEpisodeAddSettings();
                        }
                        setEpisodeSettingsOpen(false);
                      }}
                      className="mt-3 h-8 w-full rounded-md bg-primary text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      应用
                    </button>
                  </div>
                )}
              </div>

              {/* Save status */}
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

            {/* Textarea — key forces remount on episode change for clean undo history */}
            <div className="min-h-0 flex-1 p-5">
              <textarea
                key={`script-ep${activeEpisode}`}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="h-full w-full resize-none bg-transparent text-sm leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none"
                placeholder={`第 ${activeEpisode} 集剧本\n\n粘贴或输入故事剧本后，点击顶部「AI 自动拆解分镜」生成分镜提示词。`}
              />
            </div>

            {/* AI toolbar */}
            <div className="shrink-0 border-t border-border bg-card/30 p-4">
              <p className="mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <Wand2 className="h-3.5 w-3.5 text-primary" />
                AI 剧本辅助
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void handleRewrite("扩写并润色当前剧本", "polish")}
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
                  onClick={() => void handleRewrite("提炼人物关系并补充人物动机", "relations")}
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

          {/* ── Right: Storyboard shots ── */}
          <div className="flex min-w-0 flex-1 flex-col">
            {storyboards.length === 0 && !loadingShots ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/8">
                  <ImageIcon className="h-7 w-7 text-primary/50" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">第 {activeEpisode} 集暂无分镜提示词</p>
                  <p className="mt-1.5 max-w-[260px] text-xs leading-5 text-muted-foreground">
                    在左侧编辑器中输入第 {activeEpisode}{" "}
                    集剧本，然后点击顶部「AI 自动拆解分镜」按钮生成逐镜头提示词。
                  </p>
                </div>
                <button
                  onClick={() => void handleAutoBreakdown()}
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
                {storyboards.map((item, idx) => {
                  const cover = shotCoverUrl(item);
                  const isImgPending = pendingTask === `img-${item.id}`;
                  const isDelPending = pendingTask === `del-${item.id}`;
                  const selectedRefs = refImages[item.id] ?? [];
                  const isPickerOpen = showRefPicker === item.id;
                  const isModelOpen = showModelPicker === item.id;
                  const currentModel =
                    XIAOLOU_TEXT_TO_IMAGE_MODELS.find((m) => m.id === getShotModel(item.id)) ??
                    XIAOLOU_TEXT_TO_IMAGE_MODELS[0];
                  const prevItem = storyboards[idx - 1];
                  const isNewPart = item.partNo != null && item.partNo !== prevItem?.partNo;

                  return (
                    <div key={item.id}>
                      {/* Part header (expert mode) */}
                      {isNewPart && item.partTitle && (
                        <div className="mb-3 mt-1 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-primary/20 px-2.5 py-0.5 text-[10px] font-bold text-primary">
                              第 {item.partNo} 部分
                            </span>
                            {item.weather && (
                              <span className="text-[10px] text-muted-foreground">{item.weather}</span>
                            )}
                          </div>
                          <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/80">
                            {item.partTitle}
                          </p>
                          {item.blocking && (
                            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/70">
                              {item.blocking}
                            </p>
                          )}
                          {item.camera && (
                            <p className="mt-0.5 text-[10px] text-indigo-300/70">{item.camera}</p>
                          )}
                        </div>
                      )}

                      <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-4 transition-shadow hover:shadow-lg hover:shadow-black/10">
                        <div className="flex gap-4">
                          {/* Image preview */}
                          <div
                            className="group/img relative aspect-video w-52 shrink-0 overflow-hidden rounded-lg bg-muted"
                            onDoubleClick={() =>
                              cover &&
                              setLightbox({
                                url: cover,
                                label: `S${String(item.shotNo).padStart(2, "0")}`,
                              })
                            }
                          >
                            {cover ? (
                              <img
                                src={cover}
                                alt={item.title}
                                className="h-full w-full object-cover transition-transform duration-300 group-hover/img:scale-[1.03]"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <GeneratedMediaPlaceholder
                                kind="image"
                                className="h-full w-full"
                                description="生成后展示"
                              />
                            )}
                            <div className="absolute left-2 top-2 rounded bg-background/80 px-1.5 py-0.5 font-mono text-[10px] backdrop-blur">
                              S{String(item.shotNo).padStart(2, "0")}
                            </div>
                            {cover && (
                              <button
                                type="button"
                                onClick={() =>
                                  setLightbox({
                                    url: cover,
                                    label: `S${String(item.shotNo).padStart(2, "0")}`,
                                  })
                                }
                                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-background/70 text-foreground opacity-0 backdrop-blur transition-opacity hover:bg-background/90 group-hover/img:opacity-100"
                                title="放大查看（双击也可放大）"
                              >
                                <ZoomIn className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {item.durationSeconds ? (
                              <div className="absolute bottom-2 right-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] backdrop-blur">
                                {item.durationSeconds}s
                              </div>
                            ) : null}
                          </div>

                          {/* Prompt + controls */}
                          <div className="flex min-w-0 flex-1 flex-col gap-3">
                            <textarea
                              value={draftPrompts[item.id] ?? item.script}
                              onChange={(e) =>
                                setEpisodeDraftPrompts((prev) => ({
                                  ...prev,
                                  [activeEpisode]: {
                                    ...(prev[activeEpisode] ?? {}),
                                    [item.id]: e.target.value,
                                  },
                                }))
                              }
                              onBlur={() => void handleBlurSave(item)}
                              rows={4}
                              className="w-full resize-none rounded-lg border border-transparent bg-white/[0.04] p-2.5 text-xs leading-relaxed transition-colors placeholder:text-muted-foreground/40 focus:border-border focus:outline-none"
                              placeholder="分镜提示词..."
                            />

                            {/* Reference images row + model selector */}
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[10px] text-muted-foreground">参考图：</span>
                              {selectedRefs.map((asset) => (
                                <div
                                  key={asset.id}
                                  className="group/ref relative h-9 w-9 shrink-0 overflow-hidden rounded-md border border-border"
                                  title={asset.name}
                                >
                                  {asset.previewUrl ? (
                                    <img
                                      src={asset.previewUrl}
                                      alt={asset.name}
                                      className="h-full w-full object-cover"
                                      referrerPolicy="no-referrer"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center bg-muted text-[10px] text-muted-foreground">
                                      {asset.name.slice(0, 2)}
                                    </div>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => toggleRefImage(item.id, asset, false)}
                                    className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover/ref:opacity-100"
                                  >
                                    <X className="h-3 w-3 text-white" />
                                  </button>
                                </div>
                              ))}

                              {/* + 资产库 */}
                              <button
                                type="button"
                                onClick={() => setShowRefPicker(isPickerOpen ? null : item.id)}
                                className={cn(
                                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-xs transition-colors",
                                  isPickerOpen
                                    ? "border-primary/50 bg-primary/10 text-primary"
                                    : "border-dashed border-white/20 text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary",
                                )}
                                title="从资产库选择参考图"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>

                              {/* 本地上传 */}
                              <button
                                type="button"
                                onClick={() => handleLocalUploadClick(item.id)}
                                disabled={uploading && uploadingForShot === item.id}
                                className="flex h-9 items-center gap-1 rounded-md border border-dashed border-white/20 px-2 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:pointer-events-none disabled:opacity-50"
                                title="从本地上传参考图"
                              >
                                {uploading && uploadingForShot === item.id ? (
                                  <LoaderCircle className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Upload className="h-3 w-3" />
                                )}
                                本地上传
                              </button>

                              {selectedRefs.length > 0 && (
                                <span className="text-[10px] text-muted-foreground">
                                  已选 {selectedRefs.length} 张
                                </span>
                              )}

                              {/* Model selector */}
                              <div
                                className="relative ml-auto"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setShowModelPicker(isModelOpen ? null : item.id)
                                  }
                                  className={cn(
                                    "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                                    isModelOpen
                                      ? "border-primary/50 bg-primary/10 text-primary"
                                      : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-primary/5",
                                  )}
                                >
                                  <ImageIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                                  {currentModel?.name ?? "选择模型"}
                                  <ChevronDown
                                    className={cn(
                                      "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
                                      isModelOpen && "rotate-180",
                                    )}
                                  />
                                </button>

                                {isModelOpen && (
                                  <div className="absolute right-0 top-full z-20 mt-1.5 w-52 rounded-xl border border-border bg-card shadow-2xl shadow-black/20">
                                    <div className="border-b border-border px-3 py-2">
                                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                        选择生成模型
                                      </p>
                                    </div>
                                    <div className="p-1.5">
                                      {XIAOLOU_TEXT_TO_IMAGE_MODELS.map((model) => {
                                        const isSelected = getShotModel(item.id) === model.id;
                                        return (
                                          <button
                                            key={model.id}
                                            type="button"
                                            onClick={() => {
                                              setShotModels((prev) => ({
                                                ...prev,
                                                [item.id]: model.id,
                                              }));
                                              setShowModelPicker(null);
                                            }}
                                            className={cn(
                                              "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors",
                                              isSelected
                                                ? "bg-primary/10 text-primary"
                                                : "text-foreground hover:bg-accent",
                                            )}
                                          >
                                            <span className="font-medium">{model.name}</span>
                                            {model.recommended && !isSelected && (
                                              <span className="rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-300">
                                                推荐
                                              </span>
                                            )}
                                            {isSelected && (
                                              <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                                            )}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Asset picker dropdown */}
                            {isPickerOpen && currentProjectId && (
                              <div className="rounded-xl border border-border bg-card p-4 shadow-2xl shadow-black/20">
                                <div className="mb-3 flex items-center justify-between">
                                  <span className="text-xs font-medium text-foreground">
                                    选择参考图（角色 / 场景 / 道具）
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setShowRefPicker(null)}
                                    className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                                <ReferenceAssetPicker
                                  projectId={currentProjectId}
                                  selectedAssetIds={selectedRefs.map((a) => a.id)}
                                  mediaKind="image"
                                  hint="选择角色、场景或道具参考图，生成分镜图时作为风格参考"
                                  onSelect={(asset) => toggleRefImage(item.id, asset, true)}
                                  onToggleSelect={(asset, selected) =>
                                    toggleRefImage(item.id, asset, selected)
                                  }
                                />
                              </div>
                            )}
                          </div>

                          {/* Action column */}
                          <div className="flex w-20 shrink-0 flex-col gap-2 border-l border-border pl-3">
                            <button
                              type="button"
                              onClick={() => void handleGenerateImage(item)}
                              disabled={isImgPending || isDelPending}
                              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-2 text-[11px] font-medium text-primary-foreground shadow-sm shadow-primary/20 transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                            >
                              {isImgPending ? (
                                <LoaderCircle className="h-3 w-3 animate-spin" />
                              ) : (
                                <ImageIcon className="h-3 w-3" />
                              )}
                              {isImgPending ? "生成中" : "生成图"}
                            </button>

                            {item.imageStatus && item.imageStatus !== "pending" && (
                              <div className="rounded-md bg-secondary px-1.5 py-1 text-center text-[10px] text-muted-foreground">
                                {item.imageStatus}
                              </div>
                            )}

                            <button
                              type="button"
                              onClick={() => void handleDeleteShot(item)}
                              disabled={isImgPending || isDelPending}
                              className="mt-auto flex h-8 w-full items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
                              title="删除此分镜"
                            >
                              {isDelPending ? (
                                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Lightbox ── */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <div className="absolute left-5 top-5 rounded-lg bg-background/70 px-3 py-1.5 font-mono text-sm font-medium text-foreground backdrop-blur">
            {lightbox.label}
          </div>
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-background/70 text-foreground backdrop-blur transition-colors hover:bg-background/90"
          >
            <X className="h-4 w-4" />
          </button>
          <img
            src={lightbox.url}
            alt={lightbox.label}
            referrerPolicy="no-referrer"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[88vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl shadow-black/60 ring-1 ring-white/10"
          />
        </div>
      )}
    </div>
  );
}
