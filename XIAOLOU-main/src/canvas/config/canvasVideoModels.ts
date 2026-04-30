import type {
  BridgeMediaCapabilitySet,
  BridgeMediaModelCapability,
  BridgeMediaModelProvider,
} from '../types';

export type CanvasVideoModelProvider =
  | 'google'
  | 'google-vertex'
  | 'kling'
  | 'hailuo'
  | 'grok'
  | 'bytedance'
  | 'pixverse'
  | 'other';

type CanvasVideoModeConfig = {
  durations: number[];
  resolutions: string[];
  aspectRatios: string[];
  maxReferenceImages?: number;
};

export type CanvasVideoModelOption = {
  id: string;
  name: string;
  provider: CanvasVideoModelProvider;
  supportsTextToVideo: boolean;
  supportsImageToVideo: boolean;
  supportsMultiImage: boolean;
  supportsStartEndFrame?: boolean;
  recommended?: boolean;
  textToVideo?: CanvasVideoModeConfig;
  imageToVideo?: CanvasVideoModeConfig;
  startEndFrame?: CanvasVideoModeConfig;
  multiImage?: CanvasVideoModeConfig;
};

const PIXVERSE_TEXT_TO_VIDEO_CONFIG: CanvasVideoModeConfig = {
  durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  resolutions: ['360p', '540p', '720p', '1080p'],
  aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '2:3', '3:2', '21:9'],
};

const PIXVERSE_ADAPTIVE_VIDEO_CONFIG: CanvasVideoModeConfig = {
  durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  resolutions: ['360p', '540p', '720p', '1080p'],
  aspectRatios: ['adaptive'],
};

const PIXVERSE_FUSION_CONFIG: CanvasVideoModeConfig = {
  durations: [5, 8],
  resolutions: ['360p', '540p', '720p', '1080p'],
  aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '2:3', '3:2', '21:9'],
  maxReferenceImages: 3,
};

// Veo 3.1+ is the default for all canvas video modes.
export const DEFAULT_XIAOLOU_VIDEO_MODEL_ID = 'vertex:veo-3.1-generate-001';
export const DEFAULT_XIAOLOU_IMAGE_TO_VIDEO_MODEL_ID = DEFAULT_XIAOLOU_VIDEO_MODEL_ID;

/**
 * Vertex Veo model convention:
 *   id (internalId) : "vertex:<rawModelId>"   e.g. "vertex:veo-3.1-generate-001"
 *   name (label)    : ends with "+"            e.g. "Veo 3.1+"
 *   rawModelId      : stripped of "vertex:"   — what actually gets sent to Vertex API
 *
 * Excluded Vertex models:
 *   veo-3.1-generate-preview       → removed by Google 2026-04-02
 *   veo-3.1-fast-generate-preview  → removed by Google 2026-04-02
 *   "Veo 3.1 4K" as a model        → 4K is a resolution parameter, not a separate model
 *   gemini-3-pro-preview (chat)    → discontinued by Google 2026-03-26
 */
const VEO_ASPECT_RATIOS = ['16:9', '9:16', '1:1'];
const VEO_MULTI_REF_ASPECT_RATIOS = ['16:9', '9:16'];
const VEO_DURATIONS = [4, 6, 8];
const VEO_REFERENCE_TO_VIDEO_DURATIONS = VEO_DURATIONS;
const VEO_RESOLUTIONS = ['1080p', '720p', '480p'];
const VEO_MULTI_REF_RESOLUTIONS = ['1080p', '720p'];

export const XIAOLOU_IMAGE_TO_VIDEO_MODELS: CanvasVideoModelOption[] = [
  {
    id: 'pixverse-v6',
    name: 'PixVerse V6',
    provider: 'pixverse',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    supportsMultiImage: false,
    supportsStartEndFrame: true,
    textToVideo: PIXVERSE_TEXT_TO_VIDEO_CONFIG,
    imageToVideo: PIXVERSE_ADAPTIVE_VIDEO_CONFIG,
    startEndFrame: PIXVERSE_ADAPTIVE_VIDEO_CONFIG,
  },
  {
    id: 'pixverse-c1',
    name: 'PixVerse C1',
    provider: 'pixverse',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    supportsMultiImage: true,
    supportsStartEndFrame: true,
    textToVideo: PIXVERSE_TEXT_TO_VIDEO_CONFIG,
    imageToVideo: PIXVERSE_ADAPTIVE_VIDEO_CONFIG,
    startEndFrame: PIXVERSE_ADAPTIVE_VIDEO_CONFIG,
    multiImage: PIXVERSE_FUSION_CONFIG,
  },
  {
    id: 'grok-video-3',
    name: 'Grok Video 3',
    provider: 'grok',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    supportsMultiImage: false,
    textToVideo: {
      durations: [6],
      resolutions: ['1080p', '720p'],
      aspectRatios: ['3:2', '1:1', '2:3'],
    },
    imageToVideo: {
      durations: [6],
      resolutions: ['1080p', '720p'],
      aspectRatios: ['3:2', '1:1', '2:3'],
    },
  },
  {
    id: 'kling-video',
    name: 'Kling Video',
    provider: 'kling',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    supportsMultiImage: false,
    supportsStartEndFrame: true,
    textToVideo: {
      durations: [5, 10],
      resolutions: ['Auto'],
      aspectRatios: ['16:9', '9:16', '1:1'],
    },
    imageToVideo: {
      durations: [5, 10],
      resolutions: ['Auto'],
      aspectRatios: ['16:9', '9:16', '1:1'],
    },
    startEndFrame: {
      durations: [5, 10],
      resolutions: ['Auto'],
      aspectRatios: ['16:9'],
    },
  },
  {
    id: 'kling-omni-video',
    name: 'Kling V3 Omni',
    provider: 'kling',
    supportsTextToVideo: false,
    supportsImageToVideo: true,
    supportsMultiImage: false,
    imageToVideo: {
      durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      resolutions: ['Auto'],
      aspectRatios: ['16:9', '9:16', '1:1'],
    },
  },
  {
    id: 'doubao-seedance-2-0-260128',
    name: 'Seedance 2.0',
    provider: 'bytedance',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    supportsMultiImage: true,
    supportsStartEndFrame: true,
    recommended: false,
    textToVideo: {
      durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      resolutions: ['720p', '480p'],
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    },
    imageToVideo: {
      durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      resolutions: ['720p', '480p'],
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
    },
    startEndFrame: {
      durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      resolutions: ['720p', '480p'],
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
    },
    multiImage: {
      durations: [4, 5, 8, 10, 15],
      resolutions: ['1080p', '720p', '480p'],
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      maxReferenceImages: 7,
    },
  },
  {
    id: 'doubao-seedance-2-0-fast-260128',
    name: 'Seedance 2.0 Fast',
    provider: 'bytedance',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    supportsMultiImage: true,
    textToVideo: {
      durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      resolutions: ['720p', '480p'],
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    },
    imageToVideo: {
      durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      resolutions: ['720p', '480p'],
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
    },
    multiImage: {
      durations: [4, 5, 8, 10, 15],
      resolutions: ['1080p', '720p', '480p'],
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      maxReferenceImages: 7,
    },
  },

  // ── Official Vertex AI Veo models ─────────────────────────────────────────
  // id = "vertex:<rawModelId>"; name ends with "+" per naming convention.
  // The "+" only appears in `name`, never in the ID sent to the backend.
  {
    id: 'vertex:veo-3.1-generate-001',
    name: 'Veo 3.1+',
    provider: 'google-vertex',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    supportsMultiImage: true,
    supportsStartEndFrame: true,
    recommended: true,
    textToVideo: { durations: VEO_DURATIONS, resolutions: VEO_RESOLUTIONS, aspectRatios: VEO_ASPECT_RATIOS },
    imageToVideo: { durations: VEO_DURATIONS, resolutions: VEO_RESOLUTIONS, aspectRatios: VEO_ASPECT_RATIOS },
    startEndFrame: { durations: VEO_DURATIONS, resolutions: VEO_RESOLUTIONS, aspectRatios: VEO_ASPECT_RATIOS },
    multiImage: { durations: VEO_REFERENCE_TO_VIDEO_DURATIONS, resolutions: VEO_MULTI_REF_RESOLUTIONS, aspectRatios: VEO_MULTI_REF_ASPECT_RATIOS, maxReferenceImages: 3 },
  },
  {
    id: 'vertex:veo-3.1-fast-generate-001',
    name: 'Veo 3.1 Fast+',
    provider: 'google-vertex',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    supportsMultiImage: true,
    supportsStartEndFrame: true,
    recommended: false,
    textToVideo: { durations: VEO_DURATIONS, resolutions: ['1080p', '720p'], aspectRatios: VEO_ASPECT_RATIOS },
    imageToVideo: { durations: VEO_DURATIONS, resolutions: ['1080p', '720p'], aspectRatios: VEO_ASPECT_RATIOS },
    startEndFrame: { durations: VEO_DURATIONS, resolutions: ['1080p', '720p'], aspectRatios: VEO_ASPECT_RATIOS },
    multiImage: { durations: VEO_REFERENCE_TO_VIDEO_DURATIONS, resolutions: VEO_MULTI_REF_RESOLUTIONS, aspectRatios: VEO_MULTI_REF_ASPECT_RATIOS, maxReferenceImages: 3 },
  },
  {
    id: 'vertex:veo-3.1-lite-generate-001',
    name: 'Veo 3.1 Lite+',
    provider: 'google-vertex',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    supportsMultiImage: false,
    supportsStartEndFrame: true,
    recommended: false,
    textToVideo: { durations: VEO_DURATIONS, resolutions: ['1080p', '720p'], aspectRatios: VEO_ASPECT_RATIOS },
    imageToVideo: { durations: VEO_DURATIONS, resolutions: ['1080p', '720p'], aspectRatios: VEO_ASPECT_RATIOS },
    startEndFrame: { durations: [5, 8], resolutions: ['1080p', '720p'], aspectRatios: VEO_ASPECT_RATIOS },
  },
];

function toVideoCapSet(config: CanvasVideoModeConfig): BridgeMediaCapabilitySet {
  const durations = config.durations.map((d) => `${d}s`);
  return {
    supported: true,
    status: 'stable',
    supportedAspectRatios: config.aspectRatios,
    supportedResolutions: config.resolutions,
    supportedDurations: durations,
    durationControl: durations.length > 1 ? 'selectable' : 'fixed',
    aspectRatioControl:
      config.aspectRatios.length > 1 && !config.aspectRatios.includes('adaptive')
        ? 'selectable'
        : 'fixed',
    resolutionControl: config.resolutions.length > 1 ? 'selectable' : 'fixed',
    defaultAspectRatio: config.aspectRatios[0] || null,
    defaultResolution: config.resolutions[0] || null,
    defaultDuration: durations[0] || null,
    ...(config.maxReferenceImages != null ? { maxReferenceImages: config.maxReferenceImages } : {}),
  };
}

export function buildFallbackVideoCapabilities(
  models: CanvasVideoModelOption[] = XIAOLOU_IMAGE_TO_VIDEO_MODELS,
): BridgeMediaModelCapability[] {
  return models.map((m) => {
    const inputModes: BridgeMediaModelCapability['inputModes'] = {};
    if (m.supportsTextToVideo && m.textToVideo) {
      inputModes.text_to_video = toVideoCapSet(m.textToVideo);
    }
    if (m.supportsImageToVideo && m.imageToVideo) {
      inputModes.single_reference = toVideoCapSet(m.imageToVideo);
    }
    if (m.supportsStartEndFrame && m.startEndFrame) {
      inputModes.start_end_frame = toVideoCapSet(m.startEndFrame);
    }
    if (m.supportsMultiImage && m.multiImage) {
      inputModes.multi_param = toVideoCapSet(m.multiImage);
    }
    return {
      id: m.id,
      label: m.name,
      provider: (m.provider === 'google-vertex' ? 'google' : m.provider) as BridgeMediaModelProvider,
      kind: 'video' as const,
      status: 'stable' as const,
      recommended: m.recommended,
      inputModes,
    };
  });
}

const LEGACY_CANVAS_VIDEO_MODEL_ALIASES: Record<string, string> = {
  'veo-3.1': 'veo3.1',
  'veo3-pro-frames': 'pixverse-v6',
  'veo3.1-pro-frames': 'pixverse-v6',
  'veo-3.1-pro-frames': 'pixverse-v6',
};

export function normalizeCanvasVideoModelId(modelId?: string | null) {
  const normalized = String(modelId || '').trim();
  if (!normalized) {
    return DEFAULT_XIAOLOU_IMAGE_TO_VIDEO_MODEL_ID;
  }

  return LEGACY_CANVAS_VIDEO_MODEL_ALIASES[normalized] || normalized;
}

export function isXiaolouImageToVideoModel(modelId?: string | null) {
  const normalized = normalizeCanvasVideoModelId(modelId);
  return XIAOLOU_IMAGE_TO_VIDEO_MODELS.some((model) => model.id === normalized);
}
