import {
  Clock3,
  Download,
  Layers,
  LoaderCircle,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { type ChangeEvent, type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AssetSyncDialog,
  AssetSyncDropzone,
  type AssetSyncDraft,
} from "../../components/create/AssetSyncControls";
import { CreateStudioSplitLayout } from "../../components/create/CreateStudioSplitLayout";
import {
  REFERENCE_ASSET_MIME,
  ReferenceAssetPicker,
  type ReferenceAssetSelection,
} from "../../components/create/ReferenceAssetPicker";
import {
  GeneratedMediaPlaceholder,
  getGeneratedMediaUrl,
} from "../../components/media/GenerationPlaceholder";
import { downloadMediaFile, guessMediaFilename } from "../../lib/download-media";
import { parseGenerationError } from "../../lib/generation-error";
import {
  formatTaskStatusLabel,
  getTaskFailureReason,
  getTaskStatusPillClass,
} from "../../lib/task-status";
import { prepareReferenceUploadFile } from "../../lib/prepare-reference-upload";
import { useActorId } from "../../lib/actor-session";
import { cn } from "../../lib/utils";
import {
  clearTasks,
  createAsset,
  deleteTask,
  deleteCreateVideo,
  getTask,
  getCreateVideoCapabilities,
  generateCreateVideos,
  listCreateVideos,
  listTasks,
  newIdempotencyKey,
  uploadFile,
  type MediaModelCapability,
  type MediaCapabilitySet,
  type VideoInputMode,
  type MediaModelStatus,
  type CreateVideoResult,
  type Task,
  type VideoMultiReferenceImages,
  type VideoMultiReferenceKey,
  type VideoGenerationMode,
} from "../../lib/api";
import { useCurrentProjectId } from "../../lib/session";

type ReferenceImageState = {
  id: string;
  url: string;
  originalName: string;
  source: "upload" | "asset";
  assetId?: string | null;
};

function multiReferenceUrls(value?: string | string[] | null) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? [normalized] : [];
}

function resultCover(item: CreateVideoResult) {
  return getGeneratedMediaUrl(item.thumbnailUrl);
}

function playableVideoUrl(item: CreateVideoResult) {
  return getGeneratedMediaUrl(item.videoUrl);
}

function resultReferenceUrl(url?: string | null) {
  return getGeneratedMediaUrl(url);
}

function resultMultiReferenceUrl(
  item: Pick<CreateVideoResult, "multiReferenceImages">,
  key: VideoMultiReferenceKey,
) {
  return getGeneratedMediaUrl(multiReferenceUrls(item.multiReferenceImages?.[key])[0]);
}

function displayedResolution(item: Pick<CreateVideoResult, "outputResolution" | "resolution">) {
  return item.outputResolution || item.resolution;
}

type VideoOutputMetadata = {
  outputDuration?: string | null;
  outputAspectRatio?: string | null;
  posterUrl?: string | null;
};

function displayedDuration(
  item: Pick<CreateVideoResult, "duration" | "outputDuration">,
  metadata?: VideoOutputMetadata | null,
) {
  return metadata?.outputDuration || item.outputDuration || item.duration;
}

function displayedAspectRatio(
  item: Pick<CreateVideoResult, "aspectRatio" | "outputAspectRatio">,
  metadata?: VideoOutputMetadata | null,
) {
  return metadata?.outputAspectRatio || item.outputAspectRatio || item.aspectRatio;
}

function formatOutputDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return `${Math.max(1, Math.round(seconds))}s`;
}

function formatOutputAspectRatio(width: number, height: number) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return null;
  const ratio = width / height;
  const knownRatios = [
    { label: "16:9", value: 16 / 9 },
    { label: "9:16", value: 9 / 16 },
    { label: "1:1", value: 1 },
    { label: "4:3", value: 4 / 3 },
    { label: "3:4", value: 3 / 4 },
    { label: "3:2", value: 3 / 2 },
    { label: "2:3", value: 2 / 3 },
  ];

  let bestLabel: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of knownRatios) {
    const distance = Math.abs(ratio - candidate.value);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestLabel = candidate.label;
    }
  }
  return bestLabel && bestDistance <= 0.05 ? bestLabel : `${Math.round(width)}:${Math.round(height)}`;
}

const videoOutputMetadataCache = new Map<string, VideoOutputMetadata>();
const videoOutputMetadataInflight = new Map<string, Promise<VideoOutputMetadata>>();

function derivedResultCover(
  item: CreateVideoResult,
  metadata?: Pick<VideoOutputMetadata, "posterUrl"> | null,
) {
  return metadata?.posterUrl || resultCover(item);
}

function readVideoOutputMetadata(url: string) {
  if (videoOutputMetadataCache.has(url)) {
    return Promise.resolve(videoOutputMetadataCache.get(url) || {});
  }
  if (videoOutputMetadataInflight.has(url)) {
    return videoOutputMetadataInflight.get(url) || Promise.resolve({});
  }

  const promise = new Promise<VideoOutputMetadata>((resolve) => {
    const video = document.createElement("video");
    let settled = false;
    const buildMetadata = () => {
      const metadata: VideoOutputMetadata = {
        outputDuration: formatOutputDuration(video.duration),
        outputAspectRatio: formatOutputAspectRatio(video.videoWidth, video.videoHeight),
      };
      try {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          if (context) {
            context.drawImage(video, 0, 0, width, height);
            metadata.posterUrl = canvas.toDataURL("image/jpeg", 0.92);
          }
        }
      } catch {}
      return metadata;
    };
    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
      videoOutputMetadataInflight.delete(url);
    };
    const settle = (metadata: VideoOutputMetadata) => {
      if (settled) return;
      settled = true;
      videoOutputMetadataCache.set(url, metadata);
      cleanup();
      resolve(metadata);
    };
    video.preload = "metadata";
    video.crossOrigin = "anonymous";
    video.onloadeddata = () => {
      settle(buildMetadata());
    };
    video.onloadedmetadata = () => {
      if (video.readyState >= 2) {
        settle(buildMetadata());
      }
    };
    video.onerror = () => {
      settle({});
    };
    video.src = url;
  });

  videoOutputMetadataInflight.set(url, promise);
  return promise;
}

function taskLastFrame(task: Task) {
  const value = task.metadata?.lastFrameUrl;
  return typeof value === "string" ? getGeneratedMediaUrl(value) : null;
}

// ---------------------------------------------------------------------------
// Page-local adapter: extends the unified MediaModelCapability with convenience
// booleans that the tab UI reads. These are derived from inputModes.
// ---------------------------------------------------------------------------
interface VideoCapability {
  id: string;
  label: string;
  kind: MediaModelCapability["kind"];
  provider: MediaModelCapability["provider"];
  status: MediaModelStatus;
  note?: string | null;
  recommended?: boolean;
  inputModes: Partial<Record<string, MediaCapabilitySet>>;
  supportsTextToVideo: boolean;
  supportsSingleReference: boolean;
  supportsStartEndFrame?: boolean;
  supportsMultiReference?: boolean;
  maxReferenceImages?: number;
  maxReferenceImagesSource?: "official" | "integrated";
}

function enrichVideoCapability(cap: MediaModelCapability): VideoCapability {
  return {
    ...cap,
    supportsTextToVideo: !!cap.inputModes.text_to_video?.supported,
    supportsSingleReference: !!cap.inputModes.single_reference?.supported,
    supportsStartEndFrame: !!cap.inputModes.start_end_frame?.supported,
    supportsMultiReference: !!cap.inputModes.multi_param?.supported,
    maxReferenceImages: cap.inputModes.multi_param?.maxReferenceImages,
  };
}

function enrichVideoCapabilities(items: MediaModelCapability[]): VideoCapability[] {
  return items.map(enrichVideoCapability);
}

type VideoCreateMode = VideoGenerationMode;

const VIDEO_MODE_TABS: Array<{ id: VideoCreateMode; label: string; hint: string }> = [
  { id: "image_to_video", label: "图生视频", hint: "单张参考图驱动画面运动" },
  { id: "start_end_frame", label: "首尾帧生成", hint: "首帧和尾帧都必填，模型按两帧之间的约束生成视频" },
  {
    id: "multi_param",
    label: "多参生成",
    hint: "文生或多参考图：场景/角色/道具等分类上传，质量优先模型自动路由",
  },
];

const I2V_MODEL_OPTIONS_UNUSED = [
  {
    label: "veo3.1-pro",
    description: "质量优先，默认推荐。",
  },
  {
    label: "veo_3_1-4K",
    description: "高分辨率质量优先。",
  },
  {
    label: "veo3.1（仅图生）",
    description: "通用高质量模型。",
  },
  {
    label: "grok-video-3",
    description: "复杂动作/创意场景备选。",
  },
  {
    label: "veo3.1-fast",
    description: "快速预览版本。",
  },
  {
    label: "veo_3_1-fast-4K",
    description: "4K 快速版本。",
  },
  {
    label: "kling-video",
    description: "通用视频生成备选。",
  },
] as const;

// Seedance 2.0 is the primary product baseline for all video modes.
// PixVerse models remain in the capability lists but are not the default.
const DEFAULT_I2V_MODEL = "doubao-seedance-2-0-260128";
const DEFAULT_START_END_MODEL = "doubao-seedance-2-0-260128";
const MULTI_REF_MODEL_OPTIONS_UNUSED = [
  "veo_3_1-components-4K",
  "pixverse-c1",
  "veo3.1-components",
  "veo_3_1-components",
  "veo3.1-fast-components",
] as const;
const START_END_MODEL_OPTIONS_UNUSED = ["pixverse-v6"] as const;

const I2V_MODEL_OPTIONS = [
  {
    label: "veo3.1-pro",
    description: "当前已验证稳定的图生视频模型。",
  },
] as const;

const MULTI_REF_MODEL_OPTIONS = [
  "pixverse-c1",
  "veo3.1-components",
  "veo_3_1-components",
  "veo_3_1-components-4K",
  "veo3.1-fast-components",
  "kling-multi-image2video",
  "kling-multi-elements",
] as const;
const VIDEO_PAGE_SIZE = 9;
const DEFAULT_VIDEO_RESOLUTION = "1080p";
const DEFAULT_START_END_RESOLUTION = "720p";
const DEFAULT_FIXED_VIDEO_DURATION = "8s";
const DEFAULT_GENERAL_VIDEO_DURATION = "3s";
const DEFAULT_VIDEO_ASPECT_RATIO = "16:9";
const GENERAL_VIDEO_RESOLUTION_OPTIONS = ["1080p", "720p"] as const;
const IMAGE_TO_VIDEO_RESOLUTION_OPTIONS = ["1080p"] as const;
const START_END_RESOLUTION_OPTIONS = ["720p"] as const;
const MULTI_PARAM_RESOLUTION_OPTIONS = ["720p"] as const;
const GENERAL_DURATION_OPTIONS = ["3s", "5s"] as const;
const FIXED_DURATION_OPTIONS = ["8s"] as const;
const GENERAL_ASPECT_RATIO_OPTIONS = ["16:9", "1:1", "9:16"] as const;
const FIXED_ASPECT_RATIO_OPTIONS = ["16:9"] as const;

function createImageToVideoCapabilitySet(
  overrides: Partial<MediaCapabilitySet> = {},
): MediaCapabilitySet {
  const supportedDurations =
    overrides.supportedDurations?.map((value) => String(value)).filter(Boolean) || ["8s"];
  const supportedAspectRatios =
    overrides.supportedAspectRatios?.map((value) => String(value)).filter(Boolean) || ["16:9"];
  const supportedResolutions =
    overrides.supportedResolutions?.map((value) => String(value)).filter(Boolean) || ["1080p"];

  return {
    supported: overrides.supported !== false,
    status: overrides.status || "experimental",
    supportedDurations,
    supportedAspectRatios,
    supportedResolutions,
    durationControl: overrides.durationControl || (supportedDurations.length > 1 ? "selectable" : "fixed"),
    aspectRatioControl:
      overrides.aspectRatioControl || (supportedAspectRatios.length > 1 ? "selectable" : "fixed"),
    resolutionControl:
      overrides.resolutionControl || (supportedResolutions.length > 1 ? "selectable" : "fixed"),
    defaultDuration: overrides.defaultDuration || supportedDurations[0] || null,
    defaultAspectRatio: overrides.defaultAspectRatio || supportedAspectRatios[0] || null,
    defaultResolution: overrides.defaultResolution || supportedResolutions[0] || null,
    note: overrides.note || null,
  };
}

function inferVideoProvider(id: string): MediaModelCapability["provider"] {
  const lower = id.toLowerCase();
  if (lower.startsWith("pixverse")) return "pixverse";
  if (lower.startsWith("veo")) return "google";
  if (lower.startsWith("kling")) return "kling";
  if (lower.startsWith("hailuo")) return "hailuo";
  if (lower.startsWith("grok")) return "grok";
  if (lower.startsWith("doubao") || lower.startsWith("seedance")) return "bytedance";
  return "other";
}

function fallbackVideoModel(
  base: Omit<VideoCapability, "kind" | "provider"> & { provider?: MediaModelCapability["provider"] },
): VideoCapability {
  return {
    kind: "video",
    provider: base.provider ?? inferVideoProvider(base.id),
    ...base,
  } as VideoCapability;
}

const FALLBACK_IMAGE_TO_VIDEO_TEXT_CAPABILITY = createImageToVideoCapabilitySet({
  status: "experimental",
  supportedDurations: ["8s"],
  supportedAspectRatios: ["16:9", "1:1", "9:16"],
  supportedResolutions: ["1080p", "720p"],
  durationControl: "fixed",
  aspectRatioControl: "selectable",
  resolutionControl: "selectable",
  note: "按 Yunwu 官方创建视频文档接入，目前优先开放已确认存在的 size / aspect_ratio 能力。",
});

const FALLBACK_IMAGE_TO_VIDEO_SINGLE_REFERENCE_CAPABILITY = createImageToVideoCapabilitySet({
  status: "experimental",
  supportedDurations: ["8s"],
  supportedAspectRatios: ["16:9", "1:1", "9:16"],
  supportedResolutions: ["1080p"],
  durationControl: "fixed",
  aspectRatioControl: "selectable",
  resolutionControl: "fixed",
  note: "按 Yunwu 官方参考图视频文档接入，优先保持当前单参考图视频体验。",
});

const FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES: VideoCapability[] = [
  fallbackVideoModel({ id: "pixverse-v6", label: "PixVerse V6", status: "experimental", note: "PixVerse V6 静态 fallback：文生视频支持 1-15s、360p/540p/720p/1080p 与 8 种官方画幅；单参考图视频按官方要求使用 adaptive 固定画幅。", supportsTextToVideo: true, supportsSingleReference: true, inputModes: { text_to_video: createImageToVideoCapabilitySet({ status: "experimental", supportedDurations: ["1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"], supportedAspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "2:3", "3:2", "21:9"], supportedResolutions: ["360p", "540p", "720p", "1080p"], durationControl: "selectable", aspectRatioControl: "selectable", resolutionControl: "selectable", defaultDuration: "5s", defaultAspectRatio: "16:9", defaultResolution: "720p" }), single_reference: createImageToVideoCapabilitySet({ status: "experimental", supportedDurations: ["1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"], supportedAspectRatios: ["adaptive"], supportedResolutions: ["360p", "540p", "720p", "1080p"], durationControl: "selectable", aspectRatioControl: "fixed", resolutionControl: "selectable", defaultDuration: "5s", defaultAspectRatio: "adaptive", defaultResolution: "720p" }) } }),
  fallbackVideoModel({ id: "pixverse-c1", label: "PixVerse C1", status: "experimental", note: "PixVerse C1 静态 fallback：文生视频支持 1-15s、360p/540p/720p/1080p 与 8 种官方画幅；单参考图视频按官方要求使用 adaptive 固定画幅。", supportsTextToVideo: true, supportsSingleReference: true, inputModes: { text_to_video: createImageToVideoCapabilitySet({ status: "experimental", supportedDurations: ["1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"], supportedAspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "2:3", "3:2", "21:9"], supportedResolutions: ["360p", "540p", "720p", "1080p"], durationControl: "selectable", aspectRatioControl: "selectable", resolutionControl: "selectable", defaultDuration: "5s", defaultAspectRatio: "16:9", defaultResolution: "720p" }), single_reference: createImageToVideoCapabilitySet({ status: "experimental", supportedDurations: ["1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"], supportedAspectRatios: ["adaptive"], supportedResolutions: ["360p", "540p", "720p", "1080p"], durationControl: "selectable", aspectRatioControl: "fixed", resolutionControl: "selectable", defaultDuration: "5s", defaultAspectRatio: "adaptive", defaultResolution: "720p" }) } }),
  fallbackVideoModel({ id: "kling-video", label: "kling-video（推荐文生视频）", status: "experimental", note: "已按 Yunwu 官方模型目录接入，待继续验证纯文本与单参考图的真实效果。", supportsTextToVideo: true, supportsSingleReference: true, inputModes: { text_to_video: createImageToVideoCapabilitySet(FALLBACK_IMAGE_TO_VIDEO_TEXT_CAPABILITY), single_reference: createImageToVideoCapabilitySet(FALLBACK_IMAGE_TO_VIDEO_SINGLE_REFERENCE_CAPABILITY) } }),
  fallbackVideoModel({ id: "veo3.1", label: "veo3.1（仅图生）", status: "experimental", note: "已按 Yunwu 官方模型目录接入，待继续验证纯文本与单参考图的真实效果。", supportsTextToVideo: true, supportsSingleReference: true, inputModes: { text_to_video: createImageToVideoCapabilitySet(FALLBACK_IMAGE_TO_VIDEO_TEXT_CAPABILITY), single_reference: createImageToVideoCapabilitySet(FALLBACK_IMAGE_TO_VIDEO_SINGLE_REFERENCE_CAPABILITY) } }),
  fallbackVideoModel({ id: "veo3.1-pro", label: "veo3.1-pro", status: "stable", note: "当前已验证稳定的 Yunwu 图生视频基线模型。", supportsTextToVideo: true, supportsSingleReference: true, inputModes: { text_to_video: createImageToVideoCapabilitySet({ ...FALLBACK_IMAGE_TO_VIDEO_TEXT_CAPABILITY, note: "已接入共享模型选择器；纯文本视频能力会继续按真实任务结果细化。" }), single_reference: createImageToVideoCapabilitySet({ ...FALLBACK_IMAGE_TO_VIDEO_SINGLE_REFERENCE_CAPABILITY, status: "stable", note: "当前已验证稳定的单参考图视频链路。" }) } }),
  fallbackVideoModel({ id: "veo_3_1-4K", label: "veo_3_1-4K", status: "experimental", note: "已按 Yunwu 官方模型目录接入，待继续验证更高分辨率输出是否稳定可用。", supportsTextToVideo: true, supportsSingleReference: true, inputModes: { text_to_video: createImageToVideoCapabilitySet(FALLBACK_IMAGE_TO_VIDEO_TEXT_CAPABILITY), single_reference: createImageToVideoCapabilitySet(FALLBACK_IMAGE_TO_VIDEO_SINGLE_REFERENCE_CAPABILITY) } }),
  fallbackVideoModel({ id: "veo_3_1-fast-4K", label: "veo_3_1-fast-4K", status: "experimental", note: "已按 Yunwu 官方模型目录接入，待继续验证速度优先模型的真实效果。", supportsTextToVideo: true, supportsSingleReference: true, inputModes: { text_to_video: createImageToVideoCapabilitySet(FALLBACK_IMAGE_TO_VIDEO_TEXT_CAPABILITY), single_reference: createImageToVideoCapabilitySet(FALLBACK_IMAGE_TO_VIDEO_SINGLE_REFERENCE_CAPABILITY) } }),
  fallbackVideoModel({ id: "veo3.1-fast", label: "veo3.1-fast", status: "experimental", note: "已按 Yunwu 官方模型目录接入，待继续验证速度优先模型的真实效果。", supportsTextToVideo: true, supportsSingleReference: true, inputModes: { text_to_video: createImageToVideoCapabilitySet(FALLBACK_IMAGE_TO_VIDEO_TEXT_CAPABILITY), single_reference: createImageToVideoCapabilitySet(FALLBACK_IMAGE_TO_VIDEO_SINGLE_REFERENCE_CAPABILITY) } }),
  fallbackVideoModel({ id: "grok-video-3", label: "grok-video-3", status: "experimental", note: "已按 Yunwu 官方模型目录接入，待继续验证纯文本与单参考图的真实效果。", supportsTextToVideo: true, supportsSingleReference: true, inputModes: { text_to_video: createImageToVideoCapabilitySet(FALLBACK_IMAGE_TO_VIDEO_TEXT_CAPABILITY), single_reference: createImageToVideoCapabilitySet(FALLBACK_IMAGE_TO_VIDEO_SINGLE_REFERENCE_CAPABILITY) } }),
  fallbackVideoModel({ id: "doubao-seedance-2-0-260128", label: "Seedance 2.0", status: "stable", note: "字节跳动 Seedance 2.0，支持文生视频与单参考图视频，720p/480p，4-15s。", supportsTextToVideo: true, supportsSingleReference: true, inputModes: { text_to_video: createImageToVideoCapabilitySet({ status: "stable", supportedDurations: ["4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"], supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], supportedResolutions: ["720p", "480p"], durationControl: "selectable", aspectRatioControl: "selectable", resolutionControl: "selectable", defaultDuration: "5s", defaultAspectRatio: "16:9", defaultResolution: "720p" }), single_reference: createImageToVideoCapabilitySet({ status: "stable", supportedDurations: ["4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"], supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"], supportedResolutions: ["720p", "480p"], durationControl: "selectable", aspectRatioControl: "selectable", resolutionControl: "selectable", defaultDuration: "5s", defaultAspectRatio: "adaptive", defaultResolution: "720p" }) } }),
  // ── Official Vertex AI Veo models — "vertex:" prefix; name ends with "+" ────
  // Excluded: veo-3.1-generate-preview / veo-3.1-fast-generate-preview (removed 2026-04-02)
  // Excluded: "Veo 3.1 4K" as a model (4K is a resolution param, not a separate model)
  fallbackVideoModel({ id: "vertex:veo-3.1-generate-001", label: "Veo 3.1+", status: "stable", note: "Veo 3.1 正式版，直接调用 Vertex AI（需配置 VERTEX_PROJECT_ID、VERTEX_GCS_BUCKET 及认证凭据）。", supportsTextToVideo: true, supportsSingleReference: true, inputModes: { text_to_video: createImageToVideoCapabilitySet({ status: "stable", supportedDurations: ["5s", "8s"], supportedAspectRatios: ["16:9", "9:16"], supportedResolutions: ["1080p", "720p", "480p"], durationControl: "selectable", aspectRatioControl: "selectable", resolutionControl: "selectable", defaultDuration: "8s", defaultAspectRatio: "16:9", defaultResolution: "720p" }), single_reference: createImageToVideoCapabilitySet({ status: "stable", supportedDurations: ["5s", "8s"], supportedAspectRatios: ["16:9", "9:16"], supportedResolutions: ["1080p", "720p", "480p"], durationControl: "selectable", aspectRatioControl: "selectable", resolutionControl: "selectable", defaultDuration: "8s", defaultAspectRatio: "16:9", defaultResolution: "720p" }) } }),
  fallbackVideoModel({ id: "vertex:veo-3.1-fast-generate-001", label: "Veo 3.1 Fast+", status: "stable", note: "Veo 3.1 Fast 正式版，速度更快，直接调用 Vertex AI。", supportsTextToVideo: true, supportsSingleReference: true, inputModes: { text_to_video: createImageToVideoCapabilitySet({ status: "stable", supportedDurations: ["5s", "8s"], supportedAspectRatios: ["16:9", "9:16"], supportedResolutions: ["1080p", "720p"], durationControl: "selectable", aspectRatioControl: "selectable", resolutionControl: "selectable", defaultDuration: "8s", defaultAspectRatio: "16:9", defaultResolution: "720p" }), single_reference: createImageToVideoCapabilitySet({ status: "stable", supportedDurations: ["5s", "8s"], supportedAspectRatios: ["16:9", "9:16"], supportedResolutions: ["1080p", "720p"], durationControl: "selectable", aspectRatioControl: "selectable", resolutionControl: "selectable", defaultDuration: "8s", defaultAspectRatio: "16:9", defaultResolution: "720p" }) } }),
  fallbackVideoModel({ id: "vertex:veo-3.1-lite-generate-001", label: "Veo 3.1 Lite+", status: "preview", note: "Veo 3.1 Lite，Preview 阶段。当前仅开放文生视频；图生/首尾帧能力待官方正式确认后再开放。", supportsTextToVideo: true, supportsSingleReference: false, inputModes: { text_to_video: createImageToVideoCapabilitySet({ status: "preview", supportedDurations: ["5s", "8s"], supportedAspectRatios: ["16:9", "9:16"], supportedResolutions: ["720p", "480p"], durationControl: "selectable", aspectRatioControl: "selectable", resolutionControl: "selectable", defaultDuration: "5s", defaultAspectRatio: "16:9", defaultResolution: "720p" }) } }),
];

const FALLBACK_MULTI_PARAM_CAPABILITIES: VideoCapability[] = [
  fallbackVideoModel({ id: "pixverse-c1", label: "PixVerse C1 Fusion", status: "experimental", note: "PixVerse C1 Fusion 静态 fallback：按官方 reference-to-video 规则支持最多 3 张参考图、5s/8s、360p/540p/720p/1080p 与 8 种显式画幅。", supportsTextToVideo: false, supportsSingleReference: false, supportsMultiReference: true, maxReferenceImages: 3, maxReferenceImagesSource: "official", inputModes: { multi_param: createImageToVideoCapabilitySet({ status: "experimental", supportedDurations: ["5s", "8s"], supportedAspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "2:3", "3:2", "21:9"], supportedResolutions: ["360p", "540p", "720p", "1080p"], durationControl: "selectable", aspectRatioControl: "selectable", resolutionControl: "selectable", defaultDuration: "5s", defaultAspectRatio: "16:9", defaultResolution: "720p", maxReferenceImages: 3 }) } }),
  fallbackVideoModel({ id: "veo3.1-components", label: "veo3.1-components", status: "stable", note: "当前已验证稳定的 Yunwu components 多参考视频基线模型；现阶段稳定验证通过的是 3 张参考图组合。", supportsTextToVideo: false, supportsSingleReference: false, supportsMultiReference: true, maxReferenceImages: 3, maxReferenceImagesSource: "integrated", inputModes: { multi_param: createImageToVideoCapabilitySet({ status: "stable", supportedDurations: ["8s"], supportedAspectRatios: ["16:9"], supportedResolutions: ["720p"], durationControl: "fixed", aspectRatioControl: "fixed", resolutionControl: "fixed", defaultDuration: "8s", defaultAspectRatio: "16:9", defaultResolution: "720p", note: "当前固定走 Yunwu /v1/video/create；现阶段稳定验证通过的是 3 张参考图，并优先保留 scene / character / prop。4 张及以上提交当前更容易被 provider 策略拦截。" }) } }),
  fallbackVideoModel({ id: "veo_3_1-components", label: "veo_3_1-components", status: "experimental", note: "已按 Yunwu 官方 components 多参考视频模型接入，待继续验证真实效果。", supportsTextToVideo: false, supportsSingleReference: false, supportsMultiReference: true, maxReferenceImages: 7, maxReferenceImagesSource: "integrated", inputModes: { multi_param: createImageToVideoCapabilitySet({ status: "experimental", supportedDurations: ["8s"], supportedAspectRatios: ["16:9"], supportedResolutions: ["720p"], durationControl: "fixed", aspectRatioControl: "fixed", resolutionControl: "fixed", defaultDuration: "8s", defaultAspectRatio: "16:9", defaultResolution: "720p" }) } }),
  fallbackVideoModel({ id: "veo_3_1-components-4K", label: "veo_3_1-components-4K", status: "experimental", note: "已按 Yunwu 官方 components 4K 多参考视频模型接入，待继续验证真实效果。", supportsTextToVideo: false, supportsSingleReference: false, supportsMultiReference: true, maxReferenceImages: 7, maxReferenceImagesSource: "integrated", inputModes: { multi_param: createImageToVideoCapabilitySet({ status: "experimental", supportedDurations: ["8s"], supportedAspectRatios: ["16:9"], supportedResolutions: ["720p"], durationControl: "fixed", aspectRatioControl: "fixed", resolutionControl: "fixed", defaultDuration: "8s", defaultAspectRatio: "16:9", defaultResolution: "720p" }) } }),
  fallbackVideoModel({ id: "veo3.1-fast-components", label: "veo3.1-fast-components", status: "experimental", note: "已按 Yunwu 官方 fast components 多参考视频模型接入，待继续验证真实效果。", supportsTextToVideo: false, supportsSingleReference: false, supportsMultiReference: true, maxReferenceImages: 7, maxReferenceImagesSource: "integrated", inputModes: { multi_param: createImageToVideoCapabilitySet({ status: "experimental", supportedDurations: ["8s"], supportedAspectRatios: ["16:9"], supportedResolutions: ["720p"], durationControl: "fixed", aspectRatioControl: "fixed", resolutionControl: "fixed", defaultDuration: "8s", defaultAspectRatio: "16:9", defaultResolution: "720p" }) } }),
  fallbackVideoModel({ id: "kling-multi-image2video", label: "kling-multi-image2video", status: "experimental", note: "已按 Yunwu 官方 /kling/v1/videos/multi-image2video 接入，待继续验证多图参考视频的真实效果。", supportsTextToVideo: false, supportsSingleReference: false, supportsMultiReference: true, maxReferenceImages: 7, maxReferenceImagesSource: "integrated", inputModes: { multi_param: createImageToVideoCapabilitySet({ status: "experimental", supportedDurations: ["5s", "10s"], supportedAspectRatios: ["16:9"], supportedResolutions: ["720p"], durationControl: "selectable", aspectRatioControl: "fixed", resolutionControl: "fixed", defaultDuration: "5s", defaultAspectRatio: "16:9", defaultResolution: "720p" }) } }),
  fallbackVideoModel({ id: "kling-multi-elements", label: "kling-multi-elements", status: "experimental", note: "已按 Yunwu 官方 /kling/v1/videos/multi-elements 接入，待继续验证多模态多图视频的真实效果。", supportsTextToVideo: false, supportsSingleReference: false, supportsMultiReference: true, maxReferenceImages: 7, maxReferenceImagesSource: "integrated", inputModes: { multi_param: createImageToVideoCapabilitySet({ status: "experimental", supportedDurations: ["5s", "10s"], supportedAspectRatios: ["16:9"], supportedResolutions: ["720p"], durationControl: "selectable", aspectRatioControl: "fixed", resolutionControl: "fixed", defaultDuration: "5s", defaultAspectRatio: "16:9", defaultResolution: "720p" }) } }),
  fallbackVideoModel({ id: "doubao-seedance-2-0-260128", label: "Seedance 2.0", status: "stable", note: "字节跳动 Seedance 2.0 多参考图模式，最多支持 7 张参考图。", supportsTextToVideo: false, supportsSingleReference: false, supportsMultiReference: true, maxReferenceImages: 7, maxReferenceImagesSource: "integrated", inputModes: { multi_param: createImageToVideoCapabilitySet({ status: "stable", supportedDurations: ["4s", "5s", "8s", "10s", "15s"], supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], supportedResolutions: ["1080p", "720p", "480p"], durationControl: "selectable", aspectRatioControl: "selectable", resolutionControl: "selectable", defaultDuration: "5s", defaultAspectRatio: "16:9", defaultResolution: "1080p" }) } }),
  fallbackVideoModel({ id: "doubao-seedance-2-0-fast-260128", label: "Seedance 2.0 Fast", status: "stable", note: "字节跳动 Seedance 2.0 快速版多参考图模式，速度更快。", supportsTextToVideo: false, supportsSingleReference: false, supportsMultiReference: true, maxReferenceImages: 7, maxReferenceImagesSource: "integrated", inputModes: { multi_param: createImageToVideoCapabilitySet({ status: "stable", supportedDurations: ["4s", "5s", "8s", "10s", "15s"], supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], supportedResolutions: ["1080p", "720p", "480p"], durationControl: "selectable", aspectRatioControl: "selectable", resolutionControl: "selectable", defaultDuration: "5s", defaultAspectRatio: "16:9", defaultResolution: "1080p" }) } }),
];

const fallbackVeo31ProImageToVideoCapability = FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES.find(
  (item) => item.id === "veo3.1-pro",
);
if (fallbackVeo31ProImageToVideoCapability) {
  fallbackVeo31ProImageToVideoCapability.note =
    "当前已验证稳定的单参考图视频基线模型；纯文生视频请改用 grok-video-3 或先上传参考图。";
  fallbackVeo31ProImageToVideoCapability.supportsTextToVideo = false;
  fallbackVeo31ProImageToVideoCapability.inputModes.text_to_video = createImageToVideoCapabilitySet({
    supported: false,
    status: "failing",
    supportedDurations: ["8s"],
    supportedAspectRatios: ["16:9", "1:1", "9:16"],
    supportedResolutions: ["1080p", "720p"],
    durationControl: "fixed",
    aspectRatioControl: "selectable",
    resolutionControl: "selectable",
    note: "实测在 Yunwu 当前 /v1/video/create 纯文生视频链路下，veo3.1-pro 的 1080p 与 720p 请求都会返回 FAILED。请上传参考图，或切换到 grok-video-3 进行纯文生视频。",
  });
  fallbackVeo31ProImageToVideoCapability.inputModes.single_reference = createImageToVideoCapabilitySet({
    ...FALLBACK_IMAGE_TO_VIDEO_SINGLE_REFERENCE_CAPABILITY,
    status: "stable",
    note: "当前已验证稳定的单参考图视频链路。",
  });
}

if (fallbackVeo31ProImageToVideoCapability) {
  fallbackVeo31ProImageToVideoCapability.note =
    "2026-04-02 已按 Yunwu 官方 /v1/videos 与当前项目现用链路，对 veo3.1-pro 单参考图视频做了 3s/5s/8s、16:9/1:1 的最小实测；当前都会在 provider 侧失败。";
  fallbackVeo31ProImageToVideoCapability.status = "failing";
  fallbackVeo31ProImageToVideoCapability.supportsTextToVideo = false;
  fallbackVeo31ProImageToVideoCapability.supportsSingleReference = false;
  fallbackVeo31ProImageToVideoCapability.inputModes.text_to_video = createImageToVideoCapabilitySet({
    supported: false,
    status: "failing",
    supportedDurations: ["8s"],
    supportedAspectRatios: ["16:9", "1:1", "9:16"],
    supportedResolutions: ["1080p", "720p"],
    durationControl: "fixed",
    aspectRatioControl: "selectable",
    resolutionControl: "selectable",
    note: "实测在 Yunwu 当前 /v1/video/create 纯文生视频链路下，veo3.1-pro 的 1080p 与 720p 请求都会返回 FAILED。请上传参考图，或切换到 grok-video-3 进行纯文生视频。",
  });
  fallbackVeo31ProImageToVideoCapability.inputModes.single_reference =
    createImageToVideoCapabilitySet({
      supported: false,
      status: "failing",
      supportedDurations: ["3s", "5s", "8s"],
      supportedAspectRatios: ["16:9", "1:1"],
      supportedResolutions: ["1080p"],
      durationControl: "selectable",
      aspectRatioControl: "selectable",
      resolutionControl: "fixed",
      defaultDuration: "8s",
      defaultAspectRatio: "16:9",
      defaultResolution: "1080p",
      note: "2026-04-02 已按 Yunwu 官方 /v1/videos 与当前项目现用链路，对 veo3.1-pro 单参考图视频做了 3s/5s/8s、16:9/1:1 的最小实测；当前都会在 provider 侧失败，请先改用 veo3.1 或 kling-video。",
    });
}

const fallbackVeo31ImageToVideoCapability = FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES.find(
  (item) => item.id === "veo3.1",
);
if (fallbackVeo31ImageToVideoCapability) {
  fallbackVeo31ImageToVideoCapability.note =
    "veo3.1 的 Yunwu 纯文生视频已按 1080p 与 720p 实测，都会在 provider 侧返回 FAILED；请上传参考图，或切换到 grok-video-3 / veo_3_1-fast-4K。";
  fallbackVeo31ImageToVideoCapability.supportsTextToVideo = false;
  fallbackVeo31ImageToVideoCapability.inputModes.text_to_video = createImageToVideoCapabilitySet({
    supported: false,
    status: "failing",
    supportedDurations: ["8s"],
    supportedAspectRatios: ["16:9", "1:1", "9:16"],
    supportedResolutions: ["1080p", "720p"],
    durationControl: "fixed",
    aspectRatioControl: "selectable",
    resolutionControl: "selectable",
    note: "实测 veo3.1 纯文生视频在 1080p 与 720p 下都会返回 FAILED，当前请改用单参考图视频，或切换到 grok-video-3 / veo_3_1-fast-4K。",
  });
}

if (fallbackVeo31ImageToVideoCapability) {
  fallbackVeo31ImageToVideoCapability.note =
    "veo3.1 的 Yunwu 纯文生视频在当前通用链路下不可用，但单参考图视频已切到官方 OpenAI 视频接口并通过本地真实任务验证。";
  fallbackVeo31ImageToVideoCapability.inputModes.single_reference = createImageToVideoCapabilitySet({
    supported: true,
    status: "stable",
    supportedDurations: ["5s", "8s"],
    supportedAspectRatios: ["16:9", "1:1", "9:16"],
    supportedResolutions: ["自动"],
    durationControl: "selectable",
    aspectRatioControl: "selectable",
    resolutionControl: "fixed",
    defaultDuration: "8s",
    defaultAspectRatio: "16:9",
    defaultResolution: "自动",
    note: "已切到 Yunwu 官方 /v1/videos 单参考图接口，并通过本地真实任务验证：当前可用参数为 5s/8s 与 16:9/1:1/9:16；该接口没有独立清晰度参数，因此前端固定显示为自动。",
  });
}

const fallbackVeo314KImageToVideoCapability = FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES.find(
  (item) => item.id === "veo_3_1-4K",
);
if (fallbackVeo314KImageToVideoCapability) {
  fallbackVeo314KImageToVideoCapability.note =
    "veo_3_1-4K 当前只完成了纯文生视频失败验证；单参考图没有像 veo3.1 一样接入官方 /v1/videos 稳定链路，现阶段请不要在图生视频里使用。";
  fallbackVeo314KImageToVideoCapability.status = "failing";
  fallbackVeo314KImageToVideoCapability.supportsTextToVideo = false;
  fallbackVeo314KImageToVideoCapability.supportsSingleReference = false;
  fallbackVeo314KImageToVideoCapability.inputModes.text_to_video = createImageToVideoCapabilitySet({
    supported: false,
    status: "failing",
    supportedDurations: ["8s"],
    supportedAspectRatios: ["16:9", "1:1", "9:16"],
    supportedResolutions: ["1080p", "720p"],
    durationControl: "fixed",
    aspectRatioControl: "selectable",
    resolutionControl: "selectable",
    note: "实测 veo_3_1-4K 纯文生视频在 1080p 下会失败，在 720p 下会超时，当前请不要用于纯文生视频。",
  });
  fallbackVeo314KImageToVideoCapability.inputModes.single_reference = createImageToVideoCapabilitySet({
    supported: false,
    status: "failing",
    supportedDurations: ["8s"],
    supportedAspectRatios: ["16:9", "1:1", "9:16"],
    supportedResolutions: ["1080p"],
    durationControl: "fixed",
    aspectRatioControl: "selectable",
    resolutionControl: "fixed",
    defaultDuration: "8s",
    defaultAspectRatio: "16:9",
    defaultResolution: "1080p",
    note: "当前代码没有像 veo3.1 那样把 veo_3_1-4K 单参考图接到 Yunwu 官方 /v1/videos 稳定接口；现有任务会走通用链路且已出现失败，先标记为不可用。",
  });
}

const fallbackVeo31Fast4KImageToVideoCapability = FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES.find(
  (item) => item.id === "veo_3_1-fast-4K",
);
if (fallbackVeo31Fast4KImageToVideoCapability) {
  fallbackVeo31Fast4KImageToVideoCapability.note =
    "veo_3_1-fast-4K 的 Yunwu 纯文生视频已通过本地真实任务验证；当前稳定验证的是 8s / 16:9 / 1080p，单参考图链路仍待继续验证。";
  fallbackVeo31Fast4KImageToVideoCapability.inputModes.text_to_video = createImageToVideoCapabilitySet({
    supported: true,
    status: "stable",
    supportedDurations: ["8s"],
    supportedAspectRatios: ["16:9"],
    supportedResolutions: ["1080p"],
    durationControl: "fixed",
    aspectRatioControl: "fixed",
    resolutionControl: "fixed",
    defaultDuration: "8s",
    defaultAspectRatio: "16:9",
    defaultResolution: "1080p",
    note: "已通过本地真实任务验证，veo_3_1-fast-4K 纯文生视频当前稳定可用的组合为 8s / 16:9 / 1080p。",
  });
}

const fallbackVeo31FastImageToVideoCapability = FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES.find(
  (item) => item.id === "veo3.1-fast",
);
if (fallbackVeo31FastImageToVideoCapability) {
  fallbackVeo31FastImageToVideoCapability.note =
    "veo3.1-fast 的 Yunwu 纯文生视频已按 1080p 与 720p 实测，都会在 provider 侧返回 FAILED；请上传参考图，或切换到 grok-video-3 / veo_3_1-fast-4K。";
  fallbackVeo31FastImageToVideoCapability.supportsTextToVideo = false;
  fallbackVeo31FastImageToVideoCapability.inputModes.text_to_video = createImageToVideoCapabilitySet({
    supported: false,
    status: "failing",
    supportedDurations: ["8s"],
    supportedAspectRatios: ["16:9", "1:1", "9:16"],
    supportedResolutions: ["1080p", "720p"],
    durationControl: "fixed",
    aspectRatioControl: "selectable",
    resolutionControl: "selectable",
    note: "实测 veo3.1-fast 纯文生视频在 1080p 与 720p 下都会返回 FAILED，当前请不要用于纯文生视频。",
  });
}

if (fallbackVeo31FastImageToVideoCapability) {
  fallbackVeo31FastImageToVideoCapability.supportsSingleReference = false;
  fallbackVeo31FastImageToVideoCapability.inputModes.single_reference =
    createImageToVideoCapabilitySet({
      supported: false,
      status: "failing",
      supportedDurations: ["5s", "8s"],
      supportedAspectRatios: ["16:9"],
      supportedResolutions: ["自动"],
      durationControl: "selectable",
      aspectRatioControl: "fixed",
      resolutionControl: "fixed",
      defaultDuration: "8s",
      defaultAspectRatio: "16:9",
      defaultResolution: "自动",
      note: "2026-04-02 已同时按 Yunwu 官方 /v1/video/create 与 /v1/videos 两条单参考图路径实测 veo3.1-fast；当前都能入队，但最终都会在 provider 侧失败，请先改用 veo3.1 或 kling-video。",
    });
}

const fallbackGrokVideo3ImageToVideoCapability = FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES.find(
  (item) => item.id === "grok-video-3",
);
if (fallbackGrokVideo3ImageToVideoCapability) {
  fallbackGrokVideo3ImageToVideoCapability.note =
    "已按 Yunwu 官方模型目录接入；纯文生视频已验证可用，单参考图仍待继续验证。";
  fallbackGrokVideo3ImageToVideoCapability.inputModes.text_to_video = createImageToVideoCapabilitySet({
    ...FALLBACK_IMAGE_TO_VIDEO_TEXT_CAPABILITY,
    status: "stable",
    note: "已通过本地真实任务验证，可用于当前纯文生视频。",
  });
}

const fallbackKlingVideoImageToVideoCapability = FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES.find(
  (item) => item.id === "kling-video",
);
if (fallbackGrokVideo3ImageToVideoCapability) {
  fallbackGrokVideo3ImageToVideoCapability.note =
    "已接入 Yunwu 官方 grok-video-3 统一视频接口；纯文生视频已验证可用，单参考图当前改为显式下发 size + aspect_ratio，优先按前端所选画幅生成。";
  fallbackGrokVideo3ImageToVideoCapability.inputModes.text_to_video = createImageToVideoCapabilitySet({
    ...FALLBACK_IMAGE_TO_VIDEO_TEXT_CAPABILITY,
    status: "stable",
    supportedDurations: ["6s"],
    durationControl: "fixed",
    defaultDuration: "6s",
    note: "已通过本地真实任务验证：纯文生视频的 16:9、1:1、9:16 画幅都能生效；当前真实输出时长固定约 6s，清晰度参数仍待继续验证。",
  });
  fallbackGrokVideo3ImageToVideoCapability.inputModes.single_reference =
    createImageToVideoCapabilitySet({
      supported: true,
      status: "stable",
      supportedDurations: ["6s"],
      supportedAspectRatios: ["16:9", "1:1", "9:16"],
      supportedResolutions: ["1080p", "720p"],
      durationControl: "fixed",
      aspectRatioControl: "selectable",
      resolutionControl: "selectable",
      defaultDuration: "6s",
      defaultAspectRatio: "16:9",
      defaultResolution: "1080p",
      note: "已针对单参考图链路补充 size 参数，当前优先按前端选择的 16:9 / 1:1 / 9:16 与 1080p / 720p 发给 Yunwu；真实输出仍以复测结果为准。",
    });
}

if (fallbackKlingVideoImageToVideoCapability) {
  fallbackKlingVideoImageToVideoCapability.note =
    "已切换到 Yunwu 官方 Kling 专用接口；纯文生视频与单参考图视频都已通过本地真实任务验证。";
  fallbackKlingVideoImageToVideoCapability.inputModes.text_to_video = createImageToVideoCapabilitySet({
    ...FALLBACK_IMAGE_TO_VIDEO_TEXT_CAPABILITY,
    status: "stable",
    supportedDurations: ["5s", "10s"],
    durationControl: "selectable",
    defaultDuration: "5s",
    note: "已通过本地真实任务验证，当前走 Yunwu 官方 /kling/v1/videos/text2video。实测 provider 仅接受 5s 或 10s；画幅比例可控，清晰度能力仍待继续验证。",
  });
  fallbackKlingVideoImageToVideoCapability.inputModes.single_reference = createImageToVideoCapabilitySet({
    ...FALLBACK_IMAGE_TO_VIDEO_SINGLE_REFERENCE_CAPABILITY,
    status: "stable",
    supportedDurations: ["5s", "10s"],
    supportedAspectRatios: ["约 2.09:1"],
    supportedResolutions: ["1472x704"],
    durationControl: "selectable",
    aspectRatioControl: "fixed",
    resolutionControl: "fixed",
    defaultDuration: "5s",
    defaultAspectRatio: "约 2.09:1",
    defaultResolution: "1472x704",
    note: "已通过本地真实任务验证，当前走 Yunwu 官方 /kling/v1/videos/image2video。16:9、1:1、9:16 三种请求都能成功，但实际输出目前固定为约 1472x704（约 2.09:1）；时长仅确认可用 5s / 10s。",
  });
}

const FALLBACK_START_END_CAPABILITIES: VideoCapability[] = [
  fallbackVideoModel({ id: "pixverse-v6", label: "PixVerse V6", status: "experimental", note: "PixVerse V6 首尾帧静态 fallback：严格要求首帧和尾帧都必填；官方当前按 adaptive 固定画幅接入，支持 1-15s 与 360p/540p/720p/1080p。", supportsTextToVideo: false, supportsSingleReference: false, supportsStartEndFrame: true, inputModes: { start_end_frame: createImageToVideoCapabilitySet({ status: "experimental", supportedDurations: ["1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"], supportedAspectRatios: ["adaptive"], supportedResolutions: ["360p", "540p", "720p", "1080p"], durationControl: "selectable", aspectRatioControl: "fixed", resolutionControl: "selectable", defaultDuration: "5s", defaultAspectRatio: "adaptive", defaultResolution: "720p" }) } }),
  fallbackVideoModel({ id: "pixverse-c1", label: "PixVerse C1", status: "experimental", note: "PixVerse C1 首尾帧静态 fallback：严格要求首帧和尾帧都必填；官方当前按 adaptive 固定画幅接入，支持 1-15s 与 360p/540p/720p/1080p。", supportsTextToVideo: false, supportsSingleReference: false, supportsStartEndFrame: true, inputModes: { start_end_frame: createImageToVideoCapabilitySet({ status: "experimental", supportedDurations: ["1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"], supportedAspectRatios: ["adaptive"], supportedResolutions: ["360p", "540p", "720p", "1080p"], durationControl: "selectable", aspectRatioControl: "fixed", resolutionControl: "selectable", defaultDuration: "5s", defaultAspectRatio: "adaptive", defaultResolution: "720p" }) } }),
  fallbackVideoModel({ id: "kling-video", label: "kling-video", status: "stable", note: "已用真实 Yunwu 首尾帧任务复测通过；当前保留为首尾帧默认模型。接口可快速受理，但最终出片耗时较长（实测约 5-6 分钟）。", supportsTextToVideo: false, supportsSingleReference: false, supportsStartEndFrame: true, inputModes: { start_end_frame: createImageToVideoCapabilitySet({ status: "stable", supportedDurations: ["5s", "10s"], supportedAspectRatios: ["16:9"], supportedResolutions: ["自动"], durationControl: "selectable", aspectRatioControl: "fixed", resolutionControl: "fixed", defaultDuration: "5s", defaultAspectRatio: "16:9", defaultResolution: "自动", note: "已通过真实首尾帧任务验证并成功出片；当前保留官方已确认可用的 5s / 10s 与 16:9。" }) } }),
  fallbackVideoModel({ id: "doubao-seedance-2-0-260128", label: "Seedance 2.0", status: "stable", note: "字节跳动 Seedance 2.0 首尾帧模式，adaptive 画幅，4-15s，720p/480p。", supportsTextToVideo: false, supportsSingleReference: false, supportsStartEndFrame: true, inputModes: { start_end_frame: createImageToVideoCapabilitySet({ status: "stable", supportedDurations: ["4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"], supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"], supportedResolutions: ["720p", "480p"], durationControl: "selectable", aspectRatioControl: "selectable", resolutionControl: "selectable", defaultDuration: "5s", defaultAspectRatio: "adaptive", defaultResolution: "720p" }) } }),
  // Vertex Veo first+last frame support
  fallbackVideoModel({ id: "vertex:veo-3.1-generate-001", label: "Veo 3.1+", status: "stable", supportsTextToVideo: false, supportsSingleReference: false, supportsStartEndFrame: true, inputModes: { start_end_frame: createImageToVideoCapabilitySet({ status: "stable", supportedDurations: ["5s", "8s"], supportedAspectRatios: ["16:9", "9:16"], supportedResolutions: ["1080p", "720p", "480p"], durationControl: "selectable", aspectRatioControl: "selectable", resolutionControl: "selectable", defaultDuration: "8s", defaultAspectRatio: "16:9", defaultResolution: "720p" }) } }),
  fallbackVideoModel({ id: "vertex:veo-3.1-fast-generate-001", label: "Veo 3.1 Fast+", status: "stable", supportsTextToVideo: false, supportsSingleReference: false, supportsStartEndFrame: true, inputModes: { start_end_frame: createImageToVideoCapabilitySet({ status: "stable", supportedDurations: ["5s", "8s"], supportedAspectRatios: ["16:9", "9:16"], supportedResolutions: ["1080p", "720p"], durationControl: "selectable", aspectRatioControl: "selectable", resolutionControl: "selectable", defaultDuration: "8s", defaultAspectRatio: "16:9", defaultResolution: "720p" }) } }),
];

function resolveImageToVideoInputMode(referenceUrl?: string | null): VideoInputMode {
  return referenceUrl ? "single_reference" : "text_to_video";
}

function getImageToVideoCapabilitySet(
  capability: VideoCapability | null | undefined,
  inputMode: VideoInputMode,
) {
  if (!capability?.inputModes) return null;
  const preferred = capability.inputModes[inputMode];
  if (preferred) return preferred;
  if (capability.inputModes.single_reference?.supported) return capability.inputModes.single_reference;
  if (capability.inputModes.text_to_video?.supported) return capability.inputModes.text_to_video;
  return preferred || capability.inputModes.text_to_video || capability.inputModes.single_reference || null;
}

function getMultiParamCapabilitySet(capability: VideoCapability | null | undefined) {
  return capability?.inputModes?.multi_param || null;
}

function getStartEndCapabilitySet(capability: VideoCapability | null | undefined) {
  return capability?.inputModes?.start_end_frame || null;
}

/**
 * Picks a capability from the list, explicitly preferring `preferredId` before
 * falling back to `capabilities[0]`. This prevents the product default (Seedance)
 * from being silently skipped in favour of whichever model sits at position [0]
 * in a static fallback array.
 */
function pickFallbackVideoCapability(
  capabilities: VideoCapability[],
  preferredId: string,
): VideoCapability | null {
  return capabilities.find((item) => item.id === preferredId) || capabilities[0] || null;
}

function getImageToVideoOptionStatus(
  capability: VideoCapability,
  inputMode: VideoInputMode,
): VideoCapability["status"] {
  return getImageToVideoCapabilitySet(capability, inputMode)?.status || capability.status;
}

function capabilityStatusLabel(status: VideoCapability["status"]) {
  if (status === "stable") return "稳定";
  if (status === "failing") return "不可用";
  return "实验性";
}

function capabilityStatusTone(status: VideoCapability["status"]) {
  if (status === "stable") {
    return "border-emerald-600/40 bg-emerald-500/15 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200";
  }
  if (status === "failing") {
    return "border-rose-600/40 bg-rose-500/15 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200";
  }
  return "border-amber-600/40 bg-amber-500/15 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200";
}

const VEO_VIDEO_MODEL_DISPLAY_REMARK = "（转）";

function isVeoVideoModelId(id: string) {
  return id.toLowerCase().includes("veo");
}

/** 通用创作 · 视频：所有 id 含 veo 的模型在界面展示名称后加「（转）」 */
function withVeoVideoModelDisplayRemark(id: string, label: string) {
  if (!isVeoVideoModelId(id)) return label;
  if (label.endsWith(VEO_VIDEO_MODEL_DISPLAY_REMARK)) return label;
  return `${label}${VEO_VIDEO_MODEL_DISPLAY_REMARK}`;
}

/** 结果卡片 / 预览等仅有机型 id 时的展示 */
function formatVideoResultModelDisplay(modelId: string) {
  return withVeoVideoModelDisplayRemark(modelId, modelId);
}

function imageToVideoModelLabel(option: Pick<VideoCapability, "id" | "label">) {
  const base = option.id === "veo3.1" ? "veo3.1（仅图生）" : option.label;
  return withVeoVideoModelDisplayRemark(option.id, base);
}

function multiParamModelLabel(option: VideoCapability) {
  const maxReferenceImages = option.maxReferenceImages || 7;
  const status = getMultiParamCapabilitySet(option)?.status || option.status;
  const label = withVeoVideoModelDisplayRemark(option.id, option.label);
  return `${label} · 最多${maxReferenceImages}张 · ${capabilityStatusLabel(status)}`;
}

function startEndModelLabel(option: VideoCapability) {
  const status = getStartEndCapabilitySet(option)?.status || option.status;
  const label = withVeoVideoModelDisplayRemark(option.id, option.label);
  return `${label}（${capabilityStatusLabel(status)}）`;
}

function modeLabel(mode: string | null | undefined) {
  if (mode === "start_end_frame") return "首尾帧";
  if (mode === "multi_param") return "多参";
  if (mode === "image_to_video") return "图生";
  return null;
}

function hasMultiReferenceImages(item: CreateVideoResult) {
  const m = item.multiReferenceImages;
  if (!m || typeof m !== "object") return false;
  return Object.values(m).some((value) => multiReferenceUrls(value).length > 0);
}

function videoPreviewReason(item: CreateVideoResult) {
  const hasStillInput = Boolean(
    item.referenceImageUrl ||
      item.resolvedReferenceImageUrl ||
      item.firstFrameUrl ||
      hasMultiReferenceImages(item),
  );
  if (!hasStillInput && !item.model.includes("T2V") && !item.model.includes("KF2V")) {
    return "这条结果缺少参考图或首尾帧输入。请按当前创作模式重新生成。";
  }

  return "这条结果没有拿到真实可播放地址。请去 API 中心检查视频模型与密钥配置后再重新生成。";
}

function videoCoverReason(item: CreateVideoResult) {
  if (playableVideoUrl(item)) {
    return "当前结果没有返回封面图，但视频已经可播放。点击卡片即可预览。";
  }

  return "当前结果暂无封面预览。";
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function summarizeVideoPrompt(value: string, fallback: string): string {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  return normalized.length > 18 ? `${normalized.slice(0, 18)}...` : normalized;
}

function resolveTaskProjectId(task: Task | null | undefined): string | null {
  const directProjectId = typeof task?.projectId === "string" ? task.projectId.trim() : "";
  if (directProjectId) return directProjectId;
  const metadataProjectId =
    task?.metadata && typeof task.metadata.projectId === "string"
      ? task.metadata.projectId.trim()
      : "";
  return metadataProjectId || null;
}

function buildVideoAssetDraft(
  item: CreateVideoResult,
  targetProjectId?: string | null,
): AssetSyncDraft {
  const mediaUrl = playableVideoUrl(item);
  const previewUrl = resultCover(item);
  return {
    id: item.id,
    mediaKind: "video",
    previewUrl: previewUrl || null,
    mediaUrl: mediaUrl || null,
    prompt: item.prompt || "",
    model: item.model || "",
    aspectRatio: displayedAspectRatio(item) || item.aspectRatio || "",
    taskId: item.taskId ?? null,
    targetProjectId: targetProjectId || null,
    referenceImageUrl: item.referenceImageUrl ?? null,
    defaultAssetType: "video_ref",
    sourceModule: "video_create",
    defaultName: summarizeVideoPrompt(item.prompt, `视频素材 ${formatTime(item.createdAt)}`),
    defaultDescription: [
      item.prompt,
      `来源：视频创作`,
      item.model ? `模型：${item.model}` : "",
      item.videoMode ? `模式：${item.videoMode}` : "",
      `比例：${displayedAspectRatio(item) || item.aspectRatio || ""}`,
      `分辨率：${displayedResolution(item)}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function taskReference(task: Task) {
  const first = task.metadata?.firstFrameUrl;
  if (typeof first === "string" && first) return getGeneratedMediaUrl(first);
  const multi = task.metadata?.multiReferenceImages;
  if (multi && typeof multi === "object") {
    const order: VideoMultiReferenceKey[] = [
      "scene",
      "character",
      "prop",
      "pose",
      "expression",
      "effect",
      "sketch",
    ];
    for (const key of order) {
      const u = multiReferenceUrls((multi as VideoMultiReferenceImages)[key])[0];
      if (u) return getGeneratedMediaUrl(u);
    }
  }
  const resolved = task.metadata?.resolvedReferenceImageUrl;
  if (typeof resolved === "string" && resolved) return getGeneratedMediaUrl(resolved);
  const ref = task.metadata?.referenceImageUrl;
  if (typeof ref === "string" && ref) return getGeneratedMediaUrl(ref);
  return null;
}

function taskReferenceCaption(task: Task) {
  const meta = task.metadata;
  if (meta && typeof meta.firstFrameUrl === "string" && meta.firstFrameUrl) {
    return "首尾帧输入";
  }
  if (meta?.multiReferenceImages && typeof meta.multiReferenceImages === "object") {
    const m = meta.multiReferenceImages as VideoMultiReferenceImages;
    if (Object.values(m).some((value) => multiReferenceUrls(value).length > 0)) {
      return "多参参考图";
    }
  }
  if (meta && typeof meta.referenceImageUrl === "string" && meta.referenceImageUrl) {
    return "参考图";
  }
  return "参考输入";
}

function resolvedTaskReferenceCaption(task: Task) {
  const meta = task.metadata;
  if (meta && typeof meta.firstFrameUrl === "string" && meta.firstFrameUrl) {
    return "首尾帧输入";
  }
  if (meta?.multiReferenceImages && typeof meta.multiReferenceImages === "object") {
    const m = meta.multiReferenceImages as VideoMultiReferenceImages;
    if (Object.values(m).some((value) => multiReferenceUrls(value).length > 0)) {
      return "多参参考图";
    }
  }
  if (meta && typeof meta.resolvedReferenceImageUrl === "string" && meta.resolvedReferenceImageUrl) {
    return "主参考图";
  }
  if (meta && typeof meta.referenceImageUrl === "string" && meta.referenceImageUrl) {
    return "参考图";
  }
  return "参考输入";
}

const MULTI_REF_ORDER: VideoMultiReferenceKey[] = [
  "scene",
  "character",
  "prop",
  "pose",
  "expression",
  "effect",
  "sketch",
];

const MULTI_REF_LABELS: Record<VideoMultiReferenceKey, string> = {
  scene: "场景",
  character: "角色",
  prop: "道具",
  pose: "姿态图",
  expression: "表情图",
  effect: "特效图",
  sketch: "手绘稿",
};

type MultiRefSlotState = Record<VideoMultiReferenceKey, ReferenceImageState[]>;

function createEmptyMultiRefSlots(): MultiRefSlotState {
  return {
    scene: [],
    character: [],
    prop: [],
    pose: [],
    expression: [],
    effect: [],
    sketch: [],
  };
}

function buildMultiReferencePayload(
  slots: MultiRefSlotState,
): VideoMultiReferenceImages | undefined {
  const out: VideoMultiReferenceImages = {};
  for (const key of MULTI_REF_ORDER) {
    const urls = slots[key].map((item) => item.url).filter(Boolean);
    if (urls.length) out[key] = urls;
  }
  return Object.keys(out).length ? out : undefined;
}

function appendMultiRefItems(
  current: ReferenceImageState[],
  incoming: ReferenceImageState[],
) {
  const next = [...current];
  const seen = new Set(current.map((item) => `${item.source}:${item.assetId || item.id}:${item.url}`));
  for (const item of incoming) {
    const key = `${item.source}:${item.assetId || item.id}:${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(item);
  }
  return next;
}

export default function VideoCreate() {
  const actorId = useActorId();
  const [currentProjectId] = useCurrentProjectId();
  const [videoMode, setVideoMode] = useState<VideoCreateMode>("image_to_video");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(DEFAULT_I2V_MODEL);
  const [startEndModel, setStartEndModel] = useState<string>(DEFAULT_START_END_MODEL);
  const [multiRefModel, setMultiRefModel] = useState<string>(MULTI_REF_MODEL_OPTIONS[0]);
  const [duration, setDuration] = useState(DEFAULT_FIXED_VIDEO_DURATION);
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_VIDEO_ASPECT_RATIO);
  const [resolution, setResolution] = useState(DEFAULT_VIDEO_RESOLUTION);
  const [motionStrength, setMotionStrength] = useState(5);
  const [keepConsistency, setKeepConsistency] = useState(true);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyModel, setHistoryModel] = useState("all");
  const [referenceImage, setReferenceImage] = useState<ReferenceImageState | null>(null);
  const [startFrame, setStartFrame] = useState<ReferenceImageState | null>(null);
  const [endFrame, setEndFrame] = useState<ReferenceImageState | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<null | "start" | "end">(null);
  const [results, setResults] = useState<CreateVideoResult[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [previewItem, setPreviewItem] = useState<CreateVideoResult | null>(null);
  const [syncDraft, setSyncDraft] = useState<AssetSyncDraft | null>(null);
  const [syncingAsset, setSyncingAsset] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [syncDragActive, setSyncDragActive] = useState(false);
  const [draggingItem, setDraggingItem] = useState<AssetSyncDraft | null>(null);
  const draggingRef = useRef<AssetSyncDraft | null>(null);
  // Synchronous guard against rapid double-clicks of the generate button.
  // React's `generating` state only propagates on the next render, so two
  // clicks landing in the same frame would both enqueue backend tasks.
  const generatingRef = useRef(false);
  const [referencePreview, setReferencePreview] = useState<{ url: string; title: string } | null>(null);
  const [referenceDropActive, setReferenceDropActive] = useState(false);
  const [startDropActive, setStartDropActive] = useState(false);
  const [endDropActive, setEndDropActive] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [multiRefSlots, setMultiRefSlots] = useState(createEmptyMultiRefSlots);
  const [multiAssetTarget, setMultiAssetTarget] = useState<VideoMultiReferenceKey | null>(null);
  const [uploadingMultiSlot, setUploadingMultiSlot] = useState<VideoMultiReferenceKey | null>(null);

  const [multiDropSlot, setMultiDropSlot] = useState<VideoMultiReferenceKey | null>(null);
  const [confirmClearTasksOpen, setConfirmClearTasksOpen] = useState(false);
  const [derivedVideoMetadata, setDerivedVideoMetadata] = useState<Record<string, VideoOutputMetadata>>({});
  const [imageToVideoCapabilities, setImageToVideoCapabilities] = useState<VideoCapability[]>(
    FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES,
  );
  const [imageToVideoDefaultModel, setImageToVideoDefaultModel] = useState(DEFAULT_I2V_MODEL);
  const [imageToVideoCapabilityNotice, setImageToVideoCapabilityNotice] = useState<string | null>(null);
  const [multiParamCapabilities, setMultiParamCapabilities] = useState<VideoCapability[]>(
    FALLBACK_MULTI_PARAM_CAPABILITIES,
  );
  const [multiParamDefaultModel, setMultiParamDefaultModel] = useState("doubao-seedance-2-0-260128");
  const [multiParamCapabilityNotice, setMultiParamCapabilityNotice] = useState<string | null>(null);
  const [startEndCapabilities, setStartEndCapabilities] = useState<VideoCapability[]>(
    FALLBACK_START_END_CAPABILITIES,
  );
  const [startEndDefaultModel, setStartEndDefaultModel] = useState(DEFAULT_START_END_MODEL);
  const [startEndCapabilityNotice, setStartEndCapabilityNotice] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const currentImageToVideoInputMode = useMemo<VideoInputMode>(
    () => resolveImageToVideoInputMode(referenceImage?.url),
    [referenceImage?.url],
  );
  const selectedImageToVideoCapability = useMemo(() => {
    return (
      imageToVideoCapabilities.find((item) => item.id === model) ||
      imageToVideoCapabilities.find((item) => item.id === imageToVideoDefaultModel) ||
      pickFallbackVideoCapability(FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES, DEFAULT_I2V_MODEL) ||
      null
    );
  }, [imageToVideoCapabilities, imageToVideoDefaultModel, model]);
  const selectedImageToVideoCapabilitySet = useMemo(
    () => getImageToVideoCapabilitySet(selectedImageToVideoCapability, currentImageToVideoInputMode),
    [currentImageToVideoInputMode, selectedImageToVideoCapability],
  );
  const selectedMultiParamCapability = useMemo(() => {
    return (
      multiParamCapabilities.find((item) => item.id === multiRefModel) ||
      multiParamCapabilities.find((item) => item.id === multiParamDefaultModel) ||
      pickFallbackVideoCapability(FALLBACK_MULTI_PARAM_CAPABILITIES, "doubao-seedance-2-0-260128") ||
      null
    );
  }, [multiParamCapabilities, multiParamDefaultModel, multiRefModel]);
  const selectedMultiParamCapabilitySet = useMemo(
    () => getMultiParamCapabilitySet(selectedMultiParamCapability),
    [selectedMultiParamCapability],
  );
  const selectedStartEndCapability = useMemo(() => {
    return (
      startEndCapabilities.find((item) => item.id === startEndModel) ||
      startEndCapabilities.find((item) => item.id === startEndDefaultModel) ||
      pickFallbackVideoCapability(FALLBACK_START_END_CAPABILITIES, DEFAULT_START_END_MODEL) ||
      null
    );
  }, [startEndCapabilities, startEndDefaultModel, startEndModel]);
  const selectedStartEndCapabilitySet = useMemo(
    () => getStartEndCapabilitySet(selectedStartEndCapability),
    [selectedStartEndCapability],
  );
  const supportsCurrentImageToVideoInput = useMemo(() => {
    if (!selectedImageToVideoCapability) return false;
    if (currentImageToVideoInputMode === "single_reference") {
      return Boolean(selectedImageToVideoCapability.supportsSingleReference);
    }
    return Boolean(selectedImageToVideoCapability.supportsTextToVideo);
  }, [currentImageToVideoInputMode, selectedImageToVideoCapability]);
  const imageToVideoRequiresReference = Boolean(
    selectedImageToVideoCapability &&
      !selectedImageToVideoCapability.supportsTextToVideo &&
      selectedImageToVideoCapability.supportsSingleReference,
  );
  const imageToVideoCapabilityStatus =
    selectedImageToVideoCapabilitySet?.status || selectedImageToVideoCapability?.status || "experimental";
  const imageToVideoCapabilityNote =
    selectedImageToVideoCapabilitySet?.note ||
    selectedImageToVideoCapability?.note ||
    imageToVideoCapabilityNotice;
  const startEndCapabilityStatus =
    selectedStartEndCapabilitySet?.status || selectedStartEndCapability?.status || "experimental";
  const startEndCapabilityNote =
    selectedStartEndCapabilitySet?.note ||
    selectedStartEndCapability?.note ||
    startEndCapabilityNotice;
  const startEndInputNotice = useMemo(() => {
    if (!selectedStartEndCapability) return null;
    if (
      selectedStartEndCapability.supportsStartEndFrame === false ||
      selectedStartEndCapabilitySet?.supported === false
    ) {
      return "当前模型在首尾帧模式不可用，请切换到支持该模式的模型。";
    }
    if (!startFrame?.url && !endFrame?.url) {
      return "首尾帧模式需要同时上传首帧和尾帧。";
    }
    if (!startFrame?.url) {
      return "当前缺少首帧，首尾帧模式必须同时提供首帧和尾帧。";
    }
    if (!endFrame?.url) {
      return "当前缺少尾帧，首尾帧模式必须同时提供首帧和尾帧。";
    }
    return "已上传首帧和尾帧，当前会严格按首尾帧能力生成视频。";
  }, [endFrame?.url, selectedStartEndCapability, selectedStartEndCapabilitySet?.supported, startFrame?.url]);
  const imageToVideoInputNotice = useMemo(() => {
    if (!selectedImageToVideoCapability) return null;
    if (
      !selectedImageToVideoCapability.supportsTextToVideo &&
      !selectedImageToVideoCapability.supportsSingleReference
    ) {
      return "当前模型在图生视频页暂不可用，请切换到支持文生或单参考图的模型。";
    }
    if (referenceImage?.url && !selectedImageToVideoCapability.supportsSingleReference) {
      return "当前模型不支持单参考图视频，请移除参考图或切换到支持单参考图的模型。";
    }
    if (!referenceImage?.url && imageToVideoRequiresReference) {
      return "当前模型只支持单参考图视频，请先上传参考图，或切换到 grok-video-3 进行纯文生视频。";
    }
    if (referenceImage?.url) {
      return "已上传参考图，当前会按单参考图视频方式生成。";
    }
    return "未上传参考图时将按纯文本视频生成；上传参考图后会自动切换为单参考图视频。";
  }, [imageToVideoRequiresReference, referenceImage?.url, selectedImageToVideoCapability]);

  const canStartGeneration = useMemo(() => {
    if (!prompt.trim()) return false;
    if (videoMode === "image_to_video") {
      return supportsCurrentImageToVideoInput;
    }
    if (videoMode === "start_end_frame") {
      const supportsStartEnd =
        selectedStartEndCapability?.supportsStartEndFrame !== false &&
        selectedStartEndCapabilitySet?.supported !== false;
      return Boolean(startFrame?.url) && Boolean(endFrame?.url) && Boolean(supportsStartEnd);
    }
    return true;
  }, [
    prompt,
    selectedStartEndCapability?.supportsStartEndFrame,
    selectedStartEndCapabilitySet?.supported,
    startFrame?.url,
    endFrame?.url,
    supportsCurrentImageToVideoInput,
    videoMode,
  ]);

  const availableResolutionOptions = useMemo(() => {
    if (videoMode === "image_to_video") {
      const options = selectedImageToVideoCapabilitySet?.supportedResolutions?.filter(Boolean);
      return options?.length ? options : IMAGE_TO_VIDEO_RESOLUTION_OPTIONS;
    }
    if (videoMode === "start_end_frame") {
      const options = selectedStartEndCapabilitySet?.supportedResolutions?.filter(Boolean);
      return options?.length ? options : START_END_RESOLUTION_OPTIONS;
    }
    if (videoMode === "multi_param") {
      const options = selectedMultiParamCapabilitySet?.supportedResolutions?.filter(Boolean);
      return options?.length ? options : MULTI_PARAM_RESOLUTION_OPTIONS;
    }
    return GENERAL_VIDEO_RESOLUTION_OPTIONS;
  }, [selectedImageToVideoCapabilitySet, selectedMultiParamCapabilitySet, selectedStartEndCapabilitySet, videoMode]);
  const availableDurationOptions = useMemo(() => {
    if (videoMode === "image_to_video") {
      const options = selectedImageToVideoCapabilitySet?.supportedDurations?.filter(Boolean);
      return options?.length ? options : FIXED_DURATION_OPTIONS;
    }
    if (videoMode === "start_end_frame") {
      const options = selectedStartEndCapabilitySet?.supportedDurations?.filter(Boolean);
      return options?.length ? options : FIXED_DURATION_OPTIONS;
    }
    if (videoMode === "multi_param") {
      const options = selectedMultiParamCapabilitySet?.supportedDurations?.filter(Boolean);
      return options?.length ? options : FIXED_DURATION_OPTIONS;
    }
    return GENERAL_DURATION_OPTIONS;
  }, [selectedImageToVideoCapabilitySet, selectedMultiParamCapabilitySet, selectedStartEndCapabilitySet, videoMode]);
  const availableAspectRatioOptions = useMemo(() => {
    if (videoMode === "image_to_video") {
      const options = selectedImageToVideoCapabilitySet?.supportedAspectRatios?.filter(Boolean);
      return options?.length ? options : FIXED_ASPECT_RATIO_OPTIONS;
    }
    if (videoMode === "start_end_frame") {
      const options = selectedStartEndCapabilitySet?.supportedAspectRatios?.filter(Boolean);
      return options?.length ? options : FIXED_ASPECT_RATIO_OPTIONS;
    }
    if (videoMode === "multi_param") {
      const options = selectedMultiParamCapabilitySet?.supportedAspectRatios?.filter(Boolean);
      return options?.length ? options : FIXED_ASPECT_RATIO_OPTIONS;
    }
    return GENERAL_ASPECT_RATIO_OPTIONS;
  }, [selectedImageToVideoCapabilitySet, selectedMultiParamCapabilitySet, selectedStartEndCapabilitySet, videoMode]);

  const loadData = async () => {
    setLoading(true);
    try {
      const capabilityResponsePromise = getCreateVideoCapabilities("image_to_video").catch(() => null);
      const multiParamCapabilityResponsePromise =
        getCreateVideoCapabilities("multi_param").catch(() => null);
      const startEndCapabilityResponsePromise =
        getCreateVideoCapabilities("start_end_frame").catch(() => null);
      const [videoResponse, taskResponse] = await Promise.all([
        listCreateVideos(),
        listTasks(undefined, "create_video_generate"),
      ]);
      setResults(videoResponse.items);
      setTasks(taskResponse.items.slice(0, 100));
      setLoading(false);
      const [
        capabilityResponse,
        multiParamCapabilityResponse,
        startEndCapabilityResponse,
      ] = await Promise.all([
        capabilityResponsePromise,
        multiParamCapabilityResponsePromise,
        startEndCapabilityResponsePromise,
      ]);
      if (capabilityResponse?.items?.length) {
        setImageToVideoCapabilities(enrichVideoCapabilities(capabilityResponse.items));
        setImageToVideoDefaultModel(capabilityResponse.defaultModel || DEFAULT_I2V_MODEL);
        setImageToVideoCapabilityNotice(null);
      } else {
        setImageToVideoCapabilities(FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES);
        setImageToVideoDefaultModel(DEFAULT_I2V_MODEL);
        setImageToVideoCapabilityNotice("能力接口暂不可用，已回退到本地模型目录。");
      }
      if (multiParamCapabilityResponse?.items?.length) {
        setMultiParamCapabilities(enrichVideoCapabilities(multiParamCapabilityResponse.items));
        setMultiParamDefaultModel(multiParamCapabilityResponse.defaultModel || "doubao-seedance-2-0-260128");
        setMultiParamCapabilityNotice(null);
      } else {
        setMultiParamCapabilities(FALLBACK_MULTI_PARAM_CAPABILITIES);
        setMultiParamDefaultModel("doubao-seedance-2-0-260128");
        setMultiParamCapabilityNotice("多参模型能力接口暂不可用，已回退到本地模型目录。");
      }
      if (startEndCapabilityResponse?.items?.length) {
        setStartEndCapabilities(enrichVideoCapabilities(startEndCapabilityResponse.items));
        setStartEndDefaultModel(startEndCapabilityResponse.defaultModel || DEFAULT_START_END_MODEL);
        setStartEndCapabilityNotice(null);
      } else {
        setStartEndCapabilities(FALLBACK_START_END_CAPABILITIES);
        setStartEndDefaultModel(DEFAULT_START_END_MODEL);
        setStartEndCapabilityNotice("首尾帧模型能力接口暂不可用，已回退到本地模型目录。");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    setPreviewItem(null);
    setSyncDraft(null);
    setSyncNotice(null);
    void loadData();
  }, [actorId]);

  useEffect(() => {
    const clearMultiDrop = () => setMultiDropSlot(null);
    window.addEventListener("dragend", clearMultiDrop);
    return () => window.removeEventListener("dragend", clearMultiDrop);
  }, []);

  useEffect(() => {
    if (videoMode !== "image_to_video") return;
    if (imageToVideoCapabilities.some((item) => item.id === model)) return;
    setModel(imageToVideoDefaultModel || DEFAULT_I2V_MODEL);
  }, [imageToVideoCapabilities, imageToVideoDefaultModel, model, videoMode]);

  useEffect(() => {
    if (videoMode !== "multi_param") return;
    if (multiParamCapabilities.some((item) => item.id === multiRefModel)) return;
    setMultiRefModel(multiParamDefaultModel || "doubao-seedance-2-0-260128");
  }, [multiParamCapabilities, multiParamDefaultModel, multiRefModel, videoMode]);

  useEffect(() => {
    if (videoMode !== "start_end_frame") return;
    if (startEndCapabilities.some((item) => item.id === startEndModel)) return;
    setStartEndModel(startEndDefaultModel || DEFAULT_START_END_MODEL);
  }, [startEndCapabilities, startEndDefaultModel, startEndModel, videoMode]);

  useEffect(() => {
    if (!availableResolutionOptions.some((option) => option === resolution)) {
      setResolution(availableResolutionOptions[0]);
    }
  }, [availableResolutionOptions, resolution]);

  useEffect(() => {
    if (!availableDurationOptions.some((option) => option === duration)) {
      setDuration(availableDurationOptions[0]);
    }
  }, [availableDurationOptions, duration]);

  useEffect(() => {
    if (!availableAspectRatioOptions.some((option) => option === aspectRatio)) {
      setAspectRatio(availableAspectRatioOptions[0]);
    }
  }, [aspectRatio, availableAspectRatioOptions]);

  useEffect(() => {
    let cancelled = false;
    const candidates = [...results, ...(previewItem ? [previewItem] : [])]
      .map((item) => playableVideoUrl(item))
      .filter((url): url is string => Boolean(url))
      .filter((url) => !derivedVideoMetadata[url] && !videoOutputMetadataCache.has(url));

    if (!candidates.length) {
      return;
    }

    const uniqueCandidates = Array.from(new Set(candidates));
    void Promise.all(
      uniqueCandidates.map(async (url) => {
        const metadata = await readVideoOutputMetadata(url);
        if (cancelled) return;
        setDerivedVideoMetadata((current) => {
          if (current[url]) return current;
          return { ...current, [url]: metadata };
        });
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [derivedVideoMetadata, previewItem, results]);

  const filteredResults = useMemo(() => {
    return results.filter((item) => {
      const matchQuery =
        !historyQuery ||
        item.prompt.includes(historyQuery) ||
        item.duration.includes(historyQuery) ||
        item.outputDuration?.includes(historyQuery) ||
        item.aspectRatio.includes(historyQuery) ||
        item.outputAspectRatio?.includes(historyQuery) ||
        item.taskId?.includes(historyQuery);
      const matchModel = historyModel === "all" || item.model === historyModel;
      return matchQuery && matchModel;
    });
  }, [historyModel, historyQuery, results]);

  const taskProjectIdByTaskId = useMemo(() => {
    const next = new Map<string, string>();
    for (const task of tasks) {
      const taskProjectId = resolveTaskProjectId(task);
      if (taskProjectId) {
        next.set(task.id, taskProjectId);
      }
    }
    return next;
  }, [tasks]);

  const totalPages = Math.max(1, Math.ceil(filteredResults.length / VIDEO_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const pagedResults = useMemo(() => {
    const startIndex = (currentPage - 1) * VIDEO_PAGE_SIZE;
    return filteredResults.slice(startIndex, startIndex + VIDEO_PAGE_SIZE);
  }, [filteredResults, currentPage]);

  useEffect(() => {
    // 搜索或模型筛选变化时重置到第一页
    setPage(1);
  }, [historyModel, historyQuery]);

  const modelOptions = useMemo(
    () => ["all", ...Array.from(new Set(results.map((item) => item.model)))],
    [results],
  );

  const recentTasks = useMemo(() => tasks.slice(0, 6), [tasks]);
  const previewVideoUrl = previewItem ? playableVideoUrl(previewItem) : null;
  const previewVideoMetadata = previewVideoUrl ? derivedVideoMetadata[previewVideoUrl] : null;
  const hasActiveTasks = useMemo(
    () => tasks.some((item) => item.status === "queued" || item.status === "running"),
    [tasks],
  );

  useEffect(() => {
    if (!hasActiveTasks) return;

    const timer = window.setInterval(() => {
      void loadData();
    }, 4000);

    return () => window.clearInterval(timer);
  }, [hasActiveTasks]);

  const handleDismissTask = async (id: string) => {
    await deleteTask(id);
    setTasks((current) => current.filter((task) => task.id !== id));
  };

  const handleClearTasks = async () => {
    await clearTasks(currentProjectId, "create_video_generate");
    setTasks([]);
    setConfirmClearTasksOpen(false);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    if (!canStartGeneration) return;
    if (generatingRef.current) return;
    generatingRef.current = true;

    const multiPayload = videoMode === "multi_param" ? buildMultiReferencePayload(multiRefSlots) : undefined;
    const effectiveModel =
      videoMode === "multi_param"
        ? multiPayload && Object.keys(multiPayload).length
          ? multiRefModel
          : multiParamDefaultModel || "doubao-seedance-2-0-260128"
        : videoMode === "start_end_frame"
          ? startEndModel
          : model;

    setGenerating(true);
    setGenerateError(null);
    try {
      await generateCreateVideos({
        projectId: currentProjectId,
        prompt,
        model: effectiveModel,
        duration,
        aspectRatio,
        resolution,
        motionStrength,
        keepConsistency,
        videoMode,
        ...(videoMode === "image_to_video" && referenceImage?.url
          ? { referenceImageUrl: referenceImage.url }
          : {}),
        ...(videoMode === "start_end_frame" && startFrame?.url && endFrame?.url
          ? {
              firstFrameUrl: startFrame.url,
              lastFrameUrl: endFrame.url,
            }
          : {}),
        ...(videoMode === "multi_param" && multiPayload ? { multiReferenceImages: multiPayload } : {}),
        idempotencyKey: newIdempotencyKey(),
      });
      await loadData();
    } catch (error) {
      const parsed = parseGenerationError(error);
      setGenerateError(parsed.message);
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  };

  const handleDeleteVideo = async (id: string) => {
    try {
      await deleteCreateVideo(id);
      setResults((prev) => prev.filter((item) => item.id !== id));
      if (previewItem?.id === id) setPreviewItem(null);
    } catch {
      window.alert("删除失败，请稍后重试。");
    }
  };

  // ── Manual sync (result → project asset library, manual) ──────────
  const openAssetSync = (item: CreateVideoResult) => {
    const targetProjectId = item.taskId ? taskProjectIdByTaskId.get(item.taskId) || null : null;
    setSyncDraft(buildVideoAssetDraft(item, targetProjectId));
    setSyncDragActive(false);
    setDraggingItem(null);
  };

  const handleResultDragStart = (event: DragEvent<HTMLElement>, item: CreateVideoResult) => {
    const targetProjectId = item.taskId ? taskProjectIdByTaskId.get(item.taskId) || null : null;
    const draft = buildVideoAssetDraft(item, targetProjectId);
    draggingRef.current = draft;
    setDraggingItem(draft);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draft.id);
  };

  const handleResultDragEnd = () => {
    draggingRef.current = null;
    setDraggingItem(null);
    setSyncDragActive(false);
  };

  const handleSyncDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setSyncDragActive(true);
  };

  const handleSyncDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setSyncDragActive(false);
  };

  const handleSyncDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const item = draggingRef.current;
    if (!item) return;
    setSyncDraft(item);
    draggingRef.current = null;
    setDraggingItem(null);
    setSyncDragActive(false);
  };

  const handleSyncSubmit = async (input: Parameters<typeof createAsset>[1]) => {
    setSyncingAsset(true);
    try {
      let targetProjectId = syncDraft?.targetProjectId || null;
      const syncTaskId = typeof syncDraft?.taskId === "string" ? syncDraft.taskId.trim() : "";
      if (!targetProjectId && syncTaskId) {
        try {
          targetProjectId = resolveTaskProjectId(await getTask(syncTaskId));
        } catch {
          targetProjectId = null;
        }
      }
      const asset = await createAsset(targetProjectId || currentProjectId, input);
      setSyncNotice(`已同步到资产库：${asset.name}`);
      setSyncDraft(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "同步到资产库失败，请稍后重试。";
      setSyncNotice(message);
      window.alert(message);
    } finally {
      setSyncingAsset(false);
    }
  };

  useEffect(() => {
    if (!syncNotice) return;
    const timer = window.setTimeout(() => setSyncNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [syncNotice]);

  const handleReferenceUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const prepared = await prepareReferenceUploadFile(file);
      const uploaded = await uploadFile(prepared.file, "create-video-reference");
      setReferenceImage({
        id: uploaded.id,
        url: uploaded.url,
        originalName: uploaded.originalName,
        source: "upload",
      });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Reference upload failed. Please try again.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const handleFrameUpload = async (event: ChangeEvent<HTMLInputElement>, slot: "start" | "end") => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingSlot(slot);
    try {
      const prepared = await prepareReferenceUploadFile(file);
      const uploaded = await uploadFile(prepared.file, "create-video-frame");
      const next: ReferenceImageState = {
        id: uploaded.id,
        url: uploaded.url,
        originalName: uploaded.originalName,
        source: "upload",
      };
      if (slot === "start") setStartFrame(next);
      else setEndFrame(next);
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : slot === "start"
            ? "Start frame upload failed. Please try again."
            : "End frame upload failed. Please try again."
      );
    } finally {
      setUploadingSlot(null);
      event.target.value = "";
    }
  };

  const applyReferenceAsset = (asset: ReferenceAssetSelection) => {
    setReferenceImage({
      id: asset.id,
      url: asset.url,
      originalName: asset.name,
      source: "asset",
      assetId: asset.id,
    });
    setReferenceDropActive(false);
  };

  const applyStartFrameAsset = (asset: ReferenceAssetSelection) => {
    setStartFrame({
      id: asset.id,
      url: asset.url,
      originalName: asset.name,
      source: "asset",
      assetId: asset.id,
    });
    setStartDropActive(false);
  };

  const applyEndFrameAsset = (asset: ReferenceAssetSelection) => {
    setEndFrame({
      id: asset.id,
      url: asset.url,
      originalName: asset.name,
      source: "asset",
      assetId: asset.id,
    });
    setEndDropActive(false);
  };

  const handleReferenceDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(REFERENCE_ASSET_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setReferenceDropActive(true);
  };

  const handleReferenceDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setReferenceDropActive(false);
  };

  const handleReferenceDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const payload = event.dataTransfer.getData(REFERENCE_ASSET_MIME);
    if (!payload) {
      setReferenceDropActive(false);
      return;
    }

    try {
      applyReferenceAsset(JSON.parse(payload) as ReferenceAssetSelection);
    } catch {
      setReferenceDropActive(false);
    }
  };

  const handleStartFrameDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(REFERENCE_ASSET_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setStartDropActive(true);
  };

  const handleEndFrameDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(REFERENCE_ASSET_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setEndDropActive(true);
  };

  const handleStartFrameDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setStartDropActive(false);
  };

  const handleEndFrameDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setEndDropActive(false);
  };

  const handleStartFrameDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setStartDropActive(false);
    const payload = event.dataTransfer.getData(REFERENCE_ASSET_MIME);
    if (!payload) return;
    try {
      applyStartFrameAsset(JSON.parse(payload) as ReferenceAssetSelection);
    } catch {
      /* ignore */
    }
  };

  const handleEndFrameDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setEndDropActive(false);
    const payload = event.dataTransfer.getData(REFERENCE_ASSET_MIME);
    if (!payload) return;
    try {
      applyEndFrameAsset(JSON.parse(payload) as ReferenceAssetSelection);
    } catch {
      /* ignore */
    }
  };

  const handleMultiSlotUpload = async (event: ChangeEvent<HTMLInputElement>, slot: VideoMultiReferenceKey) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setUploadingMultiSlot(slot);
    try {
      const uploadedItems = await Promise.all(
        files.map(async (file) => {
          const prepared = await prepareReferenceUploadFile(file);
          const uploaded = await uploadFile(prepared.file, "create-video-multi-ref");
          return {
            id: uploaded.id,
            url: uploaded.url,
            originalName: uploaded.originalName,
            source: "upload" as const,
          };
        }),
      );
      setMultiRefSlots((prev) => ({
        ...prev,
        [slot]: appendMultiRefItems(prev[slot], uploadedItems),
      }));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Reference upload failed. Please try again.");
    } finally {
      setUploadingMultiSlot(null);
      event.target.value = "";
    }
  };

  const applyMultiSlotAsset = (slot: VideoMultiReferenceKey, asset: ReferenceAssetSelection) => {
    setMultiRefSlots((prev) => ({
      ...prev,
      [slot]: appendMultiRefItems(prev[slot], [
        {
          id: asset.id,
          url: asset.url,
          originalName: asset.name,
          source: "asset",
          assetId: asset.id,
        },
      ]),
    }));
    setMultiDropSlot(null);
  };

  const removeMultiSlotAsset = (slot: VideoMultiReferenceKey, assetId: string) => {
    setMultiRefSlots((prev) => ({
      ...prev,
      [slot]: prev[slot].filter((item) => (item.assetId || item.id) !== assetId),
    }));
  };

  const handleMultiSlotDragOver = (slot: VideoMultiReferenceKey) => (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(REFERENCE_ASSET_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setMultiDropSlot(slot);
  };

  const handleMultiSlotDragLeave = (slot: VideoMultiReferenceKey) => (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setMultiDropSlot((cur) => (cur === slot ? null : cur));
  };

  const handleMultiSlotDropAsset = (slot: VideoMultiReferenceKey) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setMultiDropSlot(null);
    const payload = event.dataTransfer.getData(REFERENCE_ASSET_MIME);
    if (!payload) return;
    try {
      applyMultiSlotAsset(slot, JSON.parse(payload) as ReferenceAssetSelection);
    } catch {
      /* ignore */
    }
  };

  const clearMultiSlot = (slot: VideoMultiReferenceKey) => {
    setMultiRefSlots((prev) => ({ ...prev, [slot]: [] }));
  };

  const renderMultiRefSlotRow = (slot: VideoMultiReferenceKey, importVerb: string) => {
    const items = multiRefSlots[slot];
    const st = items[0] || null;
    const isTarget = multiAssetTarget === slot;
    const dropActive = multiDropSlot === slot;
  return (
      <div
        key={slot}
        onDragOver={videoMode === "multi_param" ? handleMultiSlotDragOver(slot) : undefined}
        onDragLeave={videoMode === "multi_param" ? handleMultiSlotDragLeave(slot) : undefined}
        onDrop={videoMode === "multi_param" ? handleMultiSlotDropAsset(slot) : undefined}
        className={cn(
          "rounded-xl border border-border/80 bg-background/30 p-2.5 transition-colors",
          isTarget ? "border-primary/50 ring-1 ring-primary/25" : "",
          dropActive ? "border-primary/70 bg-primary/10 ring-1 ring-primary/30" : "",
        )}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-foreground">{MULTI_REF_LABELS[slot]}</span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setMultiAssetTarget(slot)}
              className={cn(
                "rounded-md border px-2 py-1 text-[10px] font-medium transition-colors",
                isTarget
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40",
              )}
            >
              {importVerb}
            </button>
            <label
              className={cn(
                "cursor-pointer rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary",
              )}
            >
              {uploadingMultiSlot === slot ? (
                <LoaderCircle className="inline h-3 w-3 animate-spin" />
              ) : (
                "上传"
              )}
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => void handleMultiSlotUpload(e, slot)}
              />
            </label>
            {st ? (
              <button
                type="button"
                onClick={() => clearMultiSlot(slot)}
                className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title="清除"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
        {st ? (
          <div className="overflow-hidden rounded-lg border border-border">
            <img
              src={getGeneratedMediaUrl(st.url) || undefined}
              alt={st.originalName}
              className="aspect-video w-full cursor-zoom-in object-cover"
              referrerPolicy="no-referrer"
              onDoubleClick={() =>
                setReferencePreview({
                  url: getGeneratedMediaUrl(st.url) || st.url,
                  title: `${MULTI_REF_LABELS[slot]}：${st.originalName || "参考图"}`,
                })
              }
              title="双击放大查看原图"
            />
            <div className="truncate border-t border-border bg-muted/20 px-2 py-1 text-[10px] text-muted-foreground">
              {st.originalName}
              {items.length > 1 ? ` 等${items.length}张` : ""}
            </div>
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground/80">
            {dropActive ? "松开即可填入该分类" : "未选择"}
          </p>
        )}
      </div>
    );
  };

  return (
    <CreateStudioSplitLayout
      pageKey="video-create"
      sidebar={
        <>
          <div className="shrink-0 border-b border-border p-4">
          <h2 className="flex items-center gap-2 font-medium">
            <Settings2 className="h-4 w-4 text-primary" />
            生成参数
          </h2>
        </div>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overflow-x-hidden p-4 custom-scrollbar">
          <p className="rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
            当前模式：
            <span className="font-medium text-foreground">
              {VIDEO_MODE_TABS.find((t) => t.id === videoMode)?.label}
            </span>
            · {VIDEO_MODE_TABS.find((t) => t.id === videoMode)?.hint}
          </p>

          {videoMode === "image_to_video" ? (
            <>
          <div
            className={cn(
              "space-y-2 rounded-2xl border border-transparent p-1 transition-colors",
              referenceDropActive ? "border-primary/50 bg-primary/5" : "",
            )}
            onDragOver={handleReferenceDragOver}
            onDragLeave={handleReferenceDragLeave}
            onDrop={handleReferenceDrop}
          >
            <label className="text-sm font-medium">参考图</label>
            <label
              className={cn(
                "flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-sm transition-colors hover:border-primary/50 hover:text-primary",
                referenceDropActive ? "border-primary bg-primary/10 text-primary" : "",
              )}
            >
              {uploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              上传参考图
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => void handleReferenceUpload(event)}
              />
            </label>
            {referenceImage ? (
                  <div className="relative overflow-hidden rounded-lg border border-border bg-muted/20">
                    <button
                      type="button"
                      onClick={() => setReferenceImage(null)}
                      className="absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/70 bg-background/85 text-muted-foreground shadow-sm transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                      title="移除当前参考图"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <img
                      src={getGeneratedMediaUrl(referenceImage.url) || undefined}
                  alt={referenceImage.originalName}
                      className="aspect-video w-full cursor-zoom-in object-cover"
                  referrerPolicy="no-referrer"
                      onDoubleClick={() =>
                        setReferencePreview({
                          url: getGeneratedMediaUrl(referenceImage.url) || referenceImage.url,
                          title: referenceImage.originalName || "参考图",
                        })
                      }
                      title="双击放大查看原图"
                />
                <div className="flex items-center justify-between border-t border-border bg-background/80 px-3 py-2 text-[11px] text-muted-foreground">
                  <span className="truncate">{referenceImage.originalName}</span>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
                    {referenceImage.source === "asset" ? "资产库" : "本地上传"}
                  </span>
                </div>
              </div>
            ) : null}
            <p className="text-[11px] leading-5 text-primary/80">
                  可从下方资产库点选，或拖拽素材到此处。
            </p>
          </div>

          <ReferenceAssetPicker
            projectId={currentProjectId}
            selectedAssetId={referenceImage?.source === "asset" ? referenceImage.assetId || null : null}
            onSelect={applyReferenceAsset}
          />

              <div className="hidden rounded-xl border border-primary/20 bg-primary/8 px-3 py-2 text-[11px] leading-5 text-primary">
                当前图生视频会按所选模型的真实可用能力执行；<span className="font-medium">veo3.1-pro</span> 与 <span className="font-medium">veo3.1</span> 的单参考图链路已验证可用。
              </div>

              <div className="rounded-xl border border-amber-600/40 bg-amber-500/15 px-3 py-2 text-[11px] leading-5 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                当前图生视频建议优先使用 <span className="font-medium">PixVerse V6</span> 或 <span className="font-medium">PixVerse C1</span>；
                旧的 Yunwu <span className="font-medium">veo3.1</span> / <span className="font-medium">veo3.1-pro</span> 仅保留兼容，不再作为主推荐模型。
              </div>

          <div className="space-y-2">
                <label className="text-sm font-medium">图生视频模型</label>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
                  {imageToVideoCapabilities.map((option) => (
                    <option key={option.id} value={option.id}>
                      {imageToVideoModelLabel(option)}（{capabilityStatusLabel(
                        getImageToVideoOptionStatus(option, currentImageToVideoInputMode),
                      )}）
                </option>
              ))}
            </select>
            <p className="text-[11px] leading-5 text-muted-foreground">
                  {imageToVideoCapabilityNote}
                </p>
                <div className="flex items-center justify-between gap-3 text-[11px]">
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2 py-0.5 font-medium",
                      capabilityStatusTone(imageToVideoCapabilityStatus),
                    )}
                  >
                    {capabilityStatusLabel(imageToVideoCapabilityStatus)}
                  </span>
                  <span className="text-muted-foreground">
                    {currentImageToVideoInputMode === "single_reference" ? "当前输入：单参考图视频" : "当前输入：纯文本视频"}
                  </span>
          </div>
                {imageToVideoInputNotice ? (
                  <div
                    className={cn(
                      "rounded-xl border px-3 py-2 text-[11px] leading-5",
                      imageToVideoRequiresReference && !referenceImage?.url
                        ? "border-amber-600/40 bg-amber-500/15 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                        : "border-border/60 bg-background/40 text-muted-foreground",
                    )}
                  >
                    {imageToVideoInputNotice}
                  </div>
                ) : null}
                {imageToVideoCapabilityNotice ? (
                  <div className="rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                    {imageToVideoCapabilityNotice}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {videoMode === "start_end_frame" ? (
            <>
              <div
                className={cn(
                  "space-y-2 rounded-2xl border border-transparent p-1 transition-colors",
                  startDropActive ? "border-primary/50 bg-primary/5" : "",
                )}
                onDragOver={handleStartFrameDragOver}
                onDragLeave={handleStartFrameDragLeave}
                onDrop={handleStartFrameDrop}
              >
                <label className="text-sm font-medium">首帧（必填）</label>
                <label
                  className={cn(
                    "flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-sm transition-colors hover:border-primary/50 hover:text-primary",
                    startDropActive ? "border-primary bg-primary/10 text-primary" : "",
                  )}
                >
                  {uploadingSlot === "start" ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  上传首帧
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => void handleFrameUpload(event, "start")}
                  />
                </label>
                {startFrame ? (
                  <div className="relative overflow-hidden rounded-lg border border-border bg-muted/20">
                    <button
                      type="button"
                      onClick={() => setStartFrame(null)}
                      className="absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/70 bg-background/85 text-muted-foreground shadow-sm transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                      title="移除当前首帧"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <img
                      src={getGeneratedMediaUrl(startFrame.url) || undefined}
                      alt={startFrame.originalName}
                      className="aspect-video w-full cursor-zoom-in object-cover"
                      referrerPolicy="no-referrer"
                      onDoubleClick={() =>
                        setReferencePreview({
                          url: getGeneratedMediaUrl(startFrame.url) || startFrame.url,
                          title: startFrame.originalName || "首帧",
                        })
                      }
                      title="双击放大查看原图"
                    />
                    <div className="flex items-center justify-between border-t border-border bg-background/80 px-3 py-2 text-[11px] text-muted-foreground">
                      <span className="truncate">{startFrame.originalName}</span>
                    </div>
                  </div>
                ) : null}
              </div>

              <div
                className={cn(
                  "space-y-2 rounded-2xl border border-transparent p-1 transition-colors",
                  endDropActive ? "border-primary/50 bg-primary/5" : "",
                )}
                onDragOver={handleEndFrameDragOver}
                onDragLeave={handleEndFrameDragLeave}
                onDrop={handleEndFrameDrop}
              >
                <label className="text-sm font-medium">尾帧（必填）</label>
                <label
                  className={cn(
                    "flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-sm transition-colors hover:border-primary/50 hover:text-primary",
                    endDropActive ? "border-primary bg-primary/10 text-primary" : "",
                  )}
                >
                  {uploadingSlot === "end" ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  上传尾帧
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => void handleFrameUpload(event, "end")}
                  />
                </label>
                {endFrame ? (
                  <div className="relative overflow-hidden rounded-lg border border-border bg-muted/20">
                    <button
                      type="button"
                      onClick={() => setEndFrame(null)}
                      className="absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/70 bg-background/85 text-muted-foreground shadow-sm transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                      title="移除当前尾帧"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <img
                      src={getGeneratedMediaUrl(endFrame.url) || undefined}
                      alt={endFrame.originalName}
                      className="aspect-video w-full cursor-zoom-in object-cover"
                      referrerPolicy="no-referrer"
                      onDoubleClick={() =>
                        setReferencePreview({
                          url: getGeneratedMediaUrl(endFrame.url) || endFrame.url,
                          title: endFrame.originalName || "尾帧",
                        })
                      }
                      title="双击放大查看原图"
                    />
                    <div className="flex items-center justify-between border-t border-border bg-background/80 px-3 py-2 text-[11px] text-muted-foreground">
                      <span className="truncate">{endFrame.originalName}</span>
                    </div>
                  </div>
                ) : null}
              </div>

              <ReferenceAssetPicker
                projectId={currentProjectId}
                selectedAssetId={startFrame?.source === "asset" ? startFrame.assetId || null : null}
                onSelect={applyStartFrameAsset}
                heading="从资产库选取首帧"
                hint="点击图片资产后将自动应用为首帧"
              />

              <ReferenceAssetPicker
                projectId={currentProjectId}
                selectedAssetId={endFrame?.source === "asset" ? endFrame.assetId || null : null}
                onSelect={applyEndFrameAsset}
                heading="从资产库选取尾帧"
                hint="点击图片资产后将自动应用为尾帧"
              />

              <div className="rounded-xl border border-primary/20 bg-primary/8 px-3 py-2 text-[11px] leading-5 text-primary">
                当前首尾帧模式会严格要求首帧与尾帧同时提供；默认优先按 <span className="font-medium">PixVerse V6</span> 的真实能力生成。
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">首尾帧模型</label>
                <select
                  value={startEndModel}
                  onChange={(event) => setStartEndModel(event.target.value)}
                  className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {startEndCapabilities.map((option) => (
                    <option key={option.id} value={option.id}>
                      {startEndModelLabel(option)}
                    </option>
                  ))}
                </select>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5",
                      capabilityStatusTone(startEndCapabilityStatus),
                    )}
                  >
                    {capabilityStatusLabel(startEndCapabilityStatus)}
                  </span>
                  <span className="text-muted-foreground">
                    当前模型{" "}
                    {withVeoVideoModelDisplayRemark(
                      selectedStartEndCapability?.id || startEndModel,
                      selectedStartEndCapability?.label || startEndModel,
                    )}{" "}
                    按真实首尾帧能力执行
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {startEndCapabilityNote ||
                    "当前首尾帧模式已接入能力表；不同模型的稳定性和参数范围以下拉状态为准。"}
                </p>
                {startEndInputNotice ? <p className="text-xs text-amber-800 dark:text-amber-300">{startEndInputNotice}</p> : null}
              </div>
            </>
          ) : null}

          {videoMode === "multi_param" ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-border/70 bg-background/35 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
                当前多参考视频会按所选模型的真实能力执行；不同模型的最多参考图数量和稳定性以下方能力表为准，系统仍会优先保留
                <span className="font-medium text-foreground"> scene / character / prop </span>
                这三类主参考图。
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">多参考视频模型</label>
                <select
                  value={multiRefModel}
                  onChange={(event) => setMultiRefModel(event.target.value)}
                  className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {multiParamCapabilities.map((option) => (
                    <option key={option.id} value={option.id}>
                      {multiParamModelLabel(option)}
                    </option>
                  ))}
                </select>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5",
                      capabilityStatusTone(
                        selectedMultiParamCapabilitySet?.status || selectedMultiParamCapability?.status || "experimental",
                      ),
                    )}
                  >
                    {capabilityStatusLabel(
                      selectedMultiParamCapabilitySet?.status || selectedMultiParamCapability?.status || "experimental",
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    当前接入最多 {selectedMultiParamCapability?.maxReferenceImages || 7} 张参考图
                  </span>
                  <span className="rounded-full border border-border/60 px-2 py-0.5 text-muted-foreground">
                    {selectedMultiParamCapability?.maxReferenceImagesSource === "official"
                      ? "官方上限"
                      : "当前接入上限"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {selectedMultiParamCapabilitySet?.note ||
                    selectedMultiParamCapability?.note ||
                    "当前多参考模型会按后端能力表路由到对应的 Yunwu 官方接口。"}
                </p>
                {multiParamCapabilityNotice ? (
                  <p className="text-xs text-amber-800 dark:text-amber-300">{multiParamCapabilityNotice}</p>
                ) : null}
              </div>
              <div className="hidden rounded-xl border border-border/70 bg-background/35 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
                多参考生成当前优先按 <span className="font-medium text-foreground">PixVerse C1 Fusion</span> 的真实能力执行。
                系统会按场景→角色→道具→姿态→表情→特效→手绘顺序组织参考信息，并优先保证前三张参考图的约束有效。
              </div>
              <div className="hidden space-y-2">
                <label className="text-sm font-medium">多参考视频模型</label>
                <select
                  value={multiRefModel}
                  onChange={(event) =>
                    setMultiRefModel(event.target.value as (typeof MULTI_REF_MODEL_OPTIONS)[number])
                  }
                  className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {MULTI_REF_MODEL_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {formatVideoResultModelDisplay(option)}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  当前多参生成会优先使用 PixVerse C1 Fusion；若能力接口不可用，则才回退到本地 fallback 模型目录。
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">主设定</p>
                <div className="space-y-2">
                  {renderMultiRefSlotRow("scene", "导入场景")}
                  {renderMultiRefSlotRow("character", "导入角色")}
                  {renderMultiRefSlotRow("prop", "导入道具")}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">其他参考</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {renderMultiRefSlotRow("pose", "导入")}
                  {renderMultiRefSlotRow("expression", "导入")}
                  {renderMultiRefSlotRow("effect", "导入")}
                  {renderMultiRefSlotRow("sketch", "导入")}
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-border/60 bg-muted/10 p-2">
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  可将资产库中的素材卡片<strong className="font-medium text-foreground">拖拽</strong>到上方任意分类框；也可点击「导入」后在下方点选。
                </p>
                {multiAssetTarget ? (
                  <>
                    <p className="text-[11px] text-primary">
                      正在为「{MULTI_REF_LABELS[multiAssetTarget]}」选择资产，点选下方缩略图即可填入。
                    </p>
                    <ReferenceAssetPicker
                      projectId={currentProjectId}
                      selectedAssetId={null}
                      selectedAssetIds={multiRefSlots[multiAssetTarget].flatMap((item) =>
                        item.source === "asset" ? [item.assetId || item.id] : [],
                      )}
                      onSelect={(asset) => applyMultiSlotAsset(multiAssetTarget, asset)}
                      onToggleSelect={(asset, selected) => {
                        if (selected) {
                          applyMultiSlotAsset(multiAssetTarget, asset);
                          return;
                        }
                        removeMultiSlotAsset(multiAssetTarget, asset.id);
                      }}
                    />
                  </>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    点击某一类旁的「导入…」后，在下方资产库中选择图片。
                  </p>
                )}
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <label className="text-sm font-medium">视频时长</label>
            <div className={cn("grid gap-2", availableDurationOptions.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
              {availableDurationOptions.map((item) => (
                <button
                  key={item}
                  onClick={() => setDuration(item)}
                  className={cn(
                    "rounded-md border py-2 text-xs font-medium transition-colors",
                    duration === item
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-primary/50",
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
            {videoMode === "multi_param" ? (
              <p className="text-xs text-muted-foreground">
                PixVerse C1 Fusion 的时长以后端能力表为准；当前按官方支持 5s / 8s。
              </p>
            ) : null}
            {videoMode === "start_end_frame" ? (
              <p className="text-xs text-muted-foreground">
                首尾帧模式现在严格要求首帧和尾帧都必填；PixVerse 首尾帧按官方支持 1s–15s。
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">画幅比例</label>
            <div
              className={cn(
                "grid gap-2",
                availableAspectRatioOptions.length === 1 ? "grid-cols-1" : "grid-cols-3",
              )}
            >
              {availableAspectRatioOptions.map((ratio) => (
                <button
                  key={ratio}
                  onClick={() => setAspectRatio(ratio)}
                  className={cn(
                    "rounded-md border py-2 text-xs font-medium transition-colors",
                    aspectRatio === ratio
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-primary/50",
                  )}
                >
                  {ratio}
                </button>
              ))}
            </div>
            {videoMode === "multi_param" ? (
              <p className="text-xs text-muted-foreground">
                PixVerse C1 Fusion 的画幅以后端能力表为准；若官方支持显式画幅，则按官方可选项展示。
              </p>
            ) : null}
            {videoMode === "start_end_frame" ? (
              <p className="text-xs text-muted-foreground">
                PixVerse 首尾帧按官方 transition 接口执行；若官方不支持显式画幅，则统一按 adaptive 自动处理。
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">清晰度</label>
            <select
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {availableResolutionOptions.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
            {videoMode === "multi_param" ? (
              <p className="text-xs text-muted-foreground">
                PixVerse C1 Fusion 的清晰度以后端能力表为准；当前支持 360p / 540p / 720p / 1080p。
              </p>
            ) : null}
            {videoMode === "start_end_frame" ? (
              <p className="text-xs text-muted-foreground">
                PixVerse 首尾帧的清晰度以后端能力表为准；当前支持 360p / 540p / 720p / 1080p。
              </p>
            ) : null}
            {videoMode === "image_to_video" && model === "veo3.1-pro" ? (
              <p className="text-xs text-muted-foreground">
                云雾 `veo3.1-pro` 图生视频当前统一按增强模式执行，稳定输出仅保留 1080p。
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">运动强度</label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="1"
                max="10"
                value={motionStrength}
                onChange={(event) => setMotionStrength(Number(event.target.value))}
                className="flex-1 accent-primary"
              />
              <span className="w-4 text-right text-sm font-medium">{motionStrength}</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">保持一致性</label>
            <button
              onClick={() => setKeepConsistency((current) => !current)}
              className={cn(
                "relative h-5 w-10 rounded-full transition-colors",
                keepConsistency ? "bg-primary" : "bg-secondary",
              )}
            >
              <span
                className={cn(
                  "absolute top-1 h-3 w-3 rounded-full transition-all",
                  keepConsistency
                    ? "right-1 bg-primary-foreground"
                    : "left-1 bg-muted-foreground",
                )}
              />
            </button>
          </div>
        </div>
        </>
      }
    >
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border bg-card/30 px-6 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <Video className="h-5 w-5 text-primary" />
              视频创作
            </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                独立创作结果只做临时输出，可预览和下载。
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-border/60 bg-background/40 p-1">
              {VIDEO_MODE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setVideoMode(tab.id);
                    if (tab.id === "image_to_video") {
                      setResolution(DEFAULT_VIDEO_RESOLUTION);
                    } else if (tab.id === "start_end_frame") {
                      setResolution(DEFAULT_START_END_RESOLUTION);
                    }
                    setGenerateError(null);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all sm:text-sm",
                    videoMode === tab.id
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {tab.id === "multi_param" ? <Layers className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : null}
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 custom-scrollbar">
          <div className="glass-panel flex flex-col gap-4 rounded-2xl p-4">
              <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-4 py-3 text-xs leading-6 text-indigo-100">
                {videoMode === "image_to_video"
                  ? "图生视频：上传一张参考图，用提示词描述镜头动作；当前优先按 PixVerse V6 / PixVerse C1 的真实能力执行，旧 Yunwu 模型仅保留兼容。"
                  : videoMode === "start_end_frame"
                    ? "首尾帧：上传首帧与尾帧（都必填），用提示词补充过渡意图；当前默认优先走 PixVerse V6，并严格按官方接口生成。"
                    : "多参生成：上传多张参考图后由系统整理多参信息，并优先走 PixVerse C1 Fusion；能力、画幅、时长都以后端返回的真实能力表为准。"}
            </div>
            {videoMode === "image_to_video" ? (
              <div className="rounded-xl border border-border/60 bg-background/30 px-4 py-3 text-xs leading-6 text-muted-foreground">
                当前模型{" "}
                <span className="font-medium text-foreground">
                  {withVeoVideoModelDisplayRemark(model, selectedImageToVideoCapability?.label || model)}
                </span>
                处于“{capabilityStatusLabel(imageToVideoCapabilityStatus)}”状态。
                {!referenceImage?.url && imageToVideoRequiresReference
                  ? " 该模型只支持单参考图视频，请先上传参考图。"
                  : !referenceImage?.url
                    ? " 未上传参考图时会按纯文本视频生成。"
                    : " 已上传参考图，当前会按单参考图视频生成。"}
            </div>
            ) : null}
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="h-24 w-full resize-none bg-transparent text-sm leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none"
              placeholder="输入一段话，描述视频中的动作、变化和镜头语言"
            />

            <div className="flex items-center justify-end gap-3 border-t border-border pt-3">
              <button
                onClick={() => setPrompt("")}
                className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
              >
                <Trash2 className="h-4 w-4" />
                清空提示词
              </button>
              {videoMode === "image_to_video" && referenceImage ? (
                <button
                  onClick={() => setReferenceImage(null)}
                  className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
                >
                  <Upload className="h-4 w-4" />
                  清除参考图
                </button>
              ) : null}
              {videoMode === "start_end_frame" && (startFrame || endFrame) ? (
                <button
                  onClick={() => {
                    setStartFrame(null);
                    setEndFrame(null);
                  }}
                  className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
                >
                  <Upload className="h-4 w-4" />
                  清除首尾帧
                </button>
              ) : null}
              {videoMode === "multi_param" &&
              MULTI_REF_ORDER.some((key) => multiRefSlots[key].length > 0) ? (
                <button
                  onClick={() => {
                    setMultiRefSlots(createEmptyMultiRefSlots());
                    setMultiAssetTarget(null);
                  }}
                  className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
                >
                  <Trash2 className="h-4 w-4" />
                  清除多参参考图
                </button>
              ) : null}
              <button
                onClick={() => void handleGenerate()}
                disabled={generating || !canStartGeneration}
                className="flex items-center gap-2 rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {generating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {!canStartGeneration && prompt.trim()
                  ? videoMode === "image_to_video"
                    ? "请先上传参考图"
                    : videoMode === "start_end_frame"
                      ? "请先上传首帧和尾帧"
                      : "开始生成"
                  : "开始生成"}
              </button>
            </div>
            {generateError ? (
              <div className="whitespace-pre-wrap rounded-xl border border-rose-600/40 bg-rose-500/15 px-4 py-3 text-xs leading-6 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                {generateError}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <h3 className="text-sm font-medium">生成结果</h3>
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="relative w-full md:w-64">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.target.value)}
                  placeholder="搜索提示词、时长或任务 ID"
                  className="w-full rounded-lg border border-border bg-input py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <select
                value={historyModel}
                onChange={(event) => setHistoryModel(event.target.value)}
                className="rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {modelOptions.map((item) => (
                  <option key={item} value={item}>
                    {item === "all" ? "全部模型" : formatVideoResultModelDisplay(item)}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void loadData()}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
              >
                <RefreshCw className="h-4 w-4" />
                刷新
              </button>
              {loading ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : null}
            </div>
          </div>

          <div className="grid grid-cols-1 items-stretch gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
              {pagedResults.map((item) => {
                const videoUrl = playableVideoUrl(item);
                const videoMetadata = videoUrl ? derivedVideoMetadata[videoUrl] : null;
                const coverUrl = derivedResultCover(item, videoMetadata);

                return (
                  <article
                    key={item.id}
                    draggable
                    onDragStart={(event) => handleResultDragStart(event, item)}
                    onDragEnd={handleResultDragEnd}
                    className={cn(
                      "glass-panel group flex h-full min-h-0 flex-col overflow-hidden rounded-xl transition-transform",
                      draggingItem?.id === item.id ? "scale-[0.98] opacity-70" : "",
                    )}
                  >
                    <button
                      onClick={() => setPreviewItem(item)}
                      className="relative block aspect-video w-full shrink-0 overflow-hidden bg-black text-left"
                    >
                      {coverUrl ? (
                        <img
                          src={coverUrl}
                          alt={item.prompt}
                          className="h-full w-full object-cover opacity-85"
                          referrerPolicy="no-referrer"
                        />
                      ) : videoUrl ? (
                        <video
                          src={videoUrl}
                          className="h-full w-full object-cover opacity-90"
                          muted
                          autoPlay
                          loop
                          playsInline
                          preload="metadata"
                        />
                      ) : (
                        <GeneratedMediaPlaceholder
                          kind="video"
                          label="暂无封面"
                          className="h-full w-full bg-black text-zinc-300"
                          description={videoCoverReason(item)}
                        />
                      )}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                        <div className="rounded-full bg-primary/90 p-3 text-primary-foreground">
                          <Play className="ml-0.5 h-5 w-5" />
                        </div>
                      </div>
                    </button>

                    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
                      <p className="line-clamp-2 shrink-0 text-sm text-foreground">{item.prompt}</p>
                      <div className="flex shrink-0 flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        {modeLabel(item.videoMode) ? (
                          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
                            {modeLabel(item.videoMode)}
                          </span>
                        ) : null}
                        <span>{formatVideoResultModelDisplay(item.model)}</span>
                        <span>{displayedDuration(item, videoMetadata)}</span>
                        <span>{displayedAspectRatio(item, videoMetadata)}</span>
                        <span>{displayedResolution(item)}</span>
                        {item.taskId ? <span>{item.taskId}</span> : null}
                      </div>

                      <div className="flex min-h-0 flex-1 flex-col gap-3">
                        {hasMultiReferenceImages(item) ? (
                          <div className="flex flex-col gap-2">
                            <div className="rounded-lg border border-border bg-muted/20 p-2">
                              <div className="flex flex-wrap gap-2">
                                {MULTI_REF_ORDER.map((key) => {
                                  const u = resultMultiReferenceUrl(item, key);
                                  if (!u) return null;
                                  return (
                                    <div key={key} className="flex flex-col items-center gap-0.5">
                                      <img
                                        src={u}
                                        alt={MULTI_REF_LABELS[key]}
                                        className="h-10 w-10 rounded object-cover"
                                        referrerPolicy="no-referrer"
                                      />
                                      <span className="max-w-[3.5rem] truncate text-center text-[9px] text-muted-foreground">
                                        {MULTI_REF_LABELS[key]}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="mt-2 text-xs text-muted-foreground">多参参考图</div>
                            </div>
                            {item.resolvedReferenceImageUrl ? (
                              <div className="rounded-lg border border-border/70 bg-background/70 p-2">
                                <div className="mb-1 text-[10px] text-muted-foreground">主参考图</div>
                                <img
                                  src={resultReferenceUrl(item.resolvedReferenceImageUrl) || undefined}
                                  alt="主参考图"
                                  className="h-10 w-10 rounded object-cover"
                                  referrerPolicy="no-referrer"
                                />
                              </div>
                            ) : null}
                          </div>
                        ) : item.referenceImageUrl || item.firstFrameUrl ? (
                          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 p-2">
                            {item.firstFrameUrl ? (
                              <img
                                src={resultReferenceUrl(item.firstFrameUrl) || undefined}
                                alt="首帧"
                                className="h-10 w-10 rounded object-cover"
                                referrerPolicy="no-referrer"
                              />
                            ) : null}
                            {item.lastFrameUrl ? (
                              <img
                                src={resultReferenceUrl(item.lastFrameUrl) || undefined}
                                alt="尾帧"
                                className="h-10 w-10 rounded object-cover"
                                referrerPolicy="no-referrer"
                              />
                            ) : null}
                            {item.referenceImageUrl && !item.firstFrameUrl ? (
                              <img
                                src={resultReferenceUrl(item.referenceImageUrl) || undefined}
                            alt="reference"
                            className="h-10 w-10 rounded object-cover"
                            referrerPolicy="no-referrer"
                          />
                            ) : null}
                            <span className="text-xs text-muted-foreground">
                              {item.videoMode === "start_end_frame"
                                ? "首尾帧"
                                : item.referenceImageUrl || item.firstFrameUrl
                                  ? "参考输入"
                                  : ""}
                            </span>
                        </div>
                      ) : null}

                      {!videoUrl ? (
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-[11px] leading-5 text-amber-100">
                          {videoPreviewReason(item)}
                        </div>
                      ) : null}
                      </div>

                      <div className="mt-auto flex shrink-0 items-center justify-between border-t border-border/50 pt-3">
                        <span className="text-[11px] text-muted-foreground">
                          {formatTime(item.createdAt)}
                        </span>
                        <div className="flex items-center gap-2">
                          {videoUrl ? (
                            <button
                              onClick={() => openAssetSync(item)}
                              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                            >
                              同步资产
                            </button>
                          ) : null}
                          <button
                            onClick={() => setPreviewItem(item)}
                            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                          >
                            预览
                          </button>
                          {videoUrl ? (
                            <button
                              type="button"
                              onClick={() =>
                                void downloadMediaFile(
                                  videoUrl,
                                  guessMediaFilename(videoUrl, item.id, "video"),
                                )
                              }
                              className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                            >
                              <Download className="h-3.5 w-3.5" />
                              下载
                            </button>
                          ) : null}
                          <button
                            onClick={() => void handleDeleteVideo(item.id)}
                            title="删除此结果"
                            className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
              {filteredResults.length > VIDEO_PAGE_SIZE ? (
                <div className="col-span-full mt-2 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="flex h-8 items-center justify-center rounded border border-border px-3 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    上一页
                  </button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: totalPages }, (_, index) => {
                      const pageNumber = index + 1;
                      return (
                        <button
                          key={pageNumber}
                          type="button"
                          onClick={() => setPage(pageNumber)}
                          className={cn(
                            "flex h-8 min-w-[2rem] items-center justify-center rounded border px-2 text-xs",
                            pageNumber === currentPage
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:bg-accent",
                          )}
                        >
                          {pageNumber}
                        </button>
                );
              })}
                  </div>
                  <button
                    type="button"
                    onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="flex h-8 items-center justify-center rounded border border-border px-3 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    下一页
                  </button>
                </div>
              ) : null}
            </div>

            <aside className="glass-panel rounded-2xl p-4">
              <AssetSyncDropzone
                dragActive={syncDragActive}
                syncing={syncingAsset}
                notice={syncNotice}
                onDragOver={handleSyncDragOver}
                onDragLeave={handleSyncDragLeave}
                onDrop={handleSyncDrop}
              />
              <div className="mb-4 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-medium">最近任务</h3>
                </div>
                {recentTasks.length ? (
                  <button
                    type="button"
                    onClick={() => setConfirmClearTasksOpen(true)}
                    className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                  >
                    清空
                  </button>
                ) : null}
              </div>
              <div className="space-y-3">
                {recentTasks.map((task) => {
                  const failureReason = getTaskFailureReason(task);
                  return (
                  <div
                    key={task.id}
                    className={cn(
                      "rounded-xl border p-3",
                      failureReason
                        ? "border-rose-500/30 bg-rose-500/5"
                        : "border-border bg-muted/20",
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium">{task.id}</span>
                      <div className="flex items-center gap-1">
                      <span className={getTaskStatusPillClass(task)}>
                        {formatTaskStatusLabel(task)}
                      </span>
                        <button
                          type="button"
                          onClick={() => void handleDismissTask(task.id)}
                          className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          title="从列表中移除此任务"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {task.inputSummary || "暂无任务描述"}
                    </p>
                    {failureReason ? (
                      <div className="mt-2 rounded-md border border-rose-600/40 bg-rose-500/15 p-2 text-[11px] leading-5 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                        <div className="mb-0.5 font-semibold text-rose-800 dark:text-rose-300">失败原因</div>
                        <div className="whitespace-pre-wrap break-words">{failureReason}</div>
                      </div>
                    ) : null}
                    {taskReference(task) ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <img
                          src={taskReference(task) || undefined}
                          alt="reference"
                          className="h-8 w-8 rounded object-cover"
                          referrerPolicy="no-referrer"
                        />
                        {taskLastFrame(task) ? (
                          <img
                            src={taskLastFrame(task) || undefined}
                            alt="尾帧"
                            className="h-8 w-8 rounded object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : null}
                        <span className="text-[11px] text-muted-foreground">
                          已关联{resolvedTaskReferenceCaption(task)}
                        </span>
                      </div>
                    ) : null}
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      {formatTime(task.createdAt)}
                    </div>
                  </div>
                  );
                })}
                {!recentTasks.length ? (
                  <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    还没有生成任务
                  </div>
                ) : null}
              </div>
            </aside>
          </div>
        </div>
      </section>

      {previewItem ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
          <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold">结果预览</h3>
                <p className="text-xs text-muted-foreground">{previewItem.taskId || previewItem.id}</p>
              </div>
              <button
                onClick={() => setPreviewItem(null)}
                className="rounded-md p-2 transition-colors hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-6 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="overflow-hidden rounded-xl border border-border bg-black">
                {previewVideoUrl ? (
                  <video
                    src={previewVideoUrl || undefined}
                    poster={derivedResultCover(previewItem, previewVideoMetadata) || undefined}
                    controls
                    className="h-full w-full"
                  />
                ) : (
                  <GeneratedMediaPlaceholder
                    kind="video"
                    className="h-full min-h-[360px] w-full bg-black text-zinc-300"
                    description="当前结果还没有生成真实视频"
                  />
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">提示词</div>
                  <p className="text-sm leading-6">{previewItem.prompt}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-muted-foreground">模型</div>
                    <div className="mt-1 font-medium">{formatVideoResultModelDisplay(previewItem.model)}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-muted-foreground">时长</div>
                    <div className="mt-1 font-medium">{displayedDuration(previewItem, previewVideoMetadata)}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-muted-foreground">比例</div>
                    <div className="mt-1 font-medium">{displayedAspectRatio(previewItem, previewVideoMetadata)}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-muted-foreground">清晰度</div>
                    <div className="mt-1 font-medium">{displayedResolution(previewItem)}</div>
                  </div>
                </div>
                {previewItem.duration !== displayedDuration(previewItem, previewVideoMetadata) ? (
                  <div className="rounded-lg border border-border p-3 text-xs">
                    <div className="text-muted-foreground">请求时长</div>
                    <div className="mt-1 font-medium">{previewItem.duration}</div>
                  </div>
                ) : null}
                {previewItem.aspectRatio !== displayedAspectRatio(previewItem, previewVideoMetadata) ? (
                  <div className="rounded-lg border border-border p-3 text-xs">
                    <div className="text-muted-foreground">请求比例</div>
                    <div className="mt-1 font-medium">{previewItem.aspectRatio}</div>
                  </div>
                ) : null}
                {previewItem.requestedResolution &&
                previewItem.requestedResolution !== displayedResolution(previewItem) ? (
                  <div className="rounded-lg border border-border p-3 text-xs">
                    <div className="text-muted-foreground">请求清晰度</div>
                    <div className="mt-1 font-medium">{previewItem.requestedResolution}</div>
                  </div>
                ) : null}
                {previewItem.firstFrameUrl || previewItem.lastFrameUrl ? (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">首尾帧</div>
                    <div className="grid grid-cols-2 gap-2">
                      {previewItem.firstFrameUrl ? (
                        <img
                          src={resultReferenceUrl(previewItem.firstFrameUrl) || undefined}
                          alt="首帧"
                          className="w-full rounded-lg border border-border object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : null}
                      {previewItem.lastFrameUrl ? (
                        <img
                          src={resultReferenceUrl(previewItem.lastFrameUrl) || undefined}
                          alt="尾帧"
                          className="w-full rounded-lg border border-border object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : null}
                    </div>
                  </div>
                ) : hasMultiReferenceImages(previewItem) ? (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">多参参考</div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {MULTI_REF_ORDER.map((key) => {
                        const u = resultMultiReferenceUrl(previewItem, key);
                        if (!u) return null;
                        return (
                          <div key={key} className="space-y-1">
                            <img
                              src={u}
                              alt={MULTI_REF_LABELS[key]}
                              className="aspect-video w-full rounded-lg border border-border object-cover"
                              referrerPolicy="no-referrer"
                            />
                            <div className="text-[10px] text-muted-foreground">{MULTI_REF_LABELS[key]}</div>
                          </div>
                        );
                      })}
                    </div>
                    {previewItem.resolvedReferenceImageUrl ? (
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">主参考图</div>
                        <img
                          src={resultReferenceUrl(previewItem.resolvedReferenceImageUrl) || undefined}
                          alt="主参考图"
                          className="w-full rounded-lg border border-border object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    ) : null}
                  </div>
                ) : previewItem.referenceImageUrl ? (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">参考图</div>
                    <img
                      src={resultReferenceUrl(previewItem.referenceImageUrl) || undefined}
                      alt="reference"
                      className="w-full rounded-lg border border-border object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                ) : null}
                {!previewVideoUrl ? (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-100">
                    {videoPreviewReason(previewItem)}
                  </div>
                ) : null}
                {previewVideoUrl ? (
                  <button
                    type="button"
                    onClick={() =>
                      void downloadMediaFile(
                        previewVideoUrl,
                        guessMediaFilename(previewVideoUrl, previewItem.id, "video"),
                      )
                    }
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <Download className="h-4 w-4" />
                    下载到本地
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {confirmClearTasksOpen ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl">
            <h3 className="text-base font-semibold">确认清空最近任务？</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              该操作会删除当前账号下的最近任务记录，且不可恢复。
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmClearTasksOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleClearTasks()}
                className="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground hover:bg-destructive/90"
              >
                确认清空
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {referencePreview ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
          <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold">参考图预览</h3>
                <p className="text-xs text-muted-foreground">{referencePreview.title}</p>
              </div>
              <button
                onClick={() => setReferencePreview(null)}
                className="rounded-md p-2 transition-colors hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex min-h-[360px] items-center justify-center overflow-auto bg-black p-4">
              <img
                src={getGeneratedMediaUrl(referencePreview.url) || undefined}
                alt={referencePreview.title}
                className="max-h-[80vh] max-w-full object-contain"
                referrerPolicy="no-referrer"
      />
    </div>
          </div>
        </div>
      ) : null}
      <AssetSyncDialog
        item={syncDraft}
        submitting={syncingAsset}
        onClose={() => setSyncDraft(null)}
        onSubmit={handleSyncSubmit}
      />
    </CreateStudioSplitLayout>
  );
}
