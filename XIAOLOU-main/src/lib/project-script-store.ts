import { useEffect, useSyncExternalStore } from "react";
import { getScript, updateScript } from "./api";
import { clearScriptDraft, getScriptDraft, setScriptDraft } from "./session";

export type ProjectScriptSaveState = "idle" | "saving" | "saved" | "error";

export type ProjectScriptSnapshot = {
  content: string;
  savedContent: string;
  loading: boolean;
  hydrated: boolean;
  saveState: ProjectScriptSaveState;
  updatedAt: string | null;
  error: string | null;
};

const EMPTY_SNAPSHOT: ProjectScriptSnapshot = {
  content: "",
  savedContent: "",
  loading: false,
  hydrated: false,
  saveState: "saved",
  updatedAt: null,
  error: null,
};

const snapshots = new Map<string, ProjectScriptSnapshot>();
const listeners = new Map<string, Set<() => void>>();
const loadPromises = new Map<string, Promise<ProjectScriptSnapshot>>();
const saveQueues = new Map<string, Promise<string>>();

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "剧本保存失败";
}

function getSnapshotInternal(projectId: string) {
  return snapshots.get(projectId) ?? EMPTY_SNAPSHOT;
}

function emit(projectId: string) {
  for (const listener of listeners.get(projectId) ?? []) {
    listener();
  }
}

function updateSnapshot(projectId: string, patch: Partial<ProjectScriptSnapshot>) {
  const nextSnapshot = {
    ...getSnapshotInternal(projectId),
    ...patch,
  };
  snapshots.set(projectId, nextSnapshot);
  emit(projectId);
  return nextSnapshot;
}

function syncDraftStorage(projectId: string, content: string, savedContent: string) {
  if (content === savedContent) {
    clearScriptDraft(projectId);
    return;
  }

  setScriptDraft(projectId, content);
}

function normalizeHydratedContent(projectId: string, savedContent: string) {
  const cachedDraft = getScriptDraft(projectId);
  if (cachedDraft === null) {
    return savedContent;
  }

  if (!cachedDraft.trim() && savedContent.trim()) {
    clearScriptDraft(projectId);
    return savedContent;
  }

  return cachedDraft;
}

async function loadProjectScript(projectId: string) {
  updateSnapshot(projectId, {
    loading: true,
    error: null,
  });

  try {
    const script = await getScript(projectId);
    const nextContent = normalizeHydratedContent(projectId, script.content);
    syncDraftStorage(projectId, nextContent, script.content);

    return updateSnapshot(projectId, {
      content: nextContent,
      savedContent: script.content,
      loading: false,
      hydrated: true,
      saveState: nextContent === script.content ? "saved" : "idle",
      updatedAt: script.updatedAt,
      error: null,
    });
  } catch (error) {
    updateSnapshot(projectId, {
      loading: false,
      hydrated: false,
      saveState: "error",
      error: getErrorMessage(error),
    });
    throw error;
  }
}

async function commitProjectScript(projectId: string) {
  await hydrateProjectScript(projectId);

  while (true) {
    const snapshot = getSnapshotInternal(projectId);
    const nextContent = snapshot.content;

    if (nextContent === snapshot.savedContent) {
      clearScriptDraft(projectId);
      updateSnapshot(projectId, {
        saveState: "saved",
        error: null,
      });
      return nextContent;
    }

    updateSnapshot(projectId, {
      saveState: "saving",
      error: null,
    });

    try {
      const savedScript = await updateScript(projectId, nextContent);
      const latestSnapshot = getSnapshotInternal(projectId);
      const latestContent = latestSnapshot.content;
      const savedContent = savedScript.content;

      if (latestContent === savedContent) {
        clearScriptDraft(projectId);
        updateSnapshot(projectId, {
          content: savedContent,
          savedContent,
          saveState: "saved",
          updatedAt: savedScript.updatedAt,
          error: null,
        });
        return savedContent;
      }

      syncDraftStorage(projectId, latestContent, savedContent);
      updateSnapshot(projectId, {
        savedContent,
        saveState: "idle",
        updatedAt: savedScript.updatedAt,
        error: null,
      });
    } catch (error) {
      setScriptDraft(projectId, getSnapshotInternal(projectId).content);
      updateSnapshot(projectId, {
        saveState: "error",
        error: getErrorMessage(error),
      });
      throw error;
    }
  }
}

export function getProjectScriptSnapshot(projectId: string) {
  return getSnapshotInternal(projectId);
}

export function subscribeProjectScript(projectId: string, listener: () => void) {
  const projectListeners = listeners.get(projectId) ?? new Set<() => void>();
  projectListeners.add(listener);
  listeners.set(projectId, projectListeners);

  return () => {
    const nextListeners = listeners.get(projectId);
    if (!nextListeners) return;
    nextListeners.delete(listener);
    if (nextListeners.size === 0) {
      listeners.delete(projectId);
    }
  };
}

export function setProjectScriptContent(projectId: string, content: string) {
  const snapshot = getSnapshotInternal(projectId);
  syncDraftStorage(projectId, content, snapshot.savedContent);

  updateSnapshot(projectId, {
    content,
    saveState:
      snapshot.hydrated && content === snapshot.savedContent ? "saved" : "idle",
    error: null,
  });
}

export function hydrateProjectScript(projectId: string) {
  const snapshot = getSnapshotInternal(projectId);
  if (snapshot.hydrated) {
    return Promise.resolve(snapshot);
  }

  const existingPromise = loadPromises.get(projectId);
  if (existingPromise) {
    return existingPromise;
  }

  const nextPromise = loadProjectScript(projectId).finally(() => {
    if (loadPromises.get(projectId) === nextPromise) {
      loadPromises.delete(projectId);
    }
  });
  loadPromises.set(projectId, nextPromise);
  return nextPromise;
}

export function reloadProjectScript(projectId: string) {
  const nextPromise = loadProjectScript(projectId).finally(() => {
    if (loadPromises.get(projectId) === nextPromise) {
      loadPromises.delete(projectId);
    }
  });
  loadPromises.set(projectId, nextPromise);
  return nextPromise;
}

export function saveProjectScript(projectId: string) {
  const previousQueue = saveQueues.get(projectId) ?? Promise.resolve(getSnapshotInternal(projectId).content);
  const nextQueue = previousQueue
    .catch(() => getSnapshotInternal(projectId).content)
    .then(() => commitProjectScript(projectId));

  const trackedQueue = nextQueue.finally(() => {
    if (saveQueues.get(projectId) === trackedQueue) {
      saveQueues.delete(projectId);
    }
  });

  saveQueues.set(projectId, trackedQueue);
  return trackedQueue;
}

export function useProjectScript(projectId: string) {
  const snapshot = useSyncExternalStore(
    (listener) => subscribeProjectScript(projectId, listener),
    () => getProjectScriptSnapshot(projectId),
    () => EMPTY_SNAPSHOT,
  );

  useEffect(() => {
    void hydrateProjectScript(projectId).catch(() => {});
  }, [projectId]);

  return {
    ...snapshot,
    setContent: (content: string) => setProjectScriptContent(projectId, content),
    save: () => saveProjectScript(projectId),
    reload: () => reloadProjectScript(projectId),
  };
}
