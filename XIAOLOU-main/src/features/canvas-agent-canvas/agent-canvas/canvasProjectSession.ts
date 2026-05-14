const CANVAS_SESSION_PROJECT_KEY_PREFIX = "xiaolou:agent-canvas-session-project";

function getCanvasSessionProjectKey(actorId: string | null): string {
  return `${CANVAS_SESSION_PROJECT_KEY_PREFIX}:${actorId || "guest"}`;
}

export function readCanvasSessionProjectId(actorId: string | null): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(getCanvasSessionProjectKey(actorId)); } catch { return null; }
}

export function writeCanvasSessionProjectId(actorId: string | null, projectId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const key = getCanvasSessionProjectKey(actorId);
    if (projectId) { window.localStorage.setItem(key, projectId); }
    else { window.localStorage.removeItem(key); }
  } catch { /* ignore storage errors */ }
}

export function readAgentCanvasProjectIdFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  const projectId = params.get("agentCanvasProjectId")?.trim() || params.get("canvasProjectId")?.trim();
  return projectId || null;
}

export function writeAgentCanvasProjectIdToSearch(projectId: string): void {
  if (typeof window === "undefined" || !projectId.trim()) return;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("agentCanvasProjectId") === projectId) {
      return;
    }
    url.searchParams.delete("canvasProjectId");
    url.searchParams.set("agentCanvasProjectId", projectId);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* keep save successful even if URL state cannot be updated */
  }
}
