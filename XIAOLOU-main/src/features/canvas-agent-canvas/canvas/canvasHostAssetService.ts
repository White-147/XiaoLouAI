import {
  createAsset as apiCreateAsset,
  deleteAsset as apiDeleteAsset,
  listAssets as apiListAssets,
  uploadFile,
} from "./api/canvas";
import type {
  CanvasHostServices,
  HostAssetItem,
} from "./runtime/integrations/canvasHostServices";
import {
  mapCanvasCategoryToAssetType,
  normalizeAssetToBridgeItem,
} from "./canvasAssetBridge";

type CanvasAssetServices = Pick<
  CanvasHostServices,
  | "getAssetContext"
  | "listAssets"
  | "createAsset"
  | "deleteAsset"
  | "uploadMedia"
>;

type HostCreateAssetPayload = {
  assetType?: string;
  name?: string;
  description?: string;
  previewUrl?: string;
  mediaUrl?: string;
  sourceUrl?: string;
  sourceTaskId?: string | null;
  generationPrompt?: string;
  prompt?: string;
  imageModel?: string;
  model?: string;
  scope?: string;
  category?: string;
  mediaKind?: "image" | "video" | "audio";
  aspectRatio?: string;
  resultAspectRatio?: string;
  sourceModule?: string;
};

function normalizeMediaKind(
  mediaKind: HostCreateAssetPayload["mediaKind"],
): "image" | "video" | "audio" {
  return mediaKind === "video" ? "video" : mediaKind === "audio" ? "audio" : "image";
}

function buildCreateAssetRequest(payload: unknown): Parameters<typeof apiCreateAsset>[1] {
  const p = payload as HostCreateAssetPayload;
  const mediaKind = normalizeMediaKind(p.mediaKind);
  const previewUrl = p.previewUrl?.trim() || p.sourceUrl?.trim();
  const mediaUrl = p.mediaUrl?.trim() || p.sourceUrl?.trim() || previewUrl;
  const parts: string[] = ["Saved from canvas"];
  const prompt = (p.generationPrompt || p.prompt || "").trim();
  if (prompt) parts.push(prompt);

  return {
    assetType: p.assetType?.trim() || mapCanvasCategoryToAssetType(p.category, mediaKind),
    name: p.name?.trim() || "Canvas Asset",
    description: parts.join("\n"),
    previewUrl,
    mediaKind,
    mediaUrl,
    sourceTaskId: p.sourceTaskId?.trim() || undefined,
    // Bridge callers (canvas App's ProjectAssetSyncModal) already pin this to
    // "canvas"; keep that but fall back defensively so a stale caller still
    // lands in the canvas bucket on /assets.
    sourceModule: "canvas",
    generationPrompt: prompt || undefined,
    imageModel: mediaKind === "image" ? (p.imageModel?.trim() || p.model?.trim()) : undefined,
    aspectRatio: p.aspectRatio?.trim() || p.resultAspectRatio?.trim().replace("/", ":") || undefined,
    scope: p.scope?.trim() || "manual",
  };
}

export function createCanvasHostAssetService(
  resolveReadyProjectId: () => Promise<string>,
): CanvasAssetServices {
  return {
    async getAssetContext() {
      const readyProjectId = await resolveReadyProjectId();
      return { available: true, projectId: readyProjectId, source: "xiaolou" };
    },

    async listAssets() {
      const readyProjectId = await resolveReadyProjectId();
      const response = await apiListAssets(readyProjectId);
      const items = response.items
        .map(normalizeAssetToBridgeItem)
        .filter((item): item is HostAssetItem => Boolean(item));
      return { projectId: readyProjectId, items };
    },

    async createAsset(payload) {
      const readyProjectId = await resolveReadyProjectId();
      const created = await apiCreateAsset(readyProjectId, buildCreateAssetRequest(payload));
      return normalizeAssetToBridgeItem(created);
    },

    async deleteAsset(id) {
      const readyProjectId = await resolveReadyProjectId();
      await apiDeleteAsset(readyProjectId, id);
    },

    async uploadMedia(file, kind) {
      return uploadFile(file, kind || "canvas-media");
    },
  };
}
