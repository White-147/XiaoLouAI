import type {
  AssetSyncDraft,
} from "../../assets-media-projects/asset-sync/AssetSyncControls";
import { getGeneratedMediaUrl } from "../../assets-media-projects/media/GenerationPlaceholder";
import type { CreateImageResult, Task } from "./api/create-image";

export type ReferenceImageState = {
  id: string;
  url: string;
  originalName: string;
  source: "upload" | "asset";
  assetId?: string | null;
};

export type CreateImageModel = string;
type CreateImageReferenceKind = "jpeg" | "png" | "webp" | "bmp" | "gif";

type LocalReferenceImageMetadata = {
  kind: CreateImageReferenceKind;
  width: number;
  height: number;
  hasTransparencyChannel: boolean;
};

export const MAX_REFERENCE_IMAGES = 4;
const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;
const MIN_REFERENCE_IMAGE_DIMENSION = 240;
const MAX_REFERENCE_IMAGE_DIMENSION = 8000;
export const CREATE_IMAGE_REFERENCE_ACCEPT =
  "image/jpeg,image/png,image/webp,image/bmp,image/x-ms-bmp,.jpg,.jpeg,.png,.webp,.bmp";

// Invalid legacy image model IDs are intentionally excluded from the picker.
// Vertex models use "vertex:" prefix as internalId; labels end with "+" per naming convention.
// Yunwu-routed models keep their original names (no "+" suffix).
export const FALLBACK_IMAGE_MODELS = [
  "doubao-seedream-5-0-260128",
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
  "gemini-2.5-flash-image",
  "vertex:gemini-3-pro-image-preview",
  "vertex:gemini-3.1-flash-image-preview",
] as const;

export const FALLBACK_IMAGE_MODEL_LABELS: Record<string, string> = {
  "doubao-seedream-5-0-260128": "Seedream 5.0 (文/图/多参考)",
  "gemini-3-pro-image-preview": "Gemini 3 Pro",
  "gemini-3.1-flash-image-preview": "Gemini 3.1 Flash",
  "gemini-2.5-flash-image": "Gemini 2.5 Flash",
  // Vertex AI official models — "+" suffix to distinguish from Yunwu-routed variants
  "vertex:gemini-3-pro-image-preview": "Gemini 3 Pro Image+",
  "vertex:gemini-3.1-flash-image-preview": "Gemini 3.1 Flash Image+",
};

export const FALLBACK_IMAGE_RESOLUTIONS = ["1K", "2K", "4K"] as const;
export const IMAGE_PAGE_SIZE = 9;
export const STYLE_OPTIONS = ["电影感", "赛博朋克", "古风写意", "写实摄影"];

const IMAGE_RECENT_TASK_TYPES = new Set([
  "create_image_generate",
  "storyboard_image_generate",
  "asset_image_generate",
  "storyboard_grid25_generate",
  "character_replace",
  "upscale_restore",
]);

export function isImageRecentTask(task: Task) {
  return IMAGE_RECENT_TASK_TYPES.has(task.type);
}

function fileExtension(name: string) {
  const match = /\.([^.]+)$/.exec(name);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function detectCreateImageReferenceKind(
  file: File,
  bytes: Uint8Array,
): CreateImageReferenceKind | null {
  const normalizedType = file.type.toLowerCase();
  if (normalizedType.includes("jpeg")) return "jpeg";
  if (normalizedType.includes("png")) return "png";
  if (normalizedType.includes("webp")) return "webp";
  if (normalizedType.includes("bmp")) return "bmp";
  if (normalizedType.includes("gif")) return "gif";

  const extension = fileExtension(file.name);
  if (extension === ".jpg" || extension === ".jpeg") return "jpeg";
  if (extension === ".png") return "png";
  if (extension === ".webp") return "webp";
  if (extension === ".bmp") return "bmp";
  if (extension === ".gif") return "gif";

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (
    bytes.length >= 6 &&
    (String.fromCharCode(...bytes.slice(0, 6)) === "GIF87a" ||
      String.fromCharCode(...bytes.slice(0, 6)) === "GIF89a")
  ) {
    return "gif";
  }
  if (bytes.length >= 2 && String.fromCharCode(bytes[0], bytes[1]) === "BM") return "bmp";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

function readUInt24LE(bytes: Uint8Array, offset: number) {
  if (offset + 3 > bytes.length) return null;
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function parsePngMetadata(bytes: Uint8Array): LocalReferenceImageMetadata | null {
  if (bytes.length < 33) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const colorType = bytes[25];
  let hasTransparencyChannel = colorType === 4 || colorType === 6;
  let offset = 8;

  while (offset + 12 <= bytes.length) {
    const chunkLength = view.getUint32(offset);
    const chunkType = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    const nextOffset = offset + 12 + chunkLength;
    if (nextOffset > bytes.length) break;
    if (chunkType === "tRNS") {
      hasTransparencyChannel = true;
      break;
    }
    if (chunkType === "IEND") break;
    offset = nextOffset;
  }

  return { kind: "png", width, height, hasTransparencyChannel };
}

function parseJpegMetadata(bytes: Uint8Array): LocalReferenceImageMetadata | null {
  if (bytes.length < 4) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;

  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker >= 0xd0 && marker <= 0xd9) {
      offset += 2;
      continue;
    }
    if (offset + 4 > bytes.length) break;
    const segmentLength = view.getUint16(offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) break;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (offset + 9 > bytes.length) break;
      return {
        kind: "jpeg",
        width: view.getUint16(offset + 7),
        height: view.getUint16(offset + 5),
        hasTransparencyChannel: false,
      };
    }
    offset += 2 + segmentLength;
  }

  return null;
}

function parseWebpMetadata(bytes: Uint8Array): LocalReferenceImageMetadata | null {
  if (bytes.length < 30) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkType = String.fromCharCode(...bytes.slice(12, 16));

  if (chunkType === "VP8X") {
    const widthMinusOne = readUInt24LE(bytes, 24);
    const heightMinusOne = readUInt24LE(bytes, 27);
    if (widthMinusOne == null || heightMinusOne == null) return null;
    return {
      kind: "webp",
      width: widthMinusOne + 1,
      height: heightMinusOne + 1,
      hasTransparencyChannel: false,
    };
  }

  if (chunkType === "VP8L") {
    if (bytes[20] !== 0x2f || bytes.length < 25) return null;
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];
    return {
      kind: "webp",
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      hasTransparencyChannel: false,
    };
  }

  if (chunkType === "VP8 ") {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return {
      kind: "webp",
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
      hasTransparencyChannel: false,
    };
  }

  return null;
}

function parseBmpMetadata(bytes: Uint8Array): LocalReferenceImageMetadata | null {
  if (bytes.length < 26) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dibHeaderSize = view.getUint32(14, true);
  if (dibHeaderSize === 12) {
    return {
      kind: "bmp",
      width: view.getUint16(18, true),
      height: view.getUint16(20, true),
      hasTransparencyChannel: false,
    };
  }
  return {
    kind: "bmp",
    width: Math.abs(view.getInt32(18, true)),
    height: Math.abs(view.getInt32(22, true)),
    hasTransparencyChannel: false,
  };
}

function readLocalReferenceImageMetadata(
  file: File,
  bytes: Uint8Array,
): LocalReferenceImageMetadata | null {
  const kind = detectCreateImageReferenceKind(file, bytes);
  if (!kind) return null;
  if (kind === "png") return parsePngMetadata(bytes);
  if (kind === "jpeg") return parseJpegMetadata(bytes);
  if (kind === "webp") return parseWebpMetadata(bytes);
  if (kind === "bmp") return parseBmpMetadata(bytes);
  if (kind === "gif") return { kind, width: 1, height: 1, hasTransparencyChannel: false };
  return null;
}

export async function validateCreateImageReferenceFile(file: File) {
  if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
    return `${file.name} 超过 10MB，请压缩后再上传。`;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detectCreateImageReferenceKind(file, bytes);
  if (kind === "gif") {
    return `${file.name} 是 GIF 格式，当前仅支持 JPG/JPEG、PNG（不支持透明通道）、WEBP、BMP。`;
  }

  const metadata = readLocalReferenceImageMetadata(file, bytes);
  if (!metadata) {
    return `${file.name} 不是受支持的参考图格式，请上传 JPG/JPEG、PNG、WEBP 或 BMP。`;
  }

  if (metadata.kind === "png" && metadata.hasTransparencyChannel) {
    return `${file.name} 是带透明通道的 PNG，当前参考图模式不建议透明 PNG，请先去除透明背景。`;
  }

  if (
    metadata.width < MIN_REFERENCE_IMAGE_DIMENSION ||
    metadata.width > MAX_REFERENCE_IMAGE_DIMENSION ||
    metadata.height < MIN_REFERENCE_IMAGE_DIMENSION ||
    metadata.height > MAX_REFERENCE_IMAGE_DIMENSION
  ) {
    return `${file.name} 的尺寸为 ${metadata.width}x${metadata.height}，宽高都需要在 240 到 8000 像素之间。`;
  }

  return null;
}

export function resolveEffectiveImageModel(referenceCount: number): string {
  void referenceCount;
  return "doubao-seedream-5-0-260128";
}

export function imageModelHint(referenceCount: number) {
  if (referenceCount > 1) {
    return "已上传多张参考图，推荐使用 Seedream 5.0 进行多参考融合生成。";
  }
  if (referenceCount === 1) {
    return "已上传 1 张参考图，推荐使用 Seedream 5.0 进行图生图。";
  }
  return "推荐使用 Seedream 5.0（火山引擎豆包）进行文生图，支持图生图与多参考生图。";
}

export function resultImage(item: CreateImageResult) {
  return getGeneratedMediaUrl(item.imageUrl);
}

export function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function taskReferenceImages(task: Task) {
  const list = Array.isArray(task.metadata?.referenceImageUrls)
    ? task.metadata.referenceImageUrls.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : [];
  if (list.length) return list.slice(0, MAX_REFERENCE_IMAGES);
  const value = task.metadata?.referenceImageUrl;
  return typeof value === "string" && value.trim() ? [value] : [];
}

export function taskReference(task: Task) {
  return getGeneratedMediaUrl(taskReferenceImages(task)[0]) || null;
}

export function taskModel(task: Task) {
  const value = task.metadata?.model ?? task.metadata?.imageModel;
  return typeof value === "string" && value.trim() ? value : null;
}

export function resultReferenceImages(item: CreateImageResult) {
  const list = Array.isArray(item.referenceImageUrls)
    ? item.referenceImageUrls.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : [];
  if (list.length) {
    return list
      .slice(0, MAX_REFERENCE_IMAGES)
      .map((url) => getGeneratedMediaUrl(url))
      .filter((url): url is string => Boolean(url));
  }
  const fallback = getGeneratedMediaUrl(item.referenceImageUrl);
  return fallback ? [fallback] : [];
}

export function mergeReferenceImages(
  current: ReferenceImageState[],
  incoming: ReferenceImageState[],
) {
  const merged = [...current];

  for (const next of incoming) {
    const duplicateIndex = merged.findIndex(
      (item) => item.url === next.url || (next.assetId && item.assetId === next.assetId),
    );
    if (duplicateIndex >= 0) {
      merged.splice(duplicateIndex, 1);
    }
    merged.push(next);
  }

  return merged.slice(-MAX_REFERENCE_IMAGES);
}

function summarizePrompt(value: string, fallback: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  return normalized.length > 18 ? `${normalized.slice(0, 18)}...` : normalized;
}

export function buildImageAssetDraft(item: CreateImageResult): AssetSyncDraft {
  const imageUrl = resultImage(item);

  return {
    id: item.id,
    mediaKind: "image",
    previewUrl: imageUrl,
    mediaUrl: imageUrl,
    prompt: item.prompt,
    model: item.model,
    aspectRatio: item.aspectRatio,
    taskId: item.taskId ?? null,
    referenceImageUrl: item.referenceImageUrl ?? null,
    defaultAssetType: "style",
    sourceModule: "image_create",
    defaultName: summarizePrompt(item.prompt, `图片素材 ${formatTime(item.createdAt)}`),
    defaultDescription: [
      item.prompt,
      `来源：图片创作`,
      `模型：${item.model}`,
      `风格：${item.style}`,
      `比例：${item.aspectRatio}`,
      `清晰度：${item.resolution}`,
    ].join("\n"),
  };
}
