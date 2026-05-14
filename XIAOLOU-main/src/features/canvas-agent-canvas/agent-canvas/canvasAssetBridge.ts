import type { Asset } from "./api/agent-canvas";
import type { HostAssetItem } from "./runtime/integrations/canvasHostServices";
import { resolveAbsoluteAssetUrl } from "./canvasBridgeMedia";

export function isVideoAsset(asset: Asset) {
  return asset.mediaKind === "video" || asset.assetType === "video_ref";
}

export function isAudioAsset(asset: Asset) {
  return asset.mediaKind === "audio" || asset.assetType === "audio" || asset.assetType === "sound_effect";
}

function mapXiaolouAssetTypeToCategory(assetType: string) {
  switch (assetType) {
    case "character": return "Character";
    case "scene": return "Scene";
    case "prop": return "Item";
    case "style": return "Style";
    case "audio":
    case "sound_effect":
      return "Sound Effect";
    default: return "Others";
  }
}

export function mapCanvasCategoryToAssetType(category: string | undefined, mediaKind: "image" | "video" | "audio") {
  if (mediaKind === "video") return "video_ref";
  if (mediaKind === "audio") return "audio";
  switch ((category || "").trim().toLowerCase()) {
    case "character": return "character";
    case "scene": return "scene";
    case "style": return "style";
    case "sound effect": return "sound_effect";
    default: return "prop";
  }
}

export function normalizeAssetToBridgeItem(asset: Asset): HostAssetItem | null {
  const mediaUrl = resolveAbsoluteAssetUrl(asset.mediaUrl) || resolveAbsoluteAssetUrl(asset.previewUrl);
  if (!mediaUrl) return null;
  const previewUrl = resolveAbsoluteAssetUrl(asset.previewUrl) || mediaUrl;
  return {
    id: asset.id,
    name: asset.name,
    category: mapXiaolouAssetTypeToCategory(asset.assetType),
    url: mediaUrl,
    previewUrl,
    type: isAudioAsset(asset) ? "audio" : isVideoAsset(asset) ? "video" : "image",
    description: asset.description || undefined,
    sourceTaskId: asset.sourceTaskId || undefined,
    generationPrompt: asset.generationPrompt || undefined,
    model: asset.imageModel || undefined,
    aspectRatio: asset.aspectRatio || undefined,
    createdAt: asset.createdAt || undefined,
    updatedAt: asset.updatedAt || undefined,
  };
}
