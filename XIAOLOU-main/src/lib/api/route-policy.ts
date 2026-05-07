import { isRetiredLegacyMediaPath } from "../media-url-policy";

export const CONTROL_API_CLIENT_EXACT_PATHS = [
  "/api/accounts/ensure",
  "/api/capabilities",
  "/api/jobs",
  "/api/wallet",
  "/api/wallets",
  "/api/wallet/usage-stats",
  "/api/media/upload-begin",
  "/api/media/upload-complete",
  "/api/media/move-temp-to-permanent",
  "/api/media/signed-read-url",
  "/api/auth/providers",
  "/api/auth/google/exchange",
  "/api/auth/login",
  "/api/auth/admin/login",
  "/api/auth/demo-session",
  "/api/auth/register/personal",
  "/api/auth/register/enterprise-admin",
  "/api/me",
  "/api/api-center",
  "/api/api-center/defaults",
  "/api/admin/pricing-rules",
  "/api/admin/orders",
  "/api/enterprise-applications",
  "/api/playground/config",
  "/api/playground/models",
  "/api/playground/conversations",
  "/api/playground/chat",
  "/api/playground/chat-jobs",
  "/api/playground/memories",
  "/api/playground/memories/preference",
  "/api/toolbox",
  "/api/toolbox/capabilities",
  "/api/toolbox/character-replace",
  "/api/toolbox/motion-transfer",
  "/api/toolbox/upscale-restore",
  "/api/toolbox/video-reverse-prompt",
  "/api/toolbox/storyboard-grid25",
  "/api/toolbox/translate-text",
  "/api/projects",
  "/api/canvas-projects",
  "/api/agent-canvas/projects",
  "/api/create/images",
  "/api/create/videos",
] as const;

export const CONTROL_API_CLIENT_PREFIXES = [
  "/api/jobs/",
  "/api/wallets/",
  "/api/organizations/",
  "/api/api-center/",
  "/api/admin/",
  "/api/enterprise-applications/",
  "/api/playground/",
  "/api/toolbox/",
  "/api/projects/",
  "/api/canvas-projects/",
  "/api/agent-canvas/projects/",
  "/api/create/images/",
  "/api/create/videos/",
] as const;

export const LEGACY_MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

const CONTROL_API_CLIENT_EXACT_PATH_SET = new Set<string>(CONTROL_API_CLIENT_EXACT_PATHS);
const LEGACY_MUTATING_METHOD_SET = new Set<string>(LEGACY_MUTATING_METHODS);

export const ALLOW_LEGACY_MUTATIONS = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_ALLOW_LEGACY_MUTATIONS ?? "").trim().toLowerCase(),
);

export function normalizeRoutePath(path: string) {
  return path.split("?")[0];
}

export function isControlApiClientPath(path: string) {
  const normalizedPath = normalizeRoutePath(path);
  return (
    CONTROL_API_CLIENT_EXACT_PATH_SET.has(normalizedPath) ||
    CONTROL_API_CLIENT_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix))
  );
}

export function getRequestMethod(init?: RequestInit) {
  return String(init?.method ?? "GET").trim().toUpperCase();
}

export function isLegacyMutatingMethod(method: string) {
  return LEGACY_MUTATING_METHOD_SET.has(method);
}

export function isLegacySurfacePath(path: string) {
  const normalizedPath = normalizeRoutePath(path);
  return (
    normalizedPath === "/api" ||
    normalizedPath.startsWith("/api/") ||
    isRetiredLegacyMediaPath(normalizedPath) ||
    normalizedPath === "/jaaz" ||
    normalizedPath.startsWith("/jaaz/") ||
    normalizedPath === "/jaaz-api" ||
    normalizedPath.startsWith("/jaaz-api/")
  );
}

export function shouldBlockLegacyMutatingRequest(
  path: string,
  init?: RequestInit,
  options: { allowLegacyMutations?: boolean } = {},
) {
  const allowLegacyMutations = options.allowLegacyMutations ?? ALLOW_LEGACY_MUTATIONS;
  const method = getRequestMethod(init);
  return (
    !allowLegacyMutations &&
    isLegacyMutatingMethod(method) &&
    !isControlApiClientPath(path) &&
    isLegacySurfacePath(path)
  );
}
