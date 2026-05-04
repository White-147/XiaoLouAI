import { FlaskConical, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_AGENT_STUDIO_URL = "/create/agent-canvas?embed=xiaolou";
const CHECK_TIMEOUT_MS = 6000;
const IFRAME_LOAD_TIMEOUT_MS = 15000;

type LoadStatus = "checking" | "loading" | "ready" | "error";

function normalizeAgentStudioUrl(value: string | undefined) {
  const trimmed = String(value || "").trim();
  return trimmed || DEFAULT_AGENT_STUDIO_URL;
}

function canPreflight(url: string) {
  try {
    const resolved = new URL(url, window.location.origin);
    return resolved.origin === window.location.origin;
  } catch {
    return false;
  }
}

function isMainAppFallback(html: string) {
  return (
    html.includes("/src/main.tsx") ||
    html.includes("chuangjing-favicon-32.png")
  );
}

export default function AgentStudio() {
  const loadTimerRef = useRef<number>(0);
  const [status, setStatus] = useState<LoadStatus>("checking");
  const [errorText, setErrorText] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const studioUrl = useMemo(
    () => normalizeAgentStudioUrl(import.meta.env.VITE_JAAZ_AGENT_CANVAS_URL),
    [],
  );

  const startLoad = useCallback(() => {
    window.clearTimeout(loadTimerRef.current);
    setStatus("loading");
    setErrorText("");

    loadTimerRef.current = window.setTimeout(() => {
      setStatus("error");
      setErrorText("Agent Studio 页面加载超时，请确认 Jaaz 前端服务是否已启动。");
    }, IFRAME_LOAD_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

    setStatus("checking");
    setErrorText("");

    const run = async () => {
      if (!canPreflight(studioUrl)) {
        if (!cancelled) startLoad();
        return;
      }

      try {
        const response = await fetch(studioUrl, {
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();
        if (isMainAppFallback(html)) {
          throw new Error("Jaaz route fell back to XiaoLou app shell");
        }

        if (!cancelled) startLoad();
      } catch {
        if (!cancelled) {
          setStatus("error");
          setErrorText("Agent Studio 服务暂不可用，请确认原生 agent-canvas 入口或显式配置的外部画布服务已正常启动。");
        }
      } finally {
        window.clearTimeout(timeout);
      }
    };

    void run();

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
      window.clearTimeout(loadTimerRef.current);
    };
  }, [reloadKey, startLoad, studioUrl]);

  const handleLoad = useCallback(() => {
    window.clearTimeout(loadTimerRef.current);
    setStatus("ready");
    setErrorText("");
  }, []);

  const handleRetry = useCallback(() => {
    setReloadKey((current) => current + 1);
  }, []);

  const showOverlay = status === "checking" || status === "loading" || status === "error";

  return (
    <div className="relative h-full min-h-0 flex-1 overflow-hidden bg-background">
      {status !== "error" ? (
        <iframe
          key={reloadKey}
          title="Agent Studio"
          src={status === "loading" || status === "ready" ? studioUrl : undefined}
          onLoad={handleLoad}
          className="h-full w-full border-0"
          allow="clipboard-read; clipboard-write; microphone"
        />
      ) : null}

      {showOverlay ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background px-6 text-center">
          {status === "error" ? (
            <div className="max-w-md rounded-3xl border border-border bg-card p-7 shadow-xl">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                <FlaskConical className="h-7 w-7" />
              </div>
              <h1 className="mt-5 text-base font-semibold text-foreground">
                Agent Studio 暂时无法打开
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {errorText || "请确认 Jaaz 服务是否正在运行，然后重试。"}
              </p>
              <button
                type="button"
                onClick={handleRetry}
                className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                <RefreshCw className="h-4 w-4" />
                重新加载
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span>{status === "checking" ? "正在检查 Agent Studio 服务..." : "正在加载 Agent Studio..."}</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
