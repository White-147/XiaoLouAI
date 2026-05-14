import type {
  MediaCapabilitySet,
  MediaModelCapability,
  MediaModelStatus,
  VideoGenerationMode,
  VideoInputMode,
} from "./api/create-video";

// ---------------------------------------------------------------------------
// Page-local adapter: extends the unified MediaModelCapability with convenience
// booleans that the tab UI reads. These are derived from inputModes.
// ---------------------------------------------------------------------------
export interface VideoCapability {
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

export function enrichVideoCapability(cap: MediaModelCapability): VideoCapability {
  return {
    ...cap,
    supportsTextToVideo: !!cap.inputModes.text_to_video?.supported,
    supportsSingleReference: !!cap.inputModes.single_reference?.supported,
    supportsStartEndFrame: !!cap.inputModes.start_end_frame?.supported,
    supportsMultiReference: !!cap.inputModes.multi_param?.supported,
    maxReferenceImages: cap.inputModes.multi_param?.maxReferenceImages,
  };
}

export function enrichVideoCapabilities(items: MediaModelCapability[]): VideoCapability[] {
  return items.map(enrichVideoCapability);
}

export type VideoCreateMode = VideoGenerationMode;

export const VIDEO_MODE_TABS: Array<{ id: VideoCreateMode; label: string; hint: string }> = [
  { id: "image_to_video", label: "图生视频", hint: "单张参考图驱动画面运动" },
  { id: "start_end_frame", label: "首尾帧生成", hint: "首帧和尾帧都必填，模型按两帧之间的约束生成视频" },
  {
    id: "multi_param",
    label: "多参生成",
    hint: "文生或多参考图：场景/角色/道具等分类上传，质量优先模型自动路由",
  },
];

export const I2V_MODEL_OPTIONS_UNUSED = [
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
export const DEFAULT_I2V_MODEL = "doubao-seedance-2-0-260128";
export const DEFAULT_START_END_MODEL = "doubao-seedance-2-0-260128";
export const MULTI_REF_MODEL_OPTIONS_UNUSED = [
  "veo_3_1-components-4K",
  "pixverse-c1",
  "veo3.1-components",
  "veo_3_1-components",
  "veo3.1-fast-components",
] as const;
export const START_END_MODEL_OPTIONS_UNUSED = ["pixverse-v6"] as const;

export const I2V_MODEL_OPTIONS = [
  {
    label: "veo3.1-pro",
    description: "当前已验证稳定的图生视频模型。",
  },
] as const;

export const MULTI_REF_MODEL_OPTIONS = [
  "pixverse-c1",
  "veo3.1-components",
  "veo_3_1-components",
  "veo_3_1-components-4K",
  "veo3.1-fast-components",
  "kling-multi-image2video",
  "kling-multi-elements",
] as const;
export const VIDEO_PAGE_SIZE = 9;
export const DEFAULT_VIDEO_RESOLUTION = "1080p";
export const DEFAULT_START_END_RESOLUTION = "720p";
export const DEFAULT_FIXED_VIDEO_DURATION = "8s";
export const DEFAULT_GENERAL_VIDEO_DURATION = "3s";
export const DEFAULT_VIDEO_ASPECT_RATIO = "16:9";
export const GENERAL_VIDEO_RESOLUTION_OPTIONS = ["1080p", "720p"] as const;
export const IMAGE_TO_VIDEO_RESOLUTION_OPTIONS = ["1080p"] as const;
export const START_END_RESOLUTION_OPTIONS = ["720p"] as const;
export const MULTI_PARAM_RESOLUTION_OPTIONS = ["720p"] as const;
export const GENERAL_DURATION_OPTIONS = ["3s", "5s"] as const;
export const FIXED_DURATION_OPTIONS = ["8s"] as const;
export const GENERAL_ASPECT_RATIO_OPTIONS = ["16:9", "1:1", "9:16"] as const;
export const FIXED_ASPECT_RATIO_OPTIONS = ["16:9"] as const;
export const VERTEX_VEO_31_DURATIONS = ["4s", "6s", "8s"];
export const VERTEX_VEO_31_ASPECT_RATIOS = ["16:9", "9:16"];
export const VERTEX_VEO_31_RESOLUTIONS = ["1080p", "720p", "4k"];
export const VERTEX_VEO_31_LITE_RESOLUTIONS = ["1080p", "720p"];

export function createImageToVideoCapabilitySet(
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
    ...(overrides.maxReferenceImages !== undefined ? { maxReferenceImages: overrides.maxReferenceImages } : {}),
    note: overrides.note || null,
  };
}

export function createVertexVeo31CapabilitySet(
  status: MediaModelStatus,
  supportedResolutions = VERTEX_VEO_31_RESOLUTIONS,
  overrides: Partial<MediaCapabilitySet> = {},
): MediaCapabilitySet {
  return createImageToVideoCapabilitySet({
    status,
    supportedDurations: VERTEX_VEO_31_DURATIONS,
    supportedAspectRatios: VERTEX_VEO_31_ASPECT_RATIOS,
    supportedResolutions,
    durationControl: "selectable",
    aspectRatioControl: "selectable",
    resolutionControl: "selectable",
    defaultDuration: "8s",
    defaultAspectRatio: "16:9",
    defaultResolution: "720p",
    ...overrides,
  });
}

export function inferVideoProvider(id: string): MediaModelCapability["provider"] {
  const lower = id.toLowerCase();
  if (lower.startsWith("pixverse")) return "pixverse";
  if (lower.startsWith("veo")) return "google";
  if (lower.startsWith("kling")) return "kling";
  if (lower.startsWith("hailuo")) return "hailuo";
  if (lower.startsWith("grok")) return "grok";
  if (lower.startsWith("doubao") || lower.startsWith("seedance")) return "bytedance";
  return "other";
}

export function fallbackVideoModel(
  base: Omit<VideoCapability, "kind" | "provider"> & { provider?: MediaModelCapability["provider"] },
): VideoCapability {
  return {
    kind: "video",
    provider: base.provider ?? inferVideoProvider(base.id),
    ...base,
  } as VideoCapability;
}

export const FALLBACK_IMAGE_TO_VIDEO_TEXT_CAPABILITY = createImageToVideoCapabilitySet({
  status: "experimental",
  supportedDurations: ["8s"],
  supportedAspectRatios: ["16:9", "1:1", "9:16"],
  supportedResolutions: ["1080p", "720p"],
  durationControl: "fixed",
  aspectRatioControl: "selectable",
  resolutionControl: "selectable",
  note: "按 Yunwu 官方创建视频文档接入，目前优先开放已确认存在的 size / aspect_ratio 能力。",
});

export const FALLBACK_IMAGE_TO_VIDEO_SINGLE_REFERENCE_CAPABILITY = createImageToVideoCapabilitySet({
  status: "experimental",
  supportedDurations: ["8s"],
  supportedAspectRatios: ["16:9", "1:1", "9:16"],
  supportedResolutions: ["1080p"],
  durationControl: "fixed",
  aspectRatioControl: "selectable",
  resolutionControl: "fixed",
  note: "按 Yunwu 官方参考图视频文档接入，优先保持当前单参考图视频体验。",
});

export const FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES: VideoCapability[] = [
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
  fallbackVideoModel({
    id: "vertex:veo-3.1-generate-001",
    label: "Veo 3.1+",
    provider: "google-vertex",
    status: "stable",
    note: "Veo 3.1 正式版，直接调用 Vertex AI（需配置 VERTEX_PROJECT_ID、VERTEX_GCS_BUCKET 及认证凭据）。",
    supportsTextToVideo: true,
    supportsSingleReference: true,
    supportsStartEndFrame: true,
    supportsMultiReference: true,
    maxReferenceImages: 3,
    maxReferenceImagesSource: "official",
    inputModes: {
      text_to_video: createVertexVeo31CapabilitySet("stable"),
      single_reference: createVertexVeo31CapabilitySet("stable"),
      start_end_frame: createVertexVeo31CapabilitySet("stable"),
      multi_param: createVertexVeo31CapabilitySet("stable", VERTEX_VEO_31_RESOLUTIONS, {
        maxReferenceImages: 3,
      }),
    },
  }),
  fallbackVideoModel({
    id: "vertex:veo-3.1-fast-generate-001",
    label: "Veo 3.1 Fast+",
    provider: "google-vertex",
    status: "stable",
    note: "Veo 3.1 Fast 正式版，速度更快，直接调用 Vertex AI。",
    supportsTextToVideo: true,
    supportsSingleReference: true,
    supportsStartEndFrame: true,
    supportsMultiReference: true,
    maxReferenceImages: 3,
    maxReferenceImagesSource: "official",
    inputModes: {
      text_to_video: createVertexVeo31CapabilitySet("stable"),
      single_reference: createVertexVeo31CapabilitySet("stable"),
      start_end_frame: createVertexVeo31CapabilitySet("stable"),
      multi_param: createVertexVeo31CapabilitySet("stable", VERTEX_VEO_31_RESOLUTIONS, {
        maxReferenceImages: 3,
      }),
    },
  }),
  fallbackVideoModel({
    id: "vertex:veo-3.1-lite-generate-001",
    label: "Veo 3.1 Lite+",
    provider: "google-vertex",
    status: "preview",
    note: "Veo 3.1 Lite Preview，按 Vertex AI 官方能力开放文生、单参考图和首尾帧；参考资产图不支持。",
    supportsTextToVideo: true,
    supportsSingleReference: true,
    supportsStartEndFrame: true,
    supportsMultiReference: false,
    inputModes: {
      text_to_video: createVertexVeo31CapabilitySet("preview", VERTEX_VEO_31_LITE_RESOLUTIONS),
      single_reference: createVertexVeo31CapabilitySet("preview", VERTEX_VEO_31_LITE_RESOLUTIONS),
      start_end_frame: createVertexVeo31CapabilitySet("preview", VERTEX_VEO_31_LITE_RESOLUTIONS),
    },
  }),
];

export const FALLBACK_MULTI_PARAM_CAPABILITIES: VideoCapability[] = [
  fallbackVideoModel({
    id: "vertex:veo-3.1-generate-001",
    label: "Veo 3.1+",
    provider: "google-vertex",
    status: "stable",
    note: "Vertex AI 官方参考资产图能力，最多 3 张 asset reference image。",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsMultiReference: true,
    maxReferenceImages: 3,
    maxReferenceImagesSource: "official",
    inputModes: {
      multi_param: createVertexVeo31CapabilitySet("stable", VERTEX_VEO_31_RESOLUTIONS, {
        maxReferenceImages: 3,
      }),
    },
  }),
  fallbackVideoModel({
    id: "vertex:veo-3.1-fast-generate-001",
    label: "Veo 3.1 Fast+",
    provider: "google-vertex",
    status: "stable",
    note: "Vertex AI 官方参考资产图能力，最多 3 张 asset reference image。",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsMultiReference: true,
    maxReferenceImages: 3,
    maxReferenceImagesSource: "official",
    inputModes: {
      multi_param: createVertexVeo31CapabilitySet("stable", VERTEX_VEO_31_RESOLUTIONS, {
        maxReferenceImages: 3,
      }),
    },
  }),
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

export const fallbackVeo31ProImageToVideoCapability = FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES.find(
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

export const fallbackVeo31ImageToVideoCapability = FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES.find(
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

export const fallbackVeo314KImageToVideoCapability = FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES.find(
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

export const fallbackVeo31Fast4KImageToVideoCapability = FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES.find(
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

export const fallbackVeo31FastImageToVideoCapability = FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES.find(
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

export const fallbackGrokVideo3ImageToVideoCapability = FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES.find(
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

export const fallbackKlingVideoImageToVideoCapability = FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES.find(
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

export const FALLBACK_START_END_CAPABILITIES: VideoCapability[] = [
  fallbackVideoModel({ id: "pixverse-v6", label: "PixVerse V6", status: "experimental", note: "PixVerse V6 首尾帧静态 fallback：严格要求首帧和尾帧都必填；官方当前按 adaptive 固定画幅接入，支持 1-15s 与 360p/540p/720p/1080p。", supportsTextToVideo: false, supportsSingleReference: false, supportsStartEndFrame: true, inputModes: { start_end_frame: createImageToVideoCapabilitySet({ status: "experimental", supportedDurations: ["1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"], supportedAspectRatios: ["adaptive"], supportedResolutions: ["360p", "540p", "720p", "1080p"], durationControl: "selectable", aspectRatioControl: "fixed", resolutionControl: "selectable", defaultDuration: "5s", defaultAspectRatio: "adaptive", defaultResolution: "720p" }) } }),
  fallbackVideoModel({ id: "pixverse-c1", label: "PixVerse C1", status: "experimental", note: "PixVerse C1 首尾帧静态 fallback：严格要求首帧和尾帧都必填；官方当前按 adaptive 固定画幅接入，支持 1-15s 与 360p/540p/720p/1080p。", supportsTextToVideo: false, supportsSingleReference: false, supportsStartEndFrame: true, inputModes: { start_end_frame: createImageToVideoCapabilitySet({ status: "experimental", supportedDurations: ["1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"], supportedAspectRatios: ["adaptive"], supportedResolutions: ["360p", "540p", "720p", "1080p"], durationControl: "selectable", aspectRatioControl: "fixed", resolutionControl: "selectable", defaultDuration: "5s", defaultAspectRatio: "adaptive", defaultResolution: "720p" }) } }),
  fallbackVideoModel({ id: "kling-video", label: "kling-video", status: "stable", note: "已用真实 Yunwu 首尾帧任务复测通过；当前保留为首尾帧默认模型。接口可快速受理，但最终出片耗时较长（实测约 5-6 分钟）。", supportsTextToVideo: false, supportsSingleReference: false, supportsStartEndFrame: true, inputModes: { start_end_frame: createImageToVideoCapabilitySet({ status: "stable", supportedDurations: ["5s", "10s"], supportedAspectRatios: ["16:9"], supportedResolutions: ["自动"], durationControl: "selectable", aspectRatioControl: "fixed", resolutionControl: "fixed", defaultDuration: "5s", defaultAspectRatio: "16:9", defaultResolution: "自动", note: "已通过真实首尾帧任务验证并成功出片；当前保留官方已确认可用的 5s / 10s 与 16:9。" }) } }),
  fallbackVideoModel({ id: "doubao-seedance-2-0-260128", label: "Seedance 2.0", status: "stable", note: "字节跳动 Seedance 2.0 首尾帧模式，adaptive 画幅，4-15s，720p/480p。", supportsTextToVideo: false, supportsSingleReference: false, supportsStartEndFrame: true, inputModes: { start_end_frame: createImageToVideoCapabilitySet({ status: "stable", supportedDurations: ["4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"], supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"], supportedResolutions: ["720p", "480p"], durationControl: "selectable", aspectRatioControl: "selectable", resolutionControl: "selectable", defaultDuration: "5s", defaultAspectRatio: "adaptive", defaultResolution: "720p" }) } }),
  // Vertex Veo first+last frame support
  fallbackVideoModel({
    id: "vertex:veo-3.1-generate-001",
    label: "Veo 3.1+",
    provider: "google-vertex",
    status: "stable",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsStartEndFrame: true,
    inputModes: { start_end_frame: createVertexVeo31CapabilitySet("stable") },
  }),
  fallbackVideoModel({
    id: "vertex:veo-3.1-fast-generate-001",
    label: "Veo 3.1 Fast+",
    provider: "google-vertex",
    status: "stable",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsStartEndFrame: true,
    inputModes: { start_end_frame: createVertexVeo31CapabilitySet("stable") },
  }),
  fallbackVideoModel({
    id: "vertex:veo-3.1-lite-generate-001",
    label: "Veo 3.1 Lite+",
    provider: "google-vertex",
    status: "preview",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsStartEndFrame: true,
    inputModes: {
      start_end_frame: createVertexVeo31CapabilitySet("preview", VERTEX_VEO_31_LITE_RESOLUTIONS),
    },
  }),
];

export function resolveImageToVideoInputMode(referenceUrl?: string | null): VideoInputMode {
  return referenceUrl ? "single_reference" : "text_to_video";
}

export function getImageToVideoCapabilitySet(
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

export function getMultiParamCapabilitySet(capability: VideoCapability | null | undefined) {
  return capability?.inputModes?.multi_param || null;
}

export function getStartEndCapabilitySet(capability: VideoCapability | null | undefined) {
  return capability?.inputModes?.start_end_frame || null;
}

/**
 * Picks a capability from the list, explicitly preferring `preferredId` before
 * falling back to `capabilities[0]`. This prevents the product default (Seedance)
 * from being silently skipped in favour of whichever model sits at position [0]
 * in a static fallback array.
 */
export function pickFallbackVideoCapability(
  capabilities: VideoCapability[],
  preferredId: string,
): VideoCapability | null {
  return capabilities.find((item) => item.id === preferredId) || capabilities[0] || null;
}

export function getImageToVideoOptionStatus(
  capability: VideoCapability,
  inputMode: VideoInputMode,
): VideoCapability["status"] {
  return getImageToVideoCapabilitySet(capability, inputMode)?.status || capability.status;
}

export function capabilityStatusLabel(status: VideoCapability["status"]) {
  if (status === "stable") return "稳定";
  if (status === "failing") return "不可用";
  return "实验性";
}

export function capabilityStatusTone(status: VideoCapability["status"]) {
  if (status === "stable") {
    return "border-emerald-600/40 bg-emerald-500/15 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200";
  }
  if (status === "failing") {
    return "border-rose-600/40 bg-rose-500/15 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200";
  }
  return "border-amber-600/40 bg-amber-500/15 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200";
}

export const VEO_VIDEO_MODEL_DISPLAY_REMARK = "（转）";

export function isVeoVideoModelId(id: string) {
  return id.toLowerCase().includes("veo");
}

/** 通用创作 · 视频：所有 id 含 veo 的模型在界面展示名称后加「（转）」 */
export function withVeoVideoModelDisplayRemark(id: string, label: string) {
  if (!isVeoVideoModelId(id)) return label;
  if (label.endsWith(VEO_VIDEO_MODEL_DISPLAY_REMARK)) return label;
  return `${label}${VEO_VIDEO_MODEL_DISPLAY_REMARK}`;
}

/** 结果卡片 / 预览等仅有机型 id 时的展示 */
export function formatVideoResultModelDisplay(modelId: string) {
  return withVeoVideoModelDisplayRemark(modelId, modelId);
}

export function imageToVideoModelLabel(option: Pick<VideoCapability, "id" | "label">) {
  const base = option.id === "veo3.1" ? "veo3.1（仅图生）" : option.label;
  return withVeoVideoModelDisplayRemark(option.id, base);
}

export function multiParamModelLabel(option: VideoCapability) {
  const maxReferenceImages = option.maxReferenceImages || 7;
  const status = getMultiParamCapabilitySet(option)?.status || option.status;
  const label = withVeoVideoModelDisplayRemark(option.id, option.label);
  return `${label} · 最多${maxReferenceImages}张 · ${capabilityStatusLabel(status)}`;
}

export function startEndModelLabel(option: VideoCapability) {
  const status = getStartEndCapabilitySet(option)?.status || option.status;
  const label = withVeoVideoModelDisplayRemark(option.id, option.label);
  return `${label}（${capabilityStatusLabel(status)}）`;
}

export function modeLabel(mode: string | null | undefined) {
  if (mode === "start_end_frame") return "首尾帧";
  if (mode === "multi_param") return "多参";
  if (mode === "image_to_video") return "图生";
  return null;
}
