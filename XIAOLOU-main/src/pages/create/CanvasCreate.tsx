/**
 * CanvasCreate.tsx — Direct-embed canvas page (no iframe).
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

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  API_BASE_URL,
  createAsset,
  deleteAsset,
  deleteCanvasProject,
  generateCreateImages,
  generateCreateVideos,
  getCanvasProject,
  getCreateImageCapabilities,
  getCreateVideoCapabilities,
  getTask,
  listAssets,
  listCanvasProjects,
  listCreateVideos,
  listCreateImages,
  newIdempotencyKey,
  saveCanvasProject,
  uploadFile,
  type Asset,
} from "../../lib/api";
import { useActorId } from "../../lib/actor-session";
import { useCurrentProjectId } from "../../lib/session";
import { useTheme } from "../../lib/theme";
import { generateGridThumbnail } from "../../lib/grid-thumbnail";
import {
  setCanvasHostServices,
  clearCanvasHostServices,
  clearCanvasProjectLoad,
  notifyCanvasThemeChange,
  notifyCanvasProjectLoad,
  type CanvasHostServices,
  type HostAssetItem,
  type HostCanvasProjectVersionInput,
  type HostFindStrayGenerationRequest,
  type HostRecoverGenerationRequest,
  type HostRecoverGenerationResult,
  type HostSaveWorkflow,
} from "../../canvas/integrations/canvasHostServices";
import {
  defaultCanvasUploadDeps,
  sanitizeCanvasGroupsForPersistence,
  sanitizeCanvasNodesForCloudSave,
  sanitizeCanvasNodesForPersistence,
  sanitizePersistedCanvasString,
} from "../../canvas/utils/canvasPersistence";
import {
  buildCanvasProjectSnapshot,
  mergeCanvasProjectSnapshots,
} from "../../canvas/utils/canvasProjectMerge";
import CanvasApp from "../../canvas/App";

// ─── Polling constants ────────────────────────────────────────────────────────

const CREATE_IMAGE_POLL_INTERVAL_MS = 1500;
const CREATE_IMAGE_TIMEOUT_MS = 300000; // 5 minutes
const CREATE_VIDEO_TIMEOUT_MS = 660000; // 11 minutes

// ─── Helpers shared from original CanvasCreate.tsx ───────────────────────────

function resolveAbsoluteAssetUrl(url?: string | null) {
  const normalized = String(url || "").trim();
  if (!normalized || normalized.includes("mock.assets.local")) return null;
  if (/^(?:data:|blob:)/i.test(normalized)) return normalized;
  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsed = new URL(normalized);
      if (parsed.pathname.startsWith("/uploads/")) return parsed.pathname;
    } catch { /* fall through */ }
    return normalized;
  }
  const apiBaseUrl = API_BASE_URL.replace(/\/+$/, "");
  const resolved = normalized.startsWith("/")
    ? `${apiBaseUrl}${normalized}`
    : `${apiBaseUrl}/${normalized.replace(/^\/+/, "")}`;
  return new URL(resolved, window.location.origin).toString();
}

function isPrivateOrLoopbackHostname(hostname: string) {
  const h = hostname.toLowerCase();
  return (
    h === "127.0.0.1" || h === "localhost" || h === "::1" ||
    h.startsWith("10.") || h.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)
  );
}

function shouldInlineReferenceImageUrl(url: string) {
  if (!url) return false;
  if (/^data:/i.test(url)) return true;
  if (/^blob:/i.test(url)) return true;
  try {
    const parsed = new URL(url);
    if (
      parsed.pathname.startsWith("/canvas-library/") ||
      parsed.pathname.startsWith("/twitcanva-library/") ||
      parsed.pathname.startsWith("/library/") ||
      parsed.pathname.startsWith("/uploads/")
    ) return true;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
    return isPrivateOrLoopbackHostname(parsed.hostname);
  } catch { return true; }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read image."));
    reader.readAsDataURL(blob);
  });
}

async function convertPngBlobToJpeg(blob: Blob): Promise<string> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const image = new Image();
      image.onload = () => res(image);
      image.onerror = () => rej(new Error("Failed to decode PNG."));
      image.src = objectUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create canvas context.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const jpegBlob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => b ? res(b) : rej(new Error("canvas.toBlob failed")), "image/jpeg", 0.92)
    );
    return blobToDataUrl(jpegBlob);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function inlineReferenceImageUrl(url: string): Promise<string> {
  const normalized = String(url || "").trim();
  if (!normalized || !shouldInlineReferenceImageUrl(normalized)) return normalized;
  try {
    const response = await fetch(normalized);
    if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
    const blob = await response.blob();
    const type = (blob.type || "").toLowerCase();
    const isPng = type === "image/png" || normalized.toLowerCase().includes(".png");
    if (isPng) return convertPngBlobToJpeg(blob);
    return blobToDataUrl(blob);
  } catch (err) {
    console.warn("[CanvasCreate] Failed to inline reference image:", err);
    return normalized;
  }
}

function normalizeBridgeVideoMode(mode?: string | null) {
  const normalized = String(mode || "").trim().toLowerCase();
  if (normalized === "frame-to-frame") return "start_end_frame";
  if (normalized === "multi-reference") return "multi_param";
  if (normalized === "image-to-video") return "image_to_video";
  if (normalized === "text-to-video") return "text_to_video";
  return normalized;
}

function normalizeBridgeVideoModeDuration(duration?: number) {
  if (!Number.isFinite(duration)) return undefined;
  return `${Math.max(1, Math.round(Number(duration)))}s`;
}

function normalizeBridgeSelectableValue(value?: string) {
  const v = String(value || "").trim();
  if (!v || v.toLowerCase() === "auto") return undefined;
  return v;
}

function getVideoCapabilityInputMode(videoMode: string) {
  if (videoMode === "image_to_video") return "single_reference";
  if (videoMode === "start_end_frame") return "start_end_frame";
  if (videoMode === "multi_param") return "multi_param";
  return "text_to_video";
}

async function assertCanvasVideoModelReady(model: string, videoMode: string) {
  const modelId = String(model || "").trim();
  if (!modelId) {
    throw new Error("视频生成缺少模型参数，请重新选择视频模型后再生成。");
  }

  let capabilities: Awaited<ReturnType<typeof getCreateVideoCapabilities>>;
  try {
    capabilities = await getCreateVideoCapabilities(videoMode);
  } catch (err) {
    console.warn("[CanvasCreate] Failed to load video capabilities before generation:", err);
    throw new Error("视频模型配置获取失败，请刷新页面或检查模型配置后再生成。");
  }

  const target = capabilities.items.find((item) => item.id === modelId);
  const inputMode = getVideoCapabilityInputMode(videoMode);
  const modeCapability = target?.inputModes?.[inputMode];
  if (!target || !modeCapability || modeCapability.supported === false || target.status === "failing" || modeCapability.status === "failing") {
    throw new Error(`当前视频模型不可用于该生成模式：${modelId} / ${videoMode}。请重新选择可用模型后再生成。`);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isTerminalGenerationLookupError(err: unknown) {
  const anyErr = err as { code?: string; status?: number } | null | undefined;
  const code = String(anyErr?.code || "").trim().toUpperCase();
  const status = typeof anyErr?.status === "number" ? anyErr.status : 0;
  return (
    code === "FORBIDDEN" ||
    code === "UNAUTHORIZED" ||
    code === "NOT_FOUND" ||
    status === 401 ||
    status === 403 ||
    status === 404
  );
}

async function waitForCreateImageResult(taskId: string) {
  const deadline = Date.now() + CREATE_IMAGE_TIMEOUT_MS;
  let lastStatus = "queued";
  while (Date.now() < deadline) {
    let task: Awaited<ReturnType<typeof getTask>>;
    try {
      task = await getTask(taskId);
    } catch (err) {
      if (isTerminalGenerationLookupError(err)) throw err;
      console.warn("[CanvasCreate] waitForCreateImageResult transient getTask failure:", err);
      await sleep(CREATE_IMAGE_POLL_INTERVAL_MS);
      continue;
    }
    lastStatus = task.status || lastStatus;
    if (["failed", "cancelled", "canceled"].includes(task.status)) {
      throw new Error(task.outputSummary || task.currentStage || "图片创作任务失败。");
    }
    try {
      const response = await listCreateImages();
      const matched = response.items.find((item) => item.taskId === taskId);
      const resultUrl = resolveAbsoluteAssetUrl(matched?.imageUrl);
      if (matched && resultUrl) return { resultUrl, model: matched.model };
    } catch (err) {
      if (isTerminalGenerationLookupError(err)) throw err;
      console.warn("[CanvasCreate] waitForCreateImageResult transient listCreateImages failure:", err);
    }
    await sleep(CREATE_IMAGE_POLL_INTERVAL_MS);
  }
  throw new Error(`图片创作结果等待超时，最后状态：${lastStatus}`);
}

async function waitForCreateVideoResult(taskId: string, projectId?: string) {
  const deadline = Date.now() + CREATE_VIDEO_TIMEOUT_MS;
  let lastStatus = "queued";
  let succeededWithoutUrl = 0;
  while (Date.now() < deadline) {
    let task: Awaited<ReturnType<typeof getTask>>;
    try {
      task = await getTask(taskId);
    } catch (err) {
      if (isTerminalGenerationLookupError(err)) throw err;
      console.warn("[CanvasCreate] waitForCreateVideoResult transient getTask failure:", err);
      await sleep(CREATE_IMAGE_POLL_INTERVAL_MS);
      continue;
    }
    lastStatus = task.status || lastStatus;
    if (["failed", "cancelled", "canceled"].includes(task.status)) {
      throw new Error(task.outputSummary || task.currentStage || "视频创作任务失败。");
    }
    let matched:
      | Awaited<ReturnType<typeof listCreateVideos>>["items"][number]
      | undefined;
    try {
      const response = await listCreateVideos();
      matched = response.items.find((item) => item.taskId === taskId);
      const resultUrl = resolveAbsoluteAssetUrl(matched?.videoUrl);
      if (matched && resultUrl) {
        return { resultUrl, previewUrl: resolveAbsoluteAssetUrl(matched.thumbnailUrl) || undefined, model: matched.model };
      }
    } catch (err) {
      if (isTerminalGenerationLookupError(err)) throw err;
      console.warn("[CanvasCreate] waitForCreateVideoResult transient listCreateVideos failure:", err);
    }
    if (projectId) {
      try {
        const assetResponse = await listAssets(projectId, "video_ref");
        const matchedAsset = assetResponse.items.find(
          (a) => String(a.sourceTaskId || "").trim() === taskId,
        );
        const assetUrl =
          resolveAbsoluteAssetUrl(matchedAsset?.mediaUrl) ||
          resolveAbsoluteAssetUrl(matchedAsset?.previewUrl);
        if (matchedAsset && assetUrl) {
          return {
            resultUrl: assetUrl,
            previewUrl: resolveAbsoluteAssetUrl(matchedAsset.previewUrl) || undefined,
            model: matched?.model || matchedAsset.imageModel || undefined,
          };
        }
      } catch (err) {
        if (isTerminalGenerationLookupError(err)) throw err;
        console.warn("[CanvasCreate] waitForCreateVideoResult transient listAssets failure:", err);
      }
    }
    if (task.status === "succeeded" && ++succeededWithoutUrl > 6) {
      throw new Error("视频任务已完成，但未能获取有效视频地址。");
    }
    await sleep(CREATE_IMAGE_POLL_INTERVAL_MS);
  }
  throw new Error(`视频创作结果等待超时，最后状态：${lastStatus}`);
}

// ─── Recovery helpers ─────────────────────────────────────────────────────────
// These are invoked from the canvas `useGenerationRecovery` hook when a LOADING
// node is rehydrated from a saved project. They must NOT throw on the "still
// pending" path — the caller treats any thrown error as "unrecoverable".

/**
 * Translate a `getTask()` failure during LOADING-node recovery into a short
 * Chinese hint that explains the likely cause. This exists because the raw
 * upstream text for the most common failure (HTTP 403 "You do not have access
 * to this task.") is English-only and not actionable on its own — the user
 * just sees it on a red error overlay and can't tell it apart from a real
 * model failure. The backend returns FORBIDDEN here whenever a persisted
 * task id belongs to a different actor, has been reaped, or cannot be
 * retrieved at all, so regenerating is the right advice in every case.
 */
function describeRecoveryLookupError(
  err: unknown,
  kind: "image" | "video",
): string {
  const anyErr = err as { code?: string; status?: number; message?: string } | null | undefined;
  const code = String(anyErr?.code || "").toUpperCase();
  const status = typeof anyErr?.status === "number" ? anyErr.status : 0;
  const rawMessage = String(anyErr?.message || "").trim();
  const kindLabel = kind === "image" ? "图片" : "视频";

  if (code === "FORBIDDEN" || code === "UNAUTHORIZED" || status === 401 || status === 403) {
    return (
      `[${code || "FORBIDDEN"}] 历史${kindLabel}任务已无法访问（可能是跨账户、已被清理或会话已过期）。` +
      `请删除该节点并重新生成。详情：${rawMessage || "You do not have access to this task."}`
    );
  }
  if (code === "NOT_FOUND" || status === 404) {
    return (
      `[${code || "NOT_FOUND"}] 历史${kindLabel}任务记录不存在（可能已被清理或超时）。` +
      `请删除该节点并重新生成。`
    );
  }
  return rawMessage || "无法获取任务状态。";
}

async function recoverImageGeneration(taskId: string): Promise<HostRecoverGenerationResult> {
  let taskStatus: string | undefined;
  try {
    const task = await getTask(taskId);
    taskStatus = task?.status;
    if (["failed", "cancelled", "canceled"].includes(task.status || "")) {
      return {
        status: "failed",
        error: task.outputSummary || task.currentStage || "图片创作任务失败。",
      };
    }
  } catch (err) {
    if (isTerminalGenerationLookupError(err)) {
      return {
        status: "failed",
        error: describeRecoveryLookupError(err, "image"),
      };
    }
    console.warn("[CanvasCreate] recoverImageGeneration transient getTask failure:", err);
    return { status: "pending" };
  }

  try {
    const response = await listCreateImages();
    const matched = response.items.find((item) => item.taskId === taskId);
    const resultUrl = resolveAbsoluteAssetUrl(matched?.imageUrl);
    if (matched && resultUrl) {
      return { status: "succeeded", resultUrl, model: matched.model };
    }
  } catch (err) {
    // Transient — fall through to pending.
  }

  if (taskStatus === "succeeded") {
    // Task says done but no row yet — still pending client-side.
    return { status: "pending" };
  }
  return { status: "pending" };
}

async function recoverVideoGeneration(
  taskId: string,
  projectId?: string | null,
): Promise<HostRecoverGenerationResult> {
  let taskStatus: string | undefined;
  try {
    const task = await getTask(taskId);
    taskStatus = task?.status;
    if (["failed", "cancelled", "canceled"].includes(task.status || "")) {
      return {
        status: "failed",
        error: task.outputSummary || task.currentStage || "视频创作任务失败。",
      };
    }
  } catch (err) {
    if (isTerminalGenerationLookupError(err)) {
      return {
        status: "failed",
        error: describeRecoveryLookupError(err, "video"),
      };
    }
    console.warn("[CanvasCreate] recoverVideoGeneration transient getTask failure:", err);
    return { status: "pending" };
  }

  try {
    const response = await listCreateVideos();
    const matched = response.items.find((item) => item.taskId === taskId);
    const resultUrl = resolveAbsoluteAssetUrl(matched?.videoUrl);
    if (matched && resultUrl) {
      return {
        status: "succeeded",
        resultUrl,
        previewUrl: resolveAbsoluteAssetUrl(matched.thumbnailUrl) || undefined,
        model: matched.model,
      };
    }
  } catch { /* fall through */ }

  if (projectId) {
    try {
      const assetResponse = await listAssets(projectId, "video_ref");
      const matchedAsset = assetResponse.items.find(
        (a) => String(a.sourceTaskId || "").trim() === taskId,
      );
      const assetUrl =
        resolveAbsoluteAssetUrl(matchedAsset?.mediaUrl) ||
        resolveAbsoluteAssetUrl(matchedAsset?.previewUrl);
      if (matchedAsset && assetUrl) {
        return {
          status: "succeeded",
          resultUrl: assetUrl,
          previewUrl: resolveAbsoluteAssetUrl(matchedAsset.previewUrl) || undefined,
          model: matchedAsset.imageModel || undefined,
        };
      }
    } catch { /* fall through */ }
  }

  if (taskStatus === "succeeded") {
    return { status: "pending" };
  }
  return { status: "pending" };
}

function normalizePromptForMatch(value?: string | null): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function findStrayImageResult(
  request: HostFindStrayGenerationRequest,
): Promise<
  | null
  | { resultUrl: string; previewUrl?: string; model?: string; taskId?: string; createdAt?: string }
> {
  const targetPrompt = normalizePromptForMatch(request.prompt);
  const minTs = typeof request.createdAfter === "number" ? request.createdAfter : 0;
  const skip = new Set((request.excludeTaskIds || []).filter(Boolean));
  try {
    const response = await listCreateImages();
    // Newest first.
    const sorted = [...response.items].sort((a, b) => {
      const ta = Date.parse(a.createdAt || "") || 0;
      const tb = Date.parse(b.createdAt || "") || 0;
      return tb - ta;
    });
    for (const item of sorted) {
      if (!item || skip.has(item.taskId)) continue;
      const createdAtMs = Date.parse(item.createdAt || "") || 0;
      if (minTs && createdAtMs < minTs) continue;
      if (targetPrompt && normalizePromptForMatch(item.prompt) !== targetPrompt) continue;
      const resultUrl = resolveAbsoluteAssetUrl(item.imageUrl);
      if (!resultUrl) continue;
      return {
        resultUrl,
        model: item.model,
        taskId: item.taskId,
        createdAt: item.createdAt,
      };
    }
  } catch (err) {
    console.warn("[CanvasCreate] findStrayImageResult failed:", err);
  }
  return null;
}

async function findStrayVideoResult(
  request: HostFindStrayGenerationRequest,
): Promise<
  | null
  | { resultUrl: string; previewUrl?: string; model?: string; taskId?: string; createdAt?: string }
> {
  const targetPrompt = normalizePromptForMatch(request.prompt);
  const minTs = typeof request.createdAfter === "number" ? request.createdAfter : 0;
  const skip = new Set((request.excludeTaskIds || []).filter(Boolean));
  try {
    const response = await listCreateVideos();
    const sorted = [...response.items].sort((a, b) => {
      const ta = Date.parse(a.createdAt || "") || 0;
      const tb = Date.parse(b.createdAt || "") || 0;
      return tb - ta;
    });
    for (const item of sorted) {
      if (!item || skip.has(item.taskId)) continue;
      const createdAtMs = Date.parse(item.createdAt || "") || 0;
      if (minTs && createdAtMs < minTs) continue;
      if (targetPrompt && normalizePromptForMatch(item.prompt) !== targetPrompt) continue;
      const resultUrl = resolveAbsoluteAssetUrl(item.videoUrl);
      if (!resultUrl) continue;
      return {
        resultUrl,
        previewUrl: resolveAbsoluteAssetUrl(item.thumbnailUrl) || undefined,
        model: item.model,
        taskId: item.taskId,
        createdAt: item.createdAt,
      };
    }
  } catch (err) {
    console.warn("[CanvasCreate] findStrayVideoResult failed:", err);
  }
  return null;
}

function isVideoAsset(asset: Asset) {
  return asset.mediaKind === "video" || asset.assetType === "video_ref";
}

function mapXiaolouAssetTypeToCategory(assetType: string) {
  switch (assetType) {
    case "character": return "Character";
    case "scene": return "Scene";
    case "prop": return "Item";
    case "style": return "Style";
    default: return "Others";
  }
}

function mapCanvasCategoryToAssetType(category: string | undefined, mediaKind: "image" | "video") {
  if (mediaKind === "video") return "video_ref";
  switch ((category || "").trim().toLowerCase()) {
    case "character": return "character";
    case "scene": return "scene";
    case "style": return "style";
    default: return "prop";
  }
}

function normalizeAssetToBridgeItem(asset: Asset): HostAssetItem | null {
  const mediaUrl = resolveAbsoluteAssetUrl(asset.mediaUrl) || resolveAbsoluteAssetUrl(asset.previewUrl);
  if (!mediaUrl) return null;
  const previewUrl = resolveAbsoluteAssetUrl(asset.previewUrl) || mediaUrl;
  return {
    id: asset.id,
    name: asset.name,
    category: mapXiaolouAssetTypeToCategory(asset.assetType),
    url: mediaUrl,
    previewUrl,
    type: isVideoAsset(asset) ? "video" : "image",
    description: asset.description || undefined,
    sourceTaskId: asset.sourceTaskId || undefined,
    generationPrompt: asset.generationPrompt || undefined,
    model: asset.imageModel || undefined,
    aspectRatio: asset.aspectRatio || undefined,
    createdAt: asset.createdAt || undefined,
    updatedAt: asset.updatedAt || undefined,
  };
}

// ─── Canvas project ID persistence (prevents duplicate projects on refresh) ───
// Each actor has a single "current draft project ID" stored in localStorage.
// On mount it is restored so auto-saves update the SAME project instead of
// creating new ones (Lovart-style stable projectId approach).

const CANVAS_SESSION_PROJECT_KEY_PREFIX = "xiaolou:canvas-session-project";

function getCanvasSessionProjectKey(actorId: string | null): string {
  return `${CANVAS_SESSION_PROJECT_KEY_PREFIX}:${actorId || "guest"}`;
}

function readCanvasSessionProjectId(actorId: string | null): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(getCanvasSessionProjectKey(actorId)); } catch { return null; }
}

function writeCanvasSessionProjectId(actorId: string | null, projectId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const key = getCanvasSessionProjectKey(actorId);
    if (projectId) { window.localStorage.setItem(key, projectId); }
    else { window.localStorage.removeItem(key); }
  } catch { /* ignore storage errors */ }
}

type CanvasProjectLoadState =
  | { status: "idle" }
  | { status: "syncing" }
  | { status: "loading" }
  | { status: "error"; message: string };

function describeRequestError(error: unknown, fallback: string) {
  const anyError = error as { code?: string; status?: number; message?: string } | null | undefined;
  const code = String(anyError?.code || "").trim().toUpperCase();
  const status = typeof anyError?.status === "number" ? anyError.status : 0;
  const message = String(anyError?.message || "").trim();

  if (message && code && !message.toUpperCase().includes(code)) {
    return `[${code}] ${message}`;
  }
  if (message) {
    return message;
  }
  if (code) {
    return `[${code}] ${fallback}`;
  }
  if (status > 0) {
    return `[HTTP ${status}] ${fallback}`;
  }
  return fallback;
}

function isCanvasSaveConflictError(error: unknown) {
  return error instanceof Error && /409|CONFLICT|updated elsewhere/i.test(error.message);
}

function normalizeCanvasDataForVersion(canvasData: unknown) {
  const raw = canvasData as
    | { nodes?: unknown[]; groups?: unknown[]; viewport?: { x: number; y: number; zoom: number } }
    | null
    | undefined;
  return {
    nodes: sanitizeCanvasNodesForPersistence((raw?.nodes as any) || []),
    groups: sanitizeCanvasGroupsForPersistence((raw?.groups as any) || []),
    viewport: raw?.viewport || { x: 0, y: 0, zoom: 1 },
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CanvasCreate() {
  const actorId = useActorId();
  const [currentProjectId, , currentProjectContext] = useCurrentProjectId();
  const [theme] = useTheme();
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
  // URL project IDs win over localStorage so existing projects never save to a
  // stale session project before the async load completes.
  const canvasProjectIdRef = useRef<string | null>(
    pendingLoadProjectId || readCanvasSessionProjectId(actorId),
  );
  const canvasProjectUpdatedAtRef = useRef<string | null>(null);
  const canvasProjectBaseTitleRef = useRef<string | null>(null);
  const canvasProjectBaseDataRef = useRef<unknown>(null);
  const canvasSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const canvasSaveBlockedRef = useRef(false);
  const canvasSaveConflictAlertedRef = useRef(false);
  const canvasProjectLoadPendingRef = useRef(Boolean(pendingLoadProjectId));
  const pendingCanvasProjectLoadIdRef = useRef<string | null>(pendingLoadProjectId);
  const lastLoadedProjectRequestKeyRef = useRef<string | null>(null);

  const adoptCanvasProjectVersion = (project: HostCanvasProjectVersionInput) => {
    const canvasData = project.canvasData
      ? normalizeCanvasDataForVersion(project.canvasData)
      : (
          Array.isArray(project.nodes) ||
          Array.isArray(project.groups) ||
          project.viewport
        )
        ? normalizeCanvasDataForVersion({
            nodes: project.nodes,
            groups: project.groups,
            viewport: project.viewport,
          })
        : null;

    if (project.id) {
      canvasProjectIdRef.current = project.id;
      writeCanvasSessionProjectId(actorIdRef.current, project.id);
    }
    if (typeof project.updatedAt === "string") {
      canvasProjectUpdatedAtRef.current = project.updatedAt || null;
    }
    if (typeof project.title === "string") {
      canvasProjectBaseTitleRef.current = project.title || null;
    }
    if (canvasData) {
      canvasProjectBaseDataRef.current = canvasData;
    }
    canvasSaveBlockedRef.current = false;
    canvasSaveConflictAlertedRef.current = false;
  };

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

  // ── Build services object (stable via useMemo, closures over mutable refs) ──
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const services = useMemo((): CanvasHostServices => ({
    // Identity — getters always return latest via refs
    get actorId() { return actorIdRef.current; },
    get projectId() { return projectContextReadyRef.current ? projectIdRef.current : null; },

    initialTheme: theme,

      // ── Generation ──────────────────────────────────────────────────────────
      async generateImage(payload) {
        const readyProjectId = await resolveReadyProjectId();
        const referenceImageUrls = await Promise.all(
          (payload.referenceImageUrls || []).filter(Boolean).map(inlineReferenceImageUrl),
        );
        const accepted = await generateCreateImages({
          projectId: readyProjectId,
          assetSyncMode: "manual",
          prompt: payload.prompt?.trim() || "",
          model: payload.model?.trim(),
          aspectRatio: payload.aspectRatio?.trim() || undefined,
          resolution: payload.resolution?.trim() || undefined,
          count: 1,
          referenceImageUrls: referenceImageUrls.filter(Boolean),
          idempotencyKey: newIdempotencyKey(),
        });
        // Notify the caller immediately so it can persist the task id on the
        // canvas node (enables cross-session recovery even if the polling
        // promise below is orphaned by a navigation away or a tab close).
        try { payload.onTaskIdAssigned?.(accepted.taskId); } catch { /* ignore */ }
        const result = await waitForCreateImageResult(accepted.taskId);
        return { ...result, taskId: accepted.taskId };
      },

      async generateVideo(payload) {
        const readyProjectId = await resolveReadyProjectId();
        const requestedMode = normalizeBridgeVideoMode(payload.videoMode);
        const isMultiRef = Array.isArray(payload.multiReferenceImageUrls) && payload.multiReferenceImageUrls.length > 0;
        const isStartEnd =
          requestedMode === "start_end_frame" ||
          (!isMultiRef && Boolean(payload.firstFrameUrl && payload.lastFrameUrl));

        const referenceImageUrl = payload.referenceImageUrl
          ? await inlineReferenceImageUrl(payload.referenceImageUrl)
          : undefined;
        const firstFrameUrl = payload.firstFrameUrl
          ? await inlineReferenceImageUrl(payload.firstFrameUrl)
          : undefined;
        const lastFrameUrl = payload.lastFrameUrl
          ? await inlineReferenceImageUrl(payload.lastFrameUrl)
          : undefined;

        let multiReferenceImages: Record<string, string[]> | undefined;
        if (isMultiRef) {
          const inlined = (await Promise.all(
            payload.multiReferenceImageUrls!.map(inlineReferenceImageUrl),
          )).filter(Boolean) as string[];
          if (inlined.length > 0) {
            const keys = ["scene", "character", "prop", "pose", "expression", "effect", "sketch"];
            multiReferenceImages = {};
            inlined.forEach((url, i) => {
              const key = keys[i % keys.length];
              if (!multiReferenceImages![key]) multiReferenceImages![key] = [];
              multiReferenceImages![key].push(url);
            });
          }
        }

        if (requestedMode === "start_end_frame" && (!firstFrameUrl || !lastFrameUrl)) {
          throw new Error("首尾帧模式要求同时提供首帧和尾帧。");
        }

        const videoMode =
          requestedMode === "multi_param" ? "multi_param" :
          requestedMode === "start_end_frame" ? "start_end_frame" :
          requestedMode === "image_to_video" ? "image_to_video" :
          requestedMode === "text_to_video" ? "text_to_video" :
          isMultiRef ? "multi_param" :
          isStartEnd ? "start_end_frame" :
          referenceImageUrl ? "image_to_video" : "text_to_video";
        const videoModel = payload.model?.trim() || "";
        await assertCanvasVideoModelReady(videoModel, videoMode);

        const accepted = await generateCreateVideos({
          projectId: readyProjectId,
          assetSyncMode: "manual",
          prompt: payload.prompt?.trim() || "",
          model: videoModel,
          duration: normalizeBridgeVideoModeDuration(payload.duration),
          aspectRatio: normalizeBridgeSelectableValue(payload.aspectRatio),
          resolution: normalizeBridgeSelectableValue(payload.resolution),
          referenceImageUrl: (isStartEnd || isMultiRef) ? undefined : referenceImageUrl,
          firstFrameUrl: isStartEnd ? firstFrameUrl : undefined,
          lastFrameUrl: isStartEnd ? lastFrameUrl : undefined,
          multiReferenceImages,
          videoMode,
          generateAudio: payload.generateAudio,
          networkSearch: payload.networkSearch,
          idempotencyKey: newIdempotencyKey(),
        });
        try { payload.onTaskIdAssigned?.(accepted.taskId); } catch { /* ignore */ }
        const result = await waitForCreateVideoResult(accepted.taskId, readyProjectId);
        return { ...result, taskId: accepted.taskId };
      },

      async recoverGeneration(request: HostRecoverGenerationRequest): Promise<HostRecoverGenerationResult> {
        if (request.kind === "image") {
          return recoverImageGeneration(request.taskId);
        }
        const recoveryProjectId = request.projectId ?? await resolveReadyProjectId();
        return recoverVideoGeneration(request.taskId, recoveryProjectId);
      },

      async findStrayGeneration(request: HostFindStrayGenerationRequest) {
        if (request.kind === "image") return findStrayImageResult(request);
        return findStrayVideoResult(request);
      },

      async getImageCapabilities(mode) {
        return getCreateImageCapabilities(mode ?? null);
      },

      async getVideoCapabilities(mode) {
        return getCreateVideoCapabilities(mode ?? "image_to_video");
      },

      // ── Assets ──────────────────────────────────────────────────────────────
      async getAssetContext() {
        const readyProjectId = await resolveReadyProjectId();
        return { available: true, projectId: readyProjectId, source: "xiaolou" };
      },

      async listAssets() {
        const readyProjectId = await resolveReadyProjectId();
        const response = await listAssets(readyProjectId);
        const items = response.items
          .map(normalizeAssetToBridgeItem)
          .filter((item): item is HostAssetItem => Boolean(item));
        return { projectId: readyProjectId, items };
      },

      async createAsset(payload: unknown) {
        const readyProjectId = await resolveReadyProjectId();
        const p = payload as {
          assetType?: string; name?: string; description?: string; previewUrl?: string;
          mediaUrl?: string; sourceUrl?: string; sourceTaskId?: string | null;
          generationPrompt?: string; prompt?: string; imageModel?: string; model?: string;
          scope?: string; category?: string; mediaKind?: "image" | "video";
          aspectRatio?: string; resultAspectRatio?: string;
          sourceModule?: string;
        };
        const mediaKind = p.mediaKind === "video" ? "video" : "image";
        const previewUrl = p.previewUrl?.trim() || p.sourceUrl?.trim();
        const mediaUrl = p.mediaUrl?.trim() || p.sourceUrl?.trim() || previewUrl;
        const parts: string[] = ["Saved from canvas"];
        const prompt = (p.generationPrompt || p.prompt || "").trim();
        if (prompt) parts.push(prompt);
        const created = await createAsset(readyProjectId, {
          assetType: p.assetType?.trim() || mapCanvasCategoryToAssetType(p.category, mediaKind),
          name: p.name?.trim() || "Canvas Asset",
          description: parts.join("\n"),
          previewUrl,
          mediaKind,
          mediaUrl,
          sourceTaskId: p.sourceTaskId?.trim() || undefined,
          // Bridge callers (canvas App's ProjectAssetSyncModal) already pin
          // this to "canvas"; keep that but fall back defensively so a stale
          // caller still lands in the canvas bucket on /assets.
          sourceModule: "canvas",
          generationPrompt: (p.generationPrompt || p.prompt || "").trim() || undefined,
          imageModel: mediaKind === "image" ? (p.imageModel?.trim() || p.model?.trim()) : undefined,
          aspectRatio: p.aspectRatio?.trim() || p.resultAspectRatio?.trim().replace("/", ":") || undefined,
          scope: p.scope?.trim() || "manual",
        });
        return normalizeAssetToBridgeItem(created);
      },

      async deleteAsset(id) {
        const readyProjectId = await resolveReadyProjectId();
        await deleteAsset(readyProjectId, id);
      },

      // ── Canvas projects ─────────────────────────────────────────────────────
      async listProjects() {
        const response = await listCanvasProjects();
        return { items: response.items };
      },

      async loadProject(id) {
        const project = await getCanvasProject(id);
        const raw = project.canvasData as
          | { nodes?: unknown[]; groups?: unknown[]; viewport?: { x: number; y: number; zoom: number } }
          | null;
        // Runtime defence: scrub [truncated:...] / data-URL / garbage strings
        // out of historical snapshots before they hit the canvas renderer.
        const sanitizedNodes = sanitizeCanvasNodesForPersistence((raw?.nodes as any) || []);
        const sanitizedGroups = sanitizeCanvasGroupsForPersistence((raw?.groups as any) || []);
        const sanitizedThumbnail = sanitizePersistedCanvasString(project.thumbnailUrl) ?? null;
        return {
          id: project.id,
          title: project.title,
          thumbnailUrl: sanitizedThumbnail,
          createdAt: project.createdAt || "",
          updatedAt: project.updatedAt || "",
          canvasData: raw
            ? ({
                nodes: sanitizedNodes,
                groups: sanitizedGroups,
                viewport: raw.viewport,
              } as {
                nodes: unknown[];
                groups: unknown[];
                viewport: { x: number; y: number; zoom: number };
              })
            : null,
        };
      },

      async deleteProject(id) {
        await deleteCanvasProject(id);
        return { deleted: true };
      },

      getCanvasProjectVersion() {
        return {
          id: canvasProjectIdRef.current,
          title: canvasProjectBaseTitleRef.current,
          updatedAt: canvasProjectUpdatedAtRef.current,
          canvasData: (canvasProjectBaseDataRef.current as any) || null,
        };
      },

      adoptCanvasProjectVersion(project) {
        adoptCanvasProjectVersion(project);
      },

      // ── Reset (new canvas) ─────────────────────────────────────────────────
      resetProject() {
        canvasProjectIdRef.current = null;
        canvasProjectUpdatedAtRef.current = null;
        canvasProjectBaseTitleRef.current = null;
        canvasProjectBaseDataRef.current = null;
        canvasSaveBlockedRef.current = false;
        canvasSaveConflictAlertedRef.current = false;
        canvasProjectLoadPendingRef.current = false;
        pendingCanvasProjectLoadIdRef.current = null;
        lastLoadedProjectRequestKeyRef.current = null;
        writeCanvasSessionProjectId(actorIdRef.current, null);
        console.log("[CanvasCreate] Canvas project reset (new canvas)");
      },

      // ── Save ────────────────────────────────────────────────────────────────
      saveCanvas(workflow: HostSaveWorkflow, thumbnailImageUrls: string[]) {
        canvasSaveQueueRef.current = canvasSaveQueueRef.current.catch(() => undefined).then(async () => {
          if (canvasSaveBlockedRef.current) return;
          const targetCanvasProjectId =
            pendingCanvasProjectLoadIdRef.current || canvasProjectIdRef.current;
          if (canvasProjectLoadPendingRef.current && targetCanvasProjectId) {
            console.log(
              "[CanvasCreate] Skip canvas save while target project is loading:",
              targetCanvasProjectId,
            );
            return;
          }
          try {
            let thumbnailUrl: string | undefined;
            const thumbUrls = thumbnailImageUrls
              .map(u => resolveAbsoluteAssetUrl(u))
              .filter(Boolean) as string[];
            if (thumbUrls.length > 0) {
              try {
                const blob = await generateGridThumbnail(thumbUrls);
                if (blob) {
                  const file = new File([blob], `canvas-thumb-${Date.now()}.jpg`, { type: "image/jpeg" });
                  const uploaded = await uploadFile(file, "canvas-thumbnail");
                  thumbnailUrl = uploaded.url || uploaded.urlPath;
                }
              } catch (thumbErr) {
                console.warn("[CanvasCreate] Thumbnail generation failed:", thumbErr);
              }
            }
            // Pre-save sanitisation. Step 1: async — upload any still-in-memory
            // data:/blob: URL in node fields so the snapshot never contains
            // multi-MB base64 strings. Step 2: sync — drop any poisoned value
            // that the uploader could not normalise (e.g. [truncated:...]).
            // See canvas/utils/canvasPersistence.ts for field coverage.
            const uploadDeps = await defaultCanvasUploadDeps();
            const asyncCleaned = await sanitizeCanvasNodesForCloudSave(
              (workflow.nodes as any) || [],
              (workflow.groups as any) || [],
              uploadDeps,
            );
            const persistNodes = sanitizeCanvasNodesForPersistence(asyncCleaned.nodes);
            const persistGroups = sanitizeCanvasGroupsForPersistence(asyncCleaned.groups);
            const persistThumbnailUrl = sanitizePersistedCanvasString(thumbnailUrl) ?? undefined;
            const localCanvasData = {
              nodes: persistNodes,
              groups: persistGroups,
              viewport: workflow.viewport,
            };
            let saved;
            let shouldNotifyMergedCanvas = false;
            try {
              saved = await saveCanvasProject({
                id: targetCanvasProjectId || undefined,
                expectedUpdatedAt: canvasProjectUpdatedAtRef.current || undefined,
                baseTitle: canvasProjectBaseTitleRef.current || undefined,
                baseCanvasData: canvasProjectBaseDataRef.current ?? undefined,
                title: workflow.title || "未命名画布项目",
                thumbnailUrl: persistThumbnailUrl,
                canvasData: localCanvasData,
              });
            } catch (saveErr) {
              if (!targetCanvasProjectId || !isCanvasSaveConflictError(saveErr)) {
                throw saveErr;
              }

              const remoteProject = await getCanvasProject(targetCanvasProjectId);
              const remoteCanvasData = normalizeCanvasDataForVersion(remoteProject.canvasData);
              const baseCanvasData = normalizeCanvasDataForVersion(canvasProjectBaseDataRef.current);
              const mergedSnapshot = mergeCanvasProjectSnapshots(
                buildCanvasProjectSnapshot({
                  title: canvasProjectBaseTitleRef.current || remoteProject.title,
                  nodes: baseCanvasData.nodes,
                  groups: baseCanvasData.groups,
                  viewport: baseCanvasData.viewport,
                }),
                buildCanvasProjectSnapshot({
                  title: workflow.title || "Untitled",
                  nodes: persistNodes,
                  groups: persistGroups,
                  viewport: workflow.viewport,
                }),
                buildCanvasProjectSnapshot({
                  title: remoteProject.title,
                  nodes: remoteCanvasData.nodes,
                  groups: remoteCanvasData.groups,
                  viewport: remoteCanvasData.viewport,
                }),
              );

              localCanvasData.nodes = mergedSnapshot.nodes;
              localCanvasData.groups = mergedSnapshot.groups;
              localCanvasData.viewport = mergedSnapshot.viewport;
              shouldNotifyMergedCanvas = true;

              saved = await saveCanvasProject({
                id: targetCanvasProjectId,
                expectedUpdatedAt: remoteProject.updatedAt || undefined,
                baseTitle: remoteProject.title || undefined,
                baseCanvasData: remoteCanvasData,
                title: mergedSnapshot.title || "Untitled",
                thumbnailUrl: persistThumbnailUrl,
                canvasData: localCanvasData,
              });
            }
            canvasProjectIdRef.current = saved.id;
            canvasProjectUpdatedAtRef.current = saved.updatedAt || null;
            canvasProjectBaseTitleRef.current = saved.title || null;
            canvasProjectBaseDataRef.current = saved.canvasData ?? null;
            canvasSaveBlockedRef.current = false;
            canvasSaveConflictAlertedRef.current = false;
            // Persist so next mount re-uses the same project (no duplicate creation)
            writeCanvasSessionProjectId(actorIdRef.current, saved.id);
            if (shouldNotifyMergedCanvas) {
              const savedCanvasData = normalizeCanvasDataForVersion(saved.canvasData || localCanvasData);
              notifyCanvasProjectLoad({
                id: saved.id,
                title: saved.title,
                updatedAt: saved.updatedAt || undefined,
                nodes: savedCanvasData.nodes,
                groups: savedCanvasData.groups,
                viewport: savedCanvasData.viewport,
              });
            }
            console.log("[CanvasCreate] Canvas project saved:", saved.id);
          } catch (err) {
            if (isCanvasSaveConflictError(err)) {
              canvasSaveBlockedRef.current = true;
              if (!canvasSaveConflictAlertedRef.current) {
                canvasSaveConflictAlertedRef.current = true;
                window.alert(
                  "当前画布项目已在其他页面更新，且本地修改无法安全自动合并。为避免覆盖最新内容，已暂停自动保存。请刷新后再继续操作。",
                );
              }
              throw err;
            }
            console.warn("[CanvasCreate] Failed to save canvas project:", err);
            throw err;
          }
        });
        return canvasSaveQueueRef.current;
      },
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

  // ── Handle pending project load from URL (?canvasProjectId=) ─────────────
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

    if (!currentProjectContext.isReady) {
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
  }, [actorId, canvasProjectLoadAttempt, currentProjectContext.isReady, pendingLoadProjectId, pendingLoadRequestKey]);

  // NOTE: The one-time empty-project cleanup that previously ran here has been
  // removed. It was a destructive side-effect (deleting user projects on mount)
  // that risked data loss for legitimately-empty or newly-created drafts.
  // The stable-ID save mechanism (canvasProjectIdRef + localStorage) now
  // prevents duplicate creation in the first place, making the cleanup
  // unnecessary and unsafe to run automatically.

  const isCanvasProjectReadyToRender =
    !pendingLoadProjectId ||
    (canvasProjectLoadState.status === "idle" &&
      lastLoadedProjectRequestKeyRef.current === pendingLoadRequestKey);
  const canvasProjectLoadDisplayStatus =
    canvasProjectLoadState.status === "idle" ? "loading" : canvasProjectLoadState.status;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    // data-testid gives the canvas-not-mounted verification script a stable
    // hook to prove the component is (or isn't) in the DOM — previously the
    // check relied on guessing a CSS class and silently passed.
    <div
      data-testid="canvas-create-root"
      className="relative h-full w-full overflow-hidden bg-[#050505]"
    >
      {isCanvasProjectReadyToRender ? <CanvasApp /> : null}
      {!isCanvasProjectReadyToRender ? (
        <div className="pointer-events-auto absolute inset-0 z-[120] flex items-center justify-center bg-black/48 px-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/12 bg-[#111111]/92 p-6 text-white shadow-2xl">
            <div className="text-sm font-semibold tracking-[0.24em] text-white/55">
              CANVAS
            </div>
            <div className="mt-3 text-2xl font-semibold">
              {canvasProjectLoadDisplayStatus === "syncing"
                ? "正在同步当前账号项目上下文"
                : canvasProjectLoadDisplayStatus === "loading"
                  ? "正在加载画布项目"
                  : "画布项目加载失败"}
            </div>
            <p className="mt-3 text-sm leading-6 text-white/70">
              {canvasProjectLoadDisplayStatus === "syncing"
                ? "正在校准当前账号可访问的项目范围，完成后会自动加载目标画布。"
                : canvasProjectLoadDisplayStatus === "loading"
                  ? "目标项目已定位，正在恢复节点和视口状态。"
                  : canvasProjectLoadState.status === "error"
                    ? canvasProjectLoadState.message
                    : "目标项目已定位，正在恢复节点和视口状态。"}
            </p>
            {canvasProjectLoadState.status === "error" ? (
              <div className="mt-5 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setCanvasProjectLoadAttempt((count) => count + 1)}
                  className="inline-flex items-center justify-center rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/90"
                >
                  重试加载
                </button>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="inline-flex items-center justify-center rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white/80 transition hover:border-white/35 hover:text-white"
                >
                  刷新当前页
                </button>
              </div>
            ) : (
              <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-white/70" />
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
