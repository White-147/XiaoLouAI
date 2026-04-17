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

import { useEffect, useMemo, useRef } from "react";
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
  notifyCanvasThemeChange,
  notifyCanvasProjectLoad,
  type CanvasHostServices,
  type HostAssetItem,
  type HostSaveWorkflow,
} from "@canvas/integrations/canvasHostServices";
import CanvasApp from "@canvas/App";

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

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForCreateImageResult(taskId: string) {
  const deadline = Date.now() + CREATE_IMAGE_TIMEOUT_MS;
  let lastStatus = "queued";
  while (Date.now() < deadline) {
    const task = await getTask(taskId);
    lastStatus = task.status || lastStatus;
    if (["failed", "cancelled", "canceled"].includes(task.status)) {
      throw new Error(task.outputSummary || task.currentStage || "图片创作任务失败。");
    }
    const response = await listCreateImages();
    const matched = response.items.find((item) => item.taskId === taskId);
    const resultUrl = resolveAbsoluteAssetUrl(matched?.imageUrl);
    if (matched && resultUrl) return { resultUrl, model: matched.model };
    await sleep(CREATE_IMAGE_POLL_INTERVAL_MS);
  }
  throw new Error(`图片创作结果等待超时，最后状态：${lastStatus}`);
}

async function waitForCreateVideoResult(taskId: string, projectId?: string) {
  const deadline = Date.now() + CREATE_VIDEO_TIMEOUT_MS;
  let lastStatus = "queued";
  let succeededWithoutUrl = 0;
  while (Date.now() < deadline) {
    const task = await getTask(taskId);
    lastStatus = task.status || lastStatus;
    if (["failed", "cancelled", "canceled"].includes(task.status)) {
      throw new Error(task.outputSummary || task.currentStage || "视频创作任务失败。");
    }
    const response = await listCreateVideos();
    const matched = response.items.find((item) => item.taskId === taskId);
    const resultUrl = resolveAbsoluteAssetUrl(matched?.videoUrl);
    if (matched && resultUrl) {
      return { resultUrl, previewUrl: resolveAbsoluteAssetUrl(matched.thumbnailUrl) || undefined, model: matched.model };
    }
    if (projectId) {
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
    }
    if (task.status === "succeeded" && ++succeededWithoutUrl > 6) {
      throw new Error("视频任务已完成，但未能获取有效视频地址。");
    }
    await sleep(CREATE_IMAGE_POLL_INTERVAL_MS);
  }
  throw new Error(`视频创作结果等待超时，最后状态：${lastStatus}`);
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function CanvasCreate() {
  const actorId = useActorId();
  const [currentProjectId] = useCurrentProjectId();
  const [theme] = useTheme();
  const location = useLocation();

  // ── Mutable refs so service closures always see the latest values ──────────
  const actorIdRef = useRef(actorId);
  const projectIdRef = useRef(currentProjectId);
  useEffect(() => { actorIdRef.current = actorId; }, [actorId]);
  useEffect(() => { projectIdRef.current = currentProjectId; }, [currentProjectId]);

  // ── Save-state refs ────────────────────────────────────────────────────────
  // canvasProjectIdRef is pre-seeded from localStorage so the same project is
  // updated across refreshes (prevents duplicate project creation).
  const canvasProjectIdRef = useRef<string | null>(readCanvasSessionProjectId(actorId));
  const canvasProjectUpdatedAtRef = useRef<string | null>(null);
  const canvasProjectBaseTitleRef = useRef<string | null>(null);
  const canvasProjectBaseDataRef = useRef<unknown>(null);
  const canvasSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const canvasSaveBlockedRef = useRef(false);
  const canvasSaveConflictAlertedRef = useRef(false);

  // ── Build services object (stable via useMemo, closures over mutable refs) ──
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const services = useMemo((): CanvasHostServices => ({
    // Identity — getters always return latest via refs
    get actorId() { return actorIdRef.current; },
    get projectId() { return projectIdRef.current; },

    initialTheme: theme,

      // ── Generation ──────────────────────────────────────────────────────────
      async generateImage(payload) {
        const referenceImageUrls = await Promise.all(
          (payload.referenceImageUrls || []).filter(Boolean).map(inlineReferenceImageUrl),
        );
        const accepted = await generateCreateImages({
          projectId: projectIdRef.current,
          assetSyncMode: "manual",
          prompt: payload.prompt?.trim() || "",
          model: payload.model?.trim(),
          aspectRatio: payload.aspectRatio?.trim() || undefined,
          resolution: payload.resolution?.trim() || undefined,
          count: 1,
          referenceImageUrls: referenceImageUrls.filter(Boolean),
        });
        return waitForCreateImageResult(accepted.taskId);
      },

      async generateVideo(payload) {
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

        const accepted = await generateCreateVideos({
          projectId: projectIdRef.current,
          assetSyncMode: "manual",
          prompt: payload.prompt?.trim() || "",
          model: payload.model?.trim(),
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
        });
        return waitForCreateVideoResult(accepted.taskId, projectIdRef.current);
      },

      async getImageCapabilities(mode) {
        return getCreateImageCapabilities(mode ?? null);
      },

      async getVideoCapabilities(mode) {
        return getCreateVideoCapabilities(mode ?? "image_to_video");
      },

      // ── Assets ──────────────────────────────────────────────────────────────
      async getAssetContext() {
        return { available: true, projectId: projectIdRef.current, source: "xiaolou" };
      },

      async listAssets() {
        const response = await listAssets(projectIdRef.current);
        const items = response.items
          .map(normalizeAssetToBridgeItem)
          .filter((item): item is HostAssetItem => Boolean(item));
        return { projectId: projectIdRef.current, items };
      },

      async createAsset(payload: unknown) {
        const p = payload as {
          assetType?: string; name?: string; description?: string; previewUrl?: string;
          mediaUrl?: string; sourceUrl?: string; sourceTaskId?: string | null;
          generationPrompt?: string; prompt?: string; imageModel?: string; model?: string;
          scope?: string; category?: string; mediaKind?: "image" | "video";
          aspectRatio?: string; resultAspectRatio?: string;
        };
        const mediaKind = p.mediaKind === "video" ? "video" : "image";
        const previewUrl = p.previewUrl?.trim() || p.sourceUrl?.trim();
        const mediaUrl = p.mediaUrl?.trim() || p.sourceUrl?.trim() || previewUrl;
        const parts: string[] = ["Saved from canvas"];
        const prompt = (p.generationPrompt || p.prompt || "").trim();
        if (prompt) parts.push(prompt);
        const created = await createAsset(projectIdRef.current, {
          assetType: p.assetType?.trim() || mapCanvasCategoryToAssetType(p.category, mediaKind),
          name: p.name?.trim() || "Canvas Asset",
          description: parts.join("\n"),
          previewUrl,
          mediaKind,
          mediaUrl,
          sourceTaskId: p.sourceTaskId?.trim() || undefined,
          generationPrompt: (p.generationPrompt || p.prompt || "").trim() || undefined,
          imageModel: mediaKind === "image" ? (p.imageModel?.trim() || p.model?.trim()) : undefined,
          aspectRatio: p.aspectRatio?.trim() || p.resultAspectRatio?.trim().replace("/", ":") || undefined,
          scope: p.scope?.trim() || "manual",
        });
        return normalizeAssetToBridgeItem(created);
      },

      async deleteAsset(id) {
        await deleteAsset(projectIdRef.current, id);
      },

      // ── Canvas projects ─────────────────────────────────────────────────────
      async listProjects() {
        const response = await listCanvasProjects();
        return { items: response.items };
      },

      async loadProject(id) {
        const project = await getCanvasProject(id);
        return {
          id: project.id,
          title: project.title,
          thumbnailUrl: project.thumbnailUrl ?? null,
          createdAt: project.createdAt || "",
          updatedAt: project.updatedAt || "",
          canvasData: project.canvasData as {
            nodes: unknown[];
            groups: unknown[];
            viewport: { x: number; y: number; zoom: number };
          } | null,
        };
      },

      async deleteProject(id) {
        await deleteCanvasProject(id);
        return { deleted: true };
      },

      // ── Reset (new canvas) ─────────────────────────────────────────────────
      resetProject() {
        canvasProjectIdRef.current = null;
        canvasProjectUpdatedAtRef.current = null;
        canvasProjectBaseTitleRef.current = null;
        canvasProjectBaseDataRef.current = null;
        canvasSaveBlockedRef.current = false;
        canvasSaveConflictAlertedRef.current = false;
        writeCanvasSessionProjectId(actorIdRef.current, null);
        console.log("[CanvasCreate] Canvas project reset (new canvas)");
      },

      // ── Save ────────────────────────────────────────────────────────────────
      saveCanvas(workflow: HostSaveWorkflow, thumbnailImageUrls: string[]) {
        canvasSaveQueueRef.current = canvasSaveQueueRef.current.then(async () => {
          if (canvasSaveBlockedRef.current) return;
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
            const saved = await saveCanvasProject({
              id: canvasProjectIdRef.current || undefined,
              expectedUpdatedAt: canvasProjectUpdatedAtRef.current || undefined,
              baseTitle: canvasProjectBaseTitleRef.current || undefined,
              baseCanvasData: canvasProjectBaseDataRef.current ?? undefined,
              title: workflow.title || "未命名画布项目",
              thumbnailUrl,
              canvasData: {
                nodes: workflow.nodes,
                groups: workflow.groups,
                viewport: workflow.viewport,
              },
            });
            canvasProjectIdRef.current = saved.id;
            canvasProjectUpdatedAtRef.current = saved.updatedAt || null;
            canvasProjectBaseTitleRef.current = saved.title || null;
            canvasProjectBaseDataRef.current = saved.canvasData ?? null;
            canvasSaveBlockedRef.current = false;
            canvasSaveConflictAlertedRef.current = false;
            // Persist so next mount re-uses the same project (no duplicate creation)
            writeCanvasSessionProjectId(actorIdRef.current, saved.id);
            console.log("[CanvasCreate] Canvas project saved:", saved.id);
          } catch (err) {
            if (err instanceof Error && /409|CONFLICT|updated elsewhere/i.test(err.message)) {
              canvasSaveBlockedRef.current = true;
              if (!canvasSaveConflictAlertedRef.current) {
                canvasSaveConflictAlertedRef.current = true;
                window.alert(
                  "当前画布项目已在其他页面更新，且本地修改无法安全自动合并。为避免覆盖最新内容，已暂停自动保存。请刷新后再继续操作。",
                );
              }
              return;
            }
            console.warn("[CanvasCreate] Failed to save canvas project:", err);
          }
        });
        return canvasSaveQueueRef.current;
      },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []); // Empty deps: all captures are via mutable refs

  // Register services SYNCHRONOUSLY in render so CanvasApp sees them on first render.
  // (Module-level write is safe: only one canvas instance is mounted at a time.)
  setCanvasHostServices(services);

  // Unregister on unmount
  useEffect(() => () => { clearCanvasHostServices(); }, []);

  // ── Sync theme changes to canvas ──────────────────────────────────────────
  useEffect(() => {
    notifyCanvasThemeChange(theme);
  }, [theme]);

  // ── Handle pending project load from URL (?canvasProjectId=) ─────────────
  const pendingLoadProjectId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("canvasProjectId") || null;
  }, [location.search]);

  const lastLoadedProjectIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingLoadProjectId) return;
    if (lastLoadedProjectIdRef.current === pendingLoadProjectId) return;

    let cancelled = false;
    (async () => {
      try {
        const project = await getCanvasProject(pendingLoadProjectId);
        if (cancelled) return;
        const canvasData = project.canvasData as {
          nodes?: unknown[]; groups?: unknown[];
          viewport?: { x: number; y: number; zoom: number };
        } | null;
        notifyCanvasProjectLoad({
          id: project.id,
          title: project.title,
          nodes: canvasData?.nodes || [],
          groups: canvasData?.groups || [],
          viewport: canvasData?.viewport,
        });
        lastLoadedProjectIdRef.current = pendingLoadProjectId;
        canvasProjectIdRef.current = project.id;
        canvasProjectUpdatedAtRef.current = project.updatedAt || null;
        canvasProjectBaseTitleRef.current = project.title || null;
        canvasProjectBaseDataRef.current = project.canvasData ?? null;
        canvasSaveBlockedRef.current = false;
        canvasSaveConflictAlertedRef.current = false;
        // Update session so subsequent saves update THIS project
        writeCanvasSessionProjectId(actorId, project.id);
      } catch (err) {
        console.warn("[CanvasCreate] Failed to load canvas project:", err);
      }
    })();

    return () => { cancelled = true; };
  }, [pendingLoadProjectId]);

  // NOTE: The one-time empty-project cleanup that previously ran here has been
  // removed. It was a destructive side-effect (deleting user projects on mount)
  // that risked data loss for legitimately-empty or newly-created drafts.
  // The stable-ID save mechanism (canvasProjectIdRef + localStorage) now
  // prevents duplicate creation in the first place, making the cleanup
  // unnecessary and unsafe to run automatically.

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#050505]">
      <CanvasApp />
    </div>
  );
}
