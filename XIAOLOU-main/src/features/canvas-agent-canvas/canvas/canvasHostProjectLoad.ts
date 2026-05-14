import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { getCanvasProject } from "./api/canvas";
import {
  clearCanvasProjectLoad,
  notifyCanvasProjectLoad,
} from "./runtime/integrations/canvasHostServices";
import {
  sanitizeCanvasGroupsForPersistence,
  sanitizeCanvasNodesForPersistence,
} from "./runtime/utils/canvasPersistence";
import {
  readCanvasSessionProjectId,
  writeCanvasSessionProjectId,
} from "./canvasProjectSession";
import {
  describeRequestError,
  type CanvasProjectLoadState,
} from "./canvasProjectSaveHelpers";

type Ref<T> = { current: T };

type CanvasHostProjectLoadRefs = {
  canvasProjectIdRef: Ref<string | null>;
  canvasProjectUpdatedAtRef: Ref<string | null>;
  canvasProjectBaseTitleRef: Ref<string | null>;
  canvasProjectBaseDataRef: Ref<unknown>;
  canvasSaveBlockedRef: Ref<boolean>;
  canvasSaveConflictAlertedRef: Ref<boolean>;
};

type UseCanvasHostProjectLoadParams = CanvasHostProjectLoadRefs & {
  actorId: string | null;
  isProjectContextReady: boolean;
};

export function useCanvasHostProjectLoad({
  actorId,
  isProjectContextReady,
  canvasProjectIdRef,
  canvasProjectUpdatedAtRef,
  canvasProjectBaseTitleRef,
  canvasProjectBaseDataRef,
  canvasSaveBlockedRef,
  canvasSaveConflictAlertedRef,
}: UseCanvasHostProjectLoadParams) {
  const location = useLocation();
  const pendingLoadProjectId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const projectId = params.get("canvasProjectId")?.trim();
    return projectId || null;
  }, [location.search]);
  const pendingLoadRequestKey = useMemo(
    () => (pendingLoadProjectId ? `${actorId || "guest"}:${pendingLoadProjectId}` : null),
    [actorId, pendingLoadProjectId],
  );
  const [canvasProjectLoadState, setCanvasProjectLoadState] = useState<CanvasProjectLoadState>(
    () => (pendingLoadProjectId ? { status: "syncing" } : { status: "idle" }),
  );
  const [canvasProjectLoadAttempt, setCanvasProjectLoadAttempt] = useState(0);
  const canvasProjectLoadPendingRef = useRef(Boolean(pendingLoadProjectId));
  const pendingCanvasProjectLoadIdRef = useRef<string | null>(pendingLoadProjectId);
  const lastLoadedProjectRequestKeyRef = useRef<string | null>(null);
  const didInitCanvasProjectIdRef = useRef(false);

  if (!didInitCanvasProjectIdRef.current) {
    canvasProjectIdRef.current = pendingLoadProjectId || readCanvasSessionProjectId(actorId);
    didInitCanvasProjectIdRef.current = true;
  }

  useEffect(() => {
    if (location.search.includes("canvasProjectId=")) {
      return;
    }
    canvasProjectIdRef.current = readCanvasSessionProjectId(actorId);
    canvasProjectUpdatedAtRef.current = null;
    canvasProjectBaseTitleRef.current = null;
    canvasProjectBaseDataRef.current = null;
    canvasSaveBlockedRef.current = false;
    canvasSaveConflictAlertedRef.current = false;
    canvasProjectLoadPendingRef.current = false;
    pendingCanvasProjectLoadIdRef.current = null;
    lastLoadedProjectRequestKeyRef.current = null;
  }, [actorId, location.search]);

  useEffect(() => {
    if (!pendingLoadProjectId) {
      lastLoadedProjectRequestKeyRef.current = null;
      pendingCanvasProjectLoadIdRef.current = null;
      canvasProjectLoadPendingRef.current = false;
      clearCanvasProjectLoad();
      setCanvasProjectLoadState({ status: "idle" });
      setCanvasProjectLoadAttempt(0);
      return;
    }

    canvasProjectIdRef.current = pendingLoadProjectId;
    pendingCanvasProjectLoadIdRef.current = pendingLoadProjectId;
    canvasProjectLoadPendingRef.current =
      lastLoadedProjectRequestKeyRef.current !== pendingLoadRequestKey;
    writeCanvasSessionProjectId(actorId, pendingLoadProjectId);

    if (!isProjectContextReady) {
      setCanvasProjectLoadState({ status: "syncing" });
      return;
    }
    if (lastLoadedProjectRequestKeyRef.current === pendingLoadRequestKey) {
      pendingCanvasProjectLoadIdRef.current = null;
      canvasProjectLoadPendingRef.current = false;
      setCanvasProjectLoadState({ status: "idle" });
      return;
    }

    let cancelled = false;
    canvasProjectUpdatedAtRef.current = null;
    canvasProjectBaseTitleRef.current = null;
    canvasProjectBaseDataRef.current = null;
    canvasSaveBlockedRef.current = false;
    canvasSaveConflictAlertedRef.current = false;
    setCanvasProjectLoadState({ status: "loading" });
    (async () => {
      try {
        const project = await getCanvasProject(pendingLoadProjectId);
        if (cancelled) return;
        const canvasData = project.canvasData as {
          nodes?: unknown[]; groups?: unknown[];
          viewport?: { x: number; y: number; zoom: number };
        } | null;
        const sanitizedNodes = sanitizeCanvasNodesForPersistence(
          (canvasData?.nodes as any) || [],
        );
        const sanitizedGroups = sanitizeCanvasGroupsForPersistence(
          (canvasData?.groups as any) || [],
        );
        notifyCanvasProjectLoad({
          id: project.id,
          title: project.title,
          updatedAt: project.updatedAt || undefined,
          nodes: sanitizedNodes,
          groups: sanitizedGroups,
          viewport: canvasData?.viewport,
        });
        lastLoadedProjectRequestKeyRef.current = pendingLoadRequestKey;
        canvasProjectIdRef.current = project.id;
        canvasProjectUpdatedAtRef.current = project.updatedAt || null;
        canvasProjectBaseTitleRef.current = project.title || null;
        canvasProjectBaseDataRef.current = project.canvasData ?? null;
        canvasSaveBlockedRef.current = false;
        canvasSaveConflictAlertedRef.current = false;
        pendingCanvasProjectLoadIdRef.current = null;
        canvasProjectLoadPendingRef.current = false;
        // Update session so subsequent saves update THIS project
        writeCanvasSessionProjectId(actorId, project.id);
        setCanvasProjectLoadState({ status: "idle" });
      } catch (err) {
        if (cancelled) return;
        canvasProjectLoadPendingRef.current = true;
        clearCanvasProjectLoad();
        setCanvasProjectLoadState({
          status: "error",
          message: describeRequestError(err, "画布项目加载失败，请稍后重试。"),
        });
        console.warn("[CanvasCreate] Failed to load canvas project:", err);
      }
    })();

    return () => { cancelled = true; };
  }, [actorId, canvasProjectLoadAttempt, isProjectContextReady, pendingLoadProjectId, pendingLoadRequestKey]);

  const isCanvasProjectReadyToRender =
    !pendingLoadProjectId ||
    (canvasProjectLoadState.status === "idle" &&
      lastLoadedProjectRequestKeyRef.current === pendingLoadRequestKey);
  const canvasProjectLoadDisplayStatus =
    canvasProjectLoadState.status === "idle" ? "loading" : canvasProjectLoadState.status;

  return {
    pendingLoadProjectId,
    canvasProjectLoadState,
    canvasProjectLoadDisplayStatus,
    isCanvasProjectReadyToRender,
    retryCanvasProjectLoad: () => setCanvasProjectLoadAttempt((count) => count + 1),
    canvasProjectLoadPendingRef,
    pendingCanvasProjectLoadIdRef,
    lastLoadedProjectRequestKeyRef,
  };
}
