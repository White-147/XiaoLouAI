import { getCanvasHostServices } from './canvasHostServices';

const XIAOLOU_ACTOR_QUERY_KEY = 'xiaolouActorId';
const XIAOLOU_PROJECT_QUERY_KEY = 'xiaolouProjectId';
const DEFAULT_DRAFT_SCOPE = 'default';

function readQueryParam(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const value = new URLSearchParams(window.location.search).get(key);
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

export function getXiaolouActorId(): string | null {
  // Direct-embed mode: read from host services
  const services = getCanvasHostServices();
  if (services?.actorId) return services.actorId;
  // iframe mode: read from URL query param
  return readQueryParam(XIAOLOU_ACTOR_QUERY_KEY);
}

export function getXiaolouProjectId(): string | null {
  // Direct-embed mode: read from host services
  const services = getCanvasHostServices();
  if (services?.projectId) return services.projectId;
  // iframe mode: read from URL query param
  return readQueryParam(XIAOLOU_PROJECT_QUERY_KEY);
}

export function getXiaolouCanvasDraftStorageKey() {
  return `xiaolou:twitcanva:draft:${getXiaolouActorId() || DEFAULT_DRAFT_SCOPE}`;
}

export function buildXiaolouRequestHeaders(init?: HeadersInit) {
  const headers = new Headers(init);
  const actorId = getXiaolouActorId();
  const projectId = getXiaolouProjectId();

  if (actorId) {
    headers.set('X-Xiaolou-Actor-Id', actorId);
  }

  if (projectId) {
    headers.set('X-Xiaolou-Project-Id', projectId);
  }

  return headers;
}
