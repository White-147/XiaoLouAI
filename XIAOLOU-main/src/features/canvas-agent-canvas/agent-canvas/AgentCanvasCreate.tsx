/**
 * AgentCanvasCreate.tsx — Direct-embed canvas page (no iframe).
 *
 * Instead of loading the canvas runtime in an <iframe>, this component:
 *   1. Registers CanvasHostServices (generation, assets, workflow, save)
 *      in the canvas-source module-level registry.
 *   2. Renders the canvas App component directly inside this React tree.
 *   3. Notifies the canvas of theme changes and pending project loads via
 *      the event buses in canvasHostServices.ts.
 *
 * All bridge logic that previously lived in postMessage handlers now lives
 * in the services closures below. The canvas source code is unchanged except
 * for minimal additions to support the direct-embed path.
 */

import { useEffect, useMemo, useRef } from "react";
import { useActorId } from "../../../lib/actor-session";
import { useCurrentProjectId } from "../../../lib/session";
import { useTheme } from "../../../lib/theme";
import {
  setCanvasHostServices,
  clearCanvasHostServices,
  notifyCanvasThemeChange,
  type CanvasHostServices,
} from "./runtime/integrations/canvasHostServices";
import CanvasApp from "./runtime/App";
import CanvasProjectLoadOverlay from "./CanvasProjectLoadOverlay";
import { createAgentCanvasHostGenerationService } from "./agentCanvasHostGenerationService";
import { createAgentCanvasHostAssetService } from "./agentCanvasHostAssetService";
import { createAgentCanvasHostProjectService } from "./agentCanvasHostProjectService";
import { createAgentCanvasHostSaveService } from "./agentCanvasHostSaveService";
import { useAgentCanvasHostProjectLoad } from "./agentCanvasHostProjectLoad";

// ─── Main component ───────────────────────────────────────────────────────────

export default function AgentCanvasCreate() {
  const actorId = useActorId();
  const [currentProjectId, , currentProjectContext] = useCurrentProjectId();
  const [theme] = useTheme();

  // ── Mutable refs so service closures always see the latest values ──────────
  const actorIdRef = useRef(actorId);
  const projectIdRef = useRef(currentProjectId);
  const projectContextReadyRef = useRef(currentProjectContext.isReady);
  const projectContextReadyPromiseRef = useRef<Promise<void> | null>(null);
  const projectContextReadyResolveRef = useRef<(() => void) | null>(null);
  actorIdRef.current = actorId;
  projectIdRef.current = currentProjectId;
  useEffect(() => { actorIdRef.current = actorId; }, [actorId]);
  useEffect(() => { projectIdRef.current = currentProjectId; }, [currentProjectId]);
  useEffect(() => {
    projectContextReadyRef.current = currentProjectContext.isReady;
    if (currentProjectContext.isReady) {
      const resolve = projectContextReadyResolveRef.current;
      projectContextReadyResolveRef.current = null;
      projectContextReadyPromiseRef.current = null;
      resolve?.();
      return;
    }
    if (!projectContextReadyPromiseRef.current) {
      projectContextReadyPromiseRef.current = new Promise<void>((resolve) => {
        projectContextReadyResolveRef.current = resolve;
      });
    }
  }, [currentProjectContext.isReady]);

  // ── Save-state refs ────────────────────────────────────────────────────────
  // canvasProjectIdRef is pre-seeded from localStorage so the same project is
  // updated across refreshes (prevents duplicate project creation).
  const canvasProjectIdRef = useRef<string | null>(null);
  const canvasProjectUpdatedAtRef = useRef<string | null>(null);
  const canvasProjectBaseTitleRef = useRef<string | null>(null);
  const canvasProjectBaseDataRef = useRef<unknown>(null);
  const canvasSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const canvasSaveBlockedRef = useRef(false);
  const canvasSaveConflictAlertedRef = useRef(false);
  const {
    canvasProjectLoadState,
    isProjectLoadOverlayVisible,
    retryCanvasProjectLoad,
  } = useAgentCanvasHostProjectLoad({
    actorId,
    isProjectContextReady: currentProjectContext.isReady,
    canvasProjectIdRef,
    canvasProjectUpdatedAtRef,
    canvasProjectBaseTitleRef,
    canvasProjectBaseDataRef,
    canvasSaveBlockedRef,
    canvasSaveConflictAlertedRef,
  });

  const waitForProjectContextReady = async () => {
    if (projectContextReadyRef.current) {
      return;
    }
    if (!projectContextReadyPromiseRef.current) {
      projectContextReadyPromiseRef.current = new Promise<void>((resolve) => {
        projectContextReadyResolveRef.current = resolve;
      });
    }
    await projectContextReadyPromiseRef.current;
  };

  const resolveReadyProjectId = async () => {
    await waitForProjectContextReady();
    const readyProjectId = String(projectIdRef.current || "").trim();
    if (!readyProjectId) {
      throw new Error("当前账号项目上下文仍在同步，请稍后重试。");
    }
    return readyProjectId;
  };

  // ── Build services object (stable via useMemo, closures over mutable refs) ──
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const services = useMemo((): CanvasHostServices => ({
    // Identity — getters always return latest via refs
    get actorId() { return actorIdRef.current; },
    get projectId() { return projectContextReadyRef.current ? projectIdRef.current : null; },

    initialTheme: theme,

      ...createAgentCanvasHostGenerationService(resolveReadyProjectId),

      // ── Assets ──────────────────────────────────────────────────────────────
      ...createAgentCanvasHostAssetService(resolveReadyProjectId),

      // ── Canvas projects ─────────────────────────────────────────────────────
      ...createAgentCanvasHostProjectService({
        actorIdRef,
        canvasProjectIdRef,
        canvasProjectUpdatedAtRef,
        canvasProjectBaseTitleRef,
        canvasProjectBaseDataRef,
        canvasSaveBlockedRef,
        canvasSaveConflictAlertedRef,
      }),

      // ── Save ────────────────────────────────────────────────────────────────
      ...createAgentCanvasHostSaveService({
        actorIdRef,
        canvasProjectIdRef,
        canvasProjectUpdatedAtRef,
        canvasProjectBaseTitleRef,
        canvasProjectBaseDataRef,
        canvasSaveQueueRef,
        canvasSaveBlockedRef,
        canvasSaveConflictAlertedRef,
      }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []); // Empty deps: all captures are via mutable refs

  // Register services SYNCHRONOUSLY in render so CanvasApp sees them on first render.
  // (Module-level write is safe: only one canvas instance is mounted at a time.)
  setCanvasHostServices(services);

  // Re-register inside the effect setup so React StrictMode's development
  // effect replay ends with the latest services instance still installed.
  useEffect(() => {
    setCanvasHostServices(services);
    return () => { clearCanvasHostServices(services); };
  }, [services]);

  // ── Sync theme changes to canvas ──────────────────────────────────────────
  useEffect(() => {
    notifyCanvasThemeChange(theme);
  }, [theme]);

  // NOTE: The one-time empty-project cleanup that previously ran here has been
  // removed. It was a destructive side-effect (deleting user projects on mount)
  // that risked data loss for legitimately-empty or newly-created drafts.
  // The stable-ID save mechanism (canvasProjectIdRef + localStorage) now
  // prevents duplicate creation in the first place, making the cleanup
  // unnecessary and unsafe to run automatically.

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    // data-testid gives the canvas-not-mounted verification script a stable
    // hook to prove the component is (or isn't) in the DOM — previously the
    // check relied on guessing a CSS class and silently passed.
    <div
      data-testid="canvas-create-root"
      className="relative h-full w-full overflow-hidden bg-background text-foreground transition-colors duration-300"
    >
      <CanvasApp creditQuoteProjectId={currentProjectId} />
      {isProjectLoadOverlayVisible ? (
        <CanvasProjectLoadOverlay
          loadState={canvasProjectLoadState}
          onRetry={retryCanvasProjectLoad}
          onReload={() => window.location.reload()}
        />
      ) : null}
    </div>
  );
}
