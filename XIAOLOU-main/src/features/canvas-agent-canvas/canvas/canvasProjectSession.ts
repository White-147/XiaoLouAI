const CANVAS_SESSION_PROJECT_KEY_PREFIX = "xiaolou:canvas-session-project";

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
