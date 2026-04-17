import { FlaskConical, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTheme } from "../lib/theme";
import { useActorId } from "../lib/actor-session";

const DEFAULT_OPEN_WEBUI_BASE = "/openwebui";
const DEFAULT_OPEN_WEBUI_UPSTREAM = "http://127.0.0.1:8080";
const OPEN_WEBUI_BASE = resolveOpenWebUiBase(
  import.meta.env.VITE_OPEN_WEBUI_URL || DEFAULT_OPEN_WEBUI_BASE,
  import.meta.env.VITE_OPEN_WEBUI_PROXY_TARGET || DEFAULT_OPEN_WEBUI_UPSTREAM,
);
const OPEN_WEBUI_THEME_CHANNEL = "xiaolou.theme";
const IFRAME_LOAD_TIMEOUT_MS = 18_000;
const MAX_AUTO_RETRIES = 2;
const PRE_LOGIN_TIMEOUT_MS = 8_000;
const OWUI_TOKEN_PREFIX = "owui-token:";

function getOwuiCredentials(actorId: string) {
  const email = `${actorId}@xiaolou.local`;
  const password = `xl_${actorId}_owui_2026`;
  const name = actorId === "guest" ? "访客" : actorId;
  return { email, password, name };
}

function getStoredOwuiToken(actorId: string): string | null {
  try { return localStorage.getItem(`${OWUI_TOKEN_PREFIX}${actorId}`) || null; } catch { return null; }
}

function storeOwuiToken(actorId: string, token: string) {
  try {
    localStorage.setItem(`${OWUI_TOKEN_PREFIX}${actorId}`, token);
    localStorage.setItem("token", token);
  } catch {}
}

async function ensureOwuiAuth(actorId: string, signal?: AbortSignal): Promise<string | null> {
  const cached = getStoredOwuiToken(actorId);
  if (cached) {
    localStorage.setItem("token", cached);
    return cached;
  }

  const { email, password, name } = getOwuiCredentials(actorId);
  const headers = { "Content-Type": "application/json" };

  try {
    const signinRes = await fetch(`${OPEN_WEBUI_BASE}/api/v1/auths/signin`, {
      method: "POST", headers, body: JSON.stringify({ email, password }), signal,
    });
    if (signinRes.ok) {
      const data = await signinRes.json();
      if (data?.token) { storeOwuiToken(actorId, data.token); return data.token; }
    }
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
  }

  try {
    const signupRes = await fetch(`${OPEN_WEBUI_BASE}/api/v1/auths/signup`, {
      method: "POST", headers,
      body: JSON.stringify({ email, password, name, profile_image_url: "/user.png" }),
      signal,
    });
    if (signupRes.ok) {
      const data = await signupRes.json();
      if (data?.token) { storeOwuiToken(actorId, data.token); return data.token; }
    }
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
  }

  return null;
}

interface ChatItem {
  id: string;
  title: string;
  updated_at: number;
  created_at: number;
}

const VIEW_MAP: Record<string, string> = {
  "": "/",
  chats: "/",
  search: "/",
  notes: "/notes",
  workspace: "/workspace",
};

function normalizeOpenWebUiBase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_OPEN_WEBUI_BASE;
  const normalized = trimmed.replace(/\/+$/, "");
  return normalized || DEFAULT_OPEN_WEBUI_BASE;
}

function isAbsoluteHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function resolveOpenWebUiBase(configuredBase: string, _configuredProxyTarget: string) {
  return normalizeOpenWebUiBase(configuredBase);
}

function buildOpenWebUiUrl(pathname: string): string {
  if (!pathname || pathname === "/") return `${OPEN_WEBUI_BASE}/`;
  return `${OPEN_WEBUI_BASE}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function getSubpath(pathname: string): string {
  return pathname.replace(/^\/playground\/?/, "") || "";
}

function formatRelativeTime(ts: number): string {
  const now = Date.now() / 1000;
  const diff = now - ts;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(ts * 1000).toLocaleDateString("zh-CN");
}

function resolveOpenWebUiOrigin(): string {
  try {
    return new URL(OPEN_WEBUI_BASE, window.location.origin).origin;
  } catch {
    return window.location.origin;
  }
}

// =====================================================================

export interface PlaygroundProps {
  visible: boolean;
}

export default function Playground({ visible }: PlaygroundProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [theme] = useTheme();
  const actorId = useActorId();

  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const retryCountRef = useRef(0);
  const loadTimerRef = useRef<number>(0);
  const appliedSrcRef = useRef("");
  const preLoginDoneRef = useRef(false);
  const authedActorRef = useRef<string | null>(null);

  const subpath = visible ? getSubpath(location.pathname) : null;
  const showChatPanel = subpath === "chats" || subpath === "search";

  const desiredSrc = !visible
    ? ""
    : showChatPanel
      ? buildOpenWebUiUrl("/")
      : buildOpenWebUiUrl(VIEW_MAP[subpath ?? ""] ?? "/");

  const [chats, setChats] = useState<ChatItem[]>([]);
  const [chatsLoading, setChatsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // ------------------------------------------------------------------
  // Per-actor auth — sign in (or sign up) to Open WebUI as the current
  // XIAOLOU user so chat history is isolated per account.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!visible) return;
    if (isAbsoluteHttpUrl(OPEN_WEBUI_BASE)) return;
    if (authedActorRef.current === actorId) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), PRE_LOGIN_TIMEOUT_MS);

    void ensureOwuiAuth(actorId, controller.signal).then((token) => {
      if (token) {
        authedActorRef.current = actorId;
        preLoginDoneRef.current = true;
      }
    }).finally(() => window.clearTimeout(timeout));

    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [actorId, visible]);

  // Reload iframe when actor changes so Open WebUI picks up the new token
  const prevActorRef = useRef(actorId);
  useEffect(() => {
    if (!visible) return;
    if (prevActorRef.current === actorId) return;
    prevActorRef.current = actorId;
    if (iframeRef.current && appliedSrcRef.current) {
      iframeRef.current.src = appliedSrcRef.current;
      setPhase("loading");
      retryCountRef.current = 0;
    }
  }, [actorId, visible]);

  // ------------------------------------------------------------------
  // Set iframe src imperatively — no React `src` prop on <iframe>,
  // so hiding / showing never accidentally re-triggers a load.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!visible) return;
    if (!desiredSrc || !iframeRef.current) return;
    if (appliedSrcRef.current === desiredSrc) return;
    appliedSrcRef.current = desiredSrc;
    iframeRef.current.src = desiredSrc;
    setPhase("loading");
    retryCountRef.current = 0;
  }, [desiredSrc, visible]);

  // ------------------------------------------------------------------
  // Load timeout — auto-retry (only triggered when iframe actually starts loading)
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!visible) return;
    if (phase !== "loading" || !appliedSrcRef.current) return;
    const timer = window.setTimeout(() => {
      if (retryCountRef.current < MAX_AUTO_RETRIES) {
        retryCountRef.current += 1;
        if (iframeRef.current && appliedSrcRef.current) {
          iframeRef.current.src = appliedSrcRef.current;
        }
      } else {
        setPhase("error");
      }
    }, IFRAME_LOAD_TIMEOUT_MS);
    loadTimerRef.current = timer;
    return () => window.clearTimeout(timer);
  }, [phase, visible]);

  // ------------------------------------------------------------------
  // Chat panel data — fetch using actor-specific token
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!showChatPanel) return;
    setChatsLoading(true);
    const endpoint = searchQuery.trim()
      ? buildOpenWebUiUrl(`/api/v1/chats/search?q=${encodeURIComponent(searchQuery.trim())}`)
      : buildOpenWebUiUrl("/api/v1/chats/");
    const owuiToken = getStoredOwuiToken(actorId);
    const headers: Record<string, string> = {};
    if (owuiToken) headers["Authorization"] = `Bearer ${owuiToken}`;
    fetch(endpoint, { credentials: "include", headers })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((d) => setChats(Array.isArray(d) ? d : d.data ?? []))
      .catch(() => setChats([]))
      .finally(() => setChatsLoading(false));
  }, [showChatPanel, searchQuery, actorId]);

  // ------------------------------------------------------------------
  // Theme sync (only when visible)
  // ------------------------------------------------------------------
  const syncIframeTheme = useCallback(() => {
    const fw = iframeRef.current?.contentWindow;
    if (!fw) return;
    fw.postMessage(
      { channel: OPEN_WEBUI_THEME_CHANNEL, direction: "set", theme },
      resolveOpenWebUiOrigin(),
    );
  }, [theme]);

  useEffect(() => {
    if (!visible) return;
    syncIframeTheme();
    const t = window.setTimeout(syncIframeTheme, 300);
    return () => window.clearTimeout(t);
  }, [visible, syncIframeTheme]);

  // ------------------------------------------------------------------
  // Callbacks
  // ------------------------------------------------------------------
  const navigateIframe = useCallback((chatId: string) => {
    const fw = iframeRef.current?.contentWindow;
    if (!fw) return;
    const targetPath = buildOpenWebUiUrl(`/c/${chatId}`);
    appliedSrcRef.current = targetPath;
    try {
      const link = fw.document.createElement("a");
      link.href = targetPath;
      link.style.display = "none";
      fw.document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      iframeRef.current!.src = targetPath;
      setPhase("loading");
      retryCountRef.current = 0;
    }
  }, []);

  const injectIframeOverrides = useCallback(() => {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return;

      if (!doc.getElementById("xiaolou-owui-overrides")) {
        const style = doc.createElement("style");
        style.id = "xiaolou-owui-overrides";
        style.textContent = `
          img.rounded-full[src*="/api/v1/users/"] { visibility:hidden!important; width:0!important; height:0!important; }
          nav button:has(img.rounded-full),
          .sticky button:has(img.rounded-full),
          header button:has(img.rounded-full),
          [data-melt-dropdown-menu-trigger]:has(img.rounded-full),
          button[aria-label*="User"], button[aria-label*="user"] { display:none!important; }
        `;
        (doc.head || doc.documentElement).appendChild(style);
      }

      if (!doc.getElementById("xiaolou-owui-observer")) {
        const script = doc.createElement("script");
        script.id = "xiaolou-owui-observer";
        script.textContent = `(function(){
          function hide(){
            document.querySelectorAll('img.rounded-full').forEach(function(img){
              if(img.src && img.src.indexOf('/api/v1/users/')!==-1){
                var btn=img.closest('button');
                if(btn) btn.style.display='none';
              }
            });
          }
          hide();
          new MutationObserver(hide).observe(document.body||document.documentElement,{childList:true,subtree:true});
        })();`;
        (doc.head || doc.body || doc.documentElement).appendChild(script);
      }
    } catch {}
  }, []);

  const handleLoad = useCallback(() => {
    if (!appliedSrcRef.current) return;
    window.clearTimeout(loadTimerRef.current);
    retryCountRef.current = 0;
    setPhase("ready");
    syncIframeTheme();
    window.setTimeout(syncIframeTheme, 150);
    injectIframeOverrides();
    window.setTimeout(injectIframeOverrides, 500);
    window.setTimeout(injectIframeOverrides, 2000);
  }, [syncIframeTheme, injectIframeOverrides]);

  const handleError = useCallback(() => {
    if (!appliedSrcRef.current) return;
    window.clearTimeout(loadTimerRef.current);
    setPhase("error");
  }, []);

  const reload = useCallback(() => {
    retryCountRef.current = 0;
    if (iframeRef.current && appliedSrcRef.current) {
      iframeRef.current.src = appliedSrcRef.current;
    }
    setPhase("loading");
  }, []);

  // ------------------------------------------------------------------
  // Only show spinner on very first load (no src applied yet).
  // Once the iframe has a src, let it render immediately — no overlay.
  const showSpinner = visible && phase === "loading" && !appliedSrcRef.current;
  const showError = visible && phase === "error";

  return (
    <div
      className="flex h-full w-full min-h-0 flex-col bg-background"
    >
      <div className="relative flex min-h-0 flex-1">
        {showChatPanel && (
          <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border/50 bg-card/30">
            <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索对话..."
                  className="h-8 w-full rounded-lg border border-border/60 bg-background/50 pl-8 pr-8 text-xs text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-primary/40 focus:ring-1 focus:ring-primary/20"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {chatsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : chats.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                  {searchQuery ? "没有找到匹配的对话" : "暂无对话记录"}
                </div>
              ) : (
                <div className="space-y-0.5 p-1.5">
                  {chats.map((chat) => (
                    <button
                      key={chat.id}
                      type="button"
                      onClick={() => navigateIframe(chat.id)}
                      className="flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent/60"
                    >
                      <span className="truncate text-xs font-medium text-foreground">
                        {chat.title || "未命名对话"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatRelativeTime(chat.updated_at)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-border/50 px-3 py-2">
              <button
                type="button"
                onClick={() => navigate("/playground")}
                className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-primary/10 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
              >
                新对话
              </button>
            </div>
          </aside>
        )}

        <div className="relative min-h-0 flex-1">
          {showSpinner && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}

          {showError && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                <FlaskConical className="h-7 w-7" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Playground 加载超时
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  已尝试 {MAX_AUTO_RETRIES + 1} 次仍无法加载，请检查 Open WebUI 服务是否正常运行。
                </p>
              </div>
              <button
                type="button"
                onClick={reload}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <RefreshCw className="h-4 w-4" />
                重试
              </button>
            </div>
          )}

          <iframe
            ref={iframeRef}
            onLoad={handleLoad}
            onError={handleError}
            title="Open WebUI Playground"
            className="h-full w-full border-0"
            allow="clipboard-read; clipboard-write; microphone"
          />
        </div>
      </div>
    </div>
  );
}
