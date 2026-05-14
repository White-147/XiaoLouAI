import { Image as ImageIcon, Map, Package, Users } from "lucide-react";
import { getGeneratedMediaUrl } from "../media/GenerationPlaceholder";
import type { Asset, AssetSourceModule } from "./api/assets";

export type RootCategory = "image" | "video";
export type CategoryFilter =
  | { root: "image"; assetType: "all" | "character" | "scene" | "prop" | "style" }
  | { root: "video"; sourceModule: "all" | AssetSourceModule };

export const IMAGE_SUBCATS = [
  { id: "all", label: "图片资产", icon: ImageIcon },
  { id: "character", label: "角色", icon: Users },
  { id: "scene", label: "场景", icon: Map },
  { id: "prop", label: "道具", icon: Package },
  { id: "style", label: "风格", icon: ImageIcon },
] as const;

export const VIDEO_SUBCATS: Array<{ id: "all" | AssetSourceModule; label: string }> = [
  { id: "all", label: "全部视频" },
  { id: "video_create", label: "视频创作" },
  { id: "canvas", label: "画布" },
  { id: "video_replace", label: "人物替换" },
];

export const SOURCE_MODULE_LABEL: Record<AssetSourceModule, string> = {
  image_create: "图片创作",
  video_create: "视频创作",
  canvas: "画布",
  video_replace: "人物替换",
  agent_studio: "智能画布",
};

export type AssetFormState = {
  mode: "create" | "edit";
  assetId: string | null;
  rootCategory: RootCategory;
  assetType: string;
  name: string;
  description: string;
  localFile: File | null;
  localFilePreviewUrl: string | null;
};

export const ASSET_UPLOAD_ACCEPT =
  "image/jpeg,image/png,image/webp,image/bmp,image/x-ms-bmp,.jpg,.jpeg,.png,.webp,.bmp,video/*";

export const AGENT_CANVAS_PROJECT_ASSET_TYPE = "agent_canvas_project";

export function assetPreviewUrl(asset: Asset) {
  return getGeneratedMediaUrl(asset.previewUrl);
}

export function assetMediaUrl(asset: Asset) {
  return getGeneratedMediaUrl(asset.mediaUrl) || getGeneratedMediaUrl(asset.previewUrl) || null;
}

export function isVideoAsset(asset: Asset) {
  if (isAgentCanvasProjectAsset(asset)) return false;
  return asset.mediaKind === "video" || asset.assetType === "video_ref";
}

export function isAgentCanvasProjectAsset(asset: Asset) {
  return (
    asset.sourceModule === "agent_studio" &&
    (asset.assetType === AGENT_CANVAS_PROJECT_ASSET_TYPE ||
      asset.mediaKind === AGENT_CANVAS_PROJECT_ASSET_TYPE)
  );
}

export function canPreviewAssetVideo(asset: Asset) {
  return isVideoAsset(asset) && Boolean(getGeneratedMediaUrl(asset.mediaUrl));
}

export function isVideoReplaceAsset(asset: Asset) {
  return asset.sourceModule === "video_replace" && Boolean(asset.sourceTaskId);
}

export function getAgentCanvasProjectMeta(asset: Asset): Record<string, unknown> {
  return asset.sourceMetadata && typeof asset.sourceMetadata === "object"
    ? asset.sourceMetadata
    : {};
}

export function assetMatchesQuery(asset: Asset, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;

  return [
    asset.name,
    asset.description,
    asset.assetType,
    asset.mediaKind,
    asset.sourceModule,
    asset.sourceTaskId,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

export function imageAssetTypeLabel(assetType: string) {
  const match = IMAGE_SUBCATS.find((item) => item.id === assetType);
  return match?.label || assetType;
}

export function videoAssetSubLabel(asset: Asset) {
  const mod = (asset.sourceModule as AssetSourceModule | null) ?? null;
  return mod ? SOURCE_MODULE_LABEL[mod] || mod : "未分组";
}

export type SidebarSection =
  | "assets"
  | "agent-canvas-assets"
  | "legacy-agent-canvas-project-assets"
  | "agent-canvas-projects"
  | "canvas-projects";
