import { CheckCircle2, LoaderCircle, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  ensureJaazServices,
  getMe,
  syncAgentStudioCanvasProject,
  type AgentStudioCanvasProjectSyncInput,
  type PermissionContext,
} from "../../lib/api";
import { getAuthToken, useActorId } from "../../lib/actor-session";
import { getCurrentProjectId } from "../../lib/session";
import { useTheme, type AppTheme } from "../../lib/theme";

const DEFAULT_JAAZ_AGENT_CANVAS_URL = "/jaaz/";

type XiaolouJaazAuthMessage = {
  type: "xiaolou:auth";
  actorId: string;
  token: string | null;
  user: {
    id: string;
    displayName: string;
    email: string | null;
    avatar: string | null;
  };
  platformRole: PermissionContext["platformRole"];
};

type XiaolouJaazAuthClearMessage = {
  type: "xiaolou:auth:clear";
};

type XiaolouJaazThemeMessage = {
  type: "xiaolou:theme";
  theme: AppTheme;
};

type SaveStatus = "idle" | "saving" | "syncing" | "saved" | "error";

type XiaolouAgentCanvasProjectMessage = {
  type: "xiaolou:agent-canvas-project:upsert";
  project?: {
    canvasId?: string;
    sessionId?: string;
    title?: string;
  };
};

type XiaolouAgentCanvasProjectSaveResultMessage = {
  type: "xiaolou:agent-canvas-project:save-result";
  requestId?: string;
  ok?: boolean;
  error?: string;
};

function appendEmbedParam(url: string) {
  if (/[?&](embed|xiaolouEmbed)=/i.test(url)) return url;
  const [withoutHash, hash = ""] = url.split("#", 2);
  const separator = withoutHash.includes("?") ? "&" : "?";
  return `${withoutHash}${separator}embed=xiaolou${hash ? `#${hash}` : ""}`;
}

function resolveJaazRootUrl() {
  const configured = String(import.meta.env.VITE_JAAZ_AGENT_CANVAS_URL || "").trim();
  return appendEmbedParam(configured || DEFAULT_JAAZ_AGENT_CANVAS_URL);
}

function readRequestedCanvasProject(locationSearch = ""): AgentStudioCanvasProjectSyncInput | null {
  const params = new URLSearchParams(locationSearch);
  const canvasId = params.get("canvasId") || params.get("jaazCanvasId");
  const sessionId = params.get("sessionId") || params.get("jaazSessionId");
  if (!canvasId) return null;
  return {
    canvasId,
    sessionId: sessionId || undefined,
    canvasUrl:
      `/canvas/${encodeURIComponent(canvasId)}` +
      (sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""),
    source: "xiaolou_route",
    savedAt: new Date().toISOString(),
  };
}

function resolveJaazCanvasUrl(rootUrl: string, canvasId: string, sessionId?: string | null) {
  if (typeof window === "undefined") return rootUrl;
  try {
    const parsed = new URL(rootUrl, window.location.href);
    const basePath = parsed.pathname.replace(/\/$/, "");
    parsed.pathname = `${basePath}/canvas/${encodeURIComponent(canvasId)}`;
    parsed.search = "";
    if (sessionId) parsed.searchParams.set("sessionId", sessionId);
    parsed.searchParams.set("embed", "xiaolou");
    return parsed.toString();
  } catch {
    return rootUrl;
  }
}

function resolveInitialJaazIframeUrl(locationPathname: string, locationSearch = "") {
  const rootUrl = resolveJaazRootUrl();
  if (locationPathname !== "/create/agent-studio") return rootUrl;
  const requestedProject = readRequestedCanvasProject(locationSearch);
  if (!requestedProject?.canvasId) return rootUrl;
  return resolveJaazCanvasUrl(rootUrl, requestedProject.canvasId, requestedProject.sessionId || null);
}

function resolveTargetOrigin(url: string) {
  if (typeof window === "undefined") return "*";
  try {
    return new URL(url, window.location.href).origin;
  } catch {
    return "*";
  }
}

function readCanvasProjectFromUrl(url: string): AgentStudioCanvasProjectSyncInput | null {
  try {
    const parsed = new URL(url, window.location.href);
    const match = parsed.pathname.match(/\/(?:jaaz\/)?canvas\/([^/?#]+)/i);
    const canvasId = match?.[1] ? decodeURIComponent(match[1]) : "";
    if (!canvasId) return null;
    return {
      canvasId,
      sessionId: parsed.searchParams.get("sessionId") || undefined,
      canvasUrl: `${parsed.pathname}${parsed.search}`,
      source: "xiaolou_manual_button",
      savedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export default function JaazAgentCanvasEmbed() {
  const location = useLocation();
  const iframeUrlRef = useRef<string | null>(null);
  if (iframeUrlRef.current === null) {
    iframeUrlRef.current = resolveInitialJaazIframeUrl(location.pathname, location.search);
  }
  const iframeUrl = iframeUrlRef.current;
  const requestedCanvasProject = useMemo(
    () =>
      location.pathname === "/create/agent-studio"
        ? readRequestedCanvasProject(location.search)
        : null,
    [location.pathname, location.search],
  );
  const targetOrigin = useMemo(() => resolveTargetOrigin(iframeUrl), [iframeUrl]);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const actorId = useActorId();
  const [theme, setTheme] = useTheme();
  const [isLoading, setIsLoading] = useState(true);
  const [iframeRevision, setIframeRevision] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [currentCanvasProject, setCurrentCanvasProject] =
    useState<XiaolouAgentCanvasProjectMessage["project"] | null>(null);
  const activeSaveRequestIdRef = useRef<string | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const [authMessage, setAuthMessage] = useState<XiaolouJaazAuthMessage | XiaolouJaazAuthClearMessage>({
    type: "xiaolou:auth:clear",
  });

  const postAuthMessage = useCallback(
    (message = authMessage) => {
      iframeRef.current?.contentWindow?.postMessage(message, targetOrigin);
    },
    [authMessage, targetOrigin],
  );

  const postThemeMessage = useCallback(
    (nextTheme = theme) => {
      const message: XiaolouJaazThemeMessage = {
        type: "xiaolou:theme",
        theme: nextTheme,
      };
      iframeRef.current?.contentWindow?.postMessage(message, targetOrigin);
    },
    [targetOrigin, theme],
  );

  const hasCurrentCanvas = Boolean(currentCanvasProject?.canvasId || requestedCanvasProject?.canvasId);

  const postCanvasNavigationMessage = useCallback(
    (project: AgentStudioCanvasProjectSyncInput | null = requestedCanvasProject) => {
      if (!project?.canvasId) return;
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: "xiaolou:agent-canvas:navigate",
          canvasId: project.canvasId,
          sessionId: project.sessionId || null,
        },
        targetOrigin,
      );
    },
    [requestedCanvasProject, targetOrigin],
  );

  const readCurrentCanvasProject = useCallback((): AgentStudioCanvasProjectSyncInput | null => {
    if (currentCanvasProject?.canvasId) {
      return {
        ...currentCanvasProject,
        canvasId: currentCanvasProject.canvasId,
        source: "xiaolou_manual_button",
        savedAt: new Date().toISOString(),
      };
    }

    try {
      const href = iframeRef.current?.contentWindow?.location.href;
      if (href) return readCanvasProjectFromUrl(href);
    } catch {
      // Cross-origin iframe access is intentionally ignored; the postMessage path remains primary.
    }

    if (requestedCanvasProject?.canvasId) {
      return {
        ...requestedCanvasProject,
        source: "xiaolou_manual_button",
        savedAt: new Date().toISOString(),
      };
    }

    return readCanvasProjectFromUrl(iframeUrl);
  }, [currentCanvasProject, iframeUrl, requestedCanvasProject]);

  const syncCurrentProjectDirectly = useCallback(
    async (requestId: string) => {
      const project = readCurrentCanvasProject();
      if (!project?.canvasId) return false;

      const projectId = getCurrentProjectId(actorId);
      const projectAsset = await syncAgentStudioCanvasProject(projectId, project);
      if (activeSaveRequestIdRef.current === requestId) {
        activeSaveRequestIdRef.current = null;
        if (saveTimeoutRef.current) {
          window.clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
        setCurrentCanvasProject(project);
        setSaveStatus("saved");
        window.setTimeout(() => setSaveStatus("idle"), 2200);
      }
      window.dispatchEvent(
        new CustomEvent("xiaolou:agent-canvas-project:synced", {
          detail: { projectId, asset: projectAsset },
        }),
      );
      return true;
    },
    [actorId, readCurrentCanvasProject],
  );

  const saveButtonLabel =
    saveStatus === "saving"
      ? "保存中..."
      : saveStatus === "syncing"
        ? "同步中..."
        : saveStatus === "saved"
          ? "已保存"
          : saveStatus === "error"
            ? "保存失败"
            : "保存到项目管理";

  const requestProjectSave = useCallback(() => {
    if (isLoading || saveStatus === "saving" || saveStatus === "syncing") return;

    const requestId = `save_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    activeSaveRequestIdRef.current = requestId;
    setSaveStatus("saving");
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "xiaolou:agent-canvas-project:save-request",
        requestId,
      },
      targetOrigin,
    );

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = window.setTimeout(() => {
      if (activeSaveRequestIdRef.current !== requestId) return;
      activeSaveRequestIdRef.current = null;
      setSaveStatus("error");
      window.setTimeout(() => setSaveStatus("idle"), 2200);
    }, 7000);

    window.setTimeout(() => {
      if (activeSaveRequestIdRef.current !== requestId) return;
      void syncCurrentProjectDirectly(requestId).catch(() => {
        if (activeSaveRequestIdRef.current !== requestId) return;
        activeSaveRequestIdRef.current = null;
        if (saveTimeoutRef.current) {
          window.clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
        setSaveStatus("error");
        window.setTimeout(() => setSaveStatus("idle"), 2200);
      });
    }, 1200);
  }, [isLoading, saveStatus, syncCurrentProjectDirectly, targetOrigin]);

  useEffect(() => {
    let active = true;

    const loadAuth = async () => {
      try {
        const context = await getMe();
        if (!active) return;

        if (context.platformRole === "guest") {
          setAuthMessage({ type: "xiaolou:auth:clear" });
          return;
        }

        setAuthMessage({
          type: "xiaolou:auth",
          actorId: context.actor.id,
          token: getAuthToken(),
          user: {
            id: context.actor.id,
            displayName: context.actor.displayName,
            email: context.actor.email,
            avatar: context.actor.avatar || null,
          },
          platformRole: context.platformRole,
        });
      } catch {
        if (active) setAuthMessage({ type: "xiaolou:auth:clear" });
      }
    };

    void loadAuth();

    return () => {
      active = false;
    };
  }, [actorId]);

  useEffect(() => {
    let active = true;

    const ensureAndReloadIfStarted = async () => {
      try {
        const status = await ensureJaazServices();
        if (!active) return;
        if (status.api.started || status.ui.started) {
          setIsLoading(true);
          setIframeRevision((value) => value + 1);
        }
      } catch {
        // The overlay will stay visible if Jaaz is still booting or unavailable.
      }
    };

    void ensureAndReloadIfStarted();
    const intervalId = window.setInterval(() => {
      void ensureAndReloadIfStarted();
    }, 30_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!requestedCanvasProject?.canvasId) return;
    setCurrentCanvasProject((current) => ({
      ...current,
      ...requestedCanvasProject,
      canvasId: requestedCanvasProject.canvasId,
    }));
    if (!isLoading) {
      postCanvasNavigationMessage(requestedCanvasProject);
    }
  }, [isLoading, postCanvasNavigationMessage, requestedCanvasProject]);

  useEffect(() => {
    if (!isLoading) {
      postAuthMessage();
    }
  }, [authMessage, isLoading, postAuthMessage]);

  useEffect(() => {
    if (!isLoading) {
      postThemeMessage();
    }
  }, [isLoading, postThemeMessage]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (targetOrigin !== "*" && event.origin !== targetOrigin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type === "xiaolou:auth:request") {
        postAuthMessage();
      }

      if (event.data?.type === "xiaolou:agent-canvas-project:upsert") {
        const message = event.data as XiaolouAgentCanvasProjectMessage;
        if (message.project?.canvasId) {
          setCurrentCanvasProject(message.project);
        }
      }

      if (event.data?.type === "xiaolou:agent-canvas-project:save-result") {
        const message = event.data as XiaolouAgentCanvasProjectSaveResultMessage;
        if (
          message.requestId &&
          activeSaveRequestIdRef.current &&
          message.requestId !== activeSaveRequestIdRef.current
        ) {
          return;
        }
        if (message.ok) {
          setSaveStatus("syncing");
          if (saveTimeoutRef.current) {
            window.clearTimeout(saveTimeoutRef.current);
          }
          saveTimeoutRef.current = window.setTimeout(() => {
            activeSaveRequestIdRef.current = null;
            setSaveStatus("error");
            window.setTimeout(() => setSaveStatus("idle"), 2200);
          }, 7000);
        } else {
          if (saveTimeoutRef.current) {
            window.clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
          }
          activeSaveRequestIdRef.current = null;
          setSaveStatus("error");
          window.setTimeout(() => setSaveStatus("idle"), 2200);
        }
      }

      if (event.data?.type === "xiaolou:theme:request") {
        postThemeMessage();
      }

      if (event.data?.type === "xiaolou:theme:toggle") {
        setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
      }

      if (
        event.data?.type === "xiaolou:theme:set" &&
        (event.data.theme === "light" || event.data.theme === "dark")
      ) {
        setTheme(event.data.theme);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [postAuthMessage, postThemeMessage, setTheme, targetOrigin]);

  useEffect(() => {
    const handleProjectSynced = () => {
      if (!activeSaveRequestIdRef.current) return;
      activeSaveRequestIdRef.current = null;
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      setSaveStatus("saved");
      window.setTimeout(() => setSaveStatus("idle"), 2200);
    };

    const handleProjectSyncFailed = () => {
      if (!activeSaveRequestIdRef.current) return;
      activeSaveRequestIdRef.current = null;
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      setSaveStatus("error");
      window.setTimeout(() => setSaveStatus("idle"), 2200);
    };

    window.addEventListener("xiaolou:agent-canvas-project:synced", handleProjectSynced);
    window.addEventListener("xiaolou:agent-canvas-project:sync-failed", handleProjectSyncFailed);
    return () => {
      window.removeEventListener("xiaolou:agent-canvas-project:synced", handleProjectSynced);
      window.removeEventListener("xiaolou:agent-canvas-project:sync-failed", handleProjectSyncFailed);
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background text-foreground">
      <div className="relative min-h-0 flex-1 bg-[#111111]">
        <button
          type="button"
          onClick={requestProjectSave}
          disabled={isLoading || saveStatus === "saving" || saveStatus === "syncing"}
          title={hasCurrentCanvas ? "保存当前 Jaaz 画布项目" : "进入 Jaaz 画布后可保存"}
          className="absolute right-4 top-3 z-20 inline-flex h-9 items-center gap-2 rounded-lg border border-border/70 bg-background/92 px-3 text-sm font-medium text-foreground shadow-lg backdrop-blur-md transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-55"
        >
          {saveStatus === "saving" || saveStatus === "syncing" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : saveStatus === "saved" ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saveButtonLabel}
        </button>
        {isLoading ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/70 backdrop-blur-sm">
            <div className="rounded-xl border border-border bg-card px-5 py-4 text-sm text-muted-foreground shadow-lg">
              <LoaderCircle className="mx-auto mb-3 h-5 w-5 animate-spin text-primary" />
              正在连接 Jaaz
            </div>
          </div>
        ) : null}
        <iframe
          key={iframeRevision}
          ref={iframeRef}
          title="Jaaz"
          src={iframeUrl}
          onLoad={() => {
            setIsLoading(false);
            window.setTimeout(() => {
              postAuthMessage();
              postThemeMessage();
              postCanvasNavigationMessage();
            }, 0);
          }}
          className="h-full w-full border-0"
          allow="clipboard-read; clipboard-write; fullscreen"
        />
      </div>
    </div>
  );
}
