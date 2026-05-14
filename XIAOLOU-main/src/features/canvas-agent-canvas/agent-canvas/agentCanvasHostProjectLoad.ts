import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { getAgentCanvasProject } from "./api/agent-canvas";
import {
  clearCanvasProjectLoad,
  notifyCanvasProjectLoad,
} from "./runtime/integrations/canvasHostServices";
import {
  sanitizeCanvasGroupsForPersistence,
  sanitizeCanvasNodesForPersistence,
} from "./runtime/utils/canvasPersistence";
import {
  readAgentCanvasProjectIdFromSearch,
  readCanvasSessionProjectId,
  writeAgentCanvasProjectIdToSearch,
  writeCanvasSessionProjectId,
} from "./canvasProjectSession";
import {
  describeRequestError,
  type CanvasProjectLoadState,
} from "./canvasProjectSaveHelpers";

type Ref<T> = { current: T };

type AgentCanvasHostProjectLoadRefs = {
  canvasProjectIdRef: Ref<string | null>;
  canvasProjectUpdatedAtRef: Ref<string | null>;
  canvasProjectBaseTitleRef: Ref<string | null>;
  canvasProjectBaseDataRef: Ref<unknown>;
  canvasSaveBlockedRef: Ref<boolean>;
  canvasSaveConflictAlertedRef: Ref<boolean>;
};

type UseAgentCanvasHostProjectLoadParams = AgentCanvasHostProjectLoadRefs & {
  actorId: string | null;
  isProjectContextReady: boolean;
};

export function useAgentCanvasHostProjectLoad({
  actorId,
  isProjectContextReady,
  canvasProjectIdRef,
  canvasProjectUpdatedAtRef,
  canvasProjectBaseTitleRef,
  canvasProjectBaseDataRef,
  canvasSaveBlockedRef,
  canvasSaveConflictAlertedRef,
}: UseAgentCanvasHostProjectLoadParams) {
  const location = useLocation();
  const urlProjectId = useMemo(
    () => readAgentCanvasProjectIdFromSearch(location.search),
    [location.search],
  );
  const sessionProjectId = useMemo(
    () => (urlProjectId ? null : readCanvasSessionProjectId(actorId)),
    [actorId, urlProjectId],
  );
  const pendingLoadProjectId = urlProjectId || sessionProjectId;
  const pendingLoadRequestKey = useMemo(
    () => (pendingLoadProjectId ? `${actorId || "guest"}:${pendingLoadProjectId}` : null),
    [actorId, pendingLoadProjectId],
  );
  const [canvasProjectLoadState, setCanvasProjectLoadState] = useState<CanvasProjectLoadState>({ status: "idle" });
  const [canvasProjectLoadAttempt, setCanvasProjectLoadAttempt] = useState(0);
  const lastLoadedProjectRequestKeyRef = useRef<string | null>(null);
  const didInitCanvasProjectIdRef = useRef(false);

  if (!didInitCanvasProjectIdRef.current) {
    canvasProjectIdRef.current = pendingLoadProjectId || readCanvasSessionProjectId(actorId);
    didInitCanvasProjectIdRef.current = true;
  }

  useEffect(() => {
    if (pendingLoadProjectId) {
      return;
    }
    canvasProjectIdRef.current = null;
    canvasProjectUpdatedAtRef.current = null;
    canvasProjectBaseTitleRef.current = null;
    canvasProjectBaseDataRef.current = null;
    canvasSaveBlockedRef.current = false;
    canvasSaveConflictAlertedRef.current = false;
  }, [actorId, pendingLoadProjectId]);

  useEffect(() => {
    if (!pendingLoadProjectId) {
      lastLoadedProjectRequestKeyRef.current = null;
      clearCanvasProjectLoad();
      setCanvasProjectLoadState({ status: "idle" });
      setCanvasProjectLoadAttempt(0);
      return;
    }
    if (!isProjectContextReady) {
      setCanvasProjectLoadState({ status: "syncing" });
      return;
    }
    if (lastLoadedProjectRequestKeyRef.current === pendingLoadRequestKey) {
      setCanvasProjectLoadState({ status: "idle" });
      return;
    }

    let cancelled = false;
    setCanvasProjectLoadState({ status: "loading" });
    (async () => {
      try {
        const project = await getAgentCanvasProject(pendingLoadProjectId);
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
          agentContext: project.agentContext ?? null,
        });
        lastLoadedProjectRequestKeyRef.current = pendingLoadRequestKey;
        canvasProjectIdRef.current = project.id;
        canvasProjectUpdatedAtRef.current = project.updatedAt || null;
        canvasProjectBaseTitleRef.current = project.title || null;
        canvasProjectBaseDataRef.current = project.canvasData ?? null;
        canvasSaveBlockedRef.current = false;
        canvasSaveConflictAlertedRef.current = false;
        // Update session so subsequent saves update THIS project
        writeCanvasSessionProjectId(actorId, project.id);
        writeAgentCanvasProjectIdToSearch(project.id);
        setCanvasProjectLoadState({ status: "idle" });
      } catch (err) {
        if (cancelled) return;
        clearCanvasProjectLoad();
        setCanvasProjectLoadState({
          status: "error",
          message: describeRequestError(err, "智能画布项目加载失败，请稍后重试。"),
        });
        console.warn("[AgentCanvasCreate] Failed to load canvas project:", err);
      }
    })();

    return () => { cancelled = true; };
  }, [actorId, canvasProjectLoadAttempt, isProjectContextReady, pendingLoadProjectId, pendingLoadRequestKey]);

  return {
    pendingLoadProjectId,
    canvasProjectLoadState,
    isProjectLoadOverlayVisible: Boolean(pendingLoadProjectId) && canvasProjectLoadState.status !== "idle",
    retryCanvasProjectLoad: () => setCanvasProjectLoadAttempt((count) => count + 1),
    lastLoadedProjectRequestKeyRef,
  };
}
